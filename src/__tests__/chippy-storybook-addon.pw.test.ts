// The Storybook addon end to end: a static Storybook build with the addon and
// Vite's default browser targets, served to Chromium and connected to a helper.
// Covers the build itself, an arm present when the preview starts, an armed
// `page-reload`, which the addon turns into a FORCE_REMOUNT, and the Chippy
// extension standing down in the Storybook manager.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

// The extension service worker's `chrome` global; this project has no chrome types.
declare const chrome: any;

const ROOT = resolve(__dirname, '../..');
const HELPER = join(ROOT, '.agents/skills/chippy/scripts/chippy-helper-server.js');
// Inside the repository so Storybook resolves its own modules from node_modules.
const WORK = join(ROOT, 'node_modules/.cache/chippy-storybook-addon-test');
const CONFIG = join(WORK, 'config');
const OUT = join(WORK, 'static');
const STORY = 'components-hellobutton--default';
// The addon's built-in helper address; the static server points it at the test helper.
const ADDON_HELPER = 'http://127.0.0.1:7823';

let helper: ChildProcess;
let helperPort: number;
let site: Server;
let siteUrl: string;
let browser: Browser;

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as any).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 15_000) {
  const started = Date.now();
  let latest: T | undefined;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Timed out: ${JSON.stringify(latest)}`);
}

const api = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${helperPort}/__chippy${path}`, withHelperToken(body === undefined
  ? {}
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

const storybookPages = async () => ((await (await api('/api/pages')).json()) as any).pages
  .filter((entry: any) => entry.integration?.kind === 'storybook' && String(entry.page?.url || '').includes(STORY));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

function serveStatic(dir: string, rewrite: (body: string) => string) {
  return createHttpServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404).end();
      return;
    }
    const type = TYPES[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(type === 'text/javascript' ? rewrite(readFileSync(file, 'utf8')) : readFileSync(file));
  });
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(CONFIG, { recursive: true });
  // No viteFinal: the build uses Vite's default targets, as a consumer project would.
  writeFileSync(join(CONFIG, 'main.js'), `export default {
  core: { disableTelemetry: true },
  stories: [${JSON.stringify(join(ROOT, 'src/components/HelloButton.stories.jsx'))}],
  addons: [${JSON.stringify(join(ROOT, '.storybook/chippy-addon/preset.js'))}],
  framework: { name: '@storybook/react-vite', options: {} },
};
`);
  const build = spawnSync(join(ROOT, 'node_modules/.bin/storybook'), ['build', '-c', CONFIG, '-o', OUT, '--quiet'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' },
  });
  if (build.status !== 0) throw new Error(`storybook build failed:\n${build.stdout}\n${build.stderr}`);

  helperPort = await freePort();
  helper = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(helperPort)], { env: testHelperEnv(), stdio: 'ignore' });
  await waitFor(() => api('/health').then((r) => r.ok).catch(() => false), Boolean);
  site = serveStatic(OUT, (body) => body.replaceAll(ADDON_HELPER, `http://127.0.0.1:${helperPort}`));
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  siteUrl = `http://127.0.0.1:${(site.address() as any).port}`;
  browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  helper?.kill('SIGTERM');
  await new Promise((done) => (site ? site.close(done) : done(undefined)));
  rmSync(WORK, { recursive: true, force: true });
});

const avalancheStatus = (page: Page) => page.evaluate(() => (window as any).__AVALANCHE__?.status?.() ?? null);

async function openStory() {
  const page = await browser.newPage();
  await page.goto(`${siteUrl}/iframe.html?id=${STORY}&viewMode=story`);
  await page.locator('#storybook-root button').first().waitFor();
  const [{ clientId }] = await waitFor(storybookPages, (matches: any[]) => matches.length === 1);
  return { page, clientId: clientId as string };
}

describe('Chippy Storybook addon', () => {
  it('captures the first story mount when the origin is armed before the preview starts', async () => {
    const origin = new URL(siteUrl).origin;
    expect((await api('/api/avalanche-arm', { origin, autoStart: true })).status).toBe(200);
    const { page } = await openStory();
    try {
      const status = await avalancheStatus(page);
      expect(status?.installed).toBe(true);
      expect(status.commitCount).toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
      await api('/api/avalanche-arm', { origin, autoStart: false });
    }
  }, 60_000);

  it('remounts the current story on an armed page-reload and captures the remount', async () => {
    const { page, clientId } = await openStory();
    try {
      expect((await avalancheStatus(page))?.installed).not.toBe(true);
      expect((await api('/api/avalanche-arm', { clientId, autoStart: true })).status).toBe(200);
      const reload = await api(`/api/pages/${clientId}/reload`, {});
      expect(reload.status).toBe(200);
      expect(await reload.json()).toMatchObject({ ok: true, result: { ok: true, action: 'storybook-force-remount' } });
      const status = await waitFor(() => avalancheStatus(page), (value: any) => value?.installed === true && value.commitCount >= 1);
      expect(status.commitCount).toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('reports a remount that matched no rendered story as failed', async () => {
    const { page, clientId } = await openStory();
    try {
      await page.evaluate(() => { (window as any).__STORYBOOK_PREVIEW__.selectionStore.selection.storyId = 'missing--story'; });
      const reload = await api(`/api/pages/${clientId}/reload`, {});
      expect(reload.status).toBe(409);
      expect(await reload.json()).toMatchObject({ ok: false, error: expect.stringMatching(/did not remount/) });
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe('Chippy extension with the Storybook addon', () => {
  it('stands down in the manager so agents reach the storybook preview client', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'chippy-storybook-extension-'));
    const extension = join(ROOT, '.agents/skills/chippy/extension');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      await worker.evaluate(({ origin, helperBaseUrl }) => chrome.storage.local.set({
        helperBaseUrl, enabledOrigins: { [origin]: true },
      }), { origin: new URL(siteUrl).origin, helperBaseUrl: `http://127.0.0.1:${helperPort}` });

      const page = await context.newPage();
      await page.goto(`${siteUrl}/?path=/story/${STORY}`);
      const [preview] = await waitFor(storybookPages, (matches: any[]) => matches.length === 1);
      // The extension ran in the manager (it wrote its startup config) and then yielded.
      await waitFor(
        () => page.evaluate(() => ({ started: !!(window as any).__CHIPPY_STARTUP_CONFIG, owner: (window as any).__CHIPPY_OWNER__?.integration?.kind })),
        (value) => value.started && value.owner === 'storybook',
      );
      await new Promise((done) => setTimeout(done, 2_000));
      const pages = ((await (await api('/api/pages')).json()) as any).pages;
      expect(pages.filter((entry: any) => entry.integration?.kind === 'extension')).toEqual([]);
      expect(pages.map((entry: any) => entry.clientId)).toContain(preview.clientId);

      const found = await api(`/api/pages/${preview.clientId}/eval-probe`, { command: 'find-fibers', filters: { text: 'Hello words' } });
      expect(((await found.json()) as any).result.count).toBeGreaterThanOrEqual(1);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }, 90_000);
});
