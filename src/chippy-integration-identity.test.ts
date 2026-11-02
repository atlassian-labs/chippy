import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const background = readFileSync('.agents/skills/chippy/extension/background.js', 'utf8');
const helper = readFileSync('.agents/skills/chippy/scripts/chippy-helper-server.js', 'utf8');
const storybook = readFileSync('.storybook/chippy-addon/setup.js', 'utf8');

describe('Chippy integration identities', () => {
  it.each([
    {
      name: 'extension',
      source: background,
      kind: 'extension',
      who: 'Chippy browser extension',
      sourceFile: '.agents/skills/chippy/extension/background.js',
      reinjectsOnReload: true,
    },
    {
      name: 'import',
      source: helper,
      kind: 'import',
      who: 'Chippy helper module import',
      sourceFile: '.agents/skills/chippy/scripts/chippy-helper-server.js',
      reinjectsOnReload: false,
    },
    {
      name: 'storybook',
      source: storybook,
      kind: 'storybook',
      who: 'Chippy Storybook addon',
      sourceFile: '.storybook/chippy-addon/setup.js',
      reinjectsOnReload: true,
    },
  ])('$name declares who owns the integration and its reload behavior', (integration) => {
    expect(integration.source).toContain(`kind: '${integration.kind}'`);
    expect(integration.source).toContain(`who: '${integration.who}'`);
    expect(integration.source).toContain(`source: '${integration.sourceFile}'`);
    expect(integration.source).toContain(`reinjectsOnReload: ${integration.reinjectsOnReload}`);
    expect(integration.source).toContain('reloadAction:');
  });

  it('stamps __CHIPPY_OWNER__ with the extension integration during early startup', async () => {
    const executeCalls: Array<{ args?: unknown[]; files?: string[]; func?: Function }> = [];
    const committedListeners: Function[] = [];
    let runtimeMessageListener: Function | null = null;
    const pageWindow: Record<string, unknown> = {};
    const chrome = {
      scripting: {
        executeScript: async (call: { args?: unknown[]; files?: string[]; func?: Function }) => {
          executeCalls.push(call);
          // owner probe: no live owner yet
          if (typeof call.func === 'function' && !call.args) return [{ result: null }];
          // run any MAIN-world func against our fake page window
          if (typeof call.func === 'function' && call.args) {
            (call.func as (...a: unknown[]) => void).apply(
              { window: pageWindow } as unknown,
              call.args,
            );
          }
          return [];
        },
      },
      runtime: { onMessage: { addListener: (l: Function) => { runtimeMessageListener = l; } } },
      webNavigation: { onCommitted: { addListener: (l: Function) => committedListeners.push(l) } },
      tabs: { get: async () => ({ url: 'https://example.test/page' }), onUpdated: { addListener: () => undefined } },
      storage: { local: { get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', enabledOrigins: { 'https://example.test': true } }) } },
    };

    runInNewContext(background, {
      AbortSignal, URL, Date, chrome, console,
      fetch: async () => { throw new Error('offline test'); },
      window: pageWindow,
    });

    await committedListeners[0]({ frameId: 0, tabId: 7 });

    const owner = pageWindow.__CHIPPY_OWNER__ as { integration?: { kind?: string } } | undefined;
    expect(owner?.integration?.kind).toBe('extension');
  });

  it('does not inject any in-page import panel/overlay', () => {
    expect(helper).not.toContain('__chippy-import-panel');
    expect(helper).not.toContain('__chippy-import-reload-notice');
    expect(helper).not.toContain('__installChippyImportUi');
    expect(helper).not.toContain('Reload removes this imported Chippy');
  });


  it('sends extension identity through both startup and late bundle injection', async () => {
    const executeCalls: Array<{ args?: unknown[]; files?: string[] }> = [];
    const runtimeListeners: Function[] = [];
    const committedListeners: Function[] = [];
    const chrome = {
      scripting: {
        executeScript: async (call: { args?: unknown[]; files?: string[] }) => {
          executeCalls.push(call);
          return [];
        },
      },
      runtime: {
        onMessage: { addListener: (listener: Function) => runtimeListeners.push(listener) },
      },
      webNavigation: {
        onCommitted: { addListener: (listener: Function) => committedListeners.push(listener) },
      },
      tabs: {
        get: async () => ({ url: 'https://example.test/page' }),
        onUpdated: { addListener: () => undefined },
      },
      storage: {
        local: {
          get: async () => ({
            helperBaseUrl: 'http://127.0.0.1:7823',
            enabledOrigins: { 'https://example.test': true },
          }),
        },
      },
    };

    runInNewContext(background, {
      AbortSignal,
      URL,
      chrome,
      console,
      fetch: async () => {
        throw new Error('offline test');
      },
    });

    await committedListeners[0]({ frameId: 0, tabId: 42 });
    const startupConfig = executeCalls.find((call) => call.args)?.args?.[0] as {
      integration?: Record<string, unknown>;
    };
    expect(startupConfig.integration).toEqual({
      kind: 'extension',
      who: 'Chippy browser extension',
      source: '.agents/skills/chippy/extension/background.js',
      reinjectsOnReload: true,
      reloadAction: 'No user action required; the enabled extension re-injects Chippy after navigation.',
    });

    executeCalls.length = 0;
    await new Promise<void>((resolve, reject) => {
      runtimeListeners[0](
        { type: 'chippy-inject-bundle', tabId: 42 },
        {},
        (response: { ok?: boolean; error?: string }) => {
          if (!response?.ok) reject(new Error(response?.error || 'late injection failed'));
          else resolve();
        },
      );
    });
    const lateConfig = executeCalls.find((call) => call.args)?.args?.[0] as {
      integration?: Record<string, unknown>;
    };
    const lateFiles = executeCalls.flatMap((call) => call.files || []);
    expect(lateFiles.indexOf('panel-dom.js')).toBeGreaterThanOrEqual(0);
    expect(lateFiles.indexOf('panel-dom.js')).toBeLessThan(lateFiles.indexOf('layout-lab.js'));
    expect(lateConfig.integration).toEqual(startupConfig.integration);
  });

  it('yields to a live user-driven owner (Storybook addon) instead of injecting', async () => {
    const executeCalls: Array<{ args?: unknown[]; files?: string[]; func?: Function }> = [];
    const committedListeners: Function[] = [];
    let runtimeMessageListener: Function | null = null;
    const liveOwner = {
      __CHIPPY_OWNER__: {
        ownerId: 'storybook-addon',
        integration: { kind: 'storybook', who: 'Chippy Storybook addon' },
        heartbeatAt: Date.now(),
        staleAfterMs: 15000,
      },
    };
    const chrome = {
      scripting: {
        executeScript: async (call: { args?: unknown[]; files?: string[]; func?: Function }) => {
          executeCalls.push(call);
          if (typeof call.func === 'function' && !call.args) {
            const win = liveOwner as unknown as Window & typeof globalThis;
            return [{ result: (call.func as () => unknown).call(win) }];
          }
          return [];
        },
      },
      runtime: { onMessage: { addListener: (l: Function) => { runtimeMessageListener = l; } } },
      webNavigation: { onCommitted: { addListener: (l: Function) => committedListeners.push(l) } },
      tabs: {
        get: async () => ({ url: 'https://example.test/page' }),
        onUpdated: { addListener: () => undefined },
      },
      storage: {
        local: {
          get: async () => ({
            helperBaseUrl: 'http://127.0.0.1:7823',
            enabledOrigins: { 'https://example.test': true },
          }),
        },
      },
    };

    runInNewContext(background, {
      AbortSignal,
      URL,
      Date,
      chrome,
      console,
      fetch: async () => {
        throw new Error('offline test');
      },
      window: liveOwner,
    });

    await committedListeners[0]({ frameId: 0, tabId: 42 });

    // Early startup remains timing-critical: even when a live user-driven owner
    // exists, the extension still injects devtools-hook-shim + Avalanche before
    // React can mount. Late bridge/probe activation yields separately.
    expect(executeCalls.some((call) => call.files?.includes('devtools-hook-shim.js'))).toBe(true);
    expect(executeCalls.some((call) => call.files?.includes('avalanche.iife.js'))).toBe(true);
    expect(executeCalls.some((call) => call.files?.includes('chippy-page-bridge.js'))).toBe(false);

    // Simulate the content script's late injection request; this is where the
    // extension must yield to the live Storybook/import owner.
    let response: unknown = null;
    runtimeMessageListener?.(
      { type: 'chippy-inject-bundle', helperBaseUrl: 'http://127.0.0.1:7823' },
      { tab: { id: 42 } },
      (r: unknown) => { response = r; },
    );
    for (let i = 0; i < 10 && response == null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(executeCalls.some((call) => call.files?.includes('chippy-page-bridge.js'))).toBe(false);
    expect(response).toMatchObject({ yielded: true });
  });

  it('proceeds with injection when the only owner is stale', async () => {
    const executeCalls: Array<{ args?: unknown[]; files?: string[]; func?: Function }> = [];
    const committedListeners: Function[] = [];
    const staleOwner = {
      __CHIPPY_OWNER__: {
        ownerId: 'storybook-addon',
        integration: { kind: 'storybook', who: 'Chippy Storybook addon' },
        heartbeatAt: Date.now() - 60_000,
        staleAfterMs: 15000,
      },
    };
    const chrome = {
      scripting: {
        executeScript: async (call: { args?: unknown[]; files?: string[]; func?: Function }) => {
          executeCalls.push(call);
          if (typeof call.func === 'function' && !call.args) {
            const win = staleOwner as unknown as Window & typeof globalThis;
            return [{ result: (call.func as () => unknown).call(win) }];
          }
          return [];
        },
      },
      runtime: { onMessage: { addListener: () => undefined } },
      webNavigation: { onCommitted: { addListener: (l: Function) => committedListeners.push(l) } },
      tabs: {
        get: async () => ({ url: 'https://example.test/page' }),
        onUpdated: { addListener: () => undefined },
      },
      storage: {
        local: {
          get: async () => ({
            helperBaseUrl: 'http://127.0.0.1:7823',
            enabledOrigins: { 'https://example.test': true },
          }),
        },
      },
    };

    runInNewContext(background, {
      AbortSignal,
      URL,
      Date,
      chrome,
      console,
      fetch: async () => {
        throw new Error('offline test');
      },
      window: staleOwner,
    });

    await committedListeners[0]({ frameId: 0, tabId: 42 });

    const startupWrite = executeCalls.find(
      (call) =>
        Array.isArray(call.args) &&
        (call.args[0] as { integration?: { kind?: string } })?.integration?.kind === 'extension',
    );
    expect(startupWrite).toBeDefined();
  });

  it('keeps inject-url machine-readable on stdout and puts the reload warning on stderr', () => {
    const result = spawnSync('.agents/skills/chippy/scripts/chippy.sh', ['inject-url'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:7823/__chippy/inject.js');
    expect(result.stderr).toContain('a full reload/navigation removes Chippy');
    expect(result.stderr).toContain('inject it again');
  });

  it('injects the isolated settings script before the main content script', async () => {
    const runtimeListeners: Function[] = [];
    const executeCalls: Array<{ files?: string[] }> = [];
    const chrome = {
      scripting: {
        executeScript: async (call: { files?: string[] }) => {
          executeCalls.push(call);
          return [];
        },
      },
      runtime: {
        onMessage: { addListener: (listener: Function) => runtimeListeners.push(listener) },
      },
      webNavigation: { onCommitted: { addListener: () => undefined } },
      tabs: {
        get: async () => ({ url: 'https://example.test/page' }),
        onUpdated: { addListener: () => undefined },
      },
      storage: { local: { get: async () => ({ enabledOrigins: {} }) } },
    };

    runInNewContext(background, {
      AbortSignal,
      URL,
      chrome,
      console,
      fetch: async () => { throw new Error('offline test'); },
    });

    let response: unknown = null;
    runtimeListeners[0](
      { type: 'chippy-ensure-content-script', tabId: 42 },
      {},
      (value: unknown) => { response = value; },
    );
    for (let i = 0; i < 10 && response == null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(executeCalls).toContainEqual({
      target: { tabId: 42 },
      files: ['panel-settings.js', 'content-script.js'],
    });
    expect(response).toEqual({ ok: true });
  });
});
