import { afterEach, describe, expect, it, vi } from 'vitest';

const originalMetricsDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__ATL_REACT_METRICS');
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
  cleanupGlobal('__ATL_REACT_METRICS', originalMetricsDescriptor);
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
    expect(mod.default.layoutLab).not.toHaveProperty('describeJiraContext');
    // The shipped bundle enables no built-in plugin unless the page opts in.
    expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).not.toContain('jira');
    expect(mod.default.status().metricsAdapter).toBeNull();
    expect(mod.default.enablePlugins(['jira'])).toEqual(['jira']);
    expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).toContain('jira');
  });

  it('enables the built-in plugins named by the startup config or __CHIPPY_PLUGINS', async () => {
    delete (globalThis as any).__AVALANCHE__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['atl'] };
    (globalThis as any).__CHIPPY_PLUGINS = ['jira'];
    try {
      const mod = await import('../iife');
      expect(mod.default.layoutLab.getContextProviders().map((p) => p.id)).toContain('jira');
      expect(mod.default.status().metricsAdapter).toBe('atl');
    } finally {
      delete (globalThis as any).__CHIPPY_PLUGINS;
    }
  });

  it('starts a packed plugin the startup config enabled, and skips build defaults then', async () => {
    delete (globalThis as any).__AVALANCHE__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['gate'] };
    const mod = await import('../iife');
    mod.default.registerPlugin({ id: 'gate', contextProvider: { id: 'gate', describe: () => null } });
    expect(mod.default.enableDefaultPlugins(['jira'])).toEqual(['gate']);
    expect(mod.default.listPlugins().filter((p) => p.enabled).map((p) => p.id)).toEqual(['gate']);
  });

  it('applies build defaults when the page made no plugin selection', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    const mod = await import('../iife');
    expect(mod.default.enableDefaultPlugins(['jira'])).toEqual(['jira']);
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

  it('bootstraps devtools hook at load but defers ATL metrics to install()', async () => {
    delete (globalThis as any).__ATL_REACT_METRICS;
    delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['atl'] };
    delete (globalThis as any).__AVALANCHE_AI__;

    const mod = await import('../iife');

    expect(mod.default).toBeTruthy();
    // Devtools hook is still installed eagerly (React reads it at module eval time).
    expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeTruthy();
    expect((globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.supportsFiber).toBe(true);
    // __ATL_REACT_METRICS is NOT seeded at load — the host owns this slot.
    // It will be seeded lazily when avalanche.install() is called.
    expect((globalThis as any).__ATL_REACT_METRICS).toBeUndefined();
    // Calling install() seeds the metrics slot.
    mod.default.install();
    expect((globalThis as any).__ATL_REACT_METRICS).toBeTruthy();
    mod.default.uninstall();
  });

  it('runs no pre-page hook unless the ATL plugin is enabled', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__ATL_REACT_METRICS;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    const mod = await import('../iife');
    expect(mod.default.runPrePageHooks({ enabled: true })).toBeNull();
    expect(Object.getOwnPropertyDescriptor(globalThis, '__ATL_REACT_METRICS')).toBeUndefined();
  });

  it('publishes the commit metrics adapter registry with the opted-in ATL adapter', async () => {
    delete (globalThis as any).__AVALANCHE__;
    delete (globalThis as any).__ATL_REACT_METRICS;
    (globalThis as any).__CHIPPY_STARTUP_CONFIG = { plugins: ['atl'] };
    const mod = await import('../iife');
    expect(mod.default.registerCommitMetricsAdapter).toBeTypeOf('function');
    expect(mod.default.status().metricsAdapter).toBe('atl');
    // Early bootstrap calls this before the page's React evaluates.
    expect(mod.default.runPrePageHooks({ enabled: true })).toBe('atl');
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__ATL_REACT_METRICS');
    expect(descriptor?.get).toBeTypeOf('function');
    expect(descriptor?.configurable).toBe(true);
  });

  it('skips auto-install when __AVALANCHE__ is already present on globalThis', async () => {
    delete (globalThis as any).__ATL_REACT_METRICS;
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
