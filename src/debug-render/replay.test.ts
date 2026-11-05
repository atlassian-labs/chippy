/**
 * Unit tests for the replay engine (src/debug-render/replay.ts).
 *
 * These tests run in Vitest/jsdom — no browser, no Chippy extension.
 * The strategy is to construct minimal fiber-shaped objects and a fake
 * dispatcherRef, then assert on the output of replayComponentHooks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  safeSerialize,
  noop,
  replayErrorPayload,
  classifyHook,
  evalFiberHooks,
  readHookValueFromNode,
  fiberOnlyHookRecords,
  customHookPathFromFrames,
  customHookPathFromStack,
  PRIMITIVE_HOOK_NAMES,
  readContextValueFromFiber,
  getDispatcherRef,
  isDispatcherIdle,
  replayComponentHooks,
  type Fiber,
  type HookNode,
} from './replay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHookNode(memoizedState: unknown, queue: unknown = null, next: HookNode | null = null): HookNode {
  return { memoizedState, queue, next: next ?? undefined };
}

function chainHooks(nodes: HookNode[]): HookNode {
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].next = nodes[i + 1];
  }
  return nodes[0];
}

function makeStateHook(value: unknown): HookNode {
  return makeHookNode(value, { dispatch: () => {}, lastRenderedReducer: { name: 'basicStateReducer' } });
}

function makeReducerHook(value: unknown): HookNode {
  return makeHookNode(value, { dispatch: () => {}, lastRenderedReducer: { name: 'myReducer' } });
}

function makeRefHook(current: unknown): HookNode {
  return makeHookNode({ current }, null);
}

function makeMemoHook(value: unknown, deps: unknown[] = []): HookNode {
  return makeHookNode([value, deps], null);
}

function makeCallbackHook(fn: Function, deps: unknown[] = []): HookNode {
  return makeHookNode([fn, deps], null);
}

function makeEffectHook(create?: Function, destroy?: Function, deps?: unknown[] | null): HookNode {
  return makeHookNode({ create: create ?? (() => {}), destroy, deps: deps ?? null }, null);
}

function makeDeferredHook(value: unknown): HookNode {
  return makeHookNode(value, { someQueueWithoutDispatch: true });
}

function makeFiber(
  componentName: string,
  hookNode: HookNode | null,
  overrides: Partial<Fiber> = {}
): Fiber {
  return {
    type: function() {} as unknown as Fiber['type'],
    memoizedState: hookNode,
    memoizedProps: {},
    ref: null,
    ...overrides,
  };
}

function makeFiberWithFn(fn: Function, hookNode: HookNode | null): Fiber {
  return {
    type: fn,
    memoizedState: hookNode,
    memoizedProps: {},
    ref: null,
  };
}

function installFakeDevtoolsHook(dispatcherRef: Record<string, unknown>) {
  (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { currentDispatcherRef: dispatcherRef }]]),
  };
}

function removeFakeDevtoolsHook() {
  delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

// ---------------------------------------------------------------------------
// safeSerialize
// ---------------------------------------------------------------------------

describe('safeSerialize', () => {
  it('passes null/undefined through', () => {
    expect(safeSerialize(null)).toBe(null);
    expect(safeSerialize(undefined)).toBe(undefined);
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(200);
    const result = safeSerialize(long) as string;
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(130);
  });

  it('returns numbers and booleans as-is', () => {
    expect(safeSerialize(42)).toBe(42);
    expect(safeSerialize(true)).toBe(true);
  });

  it('serializes functions to string tag', () => {
    function myFn() {}
    expect(safeSerialize(myFn)).toBe('[function:myFn]');
    expect(safeSerialize(() => {})).toBe('[function]');
  });

  it('serializes symbols', () => {
    expect(safeSerialize(Symbol('x'))).toBe('[symbol:Symbol(x)]');
  });

  it('serializes arrays as tag', () => {
    expect(safeSerialize([1, 2, 3])).toBe('[array:3]');
  });

  it('serializes shallow objects at depth 0', () => {
    const obj = safeSerialize({ a: 1, b: 'hello' }) as Record<string, unknown>;
    expect(obj['a']).toBe(1);
    expect(obj['b']).toBe('hello');
  });

  it('clamps nested objects at depth 1', () => {
    const obj = safeSerialize({ nested: { x: 1 } }) as Record<string, unknown>;
    expect(obj['nested']).toBe('[object]');
  });

  it('handles circular references', () => {
    const o: Record<string, unknown> = {};
    o['self'] = o;
    const result = safeSerialize(o) as Record<string, unknown>;
    expect(result['self']).toBe('[circular]');
  });

  it('caps at 8 keys and adds overflow marker', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 12; i++) big['k' + i] = i;
    const result = safeSerialize(big) as Record<string, unknown>;
    expect(result['…']).toMatch(/4 more/);
  });
});

// ---------------------------------------------------------------------------
// noop
// ---------------------------------------------------------------------------

describe('noop', () => {
  it('returns undefined', () => {
    expect(noop()).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// replayErrorPayload
// ---------------------------------------------------------------------------

describe('replayErrorPayload', () => {
  it('returns null for falsy input', () => {
    expect(replayErrorPayload(null)).toBe(null);
    expect(replayErrorPayload(undefined)).toBe(null);
  });

  it('extracts name/message/stack from an Error', () => {
    const e = new Error('oops');
    const p = replayErrorPayload(e)!;
    expect(p.name).toBe('Error');
    expect(p.message).toBe('oops');
    expect(typeof p.stack).toBe('string');
  });

  it('handles non-Error objects gracefully', () => {
    const p = replayErrorPayload('just a string')!;
    expect(p.message).toBe('just a string');
  });
});

// ---------------------------------------------------------------------------
// classifyHook — minimal sanity checks; full family spec lives in
// replay.classifyHook.test.ts
// ---------------------------------------------------------------------------

describe('classifyHook (sanity)', () => {
  it('classifies useState as "State"', () => {
    const c = classifyHook(makeStateHook(42), 0);
    expect(c.tag).toBe('State');
    expect(c.index).toBe(0);
  });

  it('classifies useRef as "Ref"', () => {
    const c = classifyHook(makeRefHook('hello'), 0);
    expect(c.tag).toBe('Ref');
    expect((c as { current: unknown }).current).toBe('hello');
  });

  it('classifies useMemo as "Memo"', () => {
    const c = classifyHook(makeMemoHook(99, [1, 2]), 0);
    expect(c.tag).toBe('Memo');
  });
});

// ---------------------------------------------------------------------------
// evalFiberHooks
// ---------------------------------------------------------------------------

describe('evalFiberHooks', () => {
  it('returns error result for null fiber', () => {
    const result = evalFiberHooks(null);
    expect(result.error).toBeTruthy();
    expect(result.hookCount).toBe(0);
  });

  it('walks linked hook list and returns hooks', () => {
    const h1 = makeStateHook(1);
    const h2 = makeRefHook('x');
    h1.next = h2;
    const fiber: Fiber = { type: function MyComp() {}, memoizedState: h1 };
    const result = evalFiberHooks(fiber);
    expect(result.hookCount).toBe(2);
    expect(result.hooks[0].tag).toBe('State');
    expect(result.hooks[1].tag).toBe('Ref');
    expect(result.name).toBe('MyComp');
  });

  it('detects cycles and stops', () => {
    const h1 = makeStateHook(0);
    h1.next = h1 as HookNode; // cycle
    const fiber: Fiber = { memoizedState: h1 };
    const result = evalFiberHooks(fiber);
    // Should have 2 entries: h1 + the cycle sentinel
    expect(result.hooks.length).toBe(2);
    expect(result.hooks[1].note).toMatch(/cycle/);
  });

  it('truncates at MAX_HOOKS=500', () => {
    // Build a chain of 501 hooks
    const nodes: HookNode[] = [];
    for (let i = 0; i <= 500; i++) nodes.push(makeStateHook(i));
    chainHooks(nodes);
    const fiber: Fiber = { memoizedState: nodes[0] };
    const result = evalFiberHooks(fiber);
    expect(result.truncated).toBe(true);
    expect(result.hookCount).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// readHookValueFromNode
// ---------------------------------------------------------------------------

describe('readHookValueFromNode', () => {
  it('returns memoizedState', () => {
    const node = makeHookNode('hello', null);
    expect(readHookValueFromNode(node)).toBe('hello');
  });

  it('returns undefined for null', () => {
    expect(readHookValueFromNode(null)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// fiberOnlyHookRecords
// ---------------------------------------------------------------------------

describe('fiberOnlyHookRecords', () => {
  it('produces fiberOnly records for each hook node', () => {
    const h1 = makeStateHook(10);
    const h2 = makeRefHook('ref');
    h1.next = h2;
    const fiber: Fiber = { type: function Foo() {}, memoizedState: h1 };
    const records = fiberOnlyHookRecords(fiber);
    expect(records).toHaveLength(2);
    expect(records[0].fiberOnly).toBe(true);
    expect(records[0].primitive).toBe('State');
    expect(records[1].primitive).toBe('Ref');
    expect(records[0].path).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PRIMITIVE_HOOK_NAMES
// ---------------------------------------------------------------------------

describe('PRIMITIVE_HOOK_NAMES', () => {
  it('contains all standard React 18 primitives', () => {
    expect(PRIMITIVE_HOOK_NAMES.has('useState')).toBe(true);
    expect(PRIMITIVE_HOOK_NAMES.has('useEffect')).toBe(true);
    expect(PRIMITIVE_HOOK_NAMES.has('useRef')).toBe(true);
    expect(PRIMITIVE_HOOK_NAMES.has('useContext')).toBe(true);
    expect(PRIMITIVE_HOOK_NAMES.has('useMemo')).toBe(true);
  });

  it('does NOT contain custom hook names', () => {
    expect(PRIMITIVE_HOOK_NAMES.has('useMyCustomHook')).toBe(false);
    expect(PRIMITIVE_HOOK_NAMES.has('useCounter')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// customHookPathFromFrames
// ---------------------------------------------------------------------------

describe('customHookPathFromFrames', () => {
  it('returns empty array when no custom hooks in stack', () => {
    const frames = [
      { name: 'useState', loc: '1:1' },
      { name: 'MyComponent', loc: '10:1' },
    ];
    expect(customHookPathFromFrames(frames, 'MyComponent')).toEqual([]);
  });

  it('extracts custom hook ancestry with parent callsite as stable loc', () => {
    const frames = [
      { name: 'useState', loc: 'primitive-inside-counter:1' },
      { name: 'useCounter', loc: 'inside-counter:5' },
      { name: 'MyComponent', loc: 'component-calls-counter:20' },
    ];
    const path = customHookPathFromFrames(frames, 'MyComponent');
    expect(path).toEqual([{ name: 'useCounter', loc: 'component-calls-counter:20' }]);
  });

  it('handles nested custom hooks with stable parent callsite locs', () => {
    const frames = [
      { name: 'useState', loc: 'inside-inner-primitive:1' },
      { name: 'useInner', loc: 'outer-calls-inner:5' },
      { name: 'useOuter', loc: 'component-calls-outer:10' },
      { name: 'MyComponent', loc: 'component-body:20' },
    ];
    const path = customHookPathFromFrames(frames, 'MyComponent');
    expect(path).toEqual([
      { name: 'useOuter', loc: 'component-body:20' },
      { name: 'useInner', loc: 'component-calls-outer:10' },
    ]);
  });

  it('excludes frames after component', () => {
    const frames = [
      { name: 'useCustom', loc: '5:1' },
      { name: 'MyComponent', loc: '20:1' },
      { name: 'useAfter', loc: '30:1' }, // after component — excluded
    ];
    const path = customHookPathFromFrames(frames, 'MyComponent');
    expect(path.map((f) => f.name)).toEqual(['useCustom']);
  });
});

// ---------------------------------------------------------------------------
// customHookPathFromStack
// ---------------------------------------------------------------------------

describe('customHookPathFromStack', () => {
  it('parses a V8 stack string and extracts custom-hook path', () => {
    const stack =
      'Error\n' +
      '    at useState (react-dom.js:1:1)\n' +
      '    at useCounter (hooks.ts:10:2)\n' +
      '    at MyComp (MyComp.tsx:30:4)';
    const path = customHookPathFromStack(stack, 'MyComp');
    expect(path).toHaveLength(1);
    expect(path[0].name).toBe('useCounter');
  });
});

// ---------------------------------------------------------------------------
// readContextValueFromFiber
// ---------------------------------------------------------------------------

describe('readContextValueFromFiber', () => {
  it('returns opaque truthy scaffolding when no runtime value is available', () => {
    const fiber: Fiber = {};
    expect(readContextValueFromFiber(fiber, {})).toBeTruthy();
  });

  it('returns memoizedValue when context matches', () => {
    const ctx = {};
    const fiber: Fiber = {
      dependencies: {
        firstContext: { context: ctx, memoizedValue: 'theme-dark', next: null },
      },
    };
    expect(readContextValueFromFiber(fiber, ctx)).toBe('theme-dark');
  });

  it('falls back to _currentValue when context not in linked list', () => {
    const ctx = { _currentValue: 'fallback' };
    const fiber: Fiber = { dependencies: { firstContext: null } };
    expect(readContextValueFromFiber(fiber, ctx)).toBe('fallback');
  });

  it('falls back to _currentValue2 when the primary value is unavailable', () => {
    const ctx = { _currentValue: null, _currentValue2: 'secondary-fallback' };
    const fiber: Fiber = { dependencies: { firstContext: null } };
    expect(readContextValueFromFiber(fiber, ctx)).toBe('secondary-fallback');
  });

  it('walks the linked list to find the right context', () => {
    const ctxA = {};
    const ctxB = {};
    const fiber: Fiber = {
      dependencies: {
        firstContext: {
          context: ctxA,
          memoizedValue: 'a',
          next: { context: ctxB, memoizedValue: 'b', next: null },
        },
      },
    };
    expect(readContextValueFromFiber(fiber, ctxB)).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// getDispatcherRef / isDispatcherIdle
// ---------------------------------------------------------------------------

describe('getDispatcherRef', () => {
  afterEach(removeFakeDevtoolsHook);

  it('returns null when hook absent', () => {
    expect(getDispatcherRef()).toBe(null);
  });

  it('returns the dispatcher ref from the fake hook', () => {
    const ref = { current: {} };
    installFakeDevtoolsHook(ref);
    expect(getDispatcherRef()).toBe(ref);
  });

  it('maps React 19 shared internals (`H`) to a stable { current } view', () => {
    const contextOnly = { useState: () => {} };
    const internals: Record<string, unknown> = { H: contextOnly, A: null, T: null, S: null };
    installFakeDevtoolsHook(internals);
    const ref = getDispatcherRef()!;
    expect(ref.current).toBe(contextOnly);
    expect(getDispatcherRef()).toBe(ref);
    const next = {};
    ref.current = next;
    expect(internals.H).toBe(next);
    expect('current' in internals).toBe(false);
  });
});

describe('isDispatcherIdle', () => {
  it('returns false when ref.current is null', () => {
    expect(isDispatcherIdle({ current: null })).toBe(false);
  });

  it('returns true for a plain object (not HooksDispatcher)', () => {
    // A plain dispatcher object has no constructor.name containing HooksDispatcher
    expect(isDispatcherIdle({ current: { useState: () => {} } })).toBe(true);
  });

  it('returns false when constructor name contains HooksDispatcher', () => {
    class HooksDispatcherOnUpdate {}
    expect(isDispatcherIdle({ current: new HooksDispatcherOnUpdate() })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// replayComponentHooks — integration-level tests
// ---------------------------------------------------------------------------

describe('replayComponentHooks', () => {
  // Failure-path tests make replay log a [Chippy replay-error] diagnostic.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => {
    vi.restoreAllMocks();
    removeFakeDevtoolsHook();
  });

  it('falls back to fiber-only when no dispatcherRef', () => {
    const h1 = makeStateHook(5);
    const fiber: Fiber = { type: function MyComp() {}, memoizedState: h1 };
    const result = replayComponentHooks(fiber);
    expect(result.replayAttempted).toBe(false);
    expect(result.replayStatus).toBe('fiber-only-fallback');
    expect(result.replayError).toMatch(/ReactCurrentDispatcher not found/);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].fiberOnly).toBe(true);
  });

  it('completes replay for a simple useState component', () => {
    const h1 = makeStateHook(42);
    const dispatcherRef: { current: unknown } = { current: { useState: () => [42, noop] } };
    installFakeDevtoolsHook(dispatcherRef);

    function SimpleComp() {
      // The stub dispatcher will be swapped in, so this call goes to stubDispatcher.useState
      const [count] = (dispatcherRef.current as any).useState(0);
      return count;
    }

    const fiber = makeFiberWithFn(SimpleComp, h1);
    const result = replayComponentHooks(fiber);
    expect(result.replayAttempted).toBe(true);
    expect(result.componentName).toBe('SimpleComp');
    expect(result.records.length).toBeGreaterThanOrEqual(1);
    expect(result.records[0].primitive).toBe('State');
    expect(result.records[0].value).toBe(42);
    expect(result.records[0].fiberOnly).toBe(false);
    expect(result.replayStatus).toBe('complete');
  });

  it('returns fiber-only-fallback for non-function fiber type', () => {
    const dispatcherRef: { current: unknown } = { current: { useState: () => {} } };
    installFakeDevtoolsHook(dispatcherRef);

    const fiber: Fiber = { type: 'div', memoizedState: null };
    const result = replayComponentHooks(fiber);
    expect(result.replayAttempted).toBe(true);
    expect(result.replayError).toMatch(/not executable/);
    expect(result.replayStatus).toBe('partial-replay');
  });

  it('replays multiple hook types in order', () => {
    const h1 = makeStateHook(10);
    const h2 = makeRefHook('initial');
    const h3 = makeMemoHook('computed', [1]);
    h1.next = h2; h2.next = h3;

    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    let captured: { state: unknown; ref: unknown; memo: unknown } = { state: null, ref: null, memo: null };
    function MultiComp() {
      const dis = dispatcherRef.current as any;
      const [s] = dis.useState(0);
      const r = dis.useRef('');
      const m = dis.useMemo(() => '', []);
      captured = { state: s, ref: r, memo: m };
    }

    const fiber = makeFiberWithFn(MultiComp, h1);
    const result = replayComponentHooks(fiber);

    expect(result.replayAttempted).toBe(true);
    // 3 real hook records (useState, useRef, useMemo)
    const primitives = result.records.filter((r) => r.index !== null).map((r) => r.primitive);
    expect(primitives).toEqual(['State', 'Ref', 'Memo']);
    expect(result.replayStatus).toBe('complete');
  });

  it('useMemo drift: fiber has State slot but component calls useMemo — stops immediately, reports drift', () => {
    // Drift detection throws immediately (caught by outer try/catch) so the
    // render function does not continue with a bad value (e.g. undefined()).
    const h1 = makeStateHook(42); // classified as State, not Memo
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function DriftMemoComp() {
      (dispatcherRef.current as any).useMemo(() => 'computed', []);
    }

    const fiber = makeFiberWithFn(DriftMemoComp, h1);
    expect(() => replayComponentHooks(fiber)).not.toThrow(); // outer catch handles it
    const result = replayComponentHooks(fiber);
    expect(result.replayError).toMatch(/drift/i);
    expect(result.replayStatus).toBe('partial-replay');
  });

  it('useCallback drift: fiber has State slot but component calls useCallback — stops immediately, reports drift', () => {
    const h1 = makeStateHook(42); // classified as State, not Memo/Callback
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function DriftCallbackComp() {
      (dispatcherRef.current as any).useCallback(() => 'fn', []);
    }

    const fiber = makeFiberWithFn(DriftCallbackComp, h1);
    expect(() => replayComponentHooks(fiber)).not.toThrow(); // outer catch handles it
    const result = replayComponentHooks(fiber);
    expect(result.replayError).toMatch(/drift/i);
    expect(result.replayStatus).toBe('partial-replay');
  });

  it('reports drift error when hook types mismatch', () => {
    // Fiber has a Ref hook but component calls useState — cursor drift
    const h1 = makeRefHook('ref-value'); // classified as Ref
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function DriftComp() {
      // Calls useState but the fiber node at cursor 0 is a Ref — drift
      (dispatcherRef.current as any).useState(0);
    }

    const fiber = makeFiberWithFn(DriftComp, h1);
    const result = replayComponentHooks(fiber);
    // Drift doesn't throw — it sets replayDriftError and returns partial
    expect(result.replayError).toMatch(/drift/i);
    expect(result.replayStatus).toBe('partial-replay');
  });

  it('handles cursor exhaustion gracefully', () => {
    // Fiber has 1 hook but component calls 2
    const h1 = makeStateHook(1);
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function TooManyHooksComp() {
      const dis = dispatcherRef.current as any;
      dis.useState(0); // slot 0 — ok
      dis.useState(0); // slot 1 — exhausted → should throw
    }

    const fiber = makeFiberWithFn(TooManyHooksComp, h1);
    const result = replayComponentHooks(fiber);
    expect(result.replayAttempted).toBe(true);
    expect(result.replayError).toMatch(/exhausted/i);
    // The first slot was consumed successfully before exhaustion; the partial
    // records are returned (not fiber-only fallback, since records.length > 0).
    // The replayStatus reflects the error.
    expect(result.replayStatus).toBe('partial-replay');
  });

  it('replays against React 19 shared internals and restores `H`', () => {
    const contextOnly = { useState: () => { throw new Error('invalid hook call'); } };
    const internals: Record<string, unknown> = { H: contextOnly, A: null, T: null, S: null };
    installFakeDevtoolsHook(internals);

    function NineteenComp() {
      const [count] = (internals.H as any).useState(0);
      return count;
    }

    const result = replayComponentHooks(makeFiberWithFn(NineteenComp, makeStateHook(7)));
    expect(result.replayError).toBe('');
    expect(result.replayStatus).toBe('complete');
    expect(result.records[0].value).toBe(7);
    expect(result.records[0].fiberOnly).toBe(false);
    expect(internals.H).toBe(contextOnly);
  });

  it('restores the original dispatcher even when replay throws', () => {
    const originalDispatcher = { useState: () => [0, noop] };
    const dispatcherRef: { current: unknown } = { current: originalDispatcher };
    installFakeDevtoolsHook(dispatcherRef);

    function ThrowingComp() {
      throw new Error('render exploded');
    }

    const fiber = makeFiberWithFn(ThrowingComp, null);
    replayComponentHooks(fiber);
    // Dispatcher must be restored after throw
    expect(dispatcherRef.current).toBe(originalDispatcher);
  });

  it('useSyncExternalStore consumes snapshot slot plus React DOM subscription Effect slot', () => {
    // React DOM 18 mount/updateSyncExternalStore consumes one hook node for the
    // snapshot, then immediately calls mountEffect/updateEffect for the store
    // subscription. Replay must consume both committed hook nodes while returning
    // only the public snapshot value.
    const h1 = makeDeferredHook('snapshot'); // classified as Value
    const h2 = makeEffectHook(() => undefined, undefined, []); // subscription Effect
    const effect = h2.memoizedState as { tag?: number; next?: unknown };
    effect.tag = 9;
    effect.next = effect; // React stores effects in a circular effect ring
    const h3 = makeRefHook('next-block');
    h1.next = h2; h2.next = h3;

    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    let snapshot: unknown = null;
    let ref: unknown = null;
    function SyncStoreComp() {
      const dis = dispatcherRef.current as any;
      snapshot = dis.useSyncExternalStore(() => () => undefined, () => 'ignored');
      ref = dis.useRef('');
    }

    const fiber = makeFiberWithFn(SyncStoreComp, h1);
    const result = replayComponentHooks(fiber);

    expect(result.replayError).toBe('');
    expect(result.replayStatus).toBe('complete');
    expect(snapshot).toBe('snapshot');
    expect(ref).toEqual({ current: 'next-block' });
    expect(result.records.filter((r) => r.index !== null).map((r) => [r.index, r.primitive])).toEqual([
      [0, 'SyncExternalStore'],
      [1, 'Effect'],
      [2, 'Ref'],
    ]);
  });

  it('useContext reads from fiber dependencies, not dispatcher', () => {
    const ctx = {};
    const h1 = makeStateHook(0);
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    const fiberWithCtx: Fiber = {
      type: function CtxComp() {
        (dispatcherRef.current as any).useState(0);
        (dispatcherRef.current as any).useContext(ctx);
      },
      memoizedState: h1,
      memoizedProps: {},
      ref: null,
      dependencies: {
        firstContext: { context: ctx, memoizedValue: 'theme', next: null },
      },
    };

    const result = replayComponentHooks(fiberWithCtx);
    expect(result.replayAttempted).toBe(true);
    // useContext doesn't consume a hook slot — records should only have State
    const slotted = result.records.filter((r) => r.index !== null);
    expect(slotted.map((r) => r.primitive)).toEqual(['State']);
  });

  it('useContext continues structural replay with a value from the fiber alternate', () => {
    const ctx = {};
    const h1 = makeStateHook(0);
    const h2 = makeRefHook('after-context');
    h1.next = h2;
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function GuardedContextComp() {
      const dis = dispatcherRef.current as any;
      dis.useState(0);
      const project = dis.useContext(ctx);
      if (!project) throw new Error('must be used within provider');
      dis.useRef(null);
    }

    const fiber = makeFiberWithFn(GuardedContextComp, h1);
    fiber.dependencies = {
      firstContext: { context: ctx, memoizedValue: null, next: null },
    };
    fiber.alternate = {
      dependencies: {
        firstContext: { context: ctx, memoizedValue: { key: 'TEST' }, next: null },
      },
    };

    const result = replayComponentHooks(fiber);

    expect(result.replayStatus).toBe('complete');
    expect(result.records.filter((r) => r.index !== null).map((r) => r.primitive)).toEqual(['State', 'Ref']);
  });

  it('useContext continues structural replay with a Provider value from the return chain', () => {
    const ctx = {};
    const h1 = makeStateHook(0);
    const h2 = makeRefHook('after-context');
    h1.next = h2;
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function GuardedContextComp() {
      const dis = dispatcherRef.current as any;
      dis.useState(0);
      const project = dis.useContext(ctx);
      if (!project) throw new Error('must be used within provider');
      dis.useRef(null);
    }

    const fiber = makeFiberWithFn(GuardedContextComp, h1);
    fiber.return = {
      tag: 10,
      type: { _context: ctx },
      memoizedProps: { value: { key: 'TEST' } },
      return: null,
    };

    const result = replayComponentHooks(fiber);

    expect(result.replayStatus).toBe('complete');
    expect(result.records.filter((r) => r.index !== null).map((r) => r.primitive)).toEqual(['State', 'Ref']);
  });

  it('useContext uses opaque replay scaffolding when no runtime value can be recovered', () => {
    const ctx = {};
    const h1 = makeStateHook(0);
    const h2 = makeRefHook('after-context');
    h1.next = h2;
    const dispatcherRef: { current: unknown } = { current: {} };
    installFakeDevtoolsHook(dispatcherRef);

    function GuardedContextComp() {
      const dis = dispatcherRef.current as any;
      dis.useState(0);
      const project = dis.useContext(ctx);
      if (!project) throw new Error('must be used within provider');
      project.fields.summary.toString();
      dis.useRef(null);
    }

    const fiber = makeFiberWithFn(GuardedContextComp, h1);
    const result = replayComponentHooks(fiber);

    expect(result.replayStatus).toBe('complete');
    expect(result.records.filter((r) => r.index !== null).map((r) => r.primitive)).toEqual(['State', 'Ref']);
    expect(result.records.every((r) => r.primitive !== 'Context')).toBe(true);
  });
});
