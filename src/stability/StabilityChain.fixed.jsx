// StabilityChain — fixed companion fixture.
//
// Same shape as StabilityChain.jsx, but with the three iterative fixes the
// stability-render sub-skill proposes. Use this fixture to verify that the
// stability-render procedure correctly reports a clean reading after fixes.
//
// Fix 1 (correctness — effect re-fire):
//   useEffect deps narrowed from [handler] to [opts.mode]. The effect attaches
//   a subscription whose semantic input is the mode primitive, not the callback
//   identity. Effect now runs on mount and only when mode actually changes.
//
// Fix 2 (cascade prevention — callback identity):
//   useCallback deps narrowed from [opts] to [opts.mode]. Callback identity is
//   now stable across nudges. Any future memoised child consuming `handler`
//   will not be torn out of memo.
//
// Fix 3 (defence in depth — upstream object):
//   `opts` wrapped in useMemo so consumers below see a stable reference. With
//   Fix 1 + Fix 2 in place this is no longer required for correctness, but it
//   protects future consumers added to this subtree.
//
// Expected stability-render reading after these fixes:
//   commitCount: 1, sources: 1 (StabilityChain only),
//   collateral: 0 (Leaf does NOT re-render — opts is stable so memo bails),
//   effects: 0, callbacks: 0, restarts: 0.
//
// NOTE: Leaf is wrapped in React.memo to make the prop-stability win visible.
// Without memo, even a stable `opts` reference would still cause Leaf to render
// because React renders every child on parent commit by default.

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const sink = {
  attachCount: 0,
  detachCount: 0,
  fireCount: 0,
};

function attach(handler) {
  sink.attachCount += 1;
  return () => {
    sink.detachCount += 1;
  };
}

const Leaf = React.memo(function Leaf({ opts }) {
  const [localTick, setLocalTick] = useState(0);

  // Fix 2: dep narrowed to the primitive the callback actually reads.
  const handler = useCallback(
    (event) => {
      sink.fireCount += 1;
      return event && event.type ? event.type : opts.mode;
    },
    [opts.mode],
  );

  // Fix 1: dep narrowed to the primitive the effect actually depends on.
  // The handler is closed over via ref-style access — we read `handler` from
  // the enclosing scope at call time. Since `handler` identity is now stable
  // (Fix 2), even if it were in the deps the effect would not re-fire.
  useEffect(() => {
    const detach = attach(handler);
    setLocalTick((n) => n + 1);
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.mode]);

  return (
    <div data-testid="stability-chain-leaf">
      <div>localTick: {localTick}</div>
      <div>attach/detach: {sink.attachCount}/{sink.detachCount}</div>
      <div>handler fires: {sink.fireCount}</div>
    </div>
  );
});

export default function StabilityChainFixed({ mode = 'a' }) {
  // Orphan nudge anchor — required for stability-render to target Parent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [, _setNudgeAnchor] = useState(0);

  // Fix 3: opts identity is now stable across nudges.
  const opts = useMemo(() => ({ mode }), [mode]);

  return (
    <div data-testid="stability-chain-fixed">
      <h3>StabilityChain (fixed) — clean memo → callback → effect chain</h3>
      <p>Stability-nudge on this container should produce a single source commit, zero collateral.</p>
      <Leaf opts={opts} />
    </div>
  );
}
