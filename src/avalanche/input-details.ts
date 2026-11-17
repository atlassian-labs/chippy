/**
 * What kind of input a captured DOM event was, without recording what was typed.
 *
 * `trusted` is the browser's `isTrusted`: true for input the browser received
 * from the operating system, false for events that page code dispatched.
 * Trusted key events are not always deliberate key presses. Switching apps
 * with Cmd+Tab or Alt+Tab, for example, sends the page a keydown and a keyup
 * for the modifier key.
 *
 * Keyboard events record named keys (`Meta`, `Tab`, `Escape`, `ArrowDown`)
 * as they are. Keys that produce a character are recorded as `character`, so a
 * capture never holds typed text such as passwords.
 */

export type InputModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface InputEventDetails {
  /** `event.isTrusted`: browser input (true) or dispatched by page code (false). */
  trusted: boolean;
  /** Keyboard events: the named key, or `character` for a key that types a character. */
  key?: string;
  /** Keyboard and mouse events: modifier keys held during the event. */
  modifiers?: InputModifier[];
}

interface ModifierState {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

function modifiersOf(event: ModifierState): InputModifier[] {
  const held: InputModifier[] = [];
  if (event.altKey) held.push('Alt');
  if (event.ctrlKey) held.push('Control');
  if (event.metaKey) held.push('Meta');
  if (event.shiftKey) held.push('Shift');
  return held;
}

/** Named keys have multi-character names; a single character is typed text. */
function safeKeyName(key: unknown): string {
  if (typeof key !== 'string' || key === '') return 'unknown';
  return [...key].length === 1 ? 'character' : key;
}

export function describeInputEvent(event: Event): InputEventDetails {
  const details: InputEventDetails = { trusted: event.isTrusted };
  const withModifiers = event as Event & ModifierState & { key?: unknown };
  if (typeof withModifiers.key !== 'undefined' && /^key/.test(event.type)) {
    details.key = safeKeyName(withModifiers.key);
  }
  if (typeof withModifiers.metaKey === 'boolean') {
    const held = modifiersOf(withModifiers);
    if (held.length) details.modifiers = held;
  }
  return details;
}
