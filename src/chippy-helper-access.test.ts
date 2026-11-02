import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS = resolve(__dirname, '../.agents/skills/chippy/scripts');
const HELPER = join(SCRIPTS, 'chippy-helper-server.js');
const access = require(join(SCRIPTS, 'helper-access.js'));

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as any).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}

// node:http lets tests set Host and Origin, which fetch forbids.
function send(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; headers: Record<string, any>; body: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

function upgrade(port: number, headers: Record<string, string>) {
  return new Promise<number>((done, fail) => {
    const req = request({
      host: '127.0.0.1', port, path: '/__chippy/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); done(res.statusCode ?? 0); });
    req.on('response', (res) => { res.resume(); done(res.statusCode ?? 0); });
    req.on('error', (error: any) => (error.code === 'ECONNRESET' ? done(0) : fail(error)));
    req.end();
  });
}

describe('helper route classification', () => {
  it('keeps page assets public and command routes protected', () => {
    expect(access.classifyRoute('GET', '/inject.js')).toBe('public');
    expect(access.classifyRoute('GET', '/health')).toBe('public');
    expect(access.classifyRoute('GET', '/ws')).toBe('public');
    expect(access.classifyRoute('GET', null)).toBe('public');
    expect(access.classifyRoute('GET', '/api/pages')).toBe('extension');
    expect(access.classifyRoute('POST', '/api/avalanche-arm')).toBe('extension');
    expect(access.classifyRoute('GET', '/api/state')).toBe('protected');
    expect(access.classifyRoute('POST', '/api/pages/x/eval-script')).toBe('protected');
    expect(access.classifyRoute('POST', '/health')).toBe('protected');
  });

  it('parses Host headers with ports and IPv6 literals', () => {
    expect(access.isAllowedHost('127.0.0.1:7823', {})).toBe(true);
    expect(access.isAllowedHost('LOCALHOST:7823', {})).toBe(true);
    expect(access.isAllowedHost('[::1]:7823', {})).toBe(true);
    expect(access.isAllowedHost('attacker.example:7823', {})).toBe(false);
    expect(access.isAllowedHost('dev.box:7823', { CHIPPY_HELPER_ALLOWED_HOSTS: 'dev.box' })).toBe(true);
    expect(access.isAllowedHost(undefined, {})).toBe(false);
  });
});

// Starts a helper with its own state directory and waits for its token file.
async function startHelper(extraArgs: string[] = []) {
  const port = await freePort();
  const stateDir = mkdtempSync(join(tmpdir(), 'chippy-access-'));
  const env: NodeJS.ProcessEnv = { ...process.env, CHIPPY_STATE_DIR: stateDir };
  delete env.CHIPPY_HELPER_TOKEN;
  delete env.CHIPPY_HELPER_HOST;
  const child = spawn(process.execPath, [HELPER, '--port', String(port), ...extraArgs], { env, stdio: 'ignore' });
  let token: string | null = null;
  const deadline = Date.now() + 5000;
  while (!token && Date.now() < deadline) {
    token = access.readHelperToken(port, { CHIPPY_STATE_DIR: stateDir });
    if (!token) await new Promise((done) => setTimeout(done, 50));
  }
  if (!token) throw new Error('helper did not write its token file');
  const stop = () => { child.kill('SIGTERM'); rmSync(stateDir, { recursive: true, force: true }); };
  return { port, stateDir, token, stop };
}

describe('helper access control (live HTTP)', () => {
  let port: number;
  let stateDir: string;
  let token: string;
  let stop: () => void;

  beforeAll(async () => {
    ({ port, stateDir, token, stop } = await startHelper());
  });

  afterAll(() => stop?.());

  it('writes a private token file after listening', () => {
    const file = access.resolveTokenFile(port, { CHIPPY_STATE_DIR: stateDir });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects eval-script without a token', async () => {
    const body = JSON.stringify({ script: 'document.title' });
    const response = await send(port, 'POST', '/__chippy/api/pages/any/eval-script', { 'Content-Type': 'application/json' }, body);
    expect(response.status).toBe(401);
  });

  it('rejects eval-script from a website even with a token-shaped guess', async () => {
    const response = await send(port, 'POST', '/__chippy/api/pages/any/eval-script', {
      'Content-Type': 'application/json', Origin: 'https://attacker.example', 'X-Chippy-Token': 'guess',
    }, '{}');
    expect(response.status).toBe(401);
  });

  it('does not allow the token header in CORS preflight', async () => {
    const response = await send(port, 'OPTIONS', '/__chippy/api/pages/any/eval-script', {
      Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-chippy-token',
    });
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).not.toContain('x-chippy-token');
  });

  it('accepts protected routes with the token', async () => {
    const response = await send(port, 'GET', '/__chippy/api/state', { 'X-Chippy-Token': token });
    expect(response.status).toBe(200);
  });

  it('keeps the extension routes open to extension origins only', async () => {
    expect((await send(port, 'GET', '/__chippy/api/pages', { Origin: 'chrome-extension://abc' })).status).toBe(200);
    expect((await send(port, 'GET', '/__chippy/api/pages', { Origin: 'https://attacker.example' })).status).toBe(401);
    expect((await send(port, 'GET', '/__chippy/api/state', { Origin: 'chrome-extension://abc' })).status).toBe(401);
  });

  it('serves page assets and health without a token', async () => {
    expect((await send(port, 'GET', '/__chippy/health')).status).toBe(200);
    expect((await send(port, 'GET', '/__chippy/inject.js')).status).toBe(200);
    const root = await send(port, 'GET', '/__chippy');
    expect(root.status).toBe(200);
    expect(JSON.parse(root.body)).not.toHaveProperty('pages');
  });

  it('rejects rebinding hosts on HTTP and WebSocket upgrade', async () => {
    expect((await send(port, 'GET', '/__chippy/health', { Host: `attacker.example:${port}` })).status).toBe(403);
    expect(await upgrade(port, { Host: `attacker.example:${port}` })).not.toBe(101);
    expect(await upgrade(port, { Host: `127.0.0.1:${port}` })).toBe(101);
  });
});

describe('helper access control on a wide bind', () => {
  let port: number;
  let token: string;
  let stop: () => void;

  beforeAll(async () => {
    ({ port, token, stop } = await startHelper(['--host', '0.0.0.0']));
  });

  afterAll(() => stop?.());

  it('accepts forwarded host names', async () => {
    expect((await send(port, 'GET', '/__chippy/health', { Host: `rde.example:${port}` })).status).toBe(200);
  });

  it('keeps the extension routes working', async () => {
    expect((await send(port, 'GET', '/__chippy/api/pages', { Origin: 'chrome-extension://abc' })).status).toBe(200);
    const arm = await send(port, 'POST', '/__chippy/api/avalanche-arm', {
      Origin: 'chrome-extension://abc', 'Content-Type': 'application/json',
    }, JSON.stringify({ origin: 'http://localhost:6006', autoStart: false }));
    expect(arm.status).not.toBe(401);
  });

  it('still requires the token for command routes', async () => {
    expect((await send(port, 'POST', '/__chippy/api/pages/any/eval-script', { 'Content-Type': 'application/json' }, '{}')).status).toBe(401);
    expect((await send(port, 'GET', '/__chippy/api/state', { 'X-Chippy-Token': token })).status).toBe(200);
  });
});

describe('chippy.sh token forwarding', () => {
  it('reads the token file and sends it on helper requests', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chippy-sh-token-'));
    try {
      writeFileSync(join(directory, 'helper-7823.token'), 'file-token\n');
      const fakeCurl = join(directory, 'curl');
      writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "$CHIPPY_CAPTURE_PATH"
  case "$arg" in @*) cat "\${arg#@}" >> "$CHIPPY_CAPTURE_PATH" ;; esac
done
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output_file="$2"; shift 2 ;; *) shift ;; esac
done
[ -n "$output_file" ] && printf '{"ok":true}' > "$output_file"
printf '200'
`);
      chmodSync(fakeCurl, 0o755);
      const capturePath = join(directory, 'args.txt');
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_STATE_DIR: directory, CHIPPY_CAPTURE_PATH: capturePath };
      delete env.CHIPPY_HELPER_TOKEN;
      execFileSync('bash', [join(SCRIPTS, 'chippy.sh'), 'request-snapshot', 'client-1'], { env, encoding: 'utf8' });
      const captured = readFileSync(capturePath, 'utf8').split('\n');
      expect(captured).toContain('X-Chippy-Token: file-token');
      expect(captured.some((arg) => arg.includes('X-Chippy-Token') && arg.startsWith('-H'))).toBe(false);
      expect(captured.some((arg) => /^@.*chippy-auth\./.test(arg))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
