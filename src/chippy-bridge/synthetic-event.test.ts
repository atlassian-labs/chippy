import { describe, expect, it } from 'vitest';
import { createSyntheticEvent, firstElementOf, isEventPlaceholder } from './synthetic-event';

function hostFiber(element: Element) {
  return { tag: 5, stateNode: element };
}

describe('synthetic event', () => {
  it('recognizes only objects with a non-empty $event string', () => {
    expect(isEventPlaceholder({ $event: 'click' })).toBe(true);
    expect(isEventPlaceholder({ $event: ' ' })).toBe(false);
    expect(isEventPlaceholder({ $event: 1 })).toBe(false);
    expect(isEventPlaceholder([{ $event: 'click' }])).toBe(false);
    expect(isEventPlaceholder('click')).toBe(false);
  });

  it("finds a composite fiber's first rendered element, not its sibling's", () => {
    const button = document.createElement('button');
    const other = document.createElement('div');
    const composite = { tag: 0, stateNode: null, child: { tag: 0, stateNode: null, child: hostFiber(button) }, sibling: hostFiber(other) };
    expect(firstElementOf(composite)).toBe(button);
    expect(firstElementOf({ tag: 0, stateNode: null })).toBeNull();
  });

  it('targets the element, records calls, and keeps extra JSON fields', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save');
    const { event, report } = createSyntheticEvent({ $event: 'keydown', key: 'Enter', target: 'ignored', shiftKey: true }, hostFiber(button));
    const e = event as { type: string; key: string; shiftKey: boolean; target: Element; currentTarget: Element; nativeEvent: Event; preventDefault(): void; stopPropagation(): void; isDefaultPrevented(): boolean; defaultPrevented: boolean };
    expect([e.type, e.key, e.shiftKey, e.target, e.currentTarget]).toEqual(['keydown', 'Enter', true, button, button]);
    expect(e.nativeEvent).toBeInstanceOf(KeyboardEvent);
    e.preventDefault();
    e.stopPropagation();
    expect(e.isDefaultPrevented()).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(e.nativeEvent.defaultPrevented).toBe(true);
    expect(report).toEqual({
      synthetic: true, type: 'keydown', target: 'button[data-testid="save"]',
      calls: ['preventDefault', 'stopPropagation'], defaultPrevented: true, propagationStopped: true, missing: [],
    });
  });

  it('reports fields the handler read that the event lacks', () => {
    const { event, report } = createSyntheticEvent({ $event: 'click' }, null);
    const e = event as Record<string, unknown>;
    void e.clientX;
    void e.clientX;
    void e.then;
    expect(report.missing).toEqual(['clientX']);
    expect(report.target).toBeNull();
    expect(e.nativeEvent).toBeInstanceOf(MouseEvent);
  });
});
