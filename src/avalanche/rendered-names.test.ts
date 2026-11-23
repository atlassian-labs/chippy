import { describe, expect, it } from 'vitest';
import { createRenderedNames, UNNAMED_COMPONENT, type RenderedNameEntry } from './rendered-names';

function setup() {
  const names = new Map<string, string>();
  // Runtime names a recovered name replaced, keyed by type.
  const minified = new Map<string, string>();
  const types: Record<string, string> = { 'T1#1@0': 'a', 'T1#2@1': 'a', 'T2#1@0': 'b', 'T3#1@0': 'c' };
  const tracker = createRenderedNames<string>({
    typeOf: (sourceId) => types[sourceId] ?? null,
    types: () => new Set(Object.values(types)),
    nameOf: (type) => names.get(type) ?? UNNAMED_COMPONENT,
    minifiedNameOf: (type) => minified.get(type) ?? null,
  });
  return { names, minified, tracker };
}

const entry = (sourceId: string, name = UNNAMED_COMPONENT): RenderedNameEntry => ({ sourceId, name });

describe('createRenderedNames', () => {
  it('lists each unnamed type once and ignores named entries', () => {
    const { tracker } = setup();
    for (const item of [entry('T1#1@0'), entry('T1#2@1'), entry('T2#1@0', 'Named'), entry('T9#1@0')]) tracker.note(item);
    expect(tracker.unnamedTypes()).toEqual(['a']);
  });

  it('renames only entries whose type gained a name, across commits', () => {
    const { names, tracker } = setup();
    const byCommit = { 1: [entry('T1#1@0'), entry('T2#1@0')], 2: [entry('T1#2@1')] };
    for (const list of Object.values(byCommit)) list.forEach(tracker.note);
    expect(tracker.refresh(byCommit)).toBe(0);

    names.set('a', 'Text');
    expect(tracker.refresh(byCommit)).toBe(2);
    expect(byCommit[1].map((e) => e.name)).toEqual(['Text', UNNAMED_COMPONENT]);
    expect(byCommit[2][0].name).toBe('Text');
    expect(tracker.unnamedTypes()).toEqual(['b']);
  });

  it('replaces a minified name and keeps it as minifiedName', () => {
    const { names, minified, tracker } = setup();
    const byCommit: Record<number, RenderedNameEntry[]> = { 1: [entry('T3#1@0', 'Qr'), entry('T2#1@0', 'Kept')] };
    expect(tracker.refresh(byCommit)).toBe(0);

    names.set('c', 'Item');
    minified.set('c', 'Qr');
    expect(tracker.refresh(byCommit)).toBe(1);
    expect(byCommit[1]).toEqual([{ sourceId: 'T3#1@0', name: 'Item', minifiedName: 'Qr' }, entry('T2#1@0', 'Kept')]);
    expect(tracker.renames()).toEqual([{ name: 'Item', minifiedName: 'Qr' }]);
    // A second refresh has nothing left to change.
    expect(tracker.refresh(byCommit)).toBe(0);
  });

  it('adds minifiedName to entries recorded after the rename', () => {
    const { names, minified, tracker } = setup();
    names.set('c', 'Item');
    minified.set('c', 'Qr');
    const byCommit: Record<number, RenderedNameEntry[]> = { 1: [entry('T3#1@0', 'Qr')] };
    tracker.refresh(byCommit);

    // Recorded once the name was known, so it already reads Item.
    byCommit[2] = [entry('T3#1@0', 'Item')];
    expect(tracker.refresh(byCommit)).toBe(1);
    expect(byCommit[2][0]).toEqual({ sourceId: 'T3#1@0', name: 'Item', minifiedName: 'Qr' });
  });

  it('starts empty after reset', () => {
    const { names, minified, tracker } = setup();
    tracker.note(entry('T1#1@0'));
    names.set('c', 'Item');
    minified.set('c', 'Qr');
    tracker.refresh({});
    tracker.reset();
    expect(tracker.unnamedTypes()).toEqual([]);
    expect(tracker.renames()).toEqual([]);
  });
});
