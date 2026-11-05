// Mode B armed reload end to end: the unpacked extension, the helper, and a
// React page. After `avalanche-arm` and a helper reload, Avalanche must be
// installed before React's first commit, so the boot mount is captured.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type BrowserContext, type Worker } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startReactCompatibilityFixture } from '../test/react-compatibility-fixture';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

// The extension service worker's `chrome` global; this project has no chrome types.
declare const chrome: any;

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const HELPER = join(SKILL, 'scripts/chippy-helper-server.js');
let fixture: Awaited<ReturnType<typeof startReactCompatibilityFixture>>;
let helper: ChildProcess;
let port: number;
let profile: string;
let context: BrowserContext;
let worker: Worker;

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

const api = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/__chippy${path}`, withHelperToken(body === undefined
  ? {}
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

const pagesAt = async (url: string) => ((await (await api('/api/pages')).json()) as any).pages
  .filter((entry: any) => entry.page?.url === url);

beforeAll(async () => {
  fixture = await startReactCompatibilityFixture();
  port = await freePort();
  helper = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
  await waitFor(() => api('/health').then((r) => r.ok).catch(() => false), Boolean);
  profile = mkdtempSync(join(tmpdir(), 'chippy-armed-reload-'));
  const extension = join(SKILL, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(({ origin, helperBaseUrl }) => chrome.storage.local.set({
    helperBaseUrl, enabledOrigins: { [origin]: true },
  }), { origin: new URL(fixture.url).origin, helperBaseUrl: `http://127.0.0.1:${port}` });
}, 60_000);

afterAll(async () => {
  await context?.close();
  helper?.kill('SIGTERM');
  await fixture?.stop();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

describe('extension armed reload', () => {
  it('captures the boot commit after an armed reload', async () => {
    const url = `${new URL(fixture.url).origin}/stock`;
    const page = await context.newPage();
    await page.goto(url);
    const [{ clientId, connectedAt }] = await waitFor(() => pagesAt(url), (matches: any[]) => matches.length === 1);

    // Arm like `reload-with-avalanche`: by client id and origin, so the
    // background's own startup lookup also sees the arm.
    const armed = await api('/api/avalanche-arm', { clientId, origin: new URL(url).origin, autoStart: true, options: { detectionMode: 'sources' } });
    expect(armed.status).toBe(200);
    const loaded = page.waitForEvent('load');
    const reload = await api(`/api/pages/${clientId}/reload`, {});
    expect(await reload.json()).toMatchObject({ ok: true, result: { ack: true, earlyStartup: 'registered' } });
    await loaded;

    // Installed at document_start, so already by load. A later install, such as
    // the bridge's after it reconnects, would miss the boot commit.
    const status = await page.evaluate(() => (window as any).__AVALANCHE__?.status?.() ?? null);
    expect(status).toMatchObject({ installed: true });
    // Nothing interacted with the page, so every captured commit is from boot.
    expect(status.commitCount).toBeGreaterThanOrEqual(1);

    // The page reconnects, and the one-shot registration and handoff are gone.
    await waitFor(() => pagesAt(url), (matches: any[]) => matches.some((entry) => entry.connectedAt !== connectedAt));
    await waitFor(() => worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), (scripts: any[]) => scripts.length === 0);
    expect(await page.evaluate(() => sessionStorage.getItem('__chippyStartupHandoff'))).toBeNull();
    await page.close();
  }, 60_000);

  it('leaves an unarmed reload on the normal startup path', async () => {
    const url = `${new URL(fixture.url).origin}/stock`;
    const page = await context.newPage();
    await page.goto(url);
    const [{ clientId }] = await waitFor(() => pagesAt(url), (matches: any[]) => matches.length >= 1);
    await api('/api/avalanche-arm', { clientId, autoStart: false });
    const reload = await api(`/api/pages/${clientId}/reload`, {});
    expect(await reload.json()).toMatchObject({ ok: true, result: { earlyStartup: 'not-armed' } });
    expect(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    await page.close();
  }, 60_000);
});
