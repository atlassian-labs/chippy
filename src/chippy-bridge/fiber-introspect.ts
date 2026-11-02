/**
 * Fiber introspection helpers — extracted byte-for-byte from chippy-page-bridge.js.
 *
 * Source: .agents/skills/chippy/extension/chippy-page-bridge.js
 *   - safeJson                (lines 539–559)
 *   - resolveOwnerFiber       (lines 774–788)
 *   - findFiberByName         (lines 908–918)
 *   - inspectFiberOwners      (lines 997–1009; bridge fn name evalInspectFiberOwners)
 *   - inspectFiberStructure   (lines 858–900; bridge fn name evalInspectFiberStructure)
 *
 * Mechanical extraction rules:
 *   - Bodies copied verbatim. Logic, branch order, string literals untouched.
 *   - Closure-bound deps (`buildScriptHelpers`, `getRememberedFiber`,
 *     `replayComponentHooks`, `evalFiberHooks`) become explicit parameters.
 *     The bridge supplies them at call time.
 */

// These helpers are transport-safe read paths. They may inspect React's
// private fiber objects, but they must not mutate fibers or execute product
// callbacks; active behavior belongs to fiber-invoke and explicit stimuli.
import type { Fiber, ScriptHelpers } from './eval-helpers';

// ─── safeJson ────────────────────────────────────────────────────────────

export function safeJson(value: unknown, depth: number = 6, seen: WeakSet<object> = new WeakSet()): unknown {
  // Fiber graphs contain cycles and functions, so JSON.stringify is not a
  // safe transport boundary. The depth/item caps make diagnostics terminate
  // even for unusually large props or recursive application objects.
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function') return '[Function ' + ((value as { name?: string }).name || 'anonymous') + ']';
  if (t === 'symbol' || t === 'bigint') return String(value);
  if (depth <= 0) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.slice(0, 200).map((v) => safeJson(v, depth - 1, seen));
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const k of Object.keys(value as object)) {
      if (n++ > 200) { out._truncated = true; break; }
      try { out[k] = safeJson((value as Record<string, unknown>)[k], depth - 1, seen); } catch (_) { out[k] = '[Unserializable]'; }
    }
    return out;
  }
  return String(value);
}

// ─── resolveOwnerFiber ───────────────────────────────────────────────────

export function resolveOwnerFiber(baseFiber: Fiber | null | undefined, ownerIndex: number | string | null | undefined): Fiber | null {
  let f: Fiber | null = baseFiber?._debugOwner || null;
  let count = 0;
  const target = ownerIndex != null ? Number(ownerIndex) : null;
  while (f) {
    const t = f.type as { $$typeof?: unknown; render?: unknown } | unknown;
    const isComponent =
      typeof t === 'function' ||
      (typeof t === 'object' && t !== null && ((t as { $$typeof?: unknown }).$$typeof || (t as { render?: unknown }).render));
    if (isComponent) {
      if (target !== null && count === target) return f;
      count++;
    }
    f = f._debugOwner || null;
  }
  return null;
}

// ─── findFiberByName ─────────────────────────────────────────────────────

export function findFiberByName(name: string, helpers: ScriptHelpers): Fiber | null {
  const re = new RegExp('^' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  let found: Fiber | null = null;
  helpers.walkAll((fiber: Fiber) => {
    if (found) return;
    const info = helpers.fiberInfo(fiber);
    if (info?.name && re.test(info.name)) found = fiber;
  }, { limit: 200000 });
  return found;
}

// ─── inspectFiberOwners ──────────────────────────────────────────────────

export function inspectFiberOwners(fiber: Fiber, fiberId: string | number, helpers: ScriptHelpers): unknown {
  const owners: Array<Record<string, unknown>> = [];
  let owner: Fiber | null = fiber._debugOwner || null;
  let idx = 0;
  while (owner && idx < 100) {
    owners.push({ ownerIndex: idx, ...(helpers.fiberInfo(owner) || {}) });
    owner = owner._debugOwner || null;
    idx++;
  }
  return { fiberId: String(fiberId), count: owners.length, items: owners };
}

// ─── inspectFiberStructure ───────────────────────────────────────────────
// Mirrors evalInspectFiberStructure from the bridge. Replay/hookCount are
// supplied by the caller via injected `replayComponentHooks` and
// `evalFiberHooks` (both bundled separately in __AVALANCHE__.replay).

type ReplayResult = {
  componentName: string;
  records: Array<{ index: number; primitive: string; value?: unknown; path?: Array<{ name: string }>; debugLabel?: unknown }>;
  replayAttempted: boolean;
  replayError?: string | null;
  replayErrorDetails?: unknown;
  replayStatus?: string;
};

type ReplayFn = (fiber: Fiber) => ReplayResult;
type EvalFiberHooksFn = (fiber: Fiber) => { hookCount: number };

export function inspectFiberStructure(
  fiber: Fiber,
  fiberId: string | number,
  hookIndex: number | string,
  windowSize: number | string | null | undefined,
  replayComponentHooks: ReplayFn,
  evalFiberHooks: EvalFiberHooksFn,
): unknown {
  const { componentName, records, replayAttempted, replayError, replayErrorDetails, replayStatus } = replayComponentHooks(fiber);
  const targetIndex = Number(hookIndex);
  const target = records.find((r) => r.index === targetIndex);
  const liveHookCount = evalFiberHooks(fiber).hookCount;
  const warnings: string[] = [];
  if (!replayAttempted) warnings.push('fiber-only fallback: component functions were not executed');
  if (replayError) warnings.push('structure-render error: ' + replayError);

  if (!target) {
    return { ok: false, status: 'hook-not-found', componentName, fiberId: String(fiberId), requestedHookIndex: targetIndex, hookCount: liveHookCount, liveHookCount, replayedHookCount: 0, replayStatus: 'not-run-fiber-only', captureEngineOk: true, warnings };
  }

  const radius = Math.max(0, Number(windowSize) || 3);
  const folderRecs = records.filter((r) => Math.abs(r.index - targetIndex) <= radius);
  const lines = [componentName];
  for (const r of folderRecs) {
    const mark = r.index === targetIndex ? ' ← target' : '';
    lines.push('└─ hook ' + r.index + ' ' + r.primitive + mark);
  }

  return {
    ok: true,
    status: 'ok',
    componentName,
    fiberId: String(fiberId),
    requestedHookIndex: targetIndex,
    hookCount: liveHookCount,
    liveHookCount,
    replayedHookCount: 0,
    replayStatus: replayStatus || 'fiber-only-fallback',
    text: lines.join('\n'),
    target: { hookId: target.index, type: target.primitive, value: target.value, parents: (target.path || []).map((p) => p.name).concat([componentName]), parentsWithLoc: target.path || [], debugLabel: target.debugLabel },
    folder: folderRecs.map((r) => ({ hookId: r.index, type: r.primitive, value: r.value, target: r.index === targetIndex, path: r.path || [], debugLabel: r.debugLabel })),
    captureEngineOk: !!replayAttempted,
    warnings,
    replayError: replayError || undefined,
    replayErrorDetails: replayErrorDetails || undefined,
  };
}
