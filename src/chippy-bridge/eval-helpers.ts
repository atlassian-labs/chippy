/**
 * Pure eval helpers — extracted byte-for-byte from chippy-page-bridge.js.
 *
 * Source: .agents/skills/chippy/extension/chippy-page-bridge.js
 *   - evalElementDom         (lines 681–724)
 *   - evalFiberProps         (lines 732–795)
 *   - evalFiberPropValue     (lines 797–845)
 *   - evalFindFibers         (lines 956–983)
 *
 * Mechanical extraction rules:
 *   - Bodies copied verbatim. Logic, branch order, and string literals
 *     untouched.
 *   - Closure-bound dependencies (`chippy.layoutLab.getHookSummary`,
 *     `resolveOwnerFiber`, `safeSerialize`, `buildScriptHelpers`,
 *     `rememberFiber`, `window.getComputedStyle`) become explicit
 *     parameters. The bridge supplies them at call time.
 *   - No re-authoring, no behavior change.
 */

// These are deliberately read-only adapters. The bridge injects page-bound
// dependencies at call time so the helpers remain testable without a DOM,
// while the page-specific fiber registry and computed-style access stay owned
// by the bridge shell.

import { collectOwnerFibers, isComponentFiber } from './owner-chain';
import {
  applyRecoveredOrigin,
  readComponentName,
  warmComponentNames,
  type NameRecoveryStats,
} from './component-origin';
import { replayComponentHooks } from '../debug-render/replay';
import {
  DEFAULT_GREP_LIMITS,
  callsUseDebugValue,
  grepFiber,
  parseGrepScopes,
  type GrepHit,
  type ReplayForGrep,
} from './fiber-grep';

// ─── Type aliases (intentionally loose; React internals are duck-typed) ───

export type Fiber = {
  type?: { displayName?: string; name?: string } | unknown;
  memoizedProps?: Record<string, unknown> | null;
  _debugOwner?: Fiber | null;
  [key: string]: unknown;
};

export type HookSummary = {
  hookCount: number | null;
  hookCountTruncated: boolean;
  hookCountMax: number | null;
};

export type GetHookSummary = (fiber: Fiber) => HookSummary;

export type ResolveOwnerFiber = (baseFiber: Fiber, ownerIndex: number) => Fiber | null;

export type SafeSerialize = (value: unknown, depth: number, seen: Set<unknown>) => unknown;

export type FiberInfo = {
  name?: string;
  source?: { fileName?: string };
  domTestId?: string;
  domText?: string;
  [key: string]: unknown;
};

export type ScriptHelpers = {
  walkAll: (visit: (fiber: Fiber) => void, options?: { limit?: number }) => void;
  fiberInfo: (fiber: Fiber) => FiberInfo | null;
  [key: string]: unknown;
};

export type RememberFiber = (fiber: Fiber) => string | number;

export type FindFibersFilters = {
  name?: string;
  file?: string;
  testid?: string;
  text?: string;
  prop?: string;
  /** Regex searched in props, hook state, and (opt-in) useDebugValue labels. */
  grep?: string;
  /** Comma-separated grep scopes: props, state, debug, or all. Default props,state. */
  in?: string | string[];
  /** Object depth searched below each scope root. */
  depth?: number | string;
  max?: number | string;
} | null | undefined;

export type FindFibersDeps = {
  /** Debug-value replay; defaults to the stub-dispatcher replay. */
  replay?: ReplayForGrep;
  /** Upper bound on component replays for the `debug` grep scope. */
  maxReplays?: number;
};

export type GetComputedStyleFn = (el: Element) => CSSStyleDeclaration;

// ─── evalElementDom ──────────────────────────────────────────────────────

export function evalElementDom(
  element: Element | null | undefined,
  parentLevel: number | string | null | undefined,
  getComputedStyle: GetComputedStyleFn,
): unknown {
  let el: Element | null = element || null;
  if (!el || el.nodeType !== 1) return { error: 'Target element is not available' };

  const level = Number(parentLevel) || 0;
  for (let i = 0; i < level; i++) {
    if (!el.parentElement) return { error: 'parentLevel ' + level + ' exceeds DOM depth (stopped at ' + i + ')' };
    el = el.parentElement;
  }

  const tag = el.tagName.toLowerCase();
  const innerText = ((el as HTMLElement).innerText || '').slice(0, 300);
  const innerHTML = el.innerHTML.slice(0, 500);

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'class') continue;
    attrs[attr.name] = attr.value.slice(0, 120);
  }

  const cs = getComputedStyle(el);
  const styles = {
    display: cs.display,
    visibility: cs.visibility,
    color: cs.color,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    backgroundColor: cs.backgroundColor,
    cursor: cs.cursor,
  };

  const parents: Array<{ tag: string; testId: string | null; id: string | null }> = [];
  let p: Element | null = el.parentElement;
  for (let i = 0; i < 3 && p; i++) {
    parents.push({
      tag: p.tagName.toLowerCase(),
      testId: p.getAttribute('data-testid') || null,
      id: p.id || null,
    });
    p = p.parentElement;
  }

  return { tag, innerText, innerHTML, attrs, styles, parents };
}

// ─── evalFiberProps ──────────────────────────────────────────────────────

export function evalFiberProps(
  baseFiber: Fiber | null | undefined,
  ownerIndex: number | null | undefined,
  getHookSummary: GetHookSummary | null | undefined,
  resolveOwnerFiber: ResolveOwnerFiber,
): unknown {
  const targetFiber = ownerIndex == null ? baseFiber : resolveOwnerFiber(baseFiber as Fiber, ownerIndex as number);
  if (!targetFiber) return { error: 'Target fiber not available for ownerIndex ' + ownerIndex };

  const props = (targetFiber.memoizedProps || {}) as Record<string, unknown>;
  const name = readComponentName(targetFiber.type) || 'Unknown';
  const hookSummary = getHookSummary
    ? getHookSummary(targetFiber)
    : { hookCount: null, hookCountTruncated: false, hookCountMax: null };

  const pod: Record<string, unknown> = {};
  const nonPod: Array<{ prop: string; type: string; ref: string; terminatesAt: unknown }> = [];
  let refCounter = 0;

  // Production builds have no debug owners; trace through component parents
  // instead, which can still show where a passed-down reference stops.
  const { ownerStackKind, fibers: ownerFibersChain } = collectOwnerFibers<Fiber>(
    targetFiber,
    (candidate, kind) => kind === 'owners' || isComponentFiber(candidate),
  );

  for (const [k, v] of Object.entries(props)) {
    if (k === 'children') continue;
    if (v === null || v === undefined) { pod[k] = v; continue; }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { pod[k] = v; continue; }

    refCounter++;
    const ref = 'REF' + refCounter;
    const type = Array.isArray(v) ? 'array' : typeof v;

    let terminatesAt: unknown = null;
    for (let i = 0; i < ownerFibersChain.length; i++) {
      const ownerProps = (ownerFibersChain[i].memoizedProps || {}) as Record<string, unknown>;
      const hasRef = Object.values(ownerProps).some((pv) => pv === v);
      if (!hasRef) {
        const prevType = i > 0 ? ownerFibersChain[i - 1].type : null;
        terminatesAt = i === 0
          ? { ownerIndex: -1, name: name + ' (probe component)' }
          : { ownerIndex: i - 1, name: readComponentName(prevType) || 'Unknown' };
        break;
      }
      if (i === ownerFibersChain.length - 1) {
        terminatesAt = { ownerIndex: i, name: readComponentName(ownerFibersChain[i].type) || 'Unknown', note: 'last known owner' };
      }
    }
    if (!terminatesAt) {
      terminatesAt = { ownerIndex: -1, name: name + ' (no owner chain or not traced)' };
    }

    nonPod.push({ prop: k, type, ref, terminatesAt });
  }

  const children = props.children;
  let childrenSummary: unknown = null;
  if (children !== undefined) {
    if (children === null) childrenSummary = null;
    else if (typeof children === 'string') childrenSummary = { type: 'string', value: children.slice(0, 60) };
    else if (typeof children === 'number' || typeof children === 'boolean') childrenSummary = { type: typeof children, value: children };
    else if (Array.isArray(children)) childrenSummary = { type: 'array', length: children.length };
    else if (typeof children === 'object') childrenSummary = { type: 'element' };
    else childrenSummary = { type: typeof children };
  }

  return { name, ownerIndex: ownerIndex ?? null, ownerStackKind, ...hookSummary, pod, nonPod, children: childrenSummary };
}

// ─── evalFiberPropValue ──────────────────────────────────────────────────

export function evalFiberPropValue(
  baseFiber: Fiber | null | undefined,
  propName: string | null | undefined,
  ownerIndex: number | null | undefined,
  getHookSummary: GetHookSummary | null | undefined,
  resolveOwnerFiber: ResolveOwnerFiber,
  safeSerialize: SafeSerialize,
): unknown {
  if (!propName) return { error: 'prop name required' };
  const targetFiber = ownerIndex == null ? baseFiber : resolveOwnerFiber(baseFiber as Fiber, ownerIndex as number);
  if (!targetFiber) return { error: 'Target fiber not available for ownerIndex ' + ownerIndex };

  const props = (targetFiber.memoizedProps || {}) as Record<string, unknown>;
  const name = readComponentName(targetFiber.type) || 'Unknown';
  const hookSummary = getHookSummary
    ? getHookSummary(targetFiber)
    : { hookCount: null, hookCountTruncated: false, hookCountMax: null };

  if (!(propName in props)) return { error: 'Prop "' + propName + '" not found on ' + name + '. Available: ' + Object.keys(props).join(', ') };

  const value = props[propName];
  const seen = new Set<unknown>();

  function serializeProp(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'function') return '[function' + ((v as { name?: string }).name ? ':' + (v as { name?: string }).name : '') + ']';
    if (typeof v === 'symbol') return '[symbol:' + v.toString() + ']';
    if (Array.isArray(v)) {
      if (v.length === 0) return [];
      return v.slice(0, 5).map((item) => safeSerialize(item, 0, new Set())).concat(v.length > 5 ? ['[…' + (v.length - 5) + ' more]'] : []);
    }
    if (typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      const result: Record<string, unknown> = {};
      for (const k of keys.slice(0, 12)) {
        try { result[k] = safeSerialize(obj[k], 0, new Set()); } catch { result[k] = '[error]'; }
      }
      if (keys.length > 12) result['…'] = '[' + (keys.length - 12) + ' more keys]';
      return result;
    }
    return String(v);
  }

  return {
    name,
    ownerIndex: ownerIndex ?? null,
    ...hookSummary,
    prop: propName,
    type: Array.isArray(value) ? 'array' : typeof value,
    value: serializeProp(value),
  };
}

// ─── evalFindFibers ──────────────────────────────────────────────────────


/** Build a case-insensitive filter regex, naming the flag when the pattern is invalid. */
function filterRegex(pattern: unknown, flag: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(String(pattern), 'i');
  } catch (e) {
    throw new Error('Invalid --' + flag + ' regex: ' + ((e as Error)?.message || String(e)));
  }
}
export function evalFindFibers(
  filters: FindFibersFilters,
  helpers: ScriptHelpers,
  rememberFiber: RememberFiber,
  deps: FindFibersDeps = {},
): { count: number; items: Array<Record<string, unknown>>; [key: string]: unknown } {
  let nameRe: RegExp | null, fileRe: RegExp | null, testIdRe: RegExp | null, textRe: RegExp | null;
  try {
    nameRe = filterRegex(filters?.name, 'name');
    fileRe = filterRegex(filters?.file, 'file');
    testIdRe = filterRegex(filters?.testid, 'testid');
    textRe = filterRegex(filters?.text, 'text');
  } catch (e) {
    return { ok: false, count: 0, items: [], error: (e as Error).message };
  }
  const propName = filters?.prop ? String(filters.prop) : null;
  const max = Number.isFinite(Number(filters?.max)) ? Math.max(1, Math.floor(Number(filters?.max))) : 50;
  const matches: Array<Record<string, unknown>> = [];

  let grepRe: RegExp | null;
  try {
    grepRe = filterRegex(filters?.grep, 'grep');
  } catch (e) {
    return { ok: false, count: 0, items: [], error: (e as Error).message };
  }
  const { scopes, error: scopeError } = parseGrepScopes(filters?.in);
  if (grepRe && scopeError) return { ok: false, count: 0, items: [], error: scopeError };
  const depth = Number(filters?.depth);
  const limits = {
    ...DEFAULT_GREP_LIMITS,
    ...(Number.isFinite(depth) && depth > 0 ? { depth: Math.min(12, Math.floor(depth)) } : {}),
  };
  const wantsDebug = scopes.includes('debug');
  const replay: ReplayForGrep = deps.replay || (replayComponentHooks as unknown as ReplayForGrep);
  const maxReplays = deps.maxReplays ?? 300;
  const grepStats = { scanned: 0, debugCandidates: 0, replayed: 0, replayFailed: 0, replaySkipped: 0 };
  let truncated = false;

  helpers.walkAll((fiber) => {
    if (matches.length >= max) { truncated = true; return; }
    const info = helpers.fiberInfo(fiber);
    if (!info?.name) return;
    if (nameRe && !nameRe.test(info.name)) return;
    if (fileRe && !fileRe.test(info.source?.fileName || '')) return;
    if (testIdRe && !testIdRe.test(info.domTestId || '')) return;
    if (textRe && !textRe.test(info.domText || '')) return;
    if (propName) {
      const props = fiber?.memoizedProps;
      if (!props || typeof props !== 'object' || !(propName in props)) return;
    }
    let hits: GrepHit[] | null = null;
    let replayInfo: { status: string; error?: string } | undefined;
    if (grepRe) {
      grepStats.scanned += 1;
      const debugCandidate = callsUseDebugValue(fiber);
      if (debugCandidate) grepStats.debugCandidates += 1;
      const canReplay = wantsDebug && debugCandidate && grepStats.replayed < maxReplays;
      if (wantsDebug && debugCandidate && !canReplay) grepStats.replaySkipped += 1;
      const result = grepFiber(fiber, grepRe, scopes, limits, canReplay ? replay : null);
      if (result.replay) {
        grepStats.replayed += 1;
        if (result.replay.status !== 'complete') grepStats.replayFailed += 1;
        replayInfo = result.replay;
      }
      if (!result.hits.length) return;
      hits = result.hits;
    }
    const fiberId = rememberFiber(fiber);
    matches.push({
      fiberId,
      ...info,
      ...(hits ? { hits, hitsTruncated: hits.length >= limits.maxHits } : {}),
      ...(replayInfo && replayInfo.status !== 'complete' ? { replay: replayInfo } : {}),
    });
  }, { limit: 200000 });

  if (!grepRe) return { count: matches.length, items: matches };
  return {
    count: matches.length,
    items: matches,
    truncated,
    grep: {
      pattern: String(filters?.grep),
      scopes,
      depth: limits.depth,
      ...grepStats,
      ...(!wantsDebug && grepStats.debugCandidates
        ? { note: grepStats.debugCandidates + ' scanned fibers call useDebugValue; add debug to --in to search their labels (replays those components).' }
        : {}),
    },
  };
}

// ─── resolveFindFiberSources ─────────────────────────────────────────────

/**
 * Replace each `find-fibers` item's synchronous source with the source-mapped
 * one. The walk reads sources synchronously; React 19 call sites and shifted
 * React <=18 `_debugSource` lines need the served module's map first.
 */
export async function resolveFindFiberSources<S>(
  items: Array<Record<string, unknown>>,
  getFiber: (fiberId: string) => Fiber | null | undefined,
  resolve: (fiber: Fiber) => Promise<S | null>,
): Promise<void> {
  await Promise.all(items.map(async (item) => {
    const fiber = item.fiberId == null ? null : getFiber(String(item.fiberId));
    if (!fiber) return;
    try {
      const source = await resolve(fiber);
      if (source) item.source = source;
    } catch {}
    applyRecoveredOrigin(item, fiber.type);
  }));
}

/** Default time budget for recovering production names before a name filter. */
export const NAME_RECOVERY_BUDGET_MS = 3000;

/**
 * Before `find-fibers --name` on a production build, recover authored names
 * for the page's component types so the filter matches them. Returns null
 * when there is no name filter or every component has development metadata.
 */
export function warmFindFiberNames(
  filters: FindFibersFilters,
  helpers: Pick<ScriptHelpers, 'walkAll'>,
  budgetMs = NAME_RECOVERY_BUDGET_MS,
): Promise<NameRecoveryStats | null> {
  if (!filters?.name) return Promise.resolve(null);
  return warmComponentNames(
    (visit) => helpers.walkAll((fiber) => visit(fiber as Parameters<typeof visit>[0]), { limit: 200000 }),
    budgetMs,
  );
}
