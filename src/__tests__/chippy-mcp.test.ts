import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { createServer as httpServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const runtime = resolve('.agents/skills/chippy/scripts/chippy-mcp.cjs');
const clients: Client[] = [];
const helpers = new Set<number>();
let port: number;
let first: Client;
let second: Client;
let socket: WebSocket;
let blocker: Server;
const commands: any[] = [];
// The MCP adapter reads the token file written by the helper it starts.
const stateDir = mkdtempSync(join(tmpdir(), 'chippy-mcp-state-'));

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = (server.address() as any).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return value;
}
async function connect(port: number, path = runtime) {
  const client = new Client({ name: 'chippy-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path], env: { CHIPPY_HELPER_PORT: String(port), CHIPPY_STATE_DIR: stateDir }, stderr: 'pipe' }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { result, data: result.structuredContent as any };
}
function sendSnapshot(reason = 'initial', comment = '') {
  socket.send(JSON.stringify({ type: 'snapshot', reason, clientId: 'mcp-client', activated: true, probesActive: true,
    page: { url: 'http://example.test', title: 'MCP fixture' },
    snapshot: { markers: { '1': { intent: comment ? 'investigate' : null, comment, resolved: { component: { name: 'Counter' } } } } },
  }));
}
async function poll(check: () => Promise<boolean>) {
  for (let n = 0; n < 100; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('MCP fixture did not become ready');
}
beforeAll(async () => {
  port = await freePort();
  first = await connect(port);
  const status = await call(first, 'chippy_status');
  expect(status.result.isError).toBe(false);
  expect(status.data).toMatchObject({ browserConnected: false, lifetime: 'persistent' });
  expect(status.data.startedPid).toBeTypeOf('number');
  helpers.add(status.data.startedPid);
  second = await connect(port);
  const reused = await call(second, 'chippy_status');
  expect(reused.data.startedPid).toBeNull();
  socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('WS connection failed')); });
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    const command = message.command || message;
    commands.push(command);
    if (command.type === 'request-snapshot') { sendSnapshot(); return; }
    if (command.requestId) socket.send(JSON.stringify({
      type: command.type === 'eval-avalanche' ? 'eval-avalanche-result' : 'eval-probe-result',
      requestId: command.requestId, result: { ok: true, echo: command },
    }));
  };
  sendSnapshot();
  await poll(async () => (await call(first, 'chippy_pages')).data.pages.some((page: any) => page.clientId === 'mcp-client'));
}, 20000);
afterAll(async () => {
  socket?.close();
  await Promise.all(clients.map(client => client.close()));
  for (const pid of helpers) { try { process.kill(pid); } catch {} }
  if (blocker) await new Promise<void>(resolve => blocker.close(() => resolve()));
});

it('lists all tools with typed input and accurately distinguishes connected browser state', async () => {
  const { tools } = await first.listTools();
  expect(tools.map(tool => tool.name)).toHaveLength(10);
  expect(tools.every(tool => tool.inputSchema.type === 'object')).toBe(true);
  expect((await call(first, 'chippy_status')).data.browserConnected).toBe(true);
  expect((await call(first, 'chippy_snapshot', { clientId: 'mcp-client' })).data.snapshot.markers['1'].resolved.component.name).toBe('Counter');
  expect((await call(first, 'chippy_snapshot', { clientId: 'mcp-client', refresh: true })).result.isError).toBe(false);
});

it('forwards every probe and fiber view through real MCP, HTTP, and the page WebSocket', async () => {
  for (const view of ['dom', 'parents', 'boundaries', 'owners', 'props', 'prop-value', 'hooks', 'hooks-summary']) {
    const result = await call(first, 'chippy_probe', { clientId: 'mcp-client', probeId: '1', view, prop: 'label', ownerIndex: 2, max: 7, parentLevel: 1 });
    expect(result.result.isError, view).toBe(false);
    expect(commands.at(-1)).toMatchObject({ probeId: '1', type: view === 'owners' ? 'eval-probe-owners' : view === 'prop-value' ? 'eval-prop-value' : `eval-probe-${view}` });
    if (view !== 'owners') expect(commands.at(-1)).toMatchObject({ prop: 'label', ownerIndex: 2, max: 7, parentLevel: 1 });
  }
  for (const view of ['props', 'owners', 'parents', 'boundaries', 'hooks', 'hooks-summary', 'structure', 'describe', 'explain']) {
    expect((await call(first, 'chippy_inspect_fiber', { clientId: 'mcp-client', fiberId: 'fiber:1', view, hookIndex: 2, windowSize: 3, max: 9 })).result.isError, view).toBe(false);
    expect(commands.at(-1)).toMatchObject({ type: view === 'describe' ? 'describe-component' : view === 'explain' ? 'explain-component' : `inspect-fiber-${view}`, fiberId: 'fiber:1', hookIndex: 2, windowSize: 3, max: 9 });
  }
  const filters = { name: 'Counter', file: 'Counter.tsx', prop: 'label', testid: 'counter', text: 'Count', grep: 'needle', in: 'props,debug', depth: 6, max: 20 };
  expect((await call(first, 'chippy_find_fibers', { clientId: 'mcp-client', filters })).result.isError).toBe(false);
  expect(commands.at(-1)).toMatchObject({ type: 'find-fibers', filters });
});

it('preserves profiling options and all analysis selectors through the existing command builder', async () => {
  for (const action of ['status', 'install', 'uninstall', 'clear', 'export', 'hot-sources', 'commit-list', 'commit-peek', 'debug-hook', 'describe-action', 'export-last']) {
    const fields = { action, options: { detectionMode: 'full', historySize: 50, captureFibers: false }, limit: 6, count: 8, top: 9, by: 'sources', commitId: 3, include: ['sources'], depth: 2, maxItems: 15, sourceId: 'Counter#1', hookIndex: 0, window: 4, actionId: 2 };
    expect((await call(first, 'chippy_avalanche', { clientId: 'mcp-client', ...fields })).result.isError, action).toBe(false);
    expect(commands.at(-1)).toMatchObject({ type: 'eval-avalanche', ...fields });
  }
});

it('preserves explicit targets, callback arguments and schedule ownership', async () => {
  for (const targetKind of ['selector', 'probeId', 'fiberId']) {
    expect((await call(first, 'chippy_interact', { clientId: 'mcp-client', action: 'click', target: 'target', targetKind })).result.isError).toBe(false);
    expect(commands.at(-1)).toMatchObject({ type: 'page-click', target: { [targetKind]: 'target' } });
  }
  for (const action of ['prop-contract', 'invoke', 'schedule-update']) {
    expect((await call(first, 'chippy_interact', { clientId: 'mcp-client', action, target: 'fiber:1', propName: 'onClick', args: [{ key: 1 }], ownerIndex: 2 })).result.isError).toBe(false);
    expect(commands.at(-1)).toMatchObject({ type: `fiber-${action}`, fiberId: 'fiber:1' });
    if (action === 'invoke') expect(commands.at(-1).args).toEqual([{ key: 1 }]);
    if (action === 'schedule-update') expect(commands.at(-1).ownerIndex).toBe(2);
    else expect(commands.at(-1).propName).toBe('onClick');
  }
});

it('receives UI intent, times out normally, and reports invalid inputs and missing pages as tool errors', async () => {
  sendSnapshot('marker-annotation-change', 'Find the cause');
  const annotation = await call(first, 'chippy_wait_annotation', { clientId: 'mcp-client', timeoutMs: 1000 });
  expect(annotation.data.status).toBe('annotation');
  expect(JSON.stringify(annotation.data)).toContain('Find the cause');
  expect((await call(first, 'chippy_wait_annotation', { clientId: 'mcp-client', timeoutMs: 10 })).data.status).toBe('timeout');
  const replayed = await call(first, 'chippy_wait_annotation', { clientId: 'mcp-client', timeoutMs: 10, after: annotation.data.cursor - 1 });
  expect(replayed.data).toMatchObject({ status: 'annotation', cursor: annotation.data.cursor });
  expect((await call(first, 'chippy_wait_annotation', { clientId: 'mcp-client', timeoutMs: 10, after: annotation.data.cursor })).data.status).toBe('timeout');
  const acked = await call(first, 'chippy_ack_annotation', { clientId: 'mcp-client', sequence: annotation.data.cursor });
  expect(acked.data).toMatchObject({ status: 'acknowledged', clearRequested: ['1'] });
  expect(commands.at(-1)).toMatchObject({ type: 'clear-probe-annotation', markerId: '1', expected: { intent: 'investigate', comment: 'Find the cause' } });
  expect((await call(first, 'chippy_probe', { clientId: 'mcp-client', probeId: '1', view: 'prop-value' })).result.isError).toBe(true);
  expect((await call(first, 'chippy_interact', { clientId: 'mcp-client', action: 'invoke', target: 'fiber:1' })).result.isError).toBe(true);
  expect((await call(first, 'chippy_inspect_fiber', { clientId: 'mcp-client', fiberId: 'fiber:1', view: 'structure' })).result.isError).toBe(true);
  expect((await call(first, 'chippy_snapshot', { clientId: 'unknown-client' })).result.isError).toBe(true);
  expect((await call(first, 'chippy_wait_annotation', { clientId: 'mcp-client', timeoutMs: -1 })).result.isError).toBe(true);
});

it('leaves the shared helper and second session alive after the starting session disconnects', async () => {
  await first.close();
  expect((await call(second, 'chippy_status')).data.browserConnected).toBe(true);
  expect((await fetch(`http://127.0.0.1:${port}/__chippy/health`)).ok).toBe(true);
});

it('cancels an annotation wait without blocking subsequent tools', async () => {
  const controller = new AbortController();
  const waiting = second.callTool({ name: 'chippy_wait_annotation', arguments: { clientId: 'mcp-client', timeoutMs: 60000 } }, undefined, { signal: controller.signal });
  const rejected = expect(waiting).rejects.toThrow();
  await new Promise(resolve => setTimeout(resolve, 30));
  controller.abort();
  await rejected;
  expect((await call(second, 'chippy_status')).result.isError).toBe(false);
});

it('refuses an incompatible occupied port without replacing that process', async () => {
  blocker = httpServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true,"version":"other","now":"today"}'); });
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const occupied = (blocker.address() as any).port;
  const third = await connect(occupied);
  const failure = await call(third, 'chippy_status');
  expect(failure.result.isError).toBe(true);
  expect(JSON.stringify(failure.result.content)).toContain('Incompatible helper');
  expect((await fetch(`http://127.0.0.1:${occupied}/__chippy/health`)).ok).toBe(true);
});
