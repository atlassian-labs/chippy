// Drive the React hook-update tracker on the connected page.
//
// The react-dom patch only ever calls `metrics.onHookUpdate(fiber, kind, slot)` when
// a memo/callback/effect RE-COMPUTES because its deps actually changed (update path,
// post dep-equality check). It stores nothing itself. This snippet OWNS that callback
// — the one thing Chippy installs (a consumer hook, not a whole detector) — records
// per-(componentType, slot) update counts, and reports DB-safe histograms + dev-only
// offenders. Faithful port of react-patch `src/metrics/hookTracker.ts`.
//
// Hook kinds are numeric on the hot path: 1 = memo, 2 = callback, 3 = effect.
//
// State persists across eval-page calls on `window.__CHIPPY_HOOK_TRACKER` because
// install / interact / read / uninstall are separate invocations.
//
// Args:
//   --action <name>   REQUIRED. One of:
//                       install    seed metrics if absent, take ownership of onHookUpdate, mode='counts'
//                       mode       set --mode off|counts|debug
//                       status     report installed/mode/entryCount/onHookUpdate ownership
//                       counts     dump source-of-truth: per componentType -> {counts[],type[]} (compact)
//                       histogram  DB-safe: per-kind counts of slot identities reaching each --buckets bucket
//                       offenders  dev-only: hook slots with count > --threshold, carrying component name
//                       reset      clear accumulated counts (stay installed)
//                       uninstall  restore onHookUpdate (only if we still own it), keep last counts
//   --mode <m>        for action=mode: off | counts | debug
//   --buckets <csv>   for action=histogram (default "3,6,11"). Positive finite numbers only.
//   --threshold <N>   for action=offenders (default 10). Reports slots with count > N.
//   --top <N>         for action=offenders: cap rows (default 20).
//
// NOTE: install requires a metrics object. On hosts that wipe __ATL_REACT_METRICS
// to undefined (e.g. after hydration) this snippet SEEDS a minimal one so the tracker
// can own the slot — mirroring how the tracker is meant to be installed independently.
// It never overwrites an existing host object; it only adds the onHookUpdate slot.

const MEMO = 1, CALLBACK = 2, EFFECT = 3;
const KIND_NAME = { 1: 'memo', 2: 'callback', 3: 'effect' };

function getDisplayName(t) {
  if (typeof t === 'function') return t.displayName || t.name || 'anonymous';
  return typeof t === 'string' ? t : 'unknown';
}

// ── persistent tracker singleton on the page ────────────────────────────────
function getTracker() {
  let T = globalThis.__CHIPPY_HOOK_TRACKER;
  if (T && T.__v === 1) return T;

  const state = {
    __v: 1,
    mode: 'off',
    installed: false,
    countsByType: new Map(),      // componentType -> { counts:number[], type:number[] }
    lastFiberByType: new Map(),   // componentType -> fiber (debug mode only)
    record: null,
  };

  function ctype(fiber) {
    if (fiber == null || typeof fiber !== 'object') return 'unknown';
    return fiber.elementType || fiber.type || 'unknown';
  }

  state.record = function record(fiber, kind, slot) {
    if (state.mode === 'off') return;
    const t = ctype(fiber);
    let e = state.countsByType.get(t);
    if (e == null) { e = { counts: [], type: [] }; state.countsByType.set(t, e); }
    e.counts[slot] = (e.counts[slot] || 0) + 1;
    e.type[slot] = kind;
    if (state.mode === 'debug') state.lastFiberByType.set(t, fiber);
  };

  globalThis.__CHIPPY_HOOK_TRACKER = state;
  return state;
}

function ensureMetrics() {
  let m = globalThis.__ATL_REACT_METRICS;
  if (m != null && typeof m === 'object') return { metrics: m, seeded: false };
  // Host absent/wiped — seed a minimal object so the tracker can own onHookUpdate.
  m = { setStateCount: 0 };
  globalThis.__ATL_REACT_METRICS = m;
  return { metrics: m, seeded: true };
}

const T = getTracker();
const action = String(ctx.args.action || '').trim();

if (action === 'install') {
  const { metrics, seeded } = ensureMetrics();
  // TODO: Preserve the displaced callback and owning metrics object on
  // first install, then restore that callback only when this record function
  // still owns the same slot. The current uninstall path calls this a restore
  // but clears the slot to undefined, permanently dropping an earlier consumer.
  metrics.onHookUpdate = T.record;
  T.installed = true;
  if (T.mode === 'off') T.mode = 'counts';
  ctx.log.push('installed onHookUpdate; metrics ' + (seeded ? 'SEEDED' : 'existing') + '; mode=' + T.mode);
  return { ok: true, action, installed: true, mode: T.mode, metricsSeeded: seeded, owns: metrics.onHookUpdate === T.record };
}

if (action === 'mode') {
  const next = String(ctx.args.mode || '').trim();
  if (!['off', 'counts', 'debug'].includes(next)) return { ok: false, error: "--mode must be off|counts|debug" };
  T.mode = next;
  return { ok: true, action, mode: T.mode };
}

if (action === 'status') {
  const m = globalThis.__ATL_REACT_METRICS;
  return {
    ok: true, action,
    installed: T.installed,
    mode: T.mode,
    owns: !!(m && m.onHookUpdate === T.record),
    onHookUpdateType: m ? typeof m.onHookUpdate : 'no-metrics',
    entryCount: T.countsByType.size,
    setStateCount: m ? m.setStateCount : null,
  };
}

if (action === 'reset') {
  T.countsByType = new Map();
  T.lastFiberByType = new Map();
  return { ok: true, action, cleared: true, mode: T.mode, installed: T.installed };
}

if (action === 'uninstall') {
  const m = globalThis.__ATL_REACT_METRICS;
  let restored = false;
  if (m != null && m.onHookUpdate === T.record) { m.onHookUpdate = undefined; restored = true; }
  T.installed = false;
  ctx.log.push('uninstalled; restored=' + restored);
  return { ok: true, action, restored, entryCountRetained: T.countsByType.size };
}

if (action === 'counts') {
  // Source of truth, compact. Aggregated by component TYPE (instances merge).
  const rows = [];
  for (const [t, e] of T.countsByType.entries()) {
    let total = 0; const slots = [];
    for (let s = 0; s < e.counts.length; s++) {
      const c = e.counts[s] || 0;
      if (!c) continue;
      total += c;
      slots.push({ slot: s, count: c, kind: KIND_NAME[e.type[s]] || e.type[s] });
    }
    rows.push({ type: getDisplayName(t), totalUpdates: total, activeSlots: slots.length, slots });
  }
  rows.sort((a, b) => b.totalUpdates - a.totalUpdates);
  return { ok: true, action, mode: T.mode, entryCount: rows.length, types: rows };
}

if (action === 'histogram') {
  const raw = ctx.args.buckets ? String(ctx.args.buckets) : '3,6,11';
  const buckets = raw.split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (buckets.length === 0) return { ok: false, error: 'histogram requires at least one positive finite bucket' };
  const out = { buckets: buckets.slice(), memo: buckets.map(() => 0), callback: buckets.map(() => 0), effect: buckets.map(() => 0) };
  const arrFor = (k) => (k === MEMO ? out.memo : k === CALLBACK ? out.callback : out.effect);
  for (const e of T.countsByType.values()) {
    for (let s = 0; s < e.counts.length; s++) {
      const c = e.counts[s] || 0;
      if (!c) continue;
      const k = e.type[s];
      if (k !== MEMO && k !== CALLBACK && k !== EFFECT) continue;
      const target = arrFor(k);
      for (let b = 0; b < buckets.length; b++) if (c >= buckets[b]) target[b] += 1;
    }
  }
  return { ok: true, action, histogram: out };
}

if (action === 'offenders') {
  const threshold = Number.isFinite(Number(ctx.args.threshold)) ? Number(ctx.args.threshold) : 10;
  const top = Number(ctx.args.top) || 20;
  const offenders = [];
  for (const [t, e] of T.countsByType.entries()) {
    for (let s = 0; s < e.counts.length; s++) {
      const c = e.counts[s] || 0;
      if (c <= threshold) continue;
      const k = e.type[s];
      if (k !== MEMO && k !== CALLBACK && k !== EFFECT) continue;
      const fiber = T.lastFiberByType.get(t);
      offenders.push({
        component: getDisplayName(t),
        source: fiber && fiber._debugSource ? { fileName: fiber._debugSource.fileName, lineNumber: fiber._debugSource.lineNumber } : null,
        hookId: s,
        type: KIND_NAME[k],
        count: c,
      });
    }
  }
  offenders.sort((a, b) => b.count - a.count);
  if (T.mode !== 'debug') ctx.log.push('mode is "' + T.mode + '": source locations require --mode debug before reproducing.');
  return { ok: true, action, threshold, mode: T.mode, offenders: offenders.slice(0, top) };
}

return { ok: false, error: 'unknown --action "' + action + '". Use install|mode|status|counts|histogram|offenders|reset|uninstall' };
