import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const EXTENSION = resolve(__dirname, '../../.agents/skills/chippy/extension');
const read = (name: string) => readFileSync(resolve(EXTENSION, name), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRecordingStore } = require('../../.agents/skills/chippy/scripts/avalanche-recordings.js');

const EXPORT = { meta: { version: 8 }, commitStats: { 1: [], 2: [] } };

function openPanelWithBridge({ installed = true, fromPageStart = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://example.test/page',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  const calls: string[] = [];
  const sent: Array<Record<string, any>> = [];
  let isInstalled = installed;
  win.__CHIPPY = { config: { activated: true, ui: 'panel', integration: { kind: 'extension' }, publishDebounceMs: 0 } };
  if (fromPageStart) win.__CHIPPY_STARTUP_CONFIG = { avalanche: { autoStart: true } };
  win.__AVALANCHE__ = {
    status: () => ({ installed: isInstalled, commitCount: 2 }),
    reset: () => { calls.push('reset'); return { ok: true }; },
    install: () => { isInstalled = true; return { ok: true }; },
    uninstall: () => { calls.push('uninstall'); return { ok: true }; },
    bridge: {
      readAvalancheStatus: () => ({ ok: true, available: true, status: { installed: isInstalled } }),
      evalAvalanche: (command: { action: string }) => command.action === 'export'
        ? { ok: true, available: true, action: 'export', payload: EXPORT }
        : { ok: true, available: true, action: command.action },
    },
    layoutLab: {
      getFiberKey: () => null,
      getFiber: () => null,
      getDisplayName: () => null,
      isUserComponent: () => false,
      getNearestFiber: () => null,
      getNearestComponent: () => null,
      getHookSummary: () => ({ hookCount: 0, hookCountTruncated: false, hookCountMax: 500 }),
      getOwnerChain: () => [],
      getOwnerFibers: () => [],
      getFiberDomNode: () => null,
      getReturnComponentChain: () => [],
      getReturnComponentFibers: () => [],
      describeSource: () => null,
      describeFiberTarget: () => null,
      describeComponent: () => null,
      describeContext: () => null,
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
    send(text: string) { sent.push(JSON.parse(text)); }
    emit(type: string, data?: unknown) {
      for (const listener of this.listeners[type] || []) listener({ type, data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
  win.WebSocket = FakeWebSocket;
  win.eval(read('panel-dom.js'));
  win.eval(read('panel-settings.js'));
  win.eval(read('layout-lab.js'));
  win.eval(read('chippy-page-bridge.js'));
  const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
  (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();
  sockets[0].emit('open');
  const helper = (command: Record<string, unknown>) => sockets[0].emit('message', { type: 'command', command });
  return { dom, win, panel, calls, sent, helper };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

describe('panel recording controls', () => {
  let close: (() => void) | null = null;
  afterEach(() => { close?.(); close = null; });

  it('records, sends the export to the helper on Stop, and shows the saved file', async () => {
    const { dom, win, panel, calls, sent, helper } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    expect(panel.querySelector('[data-chippy-avalanche-pill="ready"]')).toBeTruthy();

    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['reset']);
    expect(panel.querySelector('[data-chippy-record="recording"]')?.textContent).toMatch(/Stop 0:0\d/);

    (panel.querySelector('[data-chippy-record="recording"]') as HTMLButtonElement).click();
    await flush();
    const message = sent.find((m) => m.type === 'avalanche-recording')!;
    expect(message.payload).toEqual(EXPORT);
    expect(message.page.url).toBe('https://example.test/page');
    expect(panel.querySelector('[data-chippy-record="saving"]')).toBeTruthy();

    helper({ type: 'avalanche-recording-saved', ok: true, file: '/tmp/chippy-recordings/run.json', commits: 2 });
    expect(panel.querySelector('[data-chippy-recording-status]')?.textContent).toBe('Saved 2 commits · run.json');
    expect(panel.querySelector('[data-chippy-record="idle"]')).toBeTruthy();
    // Stop saves a copy; Avalanche keeps capturing.
    expect(calls).not.toContain('uninstall');
  });

  it('offers a reload when Avalanche is off or was installed after the page loaded', () => {
    const off = openPanelWithBridge({ installed: false, fromPageStart: false });
    expect(off.panel.querySelector('[data-chippy-avalanche-pill="off"]')?.tagName).toBe('BUTTON');
    expect(off.panel.querySelector('[data-chippy-record]')).toBeNull();
    off.win.__CHIPPY.pageBridge.destroy();
    off.dom.window.close();

    const late = openPanelWithBridge({ installed: true, fromPageStart: false });
    close = () => { late.win.__CHIPPY.pageBridge.destroy(); late.dom.window.close(); };
    expect(late.panel.querySelector('[data-chippy-avalanche-pill="late"]')?.tagName).toBe('BUTTON');
    expect(late.panel.querySelector('[data-chippy-record="idle"]')).toBeTruthy();
  });

  it('reports a save the helper rejected', async () => {
    const { dom, win, panel, helper } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    (panel.querySelector('[data-chippy-record="recording"]') as HTMLButtonElement).click();
    await flush();
    helper({ type: 'avalanche-recording-saved', ok: false, error: 'disk full' });
    expect(panel.querySelector('[data-chippy-recording-status]')?.textContent).toBe('disk full');
  });
});

describe('helper recording store', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('saves an export that avalanche-offline reads and lists it newest first', () => {
    dir = mkdtempSync(join(tmpdir(), 'chippy-recordings-'));
    let t = Date.parse('2026-11-17T10:00:00Z');
    const store = createRecordingStore({ dir, now: () => new Date(t) });
    const first = store.save({ clientId: 'abc/../x', page: { url: 'https://a.test/' }, startedAt: 1, stoppedAt: 2, payload: EXPORT });
    t += 1000;
    const second = store.save({ clientId: 'def', page: {}, payload: EXPORT });
    expect(first).toMatchObject({ ok: true, commits: 2 });
    expect(first.file.startsWith(dir)).toBe(true);
    expect(first.file).not.toContain('..');
    expect(JSON.parse(readFileSync(first.file, 'utf8')).payload).toEqual(EXPORT);
    expect(store.list().map((r: { file: string }) => r.file)).toEqual([second.file, first.file]);
    expect(store.list()[1]).toMatchObject({ url: 'https://a.test/', commits: 2, startedAt: 1, stoppedAt: 2 });
  });

  it('rejects a payload that is not an Avalanche export', () => {
    dir = mkdtempSync(join(tmpdir(), 'chippy-recordings-'));
    expect(createRecordingStore({ dir }).save({ payload: { nope: true } })).toMatchObject({ ok: false });
  });
});
