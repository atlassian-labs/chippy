/**
 * Render ticks: how many synchronous render slices React ran before a commit.
 *
 * A tick is one uninterrupted stretch of render work, from React entering its
 * render loop (`renderRootSync` / `renderRootConcurrent`) to leaving it. A
 * synchronous render takes one tick. A time-sliced render (transitions,
 * retries, idle work) yields to the browser between ticks, so a commit that
 * took N ticks spanned N tasks. A render React repeats synchronously in the
 * same task (error recovery, an external-store tearing check) adds a tick.
 *
 * Ticks accumulate from the previous commit, so render attempts React threw
 * away (interrupted or restarted renders) count toward the commit that
 * finally lands. They are page-wide: when several roots render between two
 * commits, their ticks are attributed to the next commit.
 *
 * React exposes no tick callback, so the tracker reads one of two exact
 * signals, chosen per renderer:
 *
 *   - `async-dispatcher` (React 19+): React writes `ReactSharedInternals.A`
 *     exactly once on entering and once on leaving every render slice, and
 *     nowhere else in the client renderer. Present in development and
 *     production builds.
 *   - `profiling-hooks` (React 18 development and profiling builds): the
 *     scheduling-profiler hooks, where `markRenderStarted` opens every slice
 *     and `markRenderYielded` / `markRenderStopped` close it. React has one
 *     injection slot, which React DevTools also uses for its Timeline, so the
 *     tracker composes with any hooks injected through it rather than
 *     replacing them.
 *
 * Builds with neither signal (React 18 production) report ticks as
 * unavailable. Callers must not read a missing count as one tick.
 */

export type RenderTickSource = 'async-dispatcher' | 'profiling-hooks';

/** One render slice, as `[start, end]` on the `performance.now()` clock. */
export type RenderSlice = [number, number];

export interface CommitTicks {
  /** Render slices since the previous commit. */
  ticks: number;
  /** Start of the first counted slice. */
  renderStart: number;
  /** End of the last counted slice. */
  renderEnd: number;
  /** Sum of slice durations: time React spent rendering. */
  workMs: number;
  /** `renderEnd - renderStart - workMs`: time React was yielded between slices. */
  yieldedMs: number;
  /** Duration of the longest slice. */
  longestSliceMs: number;
  /** The first `maxSlices` slices; `slicesTruncated` says whether more ran. */
  slices: RenderSlice[];
  slicesTruncated: boolean;
  /**
   * True when tracking started after React registered its renderer. A render
   * already in progress at that point had earlier slices the tracker did not
   * see, so the count is a lower bound.
   */
  partial: boolean;
}

export interface RenderTickStatus {
  available: boolean;
  /** Signals in use, one entry per tracked renderer. */
  sources: RenderTickSource[];
  /** Why ticks are unavailable, when they are. */
  reason: string | null;
}

export interface RenderTickTracker {
  /**
   * Call with a renderer before React DevTools or another client can see it,
   * so later `injectProfilingHooks` calls are composed with ours.
   */
  prepareRenderer(renderer: unknown): void;
  /**
   * Start counting ticks for a renderer. `late` marks a renderer registered
   * before tracking began. `profilingHooksOwned` says another client (React
   * DevTools) may already have injected profiling hooks that cannot be read
   * back, so the React 18 signal is skipped rather than replacing them.
   */
  attachRenderer(renderer: unknown, options?: AttachOptions): RenderTickSource | null;
  /** Ticks since the previous call, or null when no renderer is tracked. */
  takeCommitTicks(): CommitTicks | null;
  status(): RenderTickStatus;
  /** Drop ticks counted since the previous commit. */
  reset(): void;
  /** Stop tracking and give every renderer slot back. */
  detach(): void;
}

export interface AttachOptions {
  late?: boolean;
  profilingHooksOwned?: boolean;
}

type ProfilingHooks = Record<string, unknown>;
type InjectProfilingHooks = (hooks: ProfilingHooks | null) => void;
type RendererLike = {
  currentDispatcherRef?: unknown;
  injectProfilingHooks?: InjectProfilingHooks;
  [key: string]: unknown;
};

const SLICE_END_HOOKS = ['markRenderYielded', 'markRenderStopped'] as const;

export function createRenderTickTracker(options: { now?: () => number; maxSlices?: number } = {}): RenderTickTracker {
  const now = options.now ?? (() => performance.now());
  const maxSlices = options.maxSlices ?? 32;

  // Pending ticks since the previous commit.
  let pending: CommitTicks | null = null;
  let sliceStart = -1;
  let partialPending = false;
  let lastFailure: string | null = null;

  const sources = new Map<object, RenderTickSource>();
  const releases = new Map<object, () => void>();
  const prepared = new WeakMap<object, PreparedProfilingSlot>();
  // Renderers that share one React package share one internals object; trap it once.
  const trappedInternals = new Set<object>();

  function openSlice(): void {
    if (sliceStart >= 0) return;
    sliceStart = now();
  }

  function closeSlice(): void {
    if (sliceStart < 0) return;
    const start = sliceStart;
    const end = now();
    sliceStart = -1;
    const duration = end - start;
    if (!pending) {
      pending = {
        ticks: 0, renderStart: start, renderEnd: end, workMs: 0, yieldedMs: 0,
        longestSliceMs: 0, slices: [], slicesTruncated: false, partial: partialPending,
      };
    }
    pending.ticks++;
    pending.renderEnd = end;
    pending.workMs += duration;
    if (duration > pending.longestSliceMs) pending.longestSliceMs = duration;
    if (pending.slices.length < maxSlices) pending.slices.push([start, end]);
    else pending.slicesTruncated = true;
  }

  // ── React 19+: the async dispatcher slot ──────────────────────────────────

  function attachAsyncDispatcher(owner: Record<string, unknown>): (() => void) | null {
    const previous = Object.getOwnPropertyDescriptor(owner, 'A');
    if (previous && previous.configurable === false) return null;
    let stored: unknown = previous && 'value' in previous ? previous.value : undefined;
    const read = previous?.get
      ? () => previous.get!.call(owner)
      : () => stored;
    // The value outside the open slice; React restores it when the slice ends.
    let outer: unknown = undefined;
    function set(this: unknown, next: unknown): void {
      const before = read();
      if (previous?.set) previous.set.call(owner, next);
      else stored = next;
      if (sliceStart < 0) {
        outer = before;
        openSlice();
      } else if (next === outer) {
        closeSlice();
      }
    }
    try {
      Object.defineProperty(owner, 'A', {
        configurable: true,
        enumerable: previous?.enumerable ?? true,
        get: read,
        set,
      });
    } catch (_) {
      return null;
    }
    return () => {
      const current = Object.getOwnPropertyDescriptor(owner, 'A');
      // Another tool wrapped the slot after us; removing ours would drop theirs.
      if (current?.set !== set) return;
      const value = read();
      if (previous?.get || previous?.set) Object.defineProperty(owner, 'A', previous);
      else Object.defineProperty(owner, 'A', { configurable: true, enumerable: previous?.enumerable ?? true, writable: true, value });
    };
  }

  // ── React 18: scheduling-profiler hooks ───────────────────────────────────

  type PreparedProfilingSlot = { original: InjectProfilingHooks; external: ProfilingHooks | null; active: boolean; wrapper: InjectProfilingHooks };

  function compose(slot: PreparedProfilingSlot): ProfilingHooks | null {
    const external = slot.external;
    if (!slot.active) return external;
    const hooks: ProfilingHooks = { ...(external || {}) };
    hooks.markRenderStarted = function markRenderStarted(...args: unknown[]) {
      openSlice();
      (external?.markRenderStarted as ((...a: unknown[]) => void) | undefined)?.(...args);
    };
    for (const name of SLICE_END_HOOKS) {
      hooks[name] = function closeRenderSlice(...args: unknown[]) {
        closeSlice();
        (external?.[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
      };
    }
    return hooks;
  }

  function prepareRenderer(renderer: unknown): void {
    if (!renderer || typeof renderer !== 'object') return;
    const r = renderer as RendererLike;
    if (prepared.has(r) || typeof r.injectProfilingHooks !== 'function') return;
    const slot: PreparedProfilingSlot = {
      original: r.injectProfilingHooks,
      external: null,
      active: false,
      wrapper: (hooks) => {
        slot.external = hooks;
        slot.original(compose(slot));
      },
    };
    prepared.set(r, slot);
    try {
      r.injectProfilingHooks = slot.wrapper;
    } catch (_) {
      prepared.delete(r);
    }
  }

  function attachProfilingHooks(r: RendererLike, owned: boolean): (() => void) | null {
    if (!prepared.has(r)) {
      // React DevTools injects when it attaches, and its hooks are not
      // readable, so injecting now would silently replace them.
      if (owned) return null;
      prepareRenderer(r);
    }
    const slot = prepared.get(r);
    if (!slot) return null;
    slot.active = true;
    slot.original(compose(slot));
    return () => {
      slot.active = false;
      slot.original(slot.external);
      if (r.injectProfilingHooks === slot.wrapper) r.injectProfilingHooks = slot.original;
      prepared.delete(r);
    };
  }

  function attachRenderer(renderer: unknown, attachOptions: AttachOptions = {}): RenderTickSource | null {
    if (!renderer || typeof renderer !== 'object') return null;
    const r = renderer as RendererLike;
    const existing = sources.get(r);
    if (existing) return existing;

    const internals = r.currentDispatcherRef;
    let source: RenderTickSource | null = null;
    let release: (() => void) | null = null;
    if (internals && typeof internals === 'object' && 'H' in internals && 'A' in internals) {
      if (trappedInternals.has(internals)) {
        source = 'async-dispatcher';
        release = () => {};
      } else {
        const untrap = attachAsyncDispatcher(internals as Record<string, unknown>);
        if (untrap) {
          trappedInternals.add(internals);
          source = 'async-dispatcher';
          release = () => { trappedInternals.delete(internals); untrap(); };
        } else {
          lastFailure = 'React 19 async dispatcher slot is not configurable';
        }
      }
    } else if (typeof r.injectProfilingHooks === 'function') {
      release = attachProfilingHooks(r, !!attachOptions.profilingHooksOwned);
      if (release) source = 'profiling-hooks';
      else lastFailure = 'React DevTools attached to this React 18 renderer before Avalanche and owns its profiling hooks; reload with Avalanche armed';
    } else {
      lastFailure = 'this React build exposes no render-slice signal (React 18 production builds have none)';
    }
    if (!source || !release) return null;
    sources.set(r, source);
    releases.set(r, release);
    if (attachOptions.late) partialPending = true;
    return source;
  }

  function takeCommitTicks(): CommitTicks | null {
    if (sources.size === 0) return null;
    const taken = pending;
    pending = null;
    partialPending = false;
    if (!taken) {
      // A commit with no observed slice (React rendered before tracking began).
      return {
        ticks: 0, renderStart: -1, renderEnd: -1, workMs: 0, yieldedMs: 0,
        longestSliceMs: 0, slices: [], slicesTruncated: false, partial: true,
      };
    }
    taken.yieldedMs = Math.max(0, taken.renderEnd - taken.renderStart - taken.workMs);
    return taken;
  }

  return {
    prepareRenderer,
    attachRenderer,
    takeCommitTicks,
    status() {
      const list = Array.from(sources.values());
      return {
        available: list.length > 0,
        sources: list,
        reason: list.length > 0 ? null : (lastFailure ?? 'no React renderer registered with the DevTools hook'),
      };
    },
    reset() {
      pending = null;
      partialPending = false;
    },
    detach() {
      for (const release of releases.values()) {
        try { release(); } catch (_) { /* tolerate */ }
      }
      releases.clear();
      sources.clear();
      pending = null;
      sliceStart = -1;
      partialPending = false;
    },
  };
}
