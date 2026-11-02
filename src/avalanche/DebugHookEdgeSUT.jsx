/**
 * Edge-case SUTs for debug-render RTL tests.
 * Each export exercises a specific hook contract or violation scenario.
 */
import React from 'react';

// ─── SUT 1: writable ref contract ────────────────────────────────────────────
// Stores mutable data in a ref. Any replay that returns a non-writable or
// non-object value from useRef will throw at the assignment site.
export function RefWriteSUT({ value }) {
  const propsRef = React.useRef(value);
  propsRef.current = value; // ← exact pattern from useSweetState
  return <output data-testid="ref-write-sut">{propsRef.current}</output>;
}

// ─── SUT 2: callable callback contract ───────────────────────────────────────
// The callback returned from useCallback must be callable. A replay that
// returns a non-function (undefined, object, etc.) will throw when the
// rendered element tries to attach it as an event handler.
export function CallbackSUT({ onTick }) {
  const handler = React.useCallback(() => {
    if (typeof onTick === 'function') onTick();
  }, [onTick]);
  return (
    <button type="button" data-testid="callback-sut" onClick={handler}>
      tick
    </button>
  );
}

// ─── SUT 3: useId string contract ────────────────────────────────────────────
// useId must return a string. Downstream DOM attribute use will silently break
// if it returns undefined; label/aria association will also break.
export function IdSUT() {
  const id = React.useId();
  return (
    <>
      <label htmlFor={id} data-testid="id-sut-label">Name</label>
      <input id={id} data-testid="id-sut-input" />
    </>
  );
}

// ─── SUT 4: external store snapshot contract ─────────────────────────────────
// useSyncExternalStore must return the committed snapshot value.
// A replay that returns a queue object or undefined will break downstream
// rendering that reads the numeric count.
function makeCounterStore() {
  let n = 0;
  const subs = new Set();
  return {
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    getSnapshot: () => n,
    increment: () => { n += 1; subs.forEach((fn) => fn()); },
  };
}

export const counterStore = makeCounterStore();

export function SyncStoreSUT() {
  const count = React.useSyncExternalStore(
    counterStore.subscribe,
    counterStore.getSnapshot,
  );
  return <output data-testid="sync-store-sut">{count}</output>;
}

// ─── SUT 5: conditional hook violation detector ───────────────────────────────
// Calling a different number of hooks per render violates rules of hooks.
// Debug-render replay should not silently succeed when the hook count shifts.
// This SUT deliberately violates the rule when `condition` flips.
export function ConditionalHookSUT({ condition }) {
  // Always call one hook unconditionally so we have a stable baseline.
  const [base] = React.useState(0);

  // Conditionally call a second hook — this is the violation.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (condition) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useState('extra');
  }

  return <output data-testid="conditional-hook-sut">{base}</output>;
}
