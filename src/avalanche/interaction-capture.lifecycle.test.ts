import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInteractionCapture } from './interaction-capture';

/**
 * Interaction capture lifecycle contract.
 *
 * Pure lifecycle: install / uninstall / reset / linkRecent / capture-level.
 * Field preservation is already covered by detector.rtl.test.tsx; this file
 * isolates the transitions so a regression in one of them surfaces here.
 *
 * Tests use the real `document` (jsdom) and a real `MouseEvent`. We dispatch
 * events directly rather than calling `capture()` so the listener attach/detach
 * logic is what's actually being measured.
 */

function dispatchClick(target: Element = document.body) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

function dispatchWheel(target: Element = document.body) {
  target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
}

describe('createInteractionCapture — install / uninstall / reset', () => {
  let cap: ReturnType<typeof createInteractionCapture>;

  beforeEach(() => {
    cap = createInteractionCapture();
  });

  afterEach(() => {
    cap.uninstall();
  });

  it('does not capture events before install', () => {
    dispatchClick();
    expect(cap.state.actions).toHaveLength(0);
  });

  it('captures events after install', () => {
    cap.install();
    dispatchClick();
    expect(cap.state.actions).toHaveLength(1);
    expect(cap.state.actions[0].action).toBe('click');
  });

  it('install is idempotent — listeners do not multiply', () => {
    cap.install();
    cap.install();
    cap.install();
    dispatchClick();
    expect(cap.state.actions).toHaveLength(1);
  });

  it('uninstall stops capture', () => {
    cap.install();
    cap.uninstall();
    dispatchClick();
    expect(cap.state.actions).toHaveLength(0);
  });

  it('uninstall is idempotent — does not throw when called twice', () => {
    cap.install();
    cap.uninstall();
    expect(() => cap.uninstall()).not.toThrow();
  });

  it('reset clears state.actions but leaves listeners attached', () => {
    cap.install();
    dispatchClick();
    expect(cap.state.actions).toHaveLength(1);
    cap.reset();
    expect(cap.state.actions).toHaveLength(0);
    // still capturing
    dispatchClick();
    expect(cap.state.actions).toHaveLength(1);
  });

  it('reset clears state.byCommit', () => {
    cap.install();
    cap.state.byCommit[7] = [
      { id: 1, lastCommitId: 6, deltaTime: 1, action: 'click', location: {} as never },
    ];
    cap.reset();
    expect(cap.state.byCommit).toEqual({});
  });

  it('reset restarts action id from 1', () => {
    cap.install();
    dispatchClick();
    dispatchClick();
    expect(cap.state.actions.map((a) => a.id)).toEqual([1, 2]);
    cap.reset();
    dispatchClick();
    expect(cap.state.actions[0].id).toBe(1);
  });
});

describe('createInteractionCapture — interactionCapture level', () => {
  it("defaults to 'explicit' — captures click but not wheel", () => {
    const cap = createInteractionCapture();
    cap.install();
    dispatchClick();
    dispatchWheel();
    expect(cap.state.actions.map((a) => a.action)).toEqual(['click']);
    cap.uninstall();
  });

  it("'off' — no listeners attached", () => {
    const cap = createInteractionCapture({ interactionCapture: 'off' });
    cap.install();
    dispatchClick();
    dispatchWheel();
    expect(cap.state.actions).toHaveLength(0);
    cap.uninstall();
  });

  it("'noisy' — adds wheel/scroll/pointermove on top of explicit", () => {
    const cap = createInteractionCapture({ interactionCapture: 'noisy' });
    cap.install();
    dispatchClick();
    dispatchWheel();
    expect(cap.state.actions.map((a) => a.action).sort()).toEqual(['click', 'wheel']);
    cap.uninstall();
  });

  it("custom interactionEvents are merged in without duplicates", () => {
    const cap = createInteractionCapture({
      interactionCapture: 'explicit',
      interactionEvents: ['custom-thing', 'click'], // 'click' is already explicit
    });
    cap.install();
    document.body.dispatchEvent(new Event('custom-thing', { bubbles: true }));
    dispatchClick();
    expect(cap.state.actions.map((a) => a.action).sort()).toEqual(['click', 'custom-thing']);
    cap.uninstall();
  });
});

describe('createInteractionCapture — linkRecent', () => {
  it('links actions whose timestamp falls inside the window before commit', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 1000 });
    cap.state.actions.push({
      id: 42,
      action: 'click',
      timestamp: 500,
      location: {} as never,
    });
    cap.linkRecent(7, 600);
    expect(cap.state.byCommit[7]).toEqual([
      { id: 42, lastCommitId: 6, deltaTime: 100, action: 'click', location: {} },
    ]);
  });

  it('does not link actions before the window opens (too old)', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 100 });
    cap.state.actions.push({
      id: 1,
      action: 'click',
      timestamp: 0,
      location: {} as never,
    });
    cap.linkRecent(1, 500); // 500ms after, window only 100ms
    expect(cap.state.byCommit[1]).toBeUndefined();
  });

  it('does not link actions whose timestamp is after the commit', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 1000 });
    cap.state.actions.push({
      id: 1,
      action: 'click',
      timestamp: 1000,
      location: {} as never,
    });
    cap.linkRecent(1, 500); // commit happened before the action — guard against clock skew
    expect(cap.state.byCommit[1]).toBeUndefined();
  });

  it('preserves action.id through the link (regression: was previously dropped)', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 1000 });
    cap.state.actions.push({
      id: 99,
      action: 'click',
      timestamp: 0,
      location: {} as never,
    });
    cap.linkRecent(1, 50);
    expect(cap.state.byCommit[1][0].id).toBe(99);
  });

  it('windowMs=0 disables linking entirely', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 0 });
    cap.state.actions.push({
      id: 1,
      action: 'click',
      timestamp: 0,
      location: {} as never,
    });
    cap.linkRecent(1, 0);
    expect(cap.state.byCommit).toEqual({});
  });

  it('prunes actions older than the window after linking', () => {
    const cap = createInteractionCapture({ interactionWindowMs: 100 });
    cap.state.actions.push({
      id: 1,
      action: 'click',
      timestamp: 0,
      location: {} as never,
    });
    cap.linkRecent(1, 500); // 500 - 0 = 500ms > 100ms window
    expect(cap.state.actions).toHaveLength(0);
  });
});

describe('createInteractionCapture — buffer bounds', () => {
  it('caps state.actions at MAX_INTERACTION_ACTIONS (200) by dropping oldest', () => {
    const cap = createInteractionCapture();
    cap.install();
    for (let i = 0; i < 250; i++) dispatchClick();
    expect(cap.state.actions).toHaveLength(200);
    // ids monotonically increasing — last id is 250, first is 51 after the trim
    expect(cap.state.actions[0].id).toBe(51);
    expect(cap.state.actions[cap.state.actions.length - 1].id).toBe(250);
    cap.uninstall();
  });
});
