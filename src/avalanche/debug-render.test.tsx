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
      { name: 'useState', loc: '1:1', url: 'react-dom.development.js' },
      { name: 'useCounter', loc: '10:2', url: 'useCounter.ts' },
      { name: 'SampleComponent', loc: '20:4', url: 'SampleComponent.tsx' },
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

  it('traps React 19 dispatcher assignments on shared internals `H`', () => {
    const debugRender = createDebugRender();
    const internals: Record<string, any> = { H: null, A: null, T: null, S: null };
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { currentDispatcherRef: internals }]]),
    };

    try {
      expect(debugRender.install()).toEqual({ ok: true });
      expect('current' in internals).toBe(false);
      const original = () => 'state';
      internals.H = { useState: original };
      expect(internals.H.useState).not.toBe(original);
      expect(internals.H.useState()).toBe('state');
      expect(debugRender.dispatcherRef()!.current).toBe(internals.H);
      expect(debugRender.status().hasDispatcherRef).toBe(true);
    } finally {
      debugRender.uninstall();
      delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    }
    expect(Object.getOwnPropertyDescriptor(internals, 'H')!.writable).toBe(true);
  });
});

describe('isHookFrameName', () => {
  it('recognizes bare and qualified hook frame names', async () => {
    const { isHookFrameName } = await import('../debug-render/core');
    expect(isHookFrameName('useState')).toBe(true);
    expect(isHookFrameName('exports.useState')).toBe(true);
    expect(isHookFrameName('Object.useCounter')).toBe(true);
    expect(isHookFrameName('StockCounter')).toBe(false);
    expect(isHookFrameName('exports.user')).toBe(false);
  });
});

describe('debug-render hook sequences', () => {
  function setup(extraRenderers: Array<Record<string, unknown>> = [], getCurrentFiber?: () => unknown) {
    const debugRender = createDebugRender();
    const internals: Record<string, any> = { H: null };
    const renderers = [{ currentDispatcherRef: internals, getCurrentFiber }, ...extraRenderers];
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(renderers.map((r, i) => [i + 1, r])) };
    debugRender.install();
    const hooks = { useState: (v: unknown) => [v], useMemo: (f: () => unknown) => f() };
    const idle = {};
    // As React does: assign the hooks dispatcher, render, assign the idle one.
    const render = (component: () => void) => { internals.H = hooks; component(); internals.H = idle; };
    return { debugRender, internals, render, done: () => { debugRender.uninstall(); delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__; } };
  }

  it('keeps one sequence per component and adds only positions not yet reached', () => {
    const { debugRender, internals, render, done } = setup();
    let showMore = false;
    function Counter() {
      internals.H.useState(1);
      internals.H.useMemo(() => 2);
      if (showMore) internals.H.useState(3);
    }
    function Other() { internals.H.useState('other'); }
    try {
      render(Counter);
      render(Other);
      render(Counter);
      expect(debugRender.rawEvents('Counter').map((e) => e.primitive)).toEqual(['State', 'Memo']);
      showMore = true;
      render(Counter);
      const events = debugRender.rawEvents('Counter');
      expect(events.map((e) => e.args[0])).toEqual([1, events[1].args[0], 3]);
      expect(events.every((e) => e.componentName === 'Counter')).toBe(true);
      expect(debugRender.rawEvents('Other')).toHaveLength(1);
      expect(debugRender.status().totalCapturedEvents).toBe(4);
    } finally {
      done();
    }
  });

  it('names a component whose first hook sits below many custom hooks', () => {
    const { debugRender, internals, render, done } = setup();
    const useA = () => internals.H.useState(0);
    const useB = () => useA(); const useC = () => useB(); const useD = () => useC();
    const useE = () => useD(); const useF = () => useE(); const useG = () => useF();
    function DeepHooks() { useG(); }
    try {
      render(DeepHooks);
      const [event] = debugRender.rawEvents('DeepHooks');
      expect(event.frames.map((f) => f.name)).toEqual(expect.arrayContaining(['useA', 'useG', 'DeepHooks']));
    } finally {
      done();
    }
  });

  it('names later renders of a component type from the fiber React is rendering', () => {
    let fiber: { type: unknown } | null = null;
    const { debugRender, internals, render, done } = setup([], () => fiber);
    function Counter() { internals.H.useState(1); internals.H.useMemo(() => 2); }
    // Calls hooks from a function with another name while React reports
    // Counter's fiber: only a cached type name can attribute these to Counter.
    function Impostor() { internals.H.useState(1); internals.H.useMemo(() => 2); internals.H.useState(3); }
    try {
      fiber = { type: Counter };
      render(Counter);
      render(Impostor);
      expect(debugRender.rawEvents('Counter').map((e) => e.args[0])).toEqual([1, expect.anything(), 3]);
      expect(debugRender.rawEvents('Impostor')).toHaveLength(0);
    } finally {
      done();
    }
  });

  it('names from stacks when several renderers report a current fiber', () => {
    let fiber: { type: unknown } | null = null;
    const internalsOther = { H: null };
    const { debugRender, internals, render, done } = setup([{ currentDispatcherRef: internalsOther, getCurrentFiber: () => null }], () => fiber);
    function Counter() { internals.H.useState(1); }
    function Impostor() { internals.H.useState(2); }
    try {
      fiber = { type: Counter };
      render(Counter);
      render(Impostor);
      expect(debugRender.rawEvents('Impostor')).toHaveLength(1);
    } finally {
      done();
    }
  });
});
