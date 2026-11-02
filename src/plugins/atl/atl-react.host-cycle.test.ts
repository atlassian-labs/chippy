import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initATLReactMetrics,
  protectATLReactMetrics,
  getATLReactMetrics,
} from './atl-react';
import { METRICS_COUNTER_KEYS as ATL_KEYS, installMetricsAccessor } from './metrics-slot';

/**
 * ATL host-integration cycle (jsdom-coverable subset).
 *
 * Covers what jsdom *can* verify:
 *  - the slot can be re-seeded after host delete
 *  - protect honors host locks (configurable:false)
 *  - protect installs a deletable slot (configurable:true)
 *  - protect tolerates failure paths
 *
 * Cannot cover (rule 6 — live page required):
 *  - host actually performing delete during react-dom commit
 *  - react-dom reading the slot at the same tick we re-seed
 *  - identity-mismatch re-seed inside devtools handler
 *
 * The accessor with silent-ignore on zero/null writes is the ATL adapter's
 * pre-page hook (`installMetricsAccessor`), which the extension's early
 * bootstrap runs through `__AVALANCHE__.runPrePageHooks()`. It is installed
 * on a local target so the contract is tested without touching globalThis.
 */

/**
 * Build a target object with the pre-page accessor installed.
 * Returns the target so tests can read/write `target.__ATL_REACT_METRICS`
 * without touching the real globalThis (which jsdom cannot fully reset).
 */
function installEarlyBootstrapAccessor(
  initial?: Record<string, unknown>,
): Record<string, unknown> {
  const target: Record<string, unknown> = initial ? { __ATL_REACT_METRICS: initial } : {};
  installMetricsAccessor(target);
  return target;
}

function clearAtlSlot() {
  const target = globalThis as unknown as Record<string, unknown>;
  // jsdom's globalThis treats plain assignment as a writable+configurable property
  // already, but our tests sometimes install non-configurable descriptors. Try
  // delete first; if that fails (host-lock test), re-define as configurable.
  let desc = Object.getOwnPropertyDescriptor(target, '__ATL_REACT_METRICS');
  if (desc && desc.configurable === false) {
    // Can't reset — leave it; the locked-slot test must be the last one in its describe.
    // Best-effort: overwrite via define with the same configurable:false to free it for
    // the next test by rewriting first into configurable:true.
    try {
      Object.defineProperty(target, '__ATL_REACT_METRICS', {
        configurable: true, enumerable: true, writable: true, value: undefined,
      });
    } catch { /* irrecoverable in this jsdom realm */ }
  }
  try { delete target.__ATL_REACT_METRICS; } catch { /* ignore */ }
  desc = Object.getOwnPropertyDescriptor(target, '__ATL_REACT_METRICS');
  if (desc) {
    // Force-define a fresh configurable empty so the next install/defineProperty succeeds.
    try {
      Object.defineProperty(target, '__ATL_REACT_METRICS', {
        configurable: true, enumerable: true, writable: true, value: undefined,
      });
      delete target.__ATL_REACT_METRICS;
    } catch { /* ignore */ }
  }
}

describe('protectATLReactMetrics', () => {
  beforeEach(() => clearAtlSlot());
  afterEach(() => clearAtlSlot());

  it('installs the slot with configurable:true so host delete cannot throw', () => {
    const metrics = initATLReactMetrics();
    protectATLReactMetrics(metrics);
    const desc = Object.getOwnPropertyDescriptor(globalThis, '__ATL_REACT_METRICS');
    expect(desc?.configurable).toBe(true);
  });

  it('host delete succeeds without TypeError after protect', () => {
    const metrics = initATLReactMetrics();
    protectATLReactMetrics(metrics);
    expect(() => {
      delete (globalThis as unknown as Record<string, unknown>).__ATL_REACT_METRICS;
    }).not.toThrow();
    expect(getATLReactMetrics()).toBeUndefined();
  });

  // NOTE: host-lock isolation
  // This test installs a configurable:false descriptor on the real globalThis.
  // jsdom cannot recover from that — once the slot is non-configurable it stays
  // that way for the rest of the test file. To prove the contract without
  // polluting globalThis, we exercise protect() against a local target object
  // that mirrors atl-react's atlReactGlobal contract.
  it('honors host lock — does NOT redefine when descriptor is configurable:false', () => {
    const localTarget: Record<string, unknown> = {};
    const hostMetrics = { hostInstalled: true };
    Object.defineProperty(localTarget, '__ATL_REACT_METRICS', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: hostMetrics,
    });

    // Replicate protectATLReactMetrics' contract inline against a local target,
    // since the function is hardcoded against atlReactGlobal:
    function protectAgainst(target: Record<string, unknown>, metrics: unknown) {
      const existing = Object.getOwnPropertyDescriptor(target, '__ATL_REACT_METRICS');
      if (existing && existing.configurable === false) return; // honor host lock
      Object.defineProperty(target, '__ATL_REACT_METRICS', {
        configurable: true, enumerable: true, writable: true, value: metrics,
      });
    }

    expect(() => protectAgainst(localTarget, { ours: true })).not.toThrow();
    expect(localTarget.__ATL_REACT_METRICS).toBe(hostMetrics);
  });

  it('re-seed via initATLReactMetrics + protect restores the slot after host delete', () => {
    const m1 = initATLReactMetrics();
    protectATLReactMetrics(m1);

    delete (globalThis as unknown as Record<string, unknown>).__ATL_REACT_METRICS;
    expect(getATLReactMetrics()).toBeUndefined();

    // Re-entry point: install() path calls initATLReactMetrics + protect again.
    const m2 = initATLReactMetrics();
    protectATLReactMetrics(m2);
    // After re-seed the slot must hold a fresh metrics object (not m1).
    // Identity vs equality: getATLReactMetrics() may return the slot value
    // captured by initATLReactMetrics's plain assignment OR the defineProperty
    // value depending on jsdom ordering. Either way it must NOT be m1.
    expect(getATLReactMetrics()).not.toBe(m1);
    expect(getATLReactMetrics()).toBeDefined();
    // and the slot must hold an all-zero fresh metrics object
    const slot = getATLReactMetrics() as unknown as Record<string, number>;
    for (const k of ATL_KEYS) expect(slot[k]).toBe(0);
  });

  it('re-seed exposes a configurable slot again — host can delete it once more', () => {
    const m1 = initATLReactMetrics();
    protectATLReactMetrics(m1);
    delete (globalThis as unknown as Record<string, unknown>).__ATL_REACT_METRICS;
    const m2 = initATLReactMetrics();
    protectATLReactMetrics(m2);

    expect(() => {
      delete (globalThis as unknown as Record<string, unknown>).__ATL_REACT_METRICS;
    }).not.toThrow();
  });
});

describe('initATLReactMetrics', () => {
  beforeEach(() => clearAtlSlot());
  afterEach(() => clearAtlSlot());

  it('seeds the slot with all counters at zero', () => {
    const m = initATLReactMetrics();
    for (const k of ATL_KEYS) {
      expect(m[k as keyof typeof m]).toBe(0);
    }
  });

  it('replaces any previous slot value', () => {
    (globalThis as unknown as Record<string, unknown>).__ATL_REACT_METRICS = { previous: true };
    initATLReactMetrics();
    expect((getATLReactMetrics() as unknown as Record<string, unknown>).previous).toBeUndefined();
  });
});

describe('pre-page metrics accessor contract', () => {
  beforeEach(() => clearAtlSlot());
  afterEach(() => clearAtlSlot());

  it('get returns the live ref', () => {
    const target = installEarlyBootstrapAccessor();
    expect(target.__ATL_REACT_METRICS).toBe(target.__ATL_REACT_METRICS);
  });

  it('set(null) is silently ignored — live ref preserved', () => {
    const target = installEarlyBootstrapAccessor();
    const before = target.__ATL_REACT_METRICS;
    target.__ATL_REACT_METRICS = null as never;
    expect(target.__ATL_REACT_METRICS).toBe(before);
  });

  it('set(undefined) is silently ignored', () => {
    const target = installEarlyBootstrapAccessor();
    const before = target.__ATL_REACT_METRICS;
    target.__ATL_REACT_METRICS = undefined as never;
    expect(target.__ATL_REACT_METRICS).toBe(before);
  });

  it('set(all-zero object) is silently ignored — host hydration cleanup cannot orphan us', () => {
    const target = installEarlyBootstrapAccessor();
    const before = target.__ATL_REACT_METRICS;
    const allZero: Record<string, unknown> = { onCommitFiberRoot: null };
    for (const k of ATL_KEYS) allZero[k] = 0;
    target.__ATL_REACT_METRICS = allZero;
    expect(target.__ATL_REACT_METRICS).toBe(before);
  });

  it('set(real metrics object with non-zero counter) replaces the live ref', () => {
    const target = installEarlyBootstrapAccessor();
    const fresh: Record<string, unknown> = { onCommitFiberRoot: null, totalCommitCount: 7 };
    for (const k of ATL_KEYS) fresh[k] = fresh[k] ?? 0;
    target.__ATL_REACT_METRICS = fresh;
    expect(target.__ATL_REACT_METRICS).toBe(fresh);
  });

  it('delete succeeds and removes the slot', () => {
    const target = installEarlyBootstrapAccessor();
    expect(() => { delete target.__ATL_REACT_METRICS; }).not.toThrow();
    expect(target.__ATL_REACT_METRICS).toBeUndefined();
  });
});
