import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const background = readFileSync('.agents/skills/chippy/extension/background.js', 'utf8');

type ExecuteCall = { files?: string[]; func?: (...args: unknown[]) => unknown; args?: unknown[] };

// Runs background.js with MAIN-world functions evaluated against one fake page,
// so `globalThis.__AVALANCHE__` and `window.__CHIPPY` read the same state the
// late injection would find in a real tab.
function loadBackground({ hasRuntime }: { hasRuntime: boolean }) {
  const executeCalls: ExecuteCall[] = [];
  const runtimeListeners: Function[] = [];
  const page: Record<string, unknown> = {};
  const context: Record<string, unknown> = {
    importScripts: () => undefined,
    AbortSignal, URL, Date, console,
    fetch: async () => { throw new Error('offline test'); },
    window: page,
  };
  if (hasRuntime) context.__AVALANCHE__ = { status: () => ({ installed: true }) };
  context.chrome = {
    scripting: {
      executeScript: async (call: ExecuteCall) => {
        executeCalls.push(call);
        if (typeof call.func === 'function') return [{ result: call.func(...(call.args || [])) ?? null }];
        return [];
      },
    },
    runtime: { onMessage: { addListener: (l: Function) => runtimeListeners.push(l) } },
    webNavigation: { onCommitted: { addListener: () => undefined } },
    tabs: { get: async () => ({ url: 'https://example.test/page' }), onUpdated: { addListener: () => undefined } },
    storage: { local: { get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', enabledOrigins: { 'https://example.test': true } }) } },
  };
  runInNewContext(background, context);
  async function enableOpenTab() {
    let response: unknown = null;
    runtimeListeners[0]({ type: 'chippy-inject-bundle', tabId: 42 }, {}, (r: unknown) => { response = r; });
    for (let i = 0; i < 20 && response == null; i += 1) await new Promise((r) => setTimeout(r, 0));
    return response as Record<string, unknown>;
  }
  const files = () => executeCalls.flatMap((call) => call.files || []);
  return { enableOpenTab, files };
}

describe('enabling Chippy on a tab that is already open', () => {
  it('loads the Avalanche runtime before the bridge when early startup never ran', async () => {
    const ext = loadBackground({ hasRuntime: false });
    expect(await ext.enableOpenTab()).toMatchObject({ ok: true });
    const files = ext.files();
    expect(files.filter((file) => file === 'avalanche.iife.js')).toHaveLength(1);
    expect(files.indexOf('avalanche.iife.js')).toBeLessThan(files.indexOf('chippy-page-bridge.js'));
    // Pre-React scripts do nothing useful once the page has rendered.
    expect(files).not.toContain('devtools-hook-shim.js');
    expect(files).not.toContain('early-bootstrap.js');
  });

  it('keeps the runtime that early startup already loaded', async () => {
    const ext = loadBackground({ hasRuntime: true });
    expect(await ext.enableOpenTab()).toMatchObject({ ok: true });
    expect(ext.files()).not.toContain('avalanche.iife.js');
    expect(ext.files()).toContain('chippy-page-bridge.js');
  });
});
