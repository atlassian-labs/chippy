/**
 * Type and lifecycle adapter for Atlassian's optional react-dom metrics patch.
 * Avalanche can run without this integration, so the metrics slot is treated
 * as a host-owned capability rather than an unconditional Chippy dependency.
 */

import type { ReactNode } from 'react';

/**
 * Atlassian React types
 *
 * Keep comments short; details live in PATCH_REGISTRY.md.
 */

/**
 * React Performance Metrics
 *
 * Tracks React's internal work to measure rendering costs and efficiency.
 * Set this global to enable metrics tracking (zero cost when undefined).
 */
export interface AtlReactMetrics {
  /**
   * Work counters (cumulative across all roots)
   */

  /** Units of work for new fibers (current === null) */
  mountWorkCount: number;

  /** Units of work for existing fibers (current !== null) */
  updateWorkCount: number;

  /** Units of work that reached the DOM */
  commitWorkCount: number;

  /**
   * Wasted/interrupted work counters
   */

  /** Units of work abandoned/unwound (Suspense/error throws) */
  interruptedWorkCount: number;

  /** Work abandoned due to priority preemption */
  priorityInterruptedWorkCount: number;

  /** useSES-triggered restarts (concurrent mode only) */
  externalStoreRestartCount: number;

  /** Number of times React entered renderRootSync */
  renderRootSyncCount: number;

  /** Number of times React entered renderRootConcurrent */
  renderRootConcurrentCount: number;

  /**
   * Dev-mode only: callback invoked when a useSES consistency restart occurs.
   * Receives the finished fiber tree — walk it to extract store/component details.
   * Set this to a function to enable restart attribution.
   */
  onExternalStoreRestart?: (finishedWork: unknown) => void;

  /**
   * Complexity counters (render-phase only)
   */

  /** Work on React components (user-level) */
  componentWorkCount: number;
  componentMountWorkCount: number;
  componentUpdateWorkCount: number;

  /** Number of times renderWithHooks was called */
  componentRenderWithHooksCount: number;

  /** Number of times finishClassComponent was called */
  finishClassComponentCount: number;

  /** Work on DOM elements/text */
  domWorkCount: number;

  /**
   * Scheduler and commit counters
   */

  /** Total scheduler ticks across all renders */
  totalTickCount: number;

  /** Total number of commits across all roots */
  totalCommitCount: number;

  /**
   * Context counters
   */

  /** Context value changes that triggered propagation */
  contextUpdateCount: number;

  /** Legacy context updates in class components */
  legacyContextUpdateCount: number;

  /**
   * Hook-metric counters (react-dom patch; optional)
   */

  // TODO: The patch increments this on dispatchSetState entry, before
  // React can take an eager no-op bailout. Rename or split the metric before
  // treating it as a count of updates that were actually scheduled as work.
  /** useState/useReducer dispatches scheduled (patch: dispatchSetState/reducer). */
  setStateCount?: number;

  /**
   * Dev-mode only: called when a memo/callback/effect recomputes because its deps
   * changed. kind: 1=memo, 2=callback, 3=effect. Consumed by hookTracker, not stored.
   */
  onHookUpdate?(fiber: unknown, kind: number, slot: number): void;

  /**
   * Avalanche detector metrics (populated externally)
   */

  /** Total restarts across all commits (Suspense throw/rethrow cycles) */
  totalRestarts?: number;

  /** Components with PerformedWork flag seen during commits */
  totalPerformedWork?: number;

  /**
   * Callbacks
   */

  /**
   * Called when React DevTools would call onCommitFiberRoot
   * Available in both development and profiling builds
   * @param rendererID - The renderer ID
   * @param root - The fiber root
   * @param priorityLevel - The priority level (optional)
   * @param didError - Whether an error was captured during commit
   */
  onCommitFiberRoot?(
    rendererID: unknown,
    root: unknown,
    priorityLevel: unknown,
    didError: boolean
  ): void;

  /**
   * Called when context value changes in Context.Provider
   * Available in both development and profiling builds.
   */
  onContextUpdate?(
    workInProgress: unknown,
    context: unknown,
    newValue: unknown,
    oldValue: unknown
  ): void;

  /**
   * Called when legacy context is updated in class components
   * Available in both development and profiling builds
   */
  onLegacyContextUpdate?(workInProgress: unknown, Component: unknown): void;
}

/**
 * Hydration Hook Report Data
 *
 * Data passed to the hydration hook report callback.
 */
export interface HydrationReportData {
  /** The type of hydration event/mismatch */
  type: string;

  /** Additional data about the mismatch (structure varies by type) */
  data?: unknown;
}

/**
 * Hydration Hook
 *
 * Custom hook for reporting hydration mismatches and errors.
 * Set this global to receive hydration event callbacks.
 */
export interface AtlHydrationHook {
  /**
   * Called by React when hydration mismatches occur
   *
   * @param type - The type of hydration event (e.g., 'checkForUnmatchedText')
   * @param data - Additional data about the mismatch
   */
  report: (type: string, data: unknown) => void;
}

type ReactTaskRelevantProperties = {
  node: ReactNode;
  blockedBoundary: { id: string } | null;
};
/**
 * @param {Promise} promise - The promise that was thrown to trigger suspense
 * @param {string} stack - The component stack trace (dev mode) or 'Unknown' (prod mode)
 * @param {Object} task - The suspension task
 * @returns {Promise} A promise to use instead of the original (can be wrapped, timed out, etc)
 */
export type AtlSuspenseInterceptorHook = (
  promise: Promise<unknown>,
  componentStack: string,
  task: ReactTaskRelevantProperties
) => Promise<unknown>;

/**
 * Global Atlassian React Extensions
 *
 * These properties are added to the global object by our React DOM patches.
 */
interface AtlassianReactGlobals {
  /**
   * React Performance Metrics
   *
   * When defined, React will track performance metrics.
   * When undefined, tracking is disabled (zero cost).
   *
   * @example
   * ```typescript
   * // Enable metrics
   * globalThis.__ATL_REACT_METRICS = {
   *   mountWorkCount: 0,
   *   updateWorkCount: 0,
   *   commitWorkCount: 0,
   *   interruptedWorkCount: 0,
   *   componentWorkCount: 0,
   *   domWorkCount: 0,
   *   totalTickCount: 0,
   *   contextUpdateCount: 0,
   * };
   * ```
   */
  __ATL_REACT_METRICS?: AtlReactMetrics;

  /**
   * Hydration Hook
   *
   * When defined, React will call the report callback on hydration mismatches.
   *
   * @example
   * ```typescript
   * globalThis.__ATL_HYDRATION_HOOK = {
   *   report: (type, data) => {
   *     console.log('Hydration mismatch:', type, data);
   *   }
   * };
   * ```
   */
  __ATL_HYDRATION_HOOK?: AtlHydrationHook;

  /**
   * Hydration Warn All (Development Only)
   *
   * When true, React will report ALL hydration mismatches instead of just the first.
   * Only works in development builds.
   *
   * @example
   * ```typescript
   * globalThis.__ATL_HYDRATION_WARN_ALL = true;
   * ```
   */
  __ATL_HYDRATION_WARN_ALL?: boolean;

  /**
   * Capture Hydration Error Details
   *
   * When true, hydration errors include fiber information for better debugging.
   * Only works in production/profiler builds.
   *
   * @example
   * ```typescript
   * globalThis.__ATL_CAPTURE_HYDRATION_ERROR_DETAILS = true;
   * ```
   */
  __ATL_CAPTURE_HYDRATION_ERROR_DETAILS?: boolean;

  /**
   * Skip Has Context Changed
   *
   * When true, React skips the hasContextChanged check in updateDehydratedSuspenseComponent.
   * This keeps server content when context changes during suspended hydration.
   * Only works in production/profiler builds.
   *
   * @example
   * ```typescript
   * globalThis.__ATL_SKIP_HAS_CONTEXT_CHANGED = true;
   * ```
   */
  __ATL_SKIP_HAS_CONTEXT_CHANGED?: boolean;
  /**
   * When `true`, prevents React from interrupting in-progress hydration work
   * when a normal `setState` update arrives. Hydration lanes
   * (InputContinuousHydration, DefaultHydration, TransitionHydration,
   * SelectiveHydration, IdleHydration) become non-interruptible in `getNextLanes`.
   *
   * `flushSync` (Sync lane) still interrupts — it's the escape hatch.
   * Progressive hydration ordering (parent→child) is unaffected.
   *
   * Tradeoff: user input during active hydration may be slightly delayed,
   * but hydration completes faster overall (no wasted restart cycles).
   *
   * ```ts
   * globalThis.__ATL_SYNC_HYDRATION_PRIORITY = true;
   * ```
   */
  __ATL_SYNC_HYDRATION_PRIORITY?: boolean;

  /**
   * React Fallback Throttle
   *
   * Custom throttle time in milliseconds for Suspense fallbacks.
   * Default is 500ms. Only works in production/profiler builds.
   *
   * @example
   * ```typescript
   * // Show fallback after 100ms instead of default 500ms
   * globalThis.REACT_FALLBACK_THROTTLE_MS = 100;
   * ```
   */
  REACT_FALLBACK_THROTTLE_MS?: number;

  /**
   * Intercepts promises thrown to trigger suspense in SSR (e.g. `renderToPipeableStream`).
   */
  __ATL_INTERCEPT_SUSPENSE_HOOK?: AtlSuspenseInterceptorHook | undefined;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const atlReactGlobal = globalThis as unknown as AtlassianReactGlobals;

export const getATLReact = (): AtlassianReactGlobals => atlReactGlobal;
/**
 * Utility type guards
 */

/**
 * Type-safe metrics access
 * Returns metrics if enabled, undefined otherwise
 */
export function getATLReactMetrics(): AtlReactMetrics | undefined {
  return atlReactGlobal.__ATL_REACT_METRICS ? { ...atlReactGlobal.__ATL_REACT_METRICS } : undefined;
}

/**
 * Initialize metrics tracking
 */
export function initATLReactMetrics(): AtlReactMetrics {
  const metrics: AtlReactMetrics = {
    mountWorkCount: 0,
    updateWorkCount: 0,
    commitWorkCount: 0,
    interruptedWorkCount: 0,
    priorityInterruptedWorkCount: 0,
    externalStoreRestartCount: 0,
    renderRootSyncCount: 0,
    renderRootConcurrentCount: 0,
    componentWorkCount: 0,
    componentMountWorkCount: 0,
    componentUpdateWorkCount: 0,
    componentRenderWithHooksCount: 0,
    finishClassComponentCount: 0,
    domWorkCount: 0,
    totalTickCount: 0,
    totalCommitCount: 0,
    contextUpdateCount: 0,
    legacyContextUpdateCount: 0,
    setStateCount: 0,
  };
  atlReactGlobal.__ATL_REACT_METRICS = metrics;
  return metrics;
}

/**
 * Disable metrics tracking
 */
export function disableATLReactMetrics(): void {
  delete atlReactGlobal.__ATL_REACT_METRICS;
}

const ATL_KEYS: ReadonlyArray<keyof AtlReactMetrics> = [
  'mountWorkCount', 'updateWorkCount', 'commitWorkCount', 'interruptedWorkCount',
  'priorityInterruptedWorkCount', 'externalStoreRestartCount', 'renderRootSyncCount',
  'renderRootConcurrentCount', 'componentWorkCount', 'componentMountWorkCount',
  'componentUpdateWorkCount', 'componentRenderWithHooksCount', 'finishClassComponentCount',
  'domWorkCount', 'totalTickCount', 'totalCommitCount', 'contextUpdateCount',
  'legacyContextUpdateCount',
] as const;

function isAllZeroOrEmpty(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return true;
  for (const k of ATL_KEYS) if (((obj as any)[k] || 0) !== 0) return false;
  return true;
}

/**
 * Install a soft re-seed for `globalThis.__ATL_REACT_METRICS`.
 *
 * Avalanche cannot own this slot. The host (e.g. Jira's runtime) is allowed to
 * overwrite or `delete` the global at any time — that is part of the host's
 * lifecycle (blank-init, hydration cleanup). Chippy must not interfere.
 *
 * Behaviour:
 * - Writes a plain data property containing `metrics` so `typeof === 'object'`
 *   reads succeed for the patched react-dom.
 * - The property stays `configurable: true` and `writable: true` so the host
 *   can `delete` or replace it without throwing in strict mode.
 * - Does NOT install an accessor trap. We trust the host. If the host wipes
 *   the global, callers should re-init the metrics object from a known seed
 *   point (e.g. on the next `install()` call).
 */
export function protectATLReactMetrics(metrics: AtlReactMetrics): void {
  const target = atlReactGlobal as any;
  try {
    const existing = Object.getOwnPropertyDescriptor(target, '__ATL_REACT_METRICS');
    if (existing && existing.configurable === false) {
      // Host froze the slot. Honor it: do not try to override.
      return;
    }
    Object.defineProperty(target, '__ATL_REACT_METRICS', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: metrics,
    });
  } catch (_e) {
    // Fallback: best-effort plain assignment.
    try { target.__ATL_REACT_METRICS = metrics; } catch (_e2) { /* host wins */ }
  }
}
