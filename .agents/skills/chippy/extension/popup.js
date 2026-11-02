/* eslint-disable */
const DEFAULT_HELPER = 'http://127.0.0.1:7823';

const btnActivate = document.querySelector('#btn-activate');
const btnDeactivate = document.querySelector('#btn-deactivate');

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function getOrigin(tab) {
  try {
    return new URL(tab?.url || '').origin;
  } catch {
    return null;
  }
}

async function getStoredConfig() {
  return chrome.storage.local.get({
    helperBaseUrl: DEFAULT_HELPER,
    enabledOrigins: {},
  });
}

async function setOriginEnabled(origin, enabled) {
  const stored = await getStoredConfig();
  const enabledOrigins = { ...(stored.enabledOrigins || {}) };
  if (enabled) enabledOrigins[origin] = true;
  else delete enabledOrigins[origin];
  await chrome.storage.local.set({ enabledOrigins });
  return stored;
}

async function renderState() {
  const tab = await getActiveTab();
  const origin = getOrigin(tab);
  if (!tab || !origin) {
    btnActivate.disabled = true;
    btnDeactivate.disabled = true;
    return;
  }

  const stored = await getStoredConfig();
  const enabled = Boolean(stored.enabledOrigins?.[origin]);
  btnActivate.disabled = enabled;
  btnDeactivate.disabled = !enabled;
}

btnActivate.addEventListener('click', async () => {
  const tab = await getActiveTab();
  const origin = getOrigin(tab);
  if (!tab || !origin) return;

  const stored = await setOriginEnabled(origin, true);
  try {
    await chrome.runtime.sendMessage({ type: 'chippy-ensure-content-script', tabId: tab.id });
    await chrome.runtime.sendMessage({
      type: 'chippy-inject-bundle',
      tabId: tab.id,
      helperBaseUrl: stored.helperBaseUrl || DEFAULT_HELPER,
    });
  } catch {}
  window.close();
});

btnDeactivate.addEventListener('click', async () => {
  const tab = await getActiveTab();
  const origin = getOrigin(tab);
  if (!tab || !origin) return;

  await setOriginEnabled(origin, false);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'chippy-disable-now' });
  } catch {}
  window.close();
});

renderState();
