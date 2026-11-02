import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATL_DISPATCHER_FRAME, calculateATLDelta, createATLCommitMetricsAdapter } from './commit-metrics-adapter';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ATL commit metrics adapter', () => {
  it('declares its id and dispatcher frame filter', () => {
    const adapter = createATLCommitMetricsAdapter({ target: {} });
    expect(adapter.id).toBe('atl');
    expect(adapter.frameFilters).toEqual([ATL_DISPATCHER_FRAME]);
  });

  it('seeds a custom slot on prepare and attaches a commit callback', () => {
    const target: Record<string, any> = {};
    const adapter = createATLCommitMetricsAdapter({ target, slotName: '__TEST_METRICS' });
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.attach(() => {})).toBe(false);

    adapter.prepare!();
    expect(adapter.isAvailable()).toBe(true);
    expect(target.__TEST_METRICS.totalCommitCount).toBe(0);

    const onCommit = vi.fn();
    expect(adapter.attach(onCommit)).toBe(true);
    expect(adapter.isAttached()).toBe(true);
    const root = { current: {} };
    target.__TEST_METRICS.onCommitFiberRoot(1, root);
    expect(onCommit).toHaveBeenCalledWith(root);

    adapter.detach();
    expect(adapter.isAttached()).toBe(false);
    expect(target.__TEST_METRICS.onCommitFiberRoot).toBeUndefined();
  });

  it('does not seed over a host-locked slot', () => {
    const target: Record<string, any> = {};
    const hostSlot = { totalCommitCount: 7 };
    Object.defineProperty(target, '__ATL_REACT_METRICS', { value: hostSlot, configurable: false, enumerable: true });
    const adapter = createATLCommitMetricsAdapter({ target });
    adapter.prepare!();
    expect(target.__ATL_REACT_METRICS).toBe(hostSlot);
  });

  it('reattaches its handler after the host replaces the slot', () => {
    const target: Record<string, any> = {};
    const adapter = createATLCommitMetricsAdapter({ target });
    adapter.prepare!();
    const onCommit = vi.fn();
    adapter.attach(onCommit);
    delete target.__ATL_REACT_METRICS;
    expect(adapter.isAttached()).toBe(false);

    adapter.reattach();
    expect(adapter.isAttached()).toBe(true);
    target.__ATL_REACT_METRICS.onCommitFiberRoot(1, { current: {} });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('measures restarts and accumulates totals on the slot', () => {
    const target: Record<string, any> = {};
    const adapter = createATLCommitMetricsAdapter({ target });
    adapter.prepare!();
    const before = adapter.snapshot()!;
    target.__ATL_REACT_METRICS.componentRenderWithHooksCount = 5;
    target.__ATL_REACT_METRICS.finishClassComponentCount = 1;
    const after = adapter.snapshot()!;

    const { delta, restarts } = adapter.measure(before, after, 4, 1);
    expect(restarts).toBe(2);
    expect(delta.performedWorkCount).toBe(4);
    expect(delta.componentRenderWithHooksCount).toBe(5);
    expect(target.__ATL_REACT_METRICS.totalRestarts).toBe(2);
    expect(target.__ATL_REACT_METRICS.totalPerformedWork).toBe(4);
  });

  it('warns and reports zero restarts when more components commit than rendered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createATLCommitMetricsAdapter({ target: {} });
    const { restarts } = adapter.measure({ componentRenderWithHooksCount: 0 }, { componentRenderWithHooksCount: 1 }, 3, 9);
    expect(restarts).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('emits setStateCount only when a snapshot carries it', () => {
    expect(calculateATLDelta({}, {})).not.toHaveProperty('setStateCount');
    expect(calculateATLDelta({ setStateCount: 1 }, { setStateCount: 4 }).setStateCount).toBe(3);
  });
});
