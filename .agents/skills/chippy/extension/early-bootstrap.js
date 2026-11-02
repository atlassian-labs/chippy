/* eslint-disable */
// Runs in MAIN before React evaluates. This phase exists only to establish
// timing-sensitive page contracts (startup config and the registered commit
// metrics adapter's pre-page hook). The actual Chippy bridge is injected
// later, after owner arbitration, so a user-controlled Storybook/import
// integration can win.
(function chippyEarlyBootstrap() {
  if (globalThis.__CHIPPY_EARLY_BOOTSTRAP_INSTALLED__) {
    return;
  }
  globalThis.__CHIPPY_EARLY_BOOTSTRAP_INSTALLED__ = true;

  const cfg = globalThis.__CHIPPY_STARTUP_CONFIG || null;
  if (!cfg || !cfg.enabled) {
    return;
  }

  globalThis.__CHIPPY = globalThis.__CHIPPY || {};

  globalThis.__CHIPPY.config = {
    ...(globalThis.__CHIPPY.config || {}),
    helperBaseUrl: cfg.helperBaseUrl,
    activated: true,
    avalanche: cfg.avalanche ? {
      autoStart: true,
      max: (cfg.avalanche && cfg.avalanche.max) || 500,
      options: (cfg.avalanche && cfg.avalanche.options) || {},
    } : { autoStart: false, max: 500 },
  };

  // Run the registered commit metrics adapter's pre-page hook. It must run
  // before the page's React evaluates (for example, the ATL adapter installs a
  // configurable metrics-slot accessor). avalanche.iife.js loads before this
  // script, so the registry is populated. A failure here is non-fatal:
  // Avalanche falls back to DevTools integration.
  try {
    if (globalThis.__AVALANCHE__ && typeof globalThis.__AVALANCHE__.runPrePageHooks === 'function') {
      globalThis.__AVALANCHE__.runPrePageHooks(cfg);
    }
  } catch (_e) {
    // Non-fatal.
  }

  if (globalThis.__AVALANCHE__) {
    return;
  }
})();
