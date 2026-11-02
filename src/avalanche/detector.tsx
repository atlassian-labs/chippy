/**
 * Headless Profiler - React commit profiler (headless / no UI).
 *
 * This file intentionally keeps the commit traversal (`recordTree`) monolithic.
 * It runs on every React commit, and even small function-call overhead inside the
 * fiber-walk loops shows up in perf. We refactor everything *around* it.
 *
 * Detection Levels:
 * - Level 1 (STATS): Only commitStats - <1% overhead (~0.8ms avg)
 * - Level 2 (SOURCES): + source tracking - ~1-2% overhead (~1.3ms avg)
 * - Level 3 (AMPLIFIERS/FULL): + amplifier detection - ~2-3% overhead (~2.4ms avg)
 *
 * Peer FAQ
 * - Why is `recordTree()` huge? Performance: it's on the hot path (every commit).
 * - Why per-hook actionability? React can leave alternate hook memoizedState
 *   undefined (Suspense/Offscreen/concurrent artifacts) causing false positives.
 * - Why WeakMaps everywhere? To auto-GC tracked values/fibers without leaks.
 * - Why so few null checks? Debug tool: fail fast and loud on misuse/internals drift.
 * - Production? Use LEVEL1_STATS or LEVEL2_SOURCES for minimal overhead.
 */

import {
  ChildDeletion,
  detectHookThrashing,
  didContextValueChange,
  didFiberSelfUpdate,
  didFiberUpdate,
  didSuspenseStateChange,
  Hydrating,
  isComponentFiber,
  getComponentName,
  isContextProviderFiber,
  isDevelopment,
  isReactInternalComponentType,
  isSuspenseFiber,
  PerformedWork,
  Placement,
  Update,
  type ChangedHook,
  type ComponentType,
  type DepOrigin,
  type Fiber,
  type ThrashInfo,
} from './internals';

import {
  buildReport,
  type DetectorOptions,
  type ProfilerState,
  type PropChangeEvidence,
  type PropValueSummary,
  type RenderedComponentEvidence,
  type Report,
  type ReportOptions,
  type SortBy,
  type Source,
  type SuspenseBoundaryEvent,
  type ThrashMode,
  type UnmountSample,
} from './reporter';

import { createDebugRender, type HookCallEvent, type StackFrame } from '../debug-render/core';
import { getFiberSourceCandidate } from '../chippy-bridge/fiber-source';
import {
  type CommitMetricsAdapter,
  type CommitMetricsSnapshot,
  type IntegrationMode,
  getCommitMetricsAdapter,
} from './commit-metrics-adapter';
import { createCommitSurfaceOwnership } from './commit-surface-ownership';
import { createInteractionCapture } from './interaction-capture';
import {
  CS_UNMOUNTED_COMPONENTS,
  CS_UNMOUNTED_SUBTREES,
  CS_RESTARTS,
} from './commit-stats-indices';

function summarizeFiberSource(fiber: Fiber): { fileName: string; lineNumber: number } | null {
  const source = getFiberSourceCandidate(fiber);
  return source ? { fileName: source.fileName, lineNumber: source.lineNumber } : null;
}

/**
 * Installable detector.
 */
export function createAvalancheDetector(options: DetectorOptions = {}) {
  const {
    ignore = [],
    effectThrashMode = 'non-primitive',
    captureFibers = isDevelopment(),
    detectionMode = isDevelopment() ? 'full' : 'amplifiers',
    historySize = isDevelopment() ? 10 : 1,
  } = options;

  const mode = detectionMode;

  // Resolved on install(), so an adapter registered after the detector was
  // created still applies. `metricsAdapter: null` opts out of adapters.
  let metricsAdapter: CommitMetricsAdapter | null = null;
  const resolveMetricsAdapter = (): CommitMetricsAdapter | null =>
    options.metricsAdapter === undefined ? getCommitMetricsAdapter() : options.metricsAdapter;

  const ignoreSet = new Set(ignore);

  // Normalize detection mode to level
  // Level 1 (stats): Only commitStats with restarts - super fast
  // Level 2 (sources): Stats + source tracking - adds overhead for source detection
  // Level 3a (amplifierMetrics): Sources + aggregate amplifier counts - lightweight
  // Level 3b (amplifiers): Sources + full amplifier arrays - more detail
  // Legacy: 'full' is alias for 'amplifiers' (kept for backward compatibility)
  // TODO: Replace this open conditional chain with an exhaustive runtime
  // normalizer or fail-closed branch. TypeScript protects typed callers only;
  // unchecked shell/helper input can leave both variables undefined.
  let detectionLevel: 'stats' | 'sources' | 'amplifierMetrics' | 'amplifiers' | 'full';
  let thrashMode: ThrashMode;

  if (mode === true) {
    detectionLevel = 'full';
    thrashMode = 'full';
  } else if (mode === false) {
    detectionLevel = 'stats';
    thrashMode = false;
  } else if (mode === 'stats') {
    detectionLevel = 'stats';
    thrashMode = false;
  } else if (mode === 'sources') {
    detectionLevel = 'sources';
    thrashMode = false;
  } else if (mode === 'amplifiers') {
    detectionLevel = 'amplifiers';
    thrashMode = 'full';
  } else if (mode === 'amplifierMetrics') {
    detectionLevel = 'amplifierMetrics';
    thrashMode = 'counts';
  } else if (mode === 'full') {
    detectionLevel = 'full';
    thrashMode = 'full';
  }

  const enableSourceTracking = detectionLevel !== 'stats';
  const enableAmplifiers = thrashMode !== false;

  // Global WeakMap: value -> provenance. WeakMap ensures automatic GC.
  const valueProvenance = new WeakMap<object | Function, DepOrigin>();

  // Stable source ID manager - handles fiber alternate swaps
  // Uses WeakMap to track types and generate stable numeric IDs (fast, no string ops!)
  class StableSourceIdManager {
    private idMap = new WeakMap<Fiber, string>();
    // WeakMap only accepts objects/functions, not symbols. Store only valid keys.
    private typeToId = new WeakMap<object | Function, number>();
    private instanceCounters = new Map<string, number>(); // "typeId@depth" -> instance count
    private nextTypeId = 1;

    getSourceId(fiber: Fiber, type: ComponentType, depth: number): string {
      // Check if we already have an ID for this fiber
      let sourceId = this.idMap.get(fiber);
      if (sourceId) return sourceId;

      // Check if the alternate has an ID (same logical instance)
      if (fiber.alternate) {
        sourceId = this.idMap.get(fiber.alternate);
        if (sourceId) {
          // Map current fiber to the same ID
          this.idMap.set(fiber, sourceId);
          return sourceId;
        }
      }

      // Get or assign a numeric ID for this type (avoid stringifying functions!)
      // WeakMap keys must be objects/functions only. Strings/symbols/null get an
      // ephemeral numeric id for this pass but are never inserted into the WeakMap.
      const canBeWeakMapKey = (typeof type === 'object' && type !== null) || typeof type === 'function';
      const weakKey = canBeWeakMapKey ? (type as object | Function) : null;
      let typeId = weakKey ? this.typeToId.get(weakKey) : undefined;

      if (typeId === undefined) {
        typeId = this.nextTypeId++;
        if (weakKey) {
          this.typeToId.set(weakKey, typeId);
        }
      }

      // New instance - create ID with per-component-type counter
      const baseKey = `${typeId}@${depth}`;
      const instanceNum = this.instanceCounters.get(baseKey) || 1;
      this.instanceCounters.set(baseKey, instanceNum + 1);
      sourceId = `T${typeId}#${instanceNum}@${depth}`;

      // Map both current and alternate to this ID
      this.idMap.set(fiber, sourceId);
      if (fiber.alternate) {
        this.idMap.set(fiber.alternate, sourceId);
      }

      return sourceId;
    }

    clear() {
      this.instanceCounters.clear();
      this.typeToId = new WeakMap();
      this.nextTypeId = 1;
    }
  }

  const sourceIdManager = new StableSourceIdManager();
  const debugRender = createDebugRender();
  const interactionCapture = createInteractionCapture(options);

  function getComponentDisplayName(type: ComponentType | null | undefined): string {
    if (!type) return 'Unknown';
    return (type as { displayName?: string; name?: string }).displayName ||
      (type as { displayName?: string; name?: string }).name ||
      String(type);
  }

  function isDebugInternalFrame(frame: StackFrame, componentName: string): boolean {
    const name = frame.name || '';
    // Replay can run before install(), so fall back to the configured adapter.
    return !!(metricsAdapter ?? resolveMetricsAdapter())?.frameFilters?.includes(name) ||
      name === 'record' ||
      name === componentName ||
      name.includes('react-dom') ||
      name.includes('renderWithHooks') ||
      name.includes('mount') ||
      name.includes('update');
  }

  function parentFramesForEvent(event: HookCallEvent, componentName: string): StackFrame[] {
    return event.frames.filter((frame) => !isDebugInternalFrame(frame, componentName));
  }

  /** Snapshot the adapter's counters, or null when no adapter surface is live. */
  function captureMetricsSnapshot(): CommitMetricsSnapshot | null {
    return metricsAdapter?.snapshot() ?? null;
  }

  /**
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │  CRITICAL: Understanding fiber.alternate and the "swap" problem        │
   * └─────────────────────────────────────────────────────────────────────────┘
   *
   * WHAT WE THOUGHT:
   *   "fiber and fiber.alternate swap on every commit, so alternate always
   *    has state from the previous commit."
   *
   * WHAT ACTUALLY HAPPENS (from React Fiber Architecture docs):
   *   "At any time, a component instance has at most two fibers:
   *    the current (flushed) fiber, and the work-in-progress fiber.
   *    The alternate of the current fiber is the work-in-progress,
   *    and the alternate of the work-in-progress is the current fiber."
   *
   * THE TRAP:
   *   The alternate is only UPDATED when React uses it as work-in-progress.
   *   If a component re-renders due to parent/context (not self-update),
   *   React may or may NOT touch its alternate depending on:
   *   - Whether the component is on the "render path"
   *   - Whether React chose to clone vs reuse the fiber
   *   - Concurrent mode interruptions
   *   - Suspense/Offscreen boundaries
   *
   * CONCRETE EXAMPLE:
   *   Commit 1: Component mounts, state = 'initial'
   *   Commit 2: Component calls setState('loaded') via useEffect
   *   Commit 3-10: Parent re-renders, component re-renders (but no state change)
   *
   *   On commit 10, if we compare fiber vs alternate:
   *   - fiber.memoizedState = 'loaded' (current)
   *   - alternate.memoizedState = ???
   *     - MIGHT be 'loaded' (if alternate was used as work-in-progress recently)
   *     - MIGHT be 'initial' (if alternate is stale from commit 1!)
   *
   *   Result: FALSE POSITIVE - we detect "state changed" when it didn't!
   *
   * SYMPTOMS OF THIS BUG:
   *   - causedUpdates: 6 when real updates were 1
   *   - updateHistory full of "repeat" entries
   *   - collateralByCommit has entries for commits where component wasn't initiator
   *   - memoizedUpdaters disagrees with our detection
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │  WHY CAN'T WE JUST USE memoizedUpdaters?                               │
   * └─────────────────────────────────────────────────────────────────────────┘
   *
   * You might think: "React has `root.memoizedUpdaters` - a Set<Fiber> of
   * components that triggered updates. Why not just use that?"
   *
   * THE CATCH: memoizedUpdaters is ONLY populated when React DevTools is present!
   *
   * From react-dom source:
   *   var isDevToolsPresent = typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';
   *
   *   function addFiberToLanesMap(root, fiber, lanes) {
   *     if (!isDevToolsPresent) {
   *       return;  // ← EARLY RETURN! updaters never populated!
   *     }
   *     // ... adds to pendingUpdatersLaneMap, eventually to memoizedUpdaters
   *   }
   *
   * This means:
   *   - Users WITH React DevTools installed: memoizedUpdaters works ✅
   *   - Users WITHOUT DevTools: memoizedUpdaters is EMPTY ❌
   *
   * THE ADOPTION DILEMMA:
   *   To force memoizedUpdaters to work, we'd need to inject:
   *     globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { ... }
   *
   *   Problems with this approach:
   *   - Must be done BEFORE React loads (timing sensitive)
   *   - Side effect that might interfere with real DevTools
   *   - Side effect that might block tool adoption/approval
   *   - Cannot be done lazily (React checks once at startup)
   *
   * SOLUTION:
   *   Track our own "last seen state" per fiber. Update it on EVERY commit
   *   where the fiber renders. Compare against OUR snapshot, not alternate.
   *   This gives us accurate "previous state" regardless of alternate staleness.
   *
   * DUAL-MODE STRATEGY:
   *   - When memoizedUpdaters available (DevTools users): Trust React completely
   *   - When memoizedUpdaters empty (everyone else): Use lastSeenHookState
   *
   * This approach:
   *   ✅ Zero side effects - no DevTools hook injection required
   *   ✅ Zero false positives - accurate for all users
   *   ✅ Adoptable by any project - no special requirements
   *   ✅ Graceful dual-mode - best of both worlds
   *
   * The ~100 lines of lastSeenHookState code are NOT over-engineering.
   * Without them, users without DevTools would see 10x false positives
   * (e.g., 100 source detections instead of 10 in typical scenarios).
   *
   * References:
   *   - https://github.com/acdlite/react-fiber-architecture
   *   - https://jser.dev/2023-07-18-how-react-rerenders/
   *   - https://jser.dev/2023-06-19-how-does-usestate-work/
   */
  const lastSeenHookState = new WeakMap<Fiber, unknown[]>();

  /**
   * Capture current hook state chain as an array of memoizedState values.
   * Used to track what state we've "seen" for this fiber.
   */
  function captureHookStateSnapshot(fiber: Fiber): unknown[] {
    const snapshot: unknown[] = [];
    let hook = fiber.memoizedState;
    while (hook) {
      snapshot.push(hook.memoizedState);
      hook = hook.next;
    }
    return snapshot;
  }

  /**
   * Compare current hook state against our last-seen snapshot.
   * Returns indices of hooks that changed since we last saw this fiber.
   */
  function detectChangesFromLastSeen(
    fiber: Fiber,
    currentSnapshot: unknown[]
  ): { changedIndices: number[]; changedHooks: ChangedHook[] } {
    const lastSeen =
      lastSeenHookState.get(fiber) || (fiber.alternate && lastSeenHookState.get(fiber.alternate));

    const changedIndices: number[] = [];
    const changedHooks: ChangedHook[] = [];

    if (!lastSeen) {
      // First time seeing this fiber - no changes to report
      return { changedIndices, changedHooks };
    }

    // Compare each hook
    const maxLen = Math.max(lastSeen.length, currentSnapshot.length);
    for (let i = 0; i < maxLen; i++) {
      const prev = lastSeen[i];
      const curr = currentSnapshot[i];

      if (!Object.is(prev, curr)) {
        changedIndices.push(i);
        changedHooks.push({ prevValue: prev, currentValue: curr });
      }
    }

    return { changedIndices, changedHooks };
  }

  const state: ProfilerState = {
    commits: 0,
    sources: new Map(),
    amplifiers: new Map(),
    amplifierSources: new Map(),
    thrashCounts:
      thrashMode === 'counts'
        ? { totalHooks: 0, affectedComponents: new Set<ComponentType>() }
        : null,
    memoizedUpdatersAvailable: false,
    commitsWithMemoizedUpdaters: 0,
    // Per-commit stats: [collateral, effects, memos, callbacks]
    commitStats: {},
    // Per-commit adapter counter deltas
    metricsByCommit: {},
    lastMetricsSnapshot: null,
    // Per-commit timing data
    commitTimings: {},
    lastCommitEndTime: performance.now(),
    // Per-commit Suspense boundary transitions
    suspenseByCommit: {},
    unmountsByCommit: {},
    interactionActions: interactionCapture.state.actions,
    interactionsByCommit: interactionCapture.state.byCommit,
    renderedByCommit: {},
  };

  // Helper: push to history and trim if needed (called in aggregation, not hot path)
  function _pushToHistory<T>(history: T[], item: T, limit: number): void {
    history.push(item);
    if (history.length > limit) {
      history.splice(0, history.length - limit);
    }
  }

  type UpdateHistory = Record<
    number,
    Record<number, import('./internals.tsx').ChangedHook> | 'repeat' | string
  >;

  function trimHistoryToSize(updHistory: UpdateHistory, limit: number): UpdateHistory {
    const keys = Object.keys(updHistory)
      .map(Number)
      .sort((a, b) => a - b);
    const keysToKeep = keys.slice(keys.length - limit);
    const trimmed: UpdateHistory = {};
    keysToKeep.forEach((key) => {
      trimmed[key] = updHistory[key];
    });
    return trimmed;
  }

  function findLastConcreteHook(
    history: UpdateHistory,
    hookIndex: number,
    beforeCommitId: number
  ): ChangedHook | null {
    const commitIds = Object.keys(history)
      .map(Number)
      .filter((id) => id < beforeCommitId)
      .sort((a, b) => b - a);

    for (const commitId of commitIds) {
      const entry = history[commitId];
      if (entry && entry !== 'repeat' && typeof entry !== 'string') {
        const prev = entry[hookIndex];
        if (prev && prev !== 'repeat' && typeof prev === 'object') return prev;
      }
    }

    return null;
  }

  function summarizePropValue(value: unknown): PropValueSummary {
    const isArray = Array.isArray(value);
    const type = value === null ? 'null' : isArray ? 'array' : typeof value;
    const isFunction = typeof value === 'function';
    const isNull = value === null;
    const isPrimitive = value == null ||
      type === 'string' ||
      type === 'number' ||
      type === 'boolean' ||
      type === 'undefined' ||
      type === 'symbol' ||
      type === 'bigint';
    const primitiveDisplay = isPrimitive ? String(value) : undefined;
    const summary: PropValueSummary = {
      type,
      isArray,
      isFunction,
      isNull,
      preview: primitiveDisplay || (isFunction ? 'function' : isArray ? `array(${value.length})` : 'object'),
    };

    if (primitiveDisplay !== undefined) {
      summary.display = primitiveDisplay;
    }
    if (typeof value === 'string' || isArray) {
      summary.length = value.length;
    }
    if (isArray) {
      summary.sample = value.slice(0, 3).map((item) => summarizePropValue(item).preview);
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>).slice(0, 5);
      summary.keysTop = keys;
      summary.length = Object.keys(value as Record<string, unknown>).length;
      if (keys.length > 0) {
        summary.preview = `object{${keys.join(',')}}`;
      }
    } else if (isFunction) {
      const fn = value as Function;
      summary.preview = fn.name ? `function ${fn.name}` : 'function';
    }
    return summary;
  }

  function diffProps(prevProps: unknown, currentProps: unknown): PropChangeEvidence[] {
    const changes: PropChangeEvidence[] = [];
    const prev = prevProps && typeof prevProps === 'object' ? prevProps as Record<string, unknown> : {};
    const current = currentProps && typeof currentProps === 'object' ? currentProps as Record<string, unknown> : {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(current)]);

    keys.forEach((name) => {
      const prevHas = Object.prototype.hasOwnProperty.call(prev, name);
      const currentHas = Object.prototype.hasOwnProperty.call(current, name);
      const prevValue = prev[name];
      const currentValue = current[name];
      if (!prevHas && currentHas) {
        changes.push({ name, kind: 'added', prev: summarizePropValue(undefined), current: summarizePropValue(currentValue) });
      } else if (prevHas && !currentHas) {
        changes.push({ name, kind: 'removed', prev: summarizePropValue(prevValue), current: summarizePropValue(undefined) });
      } else if (Object.is(prevValue, currentValue)) {
        // Evidence surface records changes only; unchanged props stay implicit.
      } else if (
        prevValue !== null && currentValue !== null &&
        (typeof prevValue === 'object' || typeof prevValue === 'function' ||
         typeof currentValue === 'object' || typeof currentValue === 'function')
      ) {
        changes.push({ name, kind: 'ref-changed', prev: summarizePropValue(prevValue), current: summarizePropValue(currentValue) });
      } else {
        changes.push({ name, kind: 'scalar-changed', prev: summarizePropValue(prevValue), current: summarizePropValue(currentValue) });
      }
    });

    return changes;
  }

  function pushUpdateHistory(
    updHistory: UpdateHistory,
    commitId: number,
    changedHookIndices: number[],
    changedHooks: import('./internals.tsx').ChangedHook[]
  ): UpdateHistory {
    const entry: Record<number, import('./internals.tsx').ChangedHook> = {};

    // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
    for (let i = 0; i < changedHookIndices.length; i++) {
      const hookIndex = changedHookIndices[i];
      const hook = changedHooks[i];

      if (hook === 'repeat') {
        entry[hookIndex] = 'repeat';
      } else {
        const prevConcrete = findLastConcreteHook(updHistory, hookIndex, commitId);
        entry[hookIndex] =
          prevConcrete &&
          typeof prevConcrete === 'object' &&
          Object.is(hook.prevValue, prevConcrete.prevValue) &&
          Object.is(hook.currentValue, prevConcrete.currentValue)
            ? 'repeat'
            : hook;
      }
    }

    const newEntry = Object.values(entry).every((v) => v === 'repeat') ? 'repeat' : entry;
    return { ...updHistory, [commitId]: newEntry };
  }

  function recordTree(rootFiber: Fiber, memoizedUpdaters: Set<Fiber> | null = null): number {
    // NOTE: This function is intentionally monolithic for performance.
    // Keep inner loops allocation-free and avoid helper calls.

    // Track if memoizedUpdaters is available
    if (memoizedUpdaters && memoizedUpdaters.size > 0) {
      state.memoizedUpdatersAvailable = true;
      state.commitsWithMemoizedUpdaters++;
    }

    const perCommit = {
      selfUpdated: new Map<
        string,
        {
          type: ComponentType;
          depth: number;
          count: number;
          changedHookIndices: number[];
          changedHooks: ChangedHook[];
          fiber?: Fiber;
          isUpdater: boolean;
        }
      >(),
      thrashing: new Map<
        ComponentType,
        {
          instanceCount: number;
          hookCount: number;
          lastAmplification: { depth: number; thrashedHooks: ThrashInfo[]; fiber?: Fiber };
        }
      >(),
      /** Linked thrashing: keyed by sourceId, tracks per-component thrashing with linkage */
      linkedThrashing: new Map<
        string,
        {
          type: ComponentType;
          depth: number;
          effects: number;
          callbacks: number;
          memos: number;
          causedBySourceId: string | null;
          lastAmplification: { depth: number; thrashedHooks: ThrashInfo[]; fiber?: Fiber };
        }
      >(),
      rendered: [] as RenderedComponentEvidence[],
      selfFibers: new WeakMap<Fiber, number>(),
      sourceFibers: new Set<Fiber>(), // Track source fibers to exclude from collateral count
      blastBySourceId: new Map<string, number>(),
      depthBySourceId: new Map<string, number>(),
      // Simple counts for commitStats
      totalCollateral: 0,
      committedComponentCount: 0, // Components with PerformedWork that committed
      effectCount: 0,
      memoCount: 0,
      callbackCount: 0,
      contextUpdates: 0,
      // Unmount tracking (populated by deletions-array walk in visit())
      unmountedComponents: 0,
      unmountedSubtrees: 0,
      // Bounded identity samples for branch starts (topmost component fibers in
      // each deleted subtree). Cap to keep payload small.
      unmountSamples: null as UnmountSample[] | null,
      // Suspense boundary transition events collected during this commit's visit pass
      suspenseEvents: null as SuspenseBoundaryEvent[] | null,
    };

    // -------------------------------------------------------------------------
    // COMBINED PASS: Identify sources + attribute blast (O(n) not O(n*depth))
    // -------------------------------------------------------------------------
    function visit(
      fiber: Fiber | null,
      depth: number = 0,
      currentOwnerSourceId: string | null = null
    ) {
      if (!fiber) return;

      // OPTIMIZATION: Skip subtrees with no PerformedWork using subtreeFlags
      // React uses subtreeFlags to propagate flags up the tree. If neither the fiber
      // nor its subtree have PerformedWork (flag 0x1), we can skip this entire branch.
      // This matches React's own optimization during commit phase.
      //
      // Exception 1: Suspense fibers use DidCapture (128) not PerformedWork when suspending.
      // Exception 2: Fibers with ChildDeletion in subtreeFlags have deletions to track.
      // eslint-disable-next-line no-bitwise -- React fiber flags are bitmasks, bitwise AND is required
      const hasWorkInSubtree =
        // eslint-disable-next-line no-bitwise -- React fiber flags are bitmasks, bitwise AND is required
        (fiber.flags & PerformedWork) !== 0 ||
        // eslint-disable-next-line no-bitwise
        (fiber.subtreeFlags & PerformedWork) !== 0 ||
        // fiber.flags & ChildDeletion = this fiber has children being deleted this commit
        // (React sets ChildDeletion on fiber.flags, NOT subtreeFlags, at commit time)
        // eslint-disable-next-line no-bitwise
        (fiber.flags & ChildDeletion) !== 0 ||
        // subtreeFlags propagation — some descendant has deletions
        // eslint-disable-next-line no-bitwise
        (fiber.subtreeFlags & ChildDeletion) !== 0 ||
        // Suspense transitioning: React sets Update (4) on the Suspense fiber's flags at commit.
        // eslint-disable-next-line no-bitwise
        (isSuspenseFiber(fiber.tag) && (fiber.flags & Update) !== 0) ||
        // subtreeFlags & Update: a descendant (e.g. Suspense) received an Update this commit.
        // React propagates subtreeFlags upward — HostRoot and all intermediate host fibers
        // will have Update bit set if any descendant has it. This ensures we don't skip
        // the path to a Suspense boundary when no PerformedWork exists higher in the tree.
        // eslint-disable-next-line no-bitwise
        (fiber.subtreeFlags & Update) !== 0;
      if (!hasWorkInSubtree) {
        // No work in this fiber or its descendants - skip entire subtree
        // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
        if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
        return;
      }

      // Check for context provider value changes
      if (isContextProviderFiber(fiber.tag) && didContextValueChange(fiber)) {
        perCommit.contextUpdates++;
      }

      // Unmount detection via fiber.deletions.
      // React populates fiber.deletions[] during the render phase for fibers that
      // will be deleted in this commit. At commit time, React sets ChildDeletion (16)
      // on fiber.flags (NOT subtreeFlags) of the parent holding the deletions.
      // fiber.deletions is the list of child fibers being removed.
      // eslint-disable-next-line no-bitwise
      if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions && fiber.deletions.length > 0) {
        for (let di = 0; di < fiber.deletions.length; di++) {
          const deleted = fiber.deletions[di];
          // Walk the entire deleted subtree to collect all component fibers being removed.
          // We track whether a fiber's parent (in the deleted subtree) is also a component
          // so we can identify branch starts.
          function collectDeletions(
            df: Fiber,
            parentIsComponent: boolean,
            branchStartDepth: number,
            currentBranch: { count: number; sample: typeof perCommit.unmountSamples extends (infer A)[] | null ? A : never } | null
          ): void {
            const dfIsComponent = isComponentFiber(df.tag);
            let nextBranch = currentBranch;
            if (dfIsComponent) {
              perCommit.unmountedComponents++;
              if (!parentIsComponent) {
                // This is a branch start: topmost component in the deleted subtree
                perCommit.unmountedSubtrees++;
                if (perCommit.unmountSamples == null) perCommit.unmountSamples = [];
                if (perCommit.unmountSamples.length < 30) {
                  const fiberKey = (df as unknown as { key?: string | number | null }).key;
                  const sample = {
                    name: getComponentName(df),
                    key: fiberKey == null ? null : String(fiberKey),
                    depth: branchStartDepth,
                    count: 1,
                    source: summarizeFiberSource(df),
                    host: summarizeHostSubtree(df),
                  };
                  perCommit.unmountSamples.push(sample);
                  nextBranch = { count: 1, sample } as any;
                } else {
                  nextBranch = null;
                }
              } else if (currentBranch && currentBranch.sample) {
                currentBranch.sample.count++;
              }
              // Clean up last-seen hook state so future remounts start fresh
              lastSeenHookState.delete(df);
              if (df.alternate) lastSeenHookState.delete(df.alternate);
            }
            if (df.child) collectDeletions(df.child, dfIsComponent, branchStartDepth + 1, nextBranch);
            if (df.sibling) collectDeletions(df.sibling, parentIsComponent, branchStartDepth, currentBranch);
          }
          // Add one branch-level sample for the deleted subtree. React can hand us
          // a host/text wrapper as the deletion root, so find the first component
          // descendant to label the branch.
          if (perCommit.unmountSamples == null) perCommit.unmountSamples = [];
          if (perCommit.unmountSamples.length < 30) {
            let labelFiber: Fiber | null = deleted;
            if (!isComponentFiber(labelFiber.tag)) {
              const stack: Fiber[] = [labelFiber];
              labelFiber = null;
              while (stack.length) {
                const f = stack.pop()!;
                if (isComponentFiber(f.tag)) { labelFiber = f; break; }
                if (f.child) stack.push(f.child);
                if (f.sibling) stack.push(f.sibling);
              }
            }
            if (labelFiber) {
              const counts = countUnmountedComponentSubtree(deleted);
              const fiberKey = (labelFiber as unknown as { key?: string | number | null }).key;
              perCommit.unmountSamples.push({
                name: getComponentName(labelFiber),
                key: fiberKey == null ? null : String(fiberKey),
                depth,
                count: counts.components,
                source: summarizeFiberSource(labelFiber),
                host: summarizeHostSubtree(deleted),
              });
            }
          }
          collectDeletions(deleted, false, depth, null);
        }
      }

      const isComponent = isComponentFiber(fiber.tag);
      let ownerSourceId = currentOwnerSourceId;

      // Suspense boundary transition detection.
      // Only fires when the boundary actually entered or left the fallback state.
      // Boundaries that render without delay (memoizedState stays null) are silent.
      if (isSuspenseFiber(fiber.tag)) {
        const suspenseChange = didSuspenseStateChange(fiber);
        if (suspenseChange) {
          // Record the boundary transition for this commit
          if (!perCommit.suspenseEvents) {
            perCommit.suspenseEvents = [];
          }
          const event: SuspenseBoundaryEvent = {
            depth,
            entered: suspenseChange.entered,
            left: suspenseChange.left,
            ...(captureFibers && { fiber }),
          };
          perCommit.suspenseEvents.push(event);

          // Treat a Suspense boundary state-change as a source.
          // We use a synthetic stable key that encodes type+depth so the same boundary
          // accumulates across commits (same logic as regular sources).
          // The type sentinel is the React.Suspense symbol on the fiber.
          if (enableSourceTracking) {
            const suspenseType = fiber.type; // symbol — stable across renders
            const sourceId = sourceIdManager.getSourceId(fiber, suspenseType, depth);
            const suspenseHook: ChangedHook = {
              prevValue: suspenseChange.left ? 'suspended' : null,
              currentValue: suspenseChange.entered ? 'suspended' : null,
              info: suspenseChange.entered ? 'suspense:entered-fallback' : 'suspense:left-fallback',
            };
            perCommit.selfUpdated.set(sourceId, {
              type: suspenseType,
              depth,
              count: 1,
              changedHookIndices: [0],
              changedHooks: [suspenseHook],
              fiber: captureFibers ? fiber : undefined,
              isUpdater: true,
            });
            ownerSourceId = sourceId;
          }
        }
      }

      if (isComponent) {
        const type = fiber.type;

        // Count components with PerformedWork (committed work)
        if (didFiberUpdate(fiber)) {
          perCommit.committedComponentCount++;
        }

        // Early bailout: skip components that didn't update (no PerformedWork flag)
        if (!didFiberUpdate(fiber)) {
          // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
          if (fiber.child) visit(fiber.child, depth + 1, ownerSourceId);
          // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
          if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
          return;
        }

        if (!ignoreSet.has(type) && !isReactInternalComponentType(type)) {
          const componentSourceId = sourceIdManager.getSourceId(fiber, type, depth);
          const parentFiber = fiber.return && isComponentFiber(fiber.return.tag) ? fiber.return : null;
          const parentSourceId = parentFiber
            ? sourceIdManager.getSourceId(parentFiber, parentFiber.type, depth - 1)
            : null;
          const existingRenderEvidenceIndex = perCommit.rendered.findIndex(
            (entry) => entry.sourceId === componentSourceId
          );
          const initialRenderEvidence: RenderedComponentEvidence = {
            sourceId: componentSourceId,
            name: getComponentName(fiber),
            depth,
            parentSourceId,
            ownerSourceId,
            isSelfSource: false,
            propChanges: fiber.alternate ? diffProps(fiber.alternate.memoizedProps, fiber.memoizedProps) : [],
            hasPropChanges: false,
            trasherCounts: { effects: 0, callbacks: 0, memos: 0 },
          };
          initialRenderEvidence.hasPropChanges = initialRenderEvidence.propChanges.length > 0;
          if (existingRenderEvidenceIndex >= 0) {
            perCommit.rendered[existingRenderEvidenceIndex] = initialRenderEvidence;
          } else {
            perCommit.rendered.push(initialRenderEvidence);
          }

          // Track provenance of useCallback/useMemo results (only if amplifier detection enabled)
          if (enableAmplifiers) {
            let hook = fiber.memoizedState;
            let hookIndex = 0;

            while (hook) {
              const ms = hook.memoizedState;
              if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
                const result = ms[0];
                if (
                  result != null &&
                  (typeof result === 'object' || typeof result === 'function')
                ) {
                  valueProvenance.set(result, {
                    type,
                    hookIndex,
                    depth,
                    hookType: typeof result === 'function' ? 'useCallback' : 'useMemo',
                  });
                }
              }

              hook = hook.next;
              hookIndex++;
            }
          }

          // Source tracking (Level 2+): Capture hook state and detect sources
          // Skip entirely in 'stats' mode for maximum performance
          let currentHookSnapshot: unknown[] | null = null;
          if (enableSourceTracking) {
            currentHookSnapshot = captureHookStateSnapshot(fiber);
          }

          // Source detection strategy (Level 2+):
          // 1. If memoizedUpdaters available (development): trust it completely
          // 2. If memoizedUpdaters NOT available (production): use our own lastSeenHookState
          //    to avoid fiber.alternate lag false positives
          // Skip entirely in 'stats' mode (Level 1)

          let isRealSource = false;
          let changedIndices: number[] = [];
          let changedHooks: ChangedHook[] = [];

          if (enableSourceTracking) {
            const inMemoizedUpdaters = memoizedUpdaters
              ? memoizedUpdaters.has(fiber) ||
                (fiber.alternate && memoizedUpdaters.has(fiber.alternate))
              : null;

            if (memoizedUpdaters) {
              // DEVELOPMENT: Trust memoizedUpdaters completely
              if (inMemoizedUpdaters) {
                isRealSource = true;
                // Use didFiberSelfUpdate for the hook change details
                const selfUpdateResult = didFiberSelfUpdate(fiber);
                if (selfUpdateResult && selfUpdateResult.actionable) {
                  changedIndices = selfUpdateResult.changedIndices;
                  changedHooks = selfUpdateResult.changedHooks;
                }
              }
              // If not in memoizedUpdaters, skip this fiber as source
            } else {
              // PRODUCTION: Use our own tracking to avoid alternate lag
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const changes = detectChangesFromLastSeen(fiber, currentHookSnapshot!);
              if (changes.changedIndices.length > 0) {
                isRealSource = true;
                changedIndices = changes.changedIndices;
                changedHooks = changes.changedHooks;
              }
            }

            // Update our last-seen snapshot for this fiber (always, even if not a source)
            // This ensures we have accurate "previous state" for next commit
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            lastSeenHookState.set(fiber, currentHookSnapshot!);
            if (fiber.alternate) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              lastSeenHookState.set(fiber.alternate, currentHookSnapshot!);
            }
          }

          if (isRealSource && changedIndices.length > 0) {
            const sourceId = componentSourceId;

            // Track that this fiber is a source (so we don't count it as its own collateral)
            perCommit.sourceFibers.add(fiber);
            if (fiber.alternate) {
              perCommit.sourceFibers.add(fiber.alternate);
            }

            const existing = perCommit.selfUpdated.get(sourceId);

            const updateData = {
              type,
              depth,
              count: (existing?.count || 0) + 1,
              changedHookIndices: changedIndices,
              changedHooks: changedHooks,
              fiber: captureFibers ? fiber : undefined,
              isUpdater: true,
            };

            perCommit.selfUpdated.set(sourceId, updateData);
            perCommit.selfFibers.set(fiber, depth);

            // This fiber is now the owner for all descendants
            ownerSourceId = sourceId;
          }

          // Blast radius attribution: if this fiber updated and we have an owner, attribute it
          // ONLY count component fibers (not host nodes like div, span, etc.)
          // DON'T count if this fiber IS the owner (don't count source as its own collateral!)
          const isSourceItself = perCommit.sourceFibers.has(fiber);

          // Don't count mount/hydration work as "collateral" (not preventable).
          // eslint-disable-next-line no-bitwise
          const isNonPreventable = (fiber.flags & (Placement | Hydrating)) !== 0;

          if (
            isComponent &&
            fiber.alternate &&
            didFiberUpdate(fiber) &&
            ownerSourceId &&
            !isSourceItself &&
            !isNonPreventable
          ) {
            perCommit.blastBySourceId.set(
              ownerSourceId,
              (perCommit.blastBySourceId.get(ownerSourceId) || 0) + 1
            );

            const currentMax = perCommit.depthBySourceId.get(ownerSourceId) || 0;
            if (depth > currentMax) {
              perCommit.depthBySourceId.set(ownerSourceId, depth);
            }

            // Count total collateral for commitStats
            perCommit.totalCollateral++;
          }

          const renderedEntry = perCommit.rendered.find((entry) => entry.sourceId === componentSourceId);
          if (renderedEntry) {
            renderedEntry.ownerSourceId = ownerSourceId;
            renderedEntry.isSelfSource = isRealSource && changedIndices.length > 0;
          }

          // Amplifier detection (Level 3: counts/full).
          // Skip in 'stats' and 'sources' modes for better performance
          if (enableAmplifiers && didFiberUpdate(fiber) && fiber.alternate) {
            const thrashResult = detectHookThrashing(
              fiber.alternate.memoizedState,
              fiber.memoizedState,
              effectThrashMode,
              valueProvenance
            );

            const totalThrashing =
              thrashResult.effects.length +
              thrashResult.callbacks.length +
              thrashResult.memos.length;

            if (totalThrashing > 0) {
              if (thrashMode === 'counts') {
                if (state.thrashCounts) {
                  state.thrashCounts.affectedComponents.add(type);
                  state.thrashCounts.totalHooks += totalThrashing;
                }
              } else if (thrashMode === 'full') {
                const allThrashedHooks: ThrashInfo[] = [
                  ...thrashResult.effects,
                  ...thrashResult.callbacks,
                  ...thrashResult.memos,
                ];

                // Legacy amplifiers (keyed by type)
                const existing = perCommit.thrashing.get(type);
                const thrashData = {
                  instanceCount: (existing?.instanceCount || 0) + 1,
                  hookCount: (existing?.hookCount || 0) + totalThrashing,
                  lastAmplification: {
                    depth,
                    thrashedHooks: allThrashedHooks,
                    fiber: captureFibers ? fiber : undefined,
                  },
                };

                perCommit.thrashing.set(type, thrashData);

                // NEW: Linked amplification (keyed by sourceId)
                // Get or create sourceId for this fiber (even if not a source)
                const amplifierSourceId = sourceIdManager.getSourceId(fiber, type, depth);
                const existingLinked = perCommit.linkedThrashing.get(amplifierSourceId);

                const effects = (existingLinked?.effects || 0) + thrashResult.effects.length;
                const callbacks = (existingLinked?.callbacks || 0) + thrashResult.callbacks.length;
                const memos = (existingLinked?.memos || 0) + thrashResult.memos.length;
                perCommit.linkedThrashing.set(amplifierSourceId, {
                  type,
                  depth,
                  effects,
                  callbacks,
                  memos,
                  // If this fiber is a source, causedBySourceId is null (self-caused)
                  // If this fiber is collateral, ownerSourceId is who caused it
                  causedBySourceId: isRealSource ? null : ownerSourceId,
                  lastAmplification: {
                    depth,
                    thrashedHooks: allThrashedHooks,
                    fiber: captureFibers ? fiber : undefined,
                  },
                });

                const renderedEntry = perCommit.rendered.find((entry) => entry.sourceId === amplifierSourceId);
                if (renderedEntry) {
                  renderedEntry.trasherCounts = { effects, callbacks, memos };
                }

                // Count amplifiers for commitStats
                perCommit.effectCount += thrashResult.effects.length;
                perCommit.memoCount += thrashResult.memos.length;
                perCommit.callbackCount += thrashResult.callbacks.length;
              }
            }
          }
        }
      }

      // Propagate current owner to children (depth changes)
      // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
      if (fiber.child) visit(fiber.child, depth + 1, ownerSourceId);
      // Siblings stay at same depth and inherit parent's owner
      // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
      if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
    }

    visit(rootFiber);

    // -------------------------------------------------------------------------
    // PASS 3: Update global aggregates (not hot loop).
    // -------------------------------------------------------------------------
    state.commits++;

    for (const [sourceId, data] of perCommit.selfUpdated.entries()) {
      const { type, depth, count, changedHookIndices, fiber } = data;

      let s = state.sources.get(sourceId);
      if (!s) {
        s = {
          type,
          depth,
          renderCount: 0,
          causedUpdates: 0,
          collateralUpdates: 0,
          maxCollateralUpdates: 0,
          maxPenetrationDepth: 0,
          updateHistory: {},
          collateralByCommit: {}, // Per-commit collateral for this source
          debugHookIndices: changedHookIndices.slice(),
        };
        state.sources.set(sourceId, s);
      }

      s.renderCount++;
      s.debugHookIndices = changedHookIndices.slice();

      // Store update history for this commit - this determines if it's a "repeat" or new update
      const historyWithUpdate = pushUpdateHistory(
        s.updateHistory,
        state.commits,
        changedHookIndices,
        data.changedHooks
      );
      s.updateHistory = trimHistoryToSize(historyWithUpdate, historySize);

      // Check if this commit was a REAL update or just a "repeat"
      // Only count causedUpdates and collateral for REAL updates
      const thisCommitEntry = s.updateHistory[state.commits];
      const isRepeat = thisCommitEntry === 'repeat';

      if (!isRepeat && data.isUpdater) {
        // This is a NEW update (not a repeat) - count it
        s.causedUpdates += count;

        const blast = perCommit.blastBySourceId.get(sourceId) || 0;
        s.collateralUpdates += blast;
        if (blast > s.maxCollateralUpdates) s.maxCollateralUpdates = blast;

        // Store per-commit collateral for this source (only for real updates)
        s.collateralByCommit[state.commits] = blast;

        const penetrationDepth = perCommit.depthBySourceId.get(sourceId) || 0;
        if (penetrationDepth > s.maxPenetrationDepth) {
          s.maxPenetrationDepth = penetrationDepth;
        }
      }

      if (captureFibers && fiber) {
        s.fiber = fiber;
      }
    }

    if (enableAmplifiers && thrashMode === 'full') {
      // Legacy thrashers (keyed by type)
      for (const [type, data] of perCommit.thrashing.entries()) {
        let s = state.amplifiers.get(type);
        if (!s) {
          s = {
            renderCount: 0,
            instancesTotal: 0,
            maxInstancesPerCommit: 0,
            hooksTotal: 0,
            maxHooksPerCommit: 0,
            effectCount: 0,
            callbackCount: 0,
            memoCount: 0,
            lastAmplification: { depth: 0, thrashedHooks: [] },
          };
          state.amplifiers.set(type, s);
        }

        s.renderCount++;
        s.instancesTotal += data.instanceCount;
        s.hooksTotal += data.hookCount;
        if (data.instanceCount > s.maxInstancesPerCommit)
          s.maxInstancesPerCommit = data.instanceCount;
        if (data.hookCount > s.maxHooksPerCommit) s.maxHooksPerCommit = data.hookCount;

        // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
        data.lastAmplification.thrashedHooks.forEach((hook: ThrashInfo) => {
          if (hook.hookType === 'effect') s.effectCount++;
          else if (hook.hookType === 'callback') s.callbackCount++;
          else if (hook.hookType === 'memo') s.memoCount++;
        });

        s.lastAmplification = data.lastAmplification;
      }

      // NEW: Linked thrashers (keyed by sourceId)
      for (const [sourceId, data] of perCommit.linkedThrashing.entries()) {
        let as = state.amplifierSources.get(sourceId);
        if (!as) {
          as = {
            type: data.type,
            depth: data.depth,
            effectCount: 0,
            callbackCount: 0,
            memoCount: 0,
            hooksTotal: 0,
            commitIds: [],
            byCommit: {},
            causedBySourceId: data.causedBySourceId,
            lastAmplification: { depth: 0, thrashedHooks: [] },
          };
          state.amplifierSources.set(sourceId, as);
        }

        // Update counts
        as.effectCount += data.effects;
        as.callbackCount += data.callbacks;
        as.memoCount += data.memos;
        as.hooksTotal += data.effects + data.callbacks + data.memos;

        // Track which commits this amplifier fired in
        if (!as.commitIds.includes(state.commits)) {
          as.commitIds.push(state.commits);
        }

        // Per-commit breakdown
        as.byCommit[state.commits] = {
          effects: data.effects,
          callbacks: data.callbacks,
          memos: data.memos,
        };

        // Update causedBySourceId (use latest if different)
        if (data.causedBySourceId !== null) {
          as.causedBySourceId = data.causedBySourceId;
        }

        as.lastAmplification = data.lastAmplification;
      }
    }

    // Persist Suspense events for this commit
    if (perCommit.suspenseEvents && perCommit.suspenseEvents.length > 0) {
      state.suspenseByCommit[state.commits] = perCommit.suspenseEvents;
    }

    if (perCommit.rendered.length > 0) {
      state.renderedByCommit[state.commits] = perCommit.rendered;
    }

    // Store commitStats: [collateral, sources, restarts, performedWork, effects, memos, callbacks, contextUpdates, unmountedComponents, unmountedSubtrees]
    //
    // ALL fiber-walk-derived fields (collateral, sources, performedWork, effects,
    // memos, callbacks, contextUpdates) are real measurements that come from this
    // very recordTree() call. They are populated identically in 'adapter:<id>'
    // and 'devtools' integration modes — the fiber tree is the same in both.
    //
    // The ONLY adapter-exclusive field is `restarts` (index 2). It is
    // initialized to 0 here and overwritten after the adapter's delta
    // calculation in handleCommit. In 'devtools' mode there is no
    // render-counter delta available, so it stays at 0. Consumers should
    // consult report.meta.dataAvailability.restarts to disambiguate "no
    // restarts measured" (0 in 'devtools' mode = unknown) from "zero restarts
    // confirmed" (0 in 'adapter:<id>' mode = real).
    state.commitStats[state.commits] = [
      perCommit.totalCollateral,
      perCommit.selfUpdated.size, // Number of sources in this commit
      0, // restarts - will be updated after the adapter's delta calculation
      perCommit.committedComponentCount, // performedWork - components with PerformedWork flag
      perCommit.effectCount,
      perCommit.memoCount,
      perCommit.callbackCount,
      perCommit.contextUpdates,
      perCommit.unmountedComponents,
      perCommit.unmountedSubtrees,
    ];

    if (perCommit.unmountSamples && perCommit.unmountSamples.length > 0) {
      state.unmountsByCommit[state.commits] = perCommit.unmountSamples;
    }

    // Return committed component count for restart calculation
    return perCommit.committedComponentCount;
  }

  function resetState(): void {
    state.commits = 0;
    state.sources.clear();
    state.amplifiers.clear();
    state.amplifierSources.clear();
    if (state.thrashCounts) {
      state.thrashCounts.totalHooks = 0;
      state.thrashCounts.affectedComponents.clear();
    }
    state.memoizedUpdatersAvailable = false;
    state.commitsWithMemoizedUpdaters = 0;
    // Clear commitStats
    for (const key of Object.keys(state.commitStats)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.commitStats[Number(key)];
    }
    // Clear adapter per-commit data
    for (const key of Object.keys(state.metricsByCommit)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.metricsByCommit[Number(key)];
    }
    // Clear timing data
    for (const key of Object.keys(state.commitTimings)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.commitTimings[Number(key)];
    }
    // Clear Suspense boundary transitions
    for (const key of Object.keys(state.suspenseByCommit)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.suspenseByCommit[Number(key)];
    }
    // Clear unmount samples
    for (const key of Object.keys(state.unmountsByCommit)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.unmountsByCommit[Number(key)];
    }
    // Clear rendered component evidence
    for (const key of Object.keys(state.renderedByCommit)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete state.renderedByCommit[Number(key)];
    }
    interactionCapture.reset();
    // Recapture adapter snapshot as new baseline
    state.lastMetricsSnapshot = captureMetricsSnapshot();
    // Reset timing baseline
    state.lastCommitEndTime = performance.now();
    sourceIdManager.clear();
  }

  type DevtoolsHook = {
    onCommitFiberRoot?: (...args: unknown[]) => void;
    onCommitFiberUnmount?: (...args: unknown[]) => void;
    [key: string]: unknown;
  };

  type GlobalWithDevtools = typeof globalThis & {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook;
  };

  const commitSurface = createCommitSurfaceOwnership<{
    commitId: number;
    committedComponents: number;
    metricsBefore: CommitMetricsSnapshot | null;
  }>();

  // Chained predecessor on the DevTools hook (real React DevTools, etc.) — so
  // augmenting the hook never breaks an existing client. Restored on uninstall.
  let devtoolsHookPrev: ((...args: unknown[]) => void) | undefined;
  let devtoolsUnmountPrev: ((...args: unknown[]) => void) | undefined;
  // Was the DevTools hook present before install()? Tells uninstall whether to
  // delete it entirely or just restore the previous handler.
  let devtoolsHookCreatedByUs = false;

  // React's DevTools surface reports unmounted fibers via onCommitFiberUnmount.
  // Keep a small buffer between those callbacks and the following root commit;
  // this catches deletion work even if `fiber.deletions[]` has been cleared by
  // the time onCommitFiberRoot runs.
  let pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
  let pendingDevtoolsUnmountSamples: UnmountSample[] = [];

  // Integration mode is OBSERVED, not declared. Starts at 'devtools' (we always
  // own the DevTools surface after install). Promoted to 'adapter:<id>' on the
  // first adapter callback that proves the host surface is actually running.
  // Returns to 'none' only on uninstall.
  let integrationMode: IntegrationMode = 'none';

  function countUnmountedComponentSubtree(fiber: Fiber | null, parentIsComponent = false): { components: number; subtrees: number } {
    if (!fiber) return { components: 0, subtrees: 0 };
    const isComponent = isComponentFiber(fiber.tag);
    let components = isComponent ? 1 : 0;
    let subtrees = isComponent && !parentIsComponent ? 1 : 0;
    if (fiber.child) {
      const child = countUnmountedComponentSubtree(fiber.child, isComponent);
      components += child.components;
      subtrees += child.subtrees;
    }
    if (fiber.sibling) {
      const sibling = countUnmountedComponentSubtree(fiber.sibling, parentIsComponent);
      components += sibling.components;
      subtrees += sibling.subtrees;
    }
    return { components, subtrees };
  }

  function summarizeHostSubtree(fiber: Fiber | null): {
    elements: number;
    text: number;
    tagsTop: Array<[string, number]>;
    testIdsTop: Array<[string, number]>;
    rolesTop: Array<[string, number]>;
    ariaLabels: string[];
    textHints: string[];
  } {
    const tags = new Map<string, number>();
    const testIds = new Map<string, number>();
    const roles = new Map<string, number>();
    const ariaLabels: string[] = [];
    const textHints: string[] = [];
    let elements = 0;
    let text = 0;
    const add = (map: Map<string, number>, key: unknown) => {
      if (typeof key !== 'string' || !key) return;
      map.set(key, (map.get(key) || 0) + 1);
    };
    const addHint = (arr: string[], value: unknown, max = 6) => {
      if (typeof value !== 'string') return;
      const trimmed = value.replace(/\s+/g, ' ').trim();
      if (!trimmed || arr.includes(trimmed)) return;
      arr.push(trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed);
      if (arr.length > max) arr.length = max;
    };
    const top = (map: Map<string, number>) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const walk = (f: Fiber | null) => {
      if (!f) return;
      if (f.tag === 5) {
        elements++;
        const props = (f.memoizedProps || {}) as Record<string, unknown>;
        add(tags, typeof f.type === 'string' ? f.type : 'host');
        add(testIds, props['data-testid']);
        add(roles, props.role);
        addHint(ariaLabels, props['aria-label']);
        addHint(ariaLabels, props.title);
        addHint(textHints, typeof props.children === 'string' ? props.children : null);
      } else if (f.tag === 6) {
        text++;
        addHint(textHints, f.memoizedProps);
      }
      walk(f.child);
      walk(f.sibling);
    };
    walk(fiber);
    return { elements, text, tagsTop: top(tags), testIdsTop: top(testIds), rolesTop: top(roles), ariaLabels, textHints };
  }

  function recordMetricsEvidence(
    commitId: number,
    committedComponents: number,
    before: CommitMetricsSnapshot,
    after: CommitMetricsSnapshot,
  ): void {
    if (!metricsAdapter) return;
    const { delta, restarts } = metricsAdapter.measure(before, after, committedComponents, commitId);
    state.metricsByCommit[commitId] = delta;
    if (state.commitStats[commitId]) {
      state.commitStats[commitId][CS_RESTARTS] = restarts;
    }
  }
  /**
   * Core commit handler — shared by the adapter and DevTools paths.
   * metricsDeltaAvailable: true only when the adapter's counters are live.
   */
  function handleCommit(
    root: { current: Fiber; memoizedUpdaters?: Set<Fiber> },
    metricsDeltaAvailable: boolean
  ): number {
    // Renderer internals are guaranteed to exist by the time commit hooks fire.
    // Installing here arms passive hook stack capture for subsequent real renders
    // without invoking product components during inspection.
    debugRender.install();
    const commitHookStartTime = performance.now();
    const timeSinceLastCommit = commitHookStartTime - state.lastCommitEndTime;

    const metricsBefore = state.lastMetricsSnapshot || captureMetricsSnapshot();

    const memoizedUpdaters = root.memoizedUpdaters;
    const committedComponents = recordTree(root.current, memoizedUpdaters || null);

    // `recordTree` counts deletions from fiber.deletions[]. Some renderers clear
    // that array before the final root callback, while still calling the DevTools
    // unmount hook. We use the DevTools surface as a FALLBACK when recordTree saw
    // no deletions this commit. We do NOT merge with max() — DevTools fires
    // onCommitFiberUnmount per-descendant (not per-subtree-root), so summing
    // produces inflated subtree counts for nested deletions (e.g. Mid > Leaf
    // → DevTools fires twice → counts as 2 subtrees instead of 1).
    const currentStats = state.commitStats[state.commits];
    if (currentStats && (pendingDevtoolsUnmounts.components > 0 || pendingDevtoolsUnmounts.subtrees > 0)) {
      const recordTreeSawDeletions = (currentStats[CS_UNMOUNTED_COMPONENTS] || 0) > 0;
      if (!recordTreeSawDeletions) {
        // Fallback: recordTree didn't see fiber.deletions[] (renderer cleared it
        // before commit). Trust DevTools counts even though they may over-report
        // subtrees for nested deletions — better some signal than none.
        currentStats[CS_UNMOUNTED_COMPONENTS] = pendingDevtoolsUnmounts.components;
        currentStats[CS_UNMOUNTED_SUBTREES] = pendingDevtoolsUnmounts.subtrees;
      }
      pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
    }
    if (pendingDevtoolsUnmountSamples.length > 0) {
      const existing = state.unmountsByCommit[state.commits];
      if (existing && existing.length > 0) {
        // Prefer deletion-walk samples (have depth). Drop devtools samples to
        // avoid noisy duplicates.
      } else {
        state.unmountsByCommit[state.commits] = pendingDevtoolsUnmountSamples;
      }
      pendingDevtoolsUnmountSamples = [];
    }

    const metricsAfter = captureMetricsSnapshot();
    if (metricsDeltaAvailable && metricsBefore && metricsAfter) {
      recordMetricsEvidence(state.commits, committedComponents, metricsBefore, metricsAfter);
    }
    state.lastMetricsSnapshot = metricsAfter;

    const commitHookEndTime = performance.now();
    interactionCapture.linkRecent(state.commits, commitHookEndTime);
    state.commitTimings[state.commits] = {
      timeSinceLastCommit,
      detectorOverhead: commitHookEndTime - commitHookStartTime,
    };
    state.lastCommitEndTime = commitHookEndTime;
    return committedComponents;
  }

  return {
    /**
     * Start profiling React commits.
     *
     * Integration model is OBSERVED at runtime, not declared at install time.
     *
     *   'devtools'     — DevTools `onCommitFiberRoot` is the canonical entry
     *                    point. We define the hook if absent, augment (chain)
     *                    if present. On every commit we capture the fiber tree.
     *
     *   'adapter:<id>' — Promoted from 'devtools' the first time the commit
     *                    metrics adapter's host callback actually fires for a
     *                    real commit. From then on the adapter is the
     *                    authoritative processor and the DevTools surface is
     *                    chained-observer-only. The adapter is preferred when
     *                    alive because it carries render-counter deltas
     *                    (restart math, metricsByCommit).
     *
     *   'none'         — Only when no DevTools hook surface can be created and
     *                    no adapter surface is reachable. Practically never
     *                    hit, since the content-script ships a
     *                    devtools-hook-shim before react-dom.
     *
     * Double-invocation safety:
     *   Once an adapter callback has fired, DevTools remains chained for
     *   existing tooling but does not capture commits; the adapter alone calls
     *   `handleCommit`. Without a live adapter, DevTools is the capture
     *   surface. This avoids duplicate capture without relying on per-root
     *   timing heuristics.
     *
     * Side effects:
     *   - Defines `__REACT_DEVTOOLS_GLOBAL_HOOK__` if it does not already exist
     *     (minimal contract: `onCommitFiberRoot` only). React reads the hook at
     *     module-eval time; the content-script shim handles ordering.
     *   - Asks the adapter (when one is registered) to route its host commit
     *     callback here, *if and when* the host calls it.
     *
     * Safe to call multiple times (idempotent: chains skipped when our wrappers
     * are already in place).
     */
    install(): void {
      interactionCapture.install();
      const devtoolsGlobal = globalThis as GlobalWithDevtools;
      metricsAdapter = resolveMetricsAdapter();
      // Capture an initial adapter snapshot regardless. If the host surface is
      // dead these counters stay at zero and the delta is a no-op.
      state.lastMetricsSnapshot = captureMetricsSnapshot();

      // ── 1. Ensure a DevTools hook surface exists ───────────────────────────
      // React calls __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot on every
      // commit when the hook is present at react-dom eval time. We define a
      // minimal hook if nothing is there; otherwise we augment the existing one.
      let hook = devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!hook) {
        hook = {} as DevtoolsHook;
        devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
        devtoolsHookCreatedByUs = true;
      } else {
        devtoolsHookCreatedByUs = false;
      }

      devtoolsHookPrev = typeof hook.onCommitFiberRoot === 'function'
        ? hook.onCommitFiberRoot
        : undefined;
      devtoolsUnmountPrev = typeof hook.onCommitFiberUnmount === 'function'
        ? hook.onCommitFiberUnmount
        : undefined;

      const devtoolsHandler = (...args: unknown[]) => {
        // Always chain whatever was there first (real React DevTools, other
        // tooling). Errors in third-party handlers must not poison React.
        if (devtoolsHookPrev) {
          try { devtoolsHookPrev(...args); } catch (_) { /* swallow */ }
        }

        const root = args[1] as { current: Fiber; memoizedUpdaters?: Set<Fiber> } | undefined;
        if (!root) return;

        // The adapter is the canonical fast path (it carries the render-counter
        // deltas). Defer only after an adapter callback has proved that the host
        // surface is live. BUT: a host runtime can wipe or replace its surface
        // mid-session (for example `delete window.__ATL_REACT_METRICS`), which
        // orphans our callback on the old object. Re-seed lazily here: if the
        // callback is no longer wired, re-attach so subsequent commits route
        // through the adapter again.
        if (commitSurface.adapterObserved && metricsAdapter) {
          if (!metricsAdapter.isAttached()) {
            metricsAdapter.reattach();
            // Fall through to capture this commit via devtools so we don't lose it.
            const metricsBefore = state.lastMetricsSnapshot || captureMetricsSnapshot();
            const committedComponents = handleCommit(root, /* metricsDeltaAvailable */ false);
            commitSurface.recordDevtools(root, { commitId: state.commits, committedComponents, metricsBefore });
            return;
          }
          // The adapter is still wired — let it own this commit.
          return;
        }
        const metricsBefore = state.lastMetricsSnapshot || captureMetricsSnapshot();
        const committedComponents = handleCommit(root, /* metricsDeltaAvailable */ false);
        commitSurface.recordDevtools(root, { commitId: state.commits, committedComponents, metricsBefore });
      };
      hook.onCommitFiberRoot = devtoolsHandler;

      const devtoolsUnmountHandler = (...args: unknown[]) => {
        if (devtoolsUnmountPrev) {
          try { devtoolsUnmountPrev(...args); } catch (_) { /* swallow */ }
        }
        const fiber = args[1] as Fiber | undefined;
        if (!fiber) return;
        const counts = countUnmountedComponentSubtree(fiber);
        pendingDevtoolsUnmounts.components += counts.components;
        pendingDevtoolsUnmounts.subtrees += counts.subtrees;
        if (counts.components > 0 && pendingDevtoolsUnmountSamples.length < 30) {
          // Find the topmost component fiber in the deleted subtree (could be the
          // root fiber itself, or a descendant if React handed us a host wrapper).
          let labelFiber: Fiber | null = fiber;
          if (!isComponentFiber(labelFiber.tag)) {
            const stack: Fiber[] = [labelFiber];
            labelFiber = null;
            while (stack.length) {
              const f = stack.pop()!;
              if (isComponentFiber(f.tag)) { labelFiber = f; break; }
              if (f.child) stack.push(f.child);
              if (f.sibling) stack.push(f.sibling);
            }
          }
          if (labelFiber) {
            const fiberKey = (labelFiber as unknown as { key?: string | number | null }).key;
            pendingDevtoolsUnmountSamples.push({
              name: getComponentName(labelFiber),
              key: fiberKey == null ? null : String(fiberKey),
              depth: null,
              count: counts.components,
              source: summarizeFiberSource(labelFiber),
              host: summarizeHostSubtree(fiber),
            });
          }
        }
        lastSeenHookState.delete(fiber);
        if (fiber.alternate) lastSeenHookState.delete(fiber.alternate);
      };
      hook.onCommitFiberUnmount = devtoolsUnmountHandler;

      // Default observed mode until an adapter proves itself.
      integrationMode = 'devtools';

      // ── 2. Listen on the adapter surface ───────────────────────────────────
      // We don't probe whether the host surface is alive — we let invocation
      // be the proof. Once the adapter's callback fires, its counters are
      // available for the delta math.
      commitSurface.reset();
      const adapter = metricsAdapter;
      if (adapter) {
        const adapterMode: IntegrationMode = `adapter:${adapter.id}`;
        adapter.attach((root) => {
          const previousCapture = commitSurface.observeAdapter(root);
          // First invocation is proof of life. Promote mode permanently.
          if (integrationMode !== adapterMode) {
            integrationMode = adapterMode;
          }

          if (previousCapture) {
            // The host may call DevTools first. Enrich that same commit with
            // adapter counters without traversing or recording it a second time.
            const metricsAfter = captureMetricsSnapshot();
            if (previousCapture.metricsBefore && metricsAfter) {
              recordMetricsEvidence(previousCapture.commitId, previousCapture.committedComponents, previousCapture.metricsBefore, metricsAfter);
            }
            state.lastMetricsSnapshot = metricsAfter;
          } else {
            handleCommit(root, /* metricsDeltaAvailable */ true);
          }
        });
      }
    },

    /**
     * Stop profiling React commits. Does not clear accumulated state.
     * Call reset() to clear state.
     *
     * Restores the DevTools hook to its prior state:
     *   - hook was created by us → delete the hook entirely
     *   - hook had a prior onCommitFiberRoot → restore it
     *   - hook had no handler → delete the property
     *
     * Asks the adapter to remove its host callback only if it is still ours
     * (don't stomp a concurrent installer).
     */
    uninstall(): void {
      metricsAdapter?.detach();

      // Restore DevTools hook.
      const devtoolsGlobal = globalThis as GlobalWithDevtools;
      const hook = devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook) {
        if (devtoolsHookCreatedByUs) {
          // We created it; remove the whole thing.
          delete devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        } else {
          if (devtoolsHookPrev) {
            hook.onCommitFiberRoot = devtoolsHookPrev;
          } else {
            delete hook.onCommitFiberRoot;
          }
          if (devtoolsUnmountPrev) {
            hook.onCommitFiberUnmount = devtoolsUnmountPrev;
          } else {
            delete hook.onCommitFiberUnmount;
          }
        }
      }
      debugRender.uninstall();
      interactionCapture.uninstall();
      commitSurface.reset();
      pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
      pendingDevtoolsUnmountSamples = [];
      devtoolsHookPrev = undefined;
      devtoolsUnmountPrev = undefined;
      devtoolsHookCreatedByUs = false;
      integrationMode = 'none';
    },

    /**
     * Clear all accumulated profiling state. Useful for starting fresh measurements.
     * Does not uninstall the profiler - call uninstall() separately if needed.
     */
    reset(): void {
      resetState();
      debugRender.reset();
    },

    /**
     * Generate a report of top update sources and thrashing components.
     * @param topN - Number of top sources to include (default: 10)
     * @param sortBy - Sort thrashers by 'effect', 'callback', 'memo', or 'total' (default: 'effect')
     * @param options - Report filtering options (e.g., minCollateral to hide low-impact sources)
     * @returns Report containing sources, blast radius, and optional thrashing data
     */
    report(topN: number = 10, sortBy: SortBy = 'effect', reportOptions?: ReportOptions): Report {
      return buildReport(state, thrashMode, topN, sortBy, reportOptions, {
        effectThrashMode,
        captureFibers,
        historySize,
        detectionLevel,
        integrationMode,
      });
    },

    /**
     * Raw passive hook events captured for a component (debug surface).
     */
    _debugRawHookEvents(componentName: string) {
      const components = debugRender.allComponents();
      const events = componentName === '*' ? [] : debugRender.rawEvents(componentName);
      return {
        ok: true,
        componentName,
        status: debugRender.status(),
        components,
        events,
      };
    },

    _debugInjectHookEventsForTest(componentName: string, events: HookCallEvent[]) {
      if (typeof debugRender.recordEventForTest !== 'function') return;
      for (const event of events) {
        debugRender.recordEventForTest({ ...event, componentName });
      }
    },

    _debugSetSourceForTest(sourceId: string, source: unknown) {
      state.sources.set(sourceId, source as Omit<Source, 'sourceId'>);
    },

    debugHook(sourceId: string, hookIndex: number, windowSize: number = 3) {
      let source = state.sources.get(sourceId);
      let resolvedSourceId = sourceId;
      if (!source) {
        for (const [internalId, candidate] of state.sources.entries()) {
          const candidateHumanId = `${getComponentDisplayName(candidate.type)}#${String(internalId).match(/#(\d+)@/)?.[1] || '1'}@${candidate.depth}`;
          if (candidateHumanId === sourceId) {
            source = candidate;
            resolvedSourceId = internalId;
            break;
          }
        }
      }
      if (!source) return { ok: false, error: 'sourceId not found', sourceId };
      const componentName = getComponentDisplayName(source.type);
      let events = debugRender.rawEvents(componentName);
      let resolvedComponentName = componentName;
      if (events.length === 0) {
        const candidates = debugRender.allComponents();
        const matching = candidates.find((name) => name === componentName || name.includes(componentName) || componentName.includes(name));
        if (matching) {
          resolvedComponentName = matching;
          events = debugRender.rawEvents(matching);
        }
      }

      const sourceHookIndices = Array.isArray(source.debugHookIndices)
        ? source.debugHookIndices
        : [];
      const targetIndex = Math.floor(hookIndex);
      const eventIndex = sourceHookIndices[targetIndex] ?? targetIndex;
      const target = events[eventIndex];
      const radius = Math.max(0, Math.floor(windowSize));
      if (!target) {
        return {
          ok: false,
          error: 'hook event not found',
          sourceId: resolvedSourceId,
          requestedSourceId: sourceId,
          componentName,
          resolvedComponentName,
          hookIndex: targetIndex,
          eventIndex,
          sourceHookIndices,
          eventCount: events.length,
          status: debugRender.status(),
          caveat: 'hook ancestry comes from passive stack capture during real renders; component-name stack parsing can be ambiguous in bundled/minified code',
        };
      }
      const neighborhood = events
        .map((event, index) => ({ event, index }))
        .filter(({ index }) => Math.abs(index - eventIndex) <= radius)
        .map(({ event, index }) => ({
          hookIndex: sourceHookIndices.indexOf(index) >= 0 ? sourceHookIndices.indexOf(index) : index,
          eventIndex: index,
          primitive: event.primitive,
          parents: parentFramesForEvent(event, componentName),
        }));
      return {
        ok: true,
        sourceId: resolvedSourceId,
        requestedSourceId: sourceId,
        componentName,
        resolvedComponentName,
        hookIndex: targetIndex,
        eventIndex,
        sourceHookIndices,
        primitive: target.primitive,
        parents: parentFramesForEvent(target, componentName),
        neighborhood,
        eventCount: events.length,
        status: debugRender.status(),
        caveat: 'hook ancestry comes from passive stack capture during real renders; source-local hook indices are mapped onto the captured component event stream',
      };
    },

    /**
     * Returns which commit-hook integration model is currently observed.
     *   'devtools'     — DevTools hook is the active processor (no proven adapter callbacks).
     *   'adapter:<id>' — The adapter's host surface has fired; it owns the math now.
     *   'none'         — Detector not installed.
     */
    getIntegrationMode(): IntegrationMode {
      return integrationMode;
    },

    /** Id of the commit metrics adapter resolved on install, or null. */
    getMetricsAdapterId(): string | null {
      return metricsAdapter?.id ?? null;
    },
  };
}

/**
 * Detection level constants - use these for clarity about the hierarchy.
 * Higher levels include all features from lower levels.
 */
export const DETECTION_LEVEL = {
  /** Level 1: Only commitStats (performedWork for restarts) - minimal overhead */
  LEVEL1_STATS: 'stats' as const,
  /** Level 2: Stats + source tracking (which components caused updates) */
  LEVEL2_SOURCES: 'sources' as const,
  /** Level 3a: Sources + aggregate amplifier counts only (meta.amplifiersMetrics) */
  LEVEL3_AMPLIFIER_METRICS: 'amplifierMetrics' as const,
  /** Level 3b: Sources + full amplifier arrays (report.amplifiers, report.amplifierSources) */
  LEVEL3_AMPLIFIERS: 'amplifiers' as const,
} as const;
