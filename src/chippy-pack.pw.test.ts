// Proves a `chippy pack` build in a real browser: the packed runtime registers
// the extra plugin and applies build defaults, and the packed extension loads
// under its new identity and starts the default plugins on an enabled origin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The extension service worker's `chrome` global; this project has no chrome types.
declare const chrome: any;
import { normalizePackConfig, packChippy } from '../packages/chippy/bin/pack.mjs';
import { writePackWorkspace } from './test/pack-workspace';

const SKILL = resolve(__dirname, '../.agents/skills/chippy');
let workspace: string;
let skillDir: string;
let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  workspace = writePackWorkspace(mkdtempSync(join(tmpdir(), 'chippy-pack-pw-')));
  ({ skillDir } = await packChippy(normalizePackConfig({
    plugins: [{ id: 'gate', label: 'Feature gates', entry: './src/gate.ts' }],
    defaultPlugins: ['gate', 'jira'],
    extension: { name: 'Chippy (Gates)', version: '0.4.24.1' },
    outDir: './out',
  }, workspace), { source: SKILL, zips: false }));
  server = createServer((_, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>pack</title><p>pack fixture</p>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise((done) => server?.close(done));
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

async function pluginState(page: Page) {
  return page.evaluate(() => {
    const av = (window as any).__AVALANCHE__;
    return {
      enabled: av.listPlugins().filter((p: any) => p.enabled).map((p: any) => p.id).sort(),
      providers: av.layoutLab.getContextProviders().map((p: any) => p.id).sort(),
    };
  });
}

async function openWithPackedRuntime(startupConfig?: unknown) {
  const page = await browser.newPage();
  if (startupConfig) await page.addInitScript((config) => { (window as any).__CHIPPY_STARTUP_CONFIG = config; }, startupConfig);
  await page.addInitScript({ content: readFileSync(join(skillDir, 'extension/avalanche.iife.js'), 'utf8') });
  await page.goto(origin);
  return page;
}

describe('chippy pack build', () => {
  it('registers the packed plugin and enables the build defaults', async () => {
    const page = await openWithPackedRuntime();
    try {
      expect(await pluginState(page)).toEqual({ enabled: ['gate', 'jira'], providers: ['gate', 'jira'] });
    } finally { await page.close(); }
  });

  it('keeps the page\'s own plugin selection over the build defaults', async () => {
    const page = await openWithPackedRuntime({ plugins: ['gate'] });
    try {
      expect(await pluginState(page)).toEqual({ enabled: ['gate'], providers: ['gate'] });
    } finally { await page.close(); }
  });

  it('loads as an extension and starts the default plugins on an enabled origin', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'chippy-pack-profile-'));
    const extension = join(skillDir, 'extension');
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      expect(manifest).toMatchObject({ name: 'Chippy (Gates)', version: '0.4.24.1' });
      await worker.evaluate((enabled) => chrome.storage.local.set({ enabledOrigins: { [enabled]: true } }), origin);
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => typeof (window as any).__AVALANCHE__?.listPlugins === 'function');
      expect(await pluginState(page)).toEqual({ enabled: ['gate', 'jira'], providers: ['gate', 'jira'] });
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }, 60000);
});
