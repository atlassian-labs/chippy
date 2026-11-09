// Production React strips names and debug metadata. This suite serves a
// minified production bundle with a linked source map and checks that Chippy
// recovers authored component names and definitions from that map.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const extension = '.agents/skills/chippy/extension';
const ORIGIN = 'https://prod.example.test';

const APP_SOURCE = `import { memo, useState } from 'react';
import { createRoot } from 'react-dom/client';

function ProjectList({ items }) {
  return <ul id="list">{items.map((item) => <ProjectRow key={item} label={item} />)}</ul>;
}
const ProjectRow = memo(function ProjectRow({ label }) {
  const [open, setOpen] = useState(false);
  return <li id={'row-' + label} onClick={() => setOpen(!open)}>{label}{open ? ' (open)' : ''}</li>;
});

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

  it('names Avalanche report sources after warming recorded component types', async () => {
    const page = await openPage();
    try {
      await page.locator('#row-a').click();
      await expect.poll(() => page.locator('#row-a').textContent()).toBe('a (open)');
      const result = await page.evaluate(async () => {
        const av = (window as any).__AVALANCHE__;
        const stats = await av.bridge.warmAvalancheNames(av);
        const report = av.report(100, 'effect');
        return { stats, sourceIds: report.sources.map((item: any) => item.sourceId) };
      });
      expect(result.stats).toMatchObject({ types: 1, resolved: 1, named: 1 });
      expect(result.sourceIds).toEqual([expect.stringMatching(/^ProjectRow#/)]);
    } finally { await page.close(); }
  }, 30000);
});
