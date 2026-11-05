/* eslint-disable */
// The content script owns extension UX/configuration and delegates MAIN-world
// execution to the background service worker. It cannot inspect React fibers
// directly, so it communicates through page events and runtime messages;
// keeping this split also avoids injecting inline code through page CSP.
(function chippyContentScript() {

const DEFAULT_HELPER = 'http://127.0.0.1:7823';
const BUNDLE_ATTR = 'data-chippy-bundle';
const LOG_PREFIX = '[chippy-ext]';

const pageStatus = {
  status: 'booting',
  detail: '',
  updatedAt: new Date().toISOString(),
  helperBaseUrl: DEFAULT_HELPER,
  activated: false,
};

function error(...args) { console.error(LOG_PREFIX, ...args); }

function getInjectionParent() {
  return document.head || document.documentElement || document.body || null;
}

function appendToDocument(node, label, onAppended = null, attempt = 0) {
  const parent = getInjectionParent();
  if (parent) {
    parent.appendChild(node);
    onAppended?.();
    return true;
  }

  if (attempt >= 50) {
    error('failed to append node; no injection parent', { label, readyState: document.readyState });
    return false;
  }

  window.setTimeout(() => appendToDocument(node, label, onAppended, attempt + 1), 20);
  return false;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_HELPER).replace(/\/+$/, '');
}

function getOriginKey() {
  try {
    return window.location.origin || null;
  } catch {
    return null;
  }
}

function setStatus(status, detail = '') {
  pageStatus.status = status;
  pageStatus.detail = detail || '';
  pageStatus.updatedAt = new Date().toISOString();
}

function writePageConfig(helperBaseUrl, activated) {
  const normalizedBaseUrl = normalizeBaseUrl(helperBaseUrl);
  pageStatus.helperBaseUrl = normalizedBaseUrl;
  pageStatus.activated = Boolean(activated);
}

function injectBundle(helperBaseUrl) {
  const base = normalizeBaseUrl(helperBaseUrl);

  writePageConfig(base, true);
  setStatus('injecting', 'background bundle');

  chrome.runtime.sendMessage({ type: 'chippy-inject-bundle', helperBaseUrl: base }, (response) => {
    if (chrome.runtime.lastError) {
      error('injectBundle:background-error', { message: chrome.runtime.lastError.message });
      setStatus('load-error', chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      error('injectBundle:background-failed', response || null);
      setStatus('load-error', response?.error || 'Background injection failed');
      return;
    }

    setStatus('loaded', response.detail || 'background bundle injected');
  });
}

function disableBundle() {
  writePageConfig(DEFAULT_HELPER, false);
  // Dispatch a custom event so the page bridge can pick up deactivation
  // without inline script injection (CSP-safe).
  try {
    document.dispatchEvent(new CustomEvent('chippy-ext-command', {
      detail: { type: 'deactivate' },
    }));
  } catch {}
  document.querySelectorAll(`script[${BUNDLE_ATTR}]`).forEach((node) => node.remove());
  setStatus('disabled', getOriginKey() || 'disabled');
}

function applyStoredConfig() {
  const origin = getOriginKey();
  if (!origin) {
    setStatus('unsupported', 'No origin');
    return;
  }

  chrome.storage.local.get({
    helperBaseUrl: DEFAULT_HELPER,
    enabledOrigins: {},
  }, (stored) => {
    const enabled = Boolean(stored.enabledOrigins?.[origin]);
    if (!enabled) {
      setStatus('disabled', origin);
      return;
    }
    injectBundle(normalizeBaseUrl(stored.helperBaseUrl));
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'chippy-get-page-status') {
    const bundle = document.querySelector(`script[${BUNDLE_ATTR}]`);
    sendResponse({
      ok: true,
      result: {
        origin: getOriginKey(),
        status: pageStatus.status || 'unknown',
        detail: pageStatus.detail || '',
        updatedAt: pageStatus.updatedAt || null,
        helperBaseUrl: pageStatus.helperBaseUrl || null,
        activated: Boolean(pageStatus.activated),
        bundlePresent: Boolean(bundle),
        bundleSrc: bundle?.src || null,
      },
    });
    return;
  }

  if (message.type === 'chippy-disable-now') {
    disableBundle();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'chippy-update-helper-url') {
    const enabled = Boolean(message.enabled);
    const helperBaseUrl = normalizeBaseUrl(message.helperBaseUrl);
    writePageConfig(helperBaseUrl, enabled);
    if (enabled) {
      try {
        document.dispatchEvent(new CustomEvent('chippy-ext-command', {
          detail: { type: 'apply-config', helperBaseUrl, activated: true },
        }));
      } catch {}
    }
    setStatus('configured', helperBaseUrl);
    sendResponse({ ok: true });
    return;
  }
});

// The page bridge asks for early startup on the next navigation before an armed
// reload. Only the background can register the MAIN-world startup scripts. The
// background also re-runs this file, so the relay is installed once per document.
function relayArmedReload() {
  const reply = (result) => {
    try {
      document.dispatchEvent(new CustomEvent('chippy-armed-reload-ready', { detail: JSON.stringify(result || {}) }));
    } catch {}
  };
  try {
    chrome.runtime.sendMessage({ type: 'chippy-register-armed-reload' }, (response) => {
      if (chrome.runtime.lastError) reply({ ok: false, error: chrome.runtime.lastError.message });
      else reply(response);
    });
  } catch (e) {
    reply({ ok: false, error: e.message });
  }
}
if (!globalThis.__chippyArmedReloadRelay) {
  globalThis.__chippyArmedReloadRelay = true;
  document.addEventListener('chippy-armed-reload-prepare', relayArmedReload);
}

applyStoredConfig();

})();
