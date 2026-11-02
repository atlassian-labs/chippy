/**
 * Seed, protect, and guard a host metrics slot such as `__ATL_REACT_METRICS`.
 *
 * The host page owns the slot. Its instrumented react-dom reads the slot before
 * it calls `onCommitFiberRoot`, and its runtime may zero-fill or delete the slot
 * during hydration cleanup. These helpers never lock the slot: every descriptor
 * they write stays `configurable: true`, and a slot the host already locked is
 * left alone.
 */

export const DEFAULT_METRICS_SLOT = '__ATL_REACT_METRICS';

/** Counters a zeroed slot starts with. */
export const METRICS_COUNTER_KEYS = [
  'mountWorkCount', 'updateWorkCount', 'commitWorkCount', 'interruptedWorkCount',
  'priorityInterruptedWorkCount', 'externalStoreRestartCount', 'renderRootSyncCount',
  'renderRootConcurrentCount', 'componentWorkCount', 'componentMountWorkCount',
  'componentUpdateWorkCount', 'componentRenderWithHooksCount', 'finishClassComponentCount',
  'domWorkCount', 'totalTickCount', 'totalCommitCount', 'contextUpdateCount',
  'legacyContextUpdateCount',
] as const;

/** Counters the accessor checks before accepting a write; adds the detector's totals. */
const ACCESSOR_KEYS = [...METRICS_COUNTER_KEYS, 'totalRestarts', 'totalPerformedWork'] as const;

type SlotTarget = Record<string, unknown>;
export type MetricsSlotValue = Record<string, unknown>;

export function createZeroMetrics(): MetricsSlotValue {
  const metrics: MetricsSlotValue = {};
  for (const key of METRICS_COUNTER_KEYS) metrics[key] = 0;
  metrics.setStateCount = 0;
  return metrics;
}

function isAllZero(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const record = value as Record<string, unknown>;
  for (const key of ACCESSOR_KEYS) if (((record[key] as number) || 0) !== 0) return false;
  return true;
}

/** True when the host owns the slot: non-configurable, or an accessor. */
export function isSlotHostLocked(target: SlotTarget, slotName = DEFAULT_METRICS_SLOT): boolean {
  const existing = Object.getOwnPropertyDescriptor(target, slotName);
  return !!existing && (existing.configurable === false || typeof existing.get === 'function');
}

/**
 * Write `metrics` as a plain, deletable data property. Honors a host lock
 * (configurable: false). Falls back to plain assignment.
 */
export function protectMetricsSlot(target: SlotTarget, metrics: MetricsSlotValue, slotName = DEFAULT_METRICS_SLOT): void {
  try {
    const existing = Object.getOwnPropertyDescriptor(target, slotName);
    if (existing && existing.configurable === false) return;
    Object.defineProperty(target, slotName, { configurable: true, enumerable: true, writable: true, value: metrics });
  } catch {
    try { target[slotName] = metrics; } catch { /* host wins */ }
  }
}

/** Seed a fresh zeroed slot. Returns the new metrics object. */
export function seedMetricsSlot(target: SlotTarget, slotName = DEFAULT_METRICS_SLOT): MetricsSlotValue {
  const metrics = createZeroMetrics();
  try { target[slotName] = metrics; } catch { /* protect below retries */ }
  protectMetricsSlot(target, metrics, slotName);
  return metrics;
}

/**
 * Install a configurable accessor on the slot before React evaluates.
 *
 * - `configurable: true`, so a host `delete` succeeds without a TypeError.
 *   After a delete the slot is gone until the next detector install re-seeds it.
 * - `set()` ignores null, undefined, and all-zero writes, so host hydration
 *   cleanup that zero-fills the slot cannot orphan the live metrics object.
 * - A slot the host already locked is left alone.
 *
 * Returns true when the accessor was installed.
 */
export function installMetricsAccessor(target: SlotTarget, slotName = DEFAULT_METRICS_SLOT): boolean {
  try {
    const existing = Object.getOwnPropertyDescriptor(target, slotName);
    if (existing && existing.configurable === false) return false;
    let live = existing && typeof existing.get === 'function'
      ? target[slotName]
      : existing?.value;
    if (!live || typeof live !== 'object') {
      live = { onCommitFiberRoot: null };
      for (const key of ACCESSOR_KEYS) (live as MetricsSlotValue)[key] = 0;
    }
    Object.defineProperty(target, slotName, {
      configurable: true,
      enumerable: true,
      get() { return live; },
      set(next: unknown) {
        if (next === undefined || next === null || isAllZero(next)) return;
        live = next;
      },
    });
    return true;
  } catch {
    // Non-fatal: the detector falls back to DevTools capture.
    return false;
  }
}
