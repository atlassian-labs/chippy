import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const EXTENSION = resolve(__dirname, '../../.agents/skills/chippy/extension');
const read = (name: string) => readFileSync(resolve(EXTENSION, name), 'utf8');

const LARGE = { ok: true, available: true, action: 'export', payload: { rows: Array.from({ length: 30_000 }, (_, i) => ({ i, name: `Row ${i}` })) } };

function openBridge() {
  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://example.test/page',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  const sent: string[] = [];
  win.__CHIPPY = { config: { activated: true, ui: 'panel', integration: { kind: 'extension' }, publishDebounceMs: 0 } };
  win.__AVALANCHE__ = {
    status: () => ({ installed: true, commitCount: 2 }),
    bridge: {
      readAvalancheStatus: () => ({ ok: true, available: true, status: { installed: true } }),
      evalAvalanche: (command: { action: string }) => (command.action === 'export' ? LARGE : { ok: true, available: true, action: command.action }),
    },
    layoutLab: {
      getFiberKey: () => null, getFiber: () => null, getDisplayName: () => null, isUserComponent: () => false,
      getNearestFiber: () => null, getNearestComponent: () => null,
      getHookSummary: () => ({ hookCount: 0, hookCountTruncated: false, hookCountMax: 500 }),
      getOwnerChain: () => [], getOwnerFibers: () => [], getFiberDomNode: () => null,
      getReturnComponentChain: () => [], getReturnComponentFibers: () => [],
      describeSource: () => null, describeFiberTarget: () => null, describeComponent: () => null, describeContext: () => null,
      findBoundaryFibers: () => ({ owner: null, error: null, suspense: null }),
      normalizeProbeAnnotation,
    },
  };
  win.chrome = { storage: { local: { get: async () => ({}), set: async () => undefined } } };
  const sockets: Array<Record<string, any>> = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    listeners: Record<string, Function[]> = {};
    constructor() { sockets.push(this); }
    addEventListener(type: string, listener: Function) { (this.listeners[type] ||= []).push(listener); }
    close() {}
    send(text: string) { sent.push(text); }
    emit(type: string, data?: unknown) {
      for (const listener of this.listeners[type] || []) listener({ type, data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
  win.WebSocket = FakeWebSocket;
  win.eval(read('panel-dom.js'));
  win.eval(read('panel-settings.js'));
  win.eval(read('layout-lab.js'));
  win.eval(read('chippy-page-bridge.js'));
  (win.document.querySelector('[data-layout-lab-panel] [aria-label="Open Chippy"]') as HTMLButtonElement).click();
  const socket = sockets[0];
  socket.emit('open');
  const command = (action: string, requestId: string) => socket.emit('message', { type: 'command', command: { type: 'eval-avalanche', action, requestId } });
  const resultFor = async (requestId: string) => {
    for (let i = 0; i < 50; i++) {
      const text = sent.find((t) => t.includes(`"requestId":"${requestId}"`));
      if (text) return text;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no result for ${requestId}`);
  };
  return { dom, win, socket, command, resultFor };
}

describe('page bridge raw Avalanche results', () => {
  let close: (() => void) | null = null;
  afterEach(() => { close?.(); close = null; });

  it('sends a large result raw once the helper announces support, small ones as JSON', async () => {
    const { dom, win, socket, command, resultFor } = openBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    socket.emit('message', { type: 'connected', clientId: 'c1', rawResults: true });

    command('export', 'big');
    const big = await resultFor('big');
    const newline = big.indexOf('\n');
    expect(JSON.parse(big.slice(0, newline))).toMatchObject({ type: 'eval-avalanche-result', requestId: 'big', rawResult: true });
    expect(JSON.parse(big.slice(newline + 1))).toEqual(LARGE);

    command('status', 'small');
    expect(JSON.parse(await resultFor('small'))).toMatchObject({ type: 'eval-avalanche-result', requestId: 'small', result: { action: 'status' } });
  });

  it('keeps large results as ordinary JSON for a helper without raw support', async () => {
    const { dom, win, socket, command, resultFor } = openBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    socket.emit('message', { type: 'connected', clientId: 'c1' });

    command('export', 'big');
    expect(JSON.parse(await resultFor('big'))).toMatchObject({ requestId: 'big', result: LARGE });

    socket.emit('message', { type: 'connected', clientId: 'c1', rawResults: true });
    socket.emit('close');
    command('export', 'after-close');
    expect(JSON.parse(await resultFor('after-close'))).toMatchObject({ requestId: 'after-close', result: LARGE });
  });
});
