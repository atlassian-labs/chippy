// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { toWireValue } from './wire-value';

describe('toWireValue', () => {
  it('keeps primitives exact and cuts long strings', () => {
    expect(toWireValue(1240)).toBe(1240);
    expect(toWireValue(null)).toBeNull();
    expect(toWireValue(false)).toBe(false);
    expect(toWireValue(undefined)).toBeUndefined();
    expect(toWireValue('a')).toBe('a');
    expect(toWireValue(Number.NaN)).toBe('NaN');
    expect(toWireValue(10n)).toBe('10n');
    const long = toWireValue('x'.repeat(1000)) as string;
    expect(long.length).toBeLessThan(220);
    expect(long.endsWith('…(1000)')).toBe(true);
  });

  it('replaces DOM nodes that point back at their fiber with a marker', () => {
    const button = document.createElement('button');
    const fiber: Record<string, unknown> = { tag: 5, stateNode: button, return: null, memoizedProps: {} };
    (button as unknown as Record<string, unknown>).__reactFiber$test = fiber;
    const ref = { current: button };
    expect(() => JSON.stringify(ref)).toThrow(/circular/i);
    expect(toWireValue(ref)).toEqual({ current: '[HTMLButtonElement button]' });
    expect(toWireValue(fiber)).toBe('[Fiber]');
  });

  it('marks React elements, functions, promises, and collections', () => {
    function Card() { return null; }
    expect(toWireValue(createElement(Card))).toBe('[ReactElement Card]');
    expect(toWireValue(createElement('div'))).toBe('[ReactElement div]');
    expect(toWireValue(function onClick() {})).toBe('[Function onClick]');
    expect(toWireValue(Promise.resolve(1))).toBe('[Promise]');
    expect(toWireValue(new Map([[1, 2]]))).toBe('[Map(1)]');
    expect(toWireValue(new Set([1]))).toBe('[Set(1)]');
  });

  it('breaks cycles and bounds depth and width', () => {
    const store: Record<string, unknown> = { name: 'store' };
    store.self = store;
    store.deep = { level1: { level2: { level3: true } } };
    store.list = Array.from({ length: 20 }, (_, i) => i);
    for (let i = 0; i < 20; i++) store[`k${i}`] = i;
    const wire = toWireValue(store) as Record<string, unknown>;
    expect(wire.self).toBe('[Circular]');
    expect(wire.deep).toEqual({ level1: '[Object(1 keys)]' });
    expect(wire.list).toEqual([0, 1, 2, 3, 4, 5, 6, 7, '…(12 more)']);
    expect(wire['…']).toBe('16 more keys');
    expect(JSON.stringify(wire).length).toBeLessThan(400);
  });

  it('survives objects whose getters throw', () => {
    const hostile = Object.defineProperty({}, 'boom', { enumerable: true, get() { throw new Error('no'); } });
    expect(toWireValue(hostile)).toEqual({ boom: '[Unreadable]' });
  });
});
