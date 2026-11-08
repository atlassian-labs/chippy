// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SCRIPTS = resolve(__dirname, '../../.agents/skills/chippy/scripts');
const HELPER = join(SCRIPTS, 'chippy-helper-server.js');
const proxy = require(join(SCRIPTS, 'helper-proxy.js'));

describe('proxy target resolution', () => {
  it('uses the loopback name of the original URL', () => {
    expect(proxy.resolveProxyTarget(5173)).toEqual({ hostname: 'localhost', port: 5173, hostHeader: 'localhost:5173' });
    expect(proxy.resolveProxyTarget('5173', 'http://127.0.0.1:5173/')).toMatchObject({ hostname: '127.0.0.1', hostHeader: '127.0.0.1:5173' });
    expect(proxy.resolveProxyTarget(5173, 'http://[::1]:5173/app')).toMatchObject({ hostname: '::1', hostHeader: '[::1]:5173' });
    expect(proxy.resolveProxyTarget(5173, 'http://app.localhost:5173/')).toMatchObject({ hostname: 'app.localhost' });
  });

  it('refuses invalid ports and targets off this machine', () => {
    expect(() => proxy.resolveProxyTarget(0)).toThrow(/Invalid target port/);
    expect(() => proxy.resolveProxyTarget(5173, 'not a url')).toThrow(/Invalid originalUrl/);
    expect(() => proxy.resolveProxyTarget(5173, 'http://example.com/')).toThrow(/loopback/);
  });
});

describe('proxy document injection', () => {
  const options = { earlyScripts: ['/__chippy/devtools-hook-shim.js'], bridgeBundle: '<script id="bridge"></script>' };

  it('loads early scripts before page scripts and the bridge last', () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/app.js"></script></head><body><header></header><div id="root"></div></body></html>';
    const out = proxy.injectProxyDocument(html, options);
    const early = out.indexOf('devtools-hook-shim.js');
    expect(early).toBeGreaterThan(out.indexOf('<head>'));
    expect(early).toBeLessThan(out.indexOf('/app.js'));
    expect(out.indexOf('id="bridge"')).toBeLessThan(out.indexOf('</body>'));
    expect(out.indexOf('id="bridge"')).toBeGreaterThan(out.indexOf('id="root"'));
  });

  it('handles documents without a head or body', () => {
    expect(proxy.injectProxyDocument('<html lang="en"><p>x</p></html>', options))
      .toMatch(/^<html lang="en">\n<script data-chippy-proxy-early="true" src="\/__chippy\/devtools-hook-shim.js"><\/script>/);
    expect(proxy.injectProxyDocument('<p>x</p>', options)).toMatch(/^<script data-chippy-proxy-early/);
  });
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as any).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  let latest: T | undefined;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for helper state: ${JSON.stringify(latest)}`);
}

async function listenHtml(host: string) {
  const server = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><head><title>upstream ${req.headers.host}</title></head><body><div id="root"></div></body></html>`);
  });
  await new Promise<void>((done) => server.listen(0, host, done));
  return { server, port: (server.address() as any).port as number };
}

describe('helper proxy and page runtime failures (live)', () => {
  let port: number;
  let child: ChildProcess;
  const upstreams: Server[] = [];
  const base = () => `http://127.0.0.1:${port}/__chippy`;
  const post = (path: string, body: unknown) => fetch(`${base()}${path}`, withHelperToken({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

  beforeAll(async () => {
    port = await freePort();
    child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
      env: testHelperEnv(), stdio: 'ignore',
    });
    await waitFor(() => fetch(`${base()}/health`).then((r) => r.ok).catch(() => false), Boolean);
  });

  afterAll(async () => {
    child?.kill('SIGTERM');
    await Promise.all(upstreams.map((server) => new Promise((done) => server.close(done))));
  });

  it.each([
    ['::1', (p: number) => `http://localhost:${p}/`],
    ['127.0.0.1', (p: number) => `http://127.0.0.1:${p}/`],
  ])('proxies a dev server listening on %s and loads the runtime before page code', async (host, originalUrl) => {
    const upstream = await listenHtml(host);
    upstreams.push(upstream.server);
    const started = await post('/api/proxy/start', { targetPort: upstream.port, originalUrl: originalUrl(upstream.port) });
    expect(started.status).toBe(200);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<title>upstream');
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain('src="/__chippy/devtools-hook-shim.js"');
      expect(head).toContain('src="/__chippy/avalanche.iife.js"');
      expect(html.indexOf('data-chippy-proxy-bundle')).toBeGreaterThan(html.indexOf('id="root"'));
    } finally {
      await post('/api/proxy/stop', {});
    }
  });

  it('rejects proxy targets off this machine', async () => {
    const response = await post('/api/proxy/start', { targetPort: 80, originalUrl: 'http://example.com/' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toMatch(/loopback/);
  });

  it('reports a page without the Avalanche runtime as unavailable, not as an empty result', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
    await new Promise<void>((done) => socket.addEventListener('open', () => done(), { once: true }));
    socket.addEventListener('message', (event) => {
      const { type, command } = JSON.parse(String(event.data));
      if (type !== 'command' || command.type !== 'find-fibers') return;
      socket.send(JSON.stringify({
        type: 'eval-probe-result', requestId: command.requestId,
        result: { count: 0, items: [], ok: false, code: 'bridge-module-missing', error: 'bridge module not loaded' },
      }));
    });
    socket.send(JSON.stringify({ type: 'hello', clientId: 'no-runtime', page: { url: null } }));
    try {
      const response = await waitFor(
        () => post('/api/pages/no-runtime/eval-probe', { command: 'find-fibers', filters: { name: 'X' } }),
        (r) => r.status !== 404,
      );
      expect(response.status).toBe(503);
      const body = (await response.json()) as any;
      expect(body).toMatchObject({ ok: false, error: 'bridge module not loaded', result: { code: 'bridge-module-missing' } });
      expect(body.hint).toMatch(/avalanche\.iife\.js/);
    } finally {
      socket.close();
    }
  });
});

describe('chippy.sh helper error messages', () => {
  it('prints the helper error and hint and exits non-zero', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chippy-sh-error-'));
    try {
      const fakeCurl = join(directory, 'curl');
      writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output_file="$2"; shift 2 ;; *) shift ;; esac
done
printf '{"ok":false,"error":"bridge module not loaded","hint":"Load avalanche.iife.js"}' > "$output_file"
printf '503'
`);
      chmodSync(fakeCurl, 0o755);
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_STATE_DIR: directory };
      delete env.CHIPPY_HELPER_TOKEN;
      const run = spawnSync('bash', [join(SCRIPTS, 'chippy.sh'), 'find-fibers', 'client-1', '--name', 'X'], { env, encoding: 'utf8' });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('http_status=503');
      expect(run.stderr).toContain('error: bridge module not loaded');
      expect(run.stderr).toContain('hint: Load avalanche.iife.js');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('chippy.sh find-fibers grep options', () => {
  it('forwards --grep, --in, and --depth into the find-fibers filters body', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chippy-sh-grep-'));
    try {
      const fakeCurl = join(directory, 'curl');
      const bodyFile = join(directory, 'body.json');
      writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output_file="$2"; shift 2 ;; -d) printf '%s' "$2" > "${bodyFile}"; shift 2 ;; *) shift ;; esac
done
printf '{"ok":true,"result":{"count":0,"items":[]}}' > "$output_file"
printf '200'
`);
      chmodSync(fakeCurl, 0o755);
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_STATE_DIR: directory };
      delete env.CHIPPY_HELPER_TOKEN;
      const run = spawnSync('bash', [join(SCRIPTS, 'chippy.sh'), 'find-fibers', 'client-1', '--grep', 'PROJ-\\d+', '--in', 'props,debug', '--depth', '6', '--name', 'Row'], { env, encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(require('node:fs').readFileSync(bodyFile, 'utf8'))).toEqual({
        command: 'find-fibers',
        filters: { grep: 'PROJ-\\d+', in: 'props,debug', depth: '6', name: 'Row' },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
