import { describe, expect, it } from 'vitest';
import { summarizeRebuiltProps } from './rebuilt-props';

const same = { name: 'appState', kind: 'ref-changed', current: 'object{theme,zoom}', sameShallow: true, changedKeys: [], changedKeyCount: 0 };

describe('summarizeRebuiltProps', () => {
  it('groups the same rebuilt prop across components, first component in render order', () => {
    const rendered = [
      { sourceId: 'LayerUI#1@1', name: 'LayerUI', propChanges: [same] },
      { sourceId: 'Toolbar#1@2', name: 'Toolbar', propChanges: [same, { name: 'onClick', kind: 'ref-changed', current: 'function onClick' }] },
      {
        sourceId: 'Canvas#1@3', name: 'Canvas',
        propChanges: [{
          name: 'elements', kind: 'ref-changed', current: 'array(30)',
          changedKeys: [{ key: '2', kind: 'ref-changed' }], changedKeyCount: 1,
        }, { name: 'zoom', kind: 'scalar-changed', prev: '1', current: '2' }],
      },
      { sourceId: 'Huge#1@4', name: 'Huge', propChanges: [{ name: 'rows', kind: 'ref-changed', current: 'array(5000)', keysNotCompared: 5000 }] },
    ];
    expect(summarizeRebuiltProps(rendered, 2)).toEqual({
      sameShallow: 2,
      keysChanged: 1,
      notCompared: 1,
      groups: [
        { prop: 'appState', component: 'LayerUI', sourceId: 'LayerUI#1@1', components: 2, sameShallow: true },
        { prop: 'elements', component: 'Canvas', sourceId: 'Canvas#1@3', components: 1, changedKeys: ['2'], changedKeyCount: 1 },
      ],
      omittedGroups: 1,
    });
  });

  it('keeps a real change apart from an identity-only one on the same prop', () => {
    const changed = { ...same, sameShallow: undefined, changedKeys: [{ key: 'theme', kind: 'scalar-changed' }], changedKeyCount: 1 };
    const view = summarizeRebuiltProps([{ name: 'A', propChanges: [same] }, { name: 'B', propChanges: [changed] }], 5);
    expect(view?.groups.map((g) => [g.component, g.sameShallow ?? false, g.changedKeys ?? null])).toEqual([
      ['A', true, null],
      ['B', false, ['theme']],
    ]);
  });

  it('is null without key diffs', () => {
    expect(summarizeRebuiltProps(undefined, 3)).toBeNull();
    expect(summarizeRebuiltProps([{ name: 'A', propChanges: [{ name: 'style', kind: 'ref-changed', current: 'object{color}' }] }], 3)).toBeNull();
  });
});
