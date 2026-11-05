// The page bridge's frame identity and ownership rules. The Storybook manager
// (top frame) and its preview iframe are same-origin and share sessionStorage;
// each bridge must keep its own client id, and an extension bridge must stand
// down when another integration claims its window.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const PAGE_BRIDGE_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/chippy-page-bridge.js'),
  'utf8',
);

type Win = Window & Record<string, any>;

function installFakeSocket(win: Win) {
  const sockets: Array<{ url: string; closed: boolean }> = [];
  win.WebSocket = class {
    url: string;
    closed = false;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    addEventListener() {}
    send() {}
    close() { this.closed = true; }
  };
  return sockets;
}

function startBridge(win: Win, kind: string) {
  const sockets = installFakeSocket(win);
  win.__CHIPPY = { config: { helperBaseUrl: 'http://127.0.0.1:7823', activated: false, integration: { kind } } };
  win.eval(PAGE_BRIDGE_SOURCE);
  return { sockets, bridge: win.__CHIPPY.pageBridge };
}

function storybookPage() {
  const dom = new JSDOM('<!doctype html><body><iframe></iframe><iframe id="preview"></iframe></body>', {
    url: 'http://127.0.0.1:6006/?path=/story/x--default',
    runScripts: 'outside-only',
  });
  const manager = dom.window as unknown as Win;
  const preview = (manager.document.getElementById('preview') as HTMLIFrameElement).contentWindow as unknown as Win;
  return { manager, preview };
}

const liveOwner = (kind: string) => ({ ownerId: `${kind}-owner`, integration: { kind }, heartbeatAt: Date.now(), staleAfterMs: 15_000 });

describe('page bridge frame identity', () => {
  it('gives same-origin frames separate client ids', () => {
    const { manager, preview } = storybookPage();
    const top = startBridge(manager, 'extension').bridge.getState().clientId;
    const framed = startBridge(preview, 'storybook').bridge.getState().clientId;
    expect(framed).not.toBe(top);
    expect(manager.sessionStorage.getItem('__chippyClientId')).toBe(top);
    expect(manager.sessionStorage.getItem('__chippyClientId:1')).toBe(framed);
  });
});

describe('extension bridge ownership', () => {
  it('stands down when another integration claims its window', () => {
    const { manager, preview } = storybookPage();
    const extension = startBridge(manager, 'extension');
    const addon = startBridge(preview, 'storybook');
    expect(extension.sockets).toHaveLength(1);

    manager.__CHIPPY_OWNER__ = liveOwner('storybook');
    manager.dispatchEvent(new manager.CustomEvent('chippy-owner-claimed'));

    expect(extension.sockets[0].closed).toBe(true);
    expect(manager.__CHIPPY.connState).toBe('yielded');
    expect(manager.__CHIPPY.standDown.owner).toEqual({ kind: 'storybook' });
    expect(addon.sockets[0].closed).toBe(false);
  });

  it('does not connect when a live foreign owner already holds the window', () => {
    const { manager } = storybookPage();
    manager.__CHIPPY_OWNER__ = liveOwner('storybook');
    expect(startBridge(manager, 'extension').sockets).toHaveLength(0);
  });

  it('ignores stale owners and claims by another extension', () => {
    const { manager } = storybookPage();
    const extension = startBridge(manager, 'extension');
    manager.__CHIPPY_OWNER__ = { ...liveOwner('storybook'), heartbeatAt: Date.now() - 60_000 };
    manager.dispatchEvent(new manager.CustomEvent('chippy-owner-claimed'));
    manager.__CHIPPY_OWNER__ = liveOwner('extension');
    manager.dispatchEvent(new manager.CustomEvent('chippy-owner-claimed'));
    expect(extension.sockets[0].closed).toBe(false);
  });

  it('keeps a non-extension bridge connected when another owner claims', () => {
    const { manager } = storybookPage();
    const imported = startBridge(manager, 'import');
    manager.__CHIPPY_OWNER__ = liveOwner('storybook');
    manager.dispatchEvent(new manager.CustomEvent('chippy-owner-claimed'));
    expect(imported.sockets[0].closed).toBe(false);
  });
});
