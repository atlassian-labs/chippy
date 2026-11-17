// Component area against real React 18 and 19 pages: a modal whose body
// suspends behind a skeleton until the test resolves it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

const extension = '.agents/skills/chippy/extension';
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
let resolveBody; let ready = false;
const pending = new Promise((resolve) => { resolveBody = () => { ready = true; resolve(); }; });
window.resolveBody = () => resolveBody();
function Body() {
  if (!ready) throw pending;
  return React.createElement('section', { 'data-testid': 'body', style: { height: 200 } },
    React.createElement('p', { style: { margin: 0 } }, 'Description text'));
}
function Skeleton() { return React.createElement('div', { 'data-testid': 'skeleton', style: { height: 200, background: '#ddd' } }); }
function Header() { return React.createElement('header', { 'data-testid': 'header', style: { height: 50 } }, 'Title'); }
function Modal() {
  return React.createElement('div', { 'data-testid': 'modal', style: { position: 'absolute', left: 0, top: 0, width: 400, height: 300 } },
    React.createElement(Header),
    React.createElement(React.Suspense, { fallback: React.createElement(Skeleton) }, React.createElement(Body)));
}
createRoot(document.getElementById('root')).render(React.createElement(Modal));
`;

let server: Server;
let url = '';
let browser: Browser;
const scripts: Record<string, string> = {};

beforeAll(async () => {
  for (const [kind, alias] of [['stock', {}], ['react-19', { react: 'react-19', 'react-dom': 'react-dom-19' }]] as const) {
    const result = await build({
      stdin: { contents: app, resolveDir: process.cwd(), sourcefile: 'component-area-fixture.jsx' },
      alias, bundle: true, write: false, platform: 'browser', format: 'iife', keepNames: true,
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    });
    scripts[kind] = result.outputFiles[0].text;
  }
  server = createServer((request, response) => {
    const kind = (request.url || '/').slice(1);
    if (kind.endsWith('.js') && scripts[kind.slice(0, -3)]) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(scripts[kind.slice(0, -3)]);
    } else if (scripts[kind]) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body style="margin:0;font:16px system-ui"><div id="root"></div><script src="/' + kind + '.js"></script></body></html>');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function openPage(kind: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.addInitScript({ content: readFileSync(extension + '/devtools-hook-shim.js', 'utf8') });
  await page.addInitScript({ content: readFileSync(extension + '/avalanche.iife.js', 'utf8') });
  await page.goto(url + '/' + kind);
  await page.locator('[data-testid="skeleton"]').waitFor();
  return page;
}

describe('component area on real React', () => {
  it.each(['stock', 'react-19'])('separates a suspended skeleton from content on %s React', async (kind) => {
    const page = await openPage(kind);
    try {
      const measure = () => page.evaluate(() => (window as any).__AVALANCHE__.bridge.measureComponentArea({
        root: 'modal', testIds: ['header', 'body'], components: ['Header'],
      }));
      const before = await measure();
      expect(before).toMatchObject({ ok: true, root: { area: 120000 } });
      expect(before.placeholder.area).toBe(80000);
      const header = before.targets.find((t: any) => t.label === 'component:Header');
      expect(header.area).toBe(20000);
      expect(header.contentArea).toBeGreaterThan(0);
      expect(before.targets.find((t: any) => t.label === 'testid:body').area).toBe(0);

      await page.evaluate(() => (window as any).resolveBody());
      await page.locator('[data-testid="body"]').waitFor();
      const after = await measure();
      expect(after.placeholder.area).toBe(0);
      expect(after.targets.find((t: any) => t.label === 'testid:body').area).toBe(80000);
      expect(after.content.area).toBeGreaterThan(before.content.area);
    } finally { await page.close(); }
  }, 30000);

  it('records when the body replaces the skeleton', async () => {
    const page = await openPage('stock');
    try {
      await page.evaluate(() => (window as any).__AVALANCHE__.bridge.areaWatch.start({ root: 'modal', testIds: ['header', 'body'] }));
      await page.waitForTimeout(150);
      await page.evaluate(() => (window as any).resolveBody());
      await page.locator('[data-testid="body"]').waitFor();
      await page.waitForTimeout(150);
      const summary = await page.evaluate(() => (window as any).__AVALANCHE__.bridge.areaWatch.stop());
      expect(summary.targets['testid:header'].firstSeenAt).toBeLessThan(5);
      expect(summary.targets['testid:body'].firstSeenAt).toBeGreaterThan(100);
      expect(summary.placeholder.peakArea).toBe(80000);
      expect(summary.placeholder.firstAt).toBeLessThan(5);
      expect(summary.placeholder.clearedAt).toBe(summary.targets['testid:body'].firstSeenAt);
      expect(summary.measureMs.max).toBeLessThan(50);
    } finally { await page.close(); }
  }, 30000);
});
