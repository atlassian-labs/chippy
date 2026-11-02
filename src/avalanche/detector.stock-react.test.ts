import { afterEach, describe, expect, it, vi } from 'vitest';
import { atlCommitMetricsAdapter } from '../plugins/atl/commit-metrics-adapter';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';

const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const previousMetrics = runtime.__ATL_REACT_METRICS;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
  if (previousMetrics === undefined) delete runtime.__ATL_REACT_METRICS;
  else runtime.__ATL_REACT_METRICS = previousMetrics;
});

function setup(metrics: unknown, metricsAdapter: typeof atlCommitMetricsAdapter | null = atlCommitMetricsAdapter) {
  const predecessor = vi.fn();
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot: predecessor };
  if (metrics === undefined) delete runtime.__ATL_REACT_METRICS;
  else runtime.__ATL_REACT_METRICS = metrics;
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
    'captures every DevTools commit with absent or dormant ATL metrics: %j', (metrics) => {
      const { root, predecessor, detector } = setup(metrics);
      for (let n = 0; n < 3; n++) runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
      expect(detector.getIntegrationMode()).toBe('devtools');
      expect(detector.report().meta.commits).toBe(3);
      expect(predecessor).toHaveBeenCalledTimes(3);
    },
  );

  it('switches to ATL after a callback and chains DevTools without double counting', () => {
    const { root, predecessor, detector } = setup({ totalCommitCount: 0 });
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    expect(detector.report().meta.commits).toBe(1);
    for (let n = 0; n < 3; n++) {
      root.current = { ...root.current };
      runtime.__ATL_REACT_METRICS.onCommitFiberRoot(1, root);
      runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    }
    expect(detector.getIntegrationMode()).toBe('adapter:atl');
    expect(detector.report().meta.commits).toBe(4);
    expect(predecessor).toHaveBeenCalledTimes(4);
  });
  it('records the first DevTools-then-ATL commit once and preserves its ATL counters', () => {
    const { root, predecessor, detector } = setup({ totalCommitCount: 0, componentRenderWithHooksCount: 0, finishClassComponentCount: 0 });
    for (let n = 0; n < 3; n++) {
      root.current = { ...root.current };
      runtime.__ATL_REACT_METRICS.componentRenderWithHooksCount++;
      runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
      runtime.__ATL_REACT_METRICS.totalCommitCount++;
      runtime.__ATL_REACT_METRICS.onCommitFiberRoot(1, root);
    }
    const report = detector.report();
    expect(report.meta.commits).toBe(3);
    expect(Object.values(report.metricsByCommit)).toHaveLength(3);
    expect(Object.values(report.metricsByCommit).map(item => item.componentRenderWithHooksCount)).toEqual([1, 1, 1]);
    expect(detector.getIntegrationMode()).toBe('adapter:atl');
    expect(predecessor).toHaveBeenCalledTimes(3);
  });


  it('stays on DevTools when the adapter is opted out with a live metrics slot', () => {
    const { root, predecessor } = setup({ totalCommitCount: 0, onCommitFiberRoot: null }, null);
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
    expect(detector!.getIntegrationMode()).toBe('devtools');
    expect(detector!.getMetricsAdapterId()).toBeNull();
    expect(runtime.__ATL_REACT_METRICS.onCommitFiberRoot).toBeNull();
    expect(predecessor).toHaveBeenCalledTimes(1);
  });
});
