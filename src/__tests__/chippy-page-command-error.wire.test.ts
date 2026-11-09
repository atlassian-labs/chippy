// @vitest-environment node
// Proves a page command that rejects its input (for example an invalid
// find-fibers regex) reaches the caller as a request error, not as an empty
// successful result.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const HELPER = resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy-helper-server.js');
const children: ChildProcess[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const child of children.splice(0)) child.kill('SIGTERM');
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  let latest: T | undefined;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for helper state: ${JSON.stringify(latest)}`);
}

async function startHelperWithPage(answer: (filters: Record<string, unknown>) => unknown) {
  const port = await freePort();
  const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
    env: testHelperEnv(),
    stdio: 'ignore',
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}/__chippy`;
  await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), Boolean);

  const clientId = 'grep-page';
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
  sockets.push(socket);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const command = message.command || message;
    if (command?.type !== 'find-fibers') return;
    socket.send(JSON.stringify({ type: 'eval-probe-result', clientId, requestId: command.requestId, result: answer(command.filters || {}) }));
  });
  const page = { url: 'http://example.test/', title: 'Grep', storyId: null };
  socket.send(JSON.stringify({
    type: 'snapshot', clientId, bridgeVersion: 'test', buildMode: 'development', page,
    integration: { kind: 'extension', who: 'test', source: 'test', reinjectsOnReload: true, reloadAction: 'reload' },
    activated: true, probesActive: true, snapshot: { page, markers: {} },
  }));
  await waitFor(
    async () => fetch(`${base}/api/pages`, withHelperToken()).then((response) => response.json()),
    (body: any) => JSON.stringify(body).includes(clientId),
  );
  return { base, clientId };
}

function findFibers(base: string, clientId: string, filters: Record<string, unknown>) {
  return fetch(`${base}/api/pages/${clientId}/eval-probe`, withHelperToken({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'find-fibers', filters }),
  }));
}

describe('page command errors over the helper', () => {
  it('reports a rejected find-fibers pattern as a request error', async () => {
    const { base, clientId } = await startHelperWithPage((filters) => (filters.grep === '('
      ? { ok: false, count: 0, items: [], error: 'Invalid --grep regex: Unterminated group' }
      : { count: 1, items: [{ name: 'Counter' }] }));

    const rejected = await findFibers(base, clientId, { grep: '(' });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({
      ok: false,
      error: 'Invalid --grep regex: Unterminated group',
      result: { ok: false, count: 0 },
    });

    const matched = await findFibers(base, clientId, { grep: 'Count' });
    expect(matched.status).toBe(200);
    expect(await matched.json()).toMatchObject({ ok: true, result: { count: 1 } });
  });
});
