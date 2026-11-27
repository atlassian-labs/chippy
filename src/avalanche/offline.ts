/**
 * Offline analysis of a saved Avalanche export.
 *
 * A saved export is the `ReportDTO` returned by the live `export` action. The
 * offline commands run the same dispatcher as the live page, so `commit-list`,
 * `commit-peek`, `hot-sources`, and `perf` return identical shapes online and offline.
 */
import { buildSummaryView, type SummaryOptions } from './summary-view';
import { evalAvalanche, type AvalancheCommand } from '../chippy-bridge/avalanche-commands';
import { componentNamesIn } from '../chippy-bridge/component-name-tokens';

type SavedReport = {
  meta: Record<string, unknown>;
  sources?: Array<{ sourceId?: string } & Record<string, unknown>>;
  commitStats: Record<string, unknown>;
  [key: string]: unknown;
};

// Per-commit maps in a ReportDTO, keyed by commit id.
const PER_COMMIT_KEYS = [
  'commitStats', 'suspenseByCommit', 'sourcesByCommit', 'interactionsByCommit',
  'renderedByCommit', 'screenByCommit', 'domByCommit', 'metricsByCommit', 'timing', 'commitTimings',
];

export function isSavedReport(value: unknown): value is SavedReport {
  const v = value as SavedReport | null;
  return !!v && typeof v === 'object' && !!v.meta && typeof v.commitStats === 'object' && v.commitStats !== null;
}

// Accepts a full helper response, a `{ payload }` wrapper, an A/B sample
// (`ab-capture` keeps the export under `report`), or a bare report.
export function unwrapSavedReport(value: unknown): SavedReport | null {
  const v = value as any;
  const candidates = [value, v?.payload, v?.result?.payload, v?.result, v?.report];
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
  // Pack extension results keep per-commit steps inside each hook set.
  if (report.hooks && typeof report.hooks === 'object') {
    out.hooks = Object.fromEntries(
      Object.entries(report.hooks as Record<string, { steps?: Record<string, unknown> }>).map(([id, result]) => [
        id,
        { ...result, steps: Object.fromEntries(Object.entries(result?.steps ?? {}).filter(([commitId]) => keep.has(commitId))) },
      ]),
    );
  }
  out.meta = { ...report.meta, keptLastCommits: keep.size };
  return out;
}

function dispatch(report: SavedReport, command: AvalancheCommand) {
  const result = evalAvalanche(command, { report: () => report as any }, null);
  const { available: _available, ...rest } = result as Record<string, unknown>;
  return rest;
}

// Flat for older callers: the digest fields sit at the top level, beside `ok` and `action`.
export function summary(report: SavedReport, options: SummaryOptions = {}) {
  const view = buildSummaryView(report, options);
  const componentNames = componentNamesIn(view, report.meta?.componentNames);
  return { ok: true, action: 'summary', ...view, ...(componentNames.length > 0 && { componentNames }) };
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
    const raw = args[flag] ?? positional[index];
    // An empty position ("") skips it, as in the live shell commands.
    if (raw === undefined || raw === null || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  switch (command) {
    case 'summary':
      return summary(report, { top: number('top', 0), maxItems: number('maxItems', 1) });
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
    case 'network': {
      const initiators = String(args.initiators ?? positional[3] ?? '');
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: 'network',
        top: number('top', 0),
        by: String(args.by ?? positional[1] ?? 'start'),
        ...(typeof match === 'string' && match && { match }),
        ...(initiators && { initiators: initiators.split(',').map((item) => item.trim()).filter(Boolean) }),
        window: number('window', 4),
      });
    }
    case 'perf': {
      const types = args.types ?? positional[0];
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: 'perf',
        ...(typeof types === 'string' && types && { types }),
        top: number('top', 1),
        ...(typeof match === 'string' && match && { match }),
        fromCommit: number('fromCommit', 3),
        toCommit: number('toCommit', 4),
      });
    }
    case 'console': {
      const levels = args.levels ?? positional[0];
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: 'console',
        ...(typeof levels === 'string' && levels && { levels }),
        top: number('top', 1),
        ...(typeof match === 'string' && match && { match }),
        fromCommit: number('fromCommit', 3),
        toCommit: number('toCommit', 4),
        ...((args.includeChippy === true || args.includeChippy === 'true') && { includeChippy: true }),
      });
    }
    case 'timeline': {
      const exclude = args.exclude ?? positional[3];
      return dispatch(report, {
        action: 'timeline',
        fromCommit: number('fromCommit', 0),
        toCommit: number('toCommit', 1),
        minRequestMs: number('minRequestMs', 2),
        minIdleMs: number('minIdleMs', 99),
        top: number('top', 99),
        ...(typeof exclude === 'string' && exclude && { exclude }),
        ...(typeof args.format === 'string' && { format: args.format }),
      });
    }
    case 'dom-diff': {
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: 'dom-diff',
        fromCommit: number('fromCommit', 0),
        toCommit: number('toCommit', 1),
        ...(typeof match === 'string' && match && { match }),
        maxItems: number('maxItems', 3),
        top: number('top', 99),
      });
    }
    case 'source-search': {
      const name = args.name ?? positional[0];
      if (typeof name !== 'string' || !name) return { ok: false, action: 'source-search', error: 'source-search requires --name <regex>' };
      return sourceSearch(report, { name, top: number('top', 1) });
    }
    default:
      return { ok: false, action: command, error: `unknown offline command: ${command}` };
  }
}
