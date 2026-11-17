import { afterEach, describe, expect, it } from 'vitest';
import {
  type AvalancheHookCommit,
  type AvalancheHooks,
  createAvalancheHookRunner,
  registerAvalancheHooks,
  resetAvalancheHooks,
} from './avalanche-hooks';

afterEach(resetAvalancheHooks);

const commit = (id: number): AvalancheHookCommit => ({ id, components: 2, startTime: id, endTime: id + 1, root: {} as never });

describe('avalanche hooks', () => {
  it('returns null when no hook set is registered', () => {
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step(commit(1));
    expect(runner.collect()).toBeNull();
  });

  it('records start, per-commit steps, and end with private state', () => {
    registerAvalancheHooks({
      id: 'count',
      instructions: 'steps are running totals',
      onStart: (ctx) => {
        ctx.state.total = 0;
        return { ready: true };
      },
      onStep: (ctx) => {
        ctx.state.total = (ctx.state.total as number) + ctx.commit!.components;
        return ctx.commit!.id === 2 ? undefined : { total: ctx.state.total };
      },
      onEnd: (ctx) => ({ commits: ctx.commits, total: ctx.state.total }),
    });
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step(commit(1));
    runner.step(commit(2));
    runner.step(commit(3));
    expect(runner.collect()).toEqual({
      count: {
        instructions: 'steps are running totals',
        start: { ready: true },
        steps: { 1: { total: 2 }, 3: { total: 6 } },
        end: { commits: 3, total: 6 },
        errors: [],
        errorCount: 0,
        stepDisabled: false,
      },
    });
  });

  it('resets state on start and keeps it on ensureStarted', () => {
    const hooks: AvalancheHooks = {
      id: 'n',
      onStart: (ctx) => {
        ctx.state.n = 0;
      },
      onStep: (ctx) => {
        ctx.state.n = (ctx.state.n as number) + 1;
      },
      onEnd: (ctx) => ctx.state.n,
    };
    registerAvalancheHooks(hooks);
    const runner = createAvalancheHookRunner();
    runner.ensureStarted();
    runner.step(commit(1));
    runner.ensureStarted();
    runner.step(commit(2));
    expect(runner.collect()?.n.end).toBe(2);
    runner.start();
    expect(runner.collect()?.n.end).toBe(0);
  });

  it('records failures without breaking other hook sets and disables a failing onStep', () => {
    registerAvalancheHooks({
      id: 'bad',
      onStep: () => {
        throw new Error('boom');
      },
      onEnd: () => {
        throw new Error('end boom');
      },
    });
    registerAvalancheHooks({ id: 'good', onStep: (ctx) => ctx.commit!.id });
    const runner = createAvalancheHookRunner();
    runner.start();
    for (let id = 1; id <= 25; id += 1) runner.step(commit(id));
    const result = runner.collect()!;
    expect(result.good.steps[25]).toBe(25);
    expect(result.bad.stepDisabled).toBe(true);
    expect(result.bad.errorCount).toBe(21);
    expect(result.bad.errors).toHaveLength(5);
    expect(result.bad.errors[0]).toEqual({ phase: 'step', commitId: 1, message: 'Error: boom' });
  });

  it('opens a set registered mid-recording without running onStart', () => {
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step(commit(1));
    registerAvalancheHooks({ id: 'late', onStart: () => 'never', onStep: (ctx) => ctx.commits });
    runner.step(commit(2));
    expect(runner.collect()?.late).toMatchObject({ steps: { 2: 2 } });
    expect(runner.collect()?.late.start).toBeUndefined();
  });

  it('keeps results JSON-safe', () => {
    registerAvalancheHooks({
      id: 'shape',
      onStep: () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        return cyclic;
      },
      onEnd: () => ({ fn: () => 1, n: 1 }),
    });
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step(commit(1));
    const result = runner.collect()!.shape;
    expect(result.steps[1]).toBe('[object Object]');
    expect(result.end).toEqual({ n: 1 });
  });

  it('rejects hook sets without an id or with non-function phases', () => {
    expect(() => registerAvalancheHooks({ id: '' })).toThrow(TypeError);
    expect(() => registerAvalancheHooks({ id: 'x', onStep: 'nope' } as never)).toThrow(/onStep must be a function/);
  });
});
