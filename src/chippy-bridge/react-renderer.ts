/**
 * Shared React DevTools renderer discovery.
 *
 * React-DOM registers a renderer object into
 * `window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers` at injection time (only when
 * the hook exists before react-dom evaluates). That renderer object is the single
 * entry point for several Chippy capabilities:
 *
 *   - `currentDispatcherRef` → debug-render hook replay (see debug-render/core.ts)
 *   - `scheduleUpdate`        → fiber-schedule-update nudge (see fiber-schedule-update.ts)
 *
 * Both used to walk `hook.renderers` themselves. This module is the one place that
 * knows how to enumerate renderers, so capabilities select the field they need
 * without duplicating the iteration (and its Map/entries quirks).
 */

export type ReactRenderer = {
  /** `{ current }` on React <=18; `ReactSharedInternals` (`H`) on React 19. */
  currentDispatcherRef?: Record<string, unknown> | null;
  scheduleUpdate?: (fiber: unknown) => void;
  version?: string;
  rendererPackageName?: string;
  [key: string]: unknown;
};

export type DevtoolsHookLike = {
  renderers?:
    | Map<number, ReactRenderer>
    | { entries(): IterableIterator<[number, ReactRenderer]> };
};

/**
 * Enumerate every registered React renderer. Returns [] when the DevTools hook
 * is absent or empty (production builds without the shim, or hook installed too
 * late for react-dom to register).
 */
export function getReactRenderers(
  scope: typeof globalThis = globalThis,
): ReactRenderer[] {
  const g = scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHookLike };
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.renderers || typeof (hook.renderers as { entries?: unknown }).entries !== 'function') {
    return [];
  }
  const out: ReactRenderer[] = [];
  for (const [, renderer] of (hook.renderers as Map<number, ReactRenderer>).entries()) {
    if (renderer) out.push(renderer);
  }
  return out;
}

/**
 * The writable property that holds React's active hooks dispatcher.
 *
 * React <=18 injects `ReactCurrentDispatcher`, whose dispatcher lives at
 * `current`. React 19 injects `ReactSharedInternals`, whose dispatcher lives
 * at `H` (`current` does not exist there). React DevTools makes the same
 * distinction in its own `getDispatcherRef`.
 */
export type DispatcherSlot = { owner: Record<string, unknown>; key: 'current' | 'H' };

export function dispatcherSlotOf(injected: unknown): DispatcherSlot | null {
  if (!injected || typeof injected !== 'object') return null;
  const owner = injected as Record<string, unknown>;
  if (typeof owner.H !== 'undefined') return { owner, key: 'H' };
  if ('current' in owner) return { owner, key: 'current' };
  return null;
}

/**
 * First renderer that exposes a usable dispatcher slot. Used by debug-render
 * when it must trap writes to the exact property React assigns.
 */
export function getDispatcherSlot(scope: typeof globalThis = globalThis): DispatcherSlot | null {
  for (const renderer of getReactRenderers(scope)) {
    const slot = dispatcherSlotOf(renderer.currentDispatcherRef);
    if (slot) return slot;
  }
  return null;
}

const modernRefs = new WeakMap<object, { current: unknown }>();

/**
 * Normalize a slot to a `{ current }` ref. A legacy ref is returned as-is; a
 * React 19 internals object gets one stable accessor view that reads and
 * writes `H`.
 */
export function dispatcherRefOf(slot: DispatcherSlot): { current: unknown } {
  if (slot.key === 'current') return slot.owner as { current: unknown };
  let ref = modernRefs.get(slot.owner);
  if (!ref) {
    const { owner } = slot;
    ref = {
      get current(): unknown { return owner.H; },
      set current(value: unknown) { owner.H = value; },
    };
    modernRefs.set(owner, ref);
  }
  return ref;
}

/**
 * First renderer's hooks dispatcher as a `{ current }` ref, across React
 * versions. Used by debug replay to swap in its stub dispatcher.
 */
export function getDispatcherRef(
  scope: typeof globalThis = globalThis,
): { current: unknown } | null {
  const slot = getDispatcherSlot(scope);
  return slot ? dispatcherRefOf(slot) : null;
}

/**
 * First renderer that exposes a callable `scheduleUpdate`. This is the exact
 * function React DevTools uses to force a re-render on a fiber. It is only
 * present on development React builds. Returns null on production builds (or
 * when the DevTools-hook shim was missing at page boot).
 */
export function getScheduleUpdate(
  scope: typeof globalThis = globalThis,
): ((fiber: unknown) => void) | null {
  for (const renderer of getReactRenderers(scope)) {
    if (typeof renderer.scheduleUpdate === 'function') return renderer.scheduleUpdate;
  }
  return null;
}
