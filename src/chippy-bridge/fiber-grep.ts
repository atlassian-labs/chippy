/**
 * Fiber value grep — search one fiber's runtime data for a pattern.
 *
 * Scopes:
 *   - `props`: memoized props, walked deeply (keys, primitive values, and
 *     function names). React elements, DOM nodes, and fibers are not entered:
 *     each element becomes its own fiber, which the page walk visits anyway.
 *   - `state`: committed hook slots read straight from the fiber (useState,
 *     useReducer, useRef, useMemo/useCallback values, effect deps,
 *     useSyncExternalStore snapshots) and class component `state`. Nothing is
 *     executed.
 *   - `debug`: `useDebugValue` labels. React does not store them on the fiber,
 *     so they are only readable by replaying the component render with a stub
 *     dispatcher. The caller opts in, and only fibers whose dev-build
 *     `_debugHookTypes` list `useDebugValue` are replayed.
 */

import { classifyHook, type HookNode, type HookRecord } from '../debug-render/replay';

export const GREP_SCOPES = ['props', 'state', 'debug'] as const;
export type GrepScope = typeof GREP_SCOPES[number];
export const DEFAULT_GREP_SCOPES: GrepScope[] = ['props', 'state'];

export type GrepHit = {
  scope: GrepScope;
  /** Dotted path from the scope root, e.g. `props.issue.key` or `hook[2:State].user.name`. */
  path: string;
  /** `key` when the property name matched, `value` when the value matched. */
  match: 'key' | 'value';
  /** Short preview of the matched value. */
  value: string;
  /** Custom-hook ancestry for a debug label (outermost → innermost). */
  hookPath?: string[];
};

export type GrepLimits = {
  /** Maximum object depth below the scope root. */
  depth: number;
  /** Maximum hits recorded per fiber. */
  maxHits: number;
  /** Maximum values visited per scope root, bounding cost on huge objects. */
  maxNodes: number;
  /** Maximum array/Map/Set entries visited per collection. */
  maxEntries: number;
};

export const DEFAULT_GREP_LIMITS: GrepLimits = { depth: 4, maxHits: 10, maxNodes: 2000, maxEntries: 50 };

type Fiber = {
  tag?: unknown;
  type?: unknown;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  _debugHookTypes?: unknown;
  [key: string]: unknown;
};

export type ReplayForGrep = (fiber: Fiber) => { records: HookRecord[]; replayStatus?: string; replayError?: string };

export function parseGrepScopes(raw: unknown): { scopes: GrepScope[]; error?: string } {
  if (raw == null || raw === '') return { scopes: [...DEFAULT_GREP_SCOPES] };
  const parts = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((part) => String(part).trim().toLowerCase())
    .filter(Boolean);
  const scopes: GrepScope[] = [];
  for (const part of parts) {
    const scope = part === 'all' ? null : part === 'hooks' ? 'state' : part;
    if (scope === null) return { scopes: [...GREP_SCOPES] };
    if (!(GREP_SCOPES as readonly string[]).includes(scope)) {
      return { scopes: [], error: 'Unknown grep scope "' + part + '". Use props, state, debug, or all.' };
    }
    if (!scopes.includes(scope as GrepScope)) scopes.push(scope as GrepScope);
  }
  return { scopes: scopes.length ? scopes : [...DEFAULT_GREP_SCOPES] };
}

function preview(value: unknown): string {
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
  if (typeof value === 'function') return '[function' + ((value as { name?: string }).name ? ':' + (value as { name?: string }).name : '') + ']';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return value.toString() + 'n';
  if (Array.isArray(value)) return '[array:' + value.length + ']';
  if (value && typeof value === 'object') return '[object]';
  return String(value);
}

/** Text a primitive or function contributes to a match; null when not matchable. */
function matchText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return (value as { displayName?: string; name?: string }).displayName || (value as { name?: string }).name || null;
  return null;
}

function isOpaque(value: object): boolean {
  const v = value as Record<string, unknown>;
  // React elements and portals: their props live on their own fibers.
  if ('$$typeof' in v) return true;
  // DOM nodes and windows.
  if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return true;
  if (v.window === v) return true;
  // Fibers reached through refs or stateNode back-pointers.
  if ('stateNode' in v && 'return' in v && 'child' in v) return true;
  return false;
}

function joinPath(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? base + '.' + key : base + '[' + JSON.stringify(key) + ']';
}

/**
 * Walk `root` and record hits for `re`. Keys and leaf values both match; an
 * object value matches only through its contents.
 */
export function grepValue(
  root: unknown,
  re: RegExp,
  scope: GrepScope,
  rootPath: string,
  limits: GrepLimits,
  hits: GrepHit[],
  skipRootKeys: ReadonlySet<string> = new Set(),
): void {
  const seen = new Set<object>();
  let nodes = 0;

  function record(hit: GrepHit): boolean {
    hits.push(hit);
    return hits.length < limits.maxHits;
  }

  function visit(value: unknown, path: string, depth: number): boolean {
    if (hits.length >= limits.maxHits || nodes >= limits.maxNodes) return false;
    nodes += 1;
    const text = matchText(value);
    if (text !== null) {
      re.lastIndex = 0;
      if (re.test(text)) return record({ scope, path, match: 'value', value: preview(value) });
      return true;
    }
    if (!value || typeof value !== 'object') return true;
    if (seen.has(value) || isOpaque(value) || depth >= limits.depth) return true;
    seen.add(value);

    const entries: Array<[string, unknown]> = [];
    if (Array.isArray(value)) {
      value.slice(0, limits.maxEntries).forEach((item, i) => entries.push(['[' + i + ']', item]));
    } else if (value instanceof Map) {
      let i = 0;
      for (const [k, v] of value) {
        if (i++ >= limits.maxEntries) break;
        entries.push([typeof k === 'string' ? k : '<' + preview(k) + '>', v]);
      }
    } else if (value instanceof Set) {
      let i = 0;
      for (const v of value) {
        if (i >= limits.maxEntries) break;
        entries.push(['[' + i++ + ']', v]);
      }
    } else {
      let keys: string[];
      try { keys = Object.keys(value); } catch { return true; }
      for (const k of keys.slice(0, limits.maxEntries)) {
        if (depth === 0 && skipRootKeys.has(k)) continue;
        let child: unknown;
        try { child = (value as Record<string, unknown>)[k]; } catch { continue; }
        entries.push([k, child]);
      }
    }

    for (const [key, child] of entries) {
      const childPath = key.startsWith('[') ? path + key : joinPath(path, key);
      if (!key.startsWith('[')) {
        re.lastIndex = 0;
        if (re.test(key) && !record({ scope, path: childPath, match: 'key', value: preview(child) })) return false;
      }
      if (!visit(child, childPath, depth + 1)) return false;
    }
    return true;
  }

  visit(root, rootPath, 0);
}

const CLASS_COMPONENT_TAG = 1;
const HOST_TAGS = new Set([5, 6, 26, 27]);

/** Committed hook slots as `[label, value]` pairs, read without execution. */
export function hookSlots(fiber: Fiber): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  if (fiber.tag === CLASS_COMPONENT_TAG || HOST_TAGS.has(fiber.tag as number)) return out;
  const seen = new Set<unknown>();
  let node = fiber.memoizedState as HookNode | null | undefined;
  let index = 0;
  while (node && typeof node === 'object' && !seen.has(node) && 'next' in node) {
    seen.add(node);
    const tag = classifyHook(node, index).tag;
    const ms = node.memoizedState as unknown;
    const label = 'hook[' + index + ':' + tag + ']';
    if (tag === 'Effect') {
      const deps = (ms as { deps?: unknown } | null)?.deps;
      if (Array.isArray(deps)) out.push([label + '.deps', deps]);
    } else if (tag === 'Ref') {
      out.push([label + '.current', (ms as { current: unknown }).current]);
    } else if (tag === 'Memo') {
      out.push([label, (ms as [unknown, unknown])[0]]);
    } else {
      out.push([label, ms]);
    }
    node = node.next as HookNode | null | undefined;
    index += 1;
  }
  return out;
}

/** Whether a dev-build fiber records a `useDebugValue` call. */
export function callsUseDebugValue(fiber: Fiber): boolean {
  const types = fiber._debugHookTypes;
  return Array.isArray(types) && types.includes('useDebugValue');
}

export type FiberGrepResult = { hits: GrepHit[]; replay?: { status: string; error?: string } };

export function grepFiber(
  fiber: Fiber,
  re: RegExp,
  scopes: readonly GrepScope[],
  limits: GrepLimits,
  replay: ReplayForGrep | null,
): FiberGrepResult {
  const hits: GrepHit[] = [];
  let replayInfo: FiberGrepResult['replay'];

  if (scopes.includes('props')) {
    const props = fiber.memoizedProps;
    if (typeof props === 'string') grepValue(props, re, 'props', 'text', limits, hits);
    else grepValue(props, re, 'props', 'props', limits, hits);
  }

  if (scopes.includes('state') && hits.length < limits.maxHits) {
    if (fiber.tag === CLASS_COMPONENT_TAG) {
      grepValue(fiber.memoizedState, re, 'state', 'state', limits, hits);
    } else {
      for (const [label, value] of hookSlots(fiber)) {
        if (hits.length >= limits.maxHits) break;
        grepValue(value, re, 'state', label, limits, hits);
      }
    }
  }

  if (scopes.includes('debug') && replay && hits.length < limits.maxHits && callsUseDebugValue(fiber)) {
    let result: ReturnType<ReplayForGrep> | null = null;
    try { result = replay(fiber); } catch (e) {
      replayInfo = { status: 'failed', error: (e as Error)?.message || String(e) };
    }
    if (result) {
      replayInfo = { status: result.replayStatus || 'unknown', ...(result.replayError ? { error: result.replayError } : {}) };
      for (const rec of result.records) {
        if (rec.debugLabel === undefined || hits.length >= limits.maxHits) continue;
        const hookPath = (rec.path || []).map((frame) => frame.name);
        const before = hits.length;
        const label = 'debug' + (hookPath.length ? '(' + hookPath.join('>') + ')' : '');
        grepValue(rec.debugLabel, re, 'debug', label, limits, hits);
        for (let i = before; i < hits.length; i++) hits[i].hookPath = hookPath;
      }
    }
  }

  return { hits, ...(replayInfo ? { replay: replayInfo } : {}) };
}
