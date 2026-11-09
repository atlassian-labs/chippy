import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const background = readFileSync('.agents/skills/chippy/extension/background.js', 'utf8');

type ExecuteCall = { target?: { tabId: number; frameIds?: number[] }; files?: string[]; func?: Function; args?: unknown[] };

function loadBackground(enabledOrigins: Record<string, boolean>, topUrl = 'https://top.test/page') {
  const executeCalls: ExecuteCall[] = [];
  const runtimeListeners: Function[] = [];
  const committedListeners: Function[] = [];
  const chrome = {
    scripting: {
      executeScript: async (call: ExecuteCall) => {
        executeCalls.push(call);
        // Owner probe: no live owner in the frame.
        if (typeof call.func === 'function' && !call.args) return [{ result: null }];
        return [];
      },
    },
    runtime: { onMessage: { addListener: (l: Function) => runtimeListeners.push(l) } },
    webNavigation: { onCommitted: { addListener: (l: Function) => committedListeners.push(l) } },
    tabs: { get: async () => ({ url: topUrl }), onUpdated: { addListener: () => undefined } },
    storage: { local: { get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', enabledOrigins }) } },
  };
  runInNewContext(background, {
    importScripts: () => undefined,
    AbortSignal, URL, Date, chrome, console,
    fetch: async () => { throw new Error('offline test'); },
  });
  async function send(message: unknown, sender: unknown) {
    let response: unknown = null;
    runtimeListeners[0](message, sender, (r: unknown) => { response = r; });
    for (let i = 0; i < 20 && response == null; i += 1) await new Promise((r) => setTimeout(r, 0));
    return response as Record<string, unknown>;
  }
  return { executeCalls, committed: (d: unknown) => committedListeners[0](d), send };
}

const bundleRequest = { type: 'chippy-inject-bundle', helperBaseUrl: 'http://127.0.0.1:7823' };

describe('extension per-frame injection', () => {
  it('injects the bundle only into the iframe whose own origin is enabled', async () => {
    const ext = loadBackground({ 'https://frame.test': true });
    const response = await ext.send(bundleRequest, {
      tab: { id: 42 }, frameId: 3, url: 'https://frame.test/embed', origin: 'https://frame.test',
    });
    expect(response).toMatchObject({ ok: true });
    const bridge = ext.executeCalls.filter((c) => c.files?.includes('chippy-page-bridge.js'));
    expect(bridge).toHaveLength(1);
    expect(bridge[0].target).toEqual({ tabId: 42, frameIds: [3] });
    // Nothing is injected into the top frame or across all frames.
    expect(ext.executeCalls.every((c) => c.target?.frameIds?.[0] === 3)).toBe(true);
  });

  it('refuses a content-script request from a frame whose origin is not enabled', async () => {
    const ext = loadBackground({ 'https://frame.test': true });
    const response = await ext.send(bundleRequest, {
      tab: { id: 42 }, frameId: 0, url: 'https://top.test/page', origin: 'https://top.test',
    });
    expect(response).toMatchObject({ ok: false, step: 'origin-disabled' });
    expect(ext.executeCalls).toHaveLength(0);
  });

  it('refuses a content-script request from an opaque-origin frame', async () => {
    const ext = loadBackground({ 'https://frame.test': true });
    const response = await ext.send(bundleRequest, { tab: { id: 42 }, frameId: 5, url: 'about:srcdoc', origin: 'null' });
    expect(response).toMatchObject({ ok: false, step: 'origin-disabled' });
    expect(ext.executeCalls).toHaveLength(0);
  });

  it('runs early startup in an enabled iframe on navigation, gated by the iframe origin', async () => {
    const ext = loadBackground({ 'https://frame.test': true });
    await ext.committed({ tabId: 42, frameId: 3, url: 'https://frame.test/embed' });
    const shim = ext.executeCalls.find((c) => c.files?.includes('devtools-hook-shim.js'));
    expect(shim?.target).toEqual({ tabId: 42, frameIds: [3] });
    const config = ext.executeCalls.find((c) => c.args)?.args?.[0] as { helperBaseUrl?: string } | undefined;
    expect(config?.helperBaseUrl).toBe('http://127.0.0.1:7823');
  });

  it('skips early startup in an iframe whose origin is not enabled, even under an enabled top page', async () => {
    const ext = loadBackground({ 'https://top.test': true });
    await ext.committed({ tabId: 42, frameId: 3, url: 'https://frame.test/embed' });
    expect(ext.executeCalls).toHaveLength(0);
  });

  it('keeps targeting the top frame for popup requests that name a tab', async () => {
    const ext = loadBackground({ 'https://top.test': true });
    await ext.send({ ...bundleRequest, tabId: 42 }, {});
    const bridge = ext.executeCalls.find((c) => c.files?.includes('chippy-page-bridge.js'));
    expect(bridge?.target).toEqual({ tabId: 42 });
  });
});
