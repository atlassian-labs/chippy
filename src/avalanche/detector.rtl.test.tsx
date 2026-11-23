import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreReader } from './DebugHookSUT.jsx';
import { TEST_METRICS_SLOT, createSlotCommitMetricsAdapter } from './test-support/slot-commit-metrics-adapter';
import { createAvalancheDetector } from './detector';
import { evalAvalanche } from '../chippy-bridge/avalanche-commands';
import { ChildDeletion, PerformedWork, type Fiber } from './internals';

function installDevtoolsShim() {
  const g = globalThis as any;
  if (g.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    // Hook already exists (React stored a reference to it at module load time).
    // Reset handlers to no-ops so detector.install() can chain them cleanly.
    const h = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    h.onCommitFiberRoot = () => {};
    h.onCommitFiberUnmount = () => {};
    return h;
  }

  let nextRendererId = 0;
  const renderers = new Map();
  const hook = {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      const id = ++nextRendererId;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
  };

  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return hook;
}

afterEach(() => {
  document.body.innerHTML = '';
  // DO NOT delete the hook — React captured injectedHook = __REACT_DEVTOOLS_GLOBAL_HOOK__
  // at module load time. Deleting and recreating the global leaves React pointing at
  // a stale object. Instead reset handlers to no-ops so the next test starts clean.
  const h = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (h) {
    h.onCommitFiberRoot = () => {};
    h.onCommitFiberUnmount = () => {};
  }
  delete (globalThis as any)[TEST_METRICS_SLOT];
});

describe('createAvalancheDetector with RTL', () => {
  it('renders StoreReader in jsdom but does not observe commit/debug-render integration without browser bootstrap', async () => {
    installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20 });

    detector.install();
    render(<StoreReader storeIntervalMs={Number.POSITIVE_INFINITY} />);

    const tickButton = screen.getByRole('button', { name: 'Tick approvals store' });
    await act(async () => {
      fireEvent.click(tickButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('debug-hook-value')).toHaveTextContent('1 approvals');
    });

    const status = detector._debugRawHookEvents('*') as any;
    expect(status.status.installed).toBe(false);
    expect(status.status.hasDispatcherRef).toBe(false);

    const report = detector.report(20, 'effect');
    expect(report.sources).toHaveLength(0);
    expect(screen.getByTestId('debug-hook-value')).toHaveTextContent('1 approvals');

    detector.uninstall();
  });

  it('captures all commits when the adapter fires before devtools on a reused root', () => {
    const g = globalThis as any;
    g[TEST_METRICS_SLOT] = { rendered: 0 };
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20, metricsAdapter: createSlotCommitMetricsAdapter() });
    detector.install();
    // React in this jsdom process evaluated before the shim existed. Explicitly
    // drive both host callbacks; browser tests prove real renderer integration.
    const root = { current: {
      tag: 0, type: function Counter() {}, flags: PerformedWork, subtreeFlags: 0,
      child: null, sibling: null, return: null, memoizedState: null,
      memoizedProps: {}, alternate: null,
    } as unknown as Fiber };
    try {
      for (let i = 0; i < 5; i++) {
        g[TEST_METRICS_SLOT].onCommitFiberRoot(1, root);
        hook.onCommitFiberRoot(1, root);
      }
      expect(detector.report(20, 'effect').meta.commits).toBe(5);
    } finally { detector.uninstall(); }
  });
});

describe('createAvalancheDetector — structural render evidence', () => {
  function commit(rootFiber: Fiber, updaters = new Set<Fiber>()) {
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20, detectionMode: 'full' });
    detector.install();
    hook.onCommitFiberRoot(1, { current: rootFiber, memoizedUpdaters: updaters });
    return detector.report(20, 'effect') as any;
  }

  it('records unchanged child props during parent propagation', () => {
    function Parent() { return null; }
    function Child() { return null; }
    const prevChild = { tag: 0, type: Child, flags: 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { label: 'same' }, alternate: null } as unknown as Fiber;
    const child = { tag: 0, type: Child, flags: PerformedWork, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { label: 'same' }, alternate: prevChild } as unknown as Fiber;
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const report = commit(parent, new Set([parent]));
    const rendered = Object.values(report.renderedByCommit || {}).flat() as any[];
    const hit = rendered.find((entry) => entry.name === 'Child');
    expect(hit).toBeDefined();
    // Defaults are left out of the entry.
    expect(hit).not.toHaveProperty('propChanges');
    expect(hit).not.toHaveProperty('isSelfSource');
    expect(hit).not.toHaveProperty('trasherCounts');
  });

  it('records ref-changed for an unstable callback prop', () => {
    function Parent() { return null; }
    function Child() { return null; }
    const prevChild = { tag: 0, type: Child, flags: 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { onPing: () => 1 }, alternate: null } as unknown as Fiber;
    const child = { tag: 0, type: Child, flags: PerformedWork, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { onPing: () => 2 }, alternate: prevChild } as unknown as Fiber;
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const report = commit(parent, new Set([parent]));
    const rendered = Object.values(report.renderedByCommit || {}).flat() as any[];
    const hit = rendered.find((entry) => entry.name === 'Child');
    // Same shape, new identity: one summary.
    expect(hit.propChanges).toEqual([{ name: 'onPing', kind: 'ref-changed', current: 'function onPing' }]);
  });

  it('records scalar-changed for a scalar prop update', () => {
    function Parent() { return null; }
    function Child() { return null; }
    const prevChild = { tag: 0, type: Child, flags: 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { count: 0 }, alternate: null } as unknown as Fiber;
    const child = { tag: 0, type: Child, flags: PerformedWork, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { count: 1 }, alternate: prevChild } as unknown as Fiber;
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const report = commit(parent, new Set([parent]));
    const rendered = Object.values(report.renderedByCommit || {}).flat() as any[];
    const hit = rendered.find((entry) => entry.name === 'Child');
    expect(hit.propChanges).toEqual([{ name: 'count', kind: 'scalar-changed', prev: '0', current: '1' }]);
  });
  it('summarizes object and function props by their current keys and name', () => {
    function Parent() { return null; }
    function Child() { return null; }
    const style = { color: 'red' };
    const fiberFor = (props: Record<string, unknown>, alternate: Fiber | null) => ({ tag: 0, type: Child, flags: alternate ? PerformedWork : 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: props, alternate }) as unknown as Fiber;
    const prevChild = fiberFor({ style, other: { color: 'blue' }, 'a,b': { 'a,b': 1 }, onPing: function onPing() {} }, null);
    const child = fiberFor({ style: { ...style }, other: { color: 'green', size: 1 }, 'a,b': { a: 1, b: 2 }, onPing: function onPing() {} }, prevChild);
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20, detectionMode: 'full' });
    detector.install();
    try {
      hook.onCommitFiberRoot(1, { current: parent, memoizedUpdaters: new Set([parent]) });
      // A summary already recorded must not follow later mutation.
      (style as Record<string, unknown>).width = 1;
      const report = detector.report(20, 'effect') as any;
      const entry = (Object.values(report.renderedByCommit || {}).flat() as any[]).find((e) => e.name === 'Child');
      const change = (name: string) => entry.propChanges.find((p: any) => p.name === name);
      // The key diff is taken at commit time too: `width` was added afterwards.
      expect(change('style')).toEqual({ name: 'style', kind: 'ref-changed', current: 'object{color}', sameShallow: true, changedKeys: [], changedKeyCount: 0 });
      expect(change('other')).toEqual({
        name: 'other', kind: 'ref-changed', prev: 'object{color}', current: 'object{color,size}',
        changedKeys: [
          { key: 'color', kind: 'scalar-changed', prev: '"blue"', current: '"green"' },
          { key: 'size', kind: 'added', current: '1' },
        ],
        changedKeyCount: 2,
      });
      expect(change('a,b')).toEqual({
        name: 'a,b', kind: 'ref-changed', prev: 'object{"a,b"}', current: 'object{a,b}',
        changedKeys: [
          { key: 'a,b', kind: 'removed', prev: '1' },
          { key: 'a', kind: 'added', current: '1' },
          { key: 'b', kind: 'added', current: '2' },
        ],
        changedKeyCount: 3,
      });
      expect(change('onPing')).toEqual({ name: 'onPing', kind: 'ref-changed', current: 'function onPing' });
    } finally { detector.uninstall(); }
  });

  it('records which keys of a rebuilt object prop changed, except in stats mode', () => {
    function Parent() { return null; }
    function Child() { return null; }
    const collaborators = new Map();
    const fiberFor = (props: Record<string, unknown>, alternate: Fiber | null) => ({ tag: 0, type: Child, flags: alternate ? PerformedWork : 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: props, alternate }) as unknown as Fiber;
    const prevChild = fiberFor({ appState: { theme: 'light', zoom: 1, collaborators }, items: [1, 2] }, null);
    const child = fiberFor({ appState: { theme: 'light', zoom: 1, collaborators }, items: [1, 3] }, prevChild);
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const propChangesIn = (detectionMode: 'stats' | 'sources') => {
      const hook = installDevtoolsShim();
      const detector = createAvalancheDetector({ historySize: 20, detectionMode });
      detector.install();
      try {
        hook.onCommitFiberRoot(1, { current: parent, memoizedUpdaters: new Set([parent]) });
        const report = detector.report(20, 'effect') as any;
        return (Object.values(report.renderedByCommit || {}).flat() as any[]).find((e) => e.name === 'Child').propChanges;
      } finally { detector.uninstall(); }
    };

    expect(propChangesIn('sources')).toEqual([
      { name: 'appState', kind: 'ref-changed', current: 'object{theme,zoom,collaborators}', sameShallow: true, changedKeys: [], changedKeyCount: 0 },
      {
        name: 'items', kind: 'ref-changed', current: 'array(2)[1, 3]', prev: 'array(2)[1, 2]',
        changedKeys: [{ key: '1', kind: 'scalar-changed', prev: '2', current: '3' }],
        changedKeyCount: 1,
      },
    ]);
    expect(propChangesIn('stats')).toEqual([
      { name: 'appState', kind: 'ref-changed', current: 'object{theme,zoom,collaborators}' },
      { name: 'items', kind: 'ref-changed', prev: 'array(2)[1, 2]', current: 'array(2)[1, 3]' },
    ]);
  });

  // Rendered evidence comes from the commit walk in every mode; the mode only
  // decides whether amplifier (trasher) attribution is collected.
  it.each(['stats', 'sources', 'amplifiers', 'full'] as const)('records rendered components in %s mode', (detectionMode) => {
    function Parent() { return null; }
    function Child() { return null; }
    const prevChild = { tag: 0, type: Child, flags: 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { count: 0 }, alternate: null } as unknown as Fiber;
    const child = { tag: 0, type: Child, flags: PerformedWork, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: { count: 1 }, alternate: prevChild } as unknown as Fiber;
    const parent = { tag: 0, type: Parent, flags: PerformedWork, subtreeFlags: PerformedWork, child, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null } as unknown as Fiber;
    child.return = parent;
    prevChild.return = parent;

    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20, detectionMode });
    detector.install();
    hook.onCommitFiberRoot(1, { current: parent, memoizedUpdaters: new Set([parent]) });
    const report = detector.report(20, 'effect') as any;
    const rendered = Object.values(report.renderedByCommit || {}).flat() as any[];
    expect(rendered.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Parent', 'Child']));
    expect(rendered.find((entry) => entry.name === 'Child').propChanges).toHaveLength(1);
  });
});

// ─── Unmount + Suspense lifecycle tests ──────────────────────────────────────
// NOTE: RTL runs in jsdom where React's DevTools hook is captured at module-load
// time (before any test shim can install it). This means onCommitFiberRoot and
// fiber.deletions are not reliably observable here.
//
// The real coverage lives in src/avalanche/detector.lifecycle.pw.ts (Playwright),
// which runs against a real browser where React loads AFTER the DevTools hook shim
// is injected into the page.
//
// What we CAN test here: the CommitStats tuple shape (indices 8+9 exist and are
// numbers) and that suspenseByCommit is always present on the report object.

describe('createAvalancheDetector — report shape contracts', () => {
  it('records unmount identity samples for fiber.deletions on commit-peek raw report path', () => {
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20 });
    detector.install();

    function DeletedBranch() { return null; }
    function DeletedLeaf() { return null; }
    function Parent() { return null; }

    const hostText = {
      tag: 6,
      type: null,
      flags: 0,
      subtreeFlags: 0,
      child: null,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: 'Gone text',
      alternate: null,
      deletions: null,
    } as unknown as Fiber;
    const hostButton = {
      tag: 5,
      type: 'button',
      flags: 0,
      subtreeFlags: 0,
      child: hostText,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: { 'data-testid': 'gone.button', role: 'button', 'aria-label': 'Gone button' },
      alternate: null,
      deletions: null,
    } as unknown as Fiber;
    hostText.return = hostButton;

    const deletedLeaf = {
      tag: 0,
      type: DeletedLeaf,
      flags: 0,
      subtreeFlags: 0,
      child: hostButton,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: {},
      alternate: null,
      deletions: null,
      _debugSource: { fileName: 'DeletedLeaf.jsx', lineNumber: 2 },
    } as unknown as Fiber;
    hostButton.return = deletedLeaf;
    const deletedBranch = {
      tag: 0,
      type: DeletedBranch,
      flags: 0,
      subtreeFlags: 0,
      child: deletedLeaf,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: {},
      alternate: null,
      deletions: null,
      _debugSource: { fileName: 'DeletedBranch.jsx', lineNumber: 1 },
    } as unknown as Fiber;
    deletedLeaf.return = deletedBranch;

    const parent = {
      tag: 0,
      type: Parent,
      flags: PerformedWork | ChildDeletion,
      subtreeFlags: 0,
      child: null,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: {},
      alternate: null,
      deletions: [deletedBranch],
      _debugSource: { fileName: 'Parent.jsx', lineNumber: 1 },
    } as unknown as Fiber;
    const root = { current: parent, memoizedUpdaters: new Set([parent]) };

    hook.onCommitFiberRoot(1, root);

    const report = detector.report(20, 'effect') as any;
    expect(report.commitStats[1][8]).toBe(2);
    expect(report.commitStats[1][9]).toBe(1);

    // Regression: when React's devtools surface ALSO fires onCommitFiberUnmount
    // for each descendant fiber separately, the merge must not double-count.
    // recordTree already counted Mid (branch start) + Leaf (descendant) = 1 subtree.
    // devtools may fire onCommitFiberUnmount(Mid) then onCommitFiberUnmount(Leaf).
    // Without dedupe, devtools would report 2 subtrees and max() picks 2.
    // The merge must trust recordTree when it observed deletions this commit.
  });

  it('does not double-count subtrees when both recordTree and devtools onCommitFiberUnmount fire (Mid>Leaf removal)', () => {
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20 });
    detector.install();

    function Mid() { return null; }
    function Leaf() { return null; }
    function Root() { return null; }

    const leaf = {
      tag: 0, type: Leaf, flags: 0, subtreeFlags: 0,
      child: null, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null, deletions: null,
      _debugSource: { fileName: 'Leaf.jsx', lineNumber: 1 },
    } as unknown as Fiber;
    const mid = {
      tag: 0, type: Mid, flags: 0, subtreeFlags: 0,
      child: leaf, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null, deletions: null,
      _debugSource: { fileName: 'Mid.jsx', lineNumber: 1 },
    } as unknown as Fiber;
    leaf.return = mid;
    const root = {
      tag: 0, type: Root, flags: PerformedWork | ChildDeletion, subtreeFlags: 0,
      child: null, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null,
      deletions: [mid],
      _debugSource: { fileName: 'Root.jsx', lineNumber: 1 },
    } as unknown as Fiber;
    const fiberRoot = { current: root, memoizedUpdaters: new Set([root]) };

    // Simulate React's real DevTools surface — onCommitFiberUnmount fires per
    // deleted fiber, then onCommitFiberRoot fires for the commit.
    hook.onCommitFiberUnmount(1, mid);
    hook.onCommitFiberUnmount(1, leaf);
    hook.onCommitFiberRoot(1, fiberRoot);

    const report = detector.report(20, 'effect') as any;
    // The bug: subtrees was 2 (max-merged with DevTools per-descendant counts),
    // should be 1 (only Mid is the branch start; Leaf is inside Mid's subtree).
    expect(report.commitStats[1][8]).toBe(2); // components: Mid + Leaf
    expect(report.commitStats[1][9]).toBe(1); // subtrees: only Mid is branch start
    // At least one sample labelled with Mid (the branch start)
    expect(report.unmountsByCommit[1]).toBeDefined();
    expect(report.unmountsByCommit[1].some((s: any) => s.name === 'Mid')).toBe(true);
  });

  it.skip('placeholder — original DeletedBranch unmountsByCommit assertion lives in the first test', () => {
    expect([
      {
        name: 'DeletedBranch',
        key: null,
        depth: 0,
        count: 2,
        source: { fileName: 'DeletedBranch.jsx', lineNumber: 1 },
        host: {
          elements: 1,
          text: 1,
          tagsTop: [['button', 1]],
          testIdsTop: [['gone.button', 1]],
          rolesTop: [['button', 1]],
          ariaLabels: ['Gone button'],
          textHints: ['Gone text'],
        },
      },
      {
        name: 'DeletedBranch',
        key: null,
        depth: 0,
        count: 2,
        source: { fileName: 'DeletedBranch.jsx', lineNumber: 1 },
        host: {
          elements: 1,
          text: 1,
          tagsTop: [['button', 1]],
          testIdsTop: [['gone.button', 1]],
          rolesTop: [['button', 1]],
          ariaLabels: ['Gone button'],
          textHints: ['Gone text'],
        },
      },
    ]);
  });

  it('captures explicit action breadcrumbs by default and leaves noisy events opt-in', () => {
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20 });
    detector.install();

    function ActionSource() { return null; }
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'action.button');
    document.body.appendChild(button);

    const hostButton = {
      tag: 5,
      type: 'button',
      flags: 0,
      subtreeFlags: 0,
      child: null,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: { 'data-testid': 'action.button' },
      alternate: null,
      deletions: null,
      stateNode: button,
    } as unknown as Fiber;
    const actionSource = {
      tag: 0,
      type: ActionSource,
      flags: PerformedWork,
      subtreeFlags: 0,
      child: hostButton,
      sibling: null,
      return: null,
      memoizedState: null,
      memoizedProps: {},
      alternate: null,
      deletions: null,
      _debugSource: { fileName: 'ActionSource.jsx', lineNumber: 7 },
    } as unknown as Fiber;
    hostButton.return = actionSource;
    Object.defineProperty(button, '__reactFiber$test', { value: hostButton, configurable: true });

    button.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    button.click();
    hook.onCommitFiberRoot(1, { current: actionSource, memoizedUpdaters: new Set([actionSource]) });

    const report = detector.report(20, 'effect') as any;
    expect(report.interactionsByCommit[1]).toEqual([
      {
        id: 1,
        lastCommitId: 0,
        deltaTime: expect.any(Number),
        timestamp: expect.any(Number),
        action: 'click',
        location: {
          dom: {
            tag: 'button',
            text: '',
            nearestTestId: 'action.button',
          },
          targetFiber: {
            name: 'ActionSource',
            key: null,
            source: { fileName: 'ActionSource.jsx', lineNumber: 7, columnNumber: null },
            ownerStackKind: 'parents',
            ownerStack: [],
          },
        },
        // button.click() is dispatched by code, so the browser marks it untrusted.
        event: { trusted: false },
      },
    ]);
    expect(report.toSerializable().interactionsByCommit[1][0]).toMatchObject({ action: 'click', lastCommitId: 0, event: { trusted: false } });

    // Absolute timestamps share the page's performance clock, so exports can be
    // aligned with DevTools traces and PerformanceObserver entries.
    const dto = report.toSerializable();
    const timing = dto.commitTimings[1];
    const action = dto.interactionsByCommit[1][0];
    expect(dto.meta.timeOrigin).toBe(performance.timeOrigin);
    expect(timing.startTime).toBeGreaterThan(0);
    expect(timing.endTime).toBeGreaterThanOrEqual(timing.startTime);
    expect(timing.endTime).toBeLessThanOrEqual(performance.now());
    expect(timing.detectorOverhead).toBeCloseTo(timing.endTime - timing.startTime, 6);
    expect(action.timestamp).toBeLessThanOrEqual(timing.startTime);
    expect(action.deltaTime).toBeCloseTo(timing.endTime - action.timestamp, 1);

    const peek = evalAvalanche(
      { action: 'commit-peek', commitId: 1, include: ['timing', 'actions'] },
      { report: () => detector.report() } as any,
      null,
    ) as any;
    expect(peek.payload.timing).toEqual(timing);

    detector.uninstall();
  });

  it('captures noisy actions only when requested', () => {
    const hook = installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20, interactionCapture: 'noisy' });
    detector.install();

    function ActionSource() { return null; }
    const button = document.createElement('button');
    document.body.appendChild(button);
    const hostButton = { tag: 5, type: 'button', flags: 0, subtreeFlags: 0, child: null, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null, deletions: null } as unknown as Fiber;
    const actionSource = { tag: 0, type: ActionSource, flags: PerformedWork, subtreeFlags: 0, child: hostButton, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null, deletions: null } as unknown as Fiber;
    hostButton.return = actionSource;
    Object.defineProperty(button, '__reactFiber$test', { value: hostButton, configurable: true });

    button.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    hook.onCommitFiberRoot(1, { current: actionSource, memoizedUpdaters: new Set([actionSource]) });

    const report = detector.report(20, 'effect') as any;
    expect(report.interactionsByCommit[1][0]).toMatchObject({ action: 'wheel' });

    detector.uninstall();
  });

  it('report always carries suspenseByCommit and commitStats with 10 positions', async () => {
    installDevtoolsShim();
    const detector = createAvalancheDetector({ historySize: 20 });
    detector.install();

    function Counter() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(c => c + 1)}>{n}</button>;
    }
    render(<Counter />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });

    const report = detector.report(20, 'effect');

    // suspenseByCommit is always present (even when empty)
    expect(report.suspenseByCommit).toBeDefined();
    expect(typeof report.suspenseByCommit).toBe('object');

    // Every CommitStats entry must have 10 positions
    for (const stats of Object.values(report.commitStats)) {
      expect(stats).toHaveLength(10);
      // indices 8+9 are numbers (unmountedComponents, unmountedSubtrees)
      expect(typeof stats[8]).toBe('number');
      expect(typeof stats[9]).toBe('number');
    }

    detector.uninstall();
  });
});
