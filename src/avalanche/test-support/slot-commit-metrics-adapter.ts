/**
 * Test-only commit metrics adapter for an imaginary instrumented react-dom
 * that writes numeric counters and an `onCommitFiberRoot` callback into a
 * global slot. It exercises the generic adapter seam without any product
 * surface.
 */

import type {
  CommitMetricsAdapter,
  CommitMetricsDelta,
  CommitMetricsRoot,
} from '../commit-metrics-adapter';

export const TEST_METRICS_SLOT = '__TEST_REACT_METRICS';
export const TEST_DISPATCHER_FRAME = 'hostDispatcherHook';

type SlotHandler = (...args: unknown[]) => void;
type Slot = Record<string, unknown> & { onCommitFiberRoot?: SlotHandler | null };

export function createSlotCommitMetricsAdapter(slotName = TEST_METRICS_SLOT): CommitMetricsAdapter {
  const target = globalThis as unknown as Record<string, unknown>;
  const slot = (): Slot | null => {
    const value = target[slotName];
    return value && typeof value === 'object' ? (value as Slot) : null;
  };
  let ourHandler: SlotHandler | undefined;

  return {
    id: 'test-host',
    frameFilters: [TEST_DISPATCHER_FRAME],
    isAvailable: () => !!slot(),
    snapshot() {
      const live = slot();
      return live ? { ...live } : null;
    },
    measure(before, after, committedComponents) {
      const delta: CommitMetricsDelta = {};
      for (const [key, value] of Object.entries(after)) {
        if (typeof value === 'number') delta[key] = value - ((before[key] as number | undefined) ?? 0);
      }
      const rendered = delta.rendered ?? 0;
      return { delta, restarts: Math.max(0, rendered - committedComponents) };
    },
    attach(onCommit) {
      const live = slot();
      if (!live) return false;
      ourHandler = (_rendererID, root) => onCommit(root as CommitMetricsRoot);
      live.onCommitFiberRoot = ourHandler;
      return true;
    },
    isAttached() {
      const live = slot();
      return !!live && !!ourHandler && live.onCommitFiberRoot === ourHandler;
    },
    reattach() {
      const fresh: Slot = slot() ?? {};
      target[slotName] = fresh;
      if (ourHandler) fresh.onCommitFiberRoot = ourHandler;
    },
    detach() {
      const live = slot();
      if (live && ourHandler && live.onCommitFiberRoot === ourHandler) live.onCommitFiberRoot = undefined;
    },
  };
}
