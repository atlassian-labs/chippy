import { describe, expect, it } from 'vitest';
import { createRenderedNames, UNNAMED_COMPONENT, type RenderedNameEntry } from './rendered-names';

function setup() {
  const names = new Map<string, string>();
  const types: Record<string, string> = { 'T1#1@0': 'a', 'T1#2@1': 'a', 'T2#1@0': 'b' };
  const tracker = createRenderedNames<string>({
    typeOf: (sourceId) => types[sourceId] ?? null,
    nameOf: (type) => names.get(type) ?? UNNAMED_COMPONENT,
  });
  return { names, tracker };
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

  it('starts empty after reset', () => {
    const { tracker } = setup();
    tracker.note(entry('T1#1@0'));
    tracker.reset();
    expect(tracker.unnamedTypes()).toEqual([]);
  });
});
