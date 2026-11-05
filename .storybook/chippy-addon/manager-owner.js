// The addon owns Chippy for the whole Storybook page, not only the preview
// iframe. The Chippy extension injects into the top frame, which is the
// Storybook manager, and stands down when a live owner of another integration
// holds window.__CHIPPY_OWNER__. Claiming the manager window keeps agents on the
// preview's `storybook` client instead of Storybook's own UI.
const OWNER_ID = 'storybook-addon-manager';
const STALE_AFTER_MS = 15_000;
const HEARTBEAT_MS = 5_000;

export const MANAGER_INTEGRATION = Object.freeze({
  kind: 'storybook',
  who: 'Chippy Storybook addon',
  source: '.storybook/chippy-addon/manager-owner.js',
  reinjectsOnReload: true,
  reloadAction: 'The manager window holds no Chippy client; the preview iframe is the inspected page.',
});

export function claimManagerOwner(scope = globalThis) {
  const now = Date.now();
  scope.__CHIPPY_OWNER__ = {
    ownerId: OWNER_ID,
    ownerType: OWNER_ID,
    integration: MANAGER_INTEGRATION,
    staleAfterMs: STALE_AFTER_MS,
    startedAt: now,
    heartbeatAt: now,
  };
  try {
    scope.dispatchEvent(new CustomEvent('chippy-owner-claimed', { detail: JSON.stringify({ ownerId: OWNER_ID }) }));
  } catch (_) {}
  const timer = setInterval(() => {
    if (scope.__CHIPPY_OWNER__?.ownerId === OWNER_ID) scope.__CHIPPY_OWNER__.heartbeatAt = Date.now();
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

// An extension bridge that did not stand down, such as one from an older
// extension version, is still connected to the helper from this window.
export function extensionBridgeInManager(scope = globalThis) {
  const state = scope.__CHIPPY?.pageBridge?.getState?.();
  return state?.integration?.kind === 'extension' && state.connState !== 'yielded' ? state : null;
}
