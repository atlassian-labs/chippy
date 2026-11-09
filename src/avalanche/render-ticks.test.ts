import { describe, expect, it } from 'vitest';
import { createRenderTickTracker } from './render-ticks';

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A React 19-shaped renderer: one shared internals object with `H` and `A`. */
function react19Renderer(internals: Record<string, unknown> = { H: null, A: null }) {
  return { internals, renderer: { currentDispatcherRef: internals } };
}

/** Emulate one render slice the way React 19 brackets it. */
function slice19(internals: Record<string, unknown>, c: ReturnType<typeof clock>, ms: number) {
  const prev = internals.A;
  internals.A = { getCacheForType() {} };
  c.advance(ms);
  internals.A = prev;
}

/** A React 18-shaped renderer with a single profiling-hooks slot. */
function react18Renderer() {
  const state: { hooks: Record<string, any> | null } = { hooks: null };
  const renderer = {
    currentDispatcherRef: { current: null },
    injectProfilingHooks: function injectProfilingHooks(hooks: Record<string, any> | null) { state.hooks = hooks; },
  };
  return { renderer, state };
}

describe('render tick tracker: async dispatcher', () => {
  it('counts each enter/exit pair of the A slot as one tick', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    const { internals, renderer } = react19Renderer();
    expect(tracker.attachRenderer(renderer)).toBe('async-dispatcher');

    slice19(internals, c, 4);
    c.advance(10);
    slice19(internals, c, 3);
    const ticks = tracker.takeCommitTicks()!;
    expect(ticks).toMatchObject({ ticks: 2, renderStart: 0, renderEnd: 17, workMs: 7, yieldedMs: 10, longestSliceMs: 4, partial: false });
    expect(ticks.slices).toEqual([[0, 4], [14, 17]]);
    expect(tracker.takeCommitTicks()).toMatchObject({ ticks: 0, partial: true });
  });

  it('chains a previous accessor on the slot and restores it on detach', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    let backing: unknown = null;
    const writes: unknown[] = [];
    const internals: Record<string, unknown> = { H: null };
    const get = () => backing;
    const set = (v: unknown) => { writes.push(v); backing = v; };
    Object.defineProperty(internals, 'A', { configurable: true, enumerable: true, get, set });
    tracker.attachRenderer({ currentDispatcherRef: internals });

    slice19(internals, c, 2);
    expect(writes).toHaveLength(2);
    expect(tracker.takeCommitTicks()!.ticks).toBe(1);
    tracker.detach();
    expect(Object.getOwnPropertyDescriptor(internals, 'A')!.set).toBe(set);
  });

  it('traps internals shared by two renderers once', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    const internals: Record<string, unknown> = { H: null, A: null };
    tracker.attachRenderer({ currentDispatcherRef: internals });
    tracker.attachRenderer({ currentDispatcherRef: internals });
    slice19(internals, c, 1);
    expect(tracker.takeCommitTicks()!.ticks).toBe(1);
    expect(tracker.status().sources).toEqual(['async-dispatcher', 'async-dispatcher']);
  });

  it('refuses a non-configurable slot', () => {
    const tracker = createRenderTickTracker();
    const internals: Record<string, unknown> = { H: null };
    Object.defineProperty(internals, 'A', { configurable: false, writable: true, value: null });
    expect(tracker.attachRenderer({ currentDispatcherRef: internals })).toBeNull();
    expect(tracker.takeCommitTicks()).toBeNull();
    expect(tracker.status()).toEqual({ available: false, sources: [], reason: 'React 19 async dispatcher slot is not configurable' });
  });

  it('marks the first commit after a late attach as partial and caps stored slices', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now, maxSlices: 2 });
    const { internals, renderer } = react19Renderer();
    tracker.attachRenderer(renderer, { late: true });
    for (let i = 0; i < 3; i++) slice19(internals, c, 1);
    const first = tracker.takeCommitTicks()!;
    expect(first).toMatchObject({ ticks: 3, partial: true, slicesTruncated: true });
    expect(first.slices).toHaveLength(2);
    slice19(internals, c, 1);
    expect(tracker.takeCommitTicks()!.partial).toBe(false);
  });

  it('drops pending ticks on reset', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    const { internals, renderer } = react19Renderer();
    tracker.attachRenderer(renderer);
    slice19(internals, c, 1);
    tracker.reset();
    expect(tracker.takeCommitTicks()!.ticks).toBe(0);
  });
});

describe('render tick tracker: profiling hooks', () => {
  it('composes with hooks injected after prepare and gives them back on detach', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    const { renderer, state } = react18Renderer();
    const original = renderer.injectProfilingHooks;
    tracker.prepareRenderer(renderer);
    const calls: string[] = [];
    const external = {
      markRenderStarted: () => calls.push('started'),
      markRenderYielded: () => calls.push('yielded'),
      markRenderStopped: () => calls.push('stopped'),
      markCommitStarted: () => calls.push('commit'),
    };
    renderer.injectProfilingHooks(external); // React DevTools injecting
    expect(tracker.attachRenderer(renderer)).toBe('profiling-hooks');

    state.hooks!.markRenderStarted(1); c.advance(5); state.hooks!.markRenderYielded();
    c.advance(5);
    state.hooks!.markRenderStarted(1); c.advance(2); state.hooks!.markRenderStopped();
    state.hooks!.markCommitStarted(1);
    expect(calls).toEqual(['started', 'yielded', 'started', 'stopped', 'commit']);
    expect(tracker.takeCommitTicks()).toMatchObject({ ticks: 2, workMs: 7, yieldedMs: 5 });

    tracker.detach();
    expect(state.hooks).toBe(external);
    expect(renderer.injectProfilingHooks).toBe(original);
  });

  it('attaches to an unprepared renderer nobody else owns', () => {
    const c = clock();
    const tracker = createRenderTickTracker({ now: c.now });
    const { renderer, state } = react18Renderer();
    expect(tracker.attachRenderer(renderer, { late: true })).toBe('profiling-hooks');
    state.hooks!.markRenderStarted(); c.advance(1); state.hooks!.markRenderStopped();
    expect(tracker.takeCommitTicks()).toMatchObject({ ticks: 1, partial: true });
    tracker.detach();
    expect(state.hooks).toBeNull();
  });

  it('skips an unprepared renderer whose hooks React DevTools owns', () => {
    const tracker = createRenderTickTracker();
    const { renderer, state } = react18Renderer();
    const devtools = { markRenderStarted() {} };
    renderer.injectProfilingHooks(devtools);
    expect(tracker.attachRenderer(renderer, { profilingHooksOwned: true })).toBeNull();
    expect(state.hooks).toBe(devtools);
    expect(tracker.status().reason).toMatch(/React DevTools attached/);
  });

  it('reports a build with no signal', () => {
    const tracker = createRenderTickTracker();
    expect(tracker.attachRenderer({ currentDispatcherRef: { current: null } })).toBeNull();
    expect(tracker.status().reason).toMatch(/no render-slice signal/);
    expect(createRenderTickTracker().status().reason).toBe('no React renderer registered with the DevTools hook');
  });
});
