import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const EXTENSION = resolve(__dirname, '../../.agents/skills/chippy/extension');
const read = (name: string) => readFileSync(resolve(EXTENSION, name), 'utf8');


function openPanelWithBridge({ installed = true, fromPageStart = true, runtime = true, startupMode = undefined as string | undefined, storedMode = undefined as string | undefined } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://example.test/page',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  const calls: string[] = [];
  const sent: Array<Record<string, any>> = [];
  let isInstalled = installed;
  let detectionMode = startupMode ?? 'sources';
  const installs: Array<Record<string, unknown>> = [];
  if (storedMode) win.localStorage.setItem('chippy:avalanche-mode', storedMode);
  win.__CHIPPY = { config: { activated: true, ui: 'panel', integration: { kind: 'extension', who: 'Chippy browser extension' }, publishDebounceMs: 0 } };
  if (fromPageStart) win.__CHIPPY_STARTUP_CONFIG = { avalanche: { autoStart: true, options: { detectionMode } } };
  if (runtime) win.__AVALANCHE__ = {
    status: () => ({ installed: isInstalled, commitCount: 2, detectionMode: isInstalled ? detectionMode : null }),
    reset: () => { calls.push('reset'); return { ok: true }; },
    pause: () => { calls.push('pause'); return { ok: true }; },
    install: (options: Record<string, unknown> = {}) => {
      installs.push(options);
      isInstalled = true;
      detectionMode = String(options.detectionMode ?? 'full');
      return { ok: true };
    },
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
  return { dom, win, panel, calls, sent, helper, installs };
}

describe('panel recording controls', () => {
  let close: (() => void) | null = null;
  afterEach(() => { close?.(); close = null; });

  it('clears the capture on Record and pauses it on Stop, without saving anything new', () => {
    const { dom, win, panel, calls, sent } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    expect(panel.querySelector('[data-chippy-avalanche-pill="ready"]')).toBeTruthy();

    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['reset']);
    expect(panel.querySelector('[data-chippy-record="recording"]')?.textContent).toMatch(/Stop 0:0\d/);

    (panel.querySelector('[data-chippy-record="recording"]') as HTMLButtonElement).click();
    expect(panel.querySelector('[data-chippy-recording-status]')?.textContent).toMatch(/^Recorded 0:0\d$/);
    expect(panel.querySelector('[data-chippy-record="stopped"]')?.textContent).toBe('● Record');
    // The recording is Avalanche's capture, paused at Stop: no export, no uninstall.
    expect(calls).toEqual(['reset', 'pause']);
    expect(sent.some((m) => JSON.stringify(m).includes('"payload"'))).toBe(false);
  });

  it('keeps recording when the extension injects the bridge again after an in-page navigation', () => {
    const { dom, win, panel, calls } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    const first = win.__CHIPPY.pageBridge;

    win.eval(read('chippy-page-bridge.js'));
    expect(win.__CHIPPY.pageBridge).not.toBe(first);
    expect(win.__CHIPPY.pageBridge.recording.state().state).toBe('recording');
    expect(panel.querySelector('[data-chippy-record="recording"]')).toBeTruthy();

    (panel.querySelector('[data-chippy-record="recording"]') as HTMLButtonElement).click();
    expect(panel.querySelector('[data-chippy-recording-status]')?.textContent).toMatch(/^Recorded 0:0\d$/);
    expect(calls).toEqual(['reset', 'pause']);
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

  it('says the runtime is missing, not that Avalanche is off, when avalanche.iife.js never loaded', () => {
    const missing = openPanelWithBridge({ installed: false, fromPageStart: false, runtime: false });
    close = () => { missing.win.__CHIPPY.pageBridge.destroy(); missing.dom.window.close(); };
    const pill = missing.panel.querySelector('[data-chippy-avalanche-pill="missing"]');
    expect(pill?.tagName).toBe('BUTTON');
    expect(pill?.textContent).toBe('⚠ Runtime missing · reload');
    expect(missing.panel.querySelector('[data-chippy-avalanche-pill="off"]')).toBeNull();
    expect(missing.panel.querySelector('[data-chippy-record]')).toBeNull();
  });

  it('switches a running capture to full mode from the panel and keeps the choice for reloads', () => {
    const { dom, win, panel, installs, sent } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    const pressed = () => panel.querySelector('[data-chippy-avalanche-mode][aria-pressed="true"]')?.getAttribute('data-chippy-avalanche-mode');
    expect(pressed()).toBe('sources');

    (panel.querySelector('[data-chippy-avalanche-mode="full"]') as HTMLButtonElement).click();
    expect(installs).toEqual([{ captureFibers: true, detectionMode: 'full', historySize: 1000 }]);
    expect(pressed()).toBe('full');
    expect(win.localStorage.getItem('chippy:avalanche-mode')).toBe('full');
    // The new capture starts on the live page, so it no longer has the load.
    expect(panel.querySelector('[data-chippy-avalanche-pill="late"]')?.getAttribute('title')).toMatch(/Reloads in full mode\.$/);
    expect(sent.some((m) => JSON.stringify(m).includes('avalanche-panel-mode'))).toBe(true);

    // Pressing the running mode again does nothing.
    (panel.querySelector('[data-chippy-avalanche-mode="full"]') as HTMLButtonElement).click();
    expect(installs).toHaveLength(1);
  });

  it('does not switch mode during a recording', () => {
    const { dom, win, panel, installs } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    (panel.querySelector('[data-chippy-record="idle"]') as HTMLButtonElement).click();
    expect((panel.querySelector('[data-chippy-avalanche-mode="full"]') as HTMLButtonElement).disabled).toBe(true);
    expect(win.__CHIPPY.pageBridge.recording.setMode('full')).toEqual({ ok: false, error: 'Stop the recording before switching mode.' });
    expect(installs).toEqual([]);
  });

  it('shows the running mode, and with Avalanche off picks the mode for the next reload', () => {
    const running = openPanelWithBridge({ startupMode: 'amplifiers' });
    expect(running.panel.querySelector('[data-chippy-avalanche-mode="full"]')?.getAttribute('aria-pressed')).toBe('true');
    running.win.__CHIPPY.pageBridge.destroy();
    running.dom.window.close();

    const off = openPanelWithBridge({ installed: false, fromPageStart: false, storedMode: 'full' });
    close = () => { off.win.__CHIPPY.pageBridge.destroy(); off.dom.window.close(); };
    expect(off.panel.querySelector('[data-chippy-avalanche-mode="full"]')?.getAttribute('aria-pressed')).toBe('true');
    (off.panel.querySelector('[data-chippy-avalanche-mode="sources"]') as HTMLButtonElement).click();
    expect(off.installs).toEqual([]);
    expect(off.win.localStorage.getItem('chippy:avalanche-mode')).toBe('sources');
    expect(off.panel.querySelector('[data-chippy-avalanche-pill="off"]')?.getAttribute('title')).toMatch(/Reloads in sources mode\.$/);
  });

  it('reloads with Avalanche in the chosen mode', async () => {
    const { dom, win } = openPanelWithBridge({ installed: false, fromPageStart: false, storedMode: 'full' });
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    await win.__CHIPPY.pageBridge.recording.reloadWithAvalanche();
    const handoff = JSON.parse(win.sessionStorage.getItem('__chippyStartupHandoff') || '{}');
    expect(handoff.avalanche).toEqual({ autoStart: true, options: { captureFibers: true, detectionMode: 'full' } });
  });

  it('names how Chippy reached the page in the connection tooltip, not the header text', () => {
    const { dom, win, panel } = openPanelWithBridge();
    close = () => { win.__CHIPPY.pageBridge.destroy(); dom.window.close(); };
    const pill = panel.querySelector('[data-chippy-conn-pill]');
    expect(pill?.getAttribute('data-chippy-integration')).toBe('extension');
    expect(pill?.getAttribute('title')).toMatch(/\nLoaded via extension: Chippy browser extension$/);
    expect(panel.querySelector('[data-chippy-key="panel-header"]')?.textContent).not.toMatch(/via extension/);
  });

});
