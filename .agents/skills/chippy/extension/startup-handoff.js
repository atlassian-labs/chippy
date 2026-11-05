/* eslint-disable */
// Runs in MAIN at document_start, before avalanche.iife.js, on the one
// navigation that follows an armed reload. The page bridge stored the arm in
// sessionStorage just before reloading; reading it here is synchronous, so the
// startup config exists when Avalanche evaluates and the detector installs
// before React's first commit. The entry is removed on read and ignored when old.
(function chippyStartupHandoff(global) {
  var KEY = '__chippyStartupHandoff';
  var MAX_AGE_MS = 60000;
  var handoff = null;
  try {
    var raw = global.sessionStorage.getItem(KEY);
    if (raw == null) return;
    global.sessionStorage.removeItem(KEY);
    handoff = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (!handoff || !handoff.avalanche || !handoff.avalanche.autoStart) return;
  if (!(Date.now() - Number(handoff.at) <= MAX_AGE_MS)) return;
  if (global.__CHIPPY_STARTUP_CONFIG) return;
  global.__CHIPPY_STARTUP_CONFIG = {
    enabled: true,
    helperBaseUrl: handoff.helperBaseUrl,
    avalanche: handoff.avalanche,
    plugins: Array.isArray(handoff.plugins) ? handoff.plugins : undefined,
    contextUiEnabled: true,
    startupSource: 'armed-reload-handoff',
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
