// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { componentStrings, componentStringsOf, stringLiterals } from './component-strings';

const MINIFIED = 'function e(t){return(0,r.jsx)("nav",{"data-testid":"toolbar",className:"wrap",' +
  '"aria-hidden":!0,children:[n("projects.list.title"),"Hello world",`Row ${t.id} of list`]})}';

describe('component strings', () => {
  it('reads literals in source order and marks object keys', () => {
    expect(stringLiterals('f({"a-b":"c",d:\'e\'})')).toMatchObject([
      { value: 'a-b', key: true },
      { value: 'c', key: false },
      { value: 'e', key: false },
    ]);
  });

  it('keeps distinctive strings and pairs dashed attributes with literal values', () => {
    expect(componentStringsOf(MINIFIED).strings).toEqual([
      'data-testid="toolbar"',
      'wrap',
      'projects.list.title',
      'Hello world',
      'Row',
      'of list',
    ]);
  });

  it('drops host tags, runtime literals, and strings without letters', () => {
    expect(componentStringsOf('function e(){return h("div",{type:"button"},"12",typeof x=="function","react.memo")}').strings)
      .toEqual([]);
  });

  it('skips comments and regular expressions', () => {
    const text = 'function e(t){/* "hidden" */ // "also hidden"\nreturn /"quoted"/.test(t)?"shown":null}';
    expect(componentStringsOf(text).strings).toEqual(['shown']);
  });

  it('caps the list and counts what it left out', () => {
    const text = `function e(){return[${Array.from({ length: 15 }, (_, index) => `"label${index}"`).join(',')}]}`;
    expect(componentStringsOf(text, 12)).toMatchObject({ omitted: 3 });
    expect(componentStringsOf(text, 12).strings).toHaveLength(12);
  });

  it('reads the function behind memo and forwardRef wrappers', () => {
    function render() { return 'inner-label'; }
    expect(componentStrings({ $$typeof: Symbol.for('react.memo'), type: { render } }).strings).toEqual(['inner-label']);
    expect(componentStrings('div')).toEqual({ strings: [], omitted: 0 });
  });
});
