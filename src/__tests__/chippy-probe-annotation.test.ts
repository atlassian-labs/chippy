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
      describeContext: () => null,
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

  it('sends Explain and Investigate when chosen, and Change only on Enter', () => {
    const { dom, win } = openPanel();
    const events: Array<Record<string, unknown>> = [];
    win.addEventListener('layout-lab:update', (event: Event) => {
      events.push((event as CustomEvent).detail);
    });

    const intent = win.document.querySelector('[aria-label="P1 intent"]') as HTMLSelectElement;
    const comment = win.document.querySelector('[aria-label="P1 comment"]') as HTMLTextAreaElement;
    expect(win.document.querySelector('[data-chippy-probe-attach="1"]')).toBeNull();

    const status = () => win.document.querySelector('[data-chippy-probe-annotation-status="1"]')?.textContent;
    intent.value = 'change';
    intent.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(events.filter((event) => event.reason === 'marker-annotation-change')).toHaveLength(0);
    expect(win.__CHIPPY.layoutLab.getMarkerState('1')).toMatchObject({ intent: null, annotationStatus: null });
    expect(status()).toBe('Not sent. Press Enter in the comment to send.');
    win.__CHIPPY.layoutLab.updatePanel();
    expect(status()).toBe('Not sent. Press Enter in the comment to send.');

    comment.value = 'Move this card below the summary.';
    comment.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(status()).toBe('Queued for the agent.');

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

    intent.value = 'investigate';
    intent.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(events.at(-1)).toMatchObject({ reason: 'marker-annotation-change', intent: 'investigate' });
    expect(win.__CHIPPY.layoutLab.getMarkerState('1')).toMatchObject({ intent: 'investigate', annotationStatus: 'queued' });
    dom.window.close();
  });

  it('shows a queued annotation and clears it only when the agent handled that exact note', () => {
    const { dom, win } = openPanel();
    const events: Array<Record<string, unknown>> = [];
    win.addEventListener('layout-lab:update', (event: Event) => {
      events.push((event as CustomEvent).detail);
    });
    const lab = win.__CHIPPY.layoutLab;
    const status = () => win.document.querySelector('[data-chippy-probe-annotation-status="1"]')?.textContent;
    const intent = win.document.querySelector('[aria-label="P1 intent"]') as HTMLSelectElement;
    const comment = win.document.querySelector('[aria-label="P1 comment"]') as HTMLTextAreaElement;
    expect(status()).toMatch(/For Change, describe it and press Enter/);

    comment.value = 'click it?';
    intent.value = 'change';
    comment.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(lab.getMarkerState('1')).toMatchObject({ intent: 'change', comment: 'click it?', annotationStatus: 'queued' });
    expect(status()).toBe('Queued for the agent.');

    // The user replaced the note before the agent finished: the stale clear is refused.
    lab.setMarkerAnnotation('1', { comment: 'rename beta' });
    expect(lab.clearMarkerAnnotation('1', { intent: 'change', comment: 'click it?' })).toMatchObject({
      ok: false,
      reason: 'annotation-changed',
    });
    expect(lab.getMarkerState('1')).toMatchObject({ comment: 'rename beta', annotationStatus: 'queued' });

    expect(lab.clearMarkerAnnotation('1', { intent: 'change', comment: 'rename beta' })).toEqual({ ok: true, id: '1' });
    expect(lab.getMarkerState('1')).toMatchObject({ intent: null, comment: '', annotationStatus: 'done' });
    expect(intent.value).toBe('');
    expect(comment.value).toBe('');
    expect(status()).toBe('Done. The agent handled the last note.');
    expect(events.at(-1)).toMatchObject({ reason: 'marker-annotation-cleared', markerId: '1' });
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
      layoutLab: { describeContext: () => null },
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
