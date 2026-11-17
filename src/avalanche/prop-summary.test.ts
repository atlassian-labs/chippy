import { describe, expect, it } from 'vitest';
import { createPropSummarizer } from './prop-summary';

describe('createPropSummarizer', () => {
  const summarize = createPropSummarizer();

  it('keeps primitives readable and tells strings from numbers', () => {
    expect([undefined, null, true, 21, '21', 10n].map(summarize)).toEqual(['undefined', 'null', 'true', '21', '"21"', '10n']);
    expect(summarize(Symbol('id'))).toBe('Symbol(id)');
  });

  it('cuts long strings and reports their length', () => {
    const summary = summarize('x'.repeat(200));
    expect(summary).toBe(`"${'x'.repeat(64)}…"(len 200)`);
  });

  it('names functions and lists the first keys of objects', () => {
    expect(summarize(function onClick() {})).toBe('function onClick');
    expect(summarize(() => {})).toBe('function');
    expect(summarize({ id: 1, title: 't' })).toBe('object{id,title}');
    expect(summarize({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe('object{a,b,c,d,e,…+2}');
    expect(summarize({ 'a,b': 1, 'data-id': 2 })).toBe('object{"a,b","data-id"}');
    expect(summarize({})).toBe('object{}');
  });

  it('samples the first three array items without nesting further', () => {
    expect(summarize([1, 'a', { id: 1 }, [1, 2], 5])).toBe('array(5)[1, "a", object{id}]');
    expect(summarize([[1, 2]])).toBe('array(1)[array(2)]');
    expect(summarize([])).toBe('array(0)');
  });

  it('names React elements by type', () => {
    const element = (type: unknown) => ({ $$typeof: Symbol.for('react.transitional.element'), type, key: null, props: {} });
    function Row() { return null; }
    expect(summarize(element(Row))).toBe('element <Row>');
    expect(summarize(element('div'))).toBe('element <div>');
    expect(summarize(element(Symbol.for('react.fragment')))).toBe('element <fragment>');
    expect(summarize([element(Row), element('li')])).toBe('array(2)[element <Row>, element <li>]');
  });

  it('shares one string per shape and is not changed by later mutation', () => {
    const value: Record<string, unknown> = { color: 'red' };
    const first = summarize(value);
    value.size = 1;
    expect(first).toBe('object{color}');
    expect(summarize({ color: 'blue', size: 2 })).toBe('object{color,size}');
  });

});
