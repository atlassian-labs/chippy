/**
 * fiber-schedule-update — force one re-render on a single fiber.
 *
 * This is the CAPABILITY behind the `stability-nudge` procedure. It is core,
 * React-internals-coupled behavior, so it lives in the bundle (not in a dynamic
 * eval snippet): the snippet composes the procedure (probe/testId resolution,
 * owner walk, labels) on top of this one capability.
 *
 * Mechanism: the React DevTools renderer's `scheduleUpdate(fiber)` — the exact
 * call React DevTools itself uses to force a component to re-render. In a dev
 * react-dom build it is:
 *
 *   scheduleUpdate = function (fiber) {
 *     var root = enqueueConcurrentRenderForLane(fiber, SyncLane);
 *     if (root !== null) scheduleUpdateOnFiber(root, fiber, SyncLane, NoTimestamp);
 *   };
 *
 * Properties that make this the only strategy worth shipping:
 *   - Universal: works on ANY composite fiber — function components (including
 *     hookless ones), memo, forwardRef, and class components alike.
 *   - Zero pollution: marks a lane and schedules; it does NOT mutate any hook
 *     value or prop. No "nudge anchor" to keep clean.
 *   - React-sanctioned: it is the mechanism React ships for DevTools, not a
 *     hand-rolled lane write.
 *
 * Dev-build only: `scheduleUpdate` is registered only in development React
 * builds, and only when the DevTools-hook shim was present before react-dom
 * evaluated. On production it is absent → `no-scheduleUpdate`.
 */

import { getFiberSource as readFiberSource } from './fiber-source';
import { getScheduleUpdate, type ReactRenderer } from './react-renderer';

export type Fiber = {
  type?: { displayName?: string; name?: string } | unknown;
  elementType?: { displayName?: string; name?: string } | unknown;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  _debugStack?: unknown;
  _debugOwner?: Fiber | null;
  [key: string]: unknown;
};

export type NormalizeRememberedFiberId = (raw: unknown) => string | null;
export type GetRememberedFiber = (id: string) => Fiber | null | undefined;

export interface FiberScheduleUpdateDeps {
  normalizeRememberedFiberId: NormalizeRememberedFiberId;
  getRememberedFiber: GetRememberedFiber;
  /** Optional override for renderer discovery; defaults to the live DevTools hook. */
  getScheduleUpdate?: (scope?: typeof globalThis) => ((fiber: unknown) => void) | null;
  /** Optional scope override (tests). Defaults to globalThis. */
  scope?: typeof globalThis;
}

export function getFiberDisplayName(fiber: Fiber | null | undefined): string {
  if (!fiber) return 'Unknown';
  const fromType = fiber.type as { displayName?: string; name?: string } | undefined;
  const fromElement = fiber.elementType as { displayName?: string; name?: string } | undefined;
  return (
    (fromType && (fromType.displayName || fromType.name)) ||
    (fromElement && (fromElement.displayName || fromElement.name)) ||
    'Unknown'
  );
}

export function getFiberSource(
  fiber: Fiber | null | undefined,
): { fileName: string | null; lineNumber: number | null; columnNumber: number | null } | null {
  return readFiberSource(fiber);
}

/** Walk N steps up the `_debugOwner` chain. Returns null if it overshoots. */
function walkOwner(fiber: Fiber, ownerIndex: number): Fiber | null {
  let current: Fiber | null = fiber;
  let walked = 0;
  while (walked < ownerIndex && current) {
    current = (current._debugOwner as Fiber | null) || null;
    walked++;
  }
  return current;
}

export type FiberScheduleUpdateResult =
  | {
      ok: true;
      fiberId: string;
      fiberName: string;
      source: ReturnType<typeof getFiberSource>;
      ownerIndex: number;
      scheduled: true;
    }
  | {
      ok: false;
      error: string;
      reason: 'no-fiberId' | 'fiber-not-found' | 'owner-out-of-range' | 'no-scheduleUpdate' | 'scheduleUpdate-threw';
      fiberId?: string | null;
      fiberName?: string;
      source?: ReturnType<typeof getFiberSource>;
      ownerIndex?: number;
      stack?: string | null;
    };

/**
 * Resolve a remembered fiber id → fiber, optionally climb `ownerIndex` steps,
 * then call the DevTools renderer's `scheduleUpdate` on it. Schedules exactly
 * one re-render. Mutates nothing.
 */
export function evalFiberScheduleUpdate(
  fiberId: unknown,
  ownerIndex: unknown,
  deps: FiberScheduleUpdateDeps,
): FiberScheduleUpdateResult {
  const rememberedFiberId = deps.normalizeRememberedFiberId(fiberId);
  if (!rememberedFiberId) {
    return { ok: false, reason: 'no-fiberId', error: 'fiberId is required' };
  }

  let fiber = deps.getRememberedFiber(rememberedFiberId) as Fiber | null | undefined;
  if (!fiber) {
    return { ok: false, reason: 'fiber-not-found', error: `fiber ${rememberedFiberId} not found`, fiberId: rememberedFiberId };
  }

  const idx = Number.isFinite(Number(ownerIndex)) ? Math.max(0, Number(ownerIndex) | 0) : 0;
  const target = walkOwner(fiber, idx);
  if (!target) {
    return {
      ok: false,
      reason: 'owner-out-of-range',
      error: `ownerIndex ${idx} overshoots the owner chain for fiber ${rememberedFiberId}`,
      fiberId: rememberedFiberId,
      ownerIndex: idx,
    };
  }

  const fiberName = getFiberDisplayName(target);
  const source = getFiberSource(target);

  const resolveSchedule = deps.getScheduleUpdate || getScheduleUpdate;
  const scheduleUpdate = resolveSchedule(deps.scope);
  if (!scheduleUpdate) {
    return {
      ok: false,
      reason: 'no-scheduleUpdate',
      error:
        'no renderer.scheduleUpdate (production React build, or the DevTools-hook shim was not installed before react-dom evaluated)',
      fiberId: rememberedFiberId,
      fiberName,
      source,
      ownerIndex: idx,
    };
  }

  try {
    scheduleUpdate(target);
  } catch (e) {
    const err = e as { message?: string; stack?: string };
    return {
      ok: false,
      reason: 'scheduleUpdate-threw',
      error: err?.message || String(e),
      stack: err?.stack || null,
      fiberId: rememberedFiberId,
      fiberName,
      source,
      ownerIndex: idx,
    };
  }

  return { ok: true, fiberId: rememberedFiberId, fiberName, source, ownerIndex: idx, scheduled: true };
}

// Re-export so the iife bridge can surface renderer discovery if needed.
export type { ReactRenderer };
