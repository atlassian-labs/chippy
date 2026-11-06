import { describe, it, expect, vi } from 'vitest';
import {
  safeJson,
  resolveOwnerFiber,
  getOwnerStackKind,
  findFiberByName,
  inspectFiberOwners,
  inspectFiberStructure,
} from './fiber-introspect';
import type { Fiber, ScriptHelpers } from './eval-helpers';

// ─── safeJson ────────────────────────────────────────────────────────────

describe('safeJson', () => {
  it('passes through primitives unchanged', () => {
    expect(safeJson(null)).toBeNull();
    expect(safeJson(undefined)).toBeUndefined();
    expect(safeJson('hi')).toBe('hi');
    expect(safeJson(42)).toBe(42);
    expect(safeJson(true)).toBe(true);
  });

  it('serializes function with name fallback', () => {
    function namedFn() {}
    expect(safeJson(namedFn)).toBe('[Function namedFn]');
    expect(safeJson(() => {})).toMatch(/\[Function (anonymous|.*)\]/);
  });

  it('serializes symbol and bigint via toString', () => {
    expect(safeJson(Symbol('a'))).toBe('Symbol(a)');
    expect(safeJson(BigInt(42))).toBe('42');
  });

  it('returns "[Array]"/"[Object]" sentinel at depth=0', () => {
    expect(safeJson([1, 2], 0)).toBe('[Array]');
    expect(safeJson({ a: 1 }, 0)).toBe('[Object]');
  });

  it('detects circular refs with WeakSet', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    const out = safeJson(o) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
  });

  it('truncates arrays after 200 items', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const out = safeJson(arr) as unknown[];
    expect(out.length).toBe(200);
  });

  it('truncates object keys after 200 with _truncated marker', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 250; i++) obj['k' + i] = i;
    const out = safeJson(obj) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(Object.keys(out).length).toBeLessThanOrEqual(202);
  });

  it('catches per-key serialization errors', () => {
    const obj = {
      bad: { get x() { throw new Error('fail'); } },
    };
    const out = safeJson(obj) as Record<string, unknown>;
    const inner = out.bad as Record<string, unknown>;
    expect(inner.x).toBe('[Unserializable]');
  });
});

// ─── resolveOwnerFiber ───────────────────────────────────────────────────

describe('resolveOwnerFiber', () => {
  function comp(name: string, owner: Fiber | null = null): Fiber {
    return { type: function () {} as unknown, _debugOwner: owner, [Symbol('name') as unknown as string]: name } as Fiber;
  }
  function nonComp(name: string, owner: Fiber | null = null): Fiber {
    // type is a host string — not a component
    return { type: name, _debugOwner: owner } as Fiber;
  }

  it('returns null when no debug owner', () => {
    expect(resolveOwnerFiber({ _debugOwner: null } as Fiber, 0)).toBeNull();
  });

  it('walks owner chain, skips non-component fibers, returns at target index', () => {
    const grandparent = comp('A');
    const host = nonComp('div', grandparent);
    const parent = comp('B', host);
    const fiber: Fiber = { _debugOwner: parent } as Fiber;
    expect(resolveOwnerFiber(fiber, 0)).toBe(parent);
    expect(resolveOwnerFiber(fiber, 1)).toBe(grandparent);
  });

  it('recognizes object types with $$typeof or render as components', () => {
    const memoType = { $$typeof: Symbol.for('react.memo') };
    const owner: Fiber = { type: memoType, _debugOwner: null } as Fiber;
    const fiber: Fiber = { _debugOwner: owner } as Fiber;
    expect(resolveOwnerFiber(fiber, 0)).toBe(owner);
  });

  it('returns null when target index exceeds chain', () => {
    const owner = comp('A');
    expect(resolveOwnerFiber({ _debugOwner: owner } as Fiber, 5)).toBeNull();
  });

  it('reports which chain owner indices refer to', () => {
    const owner = comp('A');
    expect(getOwnerStackKind({ _debugOwner: owner } as Fiber)).toBe('owners');
    const parent = { type: function Layout() {} } as Fiber;
    expect(getOwnerStackKind({ return: parent } as Fiber)).toBe('parents');
  });

  it('falls back to component parents when the build has no debug owners', () => {
    // Production fibers carry no `_debugOwner` field at all.
    const app = { type: function App() {} } as Fiber;
    const host = { type: 'div', return: app } as Fiber;
    const layout = { type: function Layout() {}, return: host } as Fiber;
    const fiber = { type: function Button() {}, return: layout } as Fiber;
    expect(resolveOwnerFiber(fiber, 0)).toBe(layout);
    expect(resolveOwnerFiber(fiber, 1)).toBe(app);
    expect(resolveOwnerFiber(fiber, 2)).toBeNull();
  });
});

// ─── findFiberByName ─────────────────────────────────────────────────────

describe('findFiberByName', () => {
  function helpers(items: Array<{ fiber: Fiber; info: { name: string } | null }>): ScriptHelpers {
    return {
      walkAll: (visit) => items.forEach((i) => visit(i.fiber)),
      fiberInfo: (f) => items.find((i) => i.fiber === f)?.info ?? null,
    };
  }

  it('returns first exact-match fiber', () => {
    const target: Fiber = {} as Fiber;
    const result = findFiberByName('Card', helpers([
      { fiber: {} as Fiber, info: { name: 'CardHeader' } },
      { fiber: target, info: { name: 'Card' } },
      { fiber: {} as Fiber, info: { name: 'Card' } },
    ]));
    expect(result).toBe(target);
  });

  it('escapes regex special chars in name', () => {
    const target: Fiber = {} as Fiber;
    const result = findFiberByName('A.B$C', helpers([
      { fiber: target, info: { name: 'A.B$C' } },
    ]));
    expect(result).toBe(target);
  });

  it('returns null when no match', () => {
    expect(findFiberByName('Nope', helpers([
      { fiber: {} as Fiber, info: { name: 'Other' } },
    ]))).toBeNull();
  });
});

// ─── inspectFiberOwners ──────────────────────────────────────────────────

describe('inspectFiberOwners', () => {
  function buildChain(names: string[]): Fiber {
    let owner: Fiber | null = null;
    for (let i = names.length - 1; i >= 0; i--) {
      owner = { _debugOwner: owner, name: names[i] } as Fiber;
    }
    return { _debugOwner: owner } as Fiber;
  }
  const helpers: ScriptHelpers = {
    walkAll: () => {},
    fiberInfo: (f) => ({ name: (f as { name?: string }).name || 'X' }),
  };

  it('returns empty list when no owners', () => {
    const out = inspectFiberOwners({ _debugOwner: null } as Fiber, 'fiber:1', helpers) as { count: number; items: unknown[] };
    expect(out.count).toBe(0);
    expect(out.items).toEqual([]);
  });

  it('walks owner chain and emits ownerIndex per level', () => {
    const fiber = buildChain(['A', 'B', 'C']);
    const out = inspectFiberOwners(fiber, 'fiber:1', helpers) as { count: number; items: Array<{ ownerIndex: number; name: string }> };
    expect(out.count).toBe(3);
    expect(out.items.map((i) => i.ownerIndex)).toEqual([0, 1, 2]);
    expect(out.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });

  it('caps at 100 owners', () => {
    const names = Array.from({ length: 200 }, (_, i) => 'X' + i);
    const fiber = buildChain(names);
    const out = inspectFiberOwners(fiber, 'fiber:1', helpers) as { count: number };
    expect(out.count).toBe(100);
  });

  it('labels a debug-owner chain as owners', () => {
    const out = inspectFiberOwners(buildChain(['A']), 'fiber:1', helpers) as { ownerStackKind: string };
    expect(out.ownerStackKind).toBe('owners');
  });

  it('falls back to component parents and labels them when no debug owners exist', () => {
    const app = { type: function App() {}, name: 'App' } as Fiber;
    const host = { type: 'div', name: 'div', return: app } as Fiber;
    const layout = { type: function Layout() {}, name: 'Layout', return: host } as Fiber;
    const fiber = { type: function Button() {}, return: layout } as Fiber;
    const out = inspectFiberOwners(fiber, 'fiber:1', helpers) as { ownerStackKind: string; count: number; items: Array<{ ownerIndex: number; name: string }> };
    expect(out.ownerStackKind).toBe('parents');
    expect(out.items).toEqual([{ ownerIndex: 0, name: 'Layout' }, { ownerIndex: 1, name: 'App' }]);
  });

  it('coerces fiberId to string in result', () => {
    const out = inspectFiberOwners({ _debugOwner: null } as Fiber, 42, helpers) as { fiberId: string };
    expect(out.fiberId).toBe('42');
    expect(typeof out.fiberId).toBe('string');
  });
});

// ─── inspectFiberStructure ───────────────────────────────────────────────

describe('inspectFiberStructure', () => {
  const fiber: Fiber = {} as Fiber;
  const evalHooks = vi.fn(() => ({ hookCount: 7 }));

  function makeReplay(records: Array<{ index: number; primitive: string; value?: unknown; debugLabel?: unknown; path?: Array<{ name: string }> }>) {
    return vi.fn(() => ({
      componentName: 'TestComponent',
      records,
      replayAttempted: true,
      replayError: null,
      replayErrorDetails: null,
      replayStatus: 'replay-ok',
    }));
  }

  it('emits warnings for fiber-only fallback and replay errors', () => {
    const records = [{ index: 0, primitive: 'State' }];
    const replay = vi.fn(() => ({
      componentName: 'X',
      records,
      replayAttempted: false,
      replayError: 'boom',
      replayErrorDetails: null,
      replayStatus: 'fiber-only-fallback',
    }));
    const out = inspectFiberStructure(fiber, 'f', 0, 3, replay, evalHooks) as { warnings: string[] };
    expect(out.warnings).toEqual([
      'fiber-only fallback: component functions were not executed',
      'structure-render error: boom',
    ]);
  });

  it('hook-not-found when no record matches index', () => {
    const replay = makeReplay([{ index: 0, primitive: 'State' }]);
    const out = inspectFiberStructure(fiber, 'fiber:1', 99, 3, replay, evalHooks) as { ok: boolean; status: string; replayStatus: string; hookCount: number };
    expect(out.ok).toBe(false);
    expect(out.status).toBe('hook-not-found');
    expect(out.replayStatus).toBe('not-run-fiber-only');
    expect(out.hookCount).toBe(7);
  });

  it('returns folder slice within window radius', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ index: i, primitive: 'State', value: i, path: [{ name: 'P' + i }] }));
    const replay = makeReplay(records);
    const out = inspectFiberStructure(fiber, 'fiber:1', 5, 2, replay, evalHooks) as { folder: Array<{ hookId: number }>; target: { hookId: number; parents: string[] } };
    expect(out.folder.map((f) => f.hookId)).toEqual([3, 4, 5, 6, 7]); // ±2 around 5
    expect(out.target.hookId).toBe(5);
    expect(out.target.parents).toContain('TestComponent');
  });

  it('defaults windowSize to 3 when null/undefined; clamps negative to 0', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ index: i, primitive: 'X' }));
    const replay = makeReplay(records);
    // Number(null)=0 → falsy → falls back to 3 → radius=3 → length=7
    const def = inspectFiberStructure(fiber, 'f', 5, null, replay, evalHooks) as { folder: unknown[] };
    expect(def.folder.length).toBe(7);
    // Number(-10)=-10 → truthy → radius=Math.max(0,-10)=0 → length=1 (just target)
    const neg = inspectFiberStructure(fiber, 'f', 5, -10, replay, evalHooks) as { folder: unknown[] };
    expect(neg.folder.length).toBe(1);
  });

  it('clamps windowSize=0 (which falsy-falls-back to 3)', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ index: i, primitive: 'X' }));
    const replay = makeReplay(records);
    const out = inspectFiberStructure(fiber, 'f', 5, 0, replay, evalHooks) as { folder: unknown[] };
    // Number(0)||3 = 3, so radius=3 → length=7
    expect(out.folder.length).toBe(7);
  });

  it('marks the target row with " ← target" in text output', () => {
    const records = [{ index: 0, primitive: 'State' }, { index: 1, primitive: 'Effect' }];
    const replay = makeReplay(records);
    const out = inspectFiberStructure(fiber, 'f', 1, 5, replay, evalHooks) as { text: string };
    expect(out.text).toContain('← target');
    expect(out.text).toMatch(/hook 1 Effect ← target/);
  });

  it('coerces fiberId to string and forwards replay metadata', () => {
    const records = [{ index: 0, primitive: 'State' }];
    const replay = makeReplay(records);
    const out = inspectFiberStructure(fiber, 42, 0, 3, replay, evalHooks) as { fiberId: string; captureEngineOk: boolean; replayStatus: string };
    expect(out.fiberId).toBe('42');
    expect(out.captureEngineOk).toBe(true);
    expect(out.replayStatus).toBe('replay-ok');
  });
});
