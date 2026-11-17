import { describe, expect, it } from 'vitest';
import { deriveComponentName, deriveComponentNameFromStack, parseStackFrames } from './core';

const stack = (...names: string[]) => ['Error', ...names.map((name) => `    at ${name} (http://local.test/app.js:1:1)`)].join('\n');

describe('deriveComponentName', () => {
  it('names the first non-hook frame below the dispatcher wrapper', () => {
    expect(deriveComponentName(parseStackFrames(stack('record', 'atlDispatcherHook', 'useState', 'useCounter', 'Counter', 'renderWithHooks')))).toBe('Counter');
  });

  it('ignores recorder frames that a bundler renamed', () => {
    expect(deriveComponentName(parseStackFrames(stack('record2', 'atlDispatcherHook', 'exports.useState', 'Counter')))).toBe('Counter');
  });

  it('falls back to skipping known internal frames without the wrapper', () => {
    expect(deriveComponentName(parseStackFrames(stack('record', 'useState', 'Counter')))).toBe('Counter');
  });
});

describe('deriveComponentNameFromStack', () => {
  const cases = [
    ['record', 'atlDispatcherHook', 'useState', 'useCounter', 'Counter', 'renderWithHooks'],
    ['record2', 'atlDispatcherHook', 'exports.useState', 'Counter'],
    ['record', 'useState', 'Counter'],
    ['record', 'atlDispatcherHook', 'useState'],
    [],
  ];

  it.each(cases)('names the same component as parsing every frame (%#)', (...names) => {
    const text = stack(...names);
    expect(deriveComponentNameFromStack(text)).toBe(deriveComponentName(parseStackFrames(text)));
  });
});
