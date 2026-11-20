/**
 * Records the browser's own performance entries while Avalanche records
 * commits: User Timing marks and measures, long animation frames, layout
 * shifts, slow input events, LCP, paint, and navigation timing.
 *
 * Live `PerformanceObserver`s receive every entry as the browser emits it, so a
 * capture keeps entries the browser's bounded buffers (about 150 per type)
 * would have dropped. `buffered: true` also delivers entries emitted before
 * install; those that ended before the capture window opened are left out.
 *
 * Entries keep the browser's `performance.now()` clock, the clock commits use,
 * so a saved export lines them up with commits offline. Nodes an entry points
 * at (layout-shift sources, the LCP element, an event target) are named when
 * the entry arrives, because they can leave the DOM soon after.
 * `perf-signals.ts` joins entries to commits; that join is temporal proximity,
 * not causality.
 */

import { describeNodeOwner, type NodeOwner } from './node-owner';
import { isChippyAssetUrl } from './own-requests';

export const PERF_ENTRY_TYPES = [
  'mark',
  'measure',
  'long-animation-frame',
  'layout-shift',
  'event',
  'largest-contentful-paint',
  'paint',
  'navigation',
] as const;
export type PerfEntryType = typeof PERF_ENTRY_TYPES[number] | 'longtask';

export const DEFAULT_MAX_PERF_ENTRIES_PER_TYPE = 300;
/** Smallest `durationThreshold` the Event Timing API accepts. */
export const EVENT_DURATION_THRESHOLD_MS = 16;
/** Events outside an interaction (hover, pointer enter and leave) are kept only from this duration. */
export const NON_INTERACTION_EVENT_MIN_MS = 50;
const MAX_TEXT = 200;
const MAX_SCRIPTS = 5;
const MAX_SHIFT_SOURCES = 5;

export interface PerfCaptureOptions {
  /** Record browser performance entries during capture. Default true. */
  perfCapture?: boolean;
  /** Entries kept per entry type; the oldest of that type are dropped first. Default 300. */
  maxPerfEntries?: number;
}

export interface PerfScript {
  duration: number;
  forcedStyleAndLayoutDuration: number | null;
  invoker: string | null;
  invokerType: string | null;
  sourceURL: string | null;
  sourceFunctionName: string | null;
  sourceCharPosition: number | null;
  /** True when the script is Chippy's own code. */
  chippy?: true;
}

type Rect = [number, number, number, number];

/** One browser performance entry, on the `performance.now()` clock. */
export interface PerfEntry {
  /** Sequential id within this capture. */
  id: number;
  entryType: PerfEntryType;
  /** Entry name: the mark or measure name, event type, paint name, or navigation URL. */
  name: string;
  startTime: number;
  /** `duration` as the browser reports it; 0 for marks, shifts, and paints. */
  duration: number;
  /** Mark and measure `detail`, as one JSON line cut to 200 characters. */
  detail?: string | null;
  /** Long animation frame. */
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  /** The longest scripts that ran in the frame. */
  scripts?: PerfScript[];
  /** Layout shift. */
  value?: number;
  hadRecentInput?: boolean;
  sources?: Array<NodeOwner & { previousRect: Rect | null; currentRect: Rect | null }>;
  /** Event timing. */
  interactionId?: number;
  inputDelay?: number;
  processing?: number;
  presentationDelay?: number;
  target?: NodeOwner | null;
  /** Largest contentful paint. */
  renderTime?: number;
  loadTime?: number;
  size?: number;
  url?: string | null;
  element?: NodeOwner | null;
  /** Navigation. */
  navigationType?: string;
  ttfb?: number;
  domContentLoaded?: number;
  load?: number;
  transferSize?: number;
}

export interface PerfCaptureStatus {
  /** Whether capture is switched on for this detector. */
  enabled: boolean;
  /** Entry types this browser supports and the capture observes. */
  observed: PerfEntryType[];
  /** Entry types the capture asked for that this browser does not support. */
  unsupported: string[];
  /** performance.now() when the capture window opened (install or reset). */
  windowStart: number;
  /** Entries currently kept. */
  entries: number;
  /** Entries kept, by type. */
  byType: Partial<Record<PerfEntryType, number>>;
  /** Entries dropped, by type, because more than `maxPerfEntries` of that type arrived. */
  dropped: Partial<Record<PerfEntryType, number>>;
  /** performance.now() when the capture was paused, or null while it records. */
  pausedAt: number | null;
}

type Observer = { observe(options: Record<string, unknown>): void; disconnect(): void; takeRecords?(): unknown[] };
type ObserverConstructor = {
  new (callback: (list: { getEntries(): unknown[] }) => void): Observer;
  supportedEntryTypes?: readonly string[];
};
type RawEntry = Record<string, any> & { entryType?: string; name?: string; startTime: number; duration?: number };

const round = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : 0);
const cut = (text: string): string => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text);

function detailOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { text = undefined; }
  return cut(typeof text === 'string' ? text : String(value));
}

function rectOf(rect: any): Rect | null {
  return rect ? [round(rect.x), round(rect.y), round(rect.width), round(rect.height)] : null;
}

function owner(node: unknown): NodeOwner | null {
  try { return describeNodeOwner(node); } catch { return null; }
}

function scriptsOf(raw: RawEntry): PerfScript[] {
  const scripts: any[] = Array.isArray(raw.scripts) ? raw.scripts.slice() : [];
  return scripts
    .sort((a, b) => (b?.duration ?? 0) - (a?.duration ?? 0))
    .slice(0, MAX_SCRIPTS)
    .map((s) => {
      const sourceURL = typeof s?.sourceURL === 'string' && s.sourceURL ? cut(s.sourceURL) : null;
      return {
        duration: round(s?.duration),
        forcedStyleAndLayoutDuration: typeof s?.forcedStyleAndLayoutDuration === 'number' ? round(s.forcedStyleAndLayoutDuration) : null,
        invoker: typeof s?.invoker === 'string' && s.invoker ? cut(s.invoker) : null,
        invokerType: s?.invokerType || null,
        sourceURL,
        sourceFunctionName: s?.sourceFunctionName || null,
        sourceCharPosition: typeof s?.sourceCharPosition === 'number' && s.sourceCharPosition >= 0 ? s.sourceCharPosition : null,
        ...(sourceURL && isChippyAssetUrl(sourceURL) && { chippy: true as const }),
      };
    });
}

/** Shapes a raw `PerformanceEntry` into a stored entry, without its id. */
export function shapePerfEntry(raw: RawEntry): Omit<PerfEntry, 'id'> | null {
  if (!raw || typeof raw.startTime !== 'number') return null;
  const entryType = String(raw.entryType || '') as PerfEntryType;
  const base = { entryType, name: cut(String(raw.name ?? '')), startTime: round(raw.startTime), duration: round(raw.duration) };
  switch (entryType) {
    case 'mark':
    case 'measure':
      return { ...base, detail: detailOf(raw.detail) };
    case 'long-animation-frame':
      return {
        ...base,
        blockingDuration: round(raw.blockingDuration),
        renderStart: round(raw.renderStart),
        styleAndLayoutStart: round(raw.styleAndLayoutStart),
        scripts: scriptsOf(raw),
      };
    case 'layout-shift':
      return {
        ...base,
        value: Math.round(Number(raw.value || 0) * 10000) / 10000,
        hadRecentInput: !!raw.hadRecentInput,
        sources: (Array.isArray(raw.sources) ? raw.sources : []).slice(0, MAX_SHIFT_SOURCES).map((s: any) => ({
          ...(owner(s?.node) ?? { element: null, testId: null, component: null }),
          previousRect: rectOf(s?.previousRect),
          currentRect: rectOf(s?.currentRect),
        })),
      };
    case 'event':
      return {
        ...base,
        interactionId: Number(raw.interactionId) || 0,
        inputDelay: round(raw.processingStart - raw.startTime),
        processing: round(raw.processingEnd - raw.processingStart),
        presentationDelay: round(raw.startTime + (raw.duration ?? 0) - raw.processingEnd),
        target: owner(raw.target),
      };
    case 'largest-contentful-paint':
      return {
        ...base,
        renderTime: round(raw.renderTime),
        loadTime: round(raw.loadTime),
        size: Number(raw.size) || 0,
        url: typeof raw.url === 'string' && raw.url ? cut(raw.url) : null,
        element: owner(raw.element),
      };
    case 'navigation':
      return {
        ...base,
        navigationType: String(raw.type || ''),
        ttfb: round(raw.responseStart),
        domContentLoaded: round(raw.domContentLoadedEventEnd),
        load: round(raw.loadEventEnd),
        transferSize: Number(raw.transferSize) || 0,
      };
    case 'paint':
    case 'longtask':
      return base;
    default:
      return null;
  }
}

export function createPerfCapture(options: PerfCaptureOptions = {}) {
  const enabled = options.perfCapture !== false;
  const limit = Math.max(1, Math.floor(Number(options.maxPerfEntries) || DEFAULT_MAX_PERF_ENTRIES_PER_TYPE));
  const entries: PerfEntry[] = [];
  const kept = new Map<PerfEntryType, number>();
  const dropped = new Map<PerfEntryType, number>();
  let nextId = 1;
  let windowStart = performance.now();
  let pausedAt: number | null = null;
  let observers: Observer[] = [];

  function observerConstructor(): ObserverConstructor | null {
    const ctor = (globalThis as { PerformanceObserver?: ObserverConstructor }).PerformanceObserver;
    return typeof ctor === 'function' ? ctor : null;
  }

  /** Types to observe here: the supported ones, with long tasks standing in for long animation frames. */
  function plannedTypes(): { observed: PerfEntryType[]; unsupported: string[] } {
    const ctor = observerConstructor();
    const supported = ctor && Array.isArray(ctor.supportedEntryTypes) ? ctor.supportedEntryTypes : [];
    const observed: PerfEntryType[] = PERF_ENTRY_TYPES.filter((type) => supported.includes(type));
    const unsupported: string[] = PERF_ENTRY_TYPES.filter((type) => !supported.includes(type));
    if (!supported.includes('long-animation-frame') && supported.includes('longtask')) observed.push('longtask');
    return { observed, unsupported };
  }

  function dropOldest(type: PerfEntryType): void {
    const index = entries.findIndex((entry) => entry.entryType === type);
    if (index < 0) return;
    entries.splice(index, 1);
    kept.set(type, (kept.get(type) ?? 1) - 1);
    dropped.set(type, (dropped.get(type) ?? 0) + 1);
  }

  function record(raw: unknown): void {
    const entry = raw as RawEntry;
    if (!entry || typeof entry.startTime !== 'number') return;
    const end = entry.startTime + (typeof entry.duration === 'number' ? entry.duration : 0);
    // Buffered entries that ended before the window opened belong to an earlier capture.
    if (end < windowStart) return;
    // A paused capture keeps entries that started before the pause.
    if (pausedAt !== null && entry.startTime >= pausedAt) return;
    // Hover and other non-interaction events fire by the dozen in a slow frame; keep them only when slow on their own.
    if (entry.entryType === 'event' && !entry.interactionId && (entry.duration ?? 0) < NON_INTERACTION_EVENT_MIN_MS) return;
    const shaped = shapePerfEntry(entry);
    if (!shaped) return;
    entries.push({ id: nextId++, ...shaped });
    kept.set(shaped.entryType, (kept.get(shaped.entryType) ?? 0) + 1);
    if ((kept.get(shaped.entryType) ?? 0) > limit) dropOldest(shaped.entryType);
  }

  /** Deliver entries the observers have queued but not yet called back with. */
  function flush(): void {
    for (const observer of observers) {
      if (typeof observer.takeRecords !== 'function') continue;
      try {
        for (const entry of observer.takeRecords()) record(entry);
      } catch { /* observer disconnected */ }
    }
  }

  return {
    entries,
    flush,

    install(): void {
      if (!enabled || observers.length) return;
      const Ctor = observerConstructor();
      if (!Ctor) return;
      for (const type of plannedTypes().observed) {
        try {
          const observer = new Ctor((list) => {
            for (const entry of list.getEntries()) record(entry);
          });
          observer.observe({
            type,
            buffered: true,
            ...(type === 'event' && { durationThreshold: EVENT_DURATION_THRESHOLD_MS }),
          });
          observers.push(observer);
        } catch { /* this type cannot be observed here */ }
      }
    },

    uninstall(): void {
      flush();
      for (const observer of observers) {
        try { observer.disconnect(); } catch { /* already gone */ }
      }
      observers = [];
    },

    /** Stop taking new entries; entries that started before the pause still arrive. */
    pause(): void {
      if (pausedAt !== null) return;
      flush();
      pausedAt = performance.now();
    },

    resume(): void {
      flush();
      pausedAt = null;
    },

    reset(): void {
      flush();
      pausedAt = null;
      entries.length = 0;
      kept.clear();
      dropped.clear();
      nextId = 1;
      windowStart = performance.now();
    },

    status(): PerfCaptureStatus {
      const { observed, unsupported } = enabled ? plannedTypes() : { observed: [], unsupported: [] };
      const byType: PerfCaptureStatus['byType'] = {};
      for (const [type, count] of kept) if (count > 0) byType[type] = count;
      return {
        enabled,
        observed,
        unsupported,
        windowStart: round(windowStart),
        entries: entries.length,
        byType,
        dropped: Object.fromEntries(dropped),
        pausedAt: pausedAt === null ? null : round(pausedAt),
      };
    },
  };
}

export type PerfCapture = ReturnType<typeof createPerfCapture>;
