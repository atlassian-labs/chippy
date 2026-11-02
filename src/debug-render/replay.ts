/**
 * Replay engine — re-executes a committed React fiber's render function
 * against its already-committed hook state, WITHOUT triggering any React
 * scheduler activity.
 *
 * This is the inspector half of the debug-render module.  The recording half
 * (dispatcher interception during live renders) lives in core.ts.
 *
 * Strategy
 * --------
 * 1. Walk the fiber's memoizedState linked list to collect committed hook
 *    nodes in order (the "fiber-only" path — always available).
 * 2. Attempt to re-execute the component's render function with a stub
 *    dispatcher that returns each committed hook value in order.  This
 *    surfaces custom-hook ancestry through call-stack frames.
 * 3. If replay is not possible (class component, dispatcher busy, React in
 *    flight) fall back to fiber-only records.
 *
 * No React import.  No bridge globals.  Pure functions + a single runtime
 * seam (getDispatcherRef) that is injected via globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.
 */

import { parseStackFrames, type StackFrame } from './core';
import { readContextValueFromFiber, type ContextFiber } from './context-replay';
// Renderer discovery is shared with the fiber-schedule-update capability — one
// place knows how to enumerate __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.
import { getDispatcherRef } from '../chippy-bridge/react-renderer';
export { getDispatcherRef, readContextValueFromFiber };

// ---------------------------------------------------------------------------
// Fiber shape — minimal surface, not the full internal type
// ---------------------------------------------------------------------------

/** A React fiber node (minimal shape we need). */
export type Fiber = ContextFiber & {
  memoizedState?: HookNode | null;
  ref?: unknown;
  _debugSource?: { fileName?: string; lineNumber?: number } | null;
};

/** One node in the memoizedState linked list. */
export type HookNode = {
  memoizedState: unknown;
  queue: unknown;
  next?: HookNode | null;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type HookRecord = {
  id: number | string;
  index: number | null;
  primitive: string;
  value: unknown;
  path: StackFrame[];
  source: null;
  fiberOnly: boolean;
  debugLabel?: unknown;
};

export type ClassifiedHook = {
  index: number;
  tag: string;
  value?: unknown;
  current?: unknown;
  deps?: string;
  hasCleanup?: boolean;
  hasQueue?: boolean;
  note?: string;
};

export type FiberHooksResult = {
  name: string;
  hookCount: number;
  truncated: boolean;
  maxHooks: number;
  hooks: ClassifiedHook[];
  error?: string;
};

export type ReplayResult = {
  componentName: string;
  records: HookRecord[];
  replayAttempted: boolean;
  replayError: string;
  replayErrorDetails: ErrorPayload | null;
  replayStatus: 'complete' | 'partial-replay' | 'fiber-only-fallback';
  __debugCursor?: number;
  __debugTail?: HookRecord[];
};

export type ErrorPayload = {
  name: string;
  message: string;
  stack: string;
};

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function noop(): void {}

/**
 * Serialize a value shallowly for safe JSON transport.
 * depth=0 → one level of object/array; functions/symbols become strings.
 */
export function safeSerialize(value: unknown, depth: number = 0, seen: Set<unknown> = new Set()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[function' + (value.name ? ':' + value.name : '') + ']';
  if (typeof value === 'symbol') return '[symbol:' + value.toString() + ']';
  if (Array.isArray(value)) return '[array:' + value.length + ']';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    if (depth >= 1) return '[object]';
    seen.add(value);
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value as object).slice(0, 8);
    for (const k of keys) {
      try { result[k] = safeSerialize((value as Record<string, unknown>)[k], depth + 1, seen); } catch { result[k] = '[error]'; }
    }
    const total = Object.keys(value as object).length;
    if (total > 8) result['…'] = '[' + (total - 8) + ' more]';
    return result;
  }
  return String(value);
}

export function replayErrorPayload(e: unknown): ErrorPayload | null {
  if (!e) return null;
  const err = e as Partial<Error>;
  return {
    name: err.name || 'Error',
    message: err.message || String(e),
    stack: err.stack || '',
  };
}

export function logReplayError(label: string, componentName: string, err: unknown): void {
  const payload = replayErrorPayload(err);
  if (!payload) return;
  try {
    console.error('[Chippy replay-error] ' + label + ' ' + componentName, payload.stack || (payload.name + ': ' + payload.message), payload);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Hook classification — reads committed fiber node shape
// ---------------------------------------------------------------------------

/**
 * classifyHook
 * ------------
 * Single purpose: tell `consumeSlot` which structural FAMILY a fiber hook
 * slot belongs to, so cursor drift can be detected when the dispatcher's
 * called primitive does not match the stored slot.
 *
 * 5 families (and nothing else):
 *   - "State"  — slot has queue.dispatch (useState, useReducer, useTransition's
 *                 internal isPending queue)
 *   - "Ref"    — memoizedState is a plain own-property `{ current: x }` and
 *                 queue is null  (useRef)
 *   - "Memo"   — memoizedState is a 2-tuple `[value, deps|null]` and queue is
 *                 null  (useMemo, useCallback)
 *   - "Effect" — memoizedState is a real React Effect node:
 *                 numeric `tag`, function `create`, `next` is self-referential
 *                 (circular ring)  (useEffect family + useImperativeHandle)
 *   - "Value"  — slot is consumed but the dispatcher does not push onto a
 *                 dispatch queue: useId (string), useDeferredValue (raw value),
 *                 useSyncExternalStore (raw value with non-dispatch queue)
 *
 * `useContext` is intentionally not a family — it does not consume a slot in
 * memoizedState. So no real fiber slot can ever be a context.
 *
 * Heuristic ordering matters: queue.dispatch is the strongest signal and
 * dominates the value's structural shape. After that we use STRUCTURAL
 * own-property checks (no inheritance fallthrough), and we require Effect
 * nodes to look like real React Effect nodes (tag + create + circular next).
 */
export function classifyHook(hookNode: HookNode, index: number): ClassifiedHook {
  const ms = hookNode.memoizedState;
  const queue = hookNode.queue as { dispatch?: unknown } | null | undefined;
  const base = { index };

  // 1. State family — strongest signal, dominates value shape.
  if (queue && typeof queue.dispatch === 'function') {
    return { ...base, tag: 'State', value: safeSerialize(ms, 0, new Set()) };
  }

  // 2. Effect family — must look like a real React Effect node:
  //    numeric tag + function create + circular self-referential next.
  if (isEffectNode(ms)) {
    const m = ms as { create?: unknown; destroy?: unknown; deps?: unknown };
    return {
      ...base,
      tag: 'Effect',
      deps: Array.isArray(m.deps) ? '[array:' + (m.deps as unknown[]).length + ']'
          : m.deps === null ? 'null'
          : String(m.deps),
      hasCleanup: typeof m.destroy === 'function',
    };
  }

  // 3. Ref family — plain object with OWN-property `current`, queue null.
  if (
    !queue &&
    ms !== null &&
    typeof ms === 'object' &&
    Object.prototype.hasOwnProperty.call(ms, 'current')
  ) {
    return { ...base, tag: 'Ref', current: safeSerialize((ms as { current: unknown }).current, 0, new Set()) };
  }

  // 4. Memo family — 2-tuple [value, deps|null], queue null.
  //    Both useMemo and useCallback land here. deps may be an array OR null
  //    (run-every-render). Anything else in slot[1] disqualifies.
  if (
    !queue &&
    Array.isArray(ms) &&
    (ms as unknown[]).length === 2 &&
    (Array.isArray((ms as unknown[])[1]) || (ms as unknown[])[1] === null)
  ) {
    const arr = ms as [unknown, unknown[] | null];
    const depsTag = arr[1] === null ? 'null' : '[array:' + arr[1].length + ']';
    return {
      ...base,
      tag: 'Memo',
      value: typeof arr[0] === 'function'
        ? '[function' + ((arr[0] as Function).name ? ':' + (arr[0] as Function).name : '') + ']'
        : safeSerialize(arr[0], 0, new Set()),
      deps: depsTag,
    };
  }

  // 5. Value family — slot consumed but no dispatch:
  //    useId (string), useDeferredValue (raw value), useSyncExternalStore.
  //    Identified by the absence of dispatch + the absence of any other
  //    family's structural marker. Both queue=null with a primitive AND
  //    queue=non-dispatch land here.
  if (queue || ms === null || typeof ms !== 'object' || isUnclaimedObject(ms)) {
    return { ...base, tag: 'Value', value: safeSerialize(ms, 0, new Set()) };
  }

  // 6. Anything we cannot classify.
  return {
    ...base,
    tag: 'Unknown',
    hasQueue: !!queue,
    value: safeSerialize(ms, 0, new Set()),
  };
}

/**
 * Real React Effect node check.
 * Real shape (from ReactFiberHooks.pushEffect):
 *   { tag: number, create: function, destroy: function|undefined,
 *     deps: array|null, next: <self-or-other-effect> }
 * The circular `next` is the load-bearing structural marker — no user data
 * shape produces a self-referential next pointer by accident.
 */
function isEffectNode(ms: unknown): boolean {
  if (!ms || typeof ms !== 'object') return false;
  const m = ms as { tag?: unknown; create?: unknown; next?: unknown };
  if (typeof m.tag !== 'number') return false;
  if (typeof m.create !== 'function') return false;
  if (m.next === undefined || m.next === null) return false;
  // The effect ring's `next` must point at an Effect-shaped node (or itself).
  const next = m.next as { tag?: unknown; create?: unknown };
  return typeof next.tag === 'number' && typeof next.create === 'function';
}

/**
 * An object that doesn't fit any known family — used to route oddball
 * useSyncExternalStore-style snapshots into "Value" instead of "Unknown".
 */
function isUnclaimedObject(_ms: unknown): boolean {
  return false; // placeholder; primitives + queue cases already covered above.
}

/**
 * Map a dispatcher-called primitive to its expected slot FAMILY.
 *
 * Drift detection rule: when the dispatcher records primitive P and the slot
 * at the same cursor classifies as family F, drift = (primitiveFamily(P) !== F).
 *
 * Returning `null` means "no slot is consumed" — the call is free to skip
 * the cursor entirely (currently only useContext, but routed via fiber.deps
 * so it never actually reaches consumeSlot).
 */
export function primitiveFamily(primitive: string): string | null {
  switch (primitive) {
    case 'State':
    case 'Reducer':
    case 'Transition':
      return 'State';
    case 'Ref':
      return 'Ref';
    case 'Memo':
    case 'Callback':
      return 'Memo';
    case 'Effect':
    case 'LayoutEffect':
    case 'InsertionEffect':
    case 'ImperativeHandle':
      return 'Effect';
    case 'Id':
    case 'Deferred':
    case 'SyncExternalStore':
      return 'Value';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fiber hook list walking
// ---------------------------------------------------------------------------

const MAX_HOOKS = 500;

export function evalFiberHooks(fiber: Fiber | null | undefined): FiberHooksResult {
  if (!fiber) return { name: 'Unknown', hookCount: 0, truncated: false, maxHooks: MAX_HOOKS, hooks: [], error: 'No fiber available' };

  const type = fiber.type as { displayName?: string; name?: string } | undefined;
  const name = type?.displayName || type?.name || 'Unknown';
  const hooks: ClassifiedHook[] = [];
  const seen = new Set<HookNode>();
  let hookNode = fiber.memoizedState as HookNode | null | undefined;
  let index = 0;
  let truncated = false;

  while (hookNode) {
    if (seen.has(hookNode)) {
      hooks.push({ index, tag: 'Unknown', note: 'cycle detected in hook list' });
      break;
    }
    if (index >= MAX_HOOKS) { truncated = true; break; }
    seen.add(hookNode);
    hooks.push(classifyHook(hookNode, index));
    hookNode = hookNode.next as HookNode | null | undefined;
    index++;
  }

  return { name, hookCount: hooks.length, truncated, maxHooks: MAX_HOOKS, hooks };
}

export function readHookValueFromNode(hookNode: HookNode | null | undefined): unknown {
  if (!hookNode) return undefined;
  return hookNode.memoizedState;
}

export function fiberOnlyHookRecords(fiber: Fiber): HookRecord[] {
  const raw = evalFiberHooks(fiber);
  return (raw.hooks || []).map((hook) => ({
    id: hook.index,
    index: hook.index,
    primitive: hook.tag,
    value: hook.value,
    path: [],
    source: null,
    fiberOnly: true,
    debugLabel: undefined,
  }));
}

// ---------------------------------------------------------------------------
// Stack / custom-hook path helpers
// ---------------------------------------------------------------------------

export const PRIMITIVE_HOOK_NAMES = new Set([
  'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect',
  'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo',
  'useReducer', 'useRef', 'useState', 'useSyncExternalStore', 'useTransition',
  'useId',
]);

/**
 * Given parsed stack frames and the component's name, return the custom-hook
 * ancestry path (outermost → innermost, relative to the component call site).
 */
export function customHookPathFromFrames(frames: StackFrame[], componentName: string): StackFrame[] {
  const compIdx = frames.findIndex((f) => f.name === componentName);
  const relevant = compIdx >= 0 ? frames.slice(0, compIdx) : frames;
  const parentLookup = compIdx >= 0 ? frames.slice(0, compIdx + 1) : frames;
  const out: StackFrame[] = [];
  for (let i = relevant.length - 1; i >= 0; i--) {
    const { name, loc } = relevant[i];
    if (/^use[A-Z0-9_]/.test(name) && !PRIMITIVE_HOOK_NAMES.has(name)) {
      // V8 frame loc for a custom hook frame points at the line *inside that
      // hook* where it called the next inner hook/primitive. That changes for
      // every primitive and fragments one semantic invocation into many folders.
      // The stable invocation location for this hook is the outer/parent frame:
      // where the parent called this custom hook. Keep the component frame in
      // parentLookup so the outermost custom hook can use the component callsite.
      const parent = i + 1 < parentLookup.length ? parentLookup[i + 1] : null;
      out.push({ name, loc: parent ? parent.loc : loc });
    }
  }
  return out;
}

export function customHookPathFromStack(stack: string, componentName: string): StackFrame[] {
  return customHookPathFromFrames(parseStackFrames(stack), componentName);
}

// ---------------------------------------------------------------------------
// Dispatcher ref discovery + idle check
// ---------------------------------------------------------------------------

type DispatcherRef = { current: unknown };

export function isDispatcherIdle(ref: DispatcherRef): boolean {
  const current = ref && ref.current;
  if (!current || typeof current !== 'object') return false;
  const name = (current as { constructor?: { name?: string } }).constructor?.name ?? '';
  return !/HooksDispatcher/i.test(name);
}

// ---------------------------------------------------------------------------
// replayComponentHooks — the main entry point
// ---------------------------------------------------------------------------

/**
 * Re-execute a committed React fiber's render function using a stub dispatcher
 * that returns each committed hook's memoizedState value in order.
 *
 * Returns a `ReplayResult` with per-hook records annotated with custom-hook
 * ancestry paths derived from call-stack frames captured during the replay.
 *
 * Falls back to fiber-only records when replay is not safe (React in flight,
 * dispatcher ref unavailable, component is a class, etc.).
 */
export function replayComponentHooks(fiber: Fiber): ReplayResult {
  const type = fiber?.type as { displayName?: string; name?: string } | undefined;
  const componentName = type?.displayName || type?.name || 'Unknown';
  const fallbackRecords = fiberOnlyHookRecords(fiber);

  const dispatcherRef = getDispatcherRef();
  if (!dispatcherRef) {
    return {
      componentName,
      records: fallbackRecords,
      replayAttempted: false,
      replayError: 'ReactCurrentDispatcher not found',
      replayErrorDetails: null,
      replayStatus: 'fiber-only-fallback',
    };
  }

  if (!isDispatcherIdle(dispatcherRef)) {
    return {
      componentName,
      records: fallbackRecords,
      replayAttempted: false,
      replayError: 'React render in progress; refusing dispatcher swap',
      replayErrorDetails: null,
      replayStatus: 'fiber-only-fallback',
    };
  }

  // Collect committed hook nodes in order.
  const hookNodes: HookNode[] = [];
  let hookNode = fiber.memoizedState as HookNode | null | undefined;
  const seen = new Set<HookNode>();
  while (hookNode && !seen.has(hookNode)) {
    seen.add(hookNode);
    hookNodes.push(hookNode);
    hookNode = hookNode.next as HookNode | null | undefined;
  }

  const originalDispatcher = dispatcherRef.current;
  const originalConsoleError = console.error;
  const records: HookRecord[] = [];
  let cursor = 0;
  let replayError = '';
  let replayErrorDetails: ErrorPayload | null = null;
  let replayAttempted = false;
  let replayDriftError: string | null = null;

  // ─── Dispatcher contract ──────────────────────────────────────────────────
  // Each hook below returns what is STORED in the committed fiber's hook node
  // at the current cursor position. That is all it does.
  //
  // It does NOT:
  //   - execute the factory/create/selector/reducer function
  //   - recompute derived values
  //   - compare deps or decide if a value is stale
  //   - adjust, infer, or reason about what the value "should" be
  //
  // The cursor walks the committed hook list in declaration order.
  // consumeSlot() advances the cursor and reads memoizedState verbatim.
  // The only transformation is structural unwrapping (e.g. [value, deps] → value
  // for Memo) so that callers receive the same shape they would from React.
  // ─────────────────────────────────────────────────────────────────────────

  function captureFrames(): StackFrame[] {
    return parseStackFrames(new Error().stack || '');
  }

  function currentPath(frames: StackFrame[]): StackFrame[] {
    return customHookPathFromFrames(frames, componentName);
  }

  function currentDebugOwner(frames: StackFrame[]): string {
    const path = currentPath(frames);
    return path.length ? path[path.length - 1].name : componentName;
  }

  function consumeSlot(primitive: string, frames: StackFrame[]): { node: HookNode; value: unknown; index: number; path: StackFrame[] } {
    const node = hookNodes[cursor];
    if (!node) throw new Error('Hook cursor exhausted at slot ' + cursor + ' for ' + primitive);
    const index = cursor;
    cursor += 1;
    const path = currentPath(frames);
    const value = readHookValueFromNode(node);

    // Verify tag matches expected primitive to detect cursor drift.
    // The classifier returns one of 5 families; map each called primitive
    // to its expected family.
    const actualClassified = classifyHook(node, index);
    const actualTag = actualClassified.tag;
    const expectedFamily = primitiveFamily(primitive);
    const tagMatches = expectedFamily === null || actualTag === expectedFamily;

    if (!tagMatches) {
      const msg =
        'Hook cursor drift at slot ' + index + ': expected ' + primitive +
        ' but fiber node is ' + actualTag +
        '. A hook consumed by the live component is not handled by the replay dispatcher.';
      replayDriftError = msg;
      // Throw so the outer try/catch in replayComponentHooks stops the render
      // immediately. Continuing with a fabricated fallback value lets the render
      // function invoke the bad value (e.g. undefined()) which is noisier.
      throw new Error(msg);
    }

    records.push({
      id: index,
      index,
      primitive,
      value: safeSerialize(value, 0, new Set()),
      path,
      source: null,
      fiberOnly: false,
      debugLabel: undefined,
    });
    return { node, value, index, path };
  }

  function setDebugLabel(frames: StackFrame[], label: unknown): void {
    const owner = currentDebugOwner(frames);
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      const tail = rec.path && rec.path.length ? rec.path[rec.path.length - 1].name : componentName;
      if (tail === owner) {
        rec.debugLabel = safeSerialize(label, 1, new Set());
        return;
      }
    }
    records.push({
      id: 'debug:' + records.length,
      index: null,
      primitive: 'DebugValue',
      value: undefined,
      path: currentPath(frames),
      source: null,
      fiberOnly: false,
      debugLabel: safeSerialize(label, 1, new Set()),
    });
  }

  const stubDispatcher: Record<string, unknown> = {
    useState(initialValue: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('State', frames);
      return [slot.value, noop];
    },
    useReducer(_reducer: unknown, _initialArg: unknown, _init?: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('Reducer', frames);
      return [slot.value, noop];
    },
    useRef(_initialValue: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('Ref', frames);
      return slot.value; // memoizedState is { current: x }
    },
    useMemo(_create: unknown, _deps: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('Memo', frames);
      return (slot.value as [unknown, unknown])[0]; // memoizedState is [value, deps]
    },
    useCallback(_callback: unknown, _deps: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('Callback', frames);
      return (slot.value as [unknown, unknown])[0]; // memoizedState is [callback, deps]
    },
    useDeferredValue(_value: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('Deferred', frames);
      return slot.value;
    },
    useTransition() {
      const frames = captureFrames();
      consumeSlot('Transition', frames);
      return [false, noop];
    },
    useSyncExternalStore(_subscribe: unknown, _getSnapshot: unknown, _getServerSnapshot?: unknown) {
      const frames = captureFrames();
      const slot = consumeSlot('SyncExternalStore', frames);
      // React DOM 18 stores useSyncExternalStore as two committed hook nodes:
      //   1. snapshot/value node: mount/updateSyncExternalStore calls
      //      mount/updateWorkInProgressHook and stores hook.memoizedState = snapshot
      //   2. subscription Effect node: the same implementation immediately calls
      //      mountEffect/updateEffect(subscribeToStore..., [subscribe])
      // See node_modules/react-dom/umd/react-dom.development.js:
      //   mountSyncExternalStore lines 15966-16041
      //   updateSyncExternalStore lines 16044-16097
      // The following pushEffect(updateStoreInstance...) is not a hook node.
      // Replay must therefore consume the subscription Effect to keep the cursor
      // aligned, while returning only the public snapshot value.
      consumeSlot('Effect', frames);
      return slot.value;
    },
    useContext(contextArg: unknown) {
      return readContextValueFromFiber(fiber, contextArg);
    },
    useDebugValue(value: unknown, formatter?: unknown) {
      const frames = captureFrames();
      let label = value;
      try { label = typeof formatter === 'function' ? (formatter as (v: unknown) => unknown)(value) : value; } catch (_) { label = value; }
      setDebugLabel(frames, label);
    },
    useEffect(_create: unknown, _deps?: unknown) {
      const frames = captureFrames();
      consumeSlot('Effect', frames);
    },
    useLayoutEffect(_create: unknown, _deps?: unknown) {
      const frames = captureFrames();
      consumeSlot('LayoutEffect', frames);
    },
    useInsertionEffect(_create: unknown, _deps?: unknown) {
      const frames = captureFrames();
      consumeSlot('InsertionEffect', frames);
    },
    useImperativeHandle(_ref: unknown, _create: unknown, _deps?: unknown) {
      const frames = captureFrames();
      consumeSlot('ImperativeHandle', frames);
    },
    useId() {
      const frames = captureFrames();
      const slot = consumeSlot('Id', frames);
      return slot.value; // memoizedState is the committed id string
    },
  };

  try {
    replayAttempted = true;
    dispatcherRef.current = stubDispatcher;
    console.error = function (...args: unknown[]) {
      try { return originalConsoleError.apply(console, args as Parameters<typeof console.error>); } catch (_) {}
    };
    const renderFn = fiber && fiber.type;
    if (typeof renderFn !== 'function') throw new Error('Fiber type is not executable');
    (renderFn as (props: unknown, ref: unknown) => unknown)(fiber.memoizedProps, fiber.ref);
  } catch (e) {
    replayError = (e as Error)?.message || String(e);
    replayErrorDetails = replayErrorPayload(e);
    logReplayError('structure-render', componentName, e);
  } finally {
    try { dispatcherRef.current = originalDispatcher; } catch (_) {}
    console.error = originalConsoleError;
  }

  // Surface drift error even when replay did not throw (graceful fallback path).
  if (!replayError && replayDriftError) {
    replayError = replayDriftError;
  }

  return {
    componentName,
    records: records.length ? records : fallbackRecords,
    replayAttempted,
    replayError,
    replayErrorDetails,
    replayStatus: replayError ? 'partial-replay' : 'complete',
    __debugCursor: cursor,
    __debugTail: records.slice(Math.max(0, records.length - 5)),
  };
}
