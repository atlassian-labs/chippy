// Proxy mode end to end: a React page served through the helper's proxy, with
// no extension and no init scripts, must load the full runtime and answer
// fiber queries from the live tree.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { startReactCompatibilityFixture } from '../test/react-compatibility-fixture';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const HELPER = resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy-helper-server.js');
let fixture: Awaited<ReturnType<typeof startReactCompatibilityFixture>>;
let browser: Browser;
let helper: ChildProcess;
let port: number;

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as any).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 10_000) {
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

beforeAll(async () => {
  fixture = await startReactCompatibilityFixture();
  port = await freePort();
  helper = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
  await waitFor(() => api('/health').then((r) => r.ok).catch(() => false), Boolean);
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  helper?.kill('SIGTERM');
  await fixture?.stop();
});

describe('Chippy proxy mode', () => {
  it.each(['stock', 'react-19'])('finds live %s React components through the proxy', async (kind) => {
    const fixturePort = new URL(fixture.url).port;
    // The fixture listens on 127.0.0.1; `localhost` must still reach it.
    const started = await api('/api/proxy/start', { targetPort: Number(fixturePort), originalUrl: `http://localhost:${fixturePort}/${kind}` });
    expect(started.status).toBe(200);
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/${kind}`);
      await page.locator('#counter').click();
      await expect.poll(() => page.locator('#counter').textContent()).toBe('Count: 1');

      const [{ clientId }] = await waitFor(async () => {
        const body = (await (await api('/api/pages')).json()) as any;
        return body.pages.filter((entry: any) => String(entry.page?.url || '').endsWith(`/${kind}`));
      }, (matches: any[]) => matches.length === 1);

      const response = await api(`/api/pages/${clientId}/eval-probe`, { command: 'find-fibers', filters: { name: '^StockCounter$' } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.result.count).toBe(1);
      expect(body.result.items[0]).toMatchObject({ name: 'StockCounter' });
      // The hook shim ran before react-dom, so capture uses the DevTools path.
      expect(await page.evaluate(() => (window as any).__AVALANCHE__.status().integrationMode)).toBe('devtools');
    } finally {
      await page.close();
      await api('/api/proxy/stop', {});
    }
  }, 30_000);

  it('captures the boot commit after an armed reload', async () => {
    const fixturePort = new URL(fixture.url).port;
    await api('/api/proxy/start', { targetPort: Number(fixturePort), originalUrl: `http://127.0.0.1:${fixturePort}/stock` });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/stock`);
      const [{ clientId }] = await waitFor(async () => {
        const body = (await (await api('/api/pages')).json()) as any;
        return body.pages.filter((entry: any) => String(entry.page?.url || '').endsWith('/stock'));
      }, (matches: any[]) => matches.length === 1);
      expect((await api('/api/avalanche-arm', { clientId, autoStart: true })).status).toBe(200);
      const loaded = page.waitForEvent('load');
      const reload = await api(`/api/pages/${clientId}/reload`, {});
      // No extension registers early startup; the proxy document loads the handoff reader.
      expect(await reload.json()).toMatchObject({ ok: true, result: { earlyStartup: 'handoff-only' } });
      await loaded;
      const status = await page.evaluate(() => (window as any).__AVALANCHE__.status());
      expect(status).toMatchObject({ installed: true, integrationMode: 'devtools' });
      expect(status.commitCount).toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
      await api('/api/proxy/stop', {});
    }
  }, 30_000);
});
