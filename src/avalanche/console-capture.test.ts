import { describe, expect, it, vi } from 'vitest';
import { createConsoleCapture, formatConsoleArgs, previewValue } from './console-capture';

function fakeTarget() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const calls: Array<[string, unknown[]]> = [];
  const consoleObject: Record<string, (...args: unknown[]) => void> = {};
  for (const level of ['error', 'warn', 'info', 'log', 'debug']) consoleObject[level] = (...args) => { calls.push([level, args]); };
  const target = {
    console: consoleObject,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener)),
  };
  const dispatch = (type: string, event: Record<string, unknown>) => {
    for (const listener of listeners.get(type) ?? []) listener({ target, ...event });
  };
  return { target, consoleObject, calls, dispatch, listeners };
}

describe('formatConsoleArgs', () => {
  it('substitutes format tokens the way DevTools does', () => {
    expect(formatConsoleArgs(['Warning: Each child in a list should have a unique "%s" prop.%s', 'key', '\n    in Row'])).toBe('Warning: Each child in a list should have a unique "key" prop.\n    in Row');
    expect(formatConsoleArgs(['%c styled %d items, %f%%', 'color: red', '3.7', 0.5])).toBe(' styled 3 items, 0.5%');
    expect(formatConsoleArgs(['loaded', { id: 1, tags: ['a'] }, 2])).toBe('loaded {id: 1, tags: ["a"]} 2');
    expect(formatConsoleArgs([new TypeError('x is undefined')])).toBe('TypeError: x is undefined');
  });

  it('bounds previews of large, deep, and circular values', () => {
    const circular: Record<string, unknown> = { name: 'root' };
    circular.self = circular;
    expect(previewValue(circular)).toBe('{name: root, self: [Circular]}'.replace('root', '"root"'));
    expect(previewValue({ a: { b: { c: 1 } } })).toBe('{a: {b: {…}}}');
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`key${i}`, i]));
    expect(previewValue(big).length).toBeLessThanOrEqual(201);
  });
});

describe('createConsoleCapture', () => {
  it('records each level and still calls the original method', () => {
    const { target, consoleObject, calls } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    consoleObject.error('failed to load %s', 'board');
    consoleObject.log('hello', 1);
    expect(calls).toEqual([['error', ['failed to load %s', 'board']], ['log', ['hello', 1]]]);
    expect(capture.entries.map(({ level, source, message }) => ({ level, source, message }))).toEqual([
      { level: 'error', source: 'console', message: 'failed to load board' },
      { level: 'log', source: 'console', message: 'hello 1' },
    ]);
    expect(capture.entries[0].stack).toMatch(/console-capture\.test\.ts/);
    expect(capture.entries[0].location).toMatch(/console-capture\.test\.ts:\d+:\d+$/);
    expect(capture.entries[1].stack).toBeNull();
    expect(capture.status()).toMatchObject({ enabled: true, installed: true, entries: 2, byLevel: { error: 1, log: 1 } });
  });

  it('keeps a logged Error\'s own stack', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    const error = new Error('boom');
    consoleObject.error('caught', error);
    expect(capture.entries[0].message).toBe('caught Error: boom');
    expect(capture.entries[0].stack).toContain(error.stack!.split('\n')[1].trim());
  });

  it('reads locations from blob and extension script URLs, and prefixes rejections like DevTools', () => {
    const { target, dispatch } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    const reason = new Error('fetch timed out');
    reason.stack = 'Error: fetch timed out\n    at load (blob:https://app.test/5e7c:1:30)\n    at https://app.test/main.js:9:2';
    dispatch('unhandledrejection', { reason });
    expect(capture.entries[0]).toMatchObject({ message: 'Uncaught (in promise) Error: fetch timed out', location: 'blob:https://app.test/5e7c:1:30' });
  });

  it('collapses consecutive identical messages into one entry with a repeat count', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    for (let i = 0; i < 3; i++) consoleObject.warn('slow render');
    consoleObject.warn('other');
    expect(capture.entries.map((e) => [e.message, e.repeat])).toEqual([['slow render', 3], ['other', 1]]);
    expect(capture.entries[0].lastTime).toBeGreaterThanOrEqual(capture.entries[0].time);
  });

  it('records uncaught errors and unhandled rejections, not resource load failures', () => {
    const { target, dispatch } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    dispatch('error', { message: 'Uncaught ReferenceError: x is not defined', filename: 'https://app.test/main.js', lineno: 10, colno: 4, error: new ReferenceError('x is not defined') });
    dispatch('error', { target: { tagName: 'IMG' } });
    dispatch('unhandledrejection', { reason: { status: 500 } });
    expect(capture.entries.map(({ level, source, message, location }) => ({ level, source, message, location }))).toEqual([
      { level: 'error', source: 'uncaught', message: 'ReferenceError: x is not defined', location: 'https://app.test/main.js:10:4' },
      { level: 'error', source: 'rejection', message: 'Uncaught (in promise) {status: 500}', location: null },
    ]);
  });

  it('flags messages Chippy itself logged', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    consoleObject.log('[avalanche] start', {});
    consoleObject.log('page message');
    expect(capture.entries.map((e) => e.chippy ?? false)).toEqual([true, false]);
  });

  it('drops the oldest entries of a level past the limit, so log spam cannot push out errors', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({ maxConsoleEntries: 2 }, target);
    capture.install();
    consoleObject.error('first error');
    for (let i = 0; i < 5; i++) consoleObject.log(`log ${i}`);
    expect(capture.entries.map((e) => e.message)).toEqual(['first error', 'log 3', 'log 4']);
    expect(capture.status().dropped).toEqual({ log: 3 });
  });

  it('records nothing while paused, and clears on reset', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    capture.pause();
    consoleObject.error('while paused');
    expect(capture.entries).toEqual([]);
    capture.resume();
    consoleObject.error('after resume');
    capture.reset();
    expect(capture.entries).toEqual([]);
    consoleObject.error('after reset');
    expect(capture.entries[0]).toMatchObject({ id: 1, message: 'after reset' });
  });

  it('restores the console on uninstall, and leaves a later wrapper in place', () => {
    const { target, consoleObject, listeners } = fakeTarget();
    const originalError = consoleObject.error;
    const originalLog = consoleObject.log;
    const capture = createConsoleCapture({}, target);
    capture.install();
    capture.install();
    const ours = consoleObject.log;
    const later = vi.fn((...args: unknown[]) => ours(...args));
    consoleObject.log = later;
    capture.uninstall();
    expect(consoleObject.error).toBe(originalError);
    expect(consoleObject.log).toBe(later);
    consoleObject.log('after uninstall');
    expect(capture.entries).toEqual([]);
    expect(later).toHaveBeenCalled();
    expect(listeners.get('error')).toEqual([]);
    expect(listeners.get('unhandledrejection')).toEqual([]);
    expect(originalLog).not.toBe(later);
  });

  it('does nothing when switched off', () => {
    const { target, consoleObject } = fakeTarget();
    const original = consoleObject.error;
    const capture = createConsoleCapture({ consoleCapture: false }, target);
    capture.install();
    expect(consoleObject.error).toBe(original);
    expect(capture.status()).toMatchObject({ enabled: false, installed: false });
  });

  it('survives a value whose getter throws, and does not record its own logging', () => {
    const { target, consoleObject } = fakeTarget();
    const capture = createConsoleCapture({}, target);
    capture.install();
    const hostile = { get boom() { consoleObject.log('nested'); throw new Error('nope'); } };
    consoleObject.warn('value', hostile);
    expect(capture.entries.map((e) => e.message)).toEqual(['value {boom: "[getter threw]"}']);
  });
});
