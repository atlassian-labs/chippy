// @vitest-environment node
// Proves the eval-page runner options travel the whole chain: the shell turns
// `-` (stdin), --allow, and --script-timeout into the HTTP body, the helper
// forwards them to the page with a wait longer than the script's own timeout,
// a failed script's envelope comes back whole under `result`, and the page
// bridge hands the command to the bundled runner.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const BRIDGE = resolve(SKILL, 'extension/chippy-page-bridge.js');
const directories: string[] = [];
const children: ChildProcess[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const child of children.splice(0)) child.kill('SIGTERM');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeCurl(response: string) {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-eval-page-'));
  directories.push(directory);
  const capturePath = join(directory, 'body.json');
  writeFileSync(join(directory, 'response.json'), response);
  const curl = join(directory, 'curl');
  writeFileSync(curl, `#!/bin/sh
output_file=""
body=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat "${directory}/response.json" > "$output_file"
printf '%s' "$body" > "$CHIPPY_CAPTURE_PATH"
printf '200'
`);
  chmodSync(curl, 0o755);
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_CAPTURE_PATH: capturePath };
  return { env, body: () => JSON.parse(readFileSync(capturePath, 'utf8')) };
}

describe('eval-page shell options', () => {
  it('reads the script from stdin and keeps runner options out of script args', () => {
    const curl = fakeCurl('{"ok":true,"result":{"ok":true,"result":1}}');
    const out = execFileSync('bash', [SHELL, 'eval-page', 'client-1', '-', '--allow', 'replay', '--script-timeout', '20000', '--name', 'Feed', '--max', '3'], {
      encoding: 'utf8',
      env: curl.env,
      input: 'return chippy.find({ name: ctx.args.name });\n',
    });
    expect(JSON.parse(out)).toEqual({ ok: true, result: { ok: true, result: 1 } });
    expect(curl.body()).toEqual({
      source: 'return chippy.find({ name: ctx.args.name });\n',
      args: { name: 'Feed', max: 3 },
      allow: ['replay'],
      scriptTimeoutMs: 20000,
    });
  });

  it('still runs packaged snippets and sends no runner options by default', () => {
    const curl = fakeCurl('{"ok":true}');
    execFileSync('bash', [SHELL, 'eval-page', 'client-1', 'find-prop', '--prop', 'x'], { encoding: 'utf8', env: curl.env });
    const body = curl.body();
    expect(body.args).toEqual({ prop: 'x' });
    expect(body).not.toHaveProperty('allow');
    expect(body).not.toHaveProperty('scriptTimeoutMs');
    expect(body.source).toContain('ctx');
  });

  it('prints a failed envelope whole and exits non-zero', () => {
    const response = { ok: true, result: { ok: false, error: 'needs --allow replay', gate: 'replay', partial: { step: 1 }, limits: [] } };
    const curl = fakeCurl(JSON.stringify(response));
    const run = spawnSync('bash', [SHELL, 'eval-page', 'client-1', '-'], { encoding: 'utf8', env: curl.env, input: 'return 1' });
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual(response);
  });

  it('rejects a non-numeric script timeout', () => {
    const curl = fakeCurl('{"ok":true}');
    const run = spawnSync('bash', [SHELL, 'eval-page', 'client-1', '-', '--script-timeout', 'soon'], { encoding: 'utf8', env: curl.env, input: 'return 1' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--script-timeout takes milliseconds');
  });

  it('advertises the options in help', () => {
    expect(execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' }))
      .toContain('eval-page <clientId> <snippet-file-or-name|-> [--allow replay] [--script-timeout ms]');
  });
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
  return address.port;
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

async function startHelperWithPage(answer: (command: Record<string, unknown>) => unknown) {
  const port = await freePort();
  const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
  children.push(child);
  const base = `http://127.0.0.1:${port}/__chippy`;
  await waitFor(async () => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), Boolean);
  const clientId = 'script-page';
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
  sockets.push(socket);
  await new Promise<void>((done, reject) => {
    socket.addEventListener('open', () => done(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const command = message.command || message;
    if (command?.type !== 'eval-script') return;
    const result = answer(command);
    if (result !== undefined) socket.send(JSON.stringify({ type: 'eval-script-result', clientId, requestId: command.requestId, result }));
  });
  const page = { url: 'http://example.test/', title: 'Scripts', storyId: null };
  socket.send(JSON.stringify({
    type: 'snapshot', clientId, bridgeVersion: 'test', buildMode: 'development', page,
    integration: { kind: 'extension', who: 'test', source: 'test', reinjectsOnReload: true, reloadAction: 'reload' },
    activated: true, probesActive: true, snapshot: { page, markers: {} },
  }));
  await waitFor(async () => fetch(`${base}/api/pages`, withHelperToken()).then((r) => r.json()), (body) => JSON.stringify(body).includes(clientId));
  return { base, clientId };
}

function evalScript(base: string, clientId: string, body: Record<string, unknown>) {
  return fetch(`${base}/api/pages/${clientId}/eval-script`, withHelperToken({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('eval-script over the helper', () => {
  it('forwards gates and a clamped script timeout to the page', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { base, clientId } = await startHelperWithPage((command) => {
      seen.push(command);
      return { ok: true, durationMs: 1, result: 'done', limits: [] };
    });
    const response = await evalScript(base, clientId, { source: 'return 1', allow: ['replay'], scriptTimeoutMs: 999_999 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { ok: true, result: 'done' } });
    expect(seen[0]).toMatchObject({ type: 'eval-script', source: 'return 1', allow: ['replay'], timeoutMs: 120_000 });
  });

  it('returns a failed script envelope whole, not as a gateway timeout', async () => {
    const envelope = { ok: false, durationMs: 4, error: 'boom', timedOut: true, partial: { step: 2 }, limits: [], log: ['a'] };
    const { base, clientId } = await startHelperWithPage(() => envelope);
    const response = await evalScript(base, clientId, { source: 'return 1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: envelope });
  });

  it('keeps 504 for a page that never answers', async () => {
    const { base, clientId } = await startHelperWithPage(() => undefined);
    const response = await evalScript(base, clientId, { source: 'return 1', timeoutMs: 200 });
    expect(response.status).toBe(504);
  });
});

describe('page bridge', () => {
  it('hands eval-script to the bundled runner with its fiber dependencies', () => {
    const source = readFileSync(BRIDGE, 'utf8');
    const shim = source.slice(source.indexOf('async function evalScript(command)'), source.indexOf('async function evalScript(command)') + 600);
    expect(shim).toContain('b.runChippyScript(command, {');
    for (const dep of ['buildHelpers: buildScriptHelpers', 'rememberFiber', 'getRememberedFiber', 'evalFiberHooks,', 'replayComponentHooks,', 'scriptResultJson']) {
      expect(shim).toContain(dep);
    }
  });
});
