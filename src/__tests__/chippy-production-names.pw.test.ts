// Production React strips names and debug metadata. This suite serves a
// minified production bundle with a linked source map and checks that Chippy
// recovers authored component names and definitions from that map.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const extension = '.agents/skills/chippy/extension';
const ORIGIN = 'https://prod.example.test';

const APP_SOURCE = `import { memo, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function ProjectList({ items }) {
  return <ul id="list" data-testid="project-list">{items.map((item) => <ProjectRow key={item} label={item} />)}</ul>;
}
const ProjectRow = memo(function ProjectRow({ label }) {
  const [open, setOpen] = useState(false);
  return <li id={'row-' + label} onClick={() => setOpen(!open)}>{label}{open ? ' (open)' : ''}{open && <Details label={label} />}</li>;
});
// Mounts only after a click, then updates its own state in the next commit,
// re-rendering Seen, so the summary lists it as a source.
function Details({ label }) {
  const [seen, setSeen] = useState(false);
  useLayoutEffect(() => setSeen(true), []);
  return <Seen label={label} seen={seen} />;
}
function Seen({ label, seen }) {
  return <i data-detail={label} data-seen={String(seen)} />;
}

createRoot(document.getElementById('root')).render(<ProjectList items={['a', 'b']} />);
`;

let browser: Browser;
let files: Record<string, { body: string; type: string }>;

beforeAll(async () => {
  const result = await build({
    stdin: { contents: APP_SOURCE, sourcefile: 'src/app.jsx', loader: 'jsx', resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    format: 'iife',
    jsx: 'automatic',
    sourcemap: 'linked',
    outfile: 'assets/index-prod.js',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'silent',
  });
  const output = (suffix: string) => result.outputFiles.find((file) => file.path.endsWith(suffix))!.text;
  files = {
    '/': { body: '<div id="root"></div><script src="/assets/index-prod.js"></script>', type: 'text/html' },
    '/assets/index-prod.js': { body: output('.js'), type: 'text/javascript' },
    '/assets/index-prod.js.map': { body: output('.js.map'), type: 'application/json' },
  };
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  await browser?.close();
});

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file ? route.fulfill({ body: file.body, contentType: file.type }) : route.fulfill({ status: 404 });
  });
  await page.addInitScript({ content: readFileSync(`${extension}/devtools-hook-shim.js`, 'utf8') });
  await page.addInitScript({ content: readFileSync(`${extension}/avalanche.iife.js`, 'utf8') });
  await page.addInitScript({ content: "window.__AVALANCHE__.install({ detectionMode: 'full', captureFibers: true });" });
  await page.goto(`${ORIGIN}/`);
  await page.locator('#row-a').waitFor();
  return page;
}

describe('Chippy on a minified production React build', () => {
  it('recovers component names and definitions from the source map', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const av = (window as any).__AVALANCHE__;
        const layout = av.layoutLab;
        const fiber = layout.getNearestComponent(document.querySelector('#row-a'));
        const before = layout.describeComponent(fiber).name;
        // Resolve the row and its ancestors, as the bridge does for marker owners.
        const chain = [];
        for (let node = fiber; node; node = node.return) chain.push(node);
        await Promise.all(chain.map((node) => layout.resolveFiberSource(node)));
        return { before, after: layout.describeComponent(fiber) };
      });
      // The minifier drops the memo's function-expression name entirely.
      expect(result.before).toBeNull();
      expect(result.after).toMatchObject({
        name: 'ProjectRow',
        definition: { fileName: 'src/app.jsx', lineNumber: 7 },
      });
      expect(result.after.owners[0]).toMatchObject({
        name: 'ProjectList',
        minifiedName: expect.any(String),
        definition: { fileName: 'src/app.jsx', lineNumber: 4 },
      });
    } finally { await page.close(); }
  }, 30000);

  it('hands over breadcrumbs for a production component', async () => {
    const page = await openPage();
    try {
      const breadcrumbs = await page.evaluate(async () => {
        const av = (window as any).__AVALANCHE__;
        const fiber = av.layoutLab.getNearestComponent(document.querySelector('#row-a'));
        await av.layoutLab.resolveFiberSource(fiber);
        const entry: Record<string, any> = {};
        av.bridge.applyProductionBreadcrumbs(entry, fiber);
        return entry.breadcrumbs;
      });
      expect(breadcrumbs).toMatchObject({
        whereToLook: [{ file: 'src/app.jsx', line: 7, name: 'ProjectRow', confidence: 'exact' }],
        nearestTestId: 'project-list',
        script: { url: `${ORIGIN}/assets/index-prod.js` },
        limits: [],
      });
      expect(breadcrumbs.grep).toEqual(expect.arrayContaining(['row-', '(open)']));
    } finally { await page.close(); }
  }, 30000);

  it('names only the Avalanche sources a result returns', async () => {
    const page = await openPage();
    try {
      await page.locator('#row-a').click();
      await expect.poll(() => page.locator('#row-a').textContent()).toBe('a (open)');
      const result = await page.evaluate(async () => {
        const av = (window as any).__AVALANCHE__;
        const named = await av.bridge.evalAvalancheWithNames({ action: 'hot-sources' }, av, null);
        return { stats: named.nameRecovery, sourceIds: named.payload.items.map((item: any) => item.sourceId) };
      });
      // The click opens the row, which mounts Details; both update their own state.
      expect(result.stats).toMatchObject({ types: 2, resolved: 2, named: 2 });
      expect(result.sourceIds.sort()).toEqual([expect.stringMatching(/^Details#/), expect.stringMatching(/^ProjectRow#/)]);
    } finally { await page.close(); }
  }, 30000);

  it('renames a component that mounts during the capture in every output', async () => {
    const page = await openPage();
    try {
      await page.locator('#row-a').click();
      await page.locator('[data-detail="a"][data-seen="true"]').waitFor({ state: 'attached' });
      const result = await page.evaluate(async () => {
        const av = (window as any).__AVALANCHE__;
        const run = (command: Record<string, unknown>) => av.bridge.evalAvalancheWithNames(command, av, null);
        // DOM anchors name Details only as text, so dom-diff must recover it by name.
        const domDiff = await run({ action: 'dom-diff' });
        const commitIds = Object.keys(av.report(Infinity).renderedByCommit).map(Number).sort((a, b) => a - b);
        // Peek each commit in turn, as an agent would; Details first renders mid-capture.
        let mount: any = null;
        for (const commitId of commitIds) {
          const peek = await run({ action: 'commit-peek', commitId, include: ['rendered'] });
          if (peek.payload.rendered.some((entry: any) => entry.name === 'Details')) {
            mount = peek;
            break;
          }
        }
        const summary = await run({ action: 'summary' });
        const exported = await run({ action: 'export' });
        return {
          rendered: mount?.payload.rendered.find((entry: any) => entry.name === 'Details') ?? null,
          dom: domDiff.payload.commits.flatMap((commit: any) => commit.changes.map((change: any) => change.at)),
          domNames: domDiff.componentNames ?? [],
          peekNames: mount?.componentNames ?? [],
          summaryIds: summary.payload.topCommits.flatMap((commit: any) => commit.sources.map((source: any) => source.sourceId)),
          summaryOwners: summary.payload.topCommits.flatMap((commit: any) => commit.latestAction?.targetFiber?.ownerNames ?? []),
          timeline: summary.payload.timeline.text,
          summaryNames: summary.componentNames ?? [],
          exportNames: exported.payload.meta.componentNames ?? [],
          exportRendered: Object.values(exported.payload.renderedByCommit).flat()
            .filter((entry: any) => entry.minifiedName).map((entry: any) => entry.name),
        };
      });
      const minifiedName = result.rendered?.minifiedName;
      expect(result.rendered).toMatchObject({ name: 'Details', minifiedName: expect.any(String) });
      expect(minifiedName).not.toBe('Details');
      const details = { name: 'Details', minifiedName };
      expect(result.peekNames).toContainEqual(details);
      // DOM anchors are stored as text when the commit is recorded.
      expect(result.dom.some((at: string) => at.split(' › ').includes('Details'))).toBe(true);
      expect(result.dom.some((at: string) => at.split(' › ').includes(minifiedName))).toBe(false);
      expect(result.domNames).toContainEqual(details);
      expect(result.summaryIds).toContainEqual(expect.stringMatching(/^Details#/));
      expect(result.timeline).toMatch(/\bDetails\b/);
      expect(result.timeline).not.toMatch(new RegExp(`\\b${minifiedName}\\b`));
      // The clicked row's owner is stored as text when the click is captured.
      expect(result.summaryOwners).toContain('ProjectList');
      expect(result.summaryNames).toContainEqual(details);
      // Seen re-renders but the summary never names it.
      expect(result.summaryNames.map((rename: any) => rename.name)).not.toContain('Seen');
      expect(result.exportNames).toContainEqual(details);
      expect(result.exportRendered).toContain('Details');
    } finally { await page.close(); }
  }, 30000);
});
