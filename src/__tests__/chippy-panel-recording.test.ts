import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const EXTENSION = resolve(__dirname, '../../.agents/skills/chippy/extension');
const read = (name: string) => readFileSync(resolve(EXTENSION, name), 'utf8');


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
      evalAvalanche: (command: { action: string }) => ({ ok: true, available: true, action: command.action }),
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

describe('panel recording controls', () => {
  let close: (() => void) | null = null;
  afterEach(() => { close?.(); close = null; });

  it('clears the capture on Record and marks the end on Stop, without saving anything new', () => {
    const { dom, win, panel, calls, sent } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    expect(panel.querySelector('[data-chippy-avalanche-pill="ready"]')).toBeTruthy();

    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['reset']);
    expect(panel.querySelector('[data-chippy-record="recording"]')?.textContent).toMatch(/Stop 0:0\d/);

    (panel.querySelector('[data-chippy-record="recording"]') as HTMLButtonElement).click();
    expect(panel.querySelector('[data-chippy-recording-status]')?.textContent).toMatch(/^Recorded 0:0\d$/);
    expect(panel.querySelector('[data-chippy-record="stopped"]')?.textContent).toBe('● Record');
    // The recording is Avalanche's capture: no export, no uninstall.
    expect(calls).toEqual(['reset']);
    expect(sent.some((m) => JSON.stringify(m).includes('"payload"'))).toBe(false);
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

});
