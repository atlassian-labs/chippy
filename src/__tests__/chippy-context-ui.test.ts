import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Fiber } from '../layout-lab/fiber-walk';
import { describeContext, registerContextProvider } from '../layout-lab/marker-context';
import { jiraContextProvider } from '../plugins/jira/context-provider';

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
  const ownership: Fiber = {
    type: { displayName: 'OwnerMark___feature___BenefitModal___jiraEocChangeboarding___flag' },
    memoizedProps: { teamName: 'alexstrasza' },
  };
  const boundary: Fiber = {
    type: { name: 'JSErrorBoundary' },
    memoizedProps: {
      id: 'eoc.changeboarding.benefit.modal',
      packageName: 'jiraEocChangeboarding',
      fallback: 'flag',
      teamName: 'alexstrasza',
    },
    return: ownership,
  };
  const errorComponent: Fiber = {
    type: { name: 'ErrorComponent' },
    memoizedProps: { message: 'failed' },
    return: boundary,
  };

  const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
    url: 'https://example.atlassian.net/jira/software',
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

let unregister: () => void = () => {};
beforeAll(() => {
  unregister = registerContextProvider(jiraContextProvider);
});
afterAll(() => unregister());

describe('Chippy marker context panel', () => {
  it('renders provider boundaries and provider-chosen error fields by default', () => {
    const { dom, panel } = renderContextPanel({ config: { contextUiEnabled: true } });
    expect(panel.querySelector('[data-chippy-context="1"]')).toBeTruthy();
    expect(panel.querySelector('[data-chippy-boundary-marker="1"][data-chippy-boundary="owner"]')).toBeTruthy();
    expect(panel.querySelector('[data-chippy-boundary-marker="1"][data-chippy-boundary="error"]')).toBeTruthy();
    expect(panel.textContent).toContain('BenefitModal');
    expect(panel.textContent).toContain('eoc.changeboarding.benefit.modal');
    expect(panel.textContent).toContain('alexstrasza');
    expect(panel.textContent).not.toContain('jiraEocChangeboarding');
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
