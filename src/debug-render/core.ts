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

import {
  dispatcherRefOf,
  getDispatcherRef,
  getDispatcherSlot,
  getReactRenderers,
  type DispatcherSlot,
} from '../chippy-bridge/react-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One parsed call-stack frame. `loc` is `line:column` in the script; `url` is
 * that script, kept so the helper can map production frames through the
 * script's source map. It is absent when the frame names no script.
 */
export type StackFrame = { name: string; loc: string; url?: string };

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

function parseStackLine(line: string): StackFrame | null {
  const m =
    line.match(/^\s*at\s+([^\s(]+)\s*\(([^)]+)\)/) ||
    line.match(/^\s*at\s+()(.+)$/);
  if (!m) return null;
  const name = (m[1] || '').trim();
  const locRaw = (m[2] || '').trim();
  const tail = locRaw.match(/:(\d+):(\d+)\)?$/);
  if (!name) return null;
  if (!tail) return { name, loc: locRaw };
  const url = locRaw.slice(0, tail.index);
  return url ? { name, loc: `${tail[1]}:${tail[2]}`, url } : { name, loc: `${tail[1]}:${tail[2]}` };
}

export function parseStackFrames(stack: string): StackFrame[] {
  return stack
    .split('\n')
    .slice(1)
    .map(parseStackLine)
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

/**
 * True for a hook frame, including qualified names. React 19's CommonJS build
 * defines `exports.useState = function (...) {}`, which V8 names
 * `exports.useState`; bundlers can produce similar `ns.useX` names.
 */
export function isHookFrameName(name: string): boolean {
  return /^use[A-Z0-9_]/.test(name.slice(name.lastIndexOf('.') + 1));
}

export function deriveComponentName(frames: StackFrame[]): string {
  // Frames above the dispatcher wrapper belong to the recorder. Bundlers may
  // rename the recorder (for example `record` to `record2` on a name clash),
  // so start after the wrapper instead of trusting its callee names.
  const wrapper = frames.findIndex((frame) => frame.name === 'atlDispatcherHook' || frame.name.endsWith('.atlDispatcherHook'));
  for (const { name } of wrapper >= 0 ? frames.slice(wrapper + 1) : frames) {
    if (!name) continue;
    if (isReactInternalFrameName(name)) continue;
    if (isHookFrameName(name)) continue; // skip use-prefixed (custom + primitive)
    return name;
  }
  return 'Unknown';
}

// Frames below the recorder needed to name a component in the common case:
// record, the dispatcher wrapper, React's hook facade, a custom hook or two.
const NAME_STACK_FRAMES = 8;

function stackFrameCount(stack: string): number {
  let count = 0;
  for (let i = stack.indexOf('\n'); i >= 0; i = stack.indexOf('\n', i + 1)) count++;
  return count;
}

const isWrapperFrame = (name: string) => name === 'atlDispatcherHook' || name.endsWith('.atlDispatcherHook');
const isComponentFrame = (name: string) => !!name && !isReactInternalFrameName(name) && !isHookFrameName(name);

/**
 * `deriveComponentName(parseStackFrames(stack))`, reading only the frames it
 * needs. The recorder runs on every hook call during render, and the component
 * frame is usually a few lines below the dispatcher wrapper.
 */
export function deriveComponentNameFromStack(stack: string): string {
  const seen: StackFrame[] = [];
  let afterWrapper = false;
  let start = stack.indexOf('\n');
  while (start >= 0) {
    const end = stack.indexOf('\n', start + 1);
    const frame = parseStackLine(stack.slice(start + 1, end < 0 ? undefined : end));
    start = end;
    if (!frame) continue;
    if (afterWrapper) {
      if (isComponentFrame(frame.name)) return frame.name;
    } else if (isWrapperFrame(frame.name)) {
      afterWrapper = true;
    } else {
      seen.push(frame);
    }
  }
  return afterWrapper ? 'Unknown' : deriveComponentName(seen);
}

/**
 * Reads the fiber React is rendering, from the renderer's DevTools
 * `getCurrentFiber` (development builds). With several renderers, another
 * renderer's reader can return a stale fiber, so the reader is used only when
 * exactly one renderer exposes it.
 */
function currentFiberReader(): (() => unknown) | null {
  const readers = getReactRenderers()
    .map((renderer) => (renderer as { getCurrentFiber?: unknown }).getCurrentFiber)
    .filter((read): read is () => unknown => typeof read === 'function');
  return readers.length === 1 ? readers[0] : null;
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
  let dispatcherSlot: DispatcherSlot | null = null;
  let lastSeenDispatcher: unknown = null;

  // React assigns its dispatcher when each component render starts and ends,
  // so every assignment begins a new hook sequence. Each component keeps one
  // sequence, indexed by call position: hook order is fixed per component, so
  // later renders only add positions an earlier render did not reach.
  let renderSerial = 0;
  // Development React gives DevTools the fiber being rendered. A component
  // type named once from a stack keeps that name, so later renders of it need
  // no stack. Only the type's first render with hooks pays for one.
  let currentFiber: (() => unknown) | null = null;
  const namesByType = new WeakMap<object, string>();
  let sequence: { serial: number; componentName: string; list: HookCallEvent[]; position: number; firstStack: string | null } | null = null;

  function renderingType(): object | null {
    if (!currentFiber) return null;
    try {
      const type = (currentFiber() as { type?: unknown } | null)?.type;
      return type && (typeof type === 'function' || typeof type === 'object') ? type : null;
    } catch (_) {
      return null;
    }
  }

  function record(primitive: string, args: unknown[]): void {
    if (sequence?.serial !== renderSerial) {
      const type = renderingType();
      let componentName = type ? namesByType.get(type) : undefined;
      let firstStack: string | null = null;
      if (componentName === undefined) {
        // A short stack is enough to name the component. Captured here, not
        // in a helper, so the frames above the wrapper stay the ones the name
        // and parent filters expect.
        const previousLimit = Error.stackTraceLimit;
        let stack: string;
        try {
          Error.stackTraceLimit = NAME_STACK_FRAMES;
          stack = new Error().stack || '';
        } finally {
          Error.stackTraceLimit = previousLimit;
        }
        let complete = stackFrameCount(stack) < NAME_STACK_FRAMES;
        componentName = deriveComponentNameFromStack(stack);
        if (componentName === 'Unknown' && !complete) {
          stack = new Error().stack || '';
          complete = true;
          componentName = deriveComponentNameFromStack(stack);
        }
        if (complete) firstStack = stack;
        if (type && componentName !== 'Unknown') namesByType.set(type, componentName);
      }
      let list = eventsByComponent.get(componentName);
      if (!list) eventsByComponent.set(componentName, list = []);
      sequence = { serial: renderSerial, componentName, list, position: 0, firstStack };
    }
    const position = sequence.position++;
    const { list, componentName } = sequence;
    if (position < list.length || position >= maxEventsPerComponent) return;
    // Capture once. No filtering. Filtering is a projection concern.
    const stack = (position === 0 && sequence.firstStack) || new Error().stack || '';
    let frames: StackFrame[] | null = null;
    list.push({
      primitive,
      stack,
      // Parsed on first read: most events are never inspected.
      get frames() { return frames ??= parseStackFrames(stack); },
      set frames(value) { frames = value; },
      componentName,
      args,
    });
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
    const slot = getDispatcherSlot();
    if (!slot) return { ok: false, reason: 'ReactCurrentDispatcher not found' };
    dispatcherSlot = slot;
    const { owner, key } = slot;
    currentFiber = currentFiberReader();

    // Patch whatever is already current (likely the no-op ContextOnlyDispatcher
    // outside render, but patching it is harmless: it will only be called when
    // React swaps it in). Then trap subsequent assignments.
    patchDispatcher(owner[key]);
    lastSeenDispatcher = owner[key];

    // Intercept the slot's setter rather than React's hook facades. React owns
    // this property (`current` on <=18, `H` on 19) and changes it at render
    // boundaries; observing those transitions is what lets us patch the
    // correct phase-specific dispatcher.
    originalDescriptor = Object.getOwnPropertyDescriptor(owner, key) || null;

    let stored: unknown = owner[key];
    try {
      Object.defineProperty(owner, key, {
        configurable: true,
        get(): unknown {
          return stored;
        },
        set(next: unknown) {
          stored = next;
          renderSerial++;
          if (next !== lastSeenDispatcher) {
            lastSeenDispatcher = next;
            patchDispatcher(next);
          }
        },
      });
    } catch (e) {
      // Without the setter there are no render boundaries to record against.
      unpatchDispatcher(owner[key]);
      dispatcherSlot = null;
      return { ok: false, reason: 'cannot define property on ReactCurrentDispatcher' };
    }

    installed = true;
    return { ok: true };
  }

  function uninstall(): void {
    if (!installed) return;
    if (dispatcherSlot) {
      // Restore original property descriptor (if any) so React owns the slot again.
      const { owner, key } = dispatcherSlot;
      try {
        if (originalDescriptor) {
          Object.defineProperty(owner, key, originalDescriptor);
        } else {
          // Fall back to a plain data property holding the latest dispatcher.
          Object.defineProperty(owner, key, {
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
    currentFiber = null;
    installed = false;
    dispatcherSlot = null;
    originalDescriptor = undefined;
    lastSeenDispatcher = null;
  }

  function reset(): void {
    eventsByComponent.clear();
    sequence = null;
  }

  function rawEvents(componentName: string): HookCallEvent[] {
    return (eventsByComponent.get(componentName) || []).slice(-maxEventsPerComponent);
  }

  function allComponents(): string[] {
    return Array.from(eventsByComponent.keys());
  }

  function status(): CaptureEngineStatus {
    const g = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    const hasDevtoolsHook = !!g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    // Renderer enumeration is shared with the fiber-schedule-update capability.
    const rendererCount = getReactRenderers().length;
    const hasDispatcherRef = !!(dispatcherSlot || getDispatcherSlot());
    let totalCapturedEvents = 0;
    for (const list of eventsByComponent.values()) totalCapturedEvents += Math.min(list.length, maxEventsPerComponent);

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
    dispatcherRef: () => (dispatcherSlot ? dispatcherRefOf(dispatcherSlot) : getDispatcherRef()),
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
