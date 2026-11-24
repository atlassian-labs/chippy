/**
 * Reads the console entries an Avalanche report carries (`consoleEntries`) and
 * joins them to commits on the shared `performance.now()` clock. Runs on report
 * data, live or a saved export.
 *
 * Each entry gets `commit`: the last commit that started at or before it, with
 * the gap. A warning React writes while rendering a commit lands after that
 * commit's start, so it links to that commit; the link is timing, not cause.
 */

import type { ConsoleCaptureStatus, ConsoleEntry, ConsoleLevel } from './console-capture';

export const DEFAULT_CONSOLE_TOP = 50;

type ReportLike = {
  meta?: { console?: ConsoleCaptureStatus } & Record<string, unknown>;
  consoleEntries?: ConsoleEntry[];
  commitTimings?: Record<string, { startTime?: unknown } | undefined>;
};

export type LinkedConsoleEntry = ConsoleEntry & { commit: { commitId: number; gapMs: number } | null };

export interface ConsoleSummary {
  /** Occurrences, repeats included, of the page's own messages; Chippy's are in `chippy`. */
  errors: number;
  warnings: number;
  /** `info`, `log`, and `debug`. */
  other: number;
  uncaught: number;
  rejections: number;
  /** Entries Chippy itself wrote, left out of the counts above. */
  chippy: number;
  /** The page's first error, the usual lead. */
  firstError: { id: number; time: number; message: string; location: string | null; commitId: number | null } | null;
}

const round = (value: number): number => Math.round(value * 10) / 10;

function commitStarts(report: ReportLike): Array<{ id: number; start: number }> {
  return Object.entries(report.commitTimings ?? {})
    .map(([id, timing]) => ({ id: Number(id), start: Number(timing?.startTime) }))
    .filter((c) => Number.isFinite(c.id) && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);
}

export function linkConsoleEntries(report: ReportLike, entries: ConsoleEntry[] = report.consoleEntries ?? []): LinkedConsoleEntry[] {
  const commits = commitStarts(report);
  return entries.map((entry) => {
    let before: { id: number; start: number } | null = null;
    for (const c of commits) {
      if (c.start > entry.time) break;
      before = c;
    }
    return { ...entry, commit: before ? { commitId: before.id, gapMs: round(entry.time - before.start) } : null };
  });
}

export function consoleSummary(report: ReportLike, entries: ConsoleEntry[] = report.consoleEntries ?? []): ConsoleSummary {
  const page = entries.filter((e) => !e.chippy);
  const count = (keep: (e: ConsoleEntry) => boolean) => page.filter(keep).reduce((sum, e) => sum + e.repeat, 0);
  const first = page.find((e) => e.level === 'error');
  const firstLinked = first ? linkConsoleEntries(report, [first])[0] : null;
  return {
    errors: count((e) => e.level === 'error'),
    warnings: count((e) => e.level === 'warn'),
    other: count((e) => e.level !== 'error' && e.level !== 'warn'),
    uncaught: count((e) => e.source === 'uncaught'),
    rejections: count((e) => e.source === 'rejection'),
    chippy: entries.length - page.length,
    firstError: firstLinked
      ? { id: firstLinked.id, time: firstLinked.time, message: firstLinked.message, location: firstLinked.location, commitId: firstLinked.commit?.commitId ?? null }
      : null,
  };
}

export interface ConsoleViewOptions {
  /** Levels to list (array or comma-separated): error, warn, info, log, debug; default all. */
  levels?: unknown;
  /** Entries listed, earliest first (default 50). */
  top?: unknown;
  /** Case-insensitive regex over the message. */
  match?: unknown;
  /** Only entries from the first commit's start until the commit after the last one starts. */
  fromCommit?: unknown;
  toCommit?: unknown;
  /** Include entries Chippy itself wrote. Default false. */
  chippy?: unknown;
}

function commitStart(report: ReportLike, id: unknown): number | null {
  const n = Number(id);
  if (id === undefined || id === null || id === '' || !Number.isFinite(n)) return null;
  const start = Number(report.commitTimings?.[String(n)]?.startTime);
  return Number.isFinite(start) ? start : null;
}

export function consoleView(report: ReportLike, options: ConsoleViewOptions = {}) {
  const status = report.meta?.console ?? null;
  if (!Array.isArray(report.consoleEntries)) {
    return {
      error: status && !status.enabled
        ? 'console capture is switched off for this detector'
        : 'this report has no consoleEntries: it was recorded before report version 10, or by a runtime without console capture',
    };
  }
  const top = Number(options.top) > 0 ? Math.floor(Number(options.top)) : DEFAULT_CONSOLE_TOP;
  const levels = Array.isArray(options.levels)
    ? options.levels.map(String)
    : typeof options.levels === 'string' && options.levels ? options.levels.split(',').map((l) => l.trim()).filter(Boolean) : null;
  let match: RegExp | null = null;
  if (typeof options.match === 'string' && options.match) {
    try {
      match = new RegExp(options.match, 'i');
    } catch (error) {
      return { error: `invalid match pattern: ${(error as Error).message}` };
    }
  }
  const includeChippy = options.chippy === true || options.chippy === 'true';
  const from = commitStart(report, options.fromCommit);
  const last = commitStart(report, options.toCommit);
  const next = last === null ? null : commitStarts(report).find((c) => c.start > last)?.start ?? Infinity;

  const windowed = report.consoleEntries.filter((e) =>
    (from === null || (e.lastTime ?? e.time) >= from) &&
    (next === null || e.time < next));
  const selected = windowed.filter((e) =>
    (includeChippy || !e.chippy) &&
    (!levels || levels.includes(e.level as ConsoleLevel)) &&
    (!match || match.test(e.message)));
  return {
    payload: {
      status,
      summary: consoleSummary(report, windowed),
      count: selected.length,
      truncated: selected.length > top,
      entries: linkConsoleEntries(report, selected.slice(0, top)),
    },
  };
}

/** The page's entries linked to one commit: logged after it started and before the next commit. */
export function consoleForCommit(report: ReportLike, commitId: number, maxItems = DEFAULT_CONSOLE_TOP): { total: number; items: LinkedConsoleEntry[] } {
  const near = linkConsoleEntries(report).filter((e) => !e.chippy && e.commit?.commitId === commitId);
  return { total: near.length, items: near.slice(0, maxItems) };
}
