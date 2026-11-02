/* eslint-disable */
// Chippy background service worker.
// Ensures the content script + bundle scripts are injected into tabs even when
// Chrome's declarative content_scripts injection fails (e.g. after extension
// reload, on service-worker-served pages, or on fast-loading pages).
//
// Injection is split into EARLY_STARTUP_SCRIPTS and LATE_BUNDLE_SCRIPTS. The
// first group must beat react-dom evaluation; the second group can wait until
// the page owner is known and only installs the bridge/probe UI.

const DEFAULT_HELPER = 'http://127.0.0.1:7823';
const CONTENT_SCRIPTS = ['panel-settings.js', 'content-script.js'];
const EXTENSION_INTEGRATION = Object.freeze({
  kind: 'extension',
  who: 'Chippy browser extension',
  source: '.agents/skills/chippy/extension/background.js',
  reinjectsOnReload: true,
  reloadAction: 'No user action required; the enabled extension re-injects Chippy after navigation.',
});
// IIFE bundle of Chippy's avalanche adapter. Loads in MAIN world before
// the document parses so __AVALANCHE__ is published before any React mounts.
const EARLY_STARTUP_SCRIPTS = [
  // MUST be first. Installs the React DevTools hook shim BEFORE react-dom or
  // any page-React module evaluates. Without it, react-dom does not register
  // its renderer into hook.renderers, and Avalanche debug-render cannot find
  // ReactCurrentDispatcher to capture hook call stacks. That collapses
  // debugHook() to a flat fallback (no custom-hook folders, no callerLoc).
  'devtools-hook-shim.js',
  'avalanche.iife.js',
  'early-bootstrap.js',
];

const LATE_BUNDLE_SCRIPTS = [
  'inspect-react.js',
  'panel-dom.js',
  'layout-lab.js',
  'resolve-probes.js',
  'chippy-page-bridge.js',
];
// Late bundle is bridge/probes only. Avalanche lifecycle is owned by
// EARLY_STARTUP_SCRIPTS; re-injecting avalanche code here causes duplicate
// globals and races bootstrap ordering.

// Inject content script into a tab, ignoring errors (already injected, restricted page, etc.)
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPTS,
    });
  } catch {
    // Ignore — tab may be restricted (chrome://, edge://, etc.)
  }
}


async function getStartupConfig(origin, helperBaseUrl, clientId, plugins) {
  const helperBase = (helperBaseUrl || DEFAULT_HELPER).replace(/\/+$/, '');
  const config = {
    enabled: true,
    helperBaseUrl: helperBaseUrl || DEFAULT_HELPER,
    avalanche: null,
    // Built-in plugins the user enabled in the popup; the bundle enables none otherwise.
    plugins: Array.isArray(plugins) ? plugins : [],
    contextUiEnabled: true,
    jiraUiEnabled: true,
    integration: EXTENSION_INTEGRATION,
  };
  try {
    if (clientId) {
      const rc = await fetch(`${helperBase}/__chippy/api/avalanche-arm?clientId=${encodeURIComponent(clientId)}`, { signal: AbortSignal.timeout(1000) });
      if (rc.ok) {
        const data = await rc.json();
        if (data.armed && data.config) {
          config.avalanche = data.config;
          return config;
        }
      }
    }
    const ro = await fetch(`${helperBase}/__chippy/api/avalanche-arm?origin=${encodeURIComponent(origin)}`, { signal: AbortSignal.timeout(1000) });
    if (ro.ok) {
      const data = await ro.json();
      if (data.armed && data.config) config.avalanche = data.config;
    }
  } catch {}
  return config;
} 

async function lookupClientIdForTab(tabId, helperBaseUrl) {
  const helperBase = (helperBaseUrl || DEFAULT_HELPER).replace(/\/+$/, '');
  try {
    const r = await fetch(`${helperBase}/__chippy/api/pages`, { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return null;
    const data = await r.json();
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    const hit = pages.find((p) => Number(p?.tabId) === Number(tabId));
    return hit?.clientId || null;
  } catch {
    return null;
  }
} 

// Extension is the DEFAULT/fallback integration. Any explicitly user-driven
// owner (Storybook addon, direct import, etc.) outranks it: when a live owner
// with integration.kind !== 'extension' already holds window.__CHIPPY_OWNER__,
// the extension stands down instead of stomping the lock. Runs in the page
// (MAIN) world because __CHIPPY_OWNER__ only exists there.
async function detectLiveForeignOwner(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: true,
      func: () => {
        const owner = window.__CHIPPY_OWNER__;
        if (!owner || !owner.integration) return null;
        // Extension never yields to another extension owner (that is itself).
        if (owner.integration.kind === 'extension') return null;
        // Respect the owner's own liveness contract; a stale owner is ignored.
        const staleAfterMs = owner.staleAfterMs;
        const heartbeatAt = owner.heartbeatAt || 0;
        if (staleAfterMs && Date.now() - heartbeatAt > staleAfterMs) return null;
        return {
          ownerId: owner.ownerId || null,
          kind: owner.integration.kind || null,
          who: owner.integration.who || null,
        };
      },
    });
    return results?.[0]?.result || null;
  } catch {
    // If we cannot probe the page world, do not block injection.
    return null;
  }
}

async function injectEarlyStartup(tabId, startupConfig) {
  // Timing-critical path: do NOT run an owner-detection preflight before these
  // startup scripts. reload-with-avalanche relies on devtools-hook-shim +
  // avalanche.iife.js landing as early as possible on navigation. Owner/yield
  // checks happen later in ensureBundleScripts before bridge/probes activation.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: true,
      func: (cfg, integration) => {
        window.__CHIPPY_STARTUP_CONFIG = cfg;
        // Stamp the extension as the page owner so its identity is stable no
        // matter which config-write path (early startup, bundle, or content
        // script apply-config) wins. getIntegrationIdentity() falls back to
        // __CHIPPY_OWNER__.integration, so this guarantees integration is never
        // null on an extension-owned page. We reach here only when no live
        // foreign owner exists (checked above), so we never overwrite the
        // Storybook addon / import owner.
        const existing = window.__CHIPPY_OWNER__;
        const existingLive =
          existing &&
          existing.integration &&
          existing.integration.kind !== 'extension' &&
          (!existing.staleAfterMs || Date.now() - (existing.heartbeatAt || 0) <= existing.staleAfterMs);
        if (!existingLive) {
          window.__CHIPPY_OWNER__ = {
            ownerId: 'chippy-extension',
            integration,
            heartbeatAt: Date.now(),
            staleAfterMs: 15000,
          };
        }
      },
      args: [startupConfig, EXTENSION_INTEGRATION],
    });
  } catch (e) {
    return { ok: false, step: 'startup-config', error: e.message };
  }

  for (const file of EARLY_STARTUP_SCRIPTS) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
        world: 'MAIN',
        injectImmediately: true,
      });
    } catch (e) {
      return { ok: false, step: `startup:${file}`, error: e.message };
    }
  }

  return { ok: true, detail: `${EARLY_STARTUP_SCRIPTS.length} early scripts injected` };
}

// Write Chippy config into the page world and inject non-startup bundle scripts.
async function ensureBundleScripts(tabId, helperBaseUrl, options = {}) {
  const foreignOwner = await detectLiveForeignOwner(tabId);
  if (foreignOwner) {
    return { ok: true, yielded: true, detail: `extension yielded to ${foreignOwner.who || foreignOwner.kind}` };
  }

  const config = {
    helperBaseUrl: helperBaseUrl || DEFAULT_HELPER,
    activated: true,
    contextUiEnabled: true,
    jiraUiEnabled: true,
    integration: EXTENSION_INTEGRATION,
  };

  if (options.avalanche) config.avalanche = options.avalanche;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (nextConfig) => {
        window.__CHIPPY = window.__CHIPPY || {};
        window.__CHIPPY.config = {
          ...(window.__CHIPPY.config || {}),
          ...nextConfig,
        };
        try {
          window.__CHIPPY?.pageBridge?.applyConfig?.(window.__CHIPPY.config);
        } catch {}
      },
      args: [config],
      world: 'MAIN',
    });
  } catch (e) {
    return { ok: false, step: 'set-config', error: e.message };
  }

  for (const file of LATE_BUNDLE_SCRIPTS) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
        world: 'MAIN',
      });
    } catch (e) {
      return { ok: false, step: `inject:${file}`, error: e.message };
    }
  }

  return { ok: true, detail: `${LATE_BUNDLE_SCRIPTS.length} late scripts injected via background` };
}

// Full injection: content script + bundle
async function ensureAll(tabId, helperBaseUrl, options = {}) {
  await ensureContentScript(tabId);
  return ensureBundleScripts(tabId, helperBaseUrl, options);
}

// When popup/content-script ask us to ensure injection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const messageType = message?.type;

  if (messageType === 'chippy-ensure-content-script' && message.tabId) {
    ensureContentScript(message.tabId).then(() => sendResponse({ ok: true })).catch((e) => {
      sendResponse({ ok: false, step: 'ensure-content-script', error: e.message });
    });
    return true;
  }

  if (messageType === 'chippy-inject-bundle') {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, step: 'resolve-tab', error: 'No tabId available for bundle injection' });
      return false;
    }

    ensureBundleScripts(tabId, message.helperBaseUrl || DEFAULT_HELPER, message.options || {})
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, step: 'inject-bundle', error: e.message }));
    return true;
  }

  return false;
});

// Early startup-critical injection on navigation commit.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const tabId = details.tabId;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;
    const origin = new URL(tab.url).origin;
    const stored = await chrome.storage.local.get({ helperBaseUrl: DEFAULT_HELPER, enabledOrigins: {}, plugins: [] });
    if (!stored.enabledOrigins?.[origin]) return;
    const clientId = await lookupClientIdForTab(tabId, stored.helperBaseUrl);
    const startupConfig = await getStartupConfig(origin, stored.helperBaseUrl, clientId, stored.plugins);
    await injectEarlyStartup(tabId, startupConfig);
    if (startupConfig && startupConfig.avalanche && startupConfig.avalanche.autoStart) {
      try {
        await fetch(`${(stored.helperBaseUrl || DEFAULT_HELPER).replace(/\/+$/, '')}/__chippy/api/avalanche-arm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin, clientId, autoStart: false }),
          signal: AbortSignal.timeout(1000),
        });
      } catch {}
    }
  } catch (e) {
    console.warn(`[chippy-bg] early-inject failed tab=${tabId}: ${e.message}`);
  }
});

// Re-inject non-startup bundle on navigation complete for enabled origins.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  chrome.storage.local.get({ helperBaseUrl: DEFAULT_HELPER, enabledOrigins: {}, plugins: [] }, async (stored) => {
    try {
      const origin = new URL(tab.url).origin;
      if (!stored.enabledOrigins?.[origin]) return;
      const clientId = await lookupClientIdForTab(tabId, stored.helperBaseUrl);
      const startupConfig = await getStartupConfig(origin, stored.helperBaseUrl, clientId, stored.plugins);
      const options = startupConfig.avalanche ? { avalanche: startupConfig.avalanche } : {};
      ensureAll(tabId, stored.helperBaseUrl, options).catch((e) => {
        console.warn(`[chippy-bg] late-inject failed for ${origin} in tab ${tabId}: ${e.message}`);
      });
    } catch {}
  });
});
