import React from 'react';

// =====================================================================
// MetricsLab — a "lighthouse numbers" demonstrator for the react-dom
// hook metrics patch (setStateCount + onHookUpdate).
//
// The thesis this fixture exists to prove:
//   - Avalanche hooks React at a low level (onCommitFiberRoot + fiber walk).
//     It sees the *whole picture* (collateral, penetration, context waves) but
//     at a cost that is fine for on-demand debugging and wrong for shipping to
//     every real user in realtime.
//   - The patch's metrics are just integer counters bumped inline in react-dom.
//     They are cheap enough to read on every hydration / route transition and
//     forward to a dashboard — "lighthouse numbers", not a profiler.
//
// This lab produces two measurable bursts:
//   1. HYDRATION burst  — every widget schedules one setState on mount
//      (simulating stores/effects settling after first paint).
//   2. TRANSITION burst — flipping the "route" key remounts a fresh wave of
//      widgets, each of which settles again.
//
// Read the counters with the chippy `hook-metrics` and `hook-tracker` snippets
// (see references/hook-metrics.md). The in-page HUD mirrors what a real monitor
// would sample: setStateCount, and per-kind hook recompute totals.
// =====================================================================

function readMetrics() {
  const m = typeof window !== 'undefined' ? window.__ATL_REACT_METRICS : null;
  if (m == null) return { present: false, setStateCount: null };
  return { present: true, setStateCount: m.setStateCount };
}

// A widget that "settles" once after mount (hydration wave) and recomputes a
// memo whenever its `epoch` prop changes (transition wave). Deliberately small:
// the point is quantity of components, not per-widget cost.
function SettlingWidget({ id, epoch, churnDep }) {
  const [settled, setSettled] = React.useState(false);
  const [value, setValue] = React.useState(0);

  // Hydration wave: schedule exactly one setState after first paint.
  React.useEffect(() => {
    const t = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Transition wave: when epoch changes, do a small state update.
  React.useEffect(() => {
    if (epoch > 0) setValue((v) => v + 1);
  }, [epoch]);

  // A memo whose dep is *stable* — should NOT recompute on unrelated renders.
  const stableDerived = React.useMemo(() => id * 2, [id]);

  // A memo whose dep is the chur*ning* input — recomputes every transition.
  const churnDerived = React.useMemo(() => `${churnDep}:${value}`, [churnDep, value]);

  return (
    <div
      data-testid={`widget-${id}`}
      data-settled={settled}
      style={{
        padding: '0.5rem 0.75rem',
        borderRadius: 10,
        border: '1px solid #d1d5db',
        background: settled ? '#ecfdf5' : '#fff7ed',
        fontSize: 12,
        minWidth: 90,
      }}
    >
      <strong>#{id}</strong>
      <div style={{ color: '#6b7280' }}>{settled ? 'settled' : 'settling…'}</div>
      <div style={{ color: '#9ca3af' }}>{stableDerived} · {churnDerived}</div>
    </div>
  );
}

const HUD_STYLE = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  padding: '0.75rem 1rem',
  borderRadius: 12,
  background: '#0f172a',
  color: '#e2e8f0',
  marginBottom: '1rem',
  display: 'grid',
  gap: 4,
};

export default function MetricsLab({ widgetCount = 12 }) {
  // "route" epoch — bumping it remounts the whole widget wave (transition).
  const [epoch, setEpoch] = React.useState(0);
  // A churning input passed to every widget's churnDerived memo.
  const [churnDep, setChurnDep] = React.useState('a');
  const [hud, setHud] = React.useState(() => readMetrics());

  const refreshHud = React.useCallback(() => setHud(readMetrics()), []);

  const ids = React.useMemo(
    () => Array.from({ length: widgetCount }, (_, i) => i + 1),
    [widgetCount],
  );

  return (
    <div style={{ padding: '1rem', maxWidth: 760 }}>
      <div style={HUD_STYLE}>
        <div>🛰️ lighthouse HUD (sampled on demand — like a real monitor)</div>
        <div>
          __ATL_REACT_METRICS: {hud.present ? 'present' : 'absent/wiped'} ·{' '}
          setStateCount: <strong>{String(hud.setStateCount)}</strong>
        </div>
        <div style={{ color: '#94a3b8' }}>
          widgets: {widgetCount} · epoch: {epoch} · churnDep: {churnDep}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button data-testid="transition" onClick={() => setEpoch((e) => e + 1)}>
          Transition (remount wave)
        </button>
        <button data-testid="churn" onClick={() => setChurnDep((c) => (c === 'a' ? 'b' : 'a'))}>
          Churn dep (memo recompute)
        </button>
        <button data-testid="refresh-hud" onClick={refreshHud}>
          Sample metrics → HUD
        </button>
      </div>

      {/* key=epoch forces a fresh mount of the whole wave on transition */}
      <div
        key={epoch}
        data-testid="widget-wave"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
      >
        {ids.map((id) => (
          <SettlingWidget key={id} id={id} epoch={epoch} churnDep={churnDep} />
        ))}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// MixedChurn — a widget wave where a single "tick" changes deps for ALL three
// hook kinds at once, so a capture shows non-zero memo + callback + effect
// recompute counts in the hook-tracker. Complements the pure-memo Default lab.
// ---------------------------------------------------------------------------

function MixedChurnWidget({ id, tick }) {
  const [, setLocal] = React.useState(0);

  // memo: dep = tick -> recomputes every tick
  const derived = React.useMemo(() => id * 100 + tick, [id, tick]);

  // callback: dep = tick -> a NEW function identity every tick (callback recompute)
  const onPing = React.useCallback(() => id + tick, [id, tick]);

  // effect: dep = tick -> re-runs every tick (does a tiny state bump so setStateCount
  // also moves, demonstrating both the cheap counter AND the tracker together)
  React.useEffect(() => {
    if (tick > 0) setLocal((n) => n + 1);
  }, [tick, onPing]);

  return (
    <div
      data-testid={`mixed-${id}`}
      style={{
        padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid #cbd5e1',
        background: '#eff6ff', fontSize: 12, minWidth: 84,
      }}
    >
      <strong>#{id}</strong>
      <div style={{ color: '#64748b' }}>d={derived}</div>
    </div>
  );
}

export function MixedChurnLab({ widgetCount = 12 }) {
  const [tick, setTick] = React.useState(0);
  const [hud, setHud] = React.useState(() => readMetrics());
  const ids = React.useMemo(
    () => Array.from({ length: widgetCount }, (_, i) => i + 1),
    [widgetCount],
  );
  return (
    <div style={{ padding: '1rem', maxWidth: 760 }}>
      <div style={HUD_STYLE}>
        <div>🛰️ MixedChurn HUD — one tick churns memo + callback + effect deps</div>
        <div>
          setStateCount: <strong>{String(hud.setStateCount)}</strong> · tick: {tick} · widgets: {widgetCount}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button data-testid="tick" onClick={() => setTick((t) => t + 1)}>
          Tick (churn all 3 kinds)
        </button>
        <button data-testid="refresh-hud" onClick={() => setHud(readMetrics())}>
          Sample metrics → HUD
        </button>
      </div>
      <div data-testid="mixed-wave" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {ids.map((id) => (
          <MixedChurnWidget key={id} id={id} tick={tick} />
        ))}
      </div>
    </div>
  );
}
