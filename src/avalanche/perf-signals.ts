/**
 * Reads the browser performance entries an Avalanche report carries
 * (`perfEntries`) and joins them to commits on the shared `performance.now()`
 * clock. Runs on report data, live or a saved export, so capture pays nothing
 * for it.
 *
 * Each entry gets `commits`: the commits that started inside the entry's span
 * (`during`) and the last commit that started at or before it (`before`, with
 * the gap). A long animation frame that lists commits under `during` ran those
 * commits inside one frame, with no paint between them. Every link is
 * temporal proximity, not proof of cause.
 */

import type { PerfCaptureStatus, PerfEntry, PerfEntryType } from './perf-capture';

export const DEFAULT_PERF_TOP = 20;
const MAX_LINKED_COMMITS = 10;

type ReportLike = {
  meta?: { perf?: PerfCaptureStatus } & Record<string, unknown>;
  perfEntries?: PerfEntry[];
  commitTimings?: Record<string, { startTime?: unknown } | undefined>;
};

export interface PerfCommitLinks {
  /** Commits that started inside the entry's span, first ten. */
  during: number[];
  duringCount: number;
  /** The last commit that started at or before the entry. */
  before: { commitId: number; gapMs: number } | null;
}

export type LinkedPerfEntry = PerfEntry & { commits: PerfCommitLinks };

export interface PerfSummary {
  /** Largest session window of layout shifts without recent input (gap < 1 s, window < 5 s). */
  cls: number;
  layoutShifts: number;
  longFrames: number;
  /** Sum of long animation frame blocking time, or long task time over 50 ms where frames are unsupported. */
  totalBlockingMs: number;
  /** The long frame with the most blocking time. */
  worstFrame: { id: number; startTime: number; duration: number; blockingDuration: number; commits: number[] } | null;
  /** Interactions with at least one event of 16 ms or more. */
  interactions: number;
  /** Longest event duration of any interaction: INP when there are few interactions. */
  worstInteractionMs: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  marks: number;
  measures: number;
  longestMeasure: { name: string; startTime: number; duration: number } | null;
}

const round = (value: number): number => Math.round(value * 10) / 10;

function commitStarts(report: ReportLike): Array<{ id: number; start: number }> {
  return Object.entries(report.commitTimings ?? {})
    .map(([id, timing]) => ({ id: Number(id), start: Number(timing?.startTime) }))
    .filter((c) => Number.isFinite(c.id) && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);
}

export function linkPerfEntries(report: ReportLike, entries: PerfEntry[] = report.perfEntries ?? []): LinkedPerfEntry[] {
  const commits = commitStarts(report);
  return entries.map((entry) => {
    const from = entry.startTime;
    const to = entry.startTime + (entry.duration || 0);
    const during: number[] = [];
    let before: { id: number; start: number } | null = null;
    for (const c of commits) {
      if (c.start <= from) before = c;
      if (c.start >= from && c.start <= to) during.push(c.id);
      if (c.start > to) break;
    }
    return {
      ...entry,
      commits: {
        during: during.slice(0, MAX_LINKED_COMMITS),
        duringCount: during.length,
        before: before ? { commitId: before.id, gapMs: round(from - before.start) } : null,
      },
    };
  });
}

function cumulativeLayoutShift(shifts: PerfEntry[]): number {
  let best = 0;
  let current = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    if (s.hadRecentInput) continue;
    if (first !== null && last !== null && s.startTime - last < 1000 && s.startTime - first < 5000) current += s.value ?? 0;
    else {
      current = s.value ?? 0;
      first = s.startTime;
    }
    last = s.startTime;
    best = Math.max(best, current);
  }
  return Math.round(best * 10000) / 10000;
}

export function perfSummary(report: ReportLike, entries: PerfEntry[] = report.perfEntries ?? []): PerfSummary {
  const of = (type: PerfEntryType) => entries.filter((e) => e.entryType === type);
  const frames = of('long-animation-frame');
  const tasks = of('longtask');
  const events = of('event');
  const measures = of('measure');
  const lcp = of('largest-contentful-paint').sort((a, b) => a.startTime - b.startTime).at(-1);
  const fcp = of('paint').find((e) => e.name === 'first-contentful-paint');
  const navigation = of('navigation')[0];

  const worst = frames.reduce<PerfEntry | null>((best, e) => (!best || (e.blockingDuration ?? 0) > (best.blockingDuration ?? 0) ? e : best), null);
  const worstLinked = worst ? linkPerfEntries(report, [worst])[0] : null;
  const perInteraction = new Map<number, number>();
  for (const e of events) {
    if (!e.interactionId) continue;
    perInteraction.set(e.interactionId, Math.max(perInteraction.get(e.interactionId) ?? 0, e.duration));
  }
  const longest = measures.reduce<PerfEntry | null>((best, e) => (!best || e.duration > best.duration ? e : best), null);
  const blocking = frames.length
    ? frames.reduce((sum, e) => sum + (e.blockingDuration ?? 0), 0)
    : tasks.reduce((sum, e) => sum + Math.max(0, e.duration - 50), 0);

  return {
    cls: cumulativeLayoutShift(of('layout-shift')),
    layoutShifts: of('layout-shift').length,
    longFrames: frames.length || tasks.length,
    totalBlockingMs: round(blocking),
    worstFrame: worstLinked
      ? {
        id: worstLinked.id,
        startTime: worstLinked.startTime,
        duration: worstLinked.duration,
        blockingDuration: worstLinked.blockingDuration ?? 0,
        commits: worstLinked.commits.during,
      }
      : null,
    interactions: perInteraction.size,
    worstInteractionMs: perInteraction.size ? Math.max(...perInteraction.values()) : null,
    lcpMs: lcp ? lcp.startTime : null,
    fcpMs: fcp ? fcp.startTime : null,
    ttfbMs: navigation?.ttfb ?? null,
    marks: of('mark').length,
    measures: measures.length,
    longestMeasure: longest ? { name: longest.name, startTime: longest.startTime, duration: longest.duration } : null,
  };
}

export interface PerfViewOptions {
  /** Entry types to list (array or comma-separated); default all. */
  types?: unknown;
  /** Entries listed per type (default 20). Marks keep the latest; other types the largest. */
  top?: unknown;
  /** Case-insensitive regex on the entry name (mark or measure name, event type). */
  match?: unknown;
  /** Only entries that overlap this commit range: from the first commit's start until the commit after the last one starts. */
  fromCommit?: unknown;
  toCommit?: unknown;
}

// How each type is ranked when a list is cut to `top`.
const RANK: Partial<Record<PerfEntryType, (e: PerfEntry) => number>> = {
  'layout-shift': (e) => e.value ?? 0,
  'long-animation-frame': (e) => e.blockingDuration ?? 0,
  longtask: (e) => e.duration,
  event: (e) => e.duration,
  measure: (e) => e.duration,
};

function commitStart(report: ReportLike, id: unknown): number | null {
  const n = Number(id);
  if (id === undefined || id === null || id === '' || !Number.isFinite(n)) return null;
  const start = Number(report.commitTimings?.[String(n)]?.startTime);
  return Number.isFinite(start) ? start : null;
}

export function perfView(report: ReportLike, options: PerfViewOptions = {}) {
  const status = report.meta?.perf ?? null;
  if (!Array.isArray(report.perfEntries)) {
    return {
      error: status && !status.enabled
        ? 'performance entry capture is switched off for this detector'
        : 'this report has no perfEntries: it was recorded before report version 9, or by a runtime without performance capture',
    };
  }
  const top = Number(options.top) > 0 ? Math.floor(Number(options.top)) : DEFAULT_PERF_TOP;
  const requested = Array.isArray(options.types)
    ? options.types.map(String)
    : typeof options.types === 'string' && options.types ? options.types.split(',').map((t) => t.trim()).filter(Boolean) : null;
  let match: RegExp | null = null;
  if (typeof options.match === 'string' && options.match) {
    try {
      match = new RegExp(options.match, 'i');
    } catch (error) {
      return { error: `invalid match pattern: ${(error as Error).message}` };
    }
  }
  // A commit range keeps entries that overlap the span from the first commit's
  // start until the commit after the last one starts.
  const from = commitStart(report, options.fromCommit);
  const last = commitStart(report, options.toCommit);
  const next = last === null ? null : commitStarts(report).find((c) => c.start > last)?.start ?? Infinity;

  const selected = report.perfEntries.filter((e) =>
    (!requested || requested.includes(e.entryType)) &&
    (!match || match.test(e.name)) &&
    (from === null || e.startTime + (e.duration || 0) >= from) &&
    (next === null || e.startTime < next));

  const byType: Record<string, { count: number; items: LinkedPerfEntry[] }> = {};
  for (const type of new Set(selected.map((e) => e.entryType))) {
    const list = selected.filter((e) => e.entryType === type);
    const rank = RANK[type];
    const ordered = rank ? [...list].sort((a, b) => rank(b) - rank(a)) : [...list].sort((a, b) => b.startTime - a.startTime);
    byType[type] = { count: list.length, items: linkPerfEntries(report, ordered.slice(0, top)) };
  }
  return {
    payload: {
      status,
      summary: perfSummary(report, selected),
      entries: byType,
    },
  };
}

/**
 * Entries near one commit: those whose span contains the commit's start, and
 * those that started after it and before the next commit (`before` is this
 * commit). Longest first.
 */
export function perfForCommit(report: ReportLike, commitId: number, maxItems = DEFAULT_PERF_TOP): { total: number; items: LinkedPerfEntry[] } {
  const near = linkPerfEntries(report).filter((e) => e.commits.during.includes(commitId) || e.commits.before?.commitId === commitId);
  near.sort((a, b) => b.duration - a.duration || a.startTime - b.startTime);
  return { total: near.length, items: near.slice(0, maxItems) };
}
