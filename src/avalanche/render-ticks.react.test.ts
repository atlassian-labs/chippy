import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAvalancheDetector } from './detector';
import { evalAvalanche } from '../chippy-bridge/avalanche-commands';

// Real React renderers, bundled per version so React 19 resolves its own
// `react` and `scheduler`. Each leaf busy-waits, so a transition render cannot
// finish inside one 5 ms scheduler slice and React must yield between ticks.
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
function Leaf({ n }) {
  const until = performance.now() + 1;
  while (performance.now() < until) { /* busy */ }
  return React.createElement('i', null, n);
}
function Tree({ size, label }) {
  const leaves = [];
  for (let i = 0; i < size; i++) leaves.push(React.createElement(Leaf, { key: i, n: label + i }));
  return React.createElement('div', null, leaves);
}
window.__tickFixture = { React, createRoot, flushSync, Tree };
`;

const variants: Array<[string, Record<string, string>, string]> = [
  ['React 18', {}, 'profiling-hooks'],
  ['React 19', { react: 'react-19', 'react-dom': 'react-dom-19' }, 'async-dispatcher'],
];
const bundles = new Map<string, string>();

beforeAll(() => {
  // esbuild cannot run inside the jsdom realm (its TextEncoder check fails),
  // so bundle through the CLI in a child process.
  const esbuild = join(process.cwd(), 'node_modules/.bin/esbuild');
  for (const [name, alias] of variants) {
    const args = [
      '--bundle', '--format=iife', '--platform=browser', '--loader=jsx',
      `--define:process.env.NODE_ENV="development"`,
      ...Object.entries(alias).map(([from, to]) => `--alias:${from}=${to}`),
    ];
    bundles.set(name, execFileSync(esbuild, args, { input: app, cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  }
}, 60000);

const g = globalThis as any;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;
let container: HTMLElement | null = null;
let root: any = null;

afterEach(() => {
  root?.unmount();
  root = null;
  detector?.uninstall();
  detector = null;
  container?.remove();
  container = null;
  delete g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete g.__tickFixture;
});

function installHook(extra: Record<string, unknown> = {}) {
  const renderers = new Map<number, unknown>();
  const hook = {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    ...extra,
  };
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return hook;
}

function loadReact(name: string) {
  // The bundle registers its renderer with the hook while it evaluates.
  new Function(bundles.get(name)!)();
  return g.__tickFixture as { React: any; createRoot: any; flushSync: any; Tree: any };
}

function startDetector() {
  detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter: null });
  detector.install();
  return detector;
}

async function waitForCommits(count: number) {
  for (let i = 0; i < 400 && detector!.report().meta.commits < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(detector!.report().meta.commits).toBeGreaterThanOrEqual(count);
}

function timings() {
  return detector!.report().toSerializable().commitTimings!;
}

describe.each(variants)('render ticks on %s', (name, _alias, source) => {
  it('counts one tick for a synchronous render and several for a time-sliced one', async () => {
    installHook();
    startDetector();
    const { React, createRoot, flushSync, Tree } = loadReact(name);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => root.render(React.createElement(Tree, { size: 3, label: 'a' })));
    await waitForCommits(1);
    const sync = timings()[1];
    expect(sync.ticks).toBe(1);
    expect(sync.render).toMatchObject({ ticks: 1, partial: false, slicesTruncated: false });
    expect(sync.render!.slices).toHaveLength(1);

    React.startTransition(() => root.render(React.createElement(Tree, { size: 40, label: 'b' })));
    await waitForCommits(2);
    const sliced = timings()[2];
    expect(sliced.ticks).toBeGreaterThan(2);
    const render = sliced.render!;
    expect(render.slices).toHaveLength(render.ticks);
    expect(render.partial).toBe(false);
    // Slices are ordered and disjoint; the gaps between them are the yields.
    for (let i = 1; i < render.slices.length; i++) {
      expect(render.slices[i][0]).toBeGreaterThanOrEqual(render.slices[i - 1][1]);
    }
    const work = render.slices.reduce((sum, [start, end]) => sum + (end - start), 0);
    expect(render.workMs).toBeCloseTo(work, 6);
    expect(render.yieldedMs).toBeCloseTo(render.renderEnd - render.renderStart - work, 6);
    expect(render.renderEnd).toBeLessThanOrEqual(sliced.startTime);

    const meta = detector!.report().meta;
    expect(meta.dataAvailability.ticks).toBe(true);
    expect(meta.renderTicks).toEqual({ available: true, sources: [source], reason: null });

    const list = evalAvalanche({ action: 'commit-list', by: 'ticks', top: 5 }, { report: () => detector!.report() } as any, null) as any;
    expect(list.ok).toBe(true);
    expect(list.rows[0]).toMatchObject({ commitId: 2, ticks: sliced.ticks });
  });

  it('counts ticks when Avalanche starts after React registered its renderer', async () => {
    installHook();
    const { React, createRoot, flushSync, Tree } = loadReact(name);
    startDetector();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => root.render(React.createElement(Tree, { size: 3, label: 'a' })));
    React.startTransition(() => root.render(React.createElement(Tree, { size: 40, label: 'b' })));
    await waitForCommits(2);
    const [first, second] = [timings()[1], timings()[2]];
    // The first commit after a late start may have missed earlier slices.
    expect(first.render!.partial).toBe(true);
    expect(first.ticks).toBe(1);
    expect(second.render!.partial).toBe(false);
    expect(second.ticks).toBeGreaterThan(2);
  });

  it('gives every renderer slot back on uninstall', () => {
    const hook = installHook();
    const originalInject = hook.inject;
    startDetector();
    loadReact(name);
    const renderer = hook.renderers.get(1) as any;
    const internals = renderer.currentDispatcherRef;
    detector!.uninstall();
    detector = null;
    expect(hook.inject).toBe(originalInject);
    if (source === 'async-dispatcher') {
      const descriptor = Object.getOwnPropertyDescriptor(internals, 'A')!;
      expect(descriptor.get).toBeUndefined();
      expect(descriptor.writable).toBe(true);
    } else {
      expect(renderer.injectProfilingHooks.name).toBe('injectProfilingHooks');
    }
  });
});

describe('render ticks without a usable signal', () => {
  it('reports ticks as unavailable when React DevTools owns the React 18 profiling hooks', async () => {
    const rendererInterfaces = new Map<number, unknown>();
    const hook = installHook({ rendererInterfaces });
    const { React, createRoot, flushSync, Tree } = loadReact('React 18');
    rendererInterfaces.set(1, {});
    const devtoolsHooks = { markRenderStarted: () => {} };
    (hook.renderers.get(1) as any).injectProfilingHooks(devtoolsHooks);
    startDetector();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => root.render(React.createElement(Tree, { size: 2, label: 'a' })));
    await waitForCommits(1);
    expect(timings()[1].ticks).toBeNull();
    expect(timings()[1].render).toBeNull();
    const meta = detector!.report().meta;
    expect(meta.dataAvailability.ticks).toBe(false);
    expect(meta.renderTicks.available).toBe(false);
    expect(meta.renderTicks.reason).toMatch(/React DevTools/);
  });
});
