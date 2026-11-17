import { afterEach, describe, expect, it } from 'vitest';
import { registerAvalancheHooks, resetAvalancheHooks } from './avalanche-hooks';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';
import { serializeReport } from './report-serializer';

const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
  resetAvalancheHooks();
});

function commitOnce(root: { current: Fiber }) {
  root.current = { ...root.current };
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
}

describe('detector avalanche hooks', () => {
  it('runs hooks per captured commit, resets them on clear, and serializes the results', () => {
    registerAvalancheHooks({
      id: 'probe',
      instructions: 'steps hold component counts',
      onStart: () => 'started',
      onStep: (ctx) => ({ components: ctx.commit!.components, root: typeof ctx.commit!.root }),
      onEnd: (ctx) => ctx.commits,
    });
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot() {} };
    detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter: null });
    detector.install();
    const fiber = {
      tag: 0, type: function Counter() {}, flags: PerformedWork,
      subtreeFlags: 0, child: null, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null,
    } as unknown as Fiber;
    const root = { current: fiber };
    commitOnce(root);
    commitOnce(root);

    const report = detector.report();
    expect(report.hooks?.probe).toMatchObject({
      instructions: 'steps hold component counts',
      start: 'started',
      end: 2,
      errorCount: 0,
    });
    expect(Object.keys(report.hooks!.probe.steps)).toHaveLength(2);
    expect(Object.values(report.hooks!.probe.steps)[0]).toMatchObject({ root: 'object' });
    expect(serializeReport(report).hooks?.probe.end).toBe(2);

    detector.reset();
    expect(detector.report().hooks?.probe).toMatchObject({ start: 'started', steps: {}, end: 0 });
  });

  it('leaves hooks out of the report when none is registered', () => {
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot() {} };
    detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter: null });
    detector.install();
    expect(detector.report().hooks).toBeUndefined();
  });
});
