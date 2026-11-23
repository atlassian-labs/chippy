import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_METRICS_SLOT, createSlotCommitMetricsAdapter } from '../avalanche/test-support/slot-commit-metrics-adapter';

const gatePlugin = { id: 'gate', contextProvider: { id: 'gate', describe: () => null } };
const hostPlugin = () => {
  const adapter = { ...createSlotCommitMetricsAdapter(), prePage: vi.fn() };
  return { plugin: { id: 'host', commitMetricsAdapter: adapter }, adapter };
};

const originalMetricsDescriptor = Object.getOwnPropertyDescriptor(globalThis, TEST_METRICS_SLOT);
const originalDevtoolsHook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
const originalStartupConfig = (globalThis as any).__CHIPPY_STARTUP_CONFIG;
const originalAvalancheAi = (globalThis as any).__AVALANCHE_AI__;

function cleanupGlobal(name: string, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as any)[name];
  }
}

afterEach(async () => {
  vi.resetModules();
  cleanupGlobal(TEST_METRICS_SLOT, originalMetricsDescriptor);
  cleanupGlobal('__REACT_DEVTOOLS_GLOBAL_HOOK__', originalDevtoolsHook ? {
    configurable: true,
    enumerable: true,
    writable: true,
    value: originalDevtoolsHook,
  } : undefined);
  cleanupGlobal('__CHIPPY_STARTUP_CONFIG', originalStartupConfig ? {
    configurable: true,
    enumerable: true,
    writable: true,
    value: originalStartupConfig,
  } : undefined);
  cleanupGlobal('__AVALANCHE_AI__', originalAvalancheAi ? {
    configurable: true,
    enumerable: true,
    writable: true,
    value: originalAvalancheAi,
  } : undefined);
});

describe('src/iife.ts startup behavior', () => {
  it('publishes marker context inspection and the provider registry through layoutLab', async () => {
    delete (globalThis as any).__AVALANCHE__;
    const mod = await import('../iife');
    expect(mod.default.layoutLab.describeContext).toBeTypeOf('function');
    expect(mod.default.layoutLab.registerContextProvider).toBeTypeOf('function');
    // The shipped bundle carries no plugins; a registered one runs once enabled.
    expect(mod.default.listPlugins()).toEqual([]);
    expect(mod.default.status().metricsAdapter).toBeNull();
    mod.default.registerPlugin(gatePlugin);
    expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).not.toContain('gate');
    expect(mod.default.enablePlugins(['gate'])).toEqual(['gate']);
    expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).toContain('gate');
  });

  it('enables the plugins named by the startup config or __CHIPPY_PLUGINS', async () => {
    delete (globalThis as any).__AVALANCHE__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['host'] };
    (globalThis as any).__CHIPPY_PLUGINS = ['gate'];
    try {
      const mod = await import('../iife');
      mod.default.registerPlugin(gatePlugin);
      mod.default.registerPlugin(hostPlugin().plugin);
      expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).toContain('gate');
      expect(mod.default.status().metricsAdapter).toBe('test-host');
    } finally {
      delete (globalThis as any).__CHIPPY_PLUGINS;
    }
  });

  it('starts a packed plugin the startup config enabled, and skips build defaults then', async () => {
    delete (globalThis as any).__AVALANCHE__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['gate'] };
    const mod = await import('../iife');
    mod.default.registerPlugin({ id: 'gate', contextProvider: { id: 'gate', describe: () => null } });
    expect(mod.default.enableDefaultPlugins(['other'])).toEqual(['gate']);
    expect(mod.default.listPlugins().filter((p) => p.enabled).map((p) => p.id)).toEqual(['gate']);
  });

  it('applies build defaults when the page made no plugin selection', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    const mod = await import('../iife');
    mod.default.registerPlugin(gatePlugin);
    expect(mod.default.enableDefaultPlugins(['gate'])).toEqual(['gate']);
  });

  it('publishes declarative boundary chain and page inspection through the bundled bridge API', async () => {
    delete (globalThis as any).__AVALANCHE__;
    const mod = await import('../iife');
    expect(mod.default.bridge.inspectDeclarativeBoundaryChain).toBeTypeOf('function');
    expect(mod.default.bridge.inspectPageDeclarativeBoundaries).toBeTypeOf('function');
  });

  it('publishes the cross-version fiber source resolver through both bundled APIs', async () => {
    delete (globalThis as any).__AVALANCHE__;
    const mod = await import('../iife');
    expect(mod.default.layoutLab.describeFiberSource).toBeTypeOf('function');
    expect(mod.default.layoutLab.resolveFiberSource).toBeTypeOf('function');
    expect(mod.default.bridge.describeFiberSource).toBeTypeOf('function');
    expect(mod.default.bridge.resolveFiberSource).toBeTypeOf('function');
  });

  it('bootstraps the devtools hook at load and seeds no adapter slot', async () => {
    delete (globalThis as any)[TEST_METRICS_SLOT];
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    delete (globalThis as any).__AVALANCHE_AI__;

    const mod = await import('../iife');

    expect(mod.default).toBeTruthy();
    // Devtools hook is still installed eagerly (React reads it at module eval time).
    expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeTruthy();
    expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.supportsFiber).toBe(true);
    // An adapter's host slot belongs to the host; nothing seeds it at load.
    expect((globalThis as any)[TEST_METRICS_SLOT]).toBeUndefined();
  });

  it('keeps its own devtools hook in a cross-origin frame instead of throwing', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const originalTop = Object.getOwnPropertyDescriptor(globalThis, 'top');
    // A cross-origin top window throws a SecurityError on any property read.
    const crossOriginTop = new Proxy({}, {
      get() { throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); },
      set() { throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); },
    });
    Object.defineProperty(globalThis, 'top', { configurable: true, get: () => crossOriginTop });
    try {
      const mod = await import('../iife');
      expect(mod.default).toBeTruthy();
      expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__?.supportsFiber).toBe(true);
    } finally {
      if (originalTop) Object.defineProperty(globalThis, 'top', originalTop);
      else delete (globalThis as any).top;
    }
  });

  it('runs no pre-page hook unless an adapter plugin is enabled', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    const mod = await import('../iife');
    const { plugin, adapter } = hostPlugin();
    mod.default.registerPlugin(plugin);
    expect(mod.default.runPrePageHooks({ enabled: true })).toBeNull();
    expect(adapter.prePage).not.toHaveBeenCalled();
  });

  it('publishes the commit metrics adapter registry with an opted-in adapter plugin', async () => {
    delete (globalThis as any).__AVALANCHE__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['host'] };
    const mod = await import('../iife');
    const { plugin, adapter } = hostPlugin();
    mod.default.registerPlugin(plugin);
    expect(mod.default.registerCommitMetricsAdapter).toBeTypeOf('function');
    expect(mod.default.status().metricsAdapter).toBe('test-host');
    // Early bootstrap calls this before the page's React evaluates.
    const config = { enabled: true };
    expect(mod.default.runPrePageHooks(config)).toBe('test-host');
    expect(adapter.prePage).toHaveBeenCalledWith(config);
  });

  it('reports the detection level of the running capture in status', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    const mod = await import('../iife');
    expect(mod.default.status().detectionMode).toBeNull();
    mod.default.install({ detectionMode: 'full' });
    expect(mod.default.status().detectionMode).toBe('full');
    mod.default.install({ detectionMode: 'sources' });
    expect(mod.default.status().detectionMode).toBe('sources');
    mod.default.uninstall();
    expect(mod.default.status().detectionMode).toBeNull();
  });

  it('skips auto-install when __AVALANCHE__ is already present on globalThis', async () => {
    delete (globalThis as any)[TEST_METRICS_SLOT];
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = {
      avalanche: { autoStart: true },
    };
    // Simulate a page where another Avalanche instance is already loaded.
    // The iife entry should detect __AVALANCHE__ and skip its own auto-install.
    (globalThis as any).__AVALANCHE__ = {
      install: () => {},
      uninstall: () => {},
      status: () => ({ installed: true }),
    };

    const mod = await import('../iife');
    // Pre-existing __AVALANCHE__ should still report installed: true.
    // Our iife should not have overwritten it or double-installed.
    expect((globalThis as any).__AVALANCHE__.status().installed).toBe(true);
    // Our own exported API should still be available.
    expect(mod.default).toBeTruthy();
  });
});
