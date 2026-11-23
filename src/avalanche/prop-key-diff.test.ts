import { describe, expect, it } from 'vitest';
import { createPropKeyDiffer, MAX_COMPARED_KEYS, MAX_LISTED_KEYS } from './prop-key-diff';
import { createPropSummarizer } from './prop-summary';

describe('createPropKeyDiffer', () => {
  const differ = () => createPropKeyDiffer(createPropSummarizer());

  it('reports a new object with the same values as sameShallow', () => {
    const nested = { id: 1 };
    const onClick = () => {};
    expect(differ()({ theme: 'light', nested, onClick }, { theme: 'light', nested, onClick }))
      .toEqual({ sameShallow: true, changedKeys: [], changedKeyCount: 0 });
  });

  it('lists each changed key with its kind, in key order', () => {
    const diff = differ()(
      { theme: 'light', nested: { id: 1 }, gone: 1, same: 2 },
      { theme: 'dark', nested: { id: 1 }, same: 2, fresh: true },
    );
    expect(diff).toEqual({
      changedKeys: [
        { key: 'theme', kind: 'scalar-changed', prev: '"light"', current: '"dark"' },
        { key: 'nested', kind: 'ref-changed' },
        { key: 'gone', kind: 'removed', prev: '1' },
        { key: 'fresh', kind: 'added', current: 'true' },
      ],
      changedKeyCount: 4,
    });
  });

  it('treats a scalar replaced by an object as ref-changed', () => {
    expect(differ()({ value: null }, { value: { id: 1 } })?.changedKeys).toEqual([{ key: 'value', kind: 'ref-changed' }]);
  });

  it('caps the listed keys and marks the list truncated', () => {
    const prev: Record<string, number> = {};
    const current: Record<string, number> = {};
    for (let i = 0; i < 20; i++) { prev[`k${i}`] = i; current[`k${i}`] = i + 1; }
    const diff = differ()(prev, current);
    expect(diff?.changedKeys).toHaveLength(MAX_LISTED_KEYS);
    expect(diff?.changedKeys?.[0]).toEqual({ key: 'k0', kind: 'scalar-changed', prev: '0', current: '1' });
    expect(diff).toMatchObject({ changedKeyCount: 20, changedKeysTruncated: true });
  });

  it('compares arrays by index, including length changes', () => {
    const row = { id: 1 };
    expect(differ()([row, 1], [row, 1])).toEqual({ sameShallow: true, changedKeys: [], changedKeyCount: 0 });
    expect(differ()([row, 1, 'x'], [{ id: 1 }, 2])).toEqual({
      changedKeys: [
        { key: '0', kind: 'ref-changed' },
        { key: '1', kind: 'scalar-changed', prev: '1', current: '2' },
        { key: '2', kind: 'removed', prev: '"x"' },
      ],
      changedKeyCount: 3,
    });
  });

  it('does not compare values over the key limit', () => {
    const big = (offset: number) => Object.fromEntries(Array.from({ length: MAX_COMPARED_KEYS + 1 }, (_, i) => [`k${i}`, i + offset]));
    expect(differ()(big(0), big(1))).toEqual({ keysNotCompared: MAX_COMPARED_KEYS + 1 });
    const long = Array.from({ length: MAX_COMPARED_KEYS + 5 }, (_, i) => i);
    expect(differ()(long, [...long])).toEqual({ keysNotCompared: MAX_COMPARED_KEYS + 5 });
  });

  it('skips values that are not plain objects or arrays', () => {
    const diff = differ();
    class Point { constructor(public x: number) {} }
    expect(diff(new Point(1), new Point(1))).toBeNull();
    expect(diff(new Map(), new Map())).toBeNull();
    expect(diff({ $$typeof: Symbol.for('react.element'), type: 'div', props: {} }, { $$typeof: Symbol.for('react.element'), type: 'div', props: {} })).toBeNull();
    expect(diff([1], { 0: 1 })).toBeNull();
    expect(diff(() => {}, () => {})).toBeNull();
    expect(diff(null, {})).toBeNull();
    // A plain object without a prototype is still compared.
    expect(diff(Object.create(null), Object.create(null))).toMatchObject({ sameShallow: true });
  });

  it('compares objects whose keys are in a different order', () => {
    expect(differ()({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual({ sameShallow: true, changedKeys: [], changedKeyCount: 0 });
    expect(differ()({ a: 1, b: 2 }, { b: 3, a: 1 })?.changedKeys).toEqual([{ key: 'b', kind: 'scalar-changed', prev: '2', current: '3' }]);
  });

  it('gives up on a value whose getter throws', () => {
    const throwing = { get boom() { throw new Error('no'); } };
    expect(differ()({ boom: 1 }, throwing)).toBeNull();
  });

  it('computes one diff for children that receive the same object pair', () => {
    const diff = differ();
    const prev = { a: 1 };
    const current = { a: 2 };
    const first = diff(prev, current);
    expect(diff(prev, current)).toBe(first);
    // A different previous value is compared again.
    expect(diff({ a: 2 }, current)).toMatchObject({ sameShallow: true });
  });
});
