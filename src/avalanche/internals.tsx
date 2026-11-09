// React fiber constants and structural comparisons used by the commit detector.

import { getFiberSourceCandidate } from '../chippy-bridge/fiber-source';
import { readComponentName } from '../chippy-bridge/component-origin';

export type ComponentType =
  | Function
  | symbol
  | {
      // ForwardRef/memo/etc may be objects.
      $$typeof?: symbol;
      render?: Function;
      displayName?: string;
      name?: string;
    };

interface StoreCheck {
  getSnapshot: () => unknown;
  value: unknown;
}

export interface Fiber {
  tag: number;
  type: ComponentType;
  alternate: Fiber | null;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  flags: number;
  subtreeFlags: number;
  lanes: number;
  memoizedState: Hook | null;
  memoizedProps?: unknown;
  pendingProps?: unknown;
  updateQueue: { stores: StoreCheck[] | null } | null;
  /**
   * React populates this array during the render phase with fibers that will be
   * deleted in the commit phase. Present when subtreeFlags & ChildDeletion !== 0.
   * Only available in React 18+ (replaces the older effectList pattern).
   */
  deletions?: Fiber[] | null;

  // Dev-only / optional debug fields (not always present).
  elementType?: unknown;
  _debugSource?: { fileName: string; lineNumber: number };
  _debugStack?: unknown;
  _debugHookTypes?: string[];
}

export interface Hook {
  memoizedState: unknown;
  baseState: unknown;
  baseQueue: unknown;
  queue: HookQueue | null;
  next: Hook | null;
}

interface HookQueue {
  dispatch?: Function;
  value?: unknown;
  getSnapshot?: Function;
  lastRenderedState?: unknown;
}

export interface DepOrigin {
  type: ComponentType;
  hookIndex: number;
  depth: number;
  hookType: 'useCallback' | 'useMemo';
}

export interface ThrashInfo {
  hookIndex: number;
  hookType: 'effect' | 'callback' | 'memo';
  deps: unknown[];
  changedDepIndices: number[];
  changedDepOrigins: (DepOrigin | null)[];
  effectTag?: number;
  memoValue?: unknown;
  /** The hook body function (for useCallback) or memoized value (for useMemo) */
  hookBody?: Function | unknown;
}

export type ChangedHook =
  | {
      prevValue: unknown;
      currentValue: unknown;
      info?: string; // For structural changes
    }
  | 'repeat'; // Entire object replaced with string if identical to previous commit

export interface StateChangeResult {
  hasChange: boolean;
  actionable: boolean;
  changedIndices: number[];
  changedHooks: ChangedHook[];
  /** True if any of the changes came from useSyncExternalStore */
  hasExternalStoreChange: boolean;
}

export interface ThrashingResult {
  effects: ThrashInfo[];
  callbacks: ThrashInfo[];
  memos: ThrashInfo[];
}

// React fiber flags (React 18.3.1)
export const PerformedWork = 1;

// Flags relevant to filtering out non-preventable work from collateral counts.
// - Placement: mount/insert work (initial render)
// - Hydrating: work done while hydrating server-rendered markup
// These are stable for React 18.x.
export const Placement = 2;
export const Hydrating = 4096;

// Special sentinel values for hook change detection

// Component fiber tags for React 18.3.1 (stable within 18.x)
// 0: FunctionComponent, 1: ClassComponent, 2: IndeterminateComponent
// 11: MemoComponent, 14: SimpleMemoComponent, 15: ForwardRef
const COMPONENT_TAGS = new Set([0, 1, 2, 11, 14, 15]);

// Context Provider tag
const CONTEXT_PROVIDER_TAG = 10;

// Suspense fiber tag (React 18.3.1 — stable within 18.x)
export const SuspenseTag = 13;

// ChildDeletion — set on fiber.flags (NOT subtreeFlags) when the fiber has deletions[].
// Value 16 is stable for React 18.3.1.
export const ChildDeletion = 16;

// Update — set on fiber.flags when the fiber received an update this commit.
// This is the flag React puts on Suspense fibers when they transition state.
// Value 4 is stable for React 18.3.1.
export const Update = 4;

// DidCapture — render-phase flag, cleared before commit. Do NOT check at commit time.
// Kept for documentation. Value 128 in React 18.3.1.
export const DidCapture = 128;

export function isComponentFiber(tag: number): boolean {
  return COMPONENT_TAGS.has(tag);
}

export function isContextProviderFiber(tag: number): boolean {
  return tag === CONTEXT_PROVIDER_TAG;
}

export function isSuspenseFiber(tag: number): boolean {
  return tag === SuspenseTag;
}

/**
 * Detect whether a Suspense boundary transitioned between suspended/unsuspended states.
 *
 * Suspense memoizedState is:
 *   null                → primary content is showing (not suspended)
 *   non-null (object)   → boundary is showing the fallback (suspended/dehydrated)
 *
 * Returns:
 *   { entered: true }  — boundary just entered fallback
 *                        - null → non-null (update path)
 *                        - no alternate + memoizedState non-null (first render directly to fallback)
 *   { left: true }     — boundary just left fallback / revealed primary (non-null → null)
 *   null               — no state change (both null, both non-null, or first render not suspended)
 *
 * A Suspense that renders without delay never enters fallback, so memoizedState stays
 * null → returns null → correctly ignored by the detector.
 */
export function didSuspenseStateChange(
  fiber: Fiber
): { entered: boolean; left: boolean } | null {
  const currSuspended = fiber.memoizedState !== null;

  if (!fiber.alternate) {
    // First render of this Suspense boundary.
    // If it went directly to fallback (memoizedState non-null), that IS an enter.
    // If it rendered primary content (memoizedState null), no transition.
    if (currSuspended) {
      return { entered: true, left: false };
    }
    return null;
  }

  const prevSuspended = fiber.alternate.memoizedState !== null;
  if (prevSuspended === currSuspended) return null;
  return { entered: currSuspended, left: prevSuspended };
}

/**
 * Check if a Context Provider's value changed.
 */
export function didContextValueChange(fiber: Fiber): boolean {
  if (fiber.tag !== CONTEXT_PROVIDER_TAG || !fiber.alternate) return false;

  type FiberWithProps = Fiber & { memoizedProps?: { value?: unknown } };
  const alternateFiber: FiberWithProps = fiber.alternate;
  const currentFiber: FiberWithProps = fiber;

  const prevProps = alternateFiber.memoizedProps;
  const currentProps = currentFiber.memoizedProps;

  return prevProps && currentProps && !Object.is(prevProps.value, currentProps.value);
}

// Detect React built-in fiber types (Suspense/Offscreen/etc).
// IMPORTANT: Do NOT use component names. User components can be named anything.
// In React 18, built-ins like Suspense/Offscreen are represented as symbols.
export function isReactInternalComponentType(type: ComponentType): boolean {
  return typeof type === 'symbol';
}

export function getComponentName(fiber: Fiber): string {
  const named = readComponentName(fiber.type) || readComponentName(fiber.elementType);
  if (named) return named;
  const source = getFiberSourceCandidate(fiber);
  return (source && `<${source.fileName}:${source.lineNumber}>`) || 'Anonymous';
}

/**
 * Check if hook is a state hook (useState/useReducer/useSyncExternalStore).
 *
 * All hooks share a base shape. The reliable differentiators:
 * - useState/useReducer: queue.dispatch is a function
 * - useSyncExternalStore: queue has 'value' and 'getSnapshot' properties
 */
export function isStateHook(hook: Hook): boolean {
  const queue = hook.queue;
  if (!queue) return false;

  return typeof queue.dispatch === 'function' || ('value' in queue && 'getSnapshot' in queue);
}

/** True if the hook is a useSyncExternalStore-like hook. */
export function isExternalStoreHook(hook: Hook): boolean {
  const queue = hook.queue;
  return (
    queue && typeof queue.dispatch !== 'function' && 'value' in queue && 'getSnapshot' in queue
  );
}

/**
 * Compare hook chains to detect state changes.
 *
 * IMPORTANT: Hook indices are React internal memoizedState indices, NOT code order.
 * `useContext` hooks are not in memoizedState, causing index misalignment.
 */
export function detectHookStateChanges(
  prevHookChain: Hook | null,
  currentHookChain: Hook | null
): StateChangeResult {
  if (prevHookChain === currentHookChain) {
    return {
      hasChange: false,
      actionable: false,
      changedIndices: [],
      changedHooks: [],
      hasExternalStoreChange: false,
    };
  }

  let prevHook = prevHookChain;
  let currentHook = currentHookChain;
  let memoizedStateIndex = 0;
  const changedIndices: number[] = [];
  const changedHooks: ChangedHook[] = [];
  let hasExternalStoreChange = false;

  while (prevHook && currentHook) {
    if (isStateHook(currentHook)) {
      const prevValueRaw =
        prevHook.memoizedState === undefined
          ? prevHook.queue?.lastRenderedState
          : prevHook.memoizedState;
      const curValueRaw =
        currentHook.memoizedState === undefined
          ? currentHook.queue?.lastRenderedState
          : currentHook.memoizedState;

      if (!Object.is(prevValueRaw, curValueRaw)) {
        const isExternal = isExternalStoreHook(currentHook);
        if (isExternal) hasExternalStoreChange = true;

        changedIndices.push(memoizedStateIndex);
        changedHooks.push({
          prevValue: prevValueRaw,
          currentValue: curValueRaw,
          ...(isExternal && { isExternalStore: true }),
        });
      }
    }

    prevHook = prevHook.next;
    currentHook = currentHook.next;
    memoizedStateIndex++;
  }

  return {
    hasChange: changedIndices.length > 0,
    actionable: changedIndices.length > 0,
    changedIndices,
    changedHooks,
    hasExternalStoreChange,
  };
}

/**
 * Detect thrashing for hooks with deps: useEffect/useLayoutEffect/useInsertionEffect,
 * useCallback and useMemo.
 */
export function detectHookThrashing(
  prevHookChain: Hook | null,
  currentHookChain: Hook | null,
  mode: 'non-primitive' | 'all' = 'non-primitive',
  valueProvenance: WeakMap<object | Function, DepOrigin> | null = null
): ThrashingResult {
  if (prevHookChain === currentHookChain) {
    return { effects: [], callbacks: [], memos: [] };
  }

  const thrashedEffects: ThrashInfo[] = [];
  const thrashedCallbacks: ThrashInfo[] = [];
  const thrashedMemos: ThrashInfo[] = [];

  let prevHook = prevHookChain;
  let currentHook = currentHookChain;
  let hookIndex = 0;

  while (prevHook && currentHook) {
    if (!isStateHook(currentHook)) {
      const prevValue = prevHook.memoizedState;
      const currentValue = currentHook.memoizedState;

      let prevDeps: unknown[] | null = null;
      let currentDeps: unknown[] | null = null;
      let hookType: ThrashInfo['hookType'] | null = null;

      // Effect hooks store an object with `deps`.
      if (
        prevValue &&
        currentValue &&
        typeof prevValue === 'object' &&
        typeof currentValue === 'object' &&
        'deps' in prevValue &&
        'deps' in currentValue &&
        'tag' in currentValue
      ) {
        type EffectHook = { deps: unknown[] };
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        prevDeps = (prevValue as EffectHook).deps;
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        currentDeps = (currentValue as EffectHook).deps;
        hookType = 'effect';
      }
      // useMemo/useCallback store [result, deps].
      else if (
        Array.isArray(prevValue) &&
        Array.isArray(currentValue) &&
        prevValue.length === 2 &&
        currentValue.length === 2 &&
        Array.isArray(prevValue[1]) &&
        Array.isArray(currentValue[1])
      ) {
        prevDeps = prevValue[1];
        currentDeps = currentValue[1];
        hookType = typeof currentValue[0] === 'function' ? 'callback' : 'memo';
      }

      if (hookType && Array.isArray(prevDeps) && Array.isArray(currentDeps)) {
        const changedDepIndices: number[] = [];
        const changedDepOrigins: (DepOrigin | null)[] = [];

        // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
        for (let j = 0; j < currentDeps.length; j++) {
          if (!Object.is(prevDeps[j], currentDeps[j])) {
            changedDepIndices.push(j);

            let origin: DepOrigin | null = null;
            const dep = currentDeps[j];
            if (
              valueProvenance &&
              dep != null &&
              (typeof dep === 'object' || typeof dep === 'function')
            ) {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              origin = valueProvenance.get(dep as object | ((...args: never[]) => unknown)) || null;
            }
            changedDepOrigins.push(origin);
          }
        }

        let shouldReport = changedDepIndices.length > 0;
        if (shouldReport && mode === 'non-primitive') {
          // Only report if at least one non-primitive dep changed.
          // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
          shouldReport = changedDepIndices.some((idx) => {
            const dep = currentDeps[idx];
            const t = typeof dep;
            return !(
              dep == null ||
              t === 'string' ||
              t === 'number' ||
              t === 'boolean' ||
              t === 'symbol' ||
              t === 'bigint'
            );
          });
        }

        if (shouldReport) {
          const thrashInfo: ThrashInfo = {
            hookIndex,
            hookType,
            deps: currentDeps,
            changedDepIndices,
            changedDepOrigins,
          };

          if (hookType === 'effect') {
            type EffectValue = { tag?: number; create?: Function };
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const effectValue = currentValue as EffectValue;
            thrashInfo.effectTag = effectValue.tag;
            // Capture the effect function itself (the create function)
            if (effectValue.create) {
              thrashInfo.hookBody = effectValue.create;
            }
            thrashedEffects.push(thrashInfo);
          } else if (hookType === 'callback') {
            type CallbackValue = [Function, unknown[]];
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const callbackFn = (currentValue as CallbackValue)[0];
            // Capture the callback function itself
            thrashInfo.hookBody = callbackFn;
            thrashedCallbacks.push(thrashInfo);
          } else {
            type MemoValue = [unknown, unknown[]];
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const memoValue = (currentValue as MemoValue)[0];
            thrashInfo.memoValue = memoValue;
            // For useMemo, also expose the memoized value as hookBody
            thrashInfo.hookBody = memoValue;
            thrashedMemos.push(thrashInfo);
          }
        }
      }
    }

    prevHook = prevHook.next;
    currentHook = currentHook.next;
    hookIndex++;
  }

  return {
    effects: thrashedEffects,
    callbacks: thrashedCallbacks,
    memos: thrashedMemos,
  };
}

export function didFiberUpdate(fiber: Fiber): boolean {
  // eslint-disable-next-line no-bitwise
  return (fiber.flags & PerformedWork) !== 0;
}

/**
 * Detect if fiber has actionable hook state changes by comparing with fiber.alternate.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  ⚠️  WARNING: fiber.alternate COMPARISON IS UNRELIABLE                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * This function compares fiber.memoizedState vs fiber.alternate.memoizedState.
 *
 * THE PROBLEM:
 *   fiber.alternate is NOT always "state from the previous commit".
 *   It's "state from last time this fiber was used as work-in-progress".
 *
 *   If a component re-renders due to parent/context changes (not self-update),
 *   its alternate may be stale - from 1 commit ago, or 100 commits ago!
 *
 *   This causes FALSE POSITIVES: we detect "state changed" when it didn't
 *   change in THIS commit - it changed in some PAST commit.
 *
 * WHEN THIS FUNCTION IS RELIABLE:
 *   ✓ Component called setState (it IS the initiator)
 *   ✓ Component has useSyncExternalStore that just triggered
 *   ✓ Used alongside memoizedUpdaters validation
 *
 * WHEN THIS FUNCTION IS UNRELIABLE:
 *   ✗ Component re-rendered due to parent update
 *   ✗ Component re-rendered due to context change
 *   ✗ Component was memoized and skipped N commits
 *   ✗ Any scenario where alternate wasn't recently updated
 *
 * RECOMMENDED USAGE:
 *   - In development: Use memoizedUpdaters to verify component is an initiator,
 *     THEN use this function to get hook change details.
 *   - In production: Use lastSeenHookState tracking (see detector.tsx)
 *     instead of relying on fiber.alternate.
 *
 * See detector.tsx for the full explanation of the "swap" problem and solution.
 */
export function didFiberSelfUpdate(fiber: Fiber): StateChangeResult | null {
  // Early exit: only check fibers that actually rendered (have PerformedWork flag)
  if (!didFiberUpdate(fiber)) return null;

  const alt = fiber.alternate;
  if (!alt) return null;

  const prevState = alt.memoizedState;
  const currentState = fiber.memoizedState;

  const result = detectHookStateChanges(prevState, currentState);
  return result.hasChange ? result : null;
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}
