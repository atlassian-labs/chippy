/**
 * ATL commit metrics adapter: reads the render counters that Atlassian's
 * patched react-dom writes into `__ATL_REACT_METRICS` and routes that slot's
 * `onCommitFiberRoot` callback to the detector.
 *
 * The slot name is configurable, so a renamed slot needs no core change.
 */

import type {
  CommitMetricsAdapter,
  CommitMetricsRoot,
  CommitMetricsSnapshot,
} from '../../avalanche/commit-metrics-adapter';
import {
  DEFAULT_METRICS_SLOT,
  installMetricsAccessor,
  isSlotHostLocked,
  seedMetricsSlot,
} from './metrics-slot';

/**
 * Per-commit ATL delta - work done in a single commit.
 * Enables full reconciliation: ATL work counts ↔ Avalanche component counts.
 *
 * Key relationship (should hold for any commit):
 *   componentRenderWithHooksCount + finishClassComponentCount === collateral + sources
 */
export type ATLCommitDelta = {
  /** Function components mounted this commit (should be 0 during pure updates!) */
  mountWorkCount: number;
  /** Fiber update work this commit */
  updateWorkCount: number;
  /** Work that reached commit phase */
  commitWorkCount: number;
  performedWorkCount: number;
  /** Work interrupted (priority change) */
  interruptedWorkCount: number;
  /** Component fiber work (class + function) */
  componentWorkCount: number;
  /** Components mounted (should be 0 during pure updates!) */
  componentMountWorkCount: number;
  /** Components updated */
  componentUpdateWorkCount: number;
  /** DOM work (host fibers) */
  domWorkCount: number;
  ticksCount: number;
  /** Context propagation waves */
  contextUpdateCount: number;
  /** Legacy context propagations (tech debt indicator) */
  legacyContextUpdateCount: number;
  /** ALL function components rendered (including hookless) */
  componentRenderWithHooksCount: number;
  /** Class components rendered */
  finishClassComponentCount: number;
  /** useSES-triggered restarts (store mutation detected after concurrent render) */
  externalStoreRestartCount?: number;
  /** Work abandoned due to priority preemption (fibers unwound in prepareFreshStack) */
  priorityInterruptedWorkCount?: number;
  /** Number of sync renderRoot passes in this commit window */
  renderRootSyncCount?: number;
  /** Number of concurrent renderRoot passes in this commit window */
  renderRootConcurrentCount?: number;
  /** useState/useReducer dispatches during this commit (react-dom patch; optional) */
  setStateCount?: number;
};

export const ATL_DISPATCHER_FRAME = 'atlDispatcherHook';

type SlotHandler = (...args: unknown[]) => void;
type Slot = Record<string, unknown> & { onCommitFiberRoot?: SlotHandler | null };

const num = (snapshot: CommitMetricsSnapshot, key: string): number => (snapshot[key] as number | undefined) ?? 0;
const diff = (before: CommitMetricsSnapshot, after: CommitMetricsSnapshot, key: string): number => num(after, key) - num(before, key);

/** Counter delta between two ATL snapshots. */
export function calculateATLDelta(before: CommitMetricsSnapshot, after: CommitMetricsSnapshot): ATLCommitDelta {
  return {
    // Basic work counters
    mountWorkCount: diff(before, after, 'mountWorkCount'),
    updateWorkCount: diff(before, after, 'updateWorkCount'),
    commitWorkCount: diff(before, after, 'commitWorkCount'),
    performedWorkCount: diff(before, after, 'totalPerformedWork'),

    // Interruption/restart counters
    interruptedWorkCount: diff(before, after, 'interruptedWorkCount'),
    externalStoreRestartCount: diff(before, after, 'externalStoreRestartCount'),
    priorityInterruptedWorkCount: diff(before, after, 'priorityInterruptedWorkCount'),
    renderRootSyncCount: diff(before, after, 'renderRootSyncCount'),
    renderRootConcurrentCount: diff(before, after, 'renderRootConcurrentCount'),

    // Scheduler
    ticksCount: diff(before, after, 'totalTickCount'),

    // Component work counters
    componentWorkCount: diff(before, after, 'componentWorkCount'),
    componentMountWorkCount: diff(before, after, 'componentMountWorkCount'),
    componentUpdateWorkCount: diff(before, after, 'componentUpdateWorkCount'),
    componentRenderWithHooksCount: diff(before, after, 'componentRenderWithHooksCount'),
    finishClassComponentCount: diff(before, after, 'finishClassComponentCount'),

    // DOM work
    domWorkCount: diff(before, after, 'domWorkCount'),

    // Context updates
    contextUpdateCount: diff(before, after, 'contextUpdateCount'),
    legacyContextUpdateCount: diff(before, after, 'legacyContextUpdateCount'),

    // Hook-metric delta (react-dom patch; optional). Omit when neither snapshot
    // carries a numeric setStateCount so we never emit a bogus 0 on unpatched hosts.
    // TODO: Require finite values on both sides or model a counter reset
    // explicitly. Treating a missing/wiped side as zero can emit a negative delta,
    // and typeof NaN === 'number' lets a poisoned counter enter the report.
    ...(typeof after.setStateCount === 'number' || typeof before.setStateCount === 'number'
      ? { setStateCount: diff(before, after, 'setStateCount') }
      : {}),
  };
}

export type ATLCommitMetricsAdapterOptions = {
  /** Global slot the patched react-dom writes. Default `__ATL_REACT_METRICS`. */
  slotName?: string;
  /** Object that holds the slot. Default `globalThis`. */
  target?: Record<string, unknown>;
};

export function createATLCommitMetricsAdapter(options: ATLCommitMetricsAdapterOptions = {}): CommitMetricsAdapter {
  const slotName = options.slotName ?? DEFAULT_METRICS_SLOT;
  const target = () => options.target ?? (globalThis as unknown as Record<string, unknown>);
  const slot = (): Slot | null => {
    const value = target()[slotName];
    return value && typeof value === 'object' ? (value as Slot) : null;
  };
  let ourHandler: SlotHandler | undefined;

  return {
    id: 'atl',
    frameFilters: [ATL_DISPATCHER_FRAME],

    prePage() {
      installMetricsAccessor(target(), slotName);
    },

    prepare() {
      // Seed only when the slot is absent or a plain configurable data
      // property. A non-configurable slot or an accessor belongs to the host.
      try {
        if (!isSlotHostLocked(target(), slotName)) seedMetricsSlot(target(), slotName);
      } catch { /* host wins */ }
    },

    isAvailable: () => !!slot(),

    snapshot() {
      const live = slot();
      return live ? { ...live } : null;
    },

    measure(before, after, committedComponents, commitId) {
      const delta = calculateATLDelta(before, after);
      delta.performedWorkCount = committedComponents;
      const rendered = (delta.componentRenderWithHooksCount ?? 0) + (delta.finishClassComponentCount ?? 0);
      const restarts = Math.max(0, rendered - committedComponents);
      if (committedComponents > rendered && rendered > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Avalanche] Commit ${commitId}: committedComponents (${committedComponents}) > atlTotal (${rendered}). ` +
            `This indicates a counting bug. Using 0 restarts.`
        );
      }
      // Running totals live on the slot so the next delta covers them.
      const live = slot();
      if (live) {
        live.totalRestarts = ((live.totalRestarts as number) ?? 0) + restarts;
        live.totalPerformedWork = ((live.totalPerformedWork as number) ?? 0) + committedComponents;
      }
      return { delta, restarts };
    },

    attach(onCommit) {
      const live = slot();
      if (!live) return false;
      const handler: SlotHandler = (_rendererID, root) => onCommit(root as CommitMetricsRoot);
      live.onCommitFiberRoot = handler;
      ourHandler = handler;
      return true;
    },

    isAttached() {
      const live = slot();
      return !!live && !!ourHandler && live.onCommitFiberRoot === ourHandler;
    },

    reattach() {
      const fresh = seedMetricsSlot(target(), slotName) as Slot;
      if (ourHandler) fresh.onCommitFiberRoot = ourHandler;
    },

    detach() {
      const live = slot();
      if (live && ourHandler && live.onCommitFiberRoot === ourHandler) live.onCommitFiberRoot = undefined;
      ourHandler = undefined;
    },
  };
}

/** The adapter the shipped bundle registers. */
export const atlCommitMetricsAdapter = createATLCommitMetricsAdapter();
