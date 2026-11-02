import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { normalizeProbeAnnotation } from '../layout-lab/probe-intent';

const PANEL_DOM_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/panel-dom.js'),
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

function openPanel() {
  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  win.__CHIPPY = { config: { ui: 'panel' }, connState: 'connected' };
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
  win.eval(PANEL_DOM_SOURCE);
  win.eval(LAYOUT_LAB_SOURCE);
  win.__CHIPPY.layoutLab.exposeDefaultMarkers();
  const marker = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement & Record<string, any>;
  marker.__docked = false;
  marker.__probe = {
    best: {
      exact: { domTag: 'main', domText: 'fixture', fiberType: 'main', source: null },
      component: { name: 'ExampleCard', props: {}, source: null, owners: [] },
    },
  };
  (win.document.querySelector('[data-chippy-panel-launcher]') as HTMLButtonElement).click();
  win.__CHIPPY.layoutLab.updatePanel();
  return { dom, win };
}

describe('Chippy in-page probe annotation', () => {
  it('preserves control identity, focus, and draft values across panel refreshes', () => {
    const { dom, win } = openPanel();
    const intent = win.document.querySelector('[aria-label="P1 intent"]') as HTMLSelectElement;
    const comment = win.document.querySelector('[aria-label="P1 comment"]') as HTMLTextAreaElement;

    intent.focus();
    intent.value = 'investigate';
    win.__CHIPPY.layoutLab.updatePanel();
    expect(win.document.querySelector('[aria-label="P1 intent"]')).toBe(intent);
    expect(win.document.activeElement).toBe(intent);
    expect(intent.value).toBe('investigate');

    comment.focus();
    comment.value = 'Unsubmitted draft';
    win.__CHIPPY.connState = 'reconnecting';
    win.__CHIPPY.layoutLab.updatePanel();
    expect(win.document.querySelector('[aria-label="P1 comment"]')).toBe(comment);
    expect(win.document.activeElement).toBe(comment);
    expect(comment.value).toBe('Unsubmitted draft');

    dom.window.close();
  });

  it('commits intent on change and comment on Enter without an attach button', () => {
    const { dom, win } = openPanel();
    const events: Array<Record<string, unknown>> = [];
    win.addEventListener('layout-lab:update', (event: Event) => {
      events.push((event as CustomEvent).detail);
    });

    const intent = win.document.querySelector('[aria-label="P1 intent"]') as HTMLSelectElement;
    const comment = win.document.querySelector('[aria-label="P1 comment"]') as HTMLTextAreaElement;
    expect(win.document.querySelector('[data-chippy-probe-attach="1"]')).toBeNull();

    comment.value = 'Move this card below the summary.';
    intent.value = 'change';
    intent.dispatchEvent(new win.Event('change', { bubbles: true }));

    expect(win.__CHIPPY.layoutLab.getMarkerState('1')).toMatchObject({
      id: '1',
      intent: 'change',
      comment: 'Move this card below the summary.',
    });
    expect(win.__CHIPPY.layoutLab.getMarkerProbe('1')).toMatchObject({
      id: '1',
      intent: 'change',
      comment: 'Move this card below the summary.',
    });
    expect(events.at(-1)).toMatchObject({
      reason: 'marker-annotation-change',
      markerId: '1',
      intent: 'change',
      comment: 'Move this card below the summary.',
    });

    const committedEventCount = events.length;
    comment.value = 'Keep this line\nand add another.';
    comment.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(events).toHaveLength(committedEventCount);

    comment.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    expect(win.__CHIPPY.layoutLab.getMarkerState('1')).toMatchObject({
      id: '1',
      intent: 'change',
      comment: 'Keep this line\nand add another.',
    });
    expect(events.at(-1)).toMatchObject({
      reason: 'marker-annotation-change',
      markerId: '1',
      intent: 'change',
      comment: 'Keep this line\nand add another.',
    });
    dom.window.close();
  });

  it('serializes the required annotation fields into an agent-facing snapshot', () => {
    const sent: string[] = [];
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=example',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      addEventListener() {}
      close() {}
      send(message: string) { sent.push(message); }
    }
    win.WebSocket = FakeWebSocket;
    win.__CHIPPY = {
      config: { activated: true },
      layoutLab: {
        exposeDefaultMarkers: () => {},
        removeInPageUi: () => {},
        getAllMarkerStates: () => ({
          '1': {
            position: { x: 10, y: 20 },
            docked: false,
            intent: 'investigate',
            comment: 'Why does this rerender?',
          },
        }),
        getMarkerProbe: () => null,
        getCommonParentInspection: () => null,
      },
      resolveProbesCompact: () => ({ '1': null }),
    };
    win.__AVALANCHE__ = {
      layoutLab: { describeJiraContext: () => null },
      bridge: { readAvalancheStatus: () => ({ ok: true, available: true }) },
    };
    win.eval(PAGE_BRIDGE_SOURCE);

    expect(win.__CHIPPY.pageBridge.publishSnapshot('annotation-test')).toBe(true);
    const payload = JSON.parse(sent.at(-1) || '{}');
    expect(payload).toMatchObject({
      type: 'snapshot',
      reason: 'annotation-test',
      snapshot: {
        markers: {
          '1': {
            position: { x: 10, y: 20 },
            docked: false,
            intent: 'investigate',
            comment: 'Why does this rerender?',
          },
        },
      },
    });

    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });
});
