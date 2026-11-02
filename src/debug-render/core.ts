/**
 * Debug-render module.
 *
 * Single responsibility: capture per-render hook events for components, and
 * expose them losslessly to higher layers (the detector projects them).
 *
 * Capture strategy: dispatcher interception via the DevTools global hook.
 *
 * React 18 routes every hook call through `ReactCurrentDispatcher.current`,
 * which is swapped per render phase by react-dom. We do NOT patch
 * `React.useX` (those are facades to the dispatcher) and we do NOT import
 * React here — this module must not pin a React identity.
 *
 * We discover the *page's* `ReactCurrentDispatcher` ref via the React DevTools
 * global hook contract:
 *
 *   __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.get(id).currentDispatcherRef
 *
 * That ref is page-React-owned and lives where react-dom actually writes.
 * Bootstrap requirement: a DevTools hook shim must already be installed when
 * react-dom evaluates so it calls `hook.inject(internals)`. That bootstrap is
 * Chippy's responsibility (handled by the extension content-script / helper
 * inject path); this module only consumes the result.
 *
 * Capture is intentionally lossless: raw stack + parsed frames are stored.
 * Projection (component name, custom-hook path, loc) is done downstream so
 * the original evidence can be re-projected without re-capturing.
 */

import { getDispatcherRef, getReactRenderers } from '../chippy-bridge/react-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StackFrame = { name: string; loc: string };

export type HookCallEvent = {
  primitive: string;
  stack: string;
  frames: StackFrame[];
  componentName: string;
  args: unknown[];
};

export type CaptureEngineStatus = {
  ok: boolean;
  installed: boolean;
  hasDevtoolsHook: boolean;
  rendererCount: number;
  hasDispatcherRef: boolean;
  totalCapturedComponents: number;
  totalCapturedEvents: number;
  reason?: string;
  hint?: string;
};

export type DebugRenderModule = {
  install(): { ok: boolean; reason?: string };
  uninstall(): void;
  reset(): void;
  isInstalled(): boolean;
  dispatcherRef(): DispatcherRef | null;
  rawEvents(componentName: string): HookCallEvent[];
  allComponents(): string[];
  status(): CaptureEngineStatus;
  recordEventForTest?(event: HookCallEvent): void;
};

// ---------------------------------------------------------------------------
// Stack parsing — zero-loss. Caller decides what to filter.
// ---------------------------------------------------------------------------

export function parseStackFrames(stack: string): StackFrame[] {
  return stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const m =
        line.match(/^\s*at\s+([^\s(]+)\s*\(([^)]+)\)/) ||
        line.match(/^\s*at\s+()(.+)$/);
      if (!m) return null;
      const name = (m[1] || '').trim();
      const locRaw = (m[2] || '').trim();
      const tail = locRaw.match(/:(\d+):(\d+)\)?$/);
      const loc = tail ? `${tail[1]}:${tail[2]}` : locRaw;
      return name ? { name, loc } : null;
    })
    .filter((f): f is StackFrame => !!f);
}

// ---------------------------------------------------------------------------
// Dispatcher interception
// ---------------------------------------------------------------------------

// Hook methods we instrument on the dispatcher. This list intentionally
// mirrors React 18's HooksDispatcher surface; unknown methods are passed
// through untouched so future React versions degrade gracefully instead
// of crashing.
const HOOK_METHODS: ReadonlyArray<string> = [
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
  'useId',
  'useCacheRefresh',
  'useMemoCache',
];

const HOOK_PRIMITIVE: Record<string, string> = {
  useCallback: 'Callback',
  useContext: 'Context',
  useDebugValue: 'DebugValue',
  useDeferredValue: 'DeferredValue',
  useEffect: 'Effect',
  useImperativeHandle: 'ImperativeHandle',
  useInsertionEffect: 'InsertionEffect',
  useLayoutEffect: 'LayoutEffect',
  useMemo: 'Memo',
  useReducer: 'Reducer',
  useRef: 'Ref',
  useState: 'State',
  useSyncExternalStore: 'SyncExternalStore',
  useTransition: 'Transition',
  useId: 'Id',
  useCacheRefresh: 'CacheRefresh',
  useMemoCache: 'MemoCache',
};

type DispatcherRef = { current: unknown };

/**
 * Find the page's `ReactCurrentDispatcher` ref.
 *
 * Renderer discovery is shared with the fiber-schedule-update capability — one
 * place (`chippy-bridge/react-renderer`) knows how to enumerate
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers`. react-dom registers its renderer
 * (with its own `currentDispatcherRef`) on evaluation IF the global hook existed
 * before react-dom was loaded; Chippy installs that shim before page boot.
 *
 * We do NOT touch any bundled React module identity here. There is no React
 * import in this file by design.
 */

// componentName extraction: walk frames and pick the last non-`use*` frame.
// This is a projection step; raw frames are still kept on the event so a
// caller can re-derive a different name if this heuristic is wrong.
function isReactInternalFrameName(name: string): boolean {
  return name === 'atlDispatcherHook' ||
    name === 'record' ||
    name.startsWith('Object.') ||
    name === 'renderWithHooks' ||
    name === 'updateFunctionComponent' ||
    name === 'mountIndeterminateComponent' ||
    name === 'beginWork' ||
    /^beginWork\$/.test(name) ||
    name === 'performUnitOfWork' ||
    name === 'workLoopSync' ||
    name === 'renderRootSync' ||
    name === 'performConcurrentWorkOnRoot' ||
    name === 'workLoop' ||
    name === 'flushWork';
}

function deriveComponentName(frames: StackFrame[]): string {
  for (const { name } of frames) {
    if (!name) continue;
    if (isReactInternalFrameName(name)) continue;
    if (/^use[A-Z0-9_]/.test(name)) continue; // skip use-prefixed (custom + primitive)
    return name;
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createDebugRender(options: { maxEventsPerComponent?: number } = {}): DebugRenderModule {
  const maxEventsPerComponent = options.maxEventsPerComponent ?? 600;

  const eventsByComponent = new Map<string, HookCallEvent[]>();

  // We keep a WeakMap of dispatcher object -> patched-method-restore so we
  // can patch each new dispatcher exactly once and never double-wrap. React
  // re-uses dispatcher objects across renders, so this is small and bounded.
  const patchedDispatchers = new WeakMap<object, Map<string, unknown>>();

  let installed = false;
  let originalDescriptor: PropertyDescriptor | null | undefined = undefined;
  let dispatcherRef: DispatcherRef | null = null;
  let lastSeenDispatcher: unknown = null;

  function record(primitive: string, args: unknown[]): void {
    // Capture once. No filtering. Filtering is a projection concern.
    const stack = new Error().stack || '';
    const frames = parseStackFrames(stack);
    const componentName = deriveComponentName(frames);
    const event: HookCallEvent = {
      primitive,
      stack,
      frames,
      componentName,
      args,
    };
    const list = eventsByComponent.get(componentName) || [];
    list.push(event);
    if (list.length > maxEventsPerComponent) {
      list.splice(0, list.length - maxEventsPerComponent);
    }
    eventsByComponent.set(componentName, list);
  }

  function patchDispatcher(dispatcher: unknown): void {
    if (!dispatcher || typeof dispatcher !== 'object') return;
    const obj = dispatcher as Record<string, unknown>;
    if (patchedDispatchers.has(obj)) return; // already wrapped

    // React swaps dispatcher objects between render phases. Patch each object
    // once and retain the original methods so uninstall can return ownership
    // to React without leaving wrappers on a dispatcher used later.
    const restoreMap = new Map<string, unknown>();
    for (const methodName of HOOK_METHODS) {
      const original = obj[methodName];
      if (typeof original !== 'function') continue;
      restoreMap.set(methodName, original);
      const primitive = HOOK_PRIMITIVE[methodName] || methodName;
      // Named function so it is identifiable in stack traces and can be
      // skipped by callers that post-process frames.
      obj[methodName] = function atlDispatcherHook(this: unknown, ...args: unknown[]) {
        try {
          record(primitive, args);
        } catch (_) {
          // Recording must never throw inside React render.
        }
        return (original as Function).apply(this, args);
      };
    }
    patchedDispatchers.set(obj, restoreMap);
  }

  function unpatchDispatcher(dispatcher: unknown): void {
    if (!dispatcher || typeof dispatcher !== 'object') return;
    const obj = dispatcher as Record<string, unknown>;
    const restoreMap = patchedDispatchers.get(obj);
    if (!restoreMap) return;
    for (const [methodName, fn] of restoreMap.entries()) {
      obj[methodName] = fn;
    }
    patchedDispatchers.delete(obj);
  }

  function install(): { ok: boolean; reason?: string } {
    if (installed) return { ok: true };
    const ref = getDispatcherRef();
    if (!ref) return { ok: false, reason: 'ReactCurrentDispatcher not found' };
    dispatcherRef = ref;

    // Patch whatever is already current (likely the no-op ContextOnlyDispatcher
    // outside render, but patching it is harmless: it will only be called when
    // React swaps it in). Then trap subsequent assignments.
    patchDispatcher(ref.current);
    lastSeenDispatcher = ref.current;

    // Intercept the ref's setter rather than React's hook facades. React owns
    // this ref and changes `current` at render boundaries; observing those
    // transitions is what lets us patch the correct phase-specific dispatcher.
    originalDescriptor = Object.getOwnPropertyDescriptor(ref, 'current') || null;

    let stored: unknown = ref.current;
    try {
      Object.defineProperty(ref, 'current', {
        configurable: true,
        get(): unknown {
          return stored;
        },
        set(next: unknown) {
          stored = next;
          if (next !== lastSeenDispatcher) {
            lastSeenDispatcher = next;
            patchDispatcher(next);
          }
        },
      });
    } catch (e) {
      dispatcherRef = null;
      return { ok: false, reason: 'cannot define property on ReactCurrentDispatcher' };
    }

    installed = true;
    return { ok: true };
  }

  function uninstall(): void {
    if (!installed) return;
    if (dispatcherRef) {
      // Restore original property descriptor (if any) so React owns `current` again.
      try {
        if (originalDescriptor) {
          Object.defineProperty(dispatcherRef, 'current', originalDescriptor);
        } else {
          // Fall back to a plain data property holding the latest dispatcher.
          Object.defineProperty(dispatcherRef, 'current', {
            configurable: true,
            writable: true,
            enumerable: true,
            value: lastSeenDispatcher,
          });
        }
      } catch (_) {
        /* tolerate */
      }
    }
    // Best-effort unpatch of the last dispatcher we touched. Other dispatchers
    // patched earlier remain wrapped until GC; the wrappers are cheap.
    unpatchDispatcher(lastSeenDispatcher);
    installed = false;
    dispatcherRef = null;
    originalDescriptor = undefined;
    lastSeenDispatcher = null;
  }

  function reset(): void {
    eventsByComponent.clear();
  }

  function rawEvents(componentName: string): HookCallEvent[] {
    return (eventsByComponent.get(componentName) || []).slice();
  }

  function allComponents(): string[] {
    return Array.from(eventsByComponent.keys());
  }

  function status(): CaptureEngineStatus {
    const g = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    const hasDevtoolsHook = !!g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    // Renderer enumeration is shared with the fiber-schedule-update capability.
    const rendererCount = getReactRenderers().length;
    const ref = dispatcherRef || getDispatcherRef();
    const hasDispatcherRef = !!ref;
    let totalCapturedEvents = 0;
    for (const list of eventsByComponent.values()) totalCapturedEvents += list.length;

    let reason: string | undefined;
    let hint: string | undefined;
    if (!hasDevtoolsHook) {
      reason = 'no __REACT_DEVTOOLS_GLOBAL_HOOK__ on window';
      hint = 'devtools-hook-shim must run before react-dom evaluates (extension document_start, or Playwright addInitScript)';
    } else if (rendererCount === 0) {
      reason = '__REACT_DEVTOOLS_GLOBAL_HOOK__ present but renderers Map is empty';
      hint = 'react-dom evaluated before the hook shim was installed; reload the page after installing the shim, or use addInitScript before navigation';
    } else if (!hasDispatcherRef) {
      reason = 'renderer registered but no currentDispatcherRef';
      hint = 'unsupported react-dom version, or hook was replaced after registration';
    } else if (!installed) {
      reason = 'debug-render not installed';
      hint = 'detector did not call debugRender.install() — check avalanche install() lifecycle';
    } else if (totalCapturedEvents === 0) {
      reason = 'capture engine installed but no hook events recorded yet';
      hint = 'trigger at least one render of the component you want to inspect after install';
    }

    const ok = installed && hasDispatcherRef && totalCapturedEvents > 0;
    return {
      ok,
      installed,
      hasDevtoolsHook,
      rendererCount,
      hasDispatcherRef,
      totalCapturedComponents: eventsByComponent.size,
      totalCapturedEvents,
      reason,
      hint,
    };
  }

  return {
    install,
    uninstall,
    reset,
    isInstalled: () => installed,
    dispatcherRef: () => dispatcherRef || getDispatcherRef(),
    rawEvents,
    allComponents,
    status,
    recordEventForTest(event: HookCallEvent) {
      const list = eventsByComponent.get(event.componentName) || [];
      list.push(event);
      eventsByComponent.set(event.componentName, list);
    },
  };
}
