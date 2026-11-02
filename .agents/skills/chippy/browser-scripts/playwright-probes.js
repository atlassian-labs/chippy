/* eslint-disable */
/**
 * Playwright probe surface for Chippy.
 *
 * Wraps the shared __CHIPPY runtime that is already injected by
 * `playwright-session.js`. Probes here are AI-driven focus descriptors,
 * NOT extension marker UI. No duplicate resolution, no coordinate identity.
 *
 * Lifecycle: acquire → resolve → inspect → measure → mutate → re-resolve.
 */

const { launchSession } = require('./playwright-session');
const { TOKEN_HEADER, readHelperToken } = require('../scripts/helper-access');

const PROBES = new Map(); // sessionId → Map<probeId, Probe>
let SESSION_COUNTER = 0;
const SESSION_IDS = new WeakMap();

function sessionId(session) {
  if (!session || !session.page) throw new Error('Invalid session');
  let id = SESSION_IDS.get(session);
  if (!id) {
    SESSION_COUNTER += 1;
    id = `session-${SESSION_COUNTER}`;
    SESSION_IDS.set(session, id);
  }
  return id;
}

function probeStore(session) {
  const id = sessionId(session);
  if (!PROBES.has(id)) PROBES.set(id, new Map());
  return PROBES.get(id);
}

function nowIso() { return new Date().toISOString(); }

function classifyConfidence(resolution) {
  if (!resolution?.best) return 'none';
  if (resolution.best.strict) return 'strict';
  if (resolution.best.score >= 12) return 'high';
  if (resolution.best.score >= 7) return 'medium';
  return 'low';
}

async function ensureRuntime(page) {
  await page.waitForFunction(() => !!globalThis.__CHIPPY?.captureProbeDescriptor && !!globalThis.__CHIPPY?.resolveProbeDescriptor);
}

// ─── Session ────────────────────────────────────────────────────────────────

async function launch(options = {}) {
  const session = await launchSession({ ...options });
  await ensureRuntime(session.page);
  return session;
}

async function close(session) {
  PROBES.delete(sessionId(session));
  await session.browser.close();
}

async function goto(session, url, options = {}) {
  await session.page.goto(url, { waitUntil: 'domcontentloaded', ...options });
  await ensureRuntime(session.page);
}

async function reload(session, options = {}) {
  await session.page.reload({ waitUntil: 'domcontentloaded', ...options });
  await ensureRuntime(session.page);
}

// ─── Probe acquisition ──────────────────────────────────────────────────────

function defineProbe({ id, intent, descriptor }) {
  if (!id) throw new Error('Probe id required');
  if (!descriptor?.dom || !descriptor?.component) throw new Error('Probe descriptor required');
  return { id, intent: intent || null, descriptor, resolved: null, history: [], createdAt: nowIso() };
}

function registerProbe(session, probe) {
  const store = probeStore(session);
  store.set(probe.id, probe);
  return probe;
}

async function captureFromNode(session, locator) {
  await ensureRuntime(session.page);
  const handle = await locator.elementHandle();
  if (!handle) throw new Error('Locator did not resolve to an element');
  const result = await session.page.evaluate((node) => globalThis.__CHIPPY.captureProbeDescriptor(node), handle);
  await handle.dispose();
  if (!result?.ok) throw new Error(result?.error || 'captureProbeDescriptor failed');
  return result.descriptor;
}

async function captureFromSelector(session, selector) {
  return captureFromNode(session, session.page.locator(selector).first());
}

// ─── Probe resolution ──────────────────────────────────────────────────────

async function resolveProbe(session, probe, options = {}) {
  await ensureRuntime(session.page);
  const resolution = await session.page.evaluate(
    ([descriptor, opts]) => globalThis.__CHIPPY.resolveProbeDescriptor(descriptor, opts || {}),
    [probe.descriptor, options],
  );
  probe.resolved = resolution?.best
    ? {
        confidence: classifyConfidence(resolution),
        candidateKind: resolution.best.candidateKind,
        score: resolution.best.score,
        matches: resolution.best.matches,
        component: resolution.best.component,
        dom: resolution.best.dom,
        alternates: resolution.candidates.slice(1),
        resolvedAt: nowIso(),
      }
    : null;
  probe.history.push({ at: nowIso(), confidence: probe.resolved?.confidence || 'none', score: resolution?.best?.score || 0 });
  return { resolution, probe };
}

async function refreshProbe(session, probeId, options = {}) {
  const store = probeStore(session);
  const probe = store.get(probeId);
  if (!probe) throw new Error(`Probe not found: ${probeId}`);
  return resolveProbe(session, probe, options);
}

function listProbes(session) {
  return Array.from(probeStore(session).values());
}

function removeProbe(session, probeId) {
  return probeStore(session).delete(probeId);
}

// ─── Helper to act on a resolved probe in page context ──────────────────────

async function withResolvedNode(session, probe, fn) {
  if (!probe.resolved) await resolveProbe(session, probe);
  if (!probe.resolved) throw new Error(`Probe ${probe.id} could not be resolved`);
  return session.page.evaluate(({ descriptor, payload }) => {
    const resolution = globalThis.__CHIPPY.resolveProbeDescriptor(descriptor);
    if (!resolution?.best?.node) return { error: 'Probe not resolvable in current page state' };
    return globalThis.__CHIPPY.__playwrightOps?.(payload, resolution.best) || { error: '__playwrightOps missing' };
  }, { descriptor: probe.descriptor, payload: fn });
}

// Inject a small dispatcher into the page each call so all inspect ops share one path.
async function dispatch(session, probe, op) {
  if (!probe.resolved) await resolveProbe(session, probe);
  if (!probe.resolved) throw new Error(`Probe ${probe.id} could not be resolved`);
  return session.page.evaluate(({ descriptor, op }) => {
    const C = globalThis.__CHIPPY;
    const resolution = C.resolveProbeDescriptor(descriptor);
    const best = resolution?.best;
    if (!best?.node) return { error: 'Probe not resolvable in current page state' };
    const node = best.node;
    const fiber = best.fiber || C.getClosestFiber?.(node) || null;
    switch (op.type) {
      case 'probeDom':
        return C.evalElementDom(node, op.parentLevel || 0);
      case 'probeOwners':
        return C.inspectNode?.(node)?.component?.owners || [];
      case 'probeOwner':
        return (C.inspectNode?.(node)?.component?.owners || [])[op.ownerIndex] || null;
      case 'probeProps':
        return C.evalFiberProps(fiber, op.ownerIndex);
      case 'probePropValue':
        return C.evalFiberPropValue(fiber, op.propName, op.ownerIndex);
      case 'probeHooks':
        return C.evalFiberHooks(fiber);
      case 'getComputedStyle': {
        const target = op.parentLevel ? (() => { let el = node; for (let i = 0; i < op.parentLevel && el?.parentElement; i++) el = el.parentElement; return el; })() : node;
        const cs = window.getComputedStyle(target);
        const out = {};
        for (const name of cs) out[name] = cs.getPropertyValue(name);
        return out;
      }
      default:
        return { error: `Unknown op: ${op.type}` };
    }
  }, { descriptor: probe.descriptor, op });
}

// ─── Inspect ────────────────────────────────────────────────────────────────

const probeDom = (session, probe, parentLevel = 0) => dispatch(session, probe, { type: 'probeDom', parentLevel });
const probeOwners = (session, probe) => dispatch(session, probe, { type: 'probeOwners' });
const probeOwner = (session, probe, ownerIndex) => dispatch(session, probe, { type: 'probeOwner', ownerIndex });
const probeProps = (session, probe, ownerIndex) => dispatch(session, probe, { type: 'probeProps', ownerIndex });
const probePropValue = (session, probe, propName, ownerIndex) => dispatch(session, probe, { type: 'probePropValue', propName, ownerIndex });
const probeHooks = (session, probe) => dispatch(session, probe, { type: 'probeHooks' });
const getComputedStyle = (session, probe, parentLevel = 0) => dispatch(session, probe, { type: 'getComputedStyle', parentLevel });

// ─── Measure (avalanche) ────────────────────────────────────────────────────

// Avalanche flows through the helper. Playwright session connects to the
// helper as a normal client; the helper drives `__AVALANCHE__` on the page
// via the page-bridge WS. Reads come back through helper HTTP responses.
//
// Why helper-routed and not page.evaluate:
//   - one orchestrator (arming, auto-start, reload-with-avalanche)
//   - one result format across extension and Playwright
//   - one place to reason about cross-session capture state
//
// Read flow:
//   helper HTTP  →  WS to client  →  __CHIPPY.pageBridge.evalAvalanche  →
//   __AVALANCHE__.<action>  →  result back through WS  →  helper HTTP body
//
// You only need the clientId for the Playwright page; helper does the rest.

const HELPER_BASE = process.env.CHIPPY_HELPER_BASE || 'http://127.0.0.1:7823/__chippy';
const HELPER_PORT = Number(new URL(HELPER_BASE).port) || 80;

function helperHeaders(headers = {}) {
  const token = readHelperToken(HELPER_PORT);
  return token ? { ...headers, [TOKEN_HEADER]: token } : headers;
}

async function helperFetch(path, body = {}) {
  const response = await fetch(`${HELPER_BASE}${path}`, {
    method: 'POST',
    headers: helperHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload?.ok !== false, status: response.status, payload };
}

async function ensureClientId(session) {
  if (session.clientId) return session.clientId;
  await ensureRuntime(session.page);
  const start = Date.now();
  let id = null;
  while (Date.now() - start < 8000) {
    id = await session.page.evaluate(() => globalThis.__CHIPPY?.pageBridge?.getState?.()?.clientId || null);
    if (id) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!id) throw new Error('Playwright page did not register a clientId locally.');
  // Wait until the helper has actually registered this clientId in /api/pages.
  // Reload reuses the persisted clientId, but the helper needs the new socket
  // to (re)register before it will accept commands for it.
  while (Date.now() - start < 12000) {
    const pages = await fetch(`${HELPER_BASE}/api/pages`, { headers: helperHeaders() }).then((r) => r.json()).catch(() => null);
    if (pages?.pages?.some((page) => page.clientId === id)) {
      session.clientId = id;
      return id;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Helper never observed clientId ${id} after reload`);
}

async function avalanche(session, action, payload = {}) {
  const clientId = await ensureClientId(session);
  return helperFetch(`/api/pages/${clientId}/avalanche`, { action, ...payload });
}

// reloadWithAvalanche (Playwright model)
//
// Playwright owns the page. The shared __CHIPPY runtime + __AVALANCHE__ are
// installed via addInitScript by the session loader, so they exist BEFORE any
// page script runs on every reload. There is no race to win, no arming to
// orchestrate. The agent already controls the lifecycle.
//
// Therefore: just reload, wait for the runtime, settle, read.
// (Browser/extension flow uses helper arm + auto-start because it cannot
// guarantee inject ordering. PW does not need that.)
//
// Requirement: session must have been launched via launch(...) which uses
// installHelpers({ init: true }) under the hood.

async function reloadWithAvalanche(session, { settleMs = 3000, hotLimit = 12 } = {}) {
  const previousClientId = session.clientId;
  session.clientId = null;
  await session.page.reload({ waitUntil: 'domcontentloaded' });
  await ensureRuntime(session.page);
  const clientId = await ensureClientId(session);
  // The avalanche IIFE is re-injected by addInitScript on every navigation,
  // but its "installed" state is per-page-runtime and starts at false. PW owns
  // the lifecycle, so we install explicitly right after reload — no race, no
  // origin-arming needed.
  const install = await avalanche(session, 'install');
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
  const status = await avalanche(session, 'status');
  const hot = await avalanche(session, 'hot-sources', { limit: hotLimit });
  return { previousClientId, clientId, install, status, hot };
}

const avalancheStart = (session, max) => avalanche(session, 'install', {
  options: {
    detectionMode: 'full',
    captureFibers: true,
    ...(max != null ? { historySize: Math.max(100, Number(max) || 1000) } : {}),
  },
});
const avalancheStop = (session) => avalanche(session, 'stop');
const avalancheStatus = (session) => avalanche(session, 'status');
const avalancheMetrics = (session) => avalanche(session, 'metrics');
const avalancheHotSources = (session, limit) => avalanche(session, 'hot-sources', limit != null ? { limit } : {});
const avalancheExport = (session, lastN) => avalanche(session, 'export', lastN != null ? { count: lastN } : {});

// ─── Compare ────────────────────────────────────────────────────────────────

async function snapshotProbe(session, probe) {
  await resolveProbe(session, probe);
  const dom = probe.resolved ? await probeDom(session, probe) : null;
  const props = probe.resolved ? await probeProps(session, probe).catch(() => null) : null;
  return {
    at: nowIso(),
    descriptor: probe.descriptor,
    resolved: probe.resolved,
    dom,
    props,
  };
}

function diffProbeSnapshots(a, b) {
  const diff = { confidenceChanged: false, scoreDelta: 0, domChanged: false, propsChanged: false };
  if (!a || !b) return { error: 'Two snapshots required' };
  diff.confidenceChanged = a.resolved?.confidence !== b.resolved?.confidence;
  diff.scoreDelta = (b.resolved?.score || 0) - (a.resolved?.score || 0);
  diff.domChanged = JSON.stringify(a.dom || {}) !== JSON.stringify(b.dom || {});
  diff.propsChanged = JSON.stringify(a.props || {}) !== JSON.stringify(b.props || {});
  return diff;
}

module.exports = {
  // session
  launch,
  close,
  goto,
  reload,
  // probes
  defineProbe,
  registerProbe,
  captureFromNode,
  captureFromSelector,
  resolveProbe,
  refreshProbe,
  listProbes,
  removeProbe,
  // inspect
  probeDom,
  probeOwners,
  probeOwner,
  probeProps,
  probePropValue,
  probeHooks,
  getComputedStyle,
  // measure
  avalanche,
  avalancheStart,
  avalancheStop,
  avalancheStatus,
  avalancheMetrics,
  avalancheHotSources,
  avalancheExport,
  reloadWithAvalanche,
  // compare
  snapshotProbe,
  diffProbeSnapshots,
};
