/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evalElementDom,
  evalFiberProps,
  evalFiberPropValue,
  evalFindFibers,
  resolveFindFiberSources,
  type Fiber,
  type ScriptHelpers,
} from './eval-helpers';

// Identity safeSerialize stub for tests — original behavior is to deep-trim,
// but for testing the helpers' shape we only need a non-throwing pass-through.
const identitySerialize = (v: unknown): unknown => v;

const noopGetHookSummary = () => ({
  hookCount: null,
  hookCountTruncated: false,
  hookCountMax: null,
});

const passOwner = (base: Fiber): Fiber => base;

// ─── evalElementDom ──────────────────────────────────────────────────────

describe('evalElementDom', () => {
  function makeGetCS(overrides: Partial<CSSStyleDeclaration> = {}) {
    return ((_el: Element) => ({
      display: 'block',
      visibility: 'visible',
      color: 'rgb(0, 0, 0)',
      fontSize: '14px',
      fontWeight: '400',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      cursor: 'auto',
      ...overrides,
    })) as unknown as (el: Element) => CSSStyleDeclaration;
  }

  it('returns error on null element', () => {
    expect(evalElementDom(null, 0, makeGetCS())).toEqual({ error: 'Target element is not available' });
  });

  it('returns error on non-element node', () => {
    const text = document.createTextNode('x');
    expect(evalElementDom(text as unknown as Element, 0, makeGetCS()))
      .toEqual({ error: 'Target element is not available' });
  });

  it('reads tag, attrs (excluding class), styles, and parent chain', () => {
    document.body.innerHTML = '<section><article id="a" class="ignore" data-x="hi"><div>hello</div></article></section>';
    const div = document.querySelector('div')!;
    const out = evalElementDom(div, 0, makeGetCS()) as Record<string, unknown>;

    expect(out.tag).toBe('div');
    // jsdom doesn't compute layout for innerText; assert it's a string. innerHTML is reliable.
    expect(typeof out.innerText).toBe('string');
    expect(out.innerHTML).toBe('hello');
    expect(out.attrs).toEqual({});
    expect(out.styles).toMatchObject({ display: 'block', color: 'rgb(0, 0, 0)' });
    const parents = out.parents as Array<{ tag: string; id: string | null }>;
    expect(parents.map((p) => p.tag)).toEqual(['article', 'section', 'body']);
    expect(parents[0].id).toBe('a');
  });

  it('walks up parentLevel, errors when too deep', () => {
    document.body.innerHTML = '<section id="s"><div id="d"><span/></div></section>';
    const span = document.querySelector('span')!;
    const out = evalElementDom(span, 2, makeGetCS()) as Record<string, unknown>;
    expect(out.tag).toBe('section');
    const tooDeep = evalElementDom(span, 99, makeGetCS()) as { error: string };
    expect(tooDeep.error).toMatch(/exceeds DOM depth/);
  });

  it('omits class attr; truncates long attrs to 120 chars', () => {
    const long = 'x'.repeat(200);
    document.body.innerHTML = `<div data-foo="${long}" class="should-skip"></div>`;
    const el = document.querySelector('div')!;
    const out = evalElementDom(el, 0, makeGetCS()) as { attrs: Record<string, string> };
    expect(out.attrs.class).toBeUndefined();
    expect(out.attrs['data-foo'].length).toBe(120);
  });
});

// ─── evalFiberProps ──────────────────────────────────────────────────────

describe('evalFiberProps', () => {
  it('returns error for missing fiber', () => {
    expect(evalFiberProps(null, null, noopGetHookSummary, passOwner))
      .toEqual({ error: 'Target fiber not available for ownerIndex null' });
  });

  it('classifies primitive props as pod, objects as nonPod with REFn', () => {
    const handler = () => {};
    const fiber: Fiber = {
      type: { displayName: 'Card' },
      memoizedProps: { title: 'hi', count: 3, active: true, onClick: handler, data: { a: 1 }, children: 'ignored' },
      _debugOwner: null,
    };
    const out = evalFiberProps(fiber, null, noopGetHookSummary, passOwner) as Record<string, unknown>;
    expect(out.name).toBe('Card');
    expect(out.pod).toEqual({ title: 'hi', count: 3, active: true });
    const nonPod = out.nonPod as Array<{ prop: string; ref: string; type: string }>;
    expect(nonPod.find((p) => p.prop === 'onClick')?.ref).toBe('REF1');
    expect(nonPod.find((p) => p.prop === 'data')?.ref).toBe('REF2');
    expect(nonPod.find((p) => p.prop === 'data')?.type).toBe('object');
  });

  it('terminates ownerIndex=-1 when ref is created locally (not in owner)', () => {
    const localObj = { z: 1 };
    const fiber: Fiber = {
      type: { name: 'Leaf' },
      memoizedProps: { config: localObj },
      _debugOwner: { type: { name: 'Parent' }, memoizedProps: { other: { y: 2 } } } as Fiber,
    };
    const out = evalFiberProps(fiber, null, noopGetHookSummary, passOwner) as { nonPod: Array<{ terminatesAt: { ownerIndex: number } }> };
    expect(out.nonPod[0].terminatesAt.ownerIndex).toBe(-1);
  });

  it('terminates ownerIndex=N when ref is last seen in deepest owner', () => {
    const shared = { y: 2 };
    const owner = { type: { name: 'Parent' }, memoizedProps: { other: shared }, _debugOwner: null } as Fiber;
    const fiber: Fiber = {
      type: { name: 'Leaf' },
      memoizedProps: { other: shared },
      _debugOwner: owner,
    };
    const out = evalFiberProps(fiber, null, noopGetHookSummary, passOwner) as { nonPod: Array<{ terminatesAt: { ownerIndex: number; note?: string } }> };
    expect(out.nonPod[0].terminatesAt.ownerIndex).toBe(0);
    expect(out.nonPod[0].terminatesAt.note).toBe('last known owner');
  });

  it('labels the chain and traces through component parents without debug owners', () => {
    const shared = { y: 2 };
    const app = { type: function App() {}, memoizedProps: { other: shared } } as unknown as Fiber;
    const host = { type: 'div', memoizedProps: {}, return: app } as unknown as Fiber;
    const fiber = { type: { name: 'Leaf' }, memoizedProps: { other: shared }, return: host } as unknown as Fiber;
    const out = evalFiberProps(fiber, null, noopGetHookSummary, passOwner) as { ownerStackKind: string; nonPod: Array<{ terminatesAt: { ownerIndex: number; name: string } }> };
    expect(out.ownerStackKind).toBe('parents');
    expect(out.nonPod[0].terminatesAt).toMatchObject({ ownerIndex: 0, name: 'App' });
  });

  it('labels a debug-owner chain as owners', () => {
    const owner = { type: { name: 'Parent' }, memoizedProps: {}, _debugOwner: null } as Fiber;
    const out = evalFiberProps({ type: { name: 'Leaf' }, memoizedProps: {}, _debugOwner: owner }, null, noopGetHookSummary, passOwner) as { ownerStackKind: string };
    expect(out.ownerStackKind).toBe('owners');
  });

  it('summarizes children: string, array, element, primitive', () => {
    const cases: Array<[unknown, unknown]> = [
      ['hi', { type: 'string', value: 'hi' }],
      [42, { type: 'number', value: 42 }],
      [[1, 2, 3], { type: 'array', length: 3 }],
      [{ $$typeof: Symbol.for('react.element') }, { type: 'element' }],
      [null, null],
    ];
    for (const [val, expected] of cases) {
      const f: Fiber = { type: { name: 'X' }, memoizedProps: { children: val } };
      const out = evalFiberProps(f, null, noopGetHookSummary, passOwner) as { children: unknown };
      expect(out.children).toEqual(expected);
    }
  });

  it('forwards ownerIndex to resolveOwnerFiber when provided', () => {
    const resolver = vi.fn(() => null);
    evalFiberProps({} as Fiber, 2, noopGetHookSummary, resolver);
    expect(resolver).toHaveBeenCalledWith({}, 2);
  });
});

// ─── evalFiberPropValue ──────────────────────────────────────────────────

describe('evalFiberPropValue', () => {
  it('errors when prop name missing', () => {
    expect(evalFiberPropValue({} as Fiber, null, null, noopGetHookSummary, passOwner, identitySerialize as never))
      .toEqual({ error: 'prop name required' });
  });

  it('errors when fiber missing', () => {
    expect(evalFiberPropValue(null, 'x', null, noopGetHookSummary, passOwner, identitySerialize as never))
      .toEqual({ error: 'Target fiber not available for ownerIndex null' });
  });

  it('errors when prop not on fiber', () => {
    const fiber: Fiber = { type: { name: 'X' }, memoizedProps: { a: 1, b: 2 } };
    const out = evalFiberPropValue(fiber, 'missing', null, noopGetHookSummary, passOwner, identitySerialize as never) as { error: string };
    expect(out.error).toMatch(/Prop "missing" not found on X/);
    expect(out.error).toMatch(/a, b/);
  });

  it('serializes string (truncates >200), number, bool, function, symbol', () => {
    const longStr = 'x'.repeat(250);
    const props = {
      s: longStr,
      n: 42,
      b: true,
      fn: function namedFn() {},
      sym: Symbol('k'),
    };
    const fiber: Fiber = { type: { name: 'X' }, memoizedProps: props };

    const sOut = evalFiberPropValue(fiber, 's', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: string };
    expect((sOut.value as string).endsWith('…')).toBe(true);
    expect((sOut.value as string).length).toBe(201);

    const fnOut = evalFiberPropValue(fiber, 'fn', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: string };
    expect(fnOut.value).toBe('[function:namedFn]');

    const symOut = evalFiberPropValue(fiber, 'sym', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: string };
    expect(symOut.value).toBe('[symbol:Symbol(k)]');
  });

  it('serializes arrays: empty, short, long with elision', () => {
    const fiber: Fiber = {
      type: { name: 'X' },
      memoizedProps: { empty: [], short: [1, 2, 3], long: [1, 2, 3, 4, 5, 6, 7] },
    };
    const e = evalFiberPropValue(fiber, 'empty', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: unknown[] };
    expect(e.value).toEqual([]);
    const long = evalFiberPropValue(fiber, 'long', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: unknown[] };
    expect(long.value.length).toBe(6); // 5 items + elision marker
    expect(long.value[5]).toMatch(/2 more/);
  });

  it('serializes objects: keys capped at 12 with elision marker', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 20; i++) big['k' + i] = i;
    const fiber: Fiber = { type: { name: 'X' }, memoizedProps: { big } };
    const out = evalFiberPropValue(fiber, 'big', null, noopGetHookSummary, passOwner, identitySerialize as never) as { value: Record<string, unknown> };
    const keys = Object.keys(out.value);
    expect(keys.length).toBe(13); // 12 + …
    expect(out.value['…']).toMatch(/8 more/);
  });

  it('detects circular objects via inner serializeProp', () => {
    // Build cycle through two levels — the cycle is detected when the inner
    // recurse hits an already-seen object.
    const inner: Record<string, unknown> = { name: 'inner' };
    const outer: Record<string, unknown> = { inner };
    inner.outer = outer; // outer.inner.outer === outer (cycle on outer)
    const fiber: Fiber = { type: { name: 'X' }, memoizedProps: { outer } };
    // serializeProp walks one level (top-level keys k0..k11 via own loop) and
    // calls safeSerialize on each child. Use a recursive serialize stub that
    // tracks `seen` per call, mirroring the real safeSerialize contract.
    const recursiveSerialize = (v: unknown, _depth: number, seen: Set<unknown>): unknown => {
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
        const obj = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(obj)) out[k] = recursiveSerialize(obj[k], 0, seen);
        return out;
      }
      return v;
    };
    const out = evalFiberPropValue(fiber, 'outer', null, noopGetHookSummary, passOwner, recursiveSerialize) as { value: Record<string, unknown> };
    // Each top-level key gets a fresh `seen` Set per safeSerialize call (matches
    // the original bridge behavior). Cycle detection happens within one
    // descent: outer → inner → outer → inner ⇒ '[circular]' at the deepest reentry.
    const inner1 = out.value.inner as Record<string, unknown>;
    const outer1 = inner1.outer as Record<string, unknown>;
    expect(outer1.inner).toBe('[circular]');
  });
});

// ─── evalFindFibers ──────────────────────────────────────────────────────

describe('evalFindFibers', () => {
  function makeHelpers(fibers: Array<{ fiber: Fiber; info: Record<string, unknown> }>): ScriptHelpers {
    return {
      walkAll: (visit, _opts) => fibers.forEach((f) => visit(f.fiber)),
      fiberInfo: (fiber) => fibers.find((f) => f.fiber === fiber)?.info ?? null,
    };
  }

  it('returns all when no filters and assigns fiberId via rememberFiber', () => {
    const f1: Fiber = { type: { name: 'A' } };
    const f2: Fiber = { type: { name: 'B' } };
    const helpers = makeHelpers([
      { fiber: f1, info: { name: 'A' } },
      { fiber: f2, info: { name: 'B' } },
    ]);
    const remember = vi.fn((_f: Fiber) => 'ID' + Math.random().toString(16).slice(2, 6));
    const out = evalFindFibers(null, helpers, remember);
    expect(out.count).toBe(2);
    expect(remember).toHaveBeenCalledTimes(2);
  });

  it('filters by name regex (case-insensitive)', () => {
    const items = [
      { fiber: { type: { name: 'CardHeader' } } as Fiber, info: { name: 'CardHeader' } },
      { fiber: { type: { name: 'Footer' } } as Fiber, info: { name: 'Footer' } },
    ];
    const out = evalFindFibers({ name: 'card' }, makeHelpers(items), (() => 'x') as never);
    expect(out.count).toBe(1);
    expect((out.items[0] as { name: string }).name).toBe('CardHeader');
  });

  it('filters by file, testid, text', () => {
    const items = [
      { fiber: {} as Fiber, info: { name: 'A', source: { fileName: '/foo/Card.tsx' }, domTestId: 'card', domText: 'Hello' } },
      { fiber: {} as Fiber, info: { name: 'B', source: { fileName: '/bar/Other.tsx' }, domTestId: 'other', domText: 'Bye' } },
    ];
    const helpers = makeHelpers(items);
    expect(evalFindFibers({ file: 'Card' }, helpers, (() => 'x') as never).count).toBe(1);
    expect(evalFindFibers({ testid: 'card' }, helpers, (() => 'x') as never).count).toBe(1);
    expect(evalFindFibers({ text: 'hello' }, helpers, (() => 'x') as never).count).toBe(1);
  });

  it('filters by prop presence', () => {
    const items = [
      { fiber: { memoizedProps: { onClick: () => {} } } as Fiber, info: { name: 'Btn' } },
      { fiber: { memoizedProps: { label: 'x' } } as Fiber, info: { name: 'Lbl' } },
    ];
    const out = evalFindFibers({ prop: 'onClick' }, makeHelpers(items), (() => 'x') as never);
    expect(out.count).toBe(1);
    expect((out.items[0] as { name: string }).name).toBe('Btn');
  });

  it('caps results at max (default 50, custom override, floors fractions)', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      fiber: {} as Fiber,
      info: { name: 'X' + i },
    }));
    const helpers = makeHelpers(items);
    expect(evalFindFibers(null, helpers, (() => 'x') as never).count).toBe(50);
    expect(evalFindFibers({ max: 7 }, helpers, (() => 'x') as never).count).toBe(7);
    expect(evalFindFibers({ max: 3.7 }, helpers, (() => 'x') as never).count).toBe(3);
  });

  it('skips fibers without an info.name', () => {
    const items = [
      { fiber: {} as Fiber, info: { name: 'Real' } },
      { fiber: {} as Fiber, info: {} },
    ];
    const out = evalFindFibers(null, makeHelpers(items), (() => 'x') as never);
    expect(out.count).toBe(1);
  });
});

describe('resolveFindFiberSources', () => {
  it('replaces each item source with the resolved one and keeps it on failure', async () => {
    const mapped: Fiber = { type: { name: 'Mapped' } };
    const failing: Fiber = { type: { name: 'Failing' } };
    const fibers = new Map<string, Fiber>([['fiber:1', mapped], ['fiber:2', failing]]);
    const items: Array<Record<string, unknown>> = [
      { fiberId: 'fiber:1', name: 'Mapped', source: { fileName: 'http://host/src/A.jsx', lineNumber: 40 } },
      { fiberId: 'fiber:2', name: 'Failing', source: { fileName: '/src/B.jsx', lineNumber: 3 } },
      { fiberId: 'fiber:3', name: 'Gone', source: null },
    ];
    await resolveFindFiberSources(items, (id) => fibers.get(id), async (fiber) => {
      if (fiber === failing) throw new Error('map fetch failed');
      return { fileName: 'src/A.jsx', lineNumber: 21, columnNumber: 5 };
    });
    expect(items.map((item) => item.source)).toEqual([
      { fileName: 'src/A.jsx', lineNumber: 21, columnNumber: 5 },
      { fileName: '/src/B.jsx', lineNumber: 3 },
      null,
    ]);
  });
});
