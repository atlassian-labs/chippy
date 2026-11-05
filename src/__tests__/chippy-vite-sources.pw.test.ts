// Source locations on a real Vite dev server with @vitejs/plugin-react and Fast
// Refresh, reached through the helper's proxy. React 18 records `_debugSource`
// lines shifted by the refresh header; React 19 reports served call sites.
// `find-fibers` must report authored lines for both.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const ROOT = resolve(__dirname, '../..');
const HELPER = join(ROOT, '.agents/skills/chippy/scripts/chippy-helper-server.js');

const MAIN = `import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);
`;

const APP = `import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <Badge
        label="Count"
        value={count}
      />
      <button id="bump" onClick={() => setCount(count + 1)}>bump</button>
    </main>
  );
}

function Badge({ label, value }) {
  return <span>{label}: {value}</span>;
}
`;

// Authored position of the <Badge> element, which creates the Badge fiber.
const BADGE_LINE = 7;

let browser: Browser;
let helper: ChildProcess;
let helperPort: number;

async function freePort() {
  const server = createNetServer();
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

async function startVite(alias: Record<string, string>) {
  // Outside node_modules, where plugin-react skips its transform.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chippy-vite-sources-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
  writeFileSync(join(root, 'src/main.jsx'), MAIN);
  writeFileSync(join(root, 'src/App.jsx'), APP);
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  const port = await freePort();
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    cacheDir: join(root, '.vite'),
    plugins: [react()],
    resolve: { alias },
    // HMR stays on, so plugin-react adds its Fast Refresh header. The watcher
    // is off: changes under the shared node_modules would reload the page.
    server: { host: '127.0.0.1', port, strictPort: true, hmr: { port: await freePort() }, watch: null },
  });
  await server.listen();
  return { root, port, server };
}

beforeAll(async () => {
  helperPort = await freePort();
  helper = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(helperPort)], { env: testHelperEnv(), stdio: 'ignore' });
  await waitFor(() => api('/health').then((r) => r.ok).catch(() => false), Boolean);
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  helper?.kill('SIGTERM');
});

describe('Chippy sources on a Vite dev server', () => {
  it.each([
    ['React 18', {}],
    ['React 19', { react: 'react-19', 'react-dom': 'react-dom-19' }],
  ])('find-fibers reports the authored line under %s', async (_label, alias) => {
    let vite: { root: string; port: number; server: ViteDevServer } | undefined;
    const page = await browser.newPage();
    try {
      vite = await startVite(alias);
      expect((await api('/api/proxy/start', { targetPort: vite.port, originalUrl: `http://127.0.0.1:${vite.port}/` })).status).toBe(200);
      await page.goto(`http://127.0.0.1:${helperPort}/`);
      await page.locator('#bump').waitFor();
      const [{ clientId }] = await waitFor(async () => {
        const body = (await (await api('/api/pages')).json()) as any;
        return body.pages.filter((entry: any) => String(entry.page?.url || '').startsWith(`http://127.0.0.1:${helperPort}/`));
      }, (matches: any[]) => matches.length === 1);

      const response = await api(`/api/pages/${clientId}/eval-probe`, { command: 'find-fibers', filters: { name: '^Badge$' } });
      const body = (await response.json()) as any;
      expect(body.result.count).toBe(1);
      expect(body.result.items[0].source).toMatchObject({ lineNumber: BADGE_LINE });
      expect(body.result.items[0].source.fileName).toMatch(/src\/App\.jsx$/);
    } finally {
      await page.close();
      await api('/api/proxy/stop', {});
      await vite?.server.close();
      if (vite) rmSync(vite.root, { recursive: true, force: true });
    }
  }, 60_000);
});
