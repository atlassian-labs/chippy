// Read the host-owned React metrics object (__ATL_REACT_METRICS) — READ ONLY.
//
// Chippy READS this object; it does not create or seed it (the host/app owns it,
// same way Chippy reads any avalanche counter). The only new hook-related number
// here is `setStateCount` (useState/useReducer dispatches scheduled). Richer
// hook-update accounting lives in the separate `hook-tracker` snippet.
//
// Args:
//   --keys <csv>   OPTIONAL. Comma-separated counter names to return (default: all).
//   --raw          OPTIONAL. If present, return every own key regardless of type.
//
// Output:
//   { present, wiped, setStateCount, setStateCountValid, counters:{...}, onHookUpdateInstalled }
//
// NaN/undefined-safe: the host may seed setStateCount as null (then react-dom's
// `null++` yields NaN) or wipe the whole object to undefined after hydration.
// This reader reports those states honestly instead of throwing.

const m = globalThis.__ATL_REACT_METRICS;

if (m == null) {
  ctx.log.push('__ATL_REACT_METRICS is ' + String(m) + ' (host absent or wiped post-hydration)');
  return {
    present: false,
    wiped: typeof m === 'undefined',
    note: 'Host metrics object not present. It may not exist yet, or the app wiped it after hydration. Reads return no data; use hook-tracker to own the onHookUpdate slot regardless.',
  };
}

const wantKeys = ctx.args.keys
  ? String(ctx.args.keys).split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const raw = !!ctx.args.raw;

const isNumericCounter = (v) => typeof v === 'number';

const counters = {};
for (const k of Object.keys(m)) {
  if (wantKeys && !wantKeys.includes(k)) continue;
  const v = m[k];
  if (raw) { counters[k] = typeof v === 'function' ? '[Function ' + (v.name || 'anonymous') + ']' : v; continue; }
  if (isNumericCounter(v)) counters[k] = v;
}

const ssc = m.setStateCount;
const setStateCountValid = typeof ssc === 'number' && Number.isFinite(ssc);

ctx.log.push('setStateCount=' + String(ssc) + ' valid=' + setStateCountValid + ' onHookUpdate=' + typeof m.onHookUpdate);

return {
  present: true,
  wiped: false,
  setStateCount: ssc,
  setStateCountValid,
  setStateCountNote: setStateCountValid
    ? null
    : 'setStateCount is ' + String(ssc) + '. Host likely seeded it as null/undefined and react-dom incremented it to NaN. It is still monotonic-per-run once numeric; re-seed via hook-tracker install if you need a clean baseline.',
  onHookUpdateInstalled: typeof m.onHookUpdate === 'function',
  counters,
};
