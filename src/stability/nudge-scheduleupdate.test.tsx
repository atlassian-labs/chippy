// White-box proof: the React DevTools renderer's `scheduleUpdate(fiber)` is a
// universal re-render trigger — it re-renders ANY composite fiber, including a
// function component that has NO hooks at all (the case the old useState-based
// nudge could not handle).
//
// This is the single mechanism the rewritten `stability-nudge` snippet relies on.
//
// Contract proven here:
//   1. The devtools-hook shim, installed before react-dom evaluates, captures
//      the renderer object into hook.renderers.
//   2. That renderer exposes `scheduleUpdate` (dev builds only).
//   3. Calling `scheduleUpdate(fiber)` on a hookless FC's fiber forces a commit.
//   4. No hook/prop pollution is required (unlike the old useState nudge).

// IMPORTANT: this side-effect import installs the devtools-hook shim BEFORE
// react-dom is evaluated. ESM evaluates imports top-to-bottom, so this line
// MUST stay above the react / @testing-library imports. React-dom reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ once, at module-evaluation time, and registers
// its renderer (carrying `scheduleUpdate`) into hook.renderers only if the hook
// already exists. (See AGENTS.md "DevTools-hook shim".)
import './devtools-hook-shim.fixture';

import { describe, expect, it, afterAll } from 'vitest';
import React from 'react';
import { act, render, cleanup } from '@testing-library/react';

type RendererWithSchedule = { scheduleUpdate?: (fiber: unknown) => void };

function getRenderer(): RendererWithSchedule | null {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.renderers) return null;
  for (const [, r] of hook.renderers.entries()) return r;
  return null;
}

function fiberFromNode(node: Element | null): any {
  if (!node) return null;
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
  let f = key ? (node as any)[key] : null;
  // Walk up to the first composite (non-host) fiber.
  while (f && (typeof f.type === 'string' || f.type == null)) f = f.return;
  return f;
}

// A function component with ZERO hooks. The old nudge returned `no-state-hook`
// for exactly this shape. It renders a render-count read from a module-level
// counter so we can prove a re-render happened without any state of its own.
let hooklessRenderCount = 0;
function Hookless() {
  hooklessRenderCount += 1;
  return <span data-testid="hookless">renders:{hooklessRenderCount}</span>;
}

describe('scheduleUpdate nudge (Tier 4, the only mechanism)', () => {
  afterAll(() => {
    cleanup();
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  it('renderer registered by react-dom exposes scheduleUpdate', () => {
    render(<Hookless />);
    const renderer = getRenderer();
    expect(renderer).not.toBeNull();
    expect(typeof renderer!.scheduleUpdate).toBe('function');
  });

  it('re-renders a hookless function component with zero pollution', () => {
    const { getByTestId } = render(<Hookless />);
    const before = hooklessRenderCount;

    const fiber = fiberFromNode(getByTestId('hookless'));
    expect(fiber).not.toBeNull();
    // It is genuinely hookless: no hook linked list.
    expect(fiber.memoizedState).toBeNull();

    const renderer = getRenderer();
    act(() => {
      renderer!.scheduleUpdate!(fiber);
    });

    // The component re-rendered exactly because of scheduleUpdate — no state,
    // no prop change, no hook mutation.
    expect(hooklessRenderCount).toBeGreaterThan(before);
    // Props untouched (no overrideProps-style mutation).
    expect(fiber.memoizedState).toBeNull();
  });
});
