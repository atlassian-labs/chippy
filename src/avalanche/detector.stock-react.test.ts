import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';
import { TEST_METRICS_SLOT, createSlotCommitMetricsAdapter } from './test-support/slot-commit-metrics-adapter';

const hostAdapter = createSlotCommitMetricsAdapter();

const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const previousMetrics = runtime[TEST_METRICS_SLOT];
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
  if (previousMetrics === undefined) delete runtime[TEST_METRICS_SLOT];
  else runtime[TEST_METRICS_SLOT] = previousMetrics;
});

function setup(metrics: unknown, metricsAdapter: typeof hostAdapter | null = hostAdapter) {
  const predecessor = vi.fn();
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot: predecessor };
  if (metrics === undefined) delete runtime[TEST_METRICS_SLOT];
  else runtime[TEST_METRICS_SLOT] = metrics;
  detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter });
  detector.install();
  const fiber = {
    tag: 0, type: function StockCounter() {}, flags: PerformedWork,
    subtreeFlags: 0, child: null, sibling: null, return: null,
    memoizedState: null, memoizedProps: {}, alternate: null,
  } as unknown as Fiber;
  return { root: { current: fiber }, predecessor, detector };
}

describe('React capture ownership', () => {
  it.each([undefined, {}, { totalCommitCount: 0, onCommitFiberRoot: null }])(
    'captures every DevTools commit with absent or dormant adapter metrics: %j', (metrics) => {
      const { root, predecessor, detector } = setup(metrics);
      for (let n = 0; n < 3; n++) runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
      expect(detector.getIntegrationMode()).toBe('devtools');
      expect(detector.report().meta.commits).toBe(3);
      expect(predecessor).toHaveBeenCalledTimes(3);
    },
  );

  it('switches to the adapter after a callback and chains DevTools without double counting', () => {
    const { root, predecessor, detector } = setup({ totalCommitCount: 0 });
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    expect(detector.report().meta.commits).toBe(1);
    for (let n = 0; n < 3; n++) {
      root.current = { ...root.current };
      runtime[TEST_METRICS_SLOT].onCommitFiberRoot(1, root);
      runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    }
    expect(detector.getIntegrationMode()).toBe('adapter:test-host');
    expect(detector.report().meta.commits).toBe(4);
    expect(predecessor).toHaveBeenCalledTimes(4);
  });
  it('records the first DevTools-then-adapter commit once and preserves its adapter counters', () => {
    const { root, predecessor, detector } = setup({ totalCommitCount: 0, rendered: 0 });
    for (let n = 0; n < 3; n++) {
      root.current = { ...root.current };
      runtime[TEST_METRICS_SLOT].rendered++;
      runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
      runtime[TEST_METRICS_SLOT].totalCommitCount++;
      runtime[TEST_METRICS_SLOT].onCommitFiberRoot(1, root);
    }
    const report = detector.report();
    expect(report.meta.commits).toBe(3);
    expect(Object.values(report.metricsByCommit)).toHaveLength(3);
    expect(Object.values(report.metricsByCommit).map(item => item.rendered)).toEqual([1, 1, 1]);
    expect(detector.getIntegrationMode()).toBe('adapter:test-host');
    expect(predecessor).toHaveBeenCalledTimes(3);
  });


  it('stays on DevTools when the adapter is opted out with a live metrics slot', () => {
    const { root, predecessor } = setup({ totalCommitCount: 0, onCommitFiberRoot: null }, null);
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    expect(detector!.getIntegrationMode()).toBe('devtools');
    expect(detector!.getMetricsAdapterId()).toBeNull();
    expect(runtime[TEST_METRICS_SLOT].onCommitFiberRoot).toBeNull();
    expect(predecessor).toHaveBeenCalledTimes(1);
  });
});
