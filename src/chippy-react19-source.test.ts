import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const PAGE_BRIDGE_SOURCE = readFileSync(
  resolve(__dirname, '../.agents/skills/chippy/extension/chippy-page-bridge.js'),
  'utf8',
);

describe('React 19 source resolution at the bridge boundary', () => {
  it('recognizes _debugStack as dev evidence and republishes mapped probe sources', async () => {
    const sent: string[] = [];
    const dom = new JSDOM('<!doctype html><html><body><button>Badge</button></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=react-19',
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

    const componentFiber = {
      type: function Badge() {},
      _debugStack: { stack: 'Error\n    at Badge (http://127.0.0.1:6007/src/Badge.tsx:18:12)' },
    };
    const hostFiber = {
      type: 'button',
      _debugStack: { stack: 'Error\n    at Badge (http://127.0.0.1:6007/src/Badge.tsx:7:3)' },
      return: componentFiber,
    };
    const button = win.document.querySelector('button') as unknown as HTMLElement & Record<string, unknown>;
    button.__reactFiber$test = hostFiber;

    win.__CHIPPY = {
      config: { activated: true },
      layoutLab: {
        getAllMarkerStates: () => ({ '1': { docked: false } }),
        getMarkerProbe: () => ({ probe: { _bestFiber: componentFiber, _targetEl: button } }),
        getCommonParentInspection: () => null,
      },
      resolveProbesCompact: () => ({
        '1': {
          confidence: 'dev',
          note: null,
          dom: { source: { fileName: 'http://127.0.0.1:6007/src/Badge.tsx', lineNumber: 7, columnNumber: 3 } },
          component: {
            source: { fileName: 'http://127.0.0.1:6007/src/Badge.tsx', lineNumber: 18, columnNumber: 12 },
            owners: [],
            parents: [],
          },
        },
      }),
    };
    win.__AVALANCHE__ = {
      layoutLab: {
        getNearestFiber: () => hostFiber,
        getOwnerFibers: () => [],
        getReturnComponentFibers: () => [],
        describeJiraContext: () => null,
        resolveFiberSource: async (fiber: unknown) => fiber === hostFiber
          ? { fileName: 'src/Badge.tsx', lineNumber: 5, columnNumber: 3 }
          : { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 7 },
      },
      bridge: { readAvalancheStatus: () => ({ ok: true, available: true }) },
    };

    win.eval(PAGE_BRIDGE_SOURCE);
    expect(win.__CHIPPY.pageBridge.publishSnapshot('react-19-test')).toBe(true);
    await new Promise((done) => win.setTimeout(done, 0));

    const snapshots = sent.map((message) => JSON.parse(message)).filter((message) => message.type === 'snapshot');
    expect(snapshots[0]?.buildMode).toBe('dev');
    expect(snapshots.at(-1)).toMatchObject({
      reason: 'react-19-test-source-resolved',
      snapshot: {
        markers: {
          '1': {
            resolved: {
              dom: { source: { fileName: 'src/Badge.tsx', lineNumber: 5, columnNumber: 3 } },
              component: { source: { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 7 } },
            },
          },
        },
      },
    });

    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });

  it('awaits name-based mapping and describes the same fiber selected before the fetch', async () => {
    const sent: string[] = [];
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=react-19-describe',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    let socket: { emit(type: string, event: unknown): void } | null = null;
    let mapped = false;
    const firstFiber = { type: function App() {} };
    const replacementFiber = { type: function App() {} };

    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      listeners = new Map<string, Array<(event: any) => void>>();
      constructor() { socket = this; }
      addEventListener(type: string, listener: (event: any) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      emit(type: string, event: unknown) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
      close() {}
      send(message: string) { sent.push(message); }
    }
    win.WebSocket = FakeWebSocket;
    win.__CHIPPY = {
      config: { activated: false },
      layoutLab: { getAllMarkerStates: () => ({}), getCommonParentInspection: () => null },
    };
    win.__AVALANCHE__ = {
      layoutLab: { describeJiraContext: () => null },
      bridge: {
        findFiberByName: () => mapped ? replacementFiber : firstFiber,
        resolveFiberSource: async () => {
          await Promise.resolve();
          mapped = true;
        },
        evalDescribeComponent: (fiberId: unknown, name: unknown, deps: Record<string, any>) => {
          const target = deps.resolveFiberTarget(null, fiberId, name);
          return {
            ok: true,
            source: target.fiber === firstFiber
              ? { fileName: 'src/App.tsx', lineNumber: 12 }
              : { fileName: 'http://host/src/Replacement.tsx', lineNumber: 18 },
          };
        },
        readAvalancheStatus: () => ({ ok: true, available: true }),
      },
    };

    win.eval(PAGE_BRIDGE_SOURCE);
    socket?.emit('message', {
      data: JSON.stringify({
        type: 'command',
        command: { type: 'describe-component', requestId: 'r19', name: 'App' },
      }),
    });
    await new Promise((done) => win.setTimeout(done, 0));

    const result = sent.map((message) => JSON.parse(message)).find((message) => message.requestId === 'r19');
    expect(result?.result?.source).toEqual({ fileName: 'src/App.tsx', lineNumber: 12 });

    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });

  it('maps the P3 common-parent fiber, component, owner, and parent sources', async () => {
    const sent: string[] = [];
    const dom = new JSDOM('<!doctype html><html><body><section></section></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=react-19-common-parent',
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

    const section = win.document.querySelector('section');
    const parentFiber = { type: function Parent() {} };
    const ownerFiber = { type: function Owner() {} };
    const componentFiber = { type: function Shared() {}, return: parentFiber, _debugOwner: ownerFiber };
    const hostFiber = { type: 'section', stateNode: section, return: componentFiber };
    const firstFiber = { type: function First() {}, return: hostFiber };
    const secondFiber = { type: function Second() {}, return: hostFiber };
    const rawSource = { fileName: 'http://host/src/generated.js', lineNumber: 8, columnNumber: 4 };
    const described = (name: string) => ({
      type: name,
      elementType: name,
      key: null,
      memoizedPropsKeys: [],
      debugSource: rawSource,
    });

    win.__CHIPPY = {
      config: { activated: true },
      layoutLab: {
        getAllMarkerStates: () => ({ '1': { docked: false }, '2': { docked: false } }),
        getMarkerProbe: (id: string) => ({ probe: { _bestFiber: id === '1' ? firstFiber : secondFiber } }),
        getCommonParentInspection: () => ({
          dom: { tagName: 'section', text: '' },
          fiber: described('section'),
          component: described('Shared'),
          owners: [described('Owner')],
          returns: [described('Parent')],
          nearestTestIdParent: null,
        }),
      },
      resolveProbesCompact: () => ({}),
    };
    const mapped = new Map<unknown, string>([
      [hostFiber, 'src/Host.tsx'],
      [componentFiber, 'src/Shared.tsx'],
      [ownerFiber, 'src/Owner.tsx'],
      [parentFiber, 'src/Parent.tsx'],
    ]);
    win.__AVALANCHE__ = {
      layoutLab: {
        getNearestFiber: () => hostFiber,
        getNearestComponent: () => componentFiber,
        getOwnerFibers: () => [ownerFiber],
        getReturnComponentFibers: () => [parentFiber],
        describeJiraContext: () => null,
        resolveFiberSource: async (fiber: unknown) => ({
          fileName: mapped.get(fiber),
          lineNumber: 2,
          columnNumber: 3,
        }),
      },
      bridge: { readAvalancheStatus: () => ({ ok: true, available: true }) },
    };

    win.eval(PAGE_BRIDGE_SOURCE);
    expect(win.__CHIPPY.pageBridge.publishSnapshot('common-parent')).toBe(true);
    await new Promise((done) => win.setTimeout(done, 0));

    const resolved = sent
      .map((message) => JSON.parse(message))
      .find((message) => message.reason === 'common-parent-source-resolved')
      ?.snapshot?.markers?.['3']?.resolved;
    expect(resolved).toMatchObject({
      dom: { source: { fileName: 'src/Host.tsx' } },
      component: {
        source: { fileName: 'src/Shared.tsx' },
        owners: [{ source: { fileName: 'src/Owner.tsx' } }],
        parents: [{ source: { fileName: 'src/Parent.tsx' } }],
      },
    });

    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });

  it('does not republish a stale mapped snapshot after a newer snapshot', async () => {
    const sent: string[] = [];
    const dom = new JSDOM('<!doctype html><html><body><button>Badge</button></body></html>', {
      url: 'http://127.0.0.1:6007/iframe.html?id=react-19-race',
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

    const componentFiber = {
      type: function Badge() {},
      _debugStack: { stack: 'Error\n    at Badge (http://127.0.0.1:6007/src/Badge.tsx:18:12)' },
    };
    let releaseFirst: (() => void) | null = null;
    let sourceCall = 0;
    win.__CHIPPY = {
      config: { activated: true },
      layoutLab: {
        getAllMarkerStates: () => ({ '1': { docked: false } }),
        getMarkerProbe: () => ({ probe: { _bestFiber: componentFiber } }),
        getCommonParentInspection: () => null,
      },
      resolveProbesCompact: () => ({
        '1': {
          confidence: 'dev',
          note: null,
          dom: { source: null },
          component: {
            source: { fileName: 'http://127.0.0.1:6007/src/Badge.tsx', lineNumber: 18, columnNumber: 12 },
            owners: [],
            parents: [],
          },
        },
      }),
    };
    win.__AVALANCHE__ = {
      layoutLab: {
        getOwnerFibers: () => [],
        getReturnComponentFibers: () => [],
        describeJiraContext: () => null,
        resolveFiberSource: () => {
          sourceCall += 1;
          if (sourceCall === 1) {
            return new Promise((resolveSource) => {
              releaseFirst = () => resolveSource({ fileName: 'src/Old.tsx', lineNumber: 1, columnNumber: 1 });
            });
          }
          return Promise.resolve({ fileName: 'src/New.tsx', lineNumber: 2, columnNumber: 2 });
        },
      },
      bridge: { readAvalancheStatus: () => ({ ok: true, available: true }) },
    };

    win.eval(PAGE_BRIDGE_SOURCE);
    expect(win.__CHIPPY.pageBridge.publishSnapshot('old')).toBe(true);
    expect(win.__CHIPPY.pageBridge.publishSnapshot('new')).toBe(true);
    await new Promise((done) => win.setTimeout(done, 0));
    releaseFirst?.();
    await new Promise((done) => win.setTimeout(done, 0));

    const reasons = sent
      .map((message) => JSON.parse(message))
      .filter((message) => message.type === 'snapshot')
      .map((message) => message.reason);
    expect(reasons).toContain('new-source-resolved');
    expect(reasons).not.toContain('old-source-resolved');

    win.__CHIPPY.pageBridge.destroy();
    dom.window.close();
  });
});
