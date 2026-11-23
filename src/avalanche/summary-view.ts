/**
 * One-read digest of an Avalanche capture: what the interaction looked like,
 * which commits cost the most, which sources drove them, and what each pack
 * hook reported. It answers the first questions of an analysis in a single
 * round trip; drill down with `commit-peek`, `timeline`, or `dom-diff`.
 *
 * The live `summary` action and `avalanche-offline <file> summary` both build
 * this view from the serialized report, so their fields match.
 */
import { hookStepsAt, summarizeHookResults } from './avalanche-hooks';
import { compactLatestAction, tupleToStats, UPSTREAM_COMMIT_STAT_KEYS } from './commit-stats';
import { linkPerfEntries, perfSummary, type PerfSummary } from './perf-signals';
import { summarizeRebuiltProps, type RebuiltPropsSummary } from './rebuilt-props';
import { buildTimeline, type TimelineResult } from './timeline';

export const SUMMARY_DEFAULT_TOP = 5;
export const SUMMARY_DEFAULT_MAX_ITEMS = 3;

export type SummaryOptions = {
  /** Commits to list, by collateral (default 5). */
  top?: unknown;
  /** Sources to list per commit (default 3). */
  maxItems?: unknown;
};

type Report = Record<string, any>;

export type SummarySource = {
  sourceId: unknown;
  collateralAtCommit: number | null;
  /** Hooks that changed: `sameContent` is true when the new value equals the old one by content. */
  changedHooks: Array<{ index: unknown; sameContent: boolean }>;
};

export type SummaryCommit = {
  commitId: number;
  /** Commit counters; zero counters are left out. */
  stat: Record<string, number> | null;
  /** Milliseconds from the timeline origin to the commit; null without timings. */
  atMs: number | null;
  renderMs: number | null;
  ticks: number | null;
  /** Milliseconds from the commit's end to its paint; null without a paint signal. */
  paintDelayMs: number | null;
  sourcesTotal: number;
  sources: SummarySource[];
  /**
   * Object and array props that got a new identity, grouped, with whether
   * any key changed value. Null without rendered evidence or key diffs.
   */
  rebuiltProps: RebuiltPropsSummary | null;
  latestAction: unknown;
  /** Each pack hook's onStep result for this commit; empty without packs. */
  hooks: Record<string, unknown>;
  /**
   * The long animation frame the commit ran in, with every commit in that
   * frame: they ran without a paint between them. Null when the commit ran in
   * no long frame or the report has no performance entries.
   */
  longFrame: { atMs: number | null; durationMs: number; blockingMs: number; commits: number[] } | null;
};

export type SummaryTimeline = Pick<TimelineResult, 'origin' | 'window' | 'omitted' | 'text'>;

export type SummaryView = {
  commits: number;
  firstCommitId: number | null;
  lastCommitId: number | null;
  sources: number;
  totals: Record<string, number>;
  /**
   * The timeline of the last interaction as text, with its origin, window, and
   * omitted counts, or why it could not be built. The text already states the
   * waits, visual completeness, late paints, and long frames; `avalanche-timeline`
   * returns them as structured `perceived`, `screen`, and `boundaries`.
   */
  timeline: SummaryTimeline | { error: string };
  topCommits: SummaryCommit[];
  hooks: ReturnType<typeof summarizeHookResults>;
  /** Browser performance metrics over the whole capture; null when the report has no performance entries. */
  perf: PerfSummary | null;
  meta: unknown;
};

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
}

// Rounds to whole ms; `|| 0` turns -0 into 0, which JSON would print as 0 anyway.
function ms(value: number): number {
  return Math.round(value) || 0;
}

function at<T>(map: Record<string, T> | undefined, id: number): T | undefined {
  return map?.[id] ?? map?.[String(id)];
}

function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function sourceRows(entries: unknown[], maxItems: number): SummarySource[] {
  return entries.slice(0, maxItems).map((entry) => {
    const e = (entry && typeof entry === 'object' ? entry : { sourceId: entry }) as {
      sourceId?: unknown;
      collateral?: unknown;
      trashers?: Array<{ index?: unknown; prevValue?: unknown; currentValue?: unknown }>;
    };
    return {
      sourceId: e.sourceId ?? null,
      collateralAtCommit: finite(e.collateral),
      changedHooks: (Array.isArray(e.trashers) ? e.trashers : []).map((t) => ({
        index: t?.index ?? null,
        sameContent: sameContent(t?.prevValue, t?.currentValue),
      })),
    };
  });
}

function frameOf(frames: ReturnType<typeof linkPerfEntries>, commitId: number, origin: number | null): SummaryCommit['longFrame'] {
  const frame = frames.find((f) => f.commits.during.includes(commitId));
  if (!frame) return null;
  return {
    atMs: origin === null ? null : ms(frame.startTime - origin),
    durationMs: ms(frame.duration),
    blockingMs: ms(frame.blockingDuration ?? 0),
    commits: frame.commits.during,
  };
}

function compactTimeline(report: Report): SummaryView['timeline'] {
  const timeline = buildTimeline(report as Parameters<typeof buildTimeline>[0]);
  if ('error' in timeline) return { error: timeline.error };
  const { origin, window, omitted, text } = timeline;
  return { origin, window, omitted, text };
}

function nonZero(stats: Record<string, number> | null | undefined): Record<string, number> | null {
  return stats ? Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== 0)) : null;
}

function tenths(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

export function buildSummaryView(report: Report, options: SummaryOptions = {}): SummaryView {
  const top = positive(options.top, SUMMARY_DEFAULT_TOP);
  const maxItems = positive(options.maxItems, SUMMARY_DEFAULT_MAX_ITEMS);
  const commitStats = (report.commitStats ?? {}) as Record<string, unknown>;
  const ids = Object.keys(commitStats).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  const totals: Record<string, number> = Object.fromEntries(UPSTREAM_COMMIT_STAT_KEYS.map((key) => [key, 0]));
  const statsById = new Map<number, Record<string, number> | null>();
  for (const id of ids) {
    const stats = tupleToStats(at(commitStats, id));
    statsById.set(id, stats);
    if (stats) for (const key of UPSTREAM_COMMIT_STAT_KEYS) totals[key] += stats[key];
  }

  const timeline = compactTimeline(report);
  const origin = 'origin' in timeline ? finite(timeline.origin.at) : null;

  const frames = Array.isArray(report.perfEntries)
    ? linkPerfEntries(report, report.perfEntries.filter((e: { entryType?: unknown }) => e.entryType === 'long-animation-frame' || e.entryType === 'longtask'))
    : [];

  const topCommits = ids
    .slice()
    .sort((a, b) => (statsById.get(b)?.collateral ?? 0) - (statsById.get(a)?.collateral ?? 0) || a - b)
    .slice(0, top)
    .map((commitId): SummaryCommit => {
      const timing = at(report.commitTimings, commitId) as
        | { startTime?: unknown; endTime?: unknown; paintAt?: unknown; ticks?: unknown; render?: { workMs?: unknown } | null }
        | undefined;
      const start = finite(timing?.startTime);
      const end = finite(timing?.endTime);
      const paint = finite(timing?.paintAt);
      const entries = at(report.sourcesByCommit, commitId);
      const list = Array.isArray(entries) ? entries : [];
      const actions = at(report.interactionsByCommit, commitId);
      return {
        commitId,
        stat: nonZero(statsById.get(commitId)),
        atMs: start !== null && origin !== null ? ms(start - origin) : null,
        renderMs: tenths(finite(timing?.render?.workMs)),
        ticks: finite(timing?.ticks),
        paintDelayMs: paint !== null && end !== null && paint >= end ? ms(paint - end) : null,
        sourcesTotal: list.length,
        sources: sourceRows(list, maxItems),
        rebuiltProps: summarizeRebuiltProps(at(report.renderedByCommit, commitId), maxItems),
        latestAction: Array.isArray(actions) && actions.length ? compactLatestAction(actions[actions.length - 1]) : null,
        hooks: hookStepsAt(report.hooks, commitId),
        longFrame: frameOf(frames, commitId, origin),
      };
    });

  return {
    commits: ids.length,
    firstCommitId: ids[0] ?? null,
    lastCommitId: ids.at(-1) ?? null,
    sources: Array.isArray(report.sources) ? report.sources.length : 0,
    totals,
    timeline,
    topCommits,
    hooks: summarizeHookResults(report.hooks),
    perf: Array.isArray(report.perfEntries) ? perfSummary(report) : null,
    meta: report.meta ?? null,
  };
}
