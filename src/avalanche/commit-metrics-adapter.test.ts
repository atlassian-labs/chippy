import { afterEach, describe, expect, it } from 'vitest';
import {
  type CommitMetricsAdapter,
  adapterIdFromMode,
  getCommitMetricsAdapter,
  registerCommitMetricsAdapter,
  runPrePageHooks,
} from './commit-metrics-adapter';

function makeAdapter(id: string, extra: Partial<CommitMetricsAdapter> = {}): CommitMetricsAdapter {
  return {
    id,
    isAvailable: () => true,
    snapshot: () => ({}),
    measure: () => ({ delta: {}, restarts: 0 }),
    attach: () => true,
    isAttached: () => true,
    reattach: () => {},
    detach: () => {},
    ...extra,
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('commit metrics adapter registry', () => {
  it('rejects adapters without an id or a required method', () => {
    expect(() => registerCommitMetricsAdapter(makeAdapter(''))).toThrow(TypeError);
    const { measure: _measure, ...incomplete } = makeAdapter('broken');
    expect(() => registerCommitMetricsAdapter(incomplete as CommitMetricsAdapter)).toThrow(/missing measure/);
  });

  it('keeps one active adapter; a later registration replaces the earlier one', () => {
    const previous = getCommitMetricsAdapter();
    const first = makeAdapter('first');
    const second = makeAdapter('second');
    const unregisterFirst = registerCommitMetricsAdapter(first);
    const unregisterSecond = registerCommitMetricsAdapter(second);
    expect(getCommitMetricsAdapter()).toBe(second);
    // Unregistering a replaced adapter leaves the active one alone.
    unregisterFirst();
    expect(getCommitMetricsAdapter()).toBe(second);
    unregisterSecond();
    expect(getCommitMetricsAdapter()).toBeNull();
    if (previous) cleanups.push(registerCommitMetricsAdapter(previous));
  });

  it('runs the active pre-page hook and swallows its failures', () => {
    const seen: unknown[] = [];
    cleanups.push(registerCommitMetricsAdapter(makeAdapter('pre', { prePage: (cfg) => { seen.push(cfg); } })));
    expect(runPrePageHooks({ enabled: true })).toBe('pre');
    expect(seen).toEqual([{ enabled: true }]);

    cleanups.push(registerCommitMetricsAdapter(makeAdapter('boom', { prePage: () => { throw new Error('boom'); } })));
    expect(runPrePageHooks()).toBeNull();

    cleanups.push(registerCommitMetricsAdapter(makeAdapter('no-hook')));
    expect(runPrePageHooks()).toBeNull();
  });

  it('reads the adapter id from an integration mode', () => {
    expect(adapterIdFromMode('adapter:atl')).toBe('atl');
    expect(adapterIdFromMode('devtools')).toBeNull();
    expect(adapterIdFromMode('none')).toBeNull();
    expect(adapterIdFromMode(undefined)).toBeNull();
  });
});
