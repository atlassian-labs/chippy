import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { ContextCard } from '../../.storybook/chippy-addon/context-card.jsx';

const PAGE_BRIDGE_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/chippy-page-bridge.js'),
  'utf8',
);
const STORYBOOK_MANAGER_SOURCE = readFileSync(
  resolve(__dirname, '../../.storybook/chippy-addon/manager.jsx'),
  'utf8',
);
const STORYBOOK_PREVIEW_SOURCE = readFileSync(
  resolve(__dirname, '../../.storybook/chippy-addon/preview.js'),
  'utf8',
);
const HELPER_SERVER_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy-helper-server.js'),
  'utf8',
);

afterEach(cleanup);

const markerContext = {
  boundaries: {
    owner: { name: 'BenefitModal', packageName: 'jiraEocChangeboarding', distance: 0 },
    error: { componentName: 'JSErrorBoundary', id: 'eoc.changeboarding.benefit.modal', teamName: 'alexstrasza', distance: 1 },
    suspense: { componentName: 'Suspense', distance: 2 },
  },
  display: {
    kinds: [{ kind: 'owner', label: 'owner', accent: '#0c66e4' }],
    titles: { owner: 'BenefitModal' },
    fields: { error: [{ label: 'team', value: 'alexstrasza' }, { label: 'id', value: 'eoc.changeboarding.benefit.modal' }] },
    showError: true,
  },
  providers: ['jira'],
};

describe('Chippy Storybook marker context', () => {
  it('inspect-boundary is consumed end-to-end by addon, bridge, and helper', () => {
    expect(STORYBOOK_PREVIEW_SOURCE).toContain("case 'inspect-boundary':");
    expect(STORYBOOK_PREVIEW_SOURCE).toContain('boundaryKind: command.boundaryKind');
    expect(PAGE_BRIDGE_SOURCE).toContain("reason === 'inspect-boundary'");
    expect(PAGE_BRIDGE_SOURCE).toContain("sendActivity('inspect-boundary'");
    expect(HELPER_SERVER_SOURCE).toContain("msg.activity.reason === 'inspect-boundary'");
    expect(HELPER_SERVER_SOURCE).toContain('client.lastInspectedBoundary');
    expect(HELPER_SERVER_SOURCE).toContain('lastInspectedBoundary: client.lastInspectedBoundary');
  });

  it('renders provider and error-boundary facts from the provider display', () => {
    const { rerender } = render(<ContextCard context={markerContext} />);

    // Owner lozenge is the semantic/team owner, labelled "owner" (not "Jira owner",
    // and not the React render owner).
    expect(screen.getByTestId('chippy-boundary-owner')).toHaveTextContent('owner');
    expect(screen.getByTestId('chippy-boundary-owner')).not.toHaveTextContent('Jira owner');
    expect(screen.getByTestId('chippy-boundary-owner')).toHaveTextContent('BenefitModal');
    // Owner is a compact lozenge: it does NOT dump package/team (those belong to the error boundary).
    expect(screen.getByTestId('chippy-boundary-owner')).not.toHaveTextContent('package');
    // Error boundary now shows only team + id (Sentry key); package/fallback dropped.
    expect(screen.getByTestId('chippy-boundary-error')).toHaveTextContent('eoc.changeboarding.benefit.modal');
    expect(screen.getByTestId('chippy-boundary-error')).toHaveTextContent('alexstrasza');
    expect(screen.getByTestId('chippy-boundary-error')).not.toHaveTextContent('package');
    expect(screen.getByTestId('chippy-boundary-error')).not.toHaveTextContent('fallback');
    // Suspense boundary is now surfaced with its hop distance.
    expect(screen.getByTestId('chippy-boundary-suspense')).toHaveTextContent('suspense boundary');
    expect(screen.getByTestId('chippy-boundary-error')).toHaveTextContent('1 hop');
    expect(screen.getByTestId('chippy-boundary-suspense')).toHaveTextContent('2 hops');
    // With an inspect callback the blocks are clickable buttons wired to the backend.
    expect(STORYBOOK_MANAGER_SOURCE).toContain('onInspectBoundary={inspectBoundary}');
    expect(STORYBOOK_MANAGER_SOURCE).toContain("command('inspect-boundary'");

    rerender(<ContextCard context={null} />);
    expect(screen.queryByTestId('chippy-context')).not.toBeInTheDocument();
  });

  it('fires onInspectBoundary with the boundary kind when a block is clicked', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const seen: string[] = [];
    render(<ContextCard context={markerContext} onInspectBoundary={(kind: string) => seen.push(kind)} />);

    fireEvent.click(screen.getByTestId('chippy-boundary-owner'));
    fireEvent.click(screen.getByTestId('chippy-boundary-error'));
    fireEvent.click(screen.getByTestId('chippy-boundary-suspense'));

    expect(seen).toEqual(['owner', 'error', 'suspense']);
    // All three boundary blocks are actual buttons when a callback is provided.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    // The last-clicked block is marked selected (persistent visual feedback).
    expect(screen.getByTestId('chippy-boundary-suspense')).toHaveAttribute(
      'data-chippy-boundary-selected',
      'true',
    );
  });

  it('serializes marker context into each active Storybook marker state', () => {
    const dom = new JSDOM('<!doctype html><html><body><main>fixture</main></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    const fiber = { type: { name: 'BenefitModal' } };

    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      addEventListener() {}
      close() {}
      send() {}
    }

    win.WebSocket = FakeWebSocket;
    win.__CHIPPY = {
      config: { ui: 'storybook-panel', activated: false, contextUiEnabled: true },
      layoutLab: {
        getAllMarkerStates: () => ({
          '1': { position: { x: 30, y: 40 }, docked: false },
          '2': { position: null, docked: true },
        }),
        getMarkerProbe: (id: string) => id === '1' ? { probe: { _bestFiber: fiber } } : null,
        getCommonParentInspection: () => null,
        removeInPageUi: () => {},
      },
      resolveProbesCompact: () => ({
        '1': {
          confidence: 'dev',
          nearestTestId: null,
          dom: { tag: 'div', text: 'Benefit', source: null, parents: [], matchedStyles: [] },
          component: { name: 'BenefitModal', owners: [], parents: [] },
          note: null,
        },
      }),
    };
    win.__AVALANCHE__ = {
      layoutLab: { describeContext: () => markerContext },
      bridge: { readAvalancheStatus: () => ({ ok: true, available: true }) },
    };

    win.eval(PAGE_BRIDGE_SOURCE);
    const bridge = win.__CHIPPY.pageBridge;

    expect(bridge.getState().markers['1'].context).toEqual(markerContext);
    expect(bridge.getState().markers['1']).not.toHaveProperty('jiraContext');
    expect(bridge.getState().markers['2'].context).toBeNull();

    bridge.applyConfig({ contextUiEnabled: false });
    expect(bridge.getState().markers['1'].context).toBeNull();
    bridge.applyConfig({ contextUiEnabled: true });
    expect(bridge.getState().markers['1'].context).toEqual(markerContext);

    bridge.destroy();
    dom.window.close();
  });
});
