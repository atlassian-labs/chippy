/* eslint-disable */
// Runs in Chrome's isolated content-script world. The content script owns one
// stable host + closed shadow root and portals it into the MAIN-world panel.
(function installChippyPanelSettings() {
  try { globalThis.__CHIPPY_PANEL_SETTINGS_RUNTIME__?.destroy?.(); } catch {}

  const DEFAULT_HELPER = 'http://127.0.0.1:7823';
  const SETTINGS_SLOT_SELECTOR = '[data-chippy-settings-slot]';
  let observer = null;
  let waitingForDom = false;

  function normalizeBaseUrl(value) {
    return String(value || DEFAULT_HELPER).trim().replace(/\/+$/, '');
  }

  function validateHelperUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function parseForwardPort(value) {
    if (value === '') return null;
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
  }

  function settingsMarkup() {
    return `
      <style>
        :host { all: initial; display: block; color-scheme: dark; }
        * { box-sizing: border-box; }
        form { display: grid; gap: 8px; color: #CECFD2; font: 11px/1.4 'Atlassian Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        label { display: grid; gap: 3px; }
        label span { color: #A9ABAF; font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
        input { width: 100%; border: 1px solid rgba(148,163,184,.25); border-radius: 7px; padding: 6px 8px; background: #1F1F21; color: #CECFD2; font: inherit; }
        input:focus { outline: 2px solid #669DF1; outline-offset: 1px; }
        fieldset { display: grid; gap: 4px; margin: 0; padding: 0; border: 0; }
        legend { margin-bottom: 3px; padding: 0; color: #A9ABAF; font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
        fieldset label { display: flex; align-items: center; gap: 6px; }
        fieldset input { width: auto; margin: 0; }
        .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        button { border: 1px solid rgba(96,165,250,.35); border-radius: 7px; padding: 5px 10px; background: rgba(59,130,246,.2); color: #B8D6FF; font: inherit; font-weight: 700; cursor: pointer; }
        [data-status] { min-height: 15px; color: #86efac; font-size: 10px; text-align: right; }
        [data-status][data-error="true"] { color: #FD9891; }
      </style>
      <form>
        <label>
          <span>Chippy URL</span>
          <input data-helper-url type="url" inputmode="url" required placeholder="${DEFAULT_HELPER}" />
        </label>
        <label>
          <span>Forward to port · optional</span>
          <input data-forward-port type="number" inputmode="numeric" min="1" max="65535" step="1" placeholder="Auto-detect from page URL" />
        </label>
        <fieldset>
          <legend>Plugins · apply on reload</legend>
          <label><input data-plugin type="checkbox" value="jira" />Jira ownership markers</label>
          <label><input data-plugin type="checkbox" value="atl" />ATL commit metrics</label>
        </fieldset>
        <div class="actions">
          <button type="submit">Save settings</button>
          <div data-status role="status" aria-live="polite"></div>
        </div>
      </form>
    `;
  }

  const host = document.createElement('div');
  host.setAttribute('data-chippy-settings-host', 'true');
  host.setAttribute('data-chippy-preserve', 'true');
  host.style.cssText = 'display:block;min-height:232px;';
  const root = host.attachShadow({ mode: 'closed' });
  const surface = document.createElement('div');
  surface.innerHTML = settingsMarkup();
  root.appendChild(surface);

  const form = root.querySelector('form');
  const helperInput = root.querySelector('[data-helper-url]');
  const forwardPortInput = root.querySelector('[data-forward-port]');
  const pluginInputs = Array.from(root.querySelectorAll('[data-plugin]'));
  const statusNode = root.querySelector('[data-status]');

  function setStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.setAttribute('data-error', isError ? 'true' : 'false');
  }

  chrome.storage.local.get({
    helperBaseUrl: DEFAULT_HELPER,
    forwardPort: null,
    plugins: [],
  }).then((stored) => {
    helperInput.value = normalizeBaseUrl(stored.helperBaseUrl);
    forwardPortInput.value = stored.forwardPort || '';
    const plugins = Array.isArray(stored.plugins) ? stored.plugins : [];
    for (const input of pluginInputs) input.checked = plugins.includes(input.value);
  }).catch((error) => setStatus(error.message || 'Could not load settings.', true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const helperBaseUrl = normalizeBaseUrl(helperInput.value);
    const forwardPort = parseForwardPort(forwardPortInput.value);
    if (!validateHelperUrl(helperBaseUrl)) {
      setStatus('Use an http(s) URL.', true);
      return;
    }
    if (forwardPort === undefined) {
      setStatus('Port must be 1–65535.', true);
      return;
    }

    try {
      const plugins = pluginInputs.filter((input) => input.checked).map((input) => input.value);
      await chrome.storage.local.set({ helperBaseUrl, forwardPort, plugins });
      document.dispatchEvent(new CustomEvent('chippy-ext-command', {
        detail: { type: 'apply-config', helperBaseUrl, activated: true },
      }));
      setStatus('Saved.');
    } catch (error) {
      setStatus(error.message || 'Could not save settings.', true);
    }
  });

  function mountPanelSettings() {
    const liveDocument = globalThis.document;
    if (!liveDocument?.querySelectorAll) return;
    const slots = liveDocument.querySelectorAll(SETTINGS_SLOT_SELECTOR);
    const slot = slots[slots.length - 1] || null;
    if (slot && host.parentNode !== slot) slot.appendChild(host);
  }

  function installMountObserver() {
    mountPanelSettings();
    if (!globalThis.document?.documentElement) {
      if (!waitingForDom) {
        waitingForDom = true;
        globalThis.document?.addEventListener('DOMContentLoaded', onDomReady, { once: true });
      }
      return;
    }
    observer?.disconnect();
    observer = new MutationObserver(mountPanelSettings);
    observer.observe(globalThis.document.documentElement, { childList: true, subtree: true });
  }

  function onDomReady() {
    waitingForDom = false;
    installMountObserver();
  }

  function onMountRequest() {
    mountPanelSettings();
  }

  function destroy() {
    observer?.disconnect();
    globalThis.document?.removeEventListener('DOMContentLoaded', onDomReady);
    globalThis.document?.removeEventListener('chippy-settings-mount-request', onMountRequest);
    host.remove();
  }

  globalThis.__CHIPPY_PANEL_SETTINGS_RUNTIME__ = {
    destroy,
    mount: mountPanelSettings,
  };
  document.addEventListener('chippy-settings-mount-request', onMountRequest);
  installMountObserver();
})();
