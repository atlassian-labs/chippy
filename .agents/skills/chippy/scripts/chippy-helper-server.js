/* eslint-disable */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const {
  PLAYWRIGHT_UNAVAILABLE_CODE,
  getPlaywrightAvailability,
  launchSession,
} = require('../browser-scripts/playwright-session');
const { createProbeAnnotationChannel } = require('./probe-annotation-channel');
const helperAccess = require('./helper-access');
const pageSocketTrust = require('./page-socket-trust');
const helperProxy = require('./helper-proxy');
 
// ─── Config ───────────────────────────────────────────────────────────────────

const CHIPPY_PREFIX = '/__chippy';
const CHIPPY_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'extension', 'manifest.json'), 'utf8')).version || 'unknown';
  } catch { return 'unknown'; }
})();
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const EXTENSION_ROOT = path.join(path.resolve(__dirname, '..'), 'extension');
// avalanche.iife.js is injected by the extension via chrome.scripting (MAIN world,
// pre-document). Helper bundle excludes it to avoid double install
// ("[avalanche] __AVALANCHE__ already defined; overwriting").
const INJECT_FILES = ['inspect-react.js', 'panel-dom.js', 'layout-lab.js', 'resolve-probes.js', 'chippy-page-bridge.js'];

function cliFlag(flag) {
  const i = process.argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i === -1) return null;
  const v = process.argv[i];
  return v.includes('=') ? v.split('=').slice(1).join('=') : process.argv[i + 1] || null;
}

const port = Number(cliFlag('--port') || process.env.CHIPPY_HELPER_PORT || 7823);
const host = cliFlag('--host') || process.env.CHIPPY_HELPER_HOST || '127.0.0.1';
const loopbackBind = helperAccess.isLoopbackBind(host);
const helperToken = helperAccess.createHelperToken();

const clients = new Map(); // clientId → client object
const pendingComputedStyle = new Map(); // requestId → { resolve, timer }
const pendingEvalProbe = new Map(); // requestId → { resolve, timer }
const pendingAvalanche = new Map(); // requestId → { resolve, timer }
const pendingReloadAck = new Map(); // requestId → { resolve, timer }
const pendingEvalScript = new Map(); // requestId → { resolve, timer }
const pendingProbeCommand = new Map(); // requestId → { resolve, timer }
const armedAvalanche = new Map(); // origin → { autoStart, max }
const armedAvalancheByClient = new Map(); // clientId → { autoStart, max }
const playwrightSessions = new Map(); // clientId → { browser, context, page, createdAt, sourceClientId }
const recentPageActivity = []; // newest first, bounded in memory
const fiberStateCaptures = new Map(); // captureId → compact page-side structural capture
const MAX_FIBER_STATE_CAPTURES = 20;
const probeAnnotations = createProbeAnnotationChannel({
  serializeMarker: (marker) => sliceMarker(marker, 'standard', null),
});

const IMPORT_INTEGRATION = Object.freeze({
  kind: 'import',
  who: 'Chippy helper module import',
  source: '.agents/skills/chippy/scripts/chippy-helper-server.js',
  reinjectsOnReload: false,
  reloadAction: "Run import('http://127.0.0.1:7823/__chippy/inject.mjs') again after every full page reload or navigation.",
});

function waitForPendingResult(pendingMap, requestId, timeoutMs, timeoutError) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingMap.delete(requestId);
      resolve({ ok: false, error: timeoutError });
    }, Number(timeoutMs) || 5000);
    pendingMap.set(requestId, { resolve, timer });
  });
}

// The page answered, but without the Avalanche runtime it cannot run the
// command. Report that as an unavailable runtime instead of an empty result.
const BRIDGE_MODULE_MISSING_HINT = 'The page has the Chippy bridge but not the Avalanche runtime (avalanche.iife.js). '
  + 'Load it after inject.js, import /__chippy/inject.mjs instead, or reload a page managed by the extension or proxy.';

function pageResultStatus(result) {
  if (!result.ok) return 504;
  return result.result && result.result.code === 'bridge-module-missing' ? 503 : 200;
}

function withPageResultHint(result) {
  if (pageResultStatus(result) !== 503) return result;
  return { ...result, ok: false, error: result.result.error, hint: BRIDGE_MODULE_MISSING_HINT };
}

function resolvePendingResult(pendingMap, requestId, result) {
  const pending = pendingMap.get(requestId);
  if (!pending) return false;
  pendingMap.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve({ ok: true, result });
  return true;
}

const { buildAvalancheCommand: _buildAvalancheCommandPure } = require('./build-avalanche-command');
const {
  buildFiberStateCaptureCommand,
  buildFiberStateCompareCommand,
} = require('./build-fiber-state-command');

function buildAvalancheCommand(body = {}) {
  return _buildAvalancheCommandPure(body, crypto.randomUUID());
}

async function requestEvalScript(clientId, body = {}) {
  const timeoutMs = body.timeoutMs != null ? Number(body.timeoutMs) : 8000;
  const command = {
    type: 'eval-script',
    requestId: crypto.randomUUID(),
    source: String(body.source || ''),
    args: body.args && typeof body.args === 'object' ? body.args : {},
    timeoutMs: body.scriptTimeoutMs != null ? Number(body.scriptTimeoutMs) : 5000,
  };
  if (!command.source.trim()) {
    return { ok: false, code: 400, payload: { ok: false, error: 'eval-script: empty source' } };
  }
  const delivered = sendToClient(clientId, command);
  if (!delivered.ok) return { ok: false, code: delivered.code, payload: { ok: false, error: delivered.error } };
  const result = await waitForPendingResult(pendingEvalScript, command.requestId, timeoutMs, 'Timeout waiting for eval-script result');
  return {
    ok: result.ok,
    code: result.ok ? 200 : 504,
    payload: { ...result, targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom, requestId: command.requestId },
  };
}

async function requestAvalanche(clientId, body = {}) {
  const timeoutMs = body.timeoutMs != null ? Number(body.timeoutMs) : 5000;
  const command = buildAvalancheCommand(body);
  const delivered = sendToClient(clientId, command);
  if (!delivered.ok) return { ok: false, code: delivered.code, payload: { ok: false, error: delivered.error } };
  const result = await waitForPendingResult(pendingAvalanche, command.requestId, timeoutMs, 'Timeout waiting for avalanche result');
  return {
    ok: result.ok,
    code: result.ok ? 200 : 504,
    payload: { ...result, targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom, requestId: command.requestId },
  };
}

async function requestProbeCommand(clientId, command, timeoutMs = 10_000) {
  const requestId = crypto.randomUUID();
  const delivered = sendToClient(clientId, { ...command, requestId });
  if (!delivered.ok) return { ok: false, code: delivered.code, payload: { ok: false, error: delivered.error } };
  const result = await waitForPendingResult(
    pendingProbeCommand,
    requestId,
    Math.max(100, Number(timeoutMs || 10_000)),
    'Timeout waiting for probe command result'
  );
  const status = pageResultStatus(result);
  return {
    ok: status === 200,
    code: status,
    payload: { ...withPageResultHint(result), targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom, requestId },
  };
}

function summarizeFiberStateCapture(entry) {
  return {
    captureId: entry.captureId,
    label: entry.label,
    clientId: entry.clientId,
    page: entry.state.page,
    capturedAt: entry.state.capturedAt,
    fiberCount: entry.state.fiberCount,
    truncated: entry.state.truncated,
  };
}

function resolveFiberStateCapture(captureId) {
  const id = String(captureId || '').trim();
  if (!id) return { ok: false, code: 400, error: 'captureId required' };
  if (fiberStateCaptures.has(id)) return { ok: true, capture: fiberStateCaptures.get(id) };
  const matches = Array.from(fiberStateCaptures.values()).filter((entry) => entry.captureId.startsWith(id));
  if (matches.length === 1) return { ok: true, capture: matches[0] };
  if (matches.length > 1) return { ok: false, code: 409, error: `Ambiguous captureId prefix ${id}` };
  return { ok: false, code: 404, error: `Fiber state capture not found: ${id}` };
}

function retainFiberStateCapture(entry) {
  fiberStateCaptures.set(entry.captureId, entry);
  while (fiberStateCaptures.size > MAX_FIBER_STATE_CAPTURES) {
    fiberStateCaptures.delete(fiberStateCaptures.keys().next().value);
  }
}

async function collectProbeDescriptors(clientId, probeIds) {
  const resolved = resolveClientId(clientId);
  if (!resolved.ok) throw new Error(resolved.error);
  const ids = (Array.isArray(probeIds) && probeIds.length ? probeIds : ['1', '2']).map((id) => String(id));
  const source = `
    return ((ctx) => {
      const ids = Array.isArray(ctx.args?.probeIds) ? ctx.args.probeIds : [];
      const out = {};
      for (const probeId of ids) {
        const probe = globalThis.__CHIPPY?.layoutLab?.getMarkerProbe?.(String(probeId))?.probe;
        const target = probe?._targetEl || null;
        out[String(probeId)] = target
          ? globalThis.__CHIPPY.captureProbeDescriptor(target)
          : { ok: false, error: 'Probe not placed' };
      }
      return out;
    })(ctx);
  `;
  const result = await requestEvalScript(clientId, { source, args: { probeIds: ids }, timeoutMs: 8000, scriptTimeoutMs: 5000 });
   if (!result.ok) throw new Error(result.payload?.error || 'Could not capture descriptors');
  return result.payload?.result?.result || result.payload?.result || {};
}
 
async function waitForNewClient(previousIds, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const [nextClientId] of clients.entries()) {
      if (!previousIds.has(nextClientId)) return nextClientId;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Playwright client to connect');
}

async function handoffToPlaywright({ clientId, url, probeIds, browserName, headless }) {
  const playwrightAvailability = getPlaywrightAvailability();
  if (!playwrightAvailability.ok) {
    return {
      ok: false,
      code: 503,
      payload: {
        ok: false,
        code: playwrightAvailability.code,
        error: playwrightAvailability.error,
      },
    };
  }

  const resolved = resolveClientId(clientId);
  if (!resolved.ok) return { ok: false, code: resolved.code, payload: { ok: false, error: resolved.error } };
  const sourceClient = resolved.client;
  const sourceClientId = resolved.clientId;
  const targetUrl = String(url || sourceClient.page?.url || '').trim();
  if (!targetUrl) return { ok: false, code: 400, payload: { ok: false, error: 'url required (or source client must have page.url)' } };

  const descriptors = await collectProbeDescriptors(sourceClientId, probeIds);
  const selected = Object.entries(descriptors)
    .filter(([, entry]) => entry && entry.ok && entry.descriptor)
    .map(([probeId, entry]) => ({ probeId, descriptor: entry.descriptor }));
  if (!selected.length) {
    return { ok: false, code: 400, payload: { ok: false, error: 'No live probes could be captured as descriptors', descriptors } };
  }

  const previousIds = new Set(clients.keys());
  const session = await launchSession({ browserName: browserName || 'chromium', url: targetUrl, headless: headless !== false });
  const targetClientId = await waitForNewClient(previousIds, 10000);
  const targetClient = clients.get(targetClientId);
  if (targetClient) {
    targetClient.transport = 'playwright';
    targetClient.sourceClientId = clientId;
  }
  playwrightSessions.set(targetClientId, { ...session, createdAt: nowIso(), sourceClientId: clientId, descriptors: selected });

  return {
    ok: true,
    code: 200,
    payload: {
      ok: true,
      sourceClientId,
      targetClientId,
      url: targetUrl,
      descriptors: Object.fromEntries(selected.map(({ probeId, descriptor }) => [probeId, descriptor])),
      target: targetClient ? summarizeClient(targetClient, 'standard') : null,
    },
  };
}
 
// When active, non-Chippy requests are forwarded to targetPort (proxy mode).
const proxyState = { active: false, targetPort: null, originalUrl: null, target: null, startedAt: null };

// ─── Proxy HTML injection ─────────────────────────────────────────────────────

function getProxyInjectTarget() {
  if (!proxyState.originalUrl) return null;
  try {
    const u = new URL(proxyState.originalUrl);
    return { pathname: u.pathname, search: u.search || '' };
  } catch { return null; }
}

function shouldInjectIntoProxyHtml(req, upstreamRes) {
  if (!proxyState.active || req.method !== 'GET') return false;
  const status = upstreamRes.statusCode || 0;
  if (status < 200 || status >= 300) return false;
  if (!String(upstreamRes.headers['content-type'] || '').includes('text/html')) return false;
  const target = getProxyInjectTarget();
  if (!target) return false;
  try {
    const u = new URL(req.url, 'http://proxy.local');
    return u.pathname === target.pathname && (!target.search || u.search === target.search);
  } catch { return false; }
}

function buildProxyInlineBundle() {
  const cfg = JSON.stringify({ activated: true, injectedByProxy: true });
  return [
    '<script data-chippy-proxy-bundle="true">',
    'window.__CHIPPY = window.__CHIPPY || {};',
    `window.__CHIPPY.config = { ...${cfg}, helperBaseUrl: window.location.origin };`,
    getInjectBundle(),
    '</script>',
  ].join('\n');
}

// Without the extension, the proxy does its job: the DevTools hook shim and the
// Avalanche runtime load before page code, and the page bridge connects last.
// startup-handoff.js turns an armed reload's stored arm into the startup config
// before Avalanche evaluates, so the detector installs before React commits.
const PROXY_EARLY_SCRIPTS = [
  `${CHIPPY_PREFIX}/devtools-hook-shim.js`,
  `${CHIPPY_PREFIX}/startup-handoff.js`,
  `${CHIPPY_PREFIX}/avalanche.iife.js`,
];

function injectIntoHtmlDocument(html) {
  return helperProxy.injectProxyDocument(html, {
    earlyScripts: PROXY_EARLY_SCRIPTS,
    bridgeBundle: buildProxyInlineBundle(),
  });
}

function stripHopHeaders(headers, bodyBuffer, stripCsp = false) {
  const next = { ...headers };
  delete next['content-length'];
  delete next['transfer-encoding'];
  delete next['content-encoding'];
  if (stripCsp) {
    delete next['content-security-policy'];
    delete next['content-security-policy-report-only'];
  }
  if (bodyBuffer) next['content-length'] = Buffer.byteLength(bodyBuffer);
  return next;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

function trimRecentActivity(limit = 30) {
  while (recentPageActivity.length > limit) recentPageActivity.pop();
}

function userVisiblePageName(client) {
  const title = client.page?.title || client.latestSnapshot?.page?.title || null;
  const storyId = client.page?.storyId || client.latestSnapshot?.page?.storyId || null;
  const url = client.page?.url || client.latestSnapshot?.page?.url || null;
  return title || storyId || url || `Page ${client.clientId.slice(0, 8)}`;
}

function pageLabel(client) {
  const name = userVisiblePageName(client);
  const storyId = client.page?.storyId || client.latestSnapshot?.page?.storyId || null;
  if (storyId && name !== storyId) return `${name} (${storyId})`;
  return name;
}

function recordClientActivity(client, reason, detail = null, at = nowIso()) {
  client.lastActivityAt = at;
  client.lastActivityReason = reason;
  client.activity = client.activity || {};
  client.activity.last = { reason, detail, at };
  if (reason === 'focus') client.activity.lastFocusedAt = at;
  if (reason === 'visible') client.activity.lastVisibleAt = at;
  if (reason === 'hidden') client.activity.lastHiddenAt = at;
  if (reason === 'pointer') client.activity.lastPointerAt = at;
  if (reason === 'snapshot') client.activity.lastSnapshotAt = at;
  if (reason === 'command') client.activity.lastCommandAt = at;
  if (reason === 'hello' || reason === 'open' || reason === 'connect') client.activity.lastConnectedAt = at;
  recentPageActivity.unshift({
    clientId: client.clientId,
    at,
    reason,
    detail,
    integration: client.integration || null,
    pageLabel: pageLabel(client),
    title: client.page?.title || client.latestSnapshot?.page?.title || null,
    url: client.page?.url || client.latestSnapshot?.page?.url || null,
    storyId: client.page?.storyId || client.latestSnapshot?.page?.storyId || null,
  });
  trimRecentActivity();
}

function baseUrlFromReq(req) {
  const fwd = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(fwd) ? fwd[0] : (typeof fwd === 'string' ? fwd.split(',')[0] : 'http');
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${port}`;
  return `${proto}://${hostHeader}`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

// The detector's canonical modes. An unknown string would reach
// createAvalancheDetector and leave its mode state unset.
const DETECTION_MODES = ['sources', 'full', 'stats', 'amplifiers'];
function detectionModeError(options) {
  const mode = options && typeof options === 'object' ? options.detectionMode : undefined;
  if (mode === undefined || DETECTION_MODES.includes(mode)) return null;
  return `detectionMode must be one of ${DETECTION_MODES.join(', ')} (got ${JSON.stringify(mode)})`;
}

function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res, code, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, ...CORS_HEADERS });
  res.end(payload);
}

// ─── WebSocket framing (RFC 6455, server-side) ────────────────────────────────

function wsSend(socket, payload, opcode = 0x1) {
  if (socket.destroyed) return;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function wsParseFrames(buffer, frag = {}) {
  const messages = [];
  let off = 0;
  while (off + 2 <= buffer.length) {
    const b0 = buffer[off], b1 = buffer[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let pLen = b1 & 0x7f, hLen = 2;
    if (pLen === 126) {
      if (off + 4 > buffer.length) break;
      pLen = buffer.readUInt16BE(off + 2); hLen = 4;
    } else if (pLen === 127) {
      if (off + 10 > buffer.length) break;
      pLen = Number(buffer.readBigUInt64BE(off + 2)); hLen = 10;
    }
    const mLen = masked ? 4 : 0;
    const total = hLen + mLen + pLen;
    if (off + total > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(off + hLen + mLen, off + hLen + mLen + pLen));
    if (masked) {
      const mask = buffer.subarray(off + hLen, off + hLen + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    off += total;

    // Control frames (close/ping/pong) pass through directly
    if (opcode === 0x8 || opcode === 0x9 || opcode === 0xA) {
      messages.push({ opcode, payload });
      continue;
    }
    // Data frame: start new or continue fragment
    if (opcode !== 0) { frag.opcode = opcode; frag.chunks = [payload]; }
    else if (frag.chunks) { frag.chunks.push(payload); }

    if (fin && frag.chunks) {
      const full = frag.chunks.length === 1 ? frag.chunks[0] : Buffer.concat(frag.chunks);
      messages.push({ opcode: frag.opcode, payload: full });
      frag.chunks = null; frag.opcode = null;
    }
  }
  return { messages, remainder: buffer.subarray(off) };
}

// ─── Duplicate-page detection ─────────────────────────────────────────────────

function pageKey(client) {
  const url = client.page?.url;
  if (!url) return null;
  try { const u = new URL(url); return `${u.origin}${u.pathname}${u.search}`; }
  catch { return url; }
}

function findDuplicatePageGroups() {
  const groups = new Map();
  for (const c of clients.values()) {
    const k = pageKey(c);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c.clientId);
  }
  const dupes = {};
  for (const [k, ids] of groups) { if (ids.length > 1) dupes[k] = ids; }
  return dupes;
}

function warnDuplicatesIfNeeded() {
  const dupes = findDuplicatePageGroups();
  const keys = Object.keys(dupes);
  if (!keys.length) return;
  for (const k of keys) console.warn(`⚠️  ${dupes[k].length} tabs open for "${k}" — ${dupes[k].join(', ')}`);
  for (const ids of Object.values(dupes)) {
    for (const id of ids) {
      const c = clients.get(id);
      if (c) wsSend(c.socket, JSON.stringify({
        type: 'command',
        command: { type: 'show-status', text: `⚠️ Chippy sees ${ids.length} tabs on this same page. Is that intentional?` },
      }));
    }
  }
}

// ─── Snapshot slicing ─────────────────────────────────────────────────────────
// ?slice=minimal  → name + key + confidence (default for list)
// ?slice=standard → + dom, props, source, truncated chains (default for single)
// ?slice=full     → everything
// ?boundaries=RE  → filter parent chain to matching names

function sliceMarker(marker, mode, boundaryRe) {
  if (!marker) return null;
  const base = {
    position: marker.position,
    docked: marker.docked ?? true,
    intent: marker.intent ?? null,
    comment: typeof marker.comment === 'string' ? marker.comment : '',
  };
  const r = marker.resolved;
  if (!r) return { ...base, resolved: null };

  let parents = r.component?.parents || [];
  const owners = r.component?.owners || [];

  if (boundaryRe) {
    try { parents = parents.filter((p) => p?.name && new RegExp(boundaryRe, 'i').test(p.name)); }
    catch { /* invalid regexp — keep all */ }
  }

  if (mode === 'minimal') {
    return { ...base, resolved: {
      confidence: r.confidence, note: r.note || null,
      nearestTestId: r.nearestTestId ?? null,
      dom: { tag: r.dom?.tag, text: r.dom?.text },
      component: { name: r.component?.name, key: r.component?.key ?? null },
    }};
  }
  if (mode === 'full') {
    return { ...base, resolved: { ...r, component: { ...r.component, parents, owners } } };
  }
  // standard
  return { ...base, resolved: {
    confidence: r.confidence, note: r.note || null,
    nearestTestId: r.nearestTestId ?? null,
    dom: r.dom,
    component: {
      name: r.component?.name, key: r.component?.key ?? null,
      props: r.component?.props,
      hookCount: r.component?.hookCount ?? null,
      hookCountTruncated: r.component?.hookCountTruncated ?? false,
      hookCountMax: r.component?.hookCountMax ?? null,
      source: r.component?.source,
      owners: owners.slice(0, 10),
      componentStack: r.component?.componentStack,
      parents: boundaryRe ? parents : parents.slice(0, 20),
    },
  }};
}

function sliceSnapshot(snapshot, mode, boundaryRe) {
  if (!snapshot) return null;
  const markers = snapshot.markers || {};
  return { ...snapshot, markers: Object.fromEntries(
    Object.entries(markers).map(([id, m]) => [id, sliceMarker(m, mode, boundaryRe)]),
  )};
}

function summarizeClient(client, mode = 'minimal', boundaryRe = null) {
  const latestSnapshotAt = client.latestSnapshotAt || null;
  const snapshotAgeMs = latestSnapshotAt ? (Date.now() - new Date(latestSnapshotAt).getTime()) : null;
  const title = client.page?.title || null;
  const pageUrl = client.page?.url || null;
  const visibleName = userVisiblePageName(client);
  const label = pageLabel(client);
  const lastActivityAt = client.lastActivityAt || client.lastMessageAt || client.connectedAt || null;
  const integrationLabel = client.integration?.who || client.integration?.kind || 'unidentified Chippy integration';
  const summary = `${visibleName} | ${integrationLabel} | ${pageUrl || '(no url)'} | activity: ${client.lastActivityReason || 'unknown'} @ ${lastActivityAt || 'none'}${snapshotAgeMs != null ? ` | snapshot ${Math.round(snapshotAgeMs / 1000)}s ago` : ''}`;
  return {
    summary,
    clientId: client.clientId,
    pageRef: label,
    visibleName,
    isLikelyCurrent: Boolean(client.lastActivityReason === 'focus' || client.lastActivityReason === 'visible' || client.lastActivityReason === 'pointer'),
    connectedAt: client.connectedAt,
    lastMessageAt: client.lastMessageAt,
    lastActivityAt,
    lastActivityReason: client.lastActivityReason || null,
    activity: client.activity || null,
    latestSnapshotAt,
    snapshotAgeMs,
    bridgeVersion: client.bridgeVersion || null, page: client.page || null,
    integration: client.integration || null,
    activated: client.activated, probesActive: Boolean(client.probesActive),
    buildMode: client.buildMode || 'unknown',
    lastInspectedBoundary: client.lastInspectedBoundary || null,
    latestSnapshot: sliceSnapshot(client.latestSnapshot, mode, boundaryRe),
  };
}

function sliceParams(url) {
  return { slice: url.searchParams.get('slice') || null, boundaries: url.searchParams.get('boundaries') || null };
}

function buildState(req) {
  const base = baseUrlFromReq(req);
  const url = new URL(req.url, base);
  const { slice, boundaries } = sliceParams(url);
  const pages = Array.from(clients.values())
    .sort((a, b) => new Date(b.lastActivityAt || b.lastMessageAt || b.connectedAt || 0).getTime() - new Date(a.lastActivityAt || a.lastMessageAt || a.connectedAt || 0).getTime())
    .map((c) => summarizeClient(c, slice || 'minimal', boundaries));
  const dupes = findDuplicatePageGroups();
  return {
    version: CHIPPY_VERSION,
    helperBaseUrl: base,
    injectUrl: `${base}${CHIPPY_PREFIX}/inject.js`,
    wsUrl: base.replace(/^http/i, 'ws') + `${CHIPPY_PREFIX}/ws`,
    connectedClients: pages,
    recentPages: recentPageActivity.slice(0, 10),
    duplicatePageWarnings: Object.keys(dupes).length ? dupes : null,
    proxy: getProxySummary(),
  };
}

// ─── HTTP body parsing ────────────────────────────────────────────────────────

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { const s = Buffer.concat(chunks).toString(); resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ─── Proxy forwarding ─────────────────────────────────────────────────────────

function isChippyPath(p) { return p === CHIPPY_PREFIX || p.startsWith(`${CHIPPY_PREFIX}/`); }

function getProxySummary() {
  if (!proxyState.active) return null;
  return {
    active: true,
    targetPort: proxyState.targetPort,
    targetHost: proxyState.target?.hostHeader || null,
    originalUrl: proxyState.originalUrl,
    injectTarget: getProxyInjectTarget(),
    startedAt: proxyState.startedAt,
  };
}

function startProxy(targetPort, originalUrl) {
  const target = helperProxy.resolveProxyTarget(targetPort, originalUrl);
  Object.assign(proxyState, { active: true, targetPort: target.port, originalUrl: originalUrl || null, target, startedAt: nowIso() });
  console.log(`[proxy] enabled -> ${target.hostHeader}${originalUrl ? ` url=${originalUrl}` : ''}`);
  return getProxySummary();
}

function stopProxy() {
  const prev = getProxySummary();
  Object.assign(proxyState, { active: false, targetPort: null, originalUrl: null, target: null, startedAt: null });
  console.log(`[proxy] disabled${prev?.targetPort ? ` (was ${prev.targetPort})` : ''}`);
  return { active: false };
}

function forwardHeaders(headers, targetHost) {
  const next = { ...headers };
  delete next.host; delete next.connection; delete next['content-length']; delete next['accept-encoding'];
  next.host = targetHost;
  next['x-forwarded-host'] = headers.host || '';
  next['x-forwarded-proto'] = 'http';
  return next;
}

function proxyRequest(req, res) {
  const target = proxyState.target;
  console.log(`[proxy] ${req.method} ${req.url} -> http://${target.hostHeader}${req.url}`);

  const options = helperProxy.upstreamRequestOptions(target, req, forwardHeaders(req.headers, target.hostHeader));
  const upstream = http.request(options, (upRes) => {
    console.log(`[proxy] ${req.method} ${req.url} <- ${upRes.statusCode}`);
    if (!shouldInjectIntoProxyHtml(req, upRes)) {
      res.writeHead(upRes.statusCode || 502, upRes.statusMessage, upRes.headers);
      upRes.pipe(res);
      return;
    }
    // Buffer HTML response so we can inject the Chippy bundle
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('end', () => {
      try {
        const injected = Buffer.from(injectIntoHtmlDocument(Buffer.concat(chunks).toString('utf8')));
        console.log(`[proxy] injected chippy bundle into ${req.url}`);
        res.writeHead(upRes.statusCode || 200, upRes.statusMessage, stripHopHeaders(upRes.headers, injected, true));
        res.end(injected);
      } catch (e) {
        console.error(`[proxy] injection failed: ${e.message}`);
        if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
        else res.end();
      }
    });
    upRes.on('error', (e) => {
      console.error(`[proxy] upstream error ${req.url}: ${e.message}`);
      if (!res.headersSent) json(res, 502, { ok: false, error: e.message });
    });
  });
  upstream.on('error', (e) => {
    console.error(`[proxy] ${req.method} ${req.url} !! ${e.message}`);
    if (!res.headersSent) json(res, 502, { ok: false, error: e.message });
  });
  req.on('error', (e) => { console.error(`[proxy] req-error: ${e.message}`); upstream.destroy(); });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const target = proxyState.target;
  console.log(`[proxy-ws] ${req.url} -> ${target.hostHeader}`);
  const upstream = http.request(helperProxy.upstreamRequestOptions(target, { url: req.url, method: 'GET' }, {
    ...forwardHeaders(req.headers, target.hostHeader),
    connection: req.headers.connection || 'Upgrade',
    upgrade: req.headers.upgrade || 'websocket',
  }));
  upstream.on('upgrade', (upRes, upSock, upHead) => {
    const lines = [`HTTP/1.1 ${upRes.statusCode || 101} ${upRes.statusMessage || 'Switching Protocols'}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) v.forEach((item) => lines.push(`${k}: ${item}`));
      else if (v != null) lines.push(`${k}: ${v}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upSock.write(head);
    if (upHead?.length) socket.write(upHead);
    upSock.on('error', () => socket.destroy());
    socket.on('error', () => upSock.destroy());
    upSock.pipe(socket); socket.pipe(upSock);
  });
  upstream.on('response', (upRes) => { socket.write(`HTTP/1.1 ${upRes.statusCode || 502} ${upRes.statusMessage || 'Bad Gateway'}\r\n\r\n`); socket.destroy(); });
  upstream.on('error', (e) => { console.error(`[proxy-ws] ${req.url} !! ${e.message}`); socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); socket.destroy(); });
  upstream.end();
}

// ─── Commands & client state ──────────────────────────────────────────────────

function resolveClientId(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return { ok: false, code: 400, error: 'clientId required' };
  if (clients.has(id)) return { ok: true, clientId: id, client: clients.get(id) };
  const matches = Array.from(clients.keys()).filter((candidate) => candidate.startsWith(id));
  if (matches.length === 1) return { ok: true, clientId: matches[0], client: clients.get(matches[0]), resolvedFrom: id };
  if (matches.length > 1) return { ok: false, code: 409, error: `Ambiguous clientId prefix ${id}. Matches: ${matches.join(', ')}` };
  return { ok: false, code: 404, error: `Client not found: ${id}. Run 'pages' to see connected clients.` };
}

function sendToClient(clientId, command) {
  const resolved = resolveClientId(clientId);
  if (!resolved.ok) return { ok: false, code: resolved.code, error: resolved.error };
  wsSend(resolved.client.socket, JSON.stringify({ type: 'command', command }));
  return { ok: true, clientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null };
}

function broadcastCommand(command, targetId = null) {
  if (targetId) {
    const delivered = sendToClient(targetId, command);
    if (!delivered.ok) return { ok: false, code: delivered.code, error: delivered.error, delivered: 0 };
    const deliveredClient = clients.get(delivered.clientId);
    if (deliveredClient) recordClientActivity(deliveredClient, 'command', { type: command?.type || null });
    return { ok: true, delivered: 1, targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom };
  }
  let n = 0;
  for (const c of clients.values()) {
    wsSend(c.socket, JSON.stringify({ type: 'command', command }));
    n++;
  }
  return { ok: true, delivered: n, targetClientId: null, resolvedFrom: null };
}

function detectBuildMode(msg) {
  if (msg.buildMode) return msg.buildMode;
  const markers = msg.snapshot?.markers || {};
  for (const m of Object.values(markers)) {
    if (m?.resolved?.component?.source?.fileName || m?.resolved?.dom?.source?.fileName) return 'dev';
    if ((m?.resolved?.component?.owners || []).some((o) => o?.source?.fileName)) return 'dev';
  }
  for (const m of Object.values(markers)) { if (m?.resolved?.component?.name) return 'production'; }
  return 'unknown';
}

function updateClientFromMessage(client, msg) {
  client.lastMessageAt = nowIso();
  if (msg.type === 'hello') client.lastHelloAt = client.lastMessageAt;
  if (msg.clientId) client.clientId = msg.clientId;
  if (msg.bridgeVersion) client.bridgeVersion = msg.bridgeVersion;
  if (msg.bridgeVersion) client.bridgeVersion = msg.bridgeVersion;
  if (msg.page) client.page = msg.page;
  // TODO: Validate and normalize the complete integration identity here
  // before persisting it. Page selection relies on kind/who/source/reload fields
  // as one contract, but this pass-through accepts partial or arbitrary objects.
  if (msg.integration) client.integration = msg.integration;
  if (typeof msg.probesActive === 'boolean') client.probesActive = msg.probesActive;
  if (typeof msg.activated === 'boolean') client.activated = msg.activated;

  if (msg.type === 'snapshot' || msg.type === 'hello') {
    if (msg.type === 'snapshot') {
      const previousSnapshot = client.latestSnapshot;
      client.latestSnapshot = msg.snapshot ? { ...msg.snapshot, at: client.lastMessageAt } : null;
      client.latestSnapshotAt = client.lastMessageAt;
      recordClientActivity(client, 'snapshot', { reason: msg.reason || null }, client.lastMessageAt);
      if (msg.reason === 'marker-annotation-change' && client.latestSnapshot) {
        probeAnnotations.publish({
          clientId: client.clientId,
          at: client.lastMessageAt,
          page: client.latestSnapshot.page || client.page || null,
          integration: client.latestSnapshot.integration || client.integration || null,
          previousSnapshot,
          snapshot: client.latestSnapshot,
        });
      }
    }
    if (msg.type === 'hello') {
      recordClientActivity(client, msg.reason || 'hello', null, client.lastMessageAt);
    }
    const mode = detectBuildMode(msg);
    if (mode !== 'unknown') client.buildMode = mode;
  }
  if (msg.type === 'activity' && msg.activity) {
    recordClientActivity(client, msg.activity.reason || 'activity', msg.activity.detail || null, msg.activity.at || client.lastMessageAt);
    // Record the most recent collateral-boundary selection distinctly so lookups
    // and commands can read which owner/error/suspense boundary the user picked.
    if (msg.activity.reason === 'inspect-boundary') {
      client.lastInspectedBoundary = { ...(msg.activity.detail || {}), at: msg.activity.at || client.lastMessageAt };
    }
  }
}

// ─── WebSocket attachment ─────────────────────────────────────────────────────

const clientIdBindings = pageSocketTrust.createClientIdBindings();

function attachSocket(socket, socketOrigin) {
  const id = crypto.randomUUID();
  clientIdBindings.claim(id, socketOrigin);
  const client = {
    socket, clientId: id,
    connectedAt: nowIso(), lastMessageAt: nowIso(), lastHelloAt: null,
    bridgeVersion: null,
    page: { url: null, title: null, storyId: null },
    integration: null,
    activated: false, probesActive: false, buildMode: 'unknown',
    latestSnapshotAt: null, latestSnapshot: null,
  };
  clients.set(id, client);

  let buf = Buffer.alloc(0);
  const frag = {};

  wsSend(socket, JSON.stringify({ type: 'connected', clientId: id, connectedAt: client.connectedAt }));

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, remainder } = wsParseFrames(buf, frag);
    buf = remainder;
    for (const frame of messages) {
      if (frame.opcode === 0x8) { socket.end(); return; }
      if (frame.opcode === 0x9) { wsSend(socket, frame.payload, 0xA); continue; }
      if (frame.opcode !== 0x1) continue;
      try {
        const msg = JSON.parse(frame.payload.toString('utf8'));
        const rejected = pageSocketTrust.checkPageMessage({
          bindings: clientIdBindings, socketOrigin, currentClientId: client.clientId, msg,
        });
        if (rejected) {
          console.warn(`[ws] rejected message from origin=${socketOrigin || 'none'}: ${rejected}`);
          wsSend(socket, JSON.stringify({ type: 'error', message: rejected }));
          socket.destroy();
          return;
        }
        const prevId = client.clientId;
        updateClientFromMessage(client, msg);
        if (client.clientId !== prevId) { clients.delete(prevId); clients.set(client.clientId, client); }
        if (msg.type === 'hello') warnDuplicatesIfNeeded();
        if (msg.type === 'computed-style-result' && msg.requestId) {
          resolvePendingResult(pendingComputedStyle, msg.requestId, msg.result);
        }
        if (msg.type === 'eval-probe-result' && msg.requestId) {
          resolvePendingResult(pendingEvalProbe, msg.requestId, msg.result);
          resolvePendingResult(pendingProbeCommand, msg.requestId, msg.result);
        }
        if (msg.type === 'eval-avalanche-result' && msg.requestId) {
          resolvePendingResult(pendingAvalanche, msg.requestId, msg.result);
        }
        if (msg.type === 'eval-script-result' && msg.requestId) {
          resolvePendingResult(pendingEvalScript, msg.requestId, msg.result);
        }
        if (msg.type === 'reload-ack' && msg.requestId) {
          resolvePendingResult(pendingReloadAck, msg.requestId, {
            ok: msg.ok !== false,
            ack: true,
            action: msg.action || 'page-reload',
            clientId: client.clientId,
            ...(typeof msg.earlyStartup === 'string' ? { earlyStartup: msg.earlyStartup } : {}),
            ...(msg.ok === false && typeof msg.error === 'string' ? { error: msg.error } : {}),
          });
        }
      } catch (e) {
        console.error(`[ws] parse error client=${client.clientId}: ${e.message}`);
        wsSend(socket, JSON.stringify({ type: 'error', message: e.message }));
      }
    }
  });

  // A reload can overlap two sockets that intentionally reuse the same
  // session-stored client id. Once the new socket replaces the map entry, the
  // old socket must not delete that newer owner when it finally closes.
  const cleanup = () => {
    if (clients.get(client.clientId) === client) clients.delete(client.clientId);
  };
  socket.on('close', cleanup);
  socket.on('end', cleanup);
  socket.on('error', cleanup);
}

// ─── Inject bundle ────────────────────────────────────────────────────────────

function getInjectBundle() {
  return INJECT_FILES.map((f) => {
    const src = fs.readFileSync(path.join(EXTENSION_ROOT, f), 'utf8');
    return `\n// ---- extension/${f} ----\n${src}\n`;
  }).join('\n');
}

// Serve a file from EXTENSION_ROOT with a clear, actionable response when it is
// missing. A missing asset is a 404 (not a 500) with the resolved path and a
// hint, so callers (Playwright `addScriptTag`, browser injection) get a
// diagnosable error instead of an opaque "Failed to load script".
function serveExtensionFile(res, fileName, contentType, transform = null) {
  const filePath = path.join(EXTENSION_ROOT, fileName);
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      json(res, 404, {
        ok: false,
        error: `extension asset not found: ${fileName}`,
        path: filePath,
        extensionRoot: EXTENSION_ROOT,
        hint: `File is missing from EXTENSION_ROOT. If it is a generated bundle (avalanche.iife.js), run 'yarn avalanche:sync'. Otherwise confirm the helper was started from the correct skill directory.`,
      });
      return;
    }
    json(res, 500, { ok: false, error: e.message, path: filePath });
    return;
  }
  text(res, 200, transform ? transform(src) : src, contentType);
}

function getClassicInjectBundle() {
  const integration = JSON.stringify(IMPORT_INTEGRATION);
  return [
    '// Chippy helper classic import. This document-scoped integration must be re-injected after reload.',
    'globalThis.__CHIPPY = globalThis.__CHIPPY || {};',
    `globalThis.__CHIPPY.config = { ...(globalThis.__CHIPPY.config || {}), integration: ${integration} };`,
    getInjectBundle(),
  ].join('\n\n');
}

function boolParam(url, name, fallback) {
  const value = url.searchParams.get(name);
  if (value == null || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function stringParam(url, name, fallback, allowed = null) {
  const value = url.searchParams.get(name);
  if (value == null || value === '') return fallback;
  if (allowed && !allowed.includes(value)) return fallback;
  return value;
}


function normalizeArmOrigin(value) {
  if (!value || typeof value !== 'string') return '';
  try { return new URL(value).origin; } catch { return value; }
}

function getInjectEsmBundle(req, url = new URL(req.url, baseUrlFromReq(req))) {
  const helperBaseUrl = baseUrlFromReq(req);
  const bootConfig = {
    helperBaseUrl,
    activated: boolParam(url, 'activated', true),
    ui: stringParam(url, 'ui', 'none', ['panel', 'storybook-panel', 'none']),
    ownerType: stringParam(url, 'ownerType', 'import-mjs'),
    ownerId: stringParam(url, 'ownerId', 'import-mjs'),
    transport: stringParam(url, 'transport', 'import-mjs'),
    mode: stringParam(url, 'mode', 'chippy', ['chippy', 'avalanche', 'idle']),
    staleAfterMs: Number(url.searchParams.get('staleAfterMs') || 15000),
    integration: IMPORT_INTEGRATION,
  };
  const runtimeAliases = [
    'const global = globalThis;',
    'const window = globalThis;',
    'const self = globalThis;',
    'const document = globalThis.document;',
    `const __chippyBootConfig = ${JSON.stringify(bootConfig)};`,
    `globalThis.__CHIPPY_STARTUP_CONFIG = { ...(globalThis.__CHIPPY_STARTUP_CONFIG || {}), ...__chippyBootConfig };`,
    `globalThis.__CHIPPY = globalThis.__CHIPPY || {};`,
    `globalThis.__CHIPPY.config = { ...(globalThis.__CHIPPY.config || {}), ...__chippyBootConfig };`,
    `function __chippyAcquireOwner(nextOwner) {`,
    `  const now = Date.now();`,
    `  const current = globalThis.__CHIPPY_OWNER__ || null;`,
    `  const staleAfterMs = Number(nextOwner.staleAfterMs || 15000);`,
    `  if (!current || current.ownerId === nextOwner.ownerId || (current.heartbeatAt && now - current.heartbeatAt > staleAfterMs)) {`,
    `    const owner = { ...(current?.ownerId === nextOwner.ownerId ? current : {}), ...nextOwner, startedAt: current?.ownerId === nextOwner.ownerId ? (current.startedAt || now) : now, heartbeatAt: now };`,
    `    globalThis.__CHIPPY_OWNER__ = owner;`,
    `    globalThis.__CHIPPY_LOCK__ = globalThis.__CHIPPY_LOCK__ || {};`,
    `    globalThis.__CHIPPY_LOCK__.get = () => globalThis.__CHIPPY_OWNER__ || null;`,
    `    globalThis.__CHIPPY_LOCK__.heartbeat = (ownerId, patch = {}) => {`,
    `      if (globalThis.__CHIPPY_OWNER__?.ownerId !== ownerId) return { ok: false, reason: 'not-owner', owner: globalThis.__CHIPPY_OWNER__ || null };`,
    `      globalThis.__CHIPPY_OWNER__ = { ...globalThis.__CHIPPY_OWNER__, ...patch, heartbeatAt: Date.now() };`,
    `      return { ok: true, owner: globalThis.__CHIPPY_OWNER__ };`,
    `    };`,
    `    globalThis.__CHIPPY_LOCK__.release = (ownerId) => {`,
    `      if (globalThis.__CHIPPY_OWNER__?.ownerId !== ownerId) return { ok: false, reason: 'not-owner', owner: globalThis.__CHIPPY_OWNER__ || null };`,
    `      const owner = globalThis.__CHIPPY_OWNER__;`,
    `      delete globalThis.__CHIPPY_OWNER__;`,
    `      return { ok: true, owner };`,
    `    };`,
    `    return { ok: true, owner, reused: current?.ownerId === nextOwner.ownerId, replacedStale: !!(current && current.ownerId !== nextOwner.ownerId) };`,
    `  }`,
    `  return { ok: false, reason: 'owned-by-other-chippy', owner: current };`,
    `}`,
    `const __chippyOwnerResult = __chippyAcquireOwner(__chippyBootConfig);`,
    `globalThis.__CHIPPY_OWNER_RESULT__ = __chippyOwnerResult;`,
    `if (!__chippyOwnerResult.ok) {`,
    `  globalThis.__CHIPPY_BLOCKED__ = __chippyOwnerResult;`,
    `  throw new Error('Chippy runtime already owned by ' + (__chippyOwnerResult.owner?.ownerType || __chippyOwnerResult.owner?.ownerId || 'another owner'));`,
    `}`,
  ].join('\n');
  const avalancheUrl = JSON.stringify(`${helperBaseUrl}${CHIPPY_PREFIX}/avalanche.es.js`);
  return [
    '// Chippy helper ESM entry. Import side-effect installs window.__CHIPPY and loads Avalanche.',
    runtimeAliases,
    getInjectBundle(),
    'if (!globalThis.__AVALANCHE__) {',
    `  const __avMod = await import(${avalancheUrl});`,
    '  // avalanche.es.js only `export { api as default }` — unlike the iife bundle it',
    '  // does not assign globalThis.__AVALANCHE__. Populate it from the module default',
    '  // so getLab()/fiber-walk works on the import path exactly like the extension.',
    '  const __av = (__avMod && (__avMod.default || __avMod.api)) || null;',
    '  if (__av && !globalThis.__AVALANCHE__) {',
    '    globalThis.__AVALANCHE__ = __av;',
    '    if (__av.default && typeof __av.default === "object") Object.assign(__av, __av.default);',
    '  }',
    '}',
    'if (__chippyBootConfig.activated) {',
    '  globalThis.__CHIPPY?.pageBridge?.activate?.();',
    '  globalThis.__CHIPPY?.pageBridge?.ensureProbes?.();',
    '}',
    'const __chippyReady = Promise.resolve().then(() => ({',
    '  chippy: globalThis.__CHIPPY || null,',
    '  avalanche: globalThis.__AVALANCHE__ || null,',
    '  connState: globalThis.__CHIPPY?.pageBridge?.getState?.().connState || globalThis.__CHIPPY?.connState || null,',
    '  integration: globalThis.__CHIPPY?.pageBridge?.getState?.().integration || __chippyBootConfig.integration,',
    '  activated: globalThis.__CHIPPY?.pageBridge?.getState?.().activated ?? null,',
    '  probesActive: globalThis.__CHIPPY?.pageBridge?.getState?.().probesActive ?? null,',
    '}));',
    'export { __chippyReady as ready };',
    'export default globalThis.__CHIPPY;',
  ].join('\n\n');
}

// ─── HTTP routing ─────────────────────────────────────────────────────────────

async function handleChippyHttp(req, res, url) {
  const method = req.method || 'GET';
  const p = url.pathname;

  if (method === 'OPTIONS') { json(res, 200, { ok: true }); return true; }
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/health`) { json(res, 200, { ok: true, version: CHIPPY_VERSION, now: nowIso() }); return true; }
  if (method === 'GET' && p === CHIPPY_PREFIX) { json(res, 200, { ok: true, message: 'Chippy helper server is running.', version: CHIPPY_VERSION }); return true; }
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/state`) { json(res, 200, buildState(req)); return true; }

  if (method === 'GET' && (p === `${CHIPPY_PREFIX}/avalanche.iife.js.map` || p === `${CHIPPY_PREFIX}/avalanche.es.js.map`)) {
    serveExtensionFile(res, p.slice(CHIPPY_PREFIX.length + 1), 'application/json; charset=utf-8');
    return true;
  }

  // Inject bundle
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/inject.js`) {
    try { text(res, 200, getClassicInjectBundle(), 'application/javascript; charset=utf-8'); }
    catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/avalanche.es.js`) {
    serveExtensionFile(res, 'avalanche.es.js', 'text/javascript; charset=utf-8');
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/inject.mjs`) {
    try { text(res, 200, getInjectEsmBundle(req), 'text/javascript; charset=utf-8'); }
    catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return true;
  }

  // Avalanche bundle (served separately so Playwright fallback can inject via URL,
  // not via filesystem path. Bundle is intentionally NOT included in the inject
  // bundle above — the extension installs Avalanche pre-document via
  // chrome.scripting.MAIN, and this route exists for the local Playwright path
  // when the page bundle does not ship Avalanche).
  // DevTools hook shim. MUST be loaded BEFORE react-dom evaluates so that
  // react-dom registers its renderer (and currentDispatcherRef) into the
  // hook's renderers Map. Without this, debug-render cannot capture hook
  // call stacks and `debugHook()` collapses to a flat fallback.
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/devtools-hook-shim.js`) {
    serveExtensionFile(res, 'devtools-hook-shim.js', 'application/javascript; charset=utf-8');
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/startup-handoff.js`) {
    serveExtensionFile(res, 'startup-handoff.js', 'application/javascript; charset=utf-8');
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/avalanche.iife.js`) {
    serveExtensionFile(res, 'avalanche.iife.js', 'application/javascript; charset=utf-8', (src) =>
      `${src}\n;(() => {\n  const api = globalThis.__AVALANCHE__;\n  if (api && api.default && typeof api.default === 'object') {\n    Object.assign(api, api.default);\n  }\n})();\n`);
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/recent-pages`) {
    json(res, 200, { ok: true, count: recentPageActivity.length, pages: recentPageActivity.slice(0, 10) });
    return true;
  }

  // Pages list
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/pages`) {
    const { slice, boundaries } = sliceParams(url);
    const pages = Array.from(clients.values()).map((c) => summarizeClient(c, slice || 'minimal', boundaries));
    const dupes = findDuplicatePageGroups();
    if (pages.length === 0) {
      json(res, 200, { ok: true, count: 0, hint: 'No clients connected. Open a page with the Chippy extension enabled and reload it.', duplicatePageWarnings: null, pages: [] });
    } else {
      json(res, 200, { ok: true, count: pages.length, duplicatePageWarnings: Object.keys(dupes).length ? dupes : null, pages });
    }
    return true;
  }

  // Single page
  if (method === 'GET' && /^\/__chippy\/api\/pages\/[^/]+$/.test(p)) {
    const clientId = p.slice(`${CHIPPY_PREFIX}/api/pages/`.length);
    const resolved = resolveClientId(clientId);
    if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
    const { slice, boundaries } = sliceParams(url);
    json(res, 200, { ok: true, client: summarizeClient(resolved.client, slice || 'standard', boundaries), targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null });
    return true;
  }

  // Stored snapshot
  if (method === 'GET' && /^\/__chippy\/api\/pages\/[^/]+\/snapshot$/.test(p)) {
    const clientId = p.split('/')[4];
    const resolved = resolveClientId(clientId);
    if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
    const { slice, boundaries } = sliceParams(url);
    const snapshot = sliceSnapshot(resolved.client.latestSnapshot, slice || 'standard', boundaries);
    json(res, 200, {
      ok: true,
      targetClientId: resolved.clientId,
      resolvedFrom: resolved.resolvedFrom || null,
      latestSnapshotAt: resolved.client.latestSnapshotAt || null,
      snapshot,
    });
    return true;
  }

  // Request snapshot
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/snapshot$/.test(p)) {
    const clientId = p.split('/')[4];
    const sent = sendToClient(clientId, { type: 'request-snapshot' });
    json(res, sent.ok ? 200 : sent.code, sent.ok ? { ok: true, requested: sent.clientId, resolvedFrom: sent.resolvedFrom } : { ok: false, error: sent.error });
    return true;
  }

  // Wait for the next user-attached probe annotation. This is an explicit,
  // cancellable long poll owned by the calling agent; Chippy never installs or
  // modifies host lifecycle hooks to deliver these events.
  if (method === 'GET' && /^\/__chippy\/api\/pages\/[^/]+\/probe-annotations\/wait$/.test(p)) {
    const clientId = p.split('/')[4];
    const resolved = resolveClientId(clientId);
    if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
    const timeoutRaw = url.searchParams.get('timeoutMs') || '300000';
    const timeoutMs = Number(timeoutRaw);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_800_000) {
      json(res, 400, { ok: false, error: 'timeoutMs must be an integer from 1 through 1800000' });
      return true;
    }

    const pending = probeAnnotations.wait(resolved.clientId, timeoutMs);
    const cancel = () => pending.cancel();
    req.once('aborted', cancel);
    res.once('close', cancel);
    const event = await pending.promise;
    req.removeListener('aborted', cancel);
    res.removeListener('close', cancel);
    if (req.aborted || res.destroyed) return true;
    json(res, 200, {
      ok: true,
      status: event ? 'annotation' : 'timeout',
      targetClientId: resolved.clientId,
      resolvedFrom: resolved.resolvedFrom || null,
      timeoutMs,
      event,
    });
    return true;
  }

  // Command
  if (method === 'POST' && p === `${CHIPPY_PREFIX}/api/command`) {
    try {
      const body = await parseJsonBody(req);
      const command = body.command || body;
      const delivered = broadcastCommand(command, body.clientId || null);
      json(res, delivered.ok ? 200 : delivered.code, delivered.ok ? { ok: true, delivered: delivered.delivered, targetClientId: delivered.targetClientId, resolvedFrom: delivered.resolvedFrom, command } : { ok: false, delivered: 0, error: delivered.error, command });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // avalanche: POST /api/pages/:clientId/avalanche { action?, max?, count?, timeoutMs? }
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/avalanche$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req);
      const modeError = detectionModeError(body?.options);
      if (modeError) { json(res, 400, { ok: false, error: modeError }); return true; }
      const result = await requestAvalanche(clientId, body);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  // Capture one compact structural fiber/prop state. Full capture data remains
  // helper-side; the response returns only an id and summary.
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/fiber-state-captures$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const result = await requestProbeCommand(clientId, buildFiberStateCaptureCommand(body), body.timeoutMs);
      if (!result.ok) { json(res, result.code, result.payload); return true; }
      const state = result.payload.result;
      if (!state || state.ok === false || state.version !== 1 || !Array.isArray(state.fibers)) {
        json(res, 502, { ok: false, error: state?.error || 'Page returned an invalid fiber state capture' });
        return true;
      }
      const captureId = `state:${crypto.randomUUID().slice(0, 8)}`;
      const entry = {
        captureId,
        label: body.label == null || body.label === '' ? null : String(body.label),
        clientId: result.payload.targetClientId,
        state,
      };
      retainFiberStateCapture(entry);
      json(res, 200, { ok: true, capture: summarizeFiberStateCapture(entry) });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/fiber-state-captures`) {
    json(res, 200, { ok: true, count: fiberStateCaptures.size, captures: Array.from(fiberStateCaptures.values()).map(summarizeFiberStateCapture) });
    return true;
  }

  // Compare may use captures from different client/page realms. The compact
  // states are sent to any still-connected page so the bundled diff algorithm
  // remains the sole implementation.
  if (method === 'POST' && p === `${CHIPPY_PREFIX}/api/fiber-state-comparisons`) {
    try {
      const body = await parseJsonBody(req);
      const before = resolveFiberStateCapture(body.before);
      const after = resolveFiberStateCapture(body.after);
      if (!before.ok) { json(res, before.code, { ok: false, error: before.error }); return true; }
      if (!after.ok) { json(res, after.code, { ok: false, error: after.error }); return true; }
      const preferredClientIds = [body.clientId, after.capture.clientId, before.capture.clientId].filter(Boolean);
      let compareClientId = preferredClientIds.find((id) => resolveClientId(id).ok) || null;
      if (!compareClientId) compareClientId = clients.keys().next().value || null;
      if (!compareClientId) {
        json(res, 409, { ok: false, error: 'No connected page is available to run the fiber state comparison' });
        return true;
      }
      const result = await requestProbeCommand(compareClientId, buildFiberStateCompareCommand(
        before.capture.state,
        after.capture.state,
        body,
      ), body.timeoutMs);
      if (!result.ok) { json(res, result.code, result.payload); return true; }
      const diff = result.payload.result;
      json(res, diff?.ok === false ? 400 : 200, {
        ok: diff?.ok !== false,
        before: summarizeFiberStateCapture(before.capture),
        after: summarizeFiberStateCapture(after.capture),
        diff,
      });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // eval-script: POST /api/pages/:clientId/eval-script { source, args?, timeoutMs?, scriptTimeoutMs? }
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/eval-script$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req);
      const result = await requestEvalScript(clientId, body);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/page-click$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const result = await requestProbeCommand(clientId, {
        type: 'page-click',
        target: {
          selector: body.selector,
          probeId: body.probeId,
          fiberId: body.fiberId,
        },
      }, body.timeoutMs);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/fiber-invoke$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const result = await requestProbeCommand(clientId, {
        type: 'fiber-invoke',
        fiberId: body.fiberId,
        propName: body.propName,
        args: body.args,
      }, body.timeoutMs);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/fiber-schedule-update$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const result = await requestProbeCommand(clientId, {
        type: 'fiber-schedule-update',
        fiberId: body.fiberId,
        ownerIndex: body.ownerIndex,
      }, body.timeoutMs);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/fiber-prop-contract$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const result = await requestProbeCommand(clientId, {
        type: 'fiber-prop-contract',
        fiberId: body.fiberId,
        propName: body.propName,
      }, body.timeoutMs);
      json(res, result.code, result.payload);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/handoff-to-playwright$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const probeIds = Array.isArray(body.probeIds)
        ? body.probeIds
        : String(body.probeIds || '1,2').split(',').map((id) => id.trim()).filter(Boolean);
      const result = await handoffToPlaywright({
        clientId,
        url: body.url,
        probeIds,
        browserName: body.browserName,
        headless: body.headless,
      });
      json(res, result.code, result.payload);
    } catch (e) {
      if (e && e.code === PLAYWRIGHT_UNAVAILABLE_CODE) {
        json(res, 503, { ok: false, code: PLAYWRIGHT_UNAVAILABLE_CODE, error: e.message });
      } else {
        json(res, 400, { ok: false, error: e.message });
      }
    }
    return true;
  }


  // avalanche-arm: POST /api/avalanche-arm { origin?, clientId?, autoStart?, max? }
  if (method === 'POST' && p === `${CHIPPY_PREFIX}/api/avalanche-arm`) {
    try {
      const body = await parseJsonBody(req);
      const origin = body.origin ? normalizeArmOrigin(String(body.origin).trim()) : null;
      const clientId = body.clientId ? String(body.clientId).trim() : null;
      if (!origin && !clientId) { json(res, 400, { ok: false, error: 'origin or clientId required' }); return true; }
      const autoStart = body.autoStart !== false;
      if (autoStart) {
        const incomingOptions = body.options && typeof body.options === 'object' ? body.options : {};
        const modeError = detectionModeError(incomingOptions);
        if (modeError) { json(res, 400, { ok: false, error: modeError }); return true; }
        const arm = {
          autoStart: true,
          options: {
            captureFibers: incomingOptions.captureFibers !== false,
            detectionMode: typeof incomingOptions.detectionMode === 'string' ? incomingOptions.detectionMode : 'sources',
          },
        };
        if (body.max != null && Number.isFinite(Number(body.max)) && Number(body.max) >= 0) arm.max = Math.floor(Number(body.max));
        if (origin) armedAvalanche.set(origin, arm);
        if (clientId) armedAvalancheByClient.set(clientId, arm);
        json(res, 200, { ok: true, armed: true, origin, clientId, config: arm });
      } else {
        if (origin) armedAvalanche.delete(origin);
        if (clientId) armedAvalancheByClient.delete(clientId);
        json(res, 200, { ok: true, armed: false, origin, clientId });
      }
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/avalanche-arm`) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const origin = normalizeArmOrigin(u.searchParams.get('origin') || '');
      const clientId = u.searchParams.get('clientId') || '';
      if (clientId) {
        const arm = armedAvalancheByClient.get(clientId) || null;
        json(res, 200, { ok: true, clientId, armed: !!arm, config: arm });
      } else if (origin) {
        const arm = armedAvalanche.get(origin) || null;
        json(res, 200, { ok: true, origin, armed: !!arm, config: arm });
      } else {
        json(res, 200, { ok: true, origins: Object.fromEntries(armedAvalanche.entries()), clients: Object.fromEntries(armedAvalancheByClient.entries()) });
      }
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/reload$/.test(p)) {
    try {
      const clientId = p.split('/')[4];
      const requestId = crypto.randomUUID();
      const resolved = resolveClientId(clientId);
      if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
      const action = resolved.client.integration?.kind === 'storybook'
        ? 'storybook-force-remount'
        : 'reload';
      // An armed page gets its arm with the reload or remount, so Avalanche is
      // installed before React's first commit.
      const pageOrigin = normalizeArmOrigin(resolved.client.page?.url || '');
      const arm = armedAvalancheByClient.get(resolved.clientId) || (pageOrigin && armedAvalanche.get(pageOrigin)) || null;
      const command = arm ? { type: action, requestId, avalanche: arm } : { type: action, requestId };
      const sent = sendToClient(resolved.clientId, command);
      if (!sent.ok) { json(res, sent.code, { ok: false, error: sent.error }); return true; }
      const ack = await waitForPendingResult(pendingReloadAck, requestId, 1500, 'Timeout waiting for reload ack');
      // 504: no ack arrived. 409: the page answered but could not reload.
      const refused = ack.ok && ack.result?.ok === false;
      const status = !ack.ok ? 504 : refused ? 409 : 200;
      json(res, status, {
        ...ack,
        ...(refused ? { ok: false, error: ack.result.error || 'The page did not reload' } : {}),
        reloading: sent.clientId, resolvedFrom: sent.resolvedFrom, requestId,
      });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/wait-reload$/.test(p)) {
    try {
      const clientId = p.split('/')[4];
      const body = await parseJsonBody(req).catch(() => ({}));
      const timeoutMs = Math.max(500, Math.min(60000, Number(body.timeoutMs) || 5000));
      const resolved = resolveClientId(clientId);
      if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
      const c = resolved.client;
      const resolvedClientId = resolved.clientId;
      if (c.integration?.kind === 'storybook') {
        json(res, 200, {
          ok: true,
          reloaded: true,
          remounted: true,
          action: 'storybook-force-remount',
          clientId: resolvedClientId,
          resolvedFrom: resolved.resolvedFrom || null,
          waitedMs: 0,
        });
        return true;
      }
      const before = c.lastHelloAt || c.connectedAt;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, 100));
        const cNow = clients.get(resolvedClientId);
        const after = cNow ? (cNow.lastHelloAt || cNow.connectedAt) : null;
        if (cNow && after && after !== before) {
          json(res, 200, { ok: true, reloaded: true, clientId: resolvedClientId, resolvedFrom: resolved.resolvedFrom || null, before, after, waitedMs: Date.now() - start });
          return true;
        }
      }
      json(res, 200, { ok: true, reloaded: false, clientId: resolvedClientId, resolvedFrom: resolved.resolvedFrom || null, before, timeoutMs });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // get-computed-style: POST /api/pages/:clientId/computed-style { probeId, parentLevel?, selector?, timeoutMs? }
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/computed-style$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req);
      const { probeId, parentLevel = 0, selector, timeoutMs = 5000 } = body;
      if (!probeId) { json(res, 400, { ok: false, error: 'probeId required' }); return true; }
      const requestId = crypto.randomUUID();
      const command = { type: 'eval-computed-style', requestId, probeId: String(probeId), parentLevel: Number(parentLevel) || 0, selector: selector || null };
      const delivered = sendToClient(clientId, command);
      if (!delivered.ok) { json(res, delivered.code, { ok: false, error: delivered.error }); return true; }
      // Wait for computed-style-result from the page
      const result = await waitForPendingResult(pendingComputedStyle, requestId, timeoutMs, 'Timeout waiting for computed style result');
      json(res, pageResultStatus(result), { ...withPageResultHint(result), targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom, requestId });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // probe-owners: GET /api/pages/:clientId/probe/:probeId/owners — live owner chain, cached snapshot fallback
  if (method === 'GET' && /^\/__chippy\/api\/pages\/[^/]+\/probe\/[^/]+\/owners$/.test(p)) {
    const parts = p.split('/');
    const clientId = parts[4];
    const probeId = parts[6];
    const resolved = resolveClientId(clientId);
    if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }

    try {
      const live = await requestProbeCommand(resolved.clientId, {
        type: 'eval-probe-owners',
        probeId: String(probeId),
      }, Number(url.searchParams.get('timeoutMs')) || 5000);
      const livePayload = live.payload?.result && typeof live.payload.result === 'object'
        ? live.payload.result
        : live.payload;
      if (livePayload?.ok) {
        json(res, 200, {
          ...livePayload,
          targetClientId: resolved.clientId,
          resolvedFrom: resolved.resolvedFrom || null,
          source: 'live',
        });
        return true;
      }
    } catch {
      // Fall back to the last snapshot below. A stale snapshot is still useful
      // orientation when the live probe cache is unavailable.
    }

    const c = resolved.client;
    const marker = c.latestSnapshot?.markers?.[probeId];
    if (!c.latestSnapshot) {
      json(res, 200, { ok: false, targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null, probeId, error: `No snapshot for client ${resolved.clientId}. Run 'request-snapshot <clientId>' or place a probe on the page.`, probesActive: Boolean(c.probesActive), latestSnapshotAt: c.latestSnapshotAt || null });
      return true;
    }
    if (!marker) {
      json(res, 200, { ok: false, targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null, probeId, error: `Probe ${probeId} not found in snapshot. Place probe ${probeId} on the page first.`, probesActive: Boolean(c.probesActive), latestSnapshotAt: c.latestSnapshotAt || null });
      return true;
    }
    if (!marker?.resolved) {
      json(res, 200, { ok: false, targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null, probeId, error: `Probe ${probeId} has no resolved data.`, probesActive: Boolean(c.probesActive), latestSnapshotAt: c.latestSnapshotAt || null, marker: sliceMarker(marker, 'minimal') });
      return true;
    }
    const comp = marker.resolved.component || {};
    const owners = (comp.owners || []).map((o, i) => ({
      ownerIndex: i,
      name: o.name || null,
      key: o.key ?? null,
      propNames: o.propNames || [],
      hookCount: o.hookCount ?? null,
      hookCountTruncated: o.hookCountTruncated ?? false,
      hookCountMax: o.hookCountMax ?? null,
      source: o.source || null,
    }));
    json(res, 200, { ok: true, targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null, source: 'snapshot', probeId, component: { name: comp.name, propNames: comp.propNames || [], hookCount: comp.hookCount ?? null, hookCountTruncated: comp.hookCountTruncated ?? false, hookCountMax: comp.hookCountMax ?? null }, owners });
    return true;
  }

  // probe-owner: GET /api/pages/:clientId/probe/:probeId/owners/:ownerIndex — single owner from snapshot
  if (method === 'GET' && /^\/__chippy\/api\/pages\/[^/]+\/probe\/[^/]+\/owners\/\d+$/.test(p)) {
    const parts = p.split('/');
    const clientId = parts[4];
    const probeId = parts[6];
    const ownerIndex = parseInt(parts[8], 10);
    const resolved = resolveClientId(clientId);
    if (!resolved.ok) { json(res, resolved.code, { ok: false, error: resolved.error }); return true; }
    const c = resolved.client;
    if (!c.latestSnapshot) { json(res, 404, { ok: false, error: `No snapshot for client ${resolved.clientId}. Run 'request-snapshot <clientId>' first.` }); return true; }
    const marker = c.latestSnapshot?.markers?.[probeId];
    if (!marker) { json(res, 404, { ok: false, error: `Probe ${probeId} not found in snapshot. Place probe ${probeId} on the page first.` }); return true; }
    if (!marker?.resolved) { json(res, 404, { ok: false, error: `Probe ${probeId} has no resolved data. Try refreshing the snapshot.` }); return true; }
    const owners = marker.resolved.component?.owners || [];
    const owner = owners[ownerIndex];
    if (!owner) { json(res, 404, { ok: false, error: 'Owner index ' + ownerIndex + ' not found (chain length: ' + owners.length + ')' }); return true; }
    json(res, 200, { ok: true, targetClientId: resolved.clientId, resolvedFrom: resolved.resolvedFrom || null, probeId, ownerIndex, name: owner.name || null, key: owner.key ?? null, propNames: owner.propNames || [], hookCount: owner.hookCount ?? null, hookCountTruncated: owner.hookCountTruncated ?? false, hookCountMax: owner.hookCountMax ?? null, source: owner.source || null });
    return true;
  }

  // eval-probe: POST /api/pages/:clientId/eval-probe { command, probeId, ownerIndex?, timeoutMs? }
  if (method === 'POST' && /^\/__chippy\/api\/pages\/[^/]+\/eval-probe$/.test(p)) {
    const clientId = p.split('/')[4];
    try {
      const body = await parseJsonBody(req);
      const { command: evalCommand, probeId, ownerIndex, prop, parentLevel, timeoutMs = 5000 } = body;
      if (!evalCommand) { json(res, 400, { ok: false, error: 'command required' }); return true; }
      // Probe-centered commands require a probeId. Fiber-direct commands do not.
      const PROBE_COMMANDS = new Set(['eval-probe-dom', 'eval-probe-parents', 'eval-probe-boundaries', 'eval-probe-props', 'eval-probe-hooks', 'eval-probe-hooks-summary', 'eval-prop-value']);
      const FIBER_COMMANDS = new Set(['find-fibers', 'capture-fiber-state', 'compare-fiber-states', 'page-boundaries', 'inspect-fiber-hooks', 'inspect-fiber-hooks-summary', 'inspect-fiber-props', 'inspect-fiber-owners', 'inspect-fiber-parents', 'inspect-fiber-boundaries', 'inspect-fiber-structure', 'describe-component', 'explain-component']);
      if (PROBE_COMMANDS.has(evalCommand) && !probeId) {
        json(res, 400, { ok: false, error: 'probeId required. Use probe id "1" or "2".' }); return true;
      }
      if (!PROBE_COMMANDS.has(evalCommand) && !FIBER_COMMANDS.has(evalCommand)) {
        json(res, 400, { ok: false, error: `Unknown eval-probe command: ${evalCommand}` }); return true;
      }
      const requestId = crypto.randomUUID();
      const wsCommand = { type: evalCommand, requestId };
      if (probeId != null) wsCommand.probeId = String(probeId);
      if (ownerIndex != null) wsCommand.ownerIndex = Number(ownerIndex);
      if (prop != null) wsCommand.prop = prop;
      if (body.parentLevel != null) wsCommand.parentLevel = Number(body.parentLevel);
      if (body.filters != null) wsCommand.filters = body.filters;
      if (body.before != null) wsCommand.before = body.before;
      if (body.after != null) wsCommand.after = body.after;
      if (body.options != null) wsCommand.options = body.options;
      if (body.fiberId != null) wsCommand.fiberId = String(body.fiberId);
      if (body.name != null) wsCommand.name = String(body.name);
      if (body.hookIndex != null) wsCommand.hookIndex = Number(body.hookIndex);
      if (body.windowSize != null) wsCommand.windowSize = Number(body.windowSize);
      if (body.max != null) wsCommand.max = Number(body.max);
      const delivered = sendToClient(clientId, wsCommand);
      if (!delivered.ok) { json(res, delivered.code, { ok: false, error: delivered.error }); return true; }
      const result = await waitForPendingResult(pendingEvalProbe, requestId, timeoutMs, 'Timeout waiting for eval-probe result');
      json(res, pageResultStatus(result), { ...withPageResultHint(result), targetClientId: delivered.clientId, resolvedFrom: delivered.resolvedFrom, requestId });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // Proxy API
  if (method === 'GET' && p === `${CHIPPY_PREFIX}/api/proxy/state`) { json(res, 200, { ok: true, proxy: getProxySummary() }); return true; }
  if (method === 'POST' && p === `${CHIPPY_PREFIX}/api/proxy/start`) {
    try { const body = await parseJsonBody(req); json(res, 200, { ok: true, proxy: startProxy(body.targetPort, body.originalUrl) }); }
    catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }
  if (method === 'POST' && p === `${CHIPPY_PREFIX}/api/proxy/stop`) {
    try { json(res, 200, { ok: true, proxy: stopProxy() }); }
    catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return true;
  }

  return false;
}

function handleChippyUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  attachSocket(socket, pageSocketTrust.handshakeOrigin(req.headers));
}

// ─── Server ───────────────────────────────────────────────────────────────────

function chippyRoute(pathname) {
  return isChippyPath(pathname) ? pathname.slice(CHIPPY_PREFIX.length) : null;
}

function rejectUnauthorized(req, url) {
  return helperAccess.authorizeRequest({
    method: req.method || 'GET',
    route: chippyRoute(url.pathname),
    query: url.searchParams,
    headers: req.headers,
    token: helperToken,
    loopback: loopbackBind,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, baseUrlFromReq(req));
  const denied = rejectUnauthorized(req, url);
  if (denied) { json(res, denied.status, { ok: false, error: denied.error }); return; }
  if (isChippyPath(url.pathname)) {
    if (!(await handleChippyHttp(req, res, url))) json(res, 404, { ok: false, error: 'Chippy route not found' });
    return;
  }
  if (proxyState.active) { proxyRequest(req, res); return; }
  json(res, 404, { ok: false, error: 'Not found' });
});

server.on('upgrade', (req, socket, head) => {
  const upgradeUrl = new URL(req.url, 'http://127.0.0.1');
  const p = upgradeUrl.pathname;
  const denied = rejectUnauthorized(req, upgradeUrl);
  if (denied) { socket.write(`HTTP/1.1 ${denied.status} ${denied.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`); socket.destroy(); return; }
  if (p === `${CHIPPY_PREFIX}/ws`) { handleChippyUpgrade(req, socket); return; }
  if (proxyState.active && !isChippyPath(p)) { proxyUpgrade(req, socket, head); return; }
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy();
});

process.on('uncaughtException', (err) => console.error(`[chippy] uncaught: ${err.message}`));

server.listen(port, host, () => {
  const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  console.log(`Chippy helper listening on ${base}`);
  const tokenFile = helperAccess.writeHelperToken(port, helperToken);
  if (tokenFile) console.log(`  token:  ${tokenFile}`);
  if (!loopbackBind) console.warn(`[chippy] bound to ${host}; command routes require the token, but the page WebSocket is reachable from the network`);
  console.log(`  pages:  ${base}${CHIPPY_PREFIX}/api/pages`);
  console.log(`  inject: ${base}${CHIPPY_PREFIX}/inject.js`);
});
