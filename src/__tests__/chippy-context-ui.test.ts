import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Fiber } from '../layout-lab/fiber-walk';
import { describeContext } from '../layout-lab/marker-context';
import { registerPack, resetPacks } from '../plugins/pack';
import { resetPlugins } from '../plugins';

const LAYOUT_LAB_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/layout-lab.js'),
  'utf8',
);
const PANEL_DOM_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/panel-dom.js'),
  'utf8',
);

type PanelOptions = { config: Record<string, unknown> };

function renderContextPanel({ config }: PanelOptions) {
  const region: Fiber = {
    type: { displayName: 'Region___Checkout___@shop/checkout' },
    memoizedProps: { teamName: 'payments' },
  };
  const boundary: Fiber = {
    type: { name: 'AppErrorBoundary' },
    memoizedProps: {
      id: 'checkout.form',
      packageName: '@shop/checkout',
      fallback: 'flag',
      teamName: 'payments',
    },
    return: region,
  };
  const errorComponent: Fiber = {
    type: { name: 'ErrorComponent' },
    memoizedProps: { message: 'failed' },
    return: boundary,
  };

  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://shop.example.com/checkout',
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
      describeContext,
    },
  };

  win.eval(PANEL_DOM_SOURCE);
  win.eval(LAYOUT_LAB_SOURCE);
  win.__CHIPPY.layoutLab.exposeDefaultMarkers();
  const marker = win.document.querySelector('[data-layout-lab-marker="1"]') as HTMLElement & Record<string, any>;
  marker.__docked = false;
  marker.__probe = {
    _bestFiber: errorComponent,
    best: {
      exact: { domTag: 'div', domText: 'Something went wrong', fiberType: 'div', source: null },
      component: {
        name: 'ErrorComponent',
        props: { message: 'failed' },
        source: null,
        owners: [],
      },
    },
  };
  (win.document.querySelector('[data-chippy-panel-launcher]') as HTMLButtonElement).click();
  win.__CHIPPY.layoutLab.updatePanel();
  return { dom, panel: win.document.querySelector('[data-layout-lab-panel]') as HTMLElement };
}

// A neutral example pack stands in for a product's context plugin.
beforeAll(() => {
  registerPack({
    id: 'regions',
    components: [
      {
        kind: 'region',
        match: { pattern: '^Region___' },
        nameParts: { separator: '___', keys: ['marker', 'name', 'package'] },
        title: ['parts.name'],
        data: { name: 'parts.name', packageName: 'parts.package', teamName: 'props.teamName' },
        fields: [{ label: 'team', value: 'props.teamName' }],
      },
      {
        kind: 'error',
        match: { names: ['AppErrorBoundary'] },
        data: { id: 'props.id', teamName: 'props.teamName' },
        fields: [
          { label: 'team', value: 'props.teamName' },
          { label: 'id', value: 'props.id' },
        ],
      },
    ],
  });
});
afterAll(() => {
  resetPacks();
  resetPlugins();
});

describe('Chippy marker context panel', () => {
  it('renders provider boundaries and provider-chosen error fields by default', () => {
    const { dom, panel } = renderContextPanel({ config: { contextUiEnabled: true } });
    expect(panel.querySelector('[data-chippy-context="1"]')).toBeTruthy();
    expect(panel.querySelector('[data-chippy-boundary-marker="1"][data-chippy-boundary="region"]')).toBeTruthy();
    expect(panel.querySelector('[data-chippy-boundary-marker="1"][data-chippy-boundary="error"]')).toBeTruthy();
    expect(panel.textContent).toContain('Checkout');
    expect(panel.textContent).toContain('checkout.form');
    expect(panel.textContent).toContain('payments');
    expect(panel.textContent).not.toContain('@shop/checkout');
    expect(panel.textContent).not.toContain('flag');
    dom.window.close();
  });

  it('hides marker context when the config is off', () => {
    const { dom, panel } = renderContextPanel({ config: { contextUiEnabled: false } });
    expect(panel.querySelector('[data-chippy-context]')).toBeNull();
    expect(panel.textContent).toContain('ErrorComponent');
    dom.window.close();
  });
});
