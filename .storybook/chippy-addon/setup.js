const OWNER_ID = 'storybook-addon';
const OWNER_TYPE = 'storybook-addon';
const HELPER_BASE_URL = 'http://127.0.0.1:7823';
const STALE_AFTER_MS = 15_000;
// A preview opened on its own (`iframe.html` as the top frame) has no manager
// panel to switch probes on, so it uses Chippy's in-page panel instead.
const STANDALONE_PREVIEW = globalThis.top === globalThis;
const UI = STANDALONE_PREVIEW ? 'in-page' : 'storybook-panel';
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
      ui: UI,
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
    activated: STANDALONE_PREVIEW,
    ui: UI,
    ownerType: OWNER_TYPE,
    ownerId: OWNER_ID,
    transport: 'storybook-static',
    mode: 'chippy',
    integration: INTEGRATION,
    avalanche: null,
    staleAfterMs: STALE_AFTER_MS,
  };
  globalThis.__CHIPPY = globalThis.__CHIPPY || {};
  globalThis.__CHIPPY.config = { ...(globalThis.__CHIPPY.config || {}), ...globalThis.__CHIPPY_STARTUP_CONFIG };
}

// The arm lookup must not block module evaluation: top-level await fails
// `storybook build` under Vite's default browser targets. preview.js waits on
// this promise in a global loader, so the first story renders after the arm is
// known and its mount is captured.
function applyAvalancheArm(arm) {
  if (!arm || !ownerResult.ok) return null;
  globalThis.__CHIPPY_STARTUP_CONFIG = { ...(globalThis.__CHIPPY_STARTUP_CONFIG || {}), avalanche: arm };
  globalThis.__CHIPPY.config = { ...(globalThis.__CHIPPY.config || {}), avalanche: arm };
  return arm;
}

const avalancheArmReady = ownerResult.ok ? lookupAvalancheArm().then(applyAvalancheArm) : Promise.resolve(null);

export { HELPER_BASE_URL, INTEGRATION, OWNER_ID, OWNER_TYPE, STALE_AFTER_MS, avalancheArmReady, ownerResult };
