const OWNER_ID = 'storybook-addon';
const OWNER_TYPE = 'storybook-addon';
const HELPER_BASE_URL = 'http://127.0.0.1:7823';
const STALE_AFTER_MS = 15_000;
const INTEGRATION = Object.freeze({
  kind: 'storybook',
  who: 'Chippy Storybook addon',
  source: '.storybook/chippy-addon/setup.js',
  reinjectsOnReload: true,
  reloadAction: 'Chippy remounts the current SUT through Storybook FORCE_REMOUNT without reloading the preview iframe.',
});

async function lookupAvalancheArm() {
  try {
    const url = `${HELPER_BASE_URL.replace(/\/+$/, '')}/__chippy/api/avalanche-arm?origin=${encodeURIComponent(location.href)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.armed && data.config ? data.config : null;
  } catch (_) {
    return null;
  }
}

const avalancheArm = await lookupAvalancheArm();

function acquireOwner(mode = 'chippy') {
  const now = Date.now();
  const current = globalThis.__CHIPPY_OWNER__ || null;
  if (
    !current ||
    current.ownerId === OWNER_ID ||
    (current.heartbeatAt && now - current.heartbeatAt > STALE_AFTER_MS)
  ) {
    const owner = {
      ...(current?.ownerId === OWNER_ID ? current : {}),
      ownerId: OWNER_ID,
      ownerType: OWNER_TYPE,
      transport: 'storybook-static',
      ui: 'storybook-panel',
      mode,
      helperBaseUrl: HELPER_BASE_URL,
      integration: INTEGRATION,
      staleAfterMs: STALE_AFTER_MS,
      startedAt: current?.ownerId === OWNER_ID ? current.startedAt || now : now,
      heartbeatAt: now,
    };
    globalThis.__CHIPPY_OWNER__ = owner;
    globalThis.__CHIPPY_LOCK__ = globalThis.__CHIPPY_LOCK__ || {};
    globalThis.__CHIPPY_LOCK__.get = () => globalThis.__CHIPPY_OWNER__ || null;
    globalThis.__CHIPPY_LOCK__.heartbeat = (ownerId, patch = {}) => {
      if (globalThis.__CHIPPY_OWNER__?.ownerId !== ownerId) {
        return { ok: false, reason: 'not-owner', owner: globalThis.__CHIPPY_OWNER__ || null };
      }
      globalThis.__CHIPPY_OWNER__ = { ...globalThis.__CHIPPY_OWNER__, ...patch, heartbeatAt: Date.now() };
      return { ok: true, owner: globalThis.__CHIPPY_OWNER__ };
    };
    globalThis.__CHIPPY_LOCK__.release = (ownerId) => {
      if (globalThis.__CHIPPY_OWNER__?.ownerId !== ownerId) {
        return { ok: false, reason: 'not-owner', owner: globalThis.__CHIPPY_OWNER__ || null };
      }
      const owner = globalThis.__CHIPPY_OWNER__;
      delete globalThis.__CHIPPY_OWNER__;
      return { ok: true, owner };
    };
    return { ok: true, owner, reused: current?.ownerId === OWNER_ID, replacedStale: !!(current && current.ownerId !== OWNER_ID) };
  }
  return { ok: false, reason: 'owned-by-other-chippy', owner: current };
}

const ownerResult = acquireOwner('chippy');
globalThis.__CHIPPY_OWNER_RESULT__ = ownerResult;
if (!ownerResult.ok) {
  globalThis.__CHIPPY_BLOCKED__ = ownerResult;
} else {
  globalThis.__CHIPPY_STARTUP_CONFIG = {
    ...(globalThis.__CHIPPY_STARTUP_CONFIG || {}),
    helperBaseUrl: HELPER_BASE_URL,
    activated: false,
    ui: 'storybook-panel',
    ownerType: OWNER_TYPE,
    ownerId: OWNER_ID,
    transport: 'storybook-static',
    mode: 'chippy',
    integration: INTEGRATION,
    avalanche: avalancheArm,
    staleAfterMs: STALE_AFTER_MS,
  };
  globalThis.__CHIPPY = globalThis.__CHIPPY || {};
  globalThis.__CHIPPY.config = { ...(globalThis.__CHIPPY.config || {}), ...globalThis.__CHIPPY_STARTUP_CONFIG };
}

export { HELPER_BASE_URL, INTEGRATION, OWNER_ID, OWNER_TYPE, STALE_AFTER_MS, ownerResult };
