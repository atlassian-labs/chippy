/**
 * Spec tests for `classifyHook` — family classification only.
 *
 * Why this exists
 * ---------------
 * `classifyHook` answers ONE question: at the cursor position N in the fiber's
 * memoizedState linked list, what STRUCTURAL FAMILY does this slot belong to?
 *
 * The replay dispatcher (`consumeSlot` in replay.ts) compares the family of
 * the called primitive against the family of the stored slot. If they don't
 * match → cursor drift → bail safely.
 *
 * We do NOT need to distinguish:
 *   - useState vs useReducer vs useTransition's-internal-queue
 *     → all are "State" (have queue.dispatch)
 *   - useMemo vs useCallback
 *     → both are "Memo" ([value, deps])
 *   - useEffect vs useLayoutEffect vs useInsertionEffect vs useImperativeHandle
 *     → all are "Effect" (Effect node shape)
 *
 * The 5 families:
 *   - "State"  — anything with queue.dispatch (useState, useReducer, the
 *                 internal isPending queue of useTransition)
 *   - "Ref"    — { current: x }, queue null  (useRef)
 *   - "Memo"   — [value, deps|null], queue null  (useMemo, useCallback)
 *   - "Effect" — Effect node { tag, create, destroy, deps, next:<self> },
 *                 queue null  (useEffect family + useImperativeHandle)
 *   - "Value"  — anything else that consumes a slot but doesn't dispatch:
 *                 useId (string), useDeferredValue (raw value), output of
 *                 useSyncExternalStore. queue may be present but without
 *                 a dispatch function.
 *
 * useContext is NOT in this list. It does NOT consume a slot. classifyHook
 * must never invent a "Context" family for a real fiber slot.
 */

import { describe, it, expect } from 'vitest';
import { classifyHook, type HookNode } from './replay';

// ---------------------------------------------------------------------------
// React 18 hook-node constructors. Each mirrors the real stored shape from
// react-reconciler (ReactFiberHooks.js).
// ---------------------------------------------------------------------------

function makeHookNode(memoizedState: unknown, queue: unknown = null): HookNode {
  return { memoizedState, queue, next: null };
}

function basicStateReducer<T>(state: T, action: T | ((prev: T) => T)): T {
  return typeof action === 'function' ? (action as (p: T) => T)(state) : action;
}

function makeUseStateNode(value: unknown): HookNode {
  return makeHookNode(value, {
    dispatch: () => {},
    lastRenderedState: value,
    lastRenderedReducer: basicStateReducer,
    pending: null,
    interleaved: null,
    lanes: 0,
  });
}

function makeUseReducerNode(value: unknown, reducer: Function = function userReducer() {}): HookNode {
  return makeHookNode(value, {
    dispatch: () => {},
    lastRenderedState: value,
    lastRenderedReducer: reducer,
    pending: null,
    interleaved: null,
    lanes: 0,
  });
}

function makeUseRefNode(initial: unknown): HookNode {
  return makeHookNode({ current: initial }, null);
}

function makeUseMemoNode(value: unknown, deps: unknown[] | null = []): HookNode {
  return makeHookNode([value, deps], null);
}

function makeUseCallbackNode(fn: Function, deps: unknown[] | null = []): HookNode {
  return makeHookNode([fn, deps], null);
}

function makeEffectNode(opts: {
  tag?: number;
  create?: Function;
  destroy?: Function | undefined;
  deps?: unknown[] | null;
} = {}): HookNode {
  const effect = {
    tag: opts.tag ?? 1,
    create: opts.create ?? (() => {}),
    destroy: opts.destroy,
    deps: opts.deps ?? null,
    next: null as unknown,
  };
  effect.next = effect; // React makes the effect ring circular
  return makeHookNode(effect, null);
}

function makeUseDeferredValueNode(value: unknown): HookNode {
  // queue is a small update queue used internally; no public dispatch.
  return makeHookNode(value, { pending: null, lanes: 0 });
}

function makeUseTransitionNode(isPending: boolean = false): HookNode {
  // memoizedState = [isPending, startTransition]; queue has dispatch (used
  // internally to flip isPending). Slot family is "State" because of the
  // dispatch queue — the public surface tuple is irrelevant to classification.
  return makeHookNode([isPending, function startTransition() {}], {
    dispatch: () => {},
    pending: null,
    lanes: 0,
  });
}

function makeUseIdNode(id: string): HookNode {
  return makeHookNode(id, null);
}

function makeUseSyncExternalStoreNode(value: unknown): HookNode {
  // memoizedState in React 18 stores the snapshot value directly; the queue
  // contains getSnapshot/value/pending bookkeeping but no dispatch.
  return makeHookNode(value, { value, getSnapshot: () => value, pending: null });
}

// ---------------------------------------------------------------------------
// Family spec
// ---------------------------------------------------------------------------

describe('classifyHook — family spec (drift detection contract)', () => {
  // ─── State family ─────────────────────────────────────────────────────
  describe('State family — queue.dispatch present', () => {
    it('useState slot → "State"', () => {
      expect(classifyHook(makeUseStateNode(42), 0).tag).toBe('State');
    });

    it('useReducer slot → "State" (we collapse Reducer into State)', () => {
      expect(classifyHook(makeUseReducerNode({ n: 0 }), 0).tag).toBe('State');
    });

    it('useState whose value is { current: x } → "State", NOT "Ref"', () => {
      // Drift contract: queue.dispatch dominates the structural shape of the
      // value. A user storing an object with a "current" key in useState must
      // not be mis-classified as a Ref.
      expect(classifyHook(makeUseStateNode({ current: 'user-data' }), 0).tag).toBe('State');
    });

    it('useState whose value is an effect-shaped object → "State"', () => {
      expect(classifyHook(makeUseStateNode({ create: () => {}, destroy: () => {}, deps: [] }), 0).tag).toBe('State');
    });

    it('useState whose value is a [value, deps]-shaped tuple → "State"', () => {
      expect(classifyHook(makeUseStateNode([1, [2, 3]]), 0).tag).toBe('State');
    });

    it('useReducer with a name-mangled reducer (production build) → "State"', () => {
      // Production builds mangle function names. The classifier must NOT rely
      // on `reducer.name === 'basicStateReducer'` to disambiguate. State and
      // Reducer collapse into one family, so name mangling is harmless.
      const mangledReducer = function a() {} as (s: unknown, a: unknown) => unknown;
      const node = makeHookNode(0, { dispatch: () => {}, lastRenderedReducer: mangledReducer });
      expect(classifyHook(node, 0).tag).toBe('State');
    });

    it('useTransition slot → "State" (it has an internal dispatch queue)', () => {
      // The public surface is the [isPending, startTransition] tuple, but the
      // SLOT family is determined by the queue having a dispatch.
      expect(classifyHook(makeUseTransitionNode(false), 0).tag).toBe('State');
    });
  });

  // ─── Ref family ────────────────────────────────────────────────────────
  describe('Ref family — { current: ... } own-property, queue null', () => {
    it('useRef slot → "Ref"', () => {
      expect(classifyHook(makeUseRefNode('init'), 0).tag).toBe('Ref');
    });

    it('useRef with object initial value → "Ref"', () => {
      expect(classifyHook(makeUseRefNode({ x: 1 }), 0).tag).toBe('Ref');
    });

    it('non-ref object with INHERITED "current" → NOT "Ref"', () => {
      // React always allocates a plain own-property `{ current: x }` ref
      // container. A foreign object with current on its prototype must not
      // be classified as Ref.
      const proto = { current: 'inherited' };
      const node = makeHookNode(Object.create(proto), null);
      expect(classifyHook(node, 0).tag).not.toBe('Ref');
    });
  });

  // ─── Memo family ───────────────────────────────────────────────────────
  describe('Memo family — [value, deps|null], queue null', () => {
    it('useMemo slot with array deps → "Memo"', () => {
      expect(classifyHook(makeUseMemoNode(99, [1, 2]), 0).tag).toBe('Memo');
    });

    it('useMemo slot with empty deps → "Memo"', () => {
      expect(classifyHook(makeUseMemoNode(99, []), 0).tag).toBe('Memo');
    });

    it('useMemo slot with NULL deps (run every render) → "Memo"', () => {
      // useMemo(create) without deps stores [value, null]. This is a valid
      // useMemo slot and the classifier must recognise it.
      expect(classifyHook(makeUseMemoNode(99, null), 0).tag).toBe('Memo');
    });

    it('useMemo whose computed value is null → "Memo"', () => {
      expect(classifyHook(makeUseMemoNode(null, []), 0).tag).toBe('Memo');
    });

    it('useCallback slot → "Memo" (Callback collapses into Memo family)', () => {
      expect(classifyHook(makeUseCallbackNode(() => {}, [1]), 0).tag).toBe('Memo');
    });

    it('useCallback with NULL deps → "Memo"', () => {
      expect(classifyHook(makeUseCallbackNode(() => {}, null), 0).tag).toBe('Memo');
    });
  });

  // ─── Effect family ─────────────────────────────────────────────────────
  describe('Effect family — Effect node shape, queue null', () => {
    it('useEffect slot → "Effect"', () => {
      expect(classifyHook(makeEffectNode({ create: () => {}, deps: [] }), 0).tag).toBe('Effect');
    });

    it('useEffect WITH cleanup → "Effect"', () => {
      expect(classifyHook(makeEffectNode({ create: () => {}, destroy: () => {}, deps: [] }), 0).tag).toBe('Effect');
    });

    it('useImperativeHandle slot → "Effect" (it stores an effect node)', () => {
      // useImperativeHandle goes through mountEffectImpl, so the slot is an
      // Effect with the imperative-handle wrapper as create.
      expect(classifyHook(makeEffectNode({ create: () => ({}), deps: [] }), 0).tag).toBe('Effect');
    });

    it('arbitrary { deps: [] } object → NOT "Effect"', () => {
      // The previous implementation accepted any object with a "deps" key as
      // an Effect. Real Effect nodes have a numeric tag, a function create,
      // and a circular next. Without those signals it is not an Effect.
      const node = makeHookNode({ deps: [] }, null);
      expect(classifyHook(node, 0).tag).not.toBe('Effect');
    });

    it('object with non-function create → NOT "Effect"', () => {
      const node = makeHookNode({ create: 'not-a-function' }, null);
      expect(classifyHook(node, 0).tag).not.toBe('Effect');
    });
  });

  // ─── Value family ──────────────────────────────────────────────────────
  describe('Value family — slot consumed but no dispatch', () => {
    it('useId slot → "Value"', () => {
      expect(classifyHook(makeUseIdNode(':r0:'), 0).tag).toBe('Value');
    });

    it('useDeferredValue slot → "Value"', () => {
      expect(classifyHook(makeUseDeferredValueNode('latest'), 0).tag).toBe('Value');
    });

    it('useDeferredValue with primitive → "Value"', () => {
      expect(classifyHook(makeUseDeferredValueNode(42), 0).tag).toBe('Value');
    });

    it('useSyncExternalStore slot → "Value"', () => {
      expect(classifyHook(makeUseSyncExternalStoreNode('snapshot'), 0).tag).toBe('Value');
    });
  });

  // ─── Negative spec: forbidden categories ──────────────────────────────
  describe('classifyHook must never return categories that do not exist', () => {
    it('"Context?" must never appear — useContext does not consume a slot', () => {
      const allShapes: HookNode[] = [
        makeUseStateNode(0),
        makeUseReducerNode(0),
        makeUseRefNode('x'),
        makeUseMemoNode(0, []),
        makeUseCallbackNode(() => {}, []),
        makeEffectNode(),
        makeUseDeferredValueNode('x'),
        makeUseTransitionNode(false),
        makeUseIdNode(':r0:'),
        makeUseSyncExternalStoreNode(0),
      ];
      for (const n of allShapes) {
        expect(classifyHook(n, 0).tag).not.toBe('Context?');
      }
    });

    it('"Reducer" must never appear — collapsed into State', () => {
      expect(classifyHook(makeUseReducerNode(0), 0).tag).not.toBe('Reducer');
    });

    it('"Callback" must never appear — collapsed into Memo', () => {
      expect(classifyHook(makeUseCallbackNode(() => {}, []), 0).tag).not.toBe('Callback');
    });

    it('"Deferred" must never appear — useDeferredValue is in Value family', () => {
      expect(classifyHook(makeUseDeferredValueNode('x'), 0).tag).not.toBe('Deferred');
    });
  });

  // ─── Cross-family separation ──────────────────────────────────────────
  describe('cross-family separation', () => {
    it('State and Ref are distinct families', () => {
      expect(classifyHook(makeUseStateNode(0), 0).tag).not.toBe(classifyHook(makeUseRefNode('x'), 0).tag);
    });

    it('Memo and Effect are distinct families', () => {
      expect(classifyHook(makeUseMemoNode(0, []), 0).tag).not.toBe(classifyHook(makeEffectNode(), 0).tag);
    });

    it('Value family is distinct from State (different drift category)', () => {
      expect(classifyHook(makeUseIdNode(':r0:'), 0).tag).not.toBe(classifyHook(makeUseStateNode(0), 0).tag);
    });

    it('Effect and Ref are distinct families', () => {
      expect(classifyHook(makeEffectNode(), 0).tag).not.toBe(classifyHook(makeUseRefNode('x'), 0).tag);
    });
  });
});
