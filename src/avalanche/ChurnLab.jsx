// Tiny lab story to provoke deterministic React commits for avalanche verification.
// - 50ms interval bumping a state counter (root re-renders)
// - context provider whose value identity changes every tick (forces consumers to re-render)
// - useSyncExternalStore subscriber (touches the external-store-restart code path)

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StoreReader } from './DebugHookSUT.jsx';

const TickContext = React.createContext({ tick: 0 });

function makeStore(intervalMs = 50) {
  let value = 0;
  const listeners = new Set();
  setInterval(() => { value += 1; for (const l of listeners) l(); }, intervalMs);
  return {
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getSnapshot: () => value,
  };
}
function Consumer({ id }) {
  const ctx = React.useContext(TickContext);
  return <li>consumer #{id} tick {ctx.tick}</li>;
}

// =====================================================================
// Example A — Unstable provider reference
// =====================================================================
// SHAPE
//   Parent component constructs a fresh object on every render and feeds
//   it straight into <Context.Provider value={...}>. Field contents are
//   structurally equal across renders, but identity is not. React compares
//   context values with Object.is, so identity churn = full consumer
//   fan-out re-render even when nothing semantic changed.
//
// AVALANCHE SIGNAL TO LOOK FOR
//   - report.contextUpdates entry for `UnstableCtx` with
//       count == number of parent commits in the window.
//   - report.contextUpdatesByCommit[N] = [{
//       contextName: 'UnstableCtx',
//       prevValue / newValue: both objects whose JSON is identical,
//       ownerName: 'UnstableProviderRoot',
//     }]
//   - sources for commit N include every `UnstableConsumer` fiber under
//     the provider, scaling 1:1 with consumerCount.
//
// AGENT REASONING NOTE
//   This is a pure identity bug. The reasoning step is just "is the
//   structural diff empty?". If yes → unstable reference. The remedy is
//   a local refactor decision (memo, split, hoist, ref-equal value, etc.)
//   and belongs to the agent, not this fixture.
// ---------------------------------------------------------------------
const UnstableCtx = React.createContext({ counter: 0, label: 'init' });
UnstableCtx.displayName = 'UnstableCtx';

function UnstableConsumer({ id }) {
  const { counter, label } = React.useContext(UnstableCtx);
  return (
    <li>
      unstable consumer #{id} → {label}:{counter}
    </li>
  );
}

function UnstableProviderRoot({ counter, consumerCount }) {
  // Fresh object every render. Identity changes even when counter doesn't.
  const value = { counter, label: 'unstable' };
  return (
    <UnstableCtx.Provider value={value}>
      <ul data-testid="unstable-list">
        {Array.from({ length: consumerCount }, (_, i) => (
          <UnstableConsumer key={i} id={i} />
        ))}
      </ul>
    </UnstableCtx.Provider>
  );
}

export function UnstableProviderLab({ consumerCount = 6, tickMs = 200 }) {
  // External tick we control — drives parent re-renders.
  const [tick, setTick] = useState(0);
  // A second piece of state that does NOT change — so any consumer churn
  // observed via avalanche is purely a value-identity artefact, not a
  // real semantic update.
  const [counter] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return (
    <div data-testid="unstable-provider-lab">
      <h3>Example A — Unstable provider reference</h3>
      <p>parent tick={tick} · counter is constant: {counter}</p>
      <UnstableProviderRoot counter={counter} consumerCount={consumerCount} />
    </div>
  );
}

// =====================================================================
// Example B — Context value updated in useEffect → second avalanche
// =====================================================================
// SHAPE
//   Provider commits with value V1. A useEffect runs after commit, reads
//   from a derived source (a prop / ref / store / external signal) and
//   calls setValue(V2). React schedules a SECOND render for the same
//   logical interaction:
//     commit #N (V1) → effect runs → setState → commit #N+1 (V2)
//     → every consumer re-renders twice for one external trigger
//
//   Real-world variants of this shape:
//     - "Sync prop into local state" via useEffect.
//     - Provider derives from a subscription, but assembles the snapshot
//       in an effect instead of in useSyncExternalStore's selector.
//     - Provider keeps a "computed" mirror of two upstream values.
//     - Effect fans out an event that itself triggers another setState
//       in a sibling provider.
//
// AVALANCHE SIGNAL TO LOOK FOR
//   - Pairs of commits per external trigger:
//       commit K and commit K+1 both touch the same provider
//       contextUpdates['EffectCtx'].count ≈ 2× external triggers
//   - For commit K+1, sourcesByCommit[K+1] points at the provider itself
//     (the effect's setState is the trigger), NOT at the upstream tick.
//   - metricsByCommit[K+1] shows hook re-execution attributable to the
//     effect, not to a user-level interaction.
//
// AGENT REASONING NOTE
//   This pattern is ambiguous on purpose. There is no single "fix"; the
//   right move depends on what the value really is:
//     - If the value is a pure derivation of inputs → compute in render.
//     - If the value is conceptually a snapshot of an external source →
//       move to useSyncExternalStore / a subscription, exposing the
//       source directly so consumers don't have to wait for a commit
//       round-trip.
//     - If the value is "settings" that rarely change but read often →
//       expose as a getter / context of refs so reads don't trigger
//       re-renders at all.
//     - If two providers race on each other → redesign the data flow,
//       not the effect.
//   Detection ends here. The agent must reason about *what the value is
//   for*, then pick a strategy. Do not auto-suggest a memo patch.
// ---------------------------------------------------------------------
const EffectCtx = React.createContext({ derived: 0 });
EffectCtx.displayName = 'EffectCtx';

function EffectConsumer({ id }) {
  const { derived } = React.useContext(EffectCtx);
  return (
    <li>
      effect consumer #{id} → derived={derived}
    </li>
  );
}

function EffectDrivenProviderRoot({ tick, consumerCount }) {
  // Derived value lives in local state, written by an effect → second
  // commit per external tick.
  const [derived, setDerived] = useState(0);

  useEffect(() => {
    setDerived(tick * 2);
  }, [tick]);

  // Memoized so the second-commit signal is isolated from Example A's
  // identity-churn pattern. The avalanche here MUST be the effect.
  const value = useMemo(() => ({ derived }), [derived]);

  return (
    <EffectCtx.Provider value={value}>
      <ul data-testid="effect-list">
        {Array.from({ length: consumerCount }, (_, i) => (
          <EffectConsumer key={i} id={i} />
        ))}
      </ul>
    </EffectCtx.Provider>
  );
}

export function EffectAvalancheLab({ consumerCount = 6, tickMs = 250 }) {
  const [tick, setTick] = useState(0);

  // Track how many parent renders have happened so the user can visually
  // compare external ticks vs actual React commits (~2× ticks here).
  const commitsRef = useRef(0);
  commitsRef.current += 1;

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return (
    <div data-testid="effect-avalanche-lab">
      <h3>Example B — Effect-driven context update</h3>
      <p>
        external ticks={tick} · parent renders so far={commitsRef.current}
      </p>
      <EffectDrivenProviderRoot tick={tick} consumerCount={consumerCount} />
    </div>
  );
}

// =====================================================================
// Example C — Mixed-stability context (stable + unstable in one value)
// =====================================================================
// SHAPE
//   One provider exposes a value that mixes long-lived references
//   (callbacks, config) with frequently-changing data (a counter, a
//   selection, a hover position). Consumers that only read the stable
//   half are still re-rendered on every change of the unstable half,
//   because Object.is on the merged value flips.
//
// AVALANCHE SIGNAL TO LOOK FOR
//   - contextUpdates['MixedCtx'].count == number of unstable-half changes.
//   - In contextUpdatesByCommit, prevValue/newValue differ only in the
//     unstable field; the stable fields (e.g. callbacks) compare equal
//     across the diff.
//   - sourcesByCommit lists BOTH consumer kinds (StableReader and
//     VolatileReader) even though only the volatile half actually moved.
//
// AGENT REASONING NOTE
//   Detection here is "the diff between prev/new touches only field X,
//   but consumers reading Y also re-rendered". That's the entire
//   diagnosis. The remedy is a design choice: split the context, push
//   stable refs through a separate provider, expose getters, or move the
//   volatile half out of context entirely. Agent decides.
// ---------------------------------------------------------------------
const MixedCtx = React.createContext({ onAction: () => {}, hover: null });
MixedCtx.displayName = 'MixedCtx';

function StableReader({ id }) {
  // Reads only the stable callback. Should not re-render on hover changes,
  // but with a merged value it does.
  const { onAction } = React.useContext(MixedCtx);
  return (
    <li>
      stable reader #{id} (onAction id={onAction.__id ?? '?'})
    </li>
  );
}

function VolatileReader({ id }) {
  // Legitimately depends on the volatile half.
  const { hover } = React.useContext(MixedCtx);
  return (
    <li>
      volatile reader #{id} → hover={String(hover)}
    </li>
  );
}

function MixedProviderRoot({ hover, consumerCount }) {
  // Stable callback created once, but bundled into a fresh object each
  // render alongside the volatile `hover`.
  const onActionRef = useRef(null);
  if (onActionRef.current === null) {
    const fn = () => {};
    fn.__id = Math.floor(Math.random() * 1000);
    onActionRef.current = fn;
  }
  const value = { onAction: onActionRef.current, hover };

  return (
    <MixedCtx.Provider value={value}>
      <ul data-testid="mixed-stable-list">
        {Array.from({ length: consumerCount }, (_, i) => (
          <StableReader key={`s${i}`} id={i} />
        ))}
      </ul>
      <ul data-testid="mixed-volatile-list">
        {Array.from({ length: consumerCount }, (_, i) => (
          <VolatileReader key={`v${i}`} id={i} />
        ))}
      </ul>
    </MixedCtx.Provider>
  );
}

export function MixedStabilityLab({ consumerCount = 6, tickMs = 200 }) {
  const [hover, setHover] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setHover((n) => (n + 1) % 100), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return (
    <div data-testid="mixed-stability-lab">
      <h3>Example C — Mixed-stability context</h3>
      <p>hover={hover} · onAction is stable across all renders</p>
      <MixedProviderRoot hover={hover} consumerCount={consumerCount} />
    </div>
  );
}

export default function ChurnLab({ consumerCount = 8, tickMs = 50, storeIntervalMs = 75 }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);

  // Fresh object on every render → context value identity changes → every consumer re-renders.
  const ctxValue = useMemo(() => ({ tick }), [tick]);

  return (
    <div data-testid="churn-lab">
      <h3>ChurnLab — avalanche verification harness</h3>
      <p>Provokes commits via interval, context churn, and useSyncExternalStore.</p>
      <StoreReader storeIntervalMs={storeIntervalMs} />
      <TickContext.Provider value={ctxValue}>
        <ul>
          {Array.from({ length: consumerCount }, (_, i) => (
            <Consumer key={i} id={i} />
          ))}
        </ul>
      </TickContext.Provider>
    </div>
  );
}
