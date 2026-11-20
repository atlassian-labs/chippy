import { afterEach, describe, expect, it } from 'vitest';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';

const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
});

function setup() {
  const forwarded: unknown[] = [];
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot: (...args: unknown[]) => forwarded.push(args) };
  detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter: null });
  detector.install();
  const root = {
    current: {
      tag: 0, type: function Counter() {}, flags: PerformedWork,
      subtreeFlags: 0, child: null, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null,
    } as unknown as Fiber,
  };
  const commit = () => {
    root.current = { ...root.current };
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
  };
  return { detector, commit, forwarded };
}

describe('pausing the capture (panel Stop)', () => {
  it('leaves commits after pause out of every read while staying attached', () => {
    const { detector, commit, forwarded } = setup();
    commit();
    commit();
    detector.pause();
    commit();
    commit();

    const report = detector.report(Infinity);
    expect(report.meta.commits).toBe(2);
    expect(Object.keys(report.commitTimings)).toEqual(['1', '2']);
    expect(detector.counts()).toMatchObject({ commits: 2, capture: { paused: true } });
    expect(report.meta.capture).toMatchObject({ paused: true });
    expect(typeof report.meta.capture?.pausedAt).toBe('number');
    // React DevTools and other tools behind Avalanche still see every commit.
    expect(forwarded).toHaveLength(4);
  });

  it('records again after reset, as panel Record does', () => {
    const { detector, commit } = setup();
    commit();
    detector.pause();
    commit();
    detector.reset();
    commit();

    expect(detector.report(Infinity).meta.commits).toBe(1);
    expect(detector.counts().capture).toEqual({ paused: false, pausedAt: null });
  });

  it('can resume without clearing, continuing the commit numbering', () => {
    const { detector, commit } = setup();
    commit();
    detector.pause();
    commit();
    detector.resume();
    commit();

    const report = detector.report(Infinity);
    expect(report.meta.commits).toBe(2);
    expect(Object.keys(report.commitTimings)).toEqual(['1', '2']);
  });
});
