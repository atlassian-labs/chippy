// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RawJson, readRawResultMessage, serializeWithRawResult } = require('../../.agents/skills/chippy/scripts/raw-result.js');

const HELPER = resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy-helper-server.js');
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGTERM');
});

const rawMessage = (header: object, result: string) => Buffer.from(`${JSON.stringify(header)}\n${result}`);

describe('raw Avalanche results', () => {
  it('reads a raw header and keeps the result as bytes', () => {
    const message = readRawResultMessage(rawMessage(
      { type: 'eval-avalanche-result', clientId: 'c1', requestId: 'r1', rawResult: true },
      '{"ok":true,"payload":{"commits":3}}',
    ));
    expect(message).toMatchObject({ type: 'eval-avalanche-result', clientId: 'c1', requestId: 'r1' });
    expect(message).not.toHaveProperty('rawResult');
    expect(message.result).toBeInstanceOf(RawJson);
    expect(message.result.bytes.toString()).toBe('{"ok":true,"payload":{"commits":3}}');
  });

  it('leaves ordinary messages, including indented JSON, to JSON.parse', () => {
    expect(readRawResultMessage(Buffer.from('{"type":"hello","clientId":"c1"}'))).toBeNull();
    expect(readRawResultMessage(Buffer.from(JSON.stringify({ type: 'hello' }, null, 2)))).toBeNull();
    expect(readRawResultMessage(Buffer.from('{"type":"hello"}\n{"x":1}'))).toBeNull();
  });

  it('accepts the raw form only for Avalanche results with a request id', () => {
    expect(() => readRawResultMessage(rawMessage({ type: 'eval-script-result', requestId: 'r1', rawResult: true }, '{}'))).toThrow(/eval-avalanche-result/);
    expect(() => readRawResultMessage(rawMessage({ type: 'eval-avalanche-result', rawResult: true }, '{}'))).toThrow(/requestId/);
  });

  it('writes the page bytes first so the helper fields win', () => {
    const reply = serializeWithRawResult({ ok: true, result: new RawJson(Buffer.from('{"a":1}')), targetClientId: 'c1' });
    expect(reply.toString()).toBe('{"result":{"a":1},"ok":true,"targetClientId":"c1"}');
    // Bytes that add helper fields lose to the helper's own, later ones.
    const forged = serializeWithRawResult({ ok: true, result: new RawJson(Buffer.from('1,"targetClientId":"other","ok":false')), targetClientId: 'c1' });
    expect(JSON.parse(forged.toString())).toMatchObject({ ok: true, targetClientId: 'c1' });
    // Bytes that try to absorb the helper fields leave the reply invalid.
    const absorbing = serializeWithRawResult({ ok: true, result: new RawJson(Buffer.from('1,"pad":"')), targetClientId: 'c1' });
    expect(() => JSON.parse(absorbing.toString())).toThrow();
    expect(serializeWithRawResult({ ok: true, result: { a: 1 } })).toBeNull();
  });
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error('Timed out waiting for the helper');
}

describe('helper raw result pass-through', () => {
  it('announces raw results and returns a large export unchanged', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
    children.push(child);
    const base = `http://127.0.0.1:${port}/__chippy`;
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), Boolean);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
    const connected = new Promise<any>((resolveConnected) => socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'connected') resolveConnected(message);
    }));
    await new Promise((resolveOpen) => socket.addEventListener('open', resolveOpen, { once: true }));
    expect((await connected).rawResults).toBe(true);

    const clientId = 'raw-result-page';
    const result = { ok: true, available: true, action: 'export', payload: { rows: Array.from({ length: 20_000 }, (_, i) => ({ i, name: `Row ${i}` })) } };
    const resultText = JSON.stringify(result);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== 'command' || message.command.type !== 'eval-avalanche') return;
      socket.send(`${JSON.stringify({ type: 'eval-avalanche-result', clientId, requestId: message.command.requestId, rawResult: true })}\n${resultText}`);
    });
    socket.send(JSON.stringify({ type: 'hello', clientId, bridgeVersion: 'test', page: { url: 'http://example.test/story', title: 'Test' } }));
    await waitFor(
      async () => fetch(`${base}/api/pages`, withHelperToken()).then((response) => response.json()),
      (body: any) => body.pages?.some((page: any) => page.clientId === clientId),
    );

    const response = await fetch(`${base}/api/pages/${clientId}/avalanche`, withHelperToken({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'export', timeoutMs: 5000 }),
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.startsWith(`{"result":${resultText},`)).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ ok: true, result, targetClientId: clientId });
    socket.close();
  }, 20_000);
});
