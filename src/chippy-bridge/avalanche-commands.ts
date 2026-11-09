/**
 * Avalanche API command dispatchers.
 *
 * Faithful port of the original `evalAvalanche` / `readAvalancheStatus` /
 * `getReport` / `tupleToStats` block from chippy-page-bridge.js
 * (lines ~357–565). Action names, return shapes, and edge cases are
 * preserved exactly so the bridge can replace its inline body with a
 * one-line shim and the helper protocol over the WebSocket continues
 * to work unchanged.
 */

import { warmComponentTypes, type NameRecoveryStats } from './component-origin';

// ─── Type definitions ────────────────────────────────────────────────────

export type AvalancheApiStatus = {
  installed: boolean;
  hasMetricsGlobal: boolean;
  commitCount: number;
  /** `'adapter:<id>'`, `'devtools'`, or `'none'`. Bundles before the adapter seam report `'atl'`. */
  integrationMode: `adapter:${string}` | 'atl' | 'devtools' | 'none';
  /** Active commit metrics adapter id. Absent on bundles before the adapter seam. */
  metricsAdapter?: string | null;
};

export type ReadStatusResult =
  | { ok: true; available: true; status: AvalancheApiStatus }
  | { ok: false; available: boolean; error: string; moduleKeys?: string[] | null; status?: undefined };

export type AvalancheCommand = {
  action?: string;
  options?: Record<string, unknown>;
  count?: number;
  sourceId?: string;
  hookIndex?: number;
  window?: number;
  limit?: number;
  commitId?: number;
  include?: string[];
  maxItems?: number;
  top?: number;
  by?: string;
  [key: string]: unknown;
};

type Reportish = { toSerializable?: () => unknown } & Record<string, unknown>;

export type AvalancheApi = {
  status?: () => AvalancheApiStatus;
  install?: (options?: Record<string, unknown>) => unknown;
  uninstall?: () => unknown;
  reset?: () => unknown;
  exportLast?: (n?: number) => unknown;
  report?: () => Reportish;
  /** Component types the detector recorded; used to recover production names. */
  componentTypes?: () => unknown[];
  debugHook?: (sourceId: string, hookIndex: number, windowSize?: number) => unknown;
  [key: string]: unknown;
};

export type AvalancheModule = Record<string, unknown>;

export type EvalAvalancheResult = {
  ok: boolean;
  available: boolean;
  action: string;
  status?: AvalancheApiStatus;
  result?: unknown;
  payload?: unknown;
  error?: string;
  count?: number;
  total?: number;
  rows?: unknown[];
  by?: string;
  validBy?: string[];
  validInclude?: string[];
  commitId?: number;
  found?: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────

export const UPSTREAM_COMMIT_STAT_KEYS = [
  'collateral',
  'sources',
  'restarts',
  'performedWork',
  'effects',
  'memos',
  'callbacks',
  'contextUpdates',
  'unmountedComponents',
  'unmountedSubtrees',
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

export function tupleToStats(tuple: unknown): Record<string, number> | null {
  if (!Array.isArray(tuple)) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < UPSTREAM_COMMIT_STAT_KEYS.length; i++) {
    out[UPSTREAM_COMMIT_STAT_KEYS[i]] = Number(tuple[i] || 0);
  }
  return out;
}

function compactLatestAction(action: any): unknown {
  if (!action || typeof action !== 'object') return action ?? null;
  const location = action.location && typeof action.location === 'object' ? action.location : {};
  const dom = location.dom && typeof location.dom === 'object' ? location.dom : {};
  const targetFiber = location.targetFiber && typeof location.targetFiber === 'object' ? location.targetFiber : null;
  const ownerStack = Array.isArray(targetFiber?.ownerStack) ? targetFiber.ownerStack : [];
  return {
    lastCommitId: Number(action.lastCommitId ?? 0),
    deltaTime: Number(action.deltaTime ?? 0),
    action: typeof action.action === 'string' ? action.action : null,
    dom: {
      tag: typeof dom.tag === 'string' ? dom.tag : null,
      text: typeof dom.text === 'string' ? dom.text : '',
      nearestTestId: typeof dom.nearestTestId === 'string' ? dom.nearestTestId : null,
    },
    targetFiber: targetFiber ? {
      name: typeof targetFiber.name === 'string' ? targetFiber.name : null,
      key: targetFiber.key ?? null,
      ownerStackKind: targetFiber.ownerStackKind === 'parents' ? 'parents' : 'owners',
      ownerNames: ownerStack
        .map((entry: any) => (entry && typeof entry.name === 'string' ? entry.name : null))
        .filter(Boolean)
        .slice(0, 10),
      ownerCount: ownerStack.length,
    } : null,
  };
}

type ReportSlice = { raw: Reportish; serial: Record<string, unknown> } | { error: string } | null;

export function getReport(api: AvalancheApi | null | undefined): ReportSlice {
  if (!api || typeof api.report !== 'function') return null;
  try {
    const r = api.report();
    if (r && typeof (r as Reportish).toSerializable === 'function') {
      return { raw: r as Reportish, serial: (r as Reportish).toSerializable!() as Record<string, unknown> };
    }
    return { raw: r as Reportish, serial: r as Record<string, unknown> };
  } catch (e) {
    return { error: (e as { message?: string })?.message || String(e) };
  }
}

// ─── Status ──────────────────────────────────────────────────────────────

export function readAvalancheStatus(
  api: AvalancheApi | null | undefined,
  mod: AvalancheModule | null | undefined,
): ReadStatusResult {
  if (!api || typeof api.status !== 'function') {
    return {
      ok: false,
      available: !!mod,
      error: '__AVALANCHE__ API not available',
      moduleKeys: mod ? Object.keys(mod) : null,
    };
  }
  try {
    const status = api.status();
    return { ok: true, available: true, status };
  } catch (e) {
    return { ok: false, available: true, error: (e as { message?: string })?.message || String(e) };
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

export function evalAvalanche(
  command: AvalancheCommand | null | undefined,
  api: AvalancheApi | null | undefined,
  mod: AvalancheModule | null | undefined,
): EvalAvalancheResult {
  const action = String(command?.action || 'status');
  if (!api) {
    return { ok: false, available: false, action, error: '__AVALANCHE__ not available' };
  }
  try {
    switch (action) {
      case 'install': {
        const opts = command && typeof command.options === 'object' ? command.options : undefined;
        const res = api.install?.(opts);
        return { ok: true, available: true, action, result: res, status: readAvalancheStatus(api, mod).status };
      }
      case 'uninstall':
        api.uninstall?.();
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case 'reset':
      case 'clear':
        api.reset?.();
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case 'status':
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case 'export': {
        const r = getReport(api);
        if (!r) return { ok: false, available: true, action, error: 'report() unavailable' };
        if ('error' in r) return { ok: false, available: true, action, error: r.error };
        return { ok: true, available: true, action, payload: r.serial };
      }
      case 'export-last': {
        const count = Number(command?.count);
        const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
        let res: unknown;
        try {
          res = api.exportLast?.(n);
        } catch (e) {
          return { ok: false, available: true, action, error: (e as { message?: string })?.message || String(e) };
        }
        if (res && typeof (res as Reportish).toSerializable === 'function') {
          res = (res as Reportish).toSerializable!();
        }
        return { ok: true, available: true, action, count: n, payload: res };
      }
      case 'debug-hook': {
        const sourceId = String(command?.sourceId || '');
        const hookIndex = Number(command?.hookIndex);
        const windowSize = Number(command?.window);
        if (!sourceId || !Number.isFinite(hookIndex)) {
          return { ok: false, available: true, action, error: 'debug-hook requires sourceId and numeric hookIndex' };
        }
        if (typeof api.debugHook !== 'function') {
          return { ok: false, available: true, action, error: 'debugHook() unavailable on __AVALANCHE__ API' };
        }
        const payload = api.debugHook(
          sourceId,
          Math.floor(hookIndex),
          Number.isFinite(windowSize) ? Math.max(0, Math.floor(windowSize)) : undefined,
        );
        return { ok: true, available: true, action, payload };
      }
      case 'hot-sources': {
        const limit = Number(command?.limit);
        const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
        const r = getReport(api);
        if (!r || 'error' in r) {
          return { ok: false, available: true, action, error: (r && 'error' in r ? r.error : 'report() unavailable') };
        }
        const sources = Array.isArray((r.serial as { sources?: unknown[] }).sources)
          ? ((r.serial as { sources: unknown[] }).sources as Array<Record<string, unknown>>)
          : [];
        const items = sources
          .slice()
          .sort((a, b) => Number(b?.collateralUpdates || 0) - Number(a?.collateralUpdates || 0))
          .slice(0, n)
          .map((s) => ({
            sourceId: s?.sourceId ?? null,
            depth: Number(s?.depth || 0),
            causedUpdates: Number(s?.causedUpdates || 0),
            collateralUpdates: Number(s?.collateralUpdates || 0),
            maxCollateralUpdates: Number(s?.maxCollateralUpdates || 0),
            maxPenetrationDepth: Number(s?.maxPenetrationDepth || 0),
            restartWaste: Number(s?.restartWaste || 0),
          }));
        return { ok: true, available: true, action, total: sources.length, payload: { count: items.length, items } };
      }
      case 'commit-peek': {
        const commitId = Number(command?.commitId);
        if (!Number.isFinite(commitId)) {
          return { ok: false, available: true, action, error: 'commit-peek requires numeric commitId' };
        }
        const include = Array.isArray(command?.include) && command!.include!.length
          ? command!.include!
          : ['stats', 'sources', 'timing', 'metrics'];
        // `atl` is the deprecated alias of `metrics`, kept for one release.
        const allowedInclude = ['stats', 'sources', 'timing', 'metrics', 'atl', 'unmounts', 'actions', 'rendered'];
        const invalidInclude = include.filter((key) => !allowedInclude.includes(key));
        if (invalidInclude.length) {
          return {
            ok: false,
            available: true,
            action,
            error: 'unsupported commit-peek include value(s): ' + invalidInclude.join(','),
            validInclude: allowedInclude,
          };
        }
        const maxItems = Number.isFinite(Number(command?.maxItems))
          ? Math.max(1, Math.floor(Number(command!.maxItems)))
          : 50;
        const r = getReport(api);
        if (!r || 'error' in r) {
          return { ok: false, available: true, action, error: (r && 'error' in r ? r.error : 'report() unavailable') };
        }
        const ser = (r.serial || {}) as Record<string, Record<string, unknown>>;
        const tuple = ser.commitStats?.[commitId] || ser.commitStats?.[String(commitId)] || null;
        const sourceIds = (ser.sourcesByCommit?.[commitId] || ser.sourcesByCommit?.[String(commitId)] || []) as unknown[];
        const timing = ser.commitTimings?.[commitId] || ser.commitTimings?.[String(commitId)] || null;
        // Bundles before the adapter seam serialize only `atlByCommit`.
        const metricsMap = ser.metricsByCommit || ser.atlByCommit;
        const metrics = metricsMap?.[commitId] || metricsMap?.[String(commitId)] || null;
        const actions = (ser.interactionsByCommit?.[commitId] || ser.interactionsByCommit?.[String(commitId)] || []) as unknown[];
        const rendered = (ser.renderedByCommit?.[commitId] || ser.renderedByCommit?.[String(commitId)] || []) as unknown[];
        if (!tuple && !sourceIds.length && !timing && !metrics && !actions.length && !rendered.length) {
          return { ok: true, available: true, action, commitId, found: false };
        }
        const sourcesById = new Map<unknown, Record<string, unknown>>();
        const allSources = (ser.sources as unknown as Array<Record<string, unknown>>) || [];
        for (const s of allSources) {
          if (s && s.sourceId != null) sourcesById.set(s.sourceId, s);
        }
        const out: Record<string, unknown> = { commitId, found: true };
        if (include.includes('stats')) out.stats = tupleToStats(tuple);
        if (include.includes('sources')) {
          const entries = Array.isArray(sourceIds) ? sourceIds : [];
          const slice = entries.slice(0, maxItems).map((entry) => {
            const e = entry as { sourceId?: unknown; collateral?: unknown; rank?: unknown; trashers?: unknown } | unknown;
            const sid = (typeof e === 'object' && e !== null && 'sourceId' in (e as object))
              ? (e as { sourceId: unknown }).sourceId
              : entry;
            const s = sourcesById.get(sid);
            return s
              ? {
                  sourceId: s.sourceId,
                  depth: s.depth,
                  collateralAtCommit: (typeof e === 'object' && e !== null && 'collateral' in (e as object)) ? (e as { collateral: unknown }).collateral : null,
                  rankAtCommit: (typeof e === 'object' && e !== null && 'rank' in (e as object)) ? (e as { rank: unknown }).rank : null,
                  trashers: (typeof e === 'object' && e !== null && 'trashers' in (e as object)) ? (e as { trashers: unknown }).trashers : undefined,
                  causedUpdatesTotal: s.causedUpdates,
                  collateralUpdatesTotal: s.collateralUpdates,
                }
              : { sourceId: sid, missing: true };
          });
          out.sources = slice;
          out.sourcesTotal = entries.length;
        }
        if (include.includes('timing')) out.timing = timing;
        if (include.includes('metrics')) out.metrics = metrics;
        if (include.includes('atl')) out.atl = metrics;
        if (include.includes('actions')) {
          out.actions = actions.slice(0, maxItems);
          out.actionsTotal = actions.length;
        }
        if (include.includes('rendered')) {
          out.rendered = rendered.slice(0, maxItems);
          out.renderedTotal = rendered.length;
        }
        if (include.includes('unmounts')) {
          // Live identity samples live on the raw report (not in DTO/export).
          const raw = (r.raw || {}) as { unmountsByCommit?: Record<number | string, unknown> };
          const samples = (raw.unmountsByCommit?.[commitId] || raw.unmountsByCommit?.[String(commitId)] || null) as
            | Array<{ name: string; key: string | null; depth: number | null; count: number; source?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null }>
            | null;
          out.unmounts = samples ? samples.slice(0, maxItems) : [];
          out.unmountsTotal = Array.isArray(samples) ? samples.length : 0;
        }
        return { ok: true, available: true, action, payload: out };
      }
      case 'describe-action': {
        const actionId = Number(command?.actionId);
        if (!Number.isFinite(actionId)) {
          return { ok: false, available: true, action, error: 'describe-action requires numeric actionId' };
        }
        const r = getReport(api);
        if (!r || 'error' in r) {
          return { ok: false, available: true, action, error: (r && 'error' in r ? r.error : 'report() unavailable') };
        }
        const ser = (r.serial || {}) as Record<string, Record<string, unknown>>;
        const byCommit = ser.interactionsByCommit || {};
        for (const [commitId, items] of Object.entries(byCommit)) {
          const actions = Array.isArray(items) ? items : [];
          const found = actions.find((item: any) => Number(item?.id) === actionId);
          if (found) {
            return {
              ok: true,
              available: true,
              action,
              payload: { actionId, commitId: Number(commitId), found: true, action: found },
            };
          }
        }
        return { ok: true, available: true, action, payload: { actionId, found: false } };
      }
      case 'commit-list': {
        const top = Number.isFinite(Number(command?.top)) ? Math.max(1, Math.floor(Number(command!.top))) : 20;
        const by = String(command?.by || 'collateral');
        const allowedKeys: string[] = (UPSTREAM_COMMIT_STAT_KEYS as readonly string[]).concat(['sources', 'ticks']);
        if (!allowedKeys.includes(by)) {
          return {
            ok: false,
            available: true,
            action,
            error: 'unsupported commit-list sort key: ' + by,
            validBy: allowedKeys,
          };
        }
        const sortKey = by;
        const r = getReport(api);
        if (!r || 'error' in r) {
          return { ok: false, available: true, action, error: (r && 'error' in r ? r.error : 'report() unavailable') };
        }
        const ser = (r.serial || {}) as Record<string, Record<string, unknown>>;
        const stats = ser.commitStats || {};
        const sourcesByCommit = ser.sourcesByCommit || {};
        const ids = Object.keys(stats);
        const rows = ids.map((id) => {
          const tuple = stats[id];
          const stat = tupleToStats(tuple);
          const srcs = sourcesByCommit[id] as unknown;
          const sourceCount = Array.isArray(srcs)
            ? srcs.length
            : srcs && typeof srcs === 'object'
              ? Object.keys(srcs).length
              : 0;
          const actions = (ser.interactionsByCommit?.[id] || []) as unknown[];
          const timing = ser.commitTimings?.[id] as { ticks?: unknown } | undefined;
          // null when the build exposes no render-slice signal (meta.renderTicks).
          const ticks = typeof timing?.ticks === 'number' ? timing.ticks : null;
          return { commitId: Number(id), stat, sourceCount, ticks, latestAction: actions.length ? compactLatestAction(actions[actions.length - 1]) : null };
        });
        const sortValue = (row: typeof rows[number]): number => {
          if (sortKey === 'sources') return row.sourceCount || 0;
          if (sortKey === 'ticks') return row.ticks ?? -1;
          return row.stat?.[sortKey] || 0;
        };
        rows.sort((a, b) => sortValue(b) - sortValue(a));
        return { ok: true, available: true, action, by: sortKey, total: rows.length, rows: rows.slice(0, top) };
      }
      // Removed: start, stop, metrics, help — not present on the current public surface.
      default:
        return { ok: false, available: true, action, error: 'Unknown avalanche action: ' + action };
    }
  } catch (error) {
    return { ok: false, available: true, action, error: (error as { message?: string })?.message || String(error) };
  }
}

// ─── Production names ────────────────────────────────────────────────────

/** Default time budget for recovering production names before a report. */
export const AVALANCHE_NAME_BUDGET_MS = 3000;

/**
 * Recover authored names for the component types Avalanche recorded, so
 * report source ids read `ProjectList#1@3` rather than a minified name on
 * production builds. Call before `evalAvalanche` on production pages only.
 */
export function warmAvalancheNames(
  api: AvalancheApi | null | undefined,
  budgetMs = AVALANCHE_NAME_BUDGET_MS,
): Promise<NameRecoveryStats | null> {
  let types: unknown[] = [];
  try {
    types = api?.componentTypes?.() ?? [];
  } catch {
    types = [];
  }
  return types.length ? warmComponentTypes(types, budgetMs) : Promise.resolve(null);
}
