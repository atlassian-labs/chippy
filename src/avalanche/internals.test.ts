import { describe, expect, it } from 'vitest';
import { getComponentName, type Fiber } from './internals';

describe('getComponentName source fallback', () => {
  it('does not format a React 19 debug stack for an already named component', () => {
    const fiber = { type: { name: 'NamedComponent' } };
    Object.defineProperty(fiber, '_debugStack', {
      get() {
        throw new Error('named fibers must not read source metadata');
      },
    });

    expect(getComponentName(fiber as Fiber)).toBe('NamedComponent');
  });

  it('uses the React 19 stack frame for an otherwise anonymous component', () => {
    const fiber = {
      type: {},
      _debugStack: { stack: 'Error\n    at View (http://host/src/View.tsx:7:3)' },
    };

    expect(getComponentName(fiber as Fiber)).toBe('<http://host/src/View.tsx:7>');
  });
});
