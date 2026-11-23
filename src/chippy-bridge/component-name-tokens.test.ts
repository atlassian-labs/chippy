import { describe, expect, it } from 'vitest';
import { componentNamesIn, nameTokensIn } from './component-name-tokens';

describe('nameTokensIn', () => {
  it('collects identifier words from strings and keys', () => {
    const tokens = nameTokensIn({ at: 'App › TodoList › Qr', 'Item#1@3': { sourceId: 'T4#2@1', count: 3 } });
    expect([...tokens].sort()).toEqual(['App', 'Item', 'Qr', 'T4', 'TodoList', 'at', 'count', 'sourceId']);
  });

  it('skips a nested rename table', () => {
    const tokens = nameTokensIn({ meta: { componentNames: [{ name: 'Item', minifiedName: 'Qr' }] } });
    expect([...tokens].sort()).toEqual(['meta']);
  });

  it('stops at the limit', () => {
    expect(nameTokensIn(['a b c d'], 2).size).toBe(2);
  });
});

describe('componentNamesIn', () => {
  const renames = [{ name: 'Item', minifiedName: 'Qr' }, { name: 'Header', minifiedName: 'Kt' }];

  it('lists only the renames a result mentions', () => {
    expect(componentNamesIn({ rendered: [{ name: 'Item' }] }, renames)).toEqual([renames[0]]);
    expect(componentNamesIn({ rendered: [] }, renames)).toEqual([]);
    expect(componentNamesIn({ meta: { componentNames: renames } }, renames)).toEqual([]);
  });

  it('ignores a missing or malformed table from a saved file', () => {
    expect(componentNamesIn({ name: 'Item' }, undefined)).toEqual([]);
    expect(componentNamesIn({ name: 'Item' }, [{ name: 'Item' }, 'Item'])).toEqual([]);
  });
});
