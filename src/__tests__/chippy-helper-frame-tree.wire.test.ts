// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const TOP = 'http://127.0.0.1:5181';
const FRAME = 'http://localhost:5182';

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as any).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}

// Opens a page socket the way a browser frame would, with its own Origin.
async function openPageSocket(port: number, origin: string) {
  const socket = new (WebSocket as any)(`ws://127.0.0.1:${port}/__chippy/ws`, { headers: { Origin: origin } }) as WebSocket;
  await new Promise<void>((done, fail) => {
    socket.addEventListener('open', () => done(), { once: true });
    socket.addEventListener('error', () => fail(new Error('WebSocket failed to open')), { once: true });
  });
  return socket;
}

function hello(clientId: string, url: string, frame: Record<string, unknown>) {
  return JSON.stringify({
    type: 'hello', clientId, bridgeVersion: 'test', buildMode: 'dev',
    page: { url, title: clientId, storyId: null, frame }, activated: true, probesActive: true,
  });
}

// chippy.sh pages and the MCP chippy_pages tool pass this response through.
describe('/api/pages reports confirmed frame links', () => {
  let port: number;
  let child: ChildProcess;
  const sockets: WebSocket[] = [];
  const pages = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/__chippy/api/pages`, withHelperToken());
    return ((await response.json()) as any).pages as Array<{ clientId: string; page: { frame: any } }>;
  };

  beforeAll(async () => {
    port = await freePort();
    child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
    for (let i = 0; i < 200; i += 1) {
      if (await fetch(`http://127.0.0.1:${port}/__chippy/health`).then((r) => r.ok).catch(() => false)) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('helper did not start');
  });

  afterAll(() => {
    for (const socket of sockets) socket.close();
    child?.kill('SIGTERM');
  });

  it('shows a cross-origin iframe as a separate page linked to its parent page', async () => {
    const top = await openPageSocket(port, TOP);
    const frame = await openPageSocket(port, FRAME);
    const forger = await openPageSocket(port, FRAME);
    sockets.push(top, frame, forger);
    top.send(hello('top-tab', `${TOP}/app`, { isTop: true, path: [], ancestorOrigins: [], parentClientId: null, parentOrigin: null, childClientIds: ['frame-tab'] }));
    frame.send(hello('frame-tab', `${FRAME}/embed`, {
      isTop: false, path: [0], ancestorOrigins: [TOP], parentClientId: 'top-tab', parentOrigin: TOP, childClientIds: [],
    }));
    // A page that claims the same parent, which never confirmed it.
    forger.send(hello('forger-tab', `${FRAME}/other`, {
      isTop: false, path: [1], ancestorOrigins: [TOP], parentClientId: 'top-tab', parentOrigin: TOP, childClientIds: [],
    }));

    let list = await pages();
    for (let i = 0; i < 100 && list.length < 3; i += 1) {
      await new Promise((done) => setTimeout(done, 25));
      list = await pages();
    }
    const byId = Object.fromEntries(list.map((page) => [page.clientId, page.page.frame]));
    expect(byId['top-tab']).toMatchObject({ isTop: true, topClientId: 'top-tab', childClientIds: ['frame-tab'] });
    expect(byId['frame-tab']).toMatchObject({
      isTop: false, path: [0], parentClientId: 'top-tab', parentOrigin: TOP, topClientId: 'top-tab',
    });
    expect(byId['forger-tab']).toMatchObject({ parentClientId: null, unconfirmedParentClientId: 'top-tab', topClientId: null });
  });
});
