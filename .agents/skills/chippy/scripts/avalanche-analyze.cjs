#!/usr/bin/env node
// Generated from src/avalanche/offline-cli.ts by `yarn chippy:mcp:build`; do not edit.

// src/avalanche/offline-cli.ts
var import_node_fs = require("node:fs");

// src/chippy-bridge/avalanche-commands.ts
var UPSTREAM_COMMIT_STAT_KEYS = [
  "collateral",
  "sources",
  "restarts",
  "performedWork",
  "effects",
  "memos",
  "callbacks",
  "contextUpdates",
  "unmountedComponents",
  "unmountedSubtrees"
];
function tupleToStats(tuple) {
  if (!Array.isArray(tuple)) return null;
  const out = {};
  for (let i = 0; i < UPSTREAM_COMMIT_STAT_KEYS.length; i++) {
    out[UPSTREAM_COMMIT_STAT_KEYS[i]] = Number(tuple[i] || 0);
  }
  return out;
}
function compactLatestAction(action) {
  if (!action || typeof action !== "object") return action ?? null;
  const location = action.location && typeof action.location === "object" ? action.location : {};
  const dom = location.dom && typeof location.dom === "object" ? location.dom : {};
  const targetFiber = location.targetFiber && typeof location.targetFiber === "object" ? location.targetFiber : null;
  const ownerStack = Array.isArray(targetFiber?.ownerStack) ? targetFiber.ownerStack : [];
  return {
    lastCommitId: Number(action.lastCommitId ?? 0),
    deltaTime: Number(action.deltaTime ?? 0),
    action: typeof action.action === "string" ? action.action : null,
    dom: {
      tag: typeof dom.tag === "string" ? dom.tag : null,
      text: typeof dom.text === "string" ? dom.text : "",
      nearestTestId: typeof dom.nearestTestId === "string" ? dom.nearestTestId : null
    },
    targetFiber: targetFiber ? {
      name: typeof targetFiber.name === "string" ? targetFiber.name : null,
      key: targetFiber.key ?? null,
      ownerStackKind: targetFiber.ownerStackKind === "parents" ? "parents" : "owners",
      ownerNames: ownerStack.map((entry) => entry && typeof entry.name === "string" ? entry.name : null).filter(Boolean).slice(0, 10),
      ownerCount: ownerStack.length
    } : null
  };
}
function getReport(api) {
  if (!api || typeof api.report !== "function") return null;
  try {
    const r = api.report();
    if (r && typeof r.toSerializable === "function") {
      return { raw: r, serial: r.toSerializable() };
    }
    return { raw: r, serial: r };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
function readAvalancheStatus(api, mod) {
  if (!api || typeof api.status !== "function") {
    return {
      ok: false,
      available: !!mod,
      error: "__AVALANCHE__ API not available",
      moduleKeys: mod ? Object.keys(mod) : null
    };
  }
  try {
    const status = api.status();
    return { ok: true, available: true, status };
  } catch (e) {
    return { ok: false, available: true, error: e?.message || String(e) };
  }
}
function evalAvalanche(command, api, mod) {
  const action = String(command?.action || "status");
  if (!api) {
    return { ok: false, available: false, action, error: "__AVALANCHE__ not available" };
  }
  try {
    switch (action) {
      case "install": {
        const opts = command && typeof command.options === "object" ? command.options : void 0;
        const res = api.install?.(opts);
        return { ok: true, available: true, action, result: res, status: readAvalancheStatus(api, mod).status };
      }
      case "uninstall":
        api.uninstall?.();
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case "reset":
      case "clear":
        api.reset?.();
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case "status":
        return { ok: true, available: true, action, status: readAvalancheStatus(api, mod).status };
      case "export": {
        const r = getReport(api);
        if (!r) return { ok: false, available: true, action, error: "report() unavailable" };
        if ("error" in r) return { ok: false, available: true, action, error: r.error };
        return { ok: true, available: true, action, payload: r.serial };
      }
      case "export-last": {
        const count = Number(command?.count);
        const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
        let res;
        try {
          res = api.exportLast?.(n);
        } catch (e) {
          return { ok: false, available: true, action, error: e?.message || String(e) };
        }
        if (res && typeof res.toSerializable === "function") {
          res = res.toSerializable();
        }
        return { ok: true, available: true, action, count: n, payload: res };
      }
      case "debug-hook": {
        const sourceId = String(command?.sourceId || "");
        const hookIndex = Number(command?.hookIndex);
        const windowSize = Number(command?.window);
        if (!sourceId || !Number.isFinite(hookIndex)) {
          return { ok: false, available: true, action, error: "debug-hook requires sourceId and numeric hookIndex" };
        }
        if (typeof api.debugHook !== "function") {
          return { ok: false, available: true, action, error: "debugHook() unavailable on __AVALANCHE__ API" };
        }
        const payload = api.debugHook(
          sourceId,
          Math.floor(hookIndex),
          Number.isFinite(windowSize) ? Math.max(0, Math.floor(windowSize)) : void 0
        );
        return { ok: true, available: true, action, payload };
      }
      case "hot-sources": {
        const limit = Number(command?.limit);
        const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const sources = Array.isArray(r.serial.sources) ? r.serial.sources : [];
        const items = sources.slice().sort((a, b) => Number(b?.collateralUpdates || 0) - Number(a?.collateralUpdates || 0)).slice(0, n).map((s) => ({
          sourceId: s?.sourceId ?? null,
          depth: Number(s?.depth || 0),
          causedUpdates: Number(s?.causedUpdates || 0),
          collateralUpdates: Number(s?.collateralUpdates || 0),
          maxCollateralUpdates: Number(s?.maxCollateralUpdates || 0),
          maxPenetrationDepth: Number(s?.maxPenetrationDepth || 0),
          restartWaste: Number(s?.restartWaste || 0)
        }));
        return { ok: true, available: true, action, total: sources.length, payload: { count: items.length, items } };
      }
      case "commit-peek": {
        const commitId = Number(command?.commitId);
        if (!Number.isFinite(commitId)) {
          return { ok: false, available: true, action, error: "commit-peek requires numeric commitId" };
        }
        const include = Array.isArray(command?.include) && command.include.length ? command.include : ["stats", "sources", "timing", "metrics"];
        const allowedInclude = ["stats", "sources", "timing", "metrics", "atl", "unmounts", "actions", "rendered"];
        const invalidInclude = include.filter((key) => !allowedInclude.includes(key));
        if (invalidInclude.length) {
          return {
            ok: false,
            available: true,
            action,
            error: "unsupported commit-peek include value(s): " + invalidInclude.join(","),
            validInclude: allowedInclude
          };
        }
        const maxItems = Number.isFinite(Number(command?.maxItems)) ? Math.max(1, Math.floor(Number(command.maxItems))) : 50;
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const ser = r.serial || {};
        const tuple = ser.commitStats?.[commitId] || ser.commitStats?.[String(commitId)] || null;
        const sourceIds = ser.sourcesByCommit?.[commitId] || ser.sourcesByCommit?.[String(commitId)] || [];
        const timing = ser.commitTimings?.[commitId] || ser.commitTimings?.[String(commitId)] || null;
        const metricsMap = ser.metricsByCommit || ser.atlByCommit;
        const metrics = metricsMap?.[commitId] || metricsMap?.[String(commitId)] || null;
        const actions = ser.interactionsByCommit?.[commitId] || ser.interactionsByCommit?.[String(commitId)] || [];
        const rendered = ser.renderedByCommit?.[commitId] || ser.renderedByCommit?.[String(commitId)] || [];
        if (!tuple && !sourceIds.length && !timing && !metrics && !actions.length && !rendered.length) {
          return { ok: true, available: true, action, commitId, found: false };
        }
        const sourcesById = /* @__PURE__ */ new Map();
        const allSources = ser.sources || [];
        for (const s of allSources) {
          if (s && s.sourceId != null) sourcesById.set(s.sourceId, s);
        }
        const out = { commitId, found: true };
        if (include.includes("stats")) out.stats = tupleToStats(tuple);
        if (include.includes("sources")) {
          const entries = Array.isArray(sourceIds) ? sourceIds : [];
          const slice = entries.slice(0, maxItems).map((entry) => {
            const e = entry;
            const sid = typeof e === "object" && e !== null && "sourceId" in e ? e.sourceId : entry;
            const s = sourcesById.get(sid);
            return s ? {
              sourceId: s.sourceId,
              depth: s.depth,
              collateralAtCommit: typeof e === "object" && e !== null && "collateral" in e ? e.collateral : null,
              rankAtCommit: typeof e === "object" && e !== null && "rank" in e ? e.rank : null,
              trashers: typeof e === "object" && e !== null && "trashers" in e ? e.trashers : void 0,
              causedUpdatesTotal: s.causedUpdates,
              collateralUpdatesTotal: s.collateralUpdates
            } : { sourceId: sid, missing: true };
          });
          out.sources = slice;
          out.sourcesTotal = entries.length;
        }
        if (include.includes("timing")) out.timing = timing;
        if (include.includes("metrics")) out.metrics = metrics;
        if (include.includes("atl")) out.atl = metrics;
        if (include.includes("actions")) {
          out.actions = actions.slice(0, maxItems);
          out.actionsTotal = actions.length;
        }
        if (include.includes("rendered")) {
          out.rendered = rendered.slice(0, maxItems);
          out.renderedTotal = rendered.length;
        }
        if (include.includes("unmounts")) {
          const raw = r.raw || {};
          const samples = raw.unmountsByCommit?.[commitId] || raw.unmountsByCommit?.[String(commitId)] || null;
          out.unmounts = samples ? samples.slice(0, maxItems) : [];
          out.unmountsTotal = Array.isArray(samples) ? samples.length : 0;
        }
        return { ok: true, available: true, action, payload: out };
      }
      case "describe-action": {
        const actionId = Number(command?.actionId);
        if (!Number.isFinite(actionId)) {
          return { ok: false, available: true, action, error: "describe-action requires numeric actionId" };
        }
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const ser = r.serial || {};
        const byCommit = ser.interactionsByCommit || {};
        for (const [commitId, items] of Object.entries(byCommit)) {
          const actions = Array.isArray(items) ? items : [];
          const found = actions.find((item) => Number(item?.id) === actionId);
          if (found) {
            return {
              ok: true,
              available: true,
              action,
              payload: { actionId, commitId: Number(commitId), found: true, action: found }
            };
          }
        }
        return { ok: true, available: true, action, payload: { actionId, found: false } };
      }
      case "commit-list": {
        const top = Number.isFinite(Number(command?.top)) ? Math.max(1, Math.floor(Number(command.top))) : 20;
        const by = String(command?.by || "collateral");
        const allowedKeys = UPSTREAM_COMMIT_STAT_KEYS.concat(["sources", "ticks"]);
        if (!allowedKeys.includes(by)) {
          return {
            ok: false,
            available: true,
            action,
            error: "unsupported commit-list sort key: " + by,
            validBy: allowedKeys
          };
        }
        const sortKey = by;
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const ser = r.serial || {};
        const stats = ser.commitStats || {};
        const sourcesByCommit = ser.sourcesByCommit || {};
        const ids = Object.keys(stats);
        const rows = ids.map((id) => {
          const tuple = stats[id];
          const stat = tupleToStats(tuple);
          const srcs = sourcesByCommit[id];
          const sourceCount = Array.isArray(srcs) ? srcs.length : srcs && typeof srcs === "object" ? Object.keys(srcs).length : 0;
          const actions = ser.interactionsByCommit?.[id] || [];
          const timing = ser.commitTimings?.[id];
          const ticks = typeof timing?.ticks === "number" ? timing.ticks : null;
          return { commitId: Number(id), stat, sourceCount, ticks, latestAction: actions.length ? compactLatestAction(actions[actions.length - 1]) : null };
        });
        const sortValue = (row) => {
          if (sortKey === "sources") return row.sourceCount || 0;
          if (sortKey === "ticks") return row.ticks ?? -1;
          return row.stat?.[sortKey] || 0;
        };
        rows.sort((a, b) => sortValue(b) - sortValue(a));
        return { ok: true, available: true, action, by: sortKey, total: rows.length, rows: rows.slice(0, top) };
      }
      // Removed: start, stop, metrics, help — not present on the current public surface.
      default:
        return { ok: false, available: true, action, error: "Unknown avalanche action: " + action };
    }
  } catch (error) {
    return { ok: false, available: true, action, error: error?.message || String(error) };
  }
}

// src/avalanche/offline.ts
var PER_COMMIT_KEYS = [
  "commitStats",
  "suspenseByCommit",
  "sourcesByCommit",
  "interactionsByCommit",
  "renderedByCommit",
  "metricsByCommit",
  "atlByCommit",
  "timing",
  "commitTimings"
];
function isSavedReport(value) {
  const v = value;
  return !!v && typeof v === "object" && !!v.meta && typeof v.commitStats === "object" && v.commitStats !== null;
}
function unwrapSavedReport(value) {
  const candidates = [value, value?.payload, value?.result?.payload, value?.result];
  return candidates.find(isSavedReport) ?? null;
}
function commitIds(report) {
  return Object.keys(report.commitStats).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}
function keepLastCommits(report, count) {
  if (!(count > 0)) return report;
  const keep = new Set(commitIds(report).slice(-count).map(String));
  const out = { ...report };
  for (const key of PER_COMMIT_KEYS) {
    const map = report[key];
    if (!map || typeof map !== "object") continue;
    out[key] = Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
  }
  out.meta = { ...report.meta, keptLastCommits: keep.size };
  return out;
}
function dispatch(report, command) {
  const result = evalAvalanche(command, { report: () => report }, null);
  const { available: _available, ...rest } = result;
  return rest;
}
function summary(report) {
  const totals = Object.fromEntries(UPSTREAM_COMMIT_STAT_KEYS.map((key) => [key, 0]));
  for (const tuple of Object.values(report.commitStats)) {
    const stats = tupleToStats(tuple);
    if (!stats) continue;
    for (const key of UPSTREAM_COMMIT_STAT_KEYS) totals[key] += stats[key];
  }
  const ids = commitIds(report);
  return {
    ok: true,
    action: "summary",
    commits: ids.length,
    firstCommitId: ids[0] ?? null,
    lastCommitId: ids.at(-1) ?? null,
    sources: report.sources?.length ?? 0,
    totals,
    meta: report.meta
  };
}
function sourceSearch(report, options) {
  let pattern;
  try {
    pattern = new RegExp(options.name, "i");
  } catch (error) {
    return { ok: false, action: "source-search", error: `invalid --name pattern: ${error.message}` };
  }
  const top = options.top && options.top > 0 ? options.top : 50;
  const sources = (report.sources ?? []).filter((source) => pattern.test(String(source.sourceId ?? "")));
  const rendered = /* @__PURE__ */ new Map();
  const renderedByCommit = report.renderedByCommit ?? {};
  for (const [commitId, entries] of Object.entries(renderedByCommit)) {
    for (const entry of entries ?? []) {
      if (!pattern.test(String(entry?.name ?? ""))) continue;
      const row = rendered.get(entry.sourceId) ?? { name: entry.name, renders: 0, selfSource: 0, commits: [] };
      row.renders += 1;
      if (entry.isSelfSource) row.selfSource += 1;
      row.commits.push(Number(commitId));
      rendered.set(entry.sourceId, row);
    }
  }
  const renderedRows = [...rendered.entries()].map(([sourceId, row]) => ({ sourceId, ...row, commits: row.commits.slice(0, 20) })).sort((a, b) => b.renders - a.renders);
  return {
    ok: true,
    action: "source-search",
    name: options.name,
    sourcesTotal: sources.length,
    sources: sources.slice(0, top),
    renderedAvailable: Object.keys(renderedByCommit).length > 0,
    renderedTotal: renderedRows.length,
    rendered: renderedRows.slice(0, top)
  };
}
function analyzeSavedReport(report, command, args) {
  const positional = args._;
  const number = (flag, index) => {
    const value = Number(args[flag] ?? positional[index]);
    return Number.isFinite(value) ? value : void 0;
  };
  switch (command) {
    case "summary":
      return summary(report);
    case "commit-list":
      return dispatch(report, { action: "commit-list", top: number("top", 0), by: String(args.by ?? positional[1] ?? "collateral") });
    case "commit-peek": {
      const include = String(args.include ?? positional[1] ?? "");
      return dispatch(report, {
        action: "commit-peek",
        commitId: number("commitId", 0),
        include: include ? include.split(",").map((item) => item.trim()).filter(Boolean) : void 0,
        maxItems: number("maxItems", 2)
      });
    }
    case "hot-sources":
      return dispatch(report, { action: "hot-sources", limit: number("limit", 0) });
    case "describe-action":
      return dispatch(report, { action: "describe-action", actionId: number("actionId", 0) });
    case "source-search": {
      const name = args.name ?? positional[0];
      if (typeof name !== "string" || !name) return { ok: false, action: "source-search", error: "source-search requires --name <regex>" };
      return sourceSearch(report, { name, top: number("top", 1) });
    }
    default:
      return { ok: false, action: command, error: `unknown offline command: ${command}` };
  }
}

// src/avalanche/offline-cli.ts
var USAGE = `Usage: avalanche-analyze.cjs <file> <command> [args]

Commands:
  summary
  commit-list   [top] [by]                  (--top N --by KEY)
  commit-peek   <commitId> [include] [max]  (--include csv --maxItems N)
  hot-sources   [limit]
  describe-action <actionId>
  source-search --name <regex> [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks
commit-peek include values: stats,sources,timing,metrics,actions,rendered (atl: deprecated alias of metrics)
`;
function fail(message) {
  process.stderr.write(`avalanche-analyze: ${message}
`);
  process.exit(2);
}
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--")) args[arg.slice(2)] = argv[++i];
    else args[arg.slice(2)] = true;
  }
  return args;
}
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`invalid JSON in ${label}: ${error.message}`);
  }
}
function main(argv) {
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (argv[0] === "normalize") {
    const report2 = unwrapSavedReport(parseJson((0, import_node_fs.readFileSync)(0, "utf8"), "helper response"));
    if (!report2) fail("response has no Avalanche export (expected meta and commitStats); check avalanche-status");
    const trimmed = keepLastCommits(report2, Number(argv[1]) || 0);
    process.stdout.write(JSON.stringify(trimmed));
    return;
  }
  const [file, command, ...rest] = argv;
  if (!command) fail("command missing");
  const report = unwrapSavedReport(parseJson((0, import_node_fs.readFileSync)(file, "utf8"), file));
  if (!report) fail(`${file} is not an Avalanche export (expected meta and commitStats)`);
  const result = analyzeSavedReport(report, command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  if (result.ok === false) process.exitCode = 1;
}
main(process.argv.slice(2));
