// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const HELPER = resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy-helper-server.js');
const children: ChildProcess[] = [];

afterEach(() => {
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
  let latest: T;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for helper state: ${JSON.stringify(latest)}`);
}

async function openSocket(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  return socket;
}

function snapshot(clientId: string, comment: string) {
  return JSON.stringify({
    type: 'snapshot',
    clientId,
    bridgeVersion: 'test',
    buildMode: 'dev',
    page: { url: 'http://example.test/story', title: 'Test', storyId: 'test' },
    integration: { kind: 'storybook', who: 'test', source: 'test', reinjectsOnReload: true, reloadAction: 'reload' },
    activated: true,
    probesActive: true,
    snapshot: {
      page: { url: 'http://example.test/story', title: 'Test', storyId: 'test' },
      markers: {
        '1': { position: { x: 10, y: 20 }, docked: false, intent: 'change', comment, resolved: null },
      },
    },
  });
}

describe('Chippy helper client-id ownership', () => {
  it('keeps the replacement socket mapped when an older socket with the same id closes', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
      env: testHelperEnv(),
      stdio: 'ignore',
    });
    children.push(child);
    const base = `http://127.0.0.1:${port}/__chippy`;
    await waitFor(
      async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      Boolean,
    );

    const clientId = 'same-storybook-session';
    const oldSocket = await openSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
    oldSocket.send(snapshot(clientId, 'old snapshot'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot?slice=minimal`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'old snapshot',
    );

    const replacementSocket = await openSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
    replacementSocket.send(snapshot(clientId, 'replacement snapshot'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot?slice=minimal`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'replacement snapshot',
    );

    oldSocket.close();
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    const afterOldClose = await fetch(`${base}/api/pages/${clientId}/snapshot?slice=minimal`, withHelperToken());
    expect(afterOldClose.status).toBe(200);
    await expect(afterOldClose.json()).resolves.toMatchObject({
      ok: true,
      snapshot: { markers: { '1': { intent: 'change', comment: 'replacement snapshot' } } },
    });

    replacementSocket.close();
  });
});
