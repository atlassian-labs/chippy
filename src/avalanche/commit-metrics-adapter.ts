/**
 * Commit metrics adapter: an optional per-commit counter source that sits next
 * to the DevTools fiber walk.
 *
 * The detector always captures commits through the DevTools hook. Some hosts
 * also run an instrumented react-dom that exposes render counters and calls a
 * commit callback of its own. An adapter wraps one such host surface: it seeds
 * and protects the surface, snapshots its counters, turns two snapshots into a
 * per-commit delta plus a restart count, and wires the host's commit callback
 * to the detector. Without an adapter the detector runs in `devtools` mode and
 * reports restarts as unavailable.
 *
 * One adapter is active at a time. Product adapters live in `src/plugins/`.
 */

import type { Fiber } from './internals';

export type CommitMetricsRoot = { current: Fiber; memoizedUpdaters?: Set<Fiber> };

/** Raw counters read from the host surface at one point in time. */
export type CommitMetricsSnapshot = Record<string, unknown>;

/** Counter deltas for one commit, keyed by counter name. */
export type CommitMetricsDelta = { [counter: string]: number | undefined };

export type CommitMetricsMeasurement = {
  delta: CommitMetricsDelta;
  /** Render passes React performed but did not commit. Never negative. */
  restarts: number;
};

export interface CommitMetricsAdapter {
  /** Stable id; the detector reports `integrationMode: 'adapter:<id>'`. */
  readonly id: string;
  /**
   * Stack frame names the host surface adds to every render. Hook ancestry
   * hides them like other renderer internals.
   */
  readonly frameFilters?: readonly string[];
  /**
   * Setup that must run before React evaluates, such as installing an accessor
   * that survives host cleanup. Called by the extension's early bootstrap
   * through `__AVALANCHE__.runPrePageHooks(config)`.
   */
  prePage?(config: unknown): void;
  /** Seed the host surface before a detector installs, unless the host owns it. */
  prepare?(): void;
  /** Whether the host surface is present right now. */
  isAvailable(): boolean;
  snapshot(): CommitMetricsSnapshot | null;
  measure(
    before: CommitMetricsSnapshot,
    after: CommitMetricsSnapshot,
    committedComponents: number,
    commitId: number,
  ): CommitMetricsMeasurement;
  /**
   * Route the host's commit callback to `onCommit`. Returns false when the
   * surface is absent. A callback is proof that the host surface is live.
   */
  attach(onCommit: (root: CommitMetricsRoot) => void): boolean;
  /** True while the callback from attach() is still wired into the live surface. */
  isAttached(): boolean;
  /** Re-seed and re-wire after the host wiped or replaced its surface. */
  reattach(): void;
  /** Remove the callback from attach(), only if it is still ours. */
  detach(): void;
}

let active: CommitMetricsAdapter | null = null;

const REQUIRED_METHODS = ['isAvailable', 'snapshot', 'measure', 'attach', 'isAttached', 'reattach', 'detach'] as const;

/**
 * Make `adapter` the active commit metrics adapter for detectors installed
 * afterwards. Replaces any earlier adapter. Returns an unregister function.
 */
export function registerCommitMetricsAdapter(adapter: CommitMetricsAdapter): () => void {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id) {
    throw new TypeError('registerCommitMetricsAdapter expects an adapter with a non-empty id');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`commit metrics adapter ${adapter.id} is missing ${method}()`);
    }
  }
  active = adapter;
  return () => {
    if (active === adapter) active = null;
  };
}

export function getCommitMetricsAdapter(): CommitMetricsAdapter | null {
  return active;
}

/**
 * Run the active adapter's pre-page hook. Returns the adapter id when a hook
 * ran, or null. A failing hook is swallowed: the detector falls back to
 * DevTools capture.
 */
export function runPrePageHooks(config?: unknown): string | null {
  const adapter = active;
  if (!adapter || typeof adapter.prePage !== 'function') return null;
  try {
    adapter.prePage(config);
    return adapter.id;
  } catch {
    return null;
  }
}

export type IntegrationMode = `adapter:${string}` | 'devtools' | 'none';

export function adapterIdFromMode(mode: IntegrationMode | string | null | undefined): string | null {
  return typeof mode === 'string' && mode.startsWith('adapter:') ? mode.slice('adapter:'.length) : null;
}
