// Records how component areas change over time, so an agent can tell when a
// section (a header, a description, comments) first covers the screen, when
// loading placeholders clear, and when the root becomes visually complete.
//
// Sampling is driven by DOM mutations, scrolls, and resizes, throttled to one
// measurement per interval and taken in an animation frame (after layout,
// before paint). Each measurement costs main-thread time on the page under
// observation; the cost is reported, and the interval backs off when a
// measurement takes more than half of it. Samples are kept only when a value
// changed. Times are milliseconds since start; `startedAt` is the
// performance.now() origin, shared with Avalanche commit timings.

import { measureComponentArea, type AreaOptions, type AreaReport } from './measure';

export interface AreaWatchOptions extends AreaOptions {
  /** Minimum time between measurements (default 50 ms). */
  intervalMs?: number;
  /** Also measure on this fixed period, for CSS animations that mutate nothing (default off). */
  pollMs?: number;
  /** Stop recording after this long (default 30 s). */
  durationMs?: number;
  /** Stop recording after this many kept samples (default 1000). */
  maxSamples?: number;
}

export interface AreaSample {
  t: number;
  root: number;
  placeholder: number;
  content: number;
  /** label → [area, contentArea, placeholderArea]; zero targets are omitted. */
  targets: Record<string, [number, number, number]>;
}

export interface AreaWatchDeps {
  measure(options: AreaOptions): ReturnType<typeof measureComponentArea>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  frame(fn: () => void): void;
  observe(onChange: () => void): () => void;
}

interface WatchState {
  options: AreaWatchOptions;
  startedAt: number;
  intervalMs: number;
  samples: AreaSample[];
  measurements: number;
  measureMsTotal: number;
  measureMsMax: number;
  lastMeasuredAt: number;
  pending: unknown;
  poll: unknown;
  stopTimer: unknown;
  disconnect: () => void;
  active: boolean;
  stoppedReason: string | null;
  lastKey: string;
  deps: AreaWatchDeps;
}

let state: WatchState | null = null;

export const domWatchDeps: AreaWatchDeps = {
  measure: (options) => measureComponentArea(options),
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  frame: (fn) => {
    // Hidden tabs do not run animation frames; measure directly instead.
    if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) requestAnimationFrame(() => fn());
    else fn();
  },
  observe: (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-testid'],
    });
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  },
};

export function startAreaWatch(options: AreaWatchOptions = {}, deps: AreaWatchDeps = domWatchDeps) {
  if (state) finish('restarted');
  const s: WatchState = {
    options,
    startedAt: deps.now(),
    intervalMs: Math.max(16, options.intervalMs ?? 50),
    samples: [],
    measurements: 0,
    measureMsTotal: 0,
    measureMsMax: 0,
    lastMeasuredAt: -Infinity,
    pending: null,
    poll: null,
    stopTimer: null,
    disconnect: () => {},
    active: true,
    stoppedReason: null,
    lastKey: '',
    deps,
  };
  state = s;
  s.disconnect = deps.observe(() => schedule(s));
  s.stopTimer = deps.setTimeout(() => { if (state === s) finish('duration'); }, Math.max(100, options.durationMs ?? 30000));
  if (options.pollMs && options.pollMs > 0) startPoll(s, Math.max(s.intervalMs, options.pollMs));
  recordSample(s);
  return { ok: true as const, startedAt: round(s.startedAt), intervalMs: s.intervalMs, first: s.samples[0] || null };
}

export function readAreaWatch() {
  if (!state) return { ok: false as const, reason: 'not-started' };
  return summarize(state);
}

export function stopAreaWatch() {
  if (!state) return { ok: false as const, reason: 'not-started' };
  if (state.active) {
    recordSample(state);
    finish('stopped');
  }
  return summarize(state);
}

function startPoll(s: WatchState, ms: number): void {
  const tick = () => {
    if (!s.active) return;
    schedule(s);
    s.poll = s.deps.setTimeout(tick, ms);
  };
  s.poll = s.deps.setTimeout(tick, ms);
}

function schedule(s: WatchState): void {
  if (!s.active || s.pending) return;
  const wait = Math.max(0, s.lastMeasuredAt + s.intervalMs - s.deps.now());
  s.pending = s.deps.setTimeout(() => {
    s.deps.frame(() => {
      s.pending = null;
      if (s.active) recordSample(s);
    });
  }, wait);
}

function recordSample(s: WatchState): void {
  const before = s.deps.now();
  const report = s.deps.measure(s.options);
  const after = s.deps.now();
  const cost = after - before;
  s.lastMeasuredAt = after;
  s.measurements++;
  s.measureMsTotal += cost;
  s.measureMsMax = Math.max(s.measureMsMax, cost);
  if (cost > s.intervalMs / 2) s.intervalMs = Math.min(1000, s.intervalMs * 2);

  const sample = toSample(report, before - s.startedAt);
  const key = JSON.stringify([sample.root, sample.placeholder, sample.content, sample.targets]);
  if (key === s.lastKey) return;
  s.lastKey = key;
  s.samples.push(sample);
  if (s.samples.length >= Math.max(1, s.options.maxSamples ?? 1000)) finish('max-samples');
}

function toSample(report: ReturnType<typeof measureComponentArea>, t: number): AreaSample {
  if (!report.ok) return { t: round(t), root: 0, placeholder: 0, content: 0, targets: {} };
  const targets: AreaSample['targets'] = {};
  for (const target of (report as AreaReport).targets) {
    if (target.area || target.contentArea || target.placeholderArea) {
      targets[target.label] = [target.area, target.contentArea, target.placeholderArea];
    }
  }
  return { t: round(t), root: report.root.area, placeholder: report.placeholder.area, content: report.content.area, targets };
}

function finish(reason: string): void {
  const s = state;
  if (!s || !s.active) return;
  s.active = false;
  s.stoppedReason = reason;
  s.disconnect();
  for (const handle of [s.pending, s.poll, s.stopTimer]) if (handle) s.deps.clearTimeout(handle);
  s.pending = null;
}

function summarize(s: WatchState) {
  const samples = s.samples;
  const last = samples[samples.length - 1] || null;
  const labels = new Set<string>();
  for (const sample of samples) for (const label of Object.keys(sample.targets)) labels.add(label);
  for (const name of s.options.components || []) labels.add('component:' + name);
  for (const id of s.options.testIds || []) labels.add('testid:' + id);

  const targets: Record<string, {
    firstSeenAt: number | null; firstContentAt: number | null; lastChangeAt: number | null;
    finalArea: number; finalContent: number; peakPlaceholder: number;
  }> = {};
  for (const label of labels) {
    let firstSeenAt: number | null = null;
    let firstContentAt: number | null = null;
    let lastChangeAt: number | null = null;
    let peakPlaceholder = 0;
    let previous = '';
    for (const sample of samples) {
      const v = sample.targets[label] || [0, 0, 0];
      if (firstSeenAt === null && v[0] > 0) firstSeenAt = sample.t;
      if (firstContentAt === null && v[1] > 0) firstContentAt = sample.t;
      peakPlaceholder = Math.max(peakPlaceholder, v[2]);
      const key = v.join(',');
      if (previous && key !== previous) lastChangeAt = sample.t;
      previous = key;
    }
    const final = (last && last.targets[label]) || [0, 0, 0];
    targets[label] = { firstSeenAt, firstContentAt, lastChangeAt, finalArea: final[0], finalContent: final[1], peakPlaceholder };
  }

  let placeholderFirstAt: number | null = null;
  let placeholderPeak = 0;
  let placeholderClearedAt: number | null = null;
  for (const sample of samples) {
    if (sample.placeholder > 0) {
      if (placeholderFirstAt === null) placeholderFirstAt = sample.t;
      placeholderPeak = Math.max(placeholderPeak, sample.placeholder);
      placeholderClearedAt = null;
    } else if (placeholderFirstAt !== null && placeholderClearedAt === null) {
      placeholderClearedAt = sample.t;
    }
  }

  const finalContent = last ? last.content : 0;
  const reached = (fraction: number) => {
    if (finalContent <= 0) return null;
    const hit = samples.find((sample) => sample.content >= finalContent * fraction);
    return hit ? hit.t : null;
  };

  return {
    ok: true as const,
    active: s.active,
    stoppedReason: s.stoppedReason,
    startedAt: round(s.startedAt),
    elapsedMs: round(s.deps.now() - s.startedAt),
    measurements: s.measurements,
    measureMs: { avg: s.measurements ? round(s.measureMsTotal / s.measurements) : 0, max: round(s.measureMsMax) },
    intervalMs: s.intervalMs,
    root: { firstFoundAt: samples.find((sample) => sample.root > 0)?.t ?? null, finalArea: last ? last.root : 0 },
    placeholder: { firstAt: placeholderFirstAt, peakArea: placeholderPeak, clearedAt: placeholderClearedAt, finalArea: last ? last.placeholder : 0 },
    content: { finalArea: finalContent, reached50At: reached(0.5), reached90At: reached(0.9), reached100At: reached(1) },
    targets,
    samples,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
