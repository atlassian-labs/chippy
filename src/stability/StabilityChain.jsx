// StabilityChain — example fixture for the stability-render sub-skill.
//
// Shape (intentionally broken):
//
//   Parent
//    └─ memo: opts = { mode: 'a' }            ← NEW IDENTITY EVERY RENDER (no useMemo)
//       └─ useCallback(handler, [opts])        ← deps include unstable memo → NEW callback every render
//          └─ useEffect(..., [handler])        ← deps include unstable callback → EFFECT FIRES EVERY RENDER
//             └─ effect body: setState(...)    ← effect schedules another render → CASCADE
//
// What an avalanche stability-render capture should reveal, in priority order:
//   1. Worst symptom: useEffect re-fires every commit. This is functionally wrong,
//      not just slow. Effects with side effects (subscriptions, fetches, timers,
//      analytics) running per-render breaks invariants.
//   2. Cause one level up: the callback in deps has a new identity each render.
//   3. Cause two levels up: the memo in the callback's deps has a new identity each render.
//
// Fix order (not done here — left for the agent to propose):
//   FIRST   stop the effect re-fire (stabilise its deps OR remove the dep OR move the
//           subscription out of effect-deps land).
//   SECOND  stabilise the callback (so memoised children below also stop churning).
//   THIRD   stabilise the upstream object identity (so the callback's deps stop flipping).
//
// Each fix is independent and can be verified with one stability-render capture
// before moving to the next.

import React, { useCallback, useEffect, useState } from 'react';

// NOTE: this fixture deliberately exposes NO user-facing trigger
// (no button, no input, no event handler wired to UI). Chippy must
// drive a re-render by nudging a fiber directly via stability-nudge.
// If you find yourself adding "click here to re-render", stop —
// that is the bug the sub-skill exists to avoid.

// ---------------------------------------------------------------------------
// Sink — a "subscription" target that records every effect re-attach.
// In a real app this would be a websocket, an event listener, an analytics
// pageview, etc. Here it just counts so the cascade is visible in DevTools.
// ---------------------------------------------------------------------------
const sink = {
  attachCount: 0,
  detachCount: 0,
  fireCount: 0,
};

function attach(handler) {
  sink.attachCount += 1;
  // Pretend to "register" the handler on something external.
  return () => {
    sink.detachCount += 1;
  };
}

// ---------------------------------------------------------------------------
// Leaf — owns the broken effect chain.
//
// Receives `opts` from parent. `opts` is a fresh object every parent render
// (see Parent below). That alone would not cause re-renders if `opts` were
// only stored, but here it leaks into:
//   - useCallback deps  → fresh handler every render
//   - useEffect deps    → effect re-runs every render
//   - effect body sets state → next render → loop
// ---------------------------------------------------------------------------
function Leaf({ opts }) {
  const [localTick, setLocalTick] = useState(0);

  // Unstable callback. Identity flips because `opts` identity flips upstream.
  const handler = useCallback(
    (event) => {
      // Simulated work that depends on opts.
      sink.fireCount += 1;
      return event && event.type ? event.type : opts.mode;
    },
    [opts],
  );

  // Effect that depends on the callback. Because `handler` flips every render,
  // React treats every render as a new effect → tear down old subscription,
  // attach new one, and (because the body mutates state) schedule another render.
  useEffect(() => {
    const detach = attach(handler);
    // The cascade trigger. In a real app this might be:
    //   - setState after a fetch resolves
    //   - dispatching to a store
    //   - calling a parent callback that flips parent state
    // Any of those creates the same loop when the effect re-fires per render.
    setLocalTick((n) => n + 1);
    return detach;
  }, [handler]);

  return (
    <div data-testid="stability-chain-leaf">
      <div>localTick: {localTick}</div>
      <div>attach/detach: {sink.attachCount}/{sink.detachCount}</div>
      <div>handler fires: {sink.fireCount}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent — produces the fresh-identity prop on every render.
//
// `opts` is a plain object literal in render. There is no `useMemo`. That is
// the upstream cause; the chain below it amplifies the damage.
// ---------------------------------------------------------------------------
export default function StabilityChain({ mode = 'a' }) {
  // No nudge anchor is needed. Chippy's stability-nudge drives a re-render via
  // the React DevTools renderer's scheduleUpdate(fiber), which forces a render
  // on ANY fiber — including a hookless one — without touching state or props.
  // The snippet resolves this component's fiber (via --testId stability-chain)
  // and schedules one render. That re-render rebuilds the fresh `opts` object
  // literal below, which is the upstream identity flip the chain depends on.
  //
  // There is intentionally NO interactive trigger (no button/input/handler).

  // Fresh object every render. THIS is the root identity flip.
  const opts = { mode };

  return (
    <div data-testid="stability-chain">
      <h3>StabilityChain — broken memo → callback → effect chain</h3>
      <p>No interactive trigger on purpose. Drive re-renders via stability-nudge on this container.</p>
      <Leaf opts={opts} />
    </div>
  );
}
