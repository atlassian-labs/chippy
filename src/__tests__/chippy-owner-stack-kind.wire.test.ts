// @vitest-environment node
// Proves `ownerStackKind` survives the helper's HTTP surfaces for a production
// page, where owner results fall back to the component parent chain.
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

const parentEntry = (name: string) => ({
  name, key: null, source: null, propNames: [], hookCount: 0, hookCountTruncated: false, hookCountMax: 500, complexityNote: null,
});

function productionSnapshot(clientId: string) {
  const parents = [parentEntry('Layout'), parentEntry('App')];
  return JSON.stringify({
    type: 'snapshot',
    clientId,
    bridgeVersion: 'test',
    buildMode: 'production',
    page: { url: 'http://example.test/', title: 'Prod', storyId: null },
    integration: { kind: 'extension', who: 'test', source: 'test', reinjectsOnReload: true, reloadAction: 'reload' },
    activated: true,
    probesActive: true,
    snapshot: {
      page: { url: 'http://example.test/', title: 'Prod', storyId: null },
      markers: {
        '1': {
          position: { x: 10, y: 20 }, docked: false, intent: null, comment: '',
          resolved: {
            confidence: 'production', note: null, nearestTestId: null,
            dom: { tag: 'button', text: 'Save' },
            component: {
              name: 'Button', key: null, props: {}, propNames: [], hookCount: 0, hookCountTruncated: false, hookCountMax: 500,
              source: null,
              ownerStackKind: 'parents',
              owners: parents,
              componentStack: parents.map(({ name, key, source }) => ({ name, key, source })),
              parents,
            },
          },
        },
      },
    },
  });
}

async function startHelperWithProductionPage(answerLive: boolean) {
  const port = await freePort();
  const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
    env: testHelperEnv(),
    stdio: 'ignore',
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}/__chippy`;
  await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), Boolean);

  const clientId = 'production-page';
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
  sockets.push(socket);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  if (answerLive) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const command = message.command || message;
      if (command?.type !== 'eval-probe-owners') return;
      socket.send(JSON.stringify({
        type: 'eval-probe-result',
        clientId,
        requestId: command.requestId,
        result: {
          ok: true,
          probeId: command.probeId,
          component: { name: 'Button', propNames: [], hookCount: 0, hookCountTruncated: false, hookCountMax: 500 },
          ownerStackKind: 'parents',
          owners: [{ ownerIndex: 0, name: 'Layout' }],
        },
      }));
    });
  }
  socket.send(productionSnapshot(clientId));
  await waitFor(
    async () => fetch(`${base}/api/pages/${clientId}/snapshot?slice=minimal`, withHelperToken()).then((response) => response.json()),
    (body: any) => Boolean(body?.snapshot?.markers?.['1']),
  );
  return { base, clientId };
}

describe('ownerStackKind wire chain', () => {
  it('keeps the label and parent-derived stack in the standard snapshot slice', async () => {
    const { base, clientId } = await startHelperWithProductionPage(false);
    const body = await fetch(`${base}/api/pages/${clientId}/snapshot?slice=standard`, withHelperToken()).then((response) => response.json());
    const component = body.snapshot.markers['1'].resolved.component;
    expect(component.ownerStackKind).toBe('parents');
    expect(component.owners.map((entry: { name: string }) => entry.name)).toEqual(['Layout', 'App']);
    expect(component.componentStack.map((entry: { name: string }) => entry.name)).toEqual(['Layout', 'App']);
  });

  it('passes the live bridge label through probe-owners', async () => {
    const { base, clientId } = await startHelperWithProductionPage(true);
    const body = await fetch(`${base}/api/pages/${clientId}/probe/1/owners`, withHelperToken()).then((response) => response.json());
    expect(body).toMatchObject({ ok: true, source: 'live', ownerStackKind: 'parents', owners: [{ ownerIndex: 0, name: 'Layout' }] });
  });

  it('labels the snapshot fallback of probe-owners and single-owner reads', async () => {
    const { base, clientId } = await startHelperWithProductionPage(false);
    const owners = await fetch(`${base}/api/pages/${clientId}/probe/1/owners?timeoutMs=100`, withHelperToken()).then((response) => response.json());
    expect(owners).toMatchObject({ ok: true, source: 'snapshot', ownerStackKind: 'parents' });
    expect(owners.owners.map((entry: { name: string }) => entry.name)).toEqual(['Layout', 'App']);

    const owner = await fetch(`${base}/api/pages/${clientId}/probe/1/owners/1`, withHelperToken()).then((response) => response.json());
    expect(owner).toMatchObject({ ok: true, ownerIndex: 1, ownerStackKind: 'parents', name: 'App' });
  });
});
