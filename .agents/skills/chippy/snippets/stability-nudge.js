// Stability render nudge — trigger a controlled re-render on a single fiber.
//
// PROCEDURE layer. The CAPABILITY (forcing a re-render via the React DevTools
// renderer's scheduleUpdate) lives in the bundle:
//   src/chippy-bridge/fiber-schedule-update.ts → window.__AVALANCHE__.bridge.evalFiberScheduleUpdate
//
// This snippet composes the stability-render procedure on top of that capability:
// it resolves a probe/testId to a component fiber (DOM context the bridge does
// not have), optionally climbs the owner chain, then asks the capability to
// schedule exactly one re-render. Mutates nothing.
//
// Because the mechanism lives in the bundle, this procedure can evolve here with
// zero extension/store publish. See references/stability-render.md.
//
// Args (one of --probeId or --testId is required):
//   --probeId <id>            probe id ("1" | "2" | "3")
//   --testId <string>         data-testid of the target element
//   --ownerIndex <N>          optional, walk N steps up owner chain (default 0)
//   --label <string>          optional, echoed into ctx.log
//   --dryRun <true|false>     resolve + report fiber, do not schedule
//
// Returns: { ok, fiberName, source, ownerIndex, label?, reason? }

const probeId = ctx.args.probeId == null ? null : String(ctx.args.probeId);
const testId = ctx.args.testId == null ? null : String(ctx.args.testId);
const ownerIndex = Number.isFinite(Number(ctx.args.ownerIndex)) ? (Number(ctx.args.ownerIndex) | 0) : 0;
const label = ctx.args.label != null ? String(ctx.args.label) : null;
const dryRun = ctx.args.dryRun === true || ctx.args.dryRun === 'true';

if (!probeId && !testId) return { ok: false, reason: 'missing-target (need --probeId or --testId)' };
if (label) ctx.log.push('label: ' + label);

// 1. Resolve target → DOM node → composite fiber.
function fiberFromNode(node) {
  if (!node) return null;
  const keys = Object.keys(node).filter((k) => k.startsWith('__reactFiber$'));
  let f = keys.length ? node[keys[0]] : null;
  while (f && (typeof f.type === 'string' || f.type == null)) f = f.return;
  return f;
}

let fiber = null;
if (testId) {
  const node = document.querySelector('[data-testid="' + testId.replace(/"/g, '\\"') + '"]');
  if (!node) return { ok: false, reason: 'testid-not-found: ' + testId, label };
  ctx.log.push('resolved by testId: ' + testId);
  fiber = fiberFromNode(node);
  if (!fiber) return { ok: false, reason: 'no-composite-fiber-for-testid', label };
} else {
  // Same probe → fiber resolution the bridge uses for probe-props/probe-hooks.
  const lab = globalThis.__CHIPPY && globalThis.__CHIPPY.layoutLab;
  if (!lab || typeof lab.getMarkerProbe !== 'function') return { ok: false, reason: 'no-resolver', label };
  const marker = lab.getMarkerProbe(probeId);
  const probe = marker && marker.probe;
  if (!probe) return { ok: false, reason: 'probe-not-placed: ' + probeId, label };
  let best = probe._bestFiber || null;
  while (best && (typeof best.type === 'string' || best.type == null)) best = best.return;
  fiber = best || fiberFromNode(probe._targetEl || null);
  if (!fiber) return { ok: false, reason: 'no-composite-fiber', label };
}

if (dryRun) {
  // Climb here only for reporting; the capability does its own walk on the real run.
  let preview = fiber;
  let walked = 0;
  while (walked < ownerIndex && preview) { preview = preview._debugOwner || null; walked++; }
  if (!preview) return { ok: false, reason: 'owner-out-of-range', label };
  const name =
    (preview.type && (preview.type.displayName || preview.type.name)) ||
    (preview.elementType && (preview.elementType.displayName || preview.elementType.name)) ||
    '<anonymous>';
  const src = preview._debugSource
    ? { fileName: preview._debugSource.fileName, lineNumber: preview._debugSource.lineNumber }
    : null;
  ctx.log.push('dryRun target: ' + name + (src ? ' @ ' + src.fileName + ':' + src.lineNumber : ''));
  return { ok: true, dryRun: true, fiberName: name, source: src, ownerIndex, label };
}

// 2. Delegate the actual re-render to the bundle capability. We already hold the
//    fiber, so we hand the capability deps that resolve straight to it.
const av = globalThis.__AVALANCHE__;
const bridge = av && av.bridge;
if (!bridge || typeof bridge.evalFiberScheduleUpdate !== 'function') {
  return { ok: false, reason: 'bridge-capability-missing (avalanche.iife.js not loaded)', label };
}

const FIXED_ID = '__nudge_target__';
const result = bridge.evalFiberScheduleUpdate(FIXED_ID, ownerIndex, {
  normalizeRememberedFiberId: (id) => (id === FIXED_ID ? FIXED_ID : null),
  getRememberedFiber: (id) => (id === FIXED_ID ? fiber : null),
});

if (result && result.ok) {
  ctx.log.push('scheduled: ' + result.fiberName + (result.source ? ' @ ' + result.source.fileName + ':' + result.source.lineNumber : ''));
  return { ok: true, fiberName: result.fiberName, source: result.source, ownerIndex: result.ownerIndex, label };
}
return { ok: false, reason: (result && result.reason) || 'schedule-failed', error: result && result.error, fiberName: result && result.fiberName, label };
