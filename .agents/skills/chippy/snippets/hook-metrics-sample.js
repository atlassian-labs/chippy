// Capture a labeled before/after setStateCount delta in ONE call.
//
// This is the "lighthouse number" pattern as a first-class read: sample the cheap
// counter, run a bounded action (a click by testId, or just settle), sample again,
// return the delta. Answers "how many components fired setState during <phase>".
//
// METRIC IS OPTIONAL. The react-dom patch that emits __ATL_REACT_METRICS.setStateCount
// may or may not be present. If it is absent, wiped, or non-finite (NaN), this snippet
// returns { available:false, reason } and NEVER throws — callers must not rely on the
// metric being there.
//
// Args:
//   --label <text>     OPTIONAL. Human label for the phase (default "sample").
//   --click <testId>   OPTIONAL. data-testid to click between before/after samples.
//   --clicks <n>       OPTIONAL. repeat the click n times (default 1).
//   --settleMs <n>     OPTIONAL. ms to wait after the action before the after-sample
//                      (default 300). Also used as the whole wait when no --click.
//
// Output (available):
//   { available:true, label, before, after, delta, clicked, settleMs }
// Output (unavailable):
//   { available:false, label, reason }

function readSSC() {
  const m = globalThis.__ATL_REACT_METRICS;
  if (m == null) return { ok: false, reason: 'metrics absent (__ATL_REACT_METRICS is ' + String(m) + ')' };
  const v = m.setStateCount;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { ok: false, reason: 'setStateCount is ' + String(v) + ' (patch absent or seeded non-numeric)' };
  }
  return { ok: true, value: v };
}

const label = ctx.args.label ? String(ctx.args.label) : 'sample';
const settleMs = Number.isFinite(Number(ctx.args.settleMs)) ? Number(ctx.args.settleMs) : 300;
const clickId = ctx.args.click ? String(ctx.args.click) : null;
const clicks = Number(ctx.args.clicks) > 0 ? Number(ctx.args.clicks) : 1;

const b = readSSC();
if (!b.ok) {
  ctx.log.push('setStateCount unavailable: ' + b.reason);
  return { available: false, label, reason: b.reason };
}
const before = b.value;

let clicked = 0;
if (clickId) {
  const sel = '[data-testid="' + clickId + '"]';
  for (let i = 0; i < clicks; i++) {
    const el = document.querySelector(sel);
    if (el) { el.click(); clicked++; }
    // small yield so React can flush between clicks
    await new Promise((r) => setTimeout(r, Math.min(80, settleMs)));
  }
  if (clicked === 0) ctx.log.push('no element matched ' + sel);
}

await new Promise((r) => setTimeout(r, settleMs));

const a = readSSC();
if (!a.ok) {
  // metric vanished mid-sample (host wiped it) — report honestly
  return { available: false, label, reason: 'after-sample: ' + a.reason, before };
}
const after = a.value;

ctx.log.push(label + ': ' + before + ' -> ' + after + ' (delta ' + (after - before) + ')');

return { available: true, label, before, after, delta: after - before, clicked, settleMs };
