/**
 * Records the page's network requests while Avalanche records commits.
 *
 * The source is Resource Timing: one `PerformanceResourceTiming` entry per
 * finished request, delivered by a live `PerformanceObserver`. A live observer
 * keeps receiving entries after the browser's resource buffer (about 250
 * entries) is full, so a long capture stays complete. The browser emits an
 * entry only when a request finishes; a request still in flight when a report
 * is read is not listed yet.
 *
 * Capture is a signal, not a network log: URL, initiator type, timing, status,
 * and cache use. Headers and bodies are not available from Resource Timing.
 * `network-signals.ts` joins these requests to commits on the shared
 * `performance.now()` clock; that join is temporal proximity, not causality.
 */

import { isChippyAssetUrl, isOwnRequest } from './own-requests';

export const DEFAULT_MAX_NETWORK_REQUESTS = 500;
const MAX_URL_LENGTH = 300;

export interface NetworkCaptureOptions {
  /** Record resource requests during capture. Default true. */
  networkCapture?: boolean;
  /** Requests kept; the oldest are dropped first. Default 500. */
  maxNetworkRequests?: number;
}

export interface NetworkRequest {
  /** Sequential request id within this capture. */
  id: number;
  /** Request URL, cut to 300 characters. */
  url: string;
  /** Resource Timing initiator: fetch, xmlhttprequest, script, img, css, link, other, ... */
  initiatorType: string;
  /** performance.now() when the request started. */
  startTime: number;
  /** performance.now() when the response finished (`responseEnd`). */
  endTime: number;
  /** `endTime - startTime` in ms. */
  duration: number;
  /** HTTP status where the browser exposes it (`responseStatus`), otherwise null. */
  status: number | null;
  /** True for a cache hit, false for a network transfer, null when cross-origin timing hides it. */
  cached: boolean | null;
  /** True when the request started before this capture window opened. */
  startedBeforeCapture: boolean;
}

export interface NetworkCaptureStatus {
  /** Whether the browser delivers `resource` entries to a PerformanceObserver. */
  supported: boolean;
  /** Whether capture is switched on for this detector. */
  enabled: boolean;
  /** performance.now() when the capture window opened (install or reset). */
  windowStart: number;
  /** Requests currently kept. */
  requests: number;
  /** Requests dropped because more than `maxNetworkRequests` finished. */
  dropped: number;
  /** Requests Chippy made itself (module and source-map fetches), excluded. */
  ignoredOwn: number;
}

type ResourceEntry = {
  name: string;
  initiatorType?: string;
  startTime: number;
  responseEnd?: number;
  duration?: number;
  responseStatus?: number;
  transferSize?: number;
  decodedBodySize?: number;
  deliveryType?: string;
};

type Observer = { observe(options: Record<string, unknown>): void; disconnect(): void; takeRecords?(): unknown[] };
type ObserverConstructor = {
  new (callback: (list: { getEntries(): unknown[] }) => void): Observer;
  supportedEntryTypes?: readonly string[];
};

const round = (value: number): number => Math.round(value * 10) / 10;

function cacheUse(entry: ResourceEntry): boolean | null {
  if (entry.deliveryType === 'cache') return true;
  const transfer = entry.transferSize ?? 0;
  const decoded = entry.decodedBodySize ?? 0;
  if (transfer > 0) return false;
  // Cross-origin entries without Timing-Allow-Origin report zero sizes.
  return decoded > 0 ? true : null;
}

export function createNetworkCapture(options: NetworkCaptureOptions = {}) {
  const enabled = options.networkCapture !== false;
  const limit = Math.max(1, Math.floor(Number(options.maxNetworkRequests) || DEFAULT_MAX_NETWORK_REQUESTS));
  const requests: NetworkRequest[] = [];
  let nextId = 1;
  let dropped = 0;
  let ignoredOwn = 0;
  let windowStart = performance.now();
  let observer: Observer | null = null;

  function observerConstructor(): ObserverConstructor | null {
    const ctor = (globalThis as { PerformanceObserver?: ObserverConstructor }).PerformanceObserver;
    if (typeof ctor !== 'function') return null;
    const types = ctor.supportedEntryTypes;
    return Array.isArray(types) && !types.includes('resource') ? null : ctor;
  }

  function record(raw: unknown): void {
    const entry = raw as ResourceEntry;
    if (!entry || typeof entry.name !== 'string' || typeof entry.startTime !== 'number') return;
    const endTime = typeof entry.responseEnd === 'number' && entry.responseEnd > 0
      ? entry.responseEnd
      : entry.startTime + (entry.duration ?? 0);
    // Entries buffered before the window opened belong to an earlier capture.
    if (endTime < windowStart) return;
    if (isChippyAssetUrl(entry.name)) return;
    if (entry.initiatorType === 'fetch' && isOwnRequest(entry.name)) {
      ignoredOwn += 1;
      return;
    }
    requests.push({
      id: nextId++,
      url: entry.name.length > MAX_URL_LENGTH ? entry.name.slice(0, MAX_URL_LENGTH) : entry.name,
      initiatorType: entry.initiatorType || 'other',
      startTime: round(entry.startTime),
      endTime: round(endTime),
      duration: round(endTime - entry.startTime),
      status: typeof entry.responseStatus === 'number' && entry.responseStatus > 0 ? entry.responseStatus : null,
      cached: cacheUse(entry),
      startedBeforeCapture: entry.startTime < windowStart,
    });
    if (requests.length > limit) {
      const excess = requests.length - limit;
      requests.splice(0, excess);
      dropped += excess;
    }
  }

  /** Deliver entries the observer has queued but not yet called back with. */
  function flush(): void {
    if (!observer || typeof observer.takeRecords !== 'function') return;
    try {
      for (const entry of observer.takeRecords()) record(entry);
    } catch { /* observer disconnected */ }
  }

  return {
    requests,
    flush,

    install(): void {
      if (!enabled || observer) return;
      const Ctor = observerConstructor();
      if (!Ctor) return;
      try {
        observer = new Ctor((list) => {
          for (const entry of list.getEntries()) record(entry);
        });
        observer.observe({ type: 'resource', buffered: true });
      } catch {
        observer = null;
      }
    },

    uninstall(): void {
      if (!observer) return;
      flush();
      try { observer.disconnect(); } catch { /* already gone */ }
      observer = null;
    },

    reset(): void {
      flush();
      requests.length = 0;
      nextId = 1;
      dropped = 0;
      ignoredOwn = 0;
      windowStart = performance.now();
    },

    status(): NetworkCaptureStatus {
      return {
        supported: observerConstructor() !== null,
        enabled,
        windowStart: round(windowStart),
        requests: requests.length,
        dropped,
        ignoredOwn,
      };
    },
  };
}

export type NetworkCapture = ReturnType<typeof createNetworkCapture>;
