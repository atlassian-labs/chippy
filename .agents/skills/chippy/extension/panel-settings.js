/* eslint-disable */
// Runs in Chrome's isolated content-script world. The content script owns one
// stable host + closed shadow root and portals it into the MAIN-world panel.
(function installChippyPanelSettings() {
  try { globalThis.__CHIPPY_PANEL_SETTINGS_RUNTIME__?.destroy?.(); } catch {}

  const DEFAULT_HELPER = 'http://127.0.0.1:7823';
  // A packed build (`chippy pack`) prepends globalThis.__CHIPPY_BUILD to this
  // file with its plugin list and the plugins it enables by default.
  const BUILD = globalThis.__CHIPPY_BUILD || {};
  const PLUGIN_OPTIONS = Array.isArray(BUILD.plugins) ? BUILD.plugins : [];
  const DEFAULT_PLUGINS = Array.isArray(BUILD.defaultPlugins) ? BUILD.defaultPlugins : [];
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  function pluginMarkup() {
    if (PLUGIN_OPTIONS.length === 0) return '';
    const rows = PLUGIN_OPTIONS.map((plugin) =>
      `<label><input data-plugin type="checkbox" value="${escapeHtml(plugin.id)}" />${escapeHtml(plugin.label || plugin.id)}</label>`);
    return `<fieldset>
          <legend>Plugins · apply on reload</legend>
          ${rows.join('\n          ')}
        </fieldset>`;
  }

  // Packs: a saved library of JSON packs (component rules, Avalanche scripts,
  // agent instructions). Each loaded pack can be switched on or off; only the
  // active ones reach the page, on the next load. The page validates a pack in
  // full; here we only check that it is JSON with a usable id.
  const PACK_ID = /^[a-z][a-z0-9-]*$/;

  function parsePackInput(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`Pack JSON: ${error.message}`);
    }
    const list = Array.isArray(value) ? value : [value];
    for (const pack of list) {
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('A pack must be a JSON object.');
      if (typeof pack.id !== 'string' || !PACK_ID.test(pack.id)) throw new Error('A pack needs an id such as "my-pack" (lowercase, digits, dashes).');
    }
    return list;
  }

  function packRowsMarkup(library, active) {
    if (library.length === 0) return '<div class="muted">No packs loaded.</div>';
    return library.map((pack) => `<div class="pack-row">
            <label><input data-pack type="checkbox" value="${escapeHtml(pack.id)}"${active.has(pack.id) ? ' checked' : ''} />${escapeHtml(pack.label || pack.id)}</label>
            <button type="button" class="link" data-remove-pack="${escapeHtml(pack.id)}" aria-label="Remove pack ${escapeHtml(pack.id)}">Remove</button>
          </div>`).join('\n          ');
  }

  function packMarkup() {
    return `<fieldset>
          <legend>Packs · apply on reload</legend>
          <div data-pack-list class="pack-list"></div>
          <label>
            <span>Add pack (JSON object or array)</span>
            <textarea data-pack-input rows="3" spellcheck="false" placeholder='{"id": "my-pack", "components": [...]}'></textarea>
          </label>
        </fieldset>`;
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
        textarea { width: 100%; resize: vertical; border: 1px solid rgba(148,163,184,.25); border-radius: 7px; padding: 6px 8px; background: #1F1F21; color: #CECFD2; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
        textarea:focus { outline: 2px solid #669DF1; outline-offset: 1px; }
        fieldset label:has(textarea) { display: grid; gap: 3px; }
        .pack-list { display: grid; gap: 4px; }
        .pack-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .muted { color: #8C8F97; font-size: 10px; }
        button.link { border: 0; padding: 0 2px; background: none; color: #A9ABAF; font-weight: 400; font-size: 10px; }
        button.link:hover { color: #FD9891; }
      </style>
      <form>
        <label>
          <span>Chippy URL</span>
          <input data-helper-url type="url" inputmode="url" required placeholder="${DEFAULT_HELPER}" />
        </label>
        ${pluginMarkup()}
        ${packMarkup()}
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
  const pluginRowsHeight = PLUGIN_OPTIONS.length ? 18 + 19 * PLUGIN_OPTIONS.length : 0;
  const packSectionHeight = 110;
  host.style.cssText = `display:block;min-height:${124 + pluginRowsHeight + packSectionHeight}px;`;
  const root = host.attachShadow({ mode: 'closed' });
  const surface = document.createElement('div');
  surface.innerHTML = settingsMarkup();
  root.appendChild(surface);

  const form = root.querySelector('form');
  const helperInput = root.querySelector('[data-helper-url]');
  const pluginInputs = Array.from(root.querySelectorAll('[data-plugin]'));
  const statusNode = root.querySelector('[data-status]');
  const packList = root.querySelector('[data-pack-list]');
  const packInput = root.querySelector('[data-pack-input]');
  let packLibrary = [];
  let activePackIds = new Set();

  function setStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.setAttribute('data-error', isError ? 'true' : 'false');
  }

  function readPackToggles() {
    activePackIds = new Set(Array.from(root.querySelectorAll('[data-pack]')).filter((input) => input.checked).map((input) => input.value));
  }

  function renderPacks() {
    packList.innerHTML = packRowsMarkup(packLibrary, activePackIds);
  }

  function packSettings() {
    return {
      packs: packLibrary,
      activePacks: packLibrary.map((pack) => pack.id).filter((id) => activePackIds.has(id)),
    };
  }

  async function savePacks() {
    await chrome.storage.local.set(packSettings());
  }

  packList.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-remove-pack]');
    if (!button) return;
    const id = button.getAttribute('data-remove-pack');
    readPackToggles();
    packLibrary = packLibrary.filter((pack) => pack.id !== id);
    activePackIds.delete(id);
    renderPacks();
    try {
      await savePacks();
      setStatus(`Removed ${id}.`);
    } catch (error) {
      setStatus(error.message || 'Could not remove pack.', true);
    }
  });

  chrome.storage.local.get({
    helperBaseUrl: DEFAULT_HELPER,
    plugins: DEFAULT_PLUGINS,
    packs: [],
    activePacks: [],
  }).then((stored) => {
    helperInput.value = normalizeBaseUrl(stored.helperBaseUrl);
    const plugins = Array.isArray(stored.plugins) ? stored.plugins : [];
    for (const input of pluginInputs) input.checked = plugins.includes(input.value);
    packLibrary = Array.isArray(stored.packs) ? stored.packs.filter((pack) => pack && typeof pack.id === 'string') : [];
    activePackIds = new Set(Array.isArray(stored.activePacks) ? stored.activePacks : []);
    renderPacks();
  }).catch((error) => setStatus(error.message || 'Could not load settings.', true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const helperBaseUrl = normalizeBaseUrl(helperInput.value);
    if (!validateHelperUrl(helperBaseUrl)) {
      setStatus('Use an http(s) URL.', true);
      return;
    }

    readPackToggles();
    let added = [];
    const packText = packInput.value.trim();
    if (packText) {
      try {
        added = parsePackInput(packText);
      } catch (error) {
        setStatus(error.message, true);
        return;
      }
    }

    try {
      const plugins = pluginInputs.filter((input) => input.checked).map((input) => input.value);
      // A newly added pack replaces a loaded pack with the same id and starts active.
      for (const pack of added) {
        packLibrary = [...packLibrary.filter((one) => one.id !== pack.id), pack];
        activePackIds.add(pack.id);
      }
      await chrome.storage.local.set({ helperBaseUrl, plugins, ...packSettings() });
      packInput.value = '';
      renderPacks();
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
