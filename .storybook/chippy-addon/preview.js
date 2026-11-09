import { addons } from 'storybook/preview-api';
import { FORCE_REMOUNT, STORY_CHANGED, STORY_HOT_UPDATED } from 'storybook/internal/core-events';
import { EVENTS, PREVIEW_MESSAGE_SOURCE } from './constants.js';
import { OWNER_ID, avalancheArmReady, ownerResult } from './setup.js';

import '../../.agents/skills/chippy/extension/inspect-react.js';
import '../../.agents/skills/chippy/extension/panel-dom.js';
import '../../.agents/skills/chippy/extension/layout-lab.js';
import '../../.agents/skills/chippy/extension/resolve-probes.js';
import avalanche from '../../.agents/skills/chippy/extension/avalanche.es.js';
import '../../.agents/skills/chippy/extension/frame-link.js';
import '../../.agents/skills/chippy/extension/chippy-page-bridge.js';

if (ownerResult.ok) {
  globalThis.__AVALANCHE__ = globalThis.__AVALANCHE__ || avalanche;
}

function emit(channel, event, payload) {
  try {
    channel.emit(event, payload);
  } catch {
    // Storybook channel can be briefly unavailable during preview reloads.
  }
}

function getBridge() {
  return globalThis.__CHIPPY?.pageBridge || null;
}

function getAvalancheApi() {
  return globalThis.__AVALANCHE__ || avalanche || null;
}

function runAvalanche(action, command = {}) {
  const api = getAvalancheApi();
  const dispatcher = api?.bridge?.evalAvalanche;
  if (typeof dispatcher !== 'function') {
    return { ok: false, available: !!api, action, error: 'avalanche dispatcher unavailable' };
  }
  return dispatcher({ action, ...command }, api, api);
}

let avalancheStoryId = null;
let avalancheAutoCache = null;

function currentStoryId() {
  return globalThis.__STORYBOOK_PREVIEW__?.selectionStore?.selection?.storyId
    || new URLSearchParams(globalThis.location.search || '').get('id')
    || globalThis.__STORYBOOK_STORY_STORE__?.selection?.storyId
    || null;
}

// Storybook remounts only the render whose id matches FORCE_REMOUNT's storyId.
// Return that id, or null when no rendered story matches.
function remountTargetId() {
  const storyId = currentStoryId();
  const renders = globalThis.__STORYBOOK_PREVIEW__?.storyRenders;
  if (!Array.isArray(renders)) return storyId;
  return renders.some((render) => render.id === storyId) ? storyId : null;
}

// Install Avalanche with the options of a reload-with-avalanche arm. Returns
// true when this call installed it.
function installFromArm(arm) {
  const api = getAvalancheApi();
  if (!ownerResult.ok || !arm?.autoStart || typeof api?.install !== 'function' || api.status?.().installed) return false;
  try {
    api.install({
      detectionMode: arm.options?.detectionMode || 'sources',
      historySize: arm.max || 1000,
      captureFibers: arm.options?.captureFibers !== false,
    });
  } catch (_) {
    return false;
  }
  avalancheStoryId = currentStoryId();
  avalancheAutoCache = null;
  return true;
}

// The arm lookup in setup.js resolves after module evaluation; the global
// loader below holds the first story render until it has been applied.
const armApplied = avalancheArmReady.then(installFromArm, () => false);

function ensureAvalancheInstalled({ resetForStory = false } = {}) {
  const storyId = currentStoryId();
  const status = runAvalanche('status');
  const installed = status?.status?.installed || status?.result?.status?.installed;
  if (!installed) {
    runAvalanche('install', { options: { detectionMode: 'sources', historySize: 5000, captureFibers: true } });
    avalancheStoryId = storyId;
    avalancheAutoCache = null;
    return;
  }
  if (resetForStory && storyId && storyId !== avalancheStoryId) {
    runAvalanche('clear');
    avalancheStoryId = storyId;
    avalancheAutoCache = null;
  }
}

function refreshAvalancheAuto() {
  ensureAvalancheInstalled({ resetForStory: true });
  avalancheAutoCache = {
    storyId: currentStoryId(),
    status: runAvalanche('status'),
    hotSources: runAvalanche('hot-sources', { limit: 50 }),
    commitList: runAvalanche('commit-list', { top: 1000, by: 'collateral' }),
  };
  return avalancheAutoCache;
}

function statePayload(extra = {}) {
  const bridge = getBridge();
  const mode = globalThis.__CHIPPY_OWNER__?.mode || bridge?.getState?.()?.config?.mode;
  const avalancheAuto = mode === 'avalanche' ? refreshAvalancheAuto() : avalancheAutoCache;
  return {
    ok: !!bridge,
    owner: globalThis.__CHIPPY_OWNER__ || null,
    blocked: globalThis.__CHIPPY_BLOCKED__ || null,
    state: bridge?.getState?.() || null,
    avalancheStatus: avalancheAuto?.status || runAvalanche('status'),
    avalancheAuto,
    ...extra,
  };
}

function activeMode() {
  return globalThis.__CHIPPY_OWNER__?.mode || globalThis.__CHIPPY?.pageBridge?.getState?.()?.config?.mode;
}

function resetAvalancheForBoundary(reason) {
  runAvalanche('clear');
  avalancheStoryId = currentStoryId();
  avalancheAutoCache = null;
  if (activeMode() === 'avalanche') {
    ensureAvalancheInstalled();
    refreshAvalancheAuto();
    publishState(channel, `avalanche-reset:${reason}`);
  }
}

function syncActiveLifecycle() {
  if (activeMode() === 'avalanche') ensureAvalancheInstalled({ resetForStory: true });
}

function publishState(channel, reason = 'state') {
  syncActiveLifecycle();
  emit(channel, EVENTS.STATE, statePayload({ reason }));
}

function executeCommand(command) {
  const bridge = getBridge();
  if (!bridge) return { ok: false, error: 'bridge-not-ready' };
  switch (command?.type) {
    case 'activate':
      bridge.activate?.();
      return { ok: true };
    case 'deactivate':
      bridge.deactivate?.();
      return { ok: true };
    case 'ensure-probes':
      bridge.activate?.();
      bridge.ensureProbes?.();
      return { ok: true };
    case 'clear-probes':
      bridge.clearProbes?.();
      return { ok: true };
    case 'set-probe-annotation': {
      const annotation = bridge.setProbeAnnotation?.(command.markerId, {
        intent: command.intent ?? null,
        comment: command.comment ?? '',
      });
      return annotation
        ? { ok: true, markerId: command.markerId, annotation }
        : { ok: false, error: `probe-not-found:${command.markerId || 'missing'}` };
    }
    case 'avalanche-install': {
      globalThis.__CHIPPY_LOCK__?.heartbeat?.(OWNER_ID, { mode: 'avalanche' });
      bridge.applyConfig?.({ mode: 'avalanche', activated: false });
      ensureAvalancheInstalled({ resetForStory: true });
      return runAvalanche('status');
    }
    case 'avalanche-stop':
      return runAvalanche('uninstall');
    case 'avalanche-clear':
      ensureAvalancheInstalled();
      return runAvalanche('clear');
    case 'avalanche-status':
      ensureAvalancheInstalled();
      return runAvalanche('status');
    case 'avalanche-export':
      ensureAvalancheInstalled();
      return runAvalanche('export');
    case 'avalanche-hot-sources':
      ensureAvalancheInstalled();
      return runAvalanche('hot-sources', { limit: command.limit || 50 });
    case 'avalanche-commit-list':
      ensureAvalancheInstalled();
      return runAvalanche('commit-list', { top: command.top || 1000, by: command.by || 'collateral' });
    case 'avalanche-commit-peek':
      ensureAvalancheInstalled();
      return runAvalanche('commit-peek', {
        commitId: command.commitId,
        include: command.include || ['stats', 'sources', 'timing', 'metrics', 'actions'],
        maxItems: command.maxItems || 20,
      });
    case 'inspect-boundary':
      // Report the selected collateral boundary (owner/error/suspense) + its
      // fiber-hop distance back to the backend. The click already carries the
      // resolved descriptor; the addon acknowledges it as a first-class result
      // so downstream consumers can act on the collateral boundary.
      return {
        ok: true,
        markerId: command.markerId ?? null,
        boundaryKind: command.boundaryKind ?? null,
        boundary: command.boundary ?? null,
        distance: command.distance ?? command.boundary?.distance ?? null,
      };
    default:
      return { ok: false, error: `unknown-command:${command?.type || 'missing'}` };
  }
}

const channel = addons.getChannel();

function handleMode(mode) {
  globalThis.__CHIPPY_LOCK__?.heartbeat?.(OWNER_ID, { mode });
  const bridge = getBridge();
  if (bridge?.applyConfig) bridge.applyConfig(mode === 'chippy' ? { mode } : { mode, activated: false });
  if (mode !== 'chippy') {
    bridge?.clearProbes?.();
  }
  if (mode === 'avalanche') ensureAvalancheInstalled({ resetForStory: true });
  publishState(channel, 'mode');
}

function handleCommand(command) {
  const result = executeCommand(command);
  emit(channel, EVENTS.RESULT, { command, result, state: statePayload({ reason: 'command' }) });
  publishState(channel, `command:${command?.type || 'unknown'}`);
}

channel.on(EVENTS.REQUEST_STATE, () => publishState(channel, 'request'));
channel.on(EVENTS.SET_MODE, handleMode);
channel.on(EVENTS.COMMAND, handleCommand);
channel.on(STORY_CHANGED, () => resetAvalancheForBoundary('story-changed'));
channel.on(FORCE_REMOUNT, () => resetAvalancheForBoundary('force-remount'));
channel.on(STORY_HOT_UPDATED, () => resetAvalancheForBoundary('story-hot-updated'));
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.source !== PREVIEW_MESSAGE_SOURCE) return;
  if (data.event === EVENTS.SET_MODE) handleMode(data.payload);
  if (data.event === EVENTS.COMMAND) handleCommand(data.payload);
});

window.addEventListener('chippy-storybook-force-remount', (event) => {
  // Keep Storybook's manager and preview alive. FORCE_REMOUNT replaces only
  // the rendered SUT, unlike reloading the preview iframe document. The event
  // stays unhandled, and the helper reports the remount as failed, when no
  // rendered story can be remounted.
  const storyId = remountTargetId();
  if (!storyId) return;
  // An armed remount installs Avalanche first; the FORCE_REMOUNT listener
  // above then clears history, so the capture starts with the remount.
  installFromArm(event.detail?.avalanche);
  emit(channel, FORCE_REMOUNT, { storyId });
  event.preventDefault();
});

window.addEventListener('chippy-conn-state', () => publishState(channel, 'conn-state'));
window.addEventListener('layout-lab:update', () => publishState(channel, 'layout-lab'));

// A marker starts life after a manager-panel button was focused. Because the
// shared drag handler prevents pointerdown's default, Storybook would otherwise
// keep keyboard focus in the manager document and arrow navigation would never
// reach the preview iframe.
document.addEventListener('pointerdown', (event) => {
  const marker = event.target?.closest?.('[data-layout-lab-marker]');
  marker?.focus?.({ preventScroll: true });
}, true);

setInterval(() => {
  globalThis.__CHIPPY_LOCK__?.heartbeat?.(OWNER_ID);
  publishState(channel, 'heartbeat');
}, 5000);

publishState(channel, ownerResult.ok ? 'ready' : 'blocked');

export const decorators = [
  (Story) => Story(),
];

export const loaders = [
  async () => {
    await armApplied;
    return {};
  },
];
