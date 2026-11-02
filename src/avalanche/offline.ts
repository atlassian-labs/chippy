/**
 * Offline analysis of a saved Avalanche export.
 *
 * A saved export is the `ReportDTO` returned by the live `export` action. The
 * offline commands run the same dispatcher as the live page, so `commit-list`,
 * `commit-peek`, and `hot-sources` return identical shapes online and offline.
 */
import { evalAvalanche, tupleToStats, UPSTREAM_COMMIT_STAT_KEYS, type AvalancheCommand } from '../chippy-bridge/avalanche-commands';

type SavedReport = {
  meta: Record<string, unknown>;
  sources?: Array<{ sourceId?: string } & Record<string, unknown>>;
  commitStats: Record<string, unknown>;
  [key: string]: unknown;
};

// Per-commit maps in a ReportDTO, keyed by commit id.
const PER_COMMIT_KEYS = [
  'commitStats', 'suspenseByCommit', 'sourcesByCommit', 'interactionsByCommit',
  'renderedByCommit', 'metricsByCommit', 'atlByCommit', 'timing', 'commitTimings',
];

export function isSavedReport(value: unknown): value is SavedReport {
  const v = value as SavedReport | null;
  return !!v && typeof v === 'object' && !!v.meta && typeof v.commitStats === 'object' && v.commitStats !== null;
}

// Accepts a full helper response, a `{ payload }` wrapper, or a bare report.
export function unwrapSavedReport(value: unknown): SavedReport | null {
  const candidates = [value, (value as any)?.payload, (value as any)?.result?.payload, (value as any)?.result];
  return (candidates.find(isSavedReport) as SavedReport | undefined) ?? null;
}

export function commitIds(report: SavedReport): number[] {
  return Object.keys(report.commitStats).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

// Keeps the last `count` commits. Aggregate `sources` totals still cover the
// whole capture, because the export does not carry per-commit source totals.
export function keepLastCommits(report: SavedReport, count: number): SavedReport {
  if (!(count > 0)) return report;
  const keep = new Set(commitIds(report).slice(-count).map(String));
  const out: SavedReport = { ...report };
  for (const key of PER_COMMIT_KEYS) {
    const map = report[key];
    if (!map || typeof map !== 'object') continue;
    out[key] = Object.fromEntries(Object.entries(map as Record<string, unknown>).filter(([id]) => keep.has(id)));
  }
  out.meta = { ...report.meta, keptLastCommits: keep.size };
  return out;
}

function dispatch(report: SavedReport, command: AvalancheCommand) {
  const result = evalAvalanche(command, { report: () => report as any }, null);
  const { available: _available, ...rest } = result as Record<string, unknown>;
  return rest;
}

export function summary(report: SavedReport) {
  const totals: Record<string, number> = Object.fromEntries(UPSTREAM_COMMIT_STAT_KEYS.map((key) => [key, 0]));
  for (const tuple of Object.values(report.commitStats)) {
    const stats = tupleToStats(tuple);
    if (!stats) continue;
    for (const key of UPSTREAM_COMMIT_STAT_KEYS) totals[key] += stats[key];
  }
  const ids = commitIds(report);
  return {
    ok: true,
    action: 'summary',
    commits: ids.length,
    firstCommitId: ids[0] ?? null,
    lastCommitId: ids.at(-1) ?? null,
    sources: report.sources?.length ?? 0,
    totals,
    meta: report.meta,
  };
}

// Finds components by name across aggregate sources and per-commit render
// evidence. `renderedByCommit` exists only when the capture used full detection.
export function sourceSearch(report: SavedReport, options: { name: string; top?: number }) {
  let pattern: RegExp;
  try {
    pattern = new RegExp(options.name, 'i');
  } catch (error) {
    return { ok: false, action: 'source-search', error: `invalid --name pattern: ${(error as Error).message}` };
  }
  const top = options.top && options.top > 0 ? options.top : 50;
  const sources = (report.sources ?? []).filter((source) => pattern.test(String(source.sourceId ?? '')));
  const rendered = new Map<string, { name: string; renders: number; selfSource: number; commits: number[] }>();
  const renderedByCommit = (report.renderedByCommit ?? {}) as Record<string, Array<Record<string, any>>>;
  for (const [commitId, entries] of Object.entries(renderedByCommit)) {
    for (const entry of entries ?? []) {
      if (!pattern.test(String(entry?.name ?? ''))) continue;
      const row = rendered.get(entry.sourceId) ?? { name: entry.name, renders: 0, selfSource: 0, commits: [] };
      row.renders += 1;
      if (entry.isSelfSource) row.selfSource += 1;
      row.commits.push(Number(commitId));
      rendered.set(entry.sourceId, row);
    }
  }
  const renderedRows = [...rendered.entries()]
    .map(([sourceId, row]) => ({ sourceId, ...row, commits: row.commits.slice(0, 20) }))
    .sort((a, b) => b.renders - a.renders);
  return {
    ok: true,
    action: 'source-search',
    name: options.name,
    sourcesTotal: sources.length,
    sources: sources.slice(0, top),
    renderedAvailable: Object.keys(renderedByCommit).length > 0,
    renderedTotal: renderedRows.length,
    rendered: renderedRows.slice(0, top),
  };
}

export function analyzeSavedReport(report: SavedReport, command: string, args: { _: string[]; [flag: string]: unknown }) {
  const positional = args._;
  const number = (flag: string, index: number) => {
    const value = Number(args[flag] ?? positional[index]);
    return Number.isFinite(value) ? value : undefined;
  };
  switch (command) {
    case 'summary':
      return summary(report);
    case 'commit-list':
      return dispatch(report, { action: 'commit-list', top: number('top', 0), by: String(args.by ?? positional[1] ?? 'collateral') });
    case 'commit-peek': {
      const include = String(args.include ?? positional[1] ?? '');
      return dispatch(report, {
        action: 'commit-peek',
        commitId: number('commitId', 0),
        include: include ? include.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        maxItems: number('maxItems', 2),
      });
    }
    case 'hot-sources':
      return dispatch(report, { action: 'hot-sources', limit: number('limit', 0) });
    case 'describe-action':
      return dispatch(report, { action: 'describe-action', actionId: number('actionId', 0) });
    case 'source-search': {
      const name = args.name ?? positional[0];
      if (typeof name !== 'string' || !name) return { ok: false, action: 'source-search', error: 'source-search requires --name <regex>' };
      return sourceSearch(report, { name, top: number('top', 1) });
    }
    default:
      return { ok: false, action: command, error: `unknown offline command: ${command}` };
  }
}
