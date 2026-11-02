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
  currentDispatcherRef?: { current: unknown } | null;
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
 * First renderer that exposes a usable `currentDispatcherRef`. Used by
 * debug-render to patch the hook dispatcher.
 */
export function getDispatcherRef(
  scope: typeof globalThis = globalThis,
): { current: unknown } | null {
  for (const renderer of getReactRenderers(scope)) {
    const ref = renderer.currentDispatcherRef;
    if (ref && typeof ref === 'object') return ref;
  }
  return null;
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
