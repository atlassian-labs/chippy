import { describe, expect, it } from 'vitest';
import { describeInputEvent } from './input-details';

describe('describeInputEvent', () => {
  it('keeps named keys and held modifiers', () => {
    expect(describeInputEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }))).toEqual({
      trusted: false,
      key: 'Meta',
      modifiers: ['Meta'],
    });
    expect(describeInputEvent(new KeyboardEvent('keyup', { key: 'Tab' }))).toEqual({ trusted: false, key: 'Tab' });
  });

  it('records a key that types a character as `character`', () => {
    expect(describeInputEvent(new KeyboardEvent('keydown', { key: 'p', shiftKey: true }))).toEqual({
      trusted: false,
      key: 'character',
      modifiers: ['Shift'],
    });
    expect(describeInputEvent(new KeyboardEvent('keydown', { key: 'é' })).key).toBe('character');
  });

  it('records modifiers on mouse events and no key', () => {
    expect(describeInputEvent(new MouseEvent('click', { ctrlKey: true }))).toEqual({ trusted: false, modifiers: ['Control'] });
    expect(describeInputEvent(new MouseEvent('click'))).toEqual({ trusted: false });
  });

  it('records only trust for other events', () => {
    expect(describeInputEvent(new Event('submit'))).toEqual({ trusted: false });
  });
});
