import { describe, it, expect } from 'vitest';
import { evalFiberInvoke, evalFiberPropContract, readFiberProp, type Fiber, type FiberInvokeDeps } from './fiber-invoke';

function makeDeps(fiber: Fiber | null, awaitTimeoutMs?: number): FiberInvokeDeps {
  return {
    normalizeRememberedFiberId: (raw) => (raw == null ? null : String(raw)),
    getRememberedFiber: (_id) => fiber,
    safeSerialize: (value) => value,
    awaitTimeoutMs,
  };
}

function makeFiber(props: Record<string, unknown>, extras: Partial<Fiber> = {}): Fiber {
  return {
    type: { name: 'Widget' },
    memoizedProps: props,
    ...extras,
  };
}

describe('fiber-invoke', () => {
  it('happy path: scalar return is serialized', async () => {
    const fiber = makeFiber({ getCount: () => 42 });
    const r = await evalFiberInvoke('f1', 'getCount', [], makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.async).toBe(false);
    expect(r.returnValue).toBe(42);
    expect(r.fiberName).toBe('Widget');
    expect(r.propName).toBe('getCount');
  });

  it('throwing callback returns { ok:false, threw:true } and does not rethrow', async () => {
    const fiber = makeFiber({ onClick: () => { throw new Error('boom'); } });
    const r = await evalFiberInvoke('f1', 'onClick', [], makeDeps(fiber)) as any;
    expect(r.ok).toBe(false);
    expect(r.threw).toBe(true);
    expect(r.error).toBe('boom');
    expect(typeof r.stack).toBe('string');
    expect(r.propType).toBe('function');
  });

  it('async callback: resolved value is awaited and serialized', async () => {
    const fiber = makeFiber({ save: async (x: number) => x + 1 });
    const r = await evalFiberInvoke('f1', 'save', [10], makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.async).toBe(true);
    expect(r.returnValue).toBe(11);
  });

  it('async callback: rejection is captured as { ok:false, rejected:true }', async () => {
    const fiber = makeFiber({ save: async () => { throw new Error('async-boom'); } });
    const r = await evalFiberInvoke('f1', 'save', [], makeDeps(fiber)) as any;
    expect(r.ok).toBe(false);
    expect(r.async).toBe(true);
    expect(r.rejected).toBe(true);
    expect(r.error).toBe('async-boom');
  });

  it('async callback: timeout fires with bounded wait', async () => {
    const fiber = makeFiber({ never: () => new Promise(() => {}) });
    const r = await evalFiberInvoke('f1', 'never', [], makeDeps(fiber, 25)) as any;
    expect(r.ok).toBe(false);
    expect(r.async).toBe(true);
    expect(r.rejected).toBe(true);
    expect(r.error).toMatch(/did not resolve within 25ms/);
  });

  it('non-callable prop is rejected with propType reported', async () => {
    const fiber = makeFiber({ label: 'hello' });
    const r = await evalFiberInvoke('f1', 'label', [], makeDeps(fiber)) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a function/);
    expect(r.propType).toBe('string');
  });

  it('missing prop is rejected', async () => {
    const fiber = makeFiber({ a: 1 });
    const r = await evalFiberInvoke('f1', 'b', [], makeDeps(fiber)) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prop b not found/);
  });

  it('missing fiber is rejected', async () => {
    const r = await evalFiberInvoke('nope', 'x', [], makeDeps(null)) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fiber nope not found/);
  });

  it('empty fiberId / propName guards', async () => {
    const r1 = await evalFiberInvoke(null, 'x', [], makeDeps(null)) as any;
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/fiberId is required/);
    const r2 = await evalFiberInvoke('f1', '', [], makeDeps(makeFiber({ x: () => 1 }))) as any;
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/propName is required/);
  });

  it('class component: this binds to stateNode', async () => {
    const instance = { multiplier: 7 };
    function classMethod(this: typeof instance, n: number) { return this.multiplier * n; }
    const fiber: Fiber = { tag: 1, type: { name: 'KlassWidget' }, stateNode: instance, memoizedProps: { compute: classMethod } };
    const r = await evalFiberInvoke('f1', 'compute', [3], makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe(21);
  });

  it('non-array args coerces to empty array', async () => {
    const fiber = makeFiber({ ping: (...rest: unknown[]) => rest.length });
    const r = await evalFiberInvoke('f1', 'ping', 'not-an-array', makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe(0);
  });
});

describe('evalFiberPropContract', () => {
  it('reports function shape and recommends source read', () => {
    const fiber = makeFiber({ onSave: function namedFn(_a: number, _b: number) { return 0; } });
    const r = evalFiberPropContract('f1', 'onSave', makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.isFunction).toBe(true);
    expect(r.fnLength).toBe(2);
    expect(r.fnName).toBe('namedFn');
    expect(r.nextStep).toMatch(/Read the component\/owner source/);
  });

  it('reports non-callable prop with do-not-invoke guidance', () => {
    const fiber = makeFiber({ label: 'x' });
    const r = evalFiberPropContract('f1', 'label', makeDeps(fiber)) as any;
    expect(r.ok).toBe(true);
    expect(r.isFunction).toBe(false);
    expect(r.propType).toBe('string');
    expect(r.nextStep).toMatch(/not callable/);
  });

  it('lists sibling propNames on missing-prop failure', () => {
    const fiber = makeFiber({ a: 1, b: 2 });
    const r = evalFiberPropContract('f1', 'c', makeDeps(fiber)) as any;
    expect(r.ok).toBe(false);
    expect(r.propNames).toEqual(['a', 'b']);
  });
});

describe('readFiberProp (direct)', () => {
  it('returns the live prop value for a known prop', () => {
    const fiber = makeFiber({ count: 5 });
    const r = readFiberProp('f1', 'count', makeDeps(fiber));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });
});
