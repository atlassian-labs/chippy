import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const PANEL_DOM_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/panel-dom.js'),
  'utf8',
);
const PANEL_SETTINGS_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/panel-settings.js'),
  'utf8',
);
const LAYOUT_LAB_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/layout-lab.js'),
  'utf8',
);
const PAGE_BRIDGE_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/chippy-page-bridge.js'),
  'utf8',
);

function openLayoutLab(config: Record<string, unknown>, expose = true) {
  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://example.test/page',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  win.__CHIPPY = { config, connState: 'connected' };
  win.__AVALANCHE__ = {
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
      describeJiraContext: () => null,
      findBoundaryFibers: () => ({ owner: null, error: null, suspense: null }),
      normalizeProbeAnnotation,
    },
  };
  win.chrome = {
    storage: {
      local: {
        get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', forwardPort: null }),
        set: async () => undefined,
      },
    },
  };
  win.eval(PANEL_DOM_SOURCE);
  win.eval(PANEL_SETTINGS_SOURCE);
  win.eval(LAYOUT_LAB_SOURCE);
  if (expose) win.__CHIPPY.layoutLab.exposeDefaultMarkers();
  return { dom, win };
}

describe('Chippy unified in-page panel', () => {
  it('starts as one button and embeds docked probes only after expansion', () => {
    const { dom, win } = openLayoutLab({
      ui: 'panel',
      integration: { kind: 'extension' },
    });
    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    const marker1 = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement;
    const marker2 = win.document.querySelector('[data-layout-lab-marker="2"]') as HTMLElement;

    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('false');
    expect(panel.querySelector('[aria-label="Open Chippy"]')).toBeTruthy();
    expect(win.document.querySelector('[data-layout-lab-dock]')).toBeNull();
    expect(marker1.style.display).toBe('none');
    expect(marker2.style.display).toBe('none');
    expect(win.__CHIPPY.layoutLab.getMarkerState('1').docked).toBe(true);

    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();

    const dock = panel.querySelector('[data-layout-lab-dock]') as HTMLElement;
    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('true');
    expect(dock).toBeTruthy();
    expect(dock.parentElement?.closest('[data-layout-lab-panel]')).toBe(panel);
    expect(dock.textContent).toContain('P1 — drag to source');
    expect(dock.textContent).toContain('P2 — drag to source');
    expect(dock.querySelector('[data-chippy-probe-dock-slot="1"]')).toBeTruthy();
    expect(dock.querySelector('[data-chippy-probe-dock-slot="2"]')).toBeTruthy();
    expect(Array.from(win.document.body.children).some((node) => node.hasAttribute('data-layout-lab-dock'))).toBe(false);
    expect(marker1.style.display).not.toBe('none');
    expect(marker2.style.display).not.toBe('none');

    (panel.querySelector('[aria-label="Collapse Chippy"]') as HTMLButtonElement).click();
    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('false');
    expect(win.document.querySelector('[data-layout-lab-dock]')).toBeNull();
    expect(marker1.style.display).toBe('none');
    expect(marker2.style.display).toBe('none');
    dom.window.close();
  });

  it('offers extension settings inside the expanded panel', () => {
    const { dom, win } = openLayoutLab({
      ui: 'panel',
      integration: { kind: 'extension' },
    });
    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();
    const settingsButton = panel.querySelector('[aria-label="Show Chippy settings"]') as HTMLButtonElement;
    expect(settingsButton).toBeTruthy();
    settingsButton.click();
    expect(panel.querySelector('[data-chippy-settings-host]')).toBeTruthy();
    expect(panel.querySelector('[aria-label="Hide Chippy settings"]')).toBeTruthy();
    dom.window.close();
  });

  it('keeps the panel expanded when the layout bundle is reinstalled', () => {
    const { dom, win } = openLayoutLab({
      ui: 'panel',
      integration: { kind: 'extension' },
    });
    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();

    win.eval(LAYOUT_LAB_SOURCE);
    win.__CHIPPY.layoutLab.updatePanel();

    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('true');
    expect(panel.querySelector('[aria-label="Collapse Chippy"]')).toBeTruthy();
    dom.window.close();
  });

  it('patches panel changes in place without deleting existing controls or settings', () => {
    const { dom, win } = openLayoutLab({
      ui: 'panel',
      integration: { kind: 'extension' },
    });
    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();

    const expandedPanel = panel.querySelector('[data-chippy-expanded-panel]');
    const header = panel.querySelector('[data-chippy-key="panel-header"]');
    const dock = panel.querySelector('[data-layout-lab-dock]');
    const p1Row = panel.querySelector('[data-chippy-probe-row="1"]');
    const p2Row = panel.querySelector('[data-chippy-probe-row="2"]');
    const p2Label = p2Row?.querySelector('strong');
    const marker = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement & Record<string, any>;
    marker.__docked = false;
    marker.__probe = {
      best: {
        exact: { domTag: 'button', domText: 'Save', fiberType: 'button', source: null },
        component: { name: 'SaveButton', props: {}, source: null, owners: [] },
      },
    };
    win.__CHIPPY.layoutLab.updatePanel();

    expect(panel.querySelector('[data-chippy-expanded-panel]')).toBe(expandedPanel);
    expect(panel.querySelector('[data-chippy-key="panel-header"]')).toBe(header);
    expect(panel.querySelector('[data-layout-lab-dock]')).toBe(dock);
    expect(panel.querySelector('[data-chippy-probe-row="1"]')).toBe(p1Row);
    expect(panel.querySelector('[data-chippy-probe-row="2"]')).toBe(p2Row);
    expect(p2Row?.querySelector('strong')).toBe(p2Label);

    const comment = panel.querySelector('[data-chippy-probe-comment="1"]') as HTMLTextAreaElement;
    comment.value = 'draft survives runtime updates';
    const settingsToggle = panel.querySelector('[data-chippy-settings-toggle]') as HTMLButtonElement;
    settingsToggle.click();
    const settingsSlot = panel.querySelector('[data-chippy-settings-slot]') as HTMLElement;
    const settingsHost = settingsSlot.querySelector('[data-chippy-settings-host]');
    expect(settingsHost).toBeTruthy();

    win.__CHIPPY.connState = 'reconnecting';
    marker.__probe.best.exact.domText = 'Save changes';
    win.__CHIPPY.layoutLab.updatePanel();

    expect(panel.querySelector('[data-chippy-probe-comment="1"]')).toBe(comment);
    expect(comment.value).toBe('draft survives runtime updates');
    expect(panel.querySelector('[data-chippy-settings-slot]')).toBe(settingsSlot);
    expect(panel.querySelector('[data-chippy-settings-host]')).toBe(settingsHost);
    dom.window.close();
  });

  it('keeps an undocked probe document-anchored after the first drag move', () => {
    const { dom, win } = openLayoutLab({
      ui: 'panel',
      integration: { kind: 'extension' },
    });
    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    const marker = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement & Record<string, any>;
    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();
    (win.document as Document & { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
    marker.setPointerCapture = () => undefined;
    marker.releasePointerCapture = () => undefined;

    marker.dispatchEvent(new win.MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 20,
      clientY: 20,
    }));
    marker.dispatchEvent(new win.MouseEvent('pointermove', {
      bubbles: true,
      clientX: 180,
      clientY: 240,
    }));

    expect(marker.style.position).toBe('absolute');
    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('true');

    marker.dispatchEvent(new win.MouseEvent('pointerup', {
      bubbles: true,
      clientX: 180,
      clientY: 240,
    }));
    expect(marker.style.position).toBe('absolute');
    dom.window.close();
  });

  it('does not recreate docked probes when the bridge socket connects', async () => {
    const { dom, win } = openLayoutLab({
      activated: true,
      ui: 'panel',
      integration: { kind: 'extension' },
      publishDebounceMs: 0,
    }, false);
    const sockets: Array<Record<string, any>> = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      listeners: Record<string, Function[]> = {};
      constructor() { sockets.push(this); }
      addEventListener(type: string, listener: Function) {
        (this.listeners[type] ||= []).push(listener);
      }
      close() {}
      send() {}
      emit(type: string) {
        for (const listener of this.listeners[type] || []) listener({ type });
      }
    }
    win.WebSocket = FakeWebSocket;

    let exposureCount = 0;
    const exposeDefaultMarkers = win.__CHIPPY.layoutLab.exposeDefaultMarkers;
    win.__CHIPPY.layoutLab.exposeDefaultMarkers = () => {
      exposureCount += 1;
      exposeDefaultMarkers();
    };
    win.eval(PAGE_BRIDGE_SOURCE);

    const panel = win.document.querySelector('[data-layout-lab-panel]') as HTMLElement;
    (panel.querySelector('[aria-label="Open Chippy"]') as HTMLButtonElement).click();
    sockets[0].emit('open');
    await new Promise((resolve) => win.setTimeout(resolve, 400));
    win.__CHIPPY.pageBridge.activate();

    expect(exposureCount).toBe(1);
    expect(panel.getAttribute('data-chippy-panel-expanded')).toBe('true');
    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });

  it('keeps the standalone dock only for Storybook host-panel mode', () => {
    const { dom, win } = openLayoutLab({ ui: 'storybook-panel' });
    const dock = win.document.querySelector('[data-layout-lab-dock]') as HTMLElement;
    const marker = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement;
    expect(win.document.querySelector('[data-layout-lab-panel]')).toBeNull();
    expect(dock).toBeTruthy();
    expect(dock.parentElement).toBe(win.document.body);
    expect(marker.style.display).not.toBe('none');
    expect(win.__CHIPPY.layoutLab.getMarkerState('1').docked).toBe(true);
    dom.window.close();
  });
});
