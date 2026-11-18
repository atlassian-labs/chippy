import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAvalancheDetector } from './detector';
import { evalAvalanche } from '../chippy-bridge/avalanche-commands';
import type { DomChange } from './dom-diff';

// Real React renderers, bundled per version so React 19 resolves its own
// `react` and `scheduler`.
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const h = React.createElement;
function Count({ n }) {
  return h('span', { 'data-testid': 'count', className: n > 1 ? 'many' : 'one', style: { color: n > 1 ? 'red' : 'black' } }, n);
}
function Item({ label }) {
  return h('li', { 'data-testid': 'item-' + label }, 'Item ', label);
}
function List({ items }) {
  return h('ul', null, items.map((label) => h(Item, { key: label, label })));
}
function Header({ n }) {
  return h('header', null, h(Count, { n }));
}
function Lazy({ ready }) {
  if (!ready.done) throw ready.promise;
  return h('p', null, 'loaded');
}
function App({ n, items, ready }) {
  return h('main', null,
    h(Header, { n }),
    h(List, { items }),
    ready ? h(React.Suspense, { fallback: h('i', null, 'wait') }, h('section', { 'data-testid': 'panel' }, h(Lazy, { ready }))) : null);
}
window.__domFixture = { React, createRoot, flushSync, App };
`;

const variants: Array<[string, Record<string, string>]> = [
  ['React 18', {}],
  ['React 19', { react: 'react-19', 'react-dom': 'react-dom-19' }],
];
const bundles = new Map<string, string>();

beforeAll(() => {
  // esbuild cannot run inside the jsdom realm, so bundle through the CLI.
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
  delete g.__domFixture;
});

function installHook() {
  const renderers = new Map<number, unknown>();
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
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
  };
}

function setup(name: string) {
  installHook();
  new Function(bundles.get(name)!)();
  detector = createAvalancheDetector({ detectionMode: 'sources', metricsAdapter: null });
  detector.install();
  container = document.createElement('div');
  document.body.appendChild(container);
  const fixture = g.__domFixture as { React: any; createRoot: any; flushSync: any; App: any };
  root = fixture.createRoot(container);
  const render = (props: Record<string, unknown>) => fixture.flushSync(() => root.render(fixture.React.createElement(fixture.App, props)));
  return { render };
}

const api = () => ({ report: (topN?: number) => detector!.report(topN) }) as any;
const lastCommit = () => detector!.report().meta.commits;
function changesAt(commitId: number): DomChange[] {
  const peek = evalAvalanche({ action: 'commit-peek', commitId, include: ['dom'], maxItems: 50 }, api(), null) as any;
  expect(peek.ok).toBe(true);
  return peek.payload.dom;
}

describe.each(variants)('DOM diff on %s', (name) => {
  it('records inserts, prop and text updates, removals, and moves per commit', () => {
    const { render } = setup(name);
    render({ n: 1, items: ['a', 'b', 'c'] });
    const mount = changesAt(lastCommit());
    expect(mount).toEqual([expect.objectContaining({ op: '+', node: 'main', at: 'App', elements: 7 })]);
    expect(mount[0].html).toMatch(/^<main>1Item a/);

    render({ n: 2, items: ['a', 'b', 'c'] });
    const update = changesAt(lastCommit());
    expect(update).toEqual([{
      op: '~', node: 'span[data-testid=count]', at: 'App › Header › Count',
      props: [['class', '"one"', '"many"'], ['style.color', '"black"', '"red"'], ['text', '1', '2']],
    }]);

    // One commit, two branches: the header and the list change together.
    render({ n: 3, items: ['a', 'c'] });
    const parallel = changesAt(lastCommit());
    expect(parallel).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: '~', node: 'span[data-testid=count]', props: [['text', '2', '3']] }),
      expect.objectContaining({ op: '-', node: 'li[data-testid=item-b]', at: 'App › List › Item', html: '<li data-testid="item-b">Item b</li>' }),
    ]));
    expect(parallel).toHaveLength(2);

    // Reordering keyed children moves the node React relocates.
    render({ n: 3, items: ['c', 'a'] });
    expect(changesAt(lastCommit())).toEqual([
      expect.objectContaining({ op: 'move', node: 'li[data-testid=item-a]', at: 'App › List › Item' }),
    ]);

    render({ n: 3, items: ['c', 'a'] });
    const quiet = evalAvalanche({ action: 'commit-peek', commitId: lastCommit(), include: ['dom'] }, api(), null) as any;
    expect(quiet.payload.domTotal).toBe(0);

    const view = evalAvalanche({ action: 'dom-diff' }, api(), null) as any;
    expect(view.ok).toBe(true);
    expect(view.payload.commits.map((c: any) => c.commitId)).toEqual([1, 2, 3, 4]);
    expect(view.payload.text).toContain('~ span[data-testid=count]  text 2 → 3');
    expect(view.payload.text).toContain('- li[data-testid=item-b]  <li data-testid="item-b">Item b</li>');

    const matched = evalAvalanche({ action: 'dom-diff', match: 'item-b' }, api(), null) as any;
    expect(matched.payload.commits.map((c: any) => [c.commitId, c.changes.map((x: DomChange) => x.op)])).toEqual([[3, ['-']]]);
  });

  it('records Suspense hiding and revealing content that stays mounted', async () => {
    const { render } = setup(name);
    let resolve!: () => void;
    const ready: { done: boolean; promise: Promise<void> } = { done: true, promise: Promise.resolve() };
    render({ n: 1, items: [], ready });
    ready.done = false;
    ready.promise = new Promise<void>((r) => { resolve = r; });
    render({ n: 1, items: [], ready });
    const hidden = changesAt(lastCommit());
    expect(hidden).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'hide', node: 'section[data-testid=panel]' }),
      expect.objectContaining({ op: '+', node: 'i', html: '<i>wait</i>' }),
    ]));

    ready.done = true;
    resolve();
    await ready.promise;
    for (let i = 0; i < 50 && !changesAt(lastCommit()).some((c) => c.op === 'show'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(changesAt(lastCommit())).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'show', node: 'section[data-testid=panel]' }),
      expect.objectContaining({ op: '-', node: 'i' }),
    ]));
  });
});
