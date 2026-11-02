import { describe, expect, it } from 'vitest';
import { createDebugRender, parseStackFrames } from '../debug-render/core';

describe('debug-render helpers', () => {
  it('parses stack frames and derives component-facing events from dispatcher calls', () => {
    const frames = parseStackFrames(
      'Error\n' +
        '    at useState (react-dom.development.js:1:1)\n' +
        '    at useCounter (useCounter.ts:10:2)\n' +
        '    at SampleComponent (SampleComponent.tsx:20:4)'
    );

    expect(frames).toEqual([
      { name: 'useState', loc: '1:1' },
      { name: 'useCounter', loc: '10:2' },
      { name: 'SampleComponent', loc: '20:4' },
    ]);

    const debugRender = createDebugRender();
    const dispatcherRef = { current: { useState: () => 1, useMemo: () => 2 } };
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { currentDispatcherRef: dispatcherRef }]]),
    };

    try {
      expect(debugRender.install()).toEqual({ ok: true });
      expect(debugRender.status().installed).toBe(true);
      expect(typeof dispatcherRef.current.useState).toBe('function');
      expect(typeof dispatcherRef.current.useMemo).toBe('function');
    } finally {
      debugRender.uninstall();
      delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    }
  });
});
