import { describe, expect, it, vi } from 'vitest';
import {
  evalFiberScheduleUpdate,
  getFiberDisplayName,
  getFiberSource,
  type Fiber,
  type FiberScheduleUpdateDeps,
} from './fiber-schedule-update';
import { getScheduleUpdate, getDispatcherRef, getReactRenderers } from './react-renderer';

// --- shared renderer discovery -------------------------------------------------

describe('react-renderer discovery', () => {
  function withHook<T>(renderers: any[], fn: () => T): T {
    const prev = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(renderers.map((r, i) => [i + 1, r])),
    };
    try {
      return fn();
    } finally {
      if (prev === undefined) delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      else (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = prev;
    }
  }

  it('returns [] when no devtools hook present', () => {
    const prev = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    try {
      expect(getReactRenderers()).toEqual([]);
      expect(getScheduleUpdate()).toBeNull();
      expect(getDispatcherRef()).toBeNull();
    } finally {
      if (prev !== undefined) (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = prev;
    }
  });

  it('finds the first renderer exposing scheduleUpdate', () => {
    const fn = () => {};
    withHook([{}, { scheduleUpdate: fn }], () => {
      expect(getScheduleUpdate()).toBe(fn);
    });
  });

  it('finds the first renderer exposing currentDispatcherRef', () => {
    const ref = { current: null };
    withHook([{ currentDispatcherRef: ref }], () => {
      expect(getDispatcherRef()).toBe(ref);
    });
  });

  it('returns null scheduleUpdate when no renderer has it (production build)', () => {
    withHook([{ currentDispatcherRef: { current: null } }], () => {
      expect(getScheduleUpdate()).toBeNull();
    });
  });
});

// --- the capability ------------------------------------------------------------

describe('fiber-schedule-update', () => {
  const normalizeRememberedFiberId = (raw: unknown) => {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    return /^\d+$/.test(s) ? `fiber:${s}` : s;
  };

  function makeFiber(name: string, owner: Fiber | null = null): Fiber {
    return {
      type: { name },
      _debugOwner: owner,
      _debugSource: { fileName: `/x/${name}.tsx`, lineNumber: 10, columnNumber: 2 },
    };
  }

  function deps(
    fibers: Record<string, Fiber>,
    scheduleUpdate: ((f: unknown) => void) | null,
  ): FiberScheduleUpdateDeps {
    return {
      normalizeRememberedFiberId,
      getRememberedFiber: (id: string) => fibers[id] ?? null,
      getScheduleUpdate: () => scheduleUpdate,
    };
  }

  it('rejects a missing fiberId', () => {
    const res = evalFiberScheduleUpdate(null, 0, deps({}, () => {}));
    expect(res).toMatchObject({ ok: false, reason: 'no-fiberId' });
  });

  it('rejects an unknown fiber', () => {
    const res = evalFiberScheduleUpdate('99', 0, deps({}, () => {}));
    expect(res).toMatchObject({ ok: false, reason: 'fiber-not-found', fiberId: 'fiber:99' });
  });

  it('schedules an update on the resolved fiber (hookless, zero pollution)', () => {
    const fiber = makeFiber('Leaf');
    const spy = vi.fn();
    const res = evalFiberScheduleUpdate('42', 0, deps({ 'fiber:42': fiber }, spy));
    expect(res).toMatchObject({
      ok: true,
      scheduled: true,
      fiberId: 'fiber:42',
      fiberName: 'Leaf',
      ownerIndex: 0,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fiber);
    // capability mutated nothing on the fiber
    expect(fiber._debugSource).toEqual({ fileName: '/x/Leaf.tsx', lineNumber: 10, columnNumber: 2 });
  });

  it('walks ownerIndex up the _debugOwner chain', () => {
    const parent = makeFiber('Parent');
    const child = makeFiber('Child', parent);
    const spy = vi.fn();
    const res = evalFiberScheduleUpdate('1', 1, deps({ 'fiber:1': child }, spy));
    expect(res).toMatchObject({ ok: true, fiberName: 'Parent', ownerIndex: 1 });
    expect(spy).toHaveBeenCalledWith(parent);
  });

  it('reports owner-out-of-range when ownerIndex overshoots', () => {
    const fiber = makeFiber('Solo');
    const res = evalFiberScheduleUpdate('1', 5, deps({ 'fiber:1': fiber }, () => {}));
    expect(res).toMatchObject({ ok: false, reason: 'owner-out-of-range', ownerIndex: 5 });
  });

  it('reports no-scheduleUpdate on a production build (no renderer.scheduleUpdate)', () => {
    const fiber = makeFiber('Leaf');
    const res = evalFiberScheduleUpdate('1', 0, deps({ 'fiber:1': fiber }, null));
    expect(res).toMatchObject({ ok: false, reason: 'no-scheduleUpdate', fiberName: 'Leaf' });
  });

  it('captures a throwing scheduleUpdate without hanging', () => {
    const fiber = makeFiber('Leaf');
    const boom = vi.fn(() => {
      throw new Error('schedule boom');
    });
    const res = evalFiberScheduleUpdate('1', 0, deps({ 'fiber:1': fiber }, boom));
    expect(res).toMatchObject({ ok: false, reason: 'scheduleUpdate-threw', error: 'schedule boom' });
  });

  it('helpers read display name and source defensively', () => {
    expect(getFiberDisplayName(null)).toBe('Unknown');
    expect(getFiberDisplayName({ type: { displayName: 'Memoized' } })).toBe('Memoized');
    expect(getFiberSource(null)).toBeNull();
  });
});
