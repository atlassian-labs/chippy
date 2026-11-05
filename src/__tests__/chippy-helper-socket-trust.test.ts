// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SCRIPTS = resolve(__dirname, '../../.agents/skills/chippy/scripts');
const HELPER = resolve(SCRIPTS, 'chippy-helper-server.js');
const trust = require(resolve(SCRIPTS, 'page-socket-trust.js'));

describe('page socket trust rules', () => {
  it('reads the handshake origin', () => {
    expect(trust.handshakeOrigin({ origin: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(trust.handshakeOrigin({})).toBeNull();
    expect(trust.handshakeOrigin(undefined)).toBeNull();
  });

  it('requires reported page URLs to belong to the socket origin', () => {
    expect(trust.checkPageUrl('http://localhost:5173', 'http://localhost:5173/app?x=1')).toBeNull();
    expect(trust.checkPageUrl('http://localhost:5173', 'http://localhost:5174/app')).toMatch(/does not belong/);
    expect(trust.checkPageUrl('http://localhost:5173', 'not a url')).toMatch(/does not belong/);
    expect(trust.checkPageUrl('null', 'about:srcdoc')).toBeNull();
    expect(trust.checkPageUrl(null, 'http://anything.test/')).toBeNull();
  });

  it('binds a client id to the first origin that claims it', () => {
    const bindings = trust.createClientIdBindings();
    expect(bindings.claim('tab-1', 'http://localhost:5173')).toBeNull();
    expect(bindings.claim('tab-1', 'http://localhost:5173')).toBeNull();
    expect(bindings.claim('tab-1', 'http://localhost:5174')).toMatch(/another origin/);
    expect(bindings.claim('tab-1', null)).toMatch(/another origin/);
    expect(bindings.ownerOf('tab-1')).toBe('http://localhost:5173');
  });

  it('evicts the oldest bindings past the limit', () => {
    const bindings = trust.createClientIdBindings({ max: 2 });
    bindings.claim('a', 'http://a.test');
    bindings.claim('b', 'http://b.test');
    bindings.claim('c', 'http://c.test');
    expect(bindings.ownerOf('a')).toBeUndefined();
    expect(bindings.ownerOf('c')).toBe('http://c.test');
  });

  it('checks both page URLs and the requested client id of a message', () => {
    const bindings = trust.createClientIdBindings();
    bindings.claim('victim', 'http://localhost:5173');
    const check = (msg: unknown) => trust.checkPageMessage({
      bindings, socketOrigin: 'http://localhost:5174', currentClientId: 'generated', msg,
    });
    expect(check({ type: 'hello', page: { url: 'http://localhost:5174/' } })).toBeNull();
    expect(check({ type: 'snapshot', snapshot: { page: { url: 'http://localhost:5173/' } } })).toMatch(/does not belong/);
    expect(check({ type: 'hello', clientId: 'victim' })).toMatch(/another origin/);
    expect(check({ type: 'hello', clientId: 'generated' })).toBeNull();
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

type PageSocket = { socket: WebSocket; messages: any[]; closed: Promise<void> };

// Opens a page socket the way a browser would, with the page's Origin header.
async function openPageSocket(port: number, origin: string): Promise<PageSocket> {
  const socket = new (WebSocket as any)(`ws://127.0.0.1:${port}/__chippy/ws`, { headers: { Origin: origin } }) as WebSocket;
  const messages: any[] = [];
  socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
  const closed = new Promise<void>((done) => socket.addEventListener('close', () => done(), { once: true }));
  await new Promise<void>((done, fail) => {
    socket.addEventListener('open', () => done(), { once: true });
    socket.addEventListener('error', () => fail(new Error('WebSocket failed to open')), { once: true });
  });
  return { socket, messages, closed };
}

function hello(clientId: string, url: string) {
  return JSON.stringify({
    type: 'hello', clientId, bridgeVersion: 'test', buildMode: 'dev',
    page: { url, title: 'Test', storyId: null }, activated: true, probesActive: true,
  });
}

describe('helper page socket ownership (live WebSocket)', () => {
  const VICTIM = 'http://127.0.0.1:5173';
  const ATTACKER = 'http://127.0.0.1:5174';
  let port: number;
  let child: ChildProcess;
  const base = () => `http://127.0.0.1:${port}/__chippy`;
  const pages = async () => {
    const response = await fetch(`${base()}/api/pages`, withHelperToken());
    return ((await response.json()) as any).pages as Array<{ clientId: string; page: { url: string } }>;
  };
  const pageOf = async (clientId: string) => (await pages()).find((page) => page.clientId === clientId);

  beforeAll(async () => {
    port = await freePort();
    child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
      env: testHelperEnv(), stdio: 'ignore',
    });
    await waitFor(() => fetch(`${base()}/health`).then((r) => r.ok).catch(() => false), Boolean);
  });

  afterAll(() => child?.kill('SIGTERM'));

  it('rejects a foreign origin claiming a live page client id', async () => {
    const victim = await openPageSocket(port, VICTIM);
    victim.socket.send(hello('victim-tab', `${VICTIM}/app`));
    await waitFor(() => pageOf('victim-tab'), (page) => page?.page?.url === `${VICTIM}/app`);

    const attacker = await openPageSocket(port, ATTACKER);
    attacker.socket.send(hello('victim-tab', `${ATTACKER}/evil`));
    await attacker.closed;
    expect(attacker.messages.some((msg) => msg.type === 'error' && /another origin/.test(msg.message))).toBe(true);
    expect((await pageOf('victim-tab'))?.page?.url).toBe(`${VICTIM}/app`);

    victim.socket.close();
    await victim.closed;
    await waitFor(() => pageOf('victim-tab'), (page) => page === undefined);

    // The id stays bound to its origin after the victim disconnects.
    const late = await openPageSocket(port, ATTACKER);
    late.socket.send(hello('victim-tab', `${ATTACKER}/evil`));
    await late.closed;
    expect(await pageOf('victim-tab')).toBeUndefined();
  });

  it('rejects a page URL from another origin', async () => {
    const attacker = await openPageSocket(port, ATTACKER);
    const generated = await waitFor(async () => attacker.messages.find((msg) => msg.type === 'connected'), Boolean);
    attacker.socket.send(hello(generated.clientId, `${VICTIM}/app`));
    await attacker.closed;
    expect(attacker.messages.some((msg) => msg.type === 'error' && /does not belong/.test(msg.message))).toBe(true);
    expect(await pageOf(generated.clientId)).toBeUndefined();
  });

  it('lets a same-origin reload reuse its client id', async () => {
    const first = await openPageSocket(port, VICTIM);
    first.socket.send(hello('reload-tab', `${VICTIM}/one`));
    await waitFor(() => pageOf('reload-tab'), (page) => page?.page?.url === `${VICTIM}/one`);
    first.socket.close();
    await first.closed;

    const reloaded = await openPageSocket(port, VICTIM);
    reloaded.socket.send(hello('reload-tab', `${VICTIM}/two`));
    await waitFor(() => pageOf('reload-tab'), (page) => page?.page?.url === `${VICTIM}/two`);
    reloaded.socket.close();
  });
});
