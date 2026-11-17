#!/usr/bin/env node
// Generated from src/avalanche/offline-cli.ts by `yarn chippy:mcp:build`; do not edit.

// src/avalanche/offline-cli.ts
var import_node_fs = require("node:fs");

// src/chippy-bridge/source-map.ts
var DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var VALUE_OF = new Int8Array(128).fill(-1);
for (let index = 0; index < DIGITS.length; index += 1) {
  VALUE_OF[DIGITS.charCodeAt(index)] = index;
}

// src/chippy-bridge/component-occurrence.ts
var IDENTIFIER = "[A-Za-z_$][\\w$]*";
var OWN_FUNCTION_NAME = new RegExp(`^(?:async\\s*)?function\\s*\\*?\\s*(${IDENTIFIER})\\s*\\(`);
var OWN_CLASS_NAME = new RegExp(`^class\\s+(${IDENTIFIER})(?=[\\s{])`);
var AUTHORED_OWN_NAME = new RegExp(
  `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)(${IDENTIFIER})`
);
var CALLEE = `(?:\\(\\s*0\\s*,\\s*${IDENTIFIER}(?:\\.${IDENTIFIER})*\\s*\\)|${IDENTIFIER}(?:\\.${IDENTIFIER})*)`;
var GENERATED_BINDING = new RegExp(`(${IDENTIFIER})\\s*[=:]\\s*(?:${CALLEE}\\s*\\(\\s*)*$`);
var AUTHORED_BINDING = new RegExp(
  `(?:^|[^\\w$.])(${IDENTIFIER})\\s*(?::[^=;{}()]*)?=\\s*(?:${CALLEE}\\s*(?:<[^()]*>)?\\s*\\(\\s*)*$`
);
var LEADING_IDENTIFIER = new RegExp(`^${IDENTIFIER}`);

// src/avalanche/network-signals.ts
var DEFAULT_NETWORK_WINDOW_MS = 250;
var NETWORK_SORT_KEYS = ["start", "end", "duration"];
var round = (value) => Math.round(value * 10) / 10;
function commitAnchors(commitTimings) {
  const anchors = [];
  for (const [id, timing] of Object.entries(commitTimings ?? {})) {
    const commitStart2 = Number(timing?.startTime);
    const commitEnd = Number(timing?.endTime);
    if (!Number.isFinite(commitStart2) || !Number.isFinite(commitEnd)) continue;
    const renderStart = Number(timing?.render?.renderStart);
    const renderStartKnown = Number.isFinite(renderStart) && renderStart <= commitStart2;
    anchors.push({
      commitId: Number(id),
      renderStart: renderStartKnown ? renderStart : commitStart2,
      renderStartKnown,
      commitStart: commitStart2,
      commitEnd
    });
  }
  return anchors.sort((a, b) => a.commitStart - b.commitStart);
}
function firstAtOrAfter(anchors, value, key) {
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (anchors[mid][key] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function linkRequest(request, anchors, windowMs) {
  const { startTime, endTime } = request;
  const afterIndex = firstAtOrAfter(anchors, startTime, "commitEnd") - 1;
  const after = afterIndex >= 0 ? anchors[afterIndex] : null;
  const startedAfter = after && startTime - after.commitEnd <= windowMs ? { commitId: after.commitId, gapMs: round(startTime - after.commitEnd) } : null;
  const rendering = anchors[firstAtOrAfter(anchors, startTime, "commitStart")];
  const startedDuringRender = rendering && rendering.renderStartKnown && rendering.renderStart <= startTime ? rendering.commitId : null;
  let landedBefore = null;
  for (let i = firstAtOrAfter(anchors, endTime, "commitStart"); i < anchors.length; i++) {
    const anchor = anchors[i];
    if (anchor.renderStart - endTime > windowMs) break;
    if (anchor.renderStart >= endTime) {
      landedBefore = { commitId: anchor.commitId, gapMs: round(anchor.renderStart - endTime) };
      break;
    }
  }
  const commitsInFlight = firstAtOrAfter(anchors, endTime, "commitStart") - firstAtOrAfter(anchors, startTime, "commitStart");
  return { startedAfter, startedDuringRender, landedBefore, commitsInFlight: Math.max(0, commitsInFlight) };
}
function requestsOf(report) {
  return Array.isArray(report.networkRequests) ? report.networkRequests : [];
}
function windowOf(windowMs) {
  const value = Number(windowMs);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NETWORK_WINDOW_MS;
}
function linkNetworkRequests(report, windowMs) {
  const anchors = commitAnchors(report.commitTimings);
  const window = windowOf(windowMs);
  return requestsOf(report).map((request) => ({ ...request, ...linkRequest(request, anchors, window) }));
}
function networkView(report, options = {}) {
  const by = String(options.by || "start");
  if (!NETWORK_SORT_KEYS.includes(by)) {
    return { ok: false, error: "unsupported network sort key: " + by, validBy: NETWORK_SORT_KEYS };
  }
  let pattern = null;
  if (typeof options.match === "string" && options.match) {
    try {
      pattern = new RegExp(options.match, "i");
    } catch (error) {
      return { ok: false, error: "invalid match pattern: " + error.message };
    }
  }
  const initiators = Array.isArray(options.initiators) ? options.initiators.map((value) => String(value).trim().toLowerCase()).filter(Boolean) : [];
  const top = Number.isFinite(Number(options.top)) && Number(options.top) > 0 ? Math.floor(Number(options.top)) : 20;
  const windowMs = windowOf(options.window);
  const linked = linkNetworkRequests(report, windowMs).filter((request) => (!pattern || pattern.test(request.url)) && (initiators.length === 0 || initiators.includes(request.initiatorType.toLowerCase())));
  const byInitiator = {};
  let landedBeforeCommit = 0;
  let startedAfterCommit = 0;
  let startedDuringRender = 0;
  let longest = null;
  for (const request of linked) {
    byInitiator[request.initiatorType] = (byInitiator[request.initiatorType] || 0) + 1;
    if (request.landedBefore) landedBeforeCommit += 1;
    if (request.startedAfter) startedAfterCommit += 1;
    if (request.startedDuringRender !== null) startedDuringRender += 1;
    if (!longest || request.duration > longest.duration) longest = request;
  }
  const sorted = linked.slice().sort((a, b) => by === "duration" ? b.duration - a.duration : by === "end" ? a.endTime - b.endTime : a.startTime - b.startTime);
  return {
    ok: true,
    payload: {
      available: Array.isArray(report.networkRequests),
      capture: report.meta?.network ?? null,
      windowMs,
      by,
      total: linked.length,
      summary: {
        byInitiator,
        landedBeforeCommit,
        startedAfterCommit,
        startedDuringRender,
        longest: longest ? { id: longest.id, url: longest.url, duration: longest.duration } : null
      },
      rows: sorted.slice(0, top)
    }
  };
}
function networkByCommit(report, windowMs) {
  const out = /* @__PURE__ */ new Map();
  const entry = (commitId) => {
    let value = out.get(commitId);
    if (!value) {
      value = { landedBefore: [], startedAfter: [], startedDuringRender: [], inFlight: 0 };
      out.set(commitId, value);
    }
    return value;
  };
  const linked = linkNetworkRequests(report, windowMs);
  for (const request of linked) {
    if (request.landedBefore) entry(request.landedBefore.commitId).landedBefore.push(request);
    if (request.startedAfter) entry(request.startedAfter.commitId).startedAfter.push(request);
    if (request.startedDuringRender !== null) entry(request.startedDuringRender).startedDuringRender.push(request);
  }
  const anchors = commitAnchors(report.commitTimings);
  for (const anchor of anchors) {
    const inFlight = linked.filter((request) => request.startTime <= anchor.commitStart && request.endTime >= anchor.commitStart).length;
    if (inFlight > 0) entry(anchor.commitId).inFlight = inFlight;
  }
  return out;
}

// src/avalanche/timeline.ts
var round2 = (n) => Math.round(n);
function requestLabel(url) {
  try {
    const parsed = new URL(url, "http://local.invalid");
    const op = parsed.searchParams.get("operation") || parsed.searchParams.get("operationName") || parsed.searchParams.get("opName");
    if (op) return op;
    const segments = parsed.pathname.split("/").filter((s) => s && !/^[0-9a-f]{16,}$/i.test(s) && !/^\d+$/.test(s));
    const tail = segments.slice(-2).join("/") || parsed.pathname;
    return parsed.host === "local.invalid" ? tail : parsed.host + " \u2026/" + tail;
  } catch (_) {
    return url.slice(0, 60);
  }
}
function commitStart(report, id) {
  const start = Number(report.commitTimings?.[String(id)]?.startTime);
  return Number.isFinite(start) ? start : null;
}
function renderedCount(report, id) {
  const fromStats = Number(report.commitStats?.[String(id)]?.[3] || 0);
  if (fromStats > 0) return fromStats;
  const list = report.renderedByCommit?.[String(id)];
  return Array.isArray(list) ? list.length : 0;
}
function kindOf(events) {
  const enters = events.some((e) => e.entered);
  const leaves = events.some((e) => e.left);
  return enters && leaves ? "swap" : enters ? "lock" : leaves ? "unlock" : "update";
}
function buildTimeline(report, options = {}) {
  const ids = Object.keys(report.commitTimings ?? {}).map(Number).filter((id) => Number.isFinite(id) && commitStart(report, id) !== null).sort((a, b) => a - b);
  if (ids.length === 0) return { ok: false, error: "report has no commit timings (report version 6 or later is required)" };
  const startOf = (id) => commitStart(report, id);
  const interactions = /* @__PURE__ */ new Map();
  for (const list of Object.values(report.interactionsByCommit ?? {})) {
    for (const item of list || []) {
      const t = Number(item.timestamp);
      if (!Number.isFinite(t)) continue;
      const key = String(item.id ?? "") + "@" + t;
      const dom = item.location?.dom;
      const target = dom ? String(dom.nearestTestId || dom.text || dom.tag || "") || null : null;
      if (!interactions.has(key)) interactions.set(key, { t, action: String(item.action || "input"), target });
    }
  }
  const inputs = Array.from(interactions.values()).sort((a, b) => a.t - b.t);
  const firstInput = inputs[0];
  const fromCommit = options.fromCommit ?? (firstInput ? ids.find((id) => startOf(id) >= firstInput.t) ?? ids[0] : ids[0]);
  const toCommit = options.toCommit ?? ids[ids.length - 1];
  const windowIds = ids.filter((id) => id >= fromCommit && id <= toCommit);
  if (windowIds.length === 0) return { ok: false, error: `no commits between ${fromCommit} and ${toCommit}` };
  const windowStart = startOf(windowIds[0]);
  const windowEnd = startOf(windowIds[windowIds.length - 1]);
  const originInput = [...inputs].reverse().find((input2) => input2.t <= windowStart && windowStart - input2.t <= 5e3);
  const origin = originInput ? originInput.t : windowStart;
  const rel = (t) => round2(t - origin);
  const input = inputs.filter((i) => i.t >= origin && i.t <= windowEnd).map((i) => ({ ...i, t: rel(i.t) }));
  let exclude = null;
  try {
    exclude = options.exclude ? new RegExp(options.exclude, "i") : null;
  } catch (_) {
    exclude = null;
  }
  const minRequestMs = options.minRequestMs ?? 50;
  const inWindow = (report.networkRequests ?? []).filter((r) => r.endTime >= origin && r.startTime <= windowEnd && !(exclude && exclude.test(r.url)));
  const toRequest = (r) => ({
    id: r.id,
    label: requestLabel(r.url),
    start: rel(r.startTime),
    end: rel(r.endTime),
    durationMs: round2(r.duration),
    initiatorType: r.initiatorType,
    cached: !!r.cached
  });
  const drawable = inWindow.filter((r) => r.duration >= minRequestMs);
  const kept = [...drawable].sort((a, b) => b.duration - a.duration).slice(0, options.maxRequests ?? 30).sort((a, b) => a.startTime - b.startTime);
  const network = kept.map(toRequest);
  const open = /* @__PURE__ */ new Map();
  const suspense = [];
  for (const id of ids.filter((commit) => commit <= windowIds[windowIds.length - 1])) {
    for (const event of report.suspenseByCommit?.[String(id)] ?? []) {
      const depth = Number(event.depth);
      if (!Number.isFinite(depth)) continue;
      if (event.entered) open.set(depth, [...open.get(depth) || [], id]);
      if (event.left) {
        const enteredId = open.get(depth)?.shift();
        if (enteredId === void 0) continue;
        if (startOf(id) >= windowStart && startOf(enteredId) <= windowEnd) {
          suspense.push({ depth, start: rel(startOf(enteredId)), end: rel(startOf(id)), enteredAt: enteredId, leftAt: id });
        }
      }
    }
  }
  for (const [depth, stack] of open) {
    for (const enteredId of stack) {
      if (startOf(enteredId) <= windowEnd) suspense.push({ depth, start: rel(startOf(enteredId)), end: null, enteredAt: enteredId, leftAt: null });
    }
  }
  suspense.sort((a, b) => a.start - b.start || a.depth - b.depth);
  const allCommits = windowIds.map((id) => {
    const events = report.suspenseByCommit?.[String(id)] ?? [];
    const renderStart = Number(report.commitTimings?.[String(id)]?.render?.renderStart);
    const sources = (report.sourcesByCommit?.[String(id)] ?? []).slice().sort((a, b) => Number(b.collateral || 0) - Number(a.collateral || 0)).map((s) => String(s.sourceId || "").split("#")[0]).filter(Boolean);
    return {
      commitId: id,
      t: rel(startOf(id)),
      renderStart: Number.isFinite(renderStart) && renderStart <= startOf(id) ? rel(renderStart) : null,
      rendered: renderedCount(report, id),
      kind: kindOf(events),
      suspense: events.map((e) => (e.entered ? "enter" : "leave") + "@" + e.depth),
      sources: Array.from(new Set(sources)).slice(0, 2)
    };
  });
  const updates = allCommits.filter((c) => c.kind === "update");
  const topUpdates = new Set([...updates].filter((c) => c.rendered > 0).sort((a, b) => b.rendered - a.rendered).slice(0, options.maxCommits ?? 25).map((c) => c.commitId));
  const commits = allCommits.filter((c) => c.kind !== "update" || topUpdates.has(c.commitId));
  const sumUpdates = (list) => ({ commits: list.length, rendered: list.reduce((n, c) => n + c.rendered, 0) });
  const allRequests = inWindow.map(toRequest);
  const waits = suspense.map((s) => {
    const until = s.end ?? rel(windowEnd);
    const lastRequests = allRequests.filter((r) => r.end <= until && r.end >= s.start).sort((a, b) => b.end - a.end).slice(0, 3).map((r) => ({ label: r.label, end: r.end, gapMs: until - r.end }));
    return {
      depth: s.depth,
      from: s.start,
      until: s.end,
      waitedMs: until - s.start,
      lockedBy: s.enteredAt,
      unlockedBy: s.leftAt,
      lastRequests: s.end === null ? [] : lastRequests,
      updatesDuring: sumUpdates(updates.filter((c) => c.t > s.start && c.t < until))
    };
  }).sort((a, b) => b.waitedMs - a.waitedMs);
  const nextInput = input.find((i) => i.t > 0);
  const ownWaits = suspense.filter((s) => !nextInput || s.start < nextInput.t);
  const stillWaiting = ownWaits.filter((s) => s.end === null).map((s) => s.depth);
  const unlocks = ownWaits.filter((s) => s.end !== null).map((s) => s.end);
  const settledAt = stillWaiting.length === 0 && unlocks.length ? Math.max(...unlocks) : null;
  const result = {
    ok: true,
    origin: { at: Math.round(origin * 10) / 10, kind: originInput ? "interaction" : "commit" },
    window: { fromCommit: windowIds[0], toCommit: windowIds[windowIds.length - 1], start: rel(windowStart), end: rel(windowEnd) },
    perceived: {
      firstLockAt: suspense.length ? suspense[0].start : null,
      settledAt,
      stillWaiting,
      waits,
      updatesAfterSettled: sumUpdates(settledAt === null ? [] : updates.filter((c) => c.t > settledAt && (!nextInput || c.t < nextInput.t)))
    },
    lanes: { input, network, suspense, commits },
    omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length },
    mermaid: "",
    text: ""
  };
  result.mermaid = renderMermaid(result);
  result.text = renderText(result);
  return result;
}
var safe = (s) => s.replace(/[:#;]/g, " ").replace(/\s+/g, " ").trim();
function renderMermaid(result) {
  const { input, network, suspense, commits } = result.lanes;
  const end = result.window.end;
  const slow = new Set([...network].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3).map((r) => r.id));
  const updates = commits.filter((c) => c.kind === "update");
  const heavy = new Set([...updates].sort((a, b) => b.rendered - a.rendered).slice(0, 3).filter((c) => c.rendered > 0).map((c) => c.commitId));
  const bar = (start, stop) => `${start}, ${Math.max(stop, start + 1)}`;
  const lines = [
    "gantt",
    `  title Commits ${result.window.fromCommit}\u2013${result.window.toCommit}, ms from ${result.origin.kind === "interaction" ? "the interaction" : "the first commit"}`,
    "  dateFormat x",
    "  axisFormat %S.%L"
  ];
  if (input.length) {
    lines.push("  section Input");
    input.forEach((i, n) => lines.push(`  ${safe(i.action + (i.target ? " " + i.target : ""))} :milestone, in${n}, ${i.t}, ${i.t}`));
  }
  if (network.length) {
    lines.push("  section Network");
    for (const r of network) lines.push(`  ${safe(r.label)} ${r.durationMs}ms :${slow.has(r.id) ? "crit, " : ""}net${r.id}, ${bar(r.start, r.end)}`);
  }
  if (suspense.length) {
    lines.push("  section User waits (fallback shown)");
    suspense.forEach((s, n) => {
      const stop = s.end ?? end;
      const label = s.end === null ? "still waiting" : `${stop - s.start}ms`;
      lines.push(`  @${s.depth} ${label} :${s.end === null ? "active" : "crit"}, sus${n}, ${bar(s.start, stop)}`);
    });
  }
  const screen = commits.filter((c) => c.kind !== "update");
  if (screen.length) {
    lines.push("  section Screen (lock or unlock)");
    for (const c of screen) lines.push(`  c${c.commitId} ${c.kind} ${safe(c.suspense.join(" "))} :milestone, c${c.commitId}, ${c.t}, ${c.t}`);
  }
  if (updates.length) {
    lines.push("  section Updates (CPU, no Suspense change)");
    for (const c of updates) {
      const what = safe(c.sources.join(", "));
      const span = c.renderStart === null ? `milestone, c${c.commitId}, ${c.t}, ${c.t}` : `c${c.commitId}, ${bar(c.renderStart, c.t)}`;
      lines.push(`  c${c.commitId} ${c.rendered} rendered${what ? " " + what : ""} :${heavy.has(c.commitId) ? "crit, " : ""}${span}`);
    }
  }
  return lines.join("\n");
}
function renderText(result) {
  const p = result.perceived;
  const header = [];
  if (p.waits.length === 0) header.push("No Suspense fallback was shown in this window.");
  else {
    header.push(p.settledAt !== null ? `Fallbacks first shown at +${p.firstLockAt}, all cleared at +${p.settledAt}; ${p.updatesAfterSettled.commits} updates (${p.updatesAfterSettled.rendered} rendered) ran after that, before the next input.` : `Fallbacks first shown at +${p.firstLockAt}; still waiting at the end: @${p.stillWaiting.join(", @")}.`);
    for (const w of p.waits.slice(0, 5)) {
      const last = w.lastRequests[0];
      header.push(`  wait @${w.depth} ${w.waitedMs}ms (+${w.from} \u2192 ${w.until === null ? "end" : "+" + w.until}), ${w.updatesDuring.commits} updates (${w.updatesDuring.rendered} rendered) meanwhile` + (last ? `, last request before unlock: ${last.label} (+${last.end}, ${last.gapMs}ms before)` : ""));
    }
  }
  const rows = [];
  for (const i of result.lanes.input) rows.push({ t: i.t, lane: "input", text: i.action + (i.target ? " " + i.target : "") });
  for (const r of result.lanes.network) rows.push({ t: r.start, lane: "net", text: `${r.label}  \u2192 +${r.end} (${r.durationMs}ms${r.cached ? ", cached" : ""})` });
  for (const s of result.lanes.suspense) {
    rows.push({ t: s.start, lane: "wait", text: `fallback @${s.depth} ` + (s.end === null ? "still shown at the end" : `until +${s.end} (${s.end - s.start}ms, c${s.enteredAt}\u2192c${s.leftAt})`) });
  }
  for (const c of result.lanes.commits) {
    const lane = c.kind === "update" ? "react" : "SCRN";
    rows.push({ t: c.t, lane, text: `c${c.commitId} ${c.kind === "update" ? "" : c.kind + " "}${c.rendered} rendered${c.sources.length ? " \xB7 " + c.sources.join(", ") : ""}${c.suspense.length ? " \xB7 " + c.suspense.join(" ") : ""}` });
  }
  const order = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4 };
  rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
  const width = Math.max(...rows.map((r) => String(r.t).length), 1);
  return [...header, "", ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join("\n");
}

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
function compactNetwork(network, maxItems) {
  const rows = (items) => items.slice(0, maxItems);
  return {
    landedBefore: rows(network?.landedBefore ?? []),
    landedBeforeTotal: network?.landedBefore.length ?? 0,
    startedAfter: rows(network?.startedAfter ?? []),
    startedAfterTotal: network?.startedAfter.length ?? 0,
    startedDuringRender: rows(network?.startedDuringRender ?? []),
    startedDuringRenderTotal: network?.startedDuringRender.length ?? 0,
    inFlight: network?.inFlight ?? 0
  };
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
var REPORT_ALL_SOURCES = Number.POSITIVE_INFINITY;
function getReport(api) {
  if (!api || typeof api.report !== "function") return null;
  try {
    const r = api.report(REPORT_ALL_SOURCES);
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
        const allowedInclude = ["stats", "sources", "timing", "metrics", "atl", "unmounts", "actions", "rendered", "network"];
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
        if (include.includes("network")) {
          out.network = compactNetwork(networkByCommit(ser, command?.window).get(commitId), maxItems);
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
        const allowedKeys = UPSTREAM_COMMIT_STAT_KEYS.concat(["sources", "ticks", "network"]);
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
        const network = networkByCommit(ser, command?.window);
        const rows = ids.map((id) => {
          const tuple = stats[id];
          const stat = tupleToStats(tuple);
          const srcs = sourcesByCommit[id];
          const sourceCount = Array.isArray(srcs) ? srcs.length : srcs && typeof srcs === "object" ? Object.keys(srcs).length : 0;
          const actions = ser.interactionsByCommit?.[id] || [];
          const timing = ser.commitTimings?.[id];
          const ticks = typeof timing?.ticks === "number" ? timing.ticks : null;
          const net = network.get(Number(id));
          return {
            commitId: Number(id),
            stat,
            sourceCount,
            ticks,
            network: {
              landedBefore: net?.landedBefore.length ?? 0,
              startedAfter: net?.startedAfter.length ?? 0,
              startedDuringRender: net?.startedDuringRender.length ?? 0
            },
            latestAction: actions.length ? compactLatestAction(actions[actions.length - 1]) : null
          };
        });
        const sortValue = (row) => {
          if (sortKey === "sources") return row.sourceCount || 0;
          if (sortKey === "ticks") return row.ticks ?? -1;
          if (sortKey === "network") return row.network.landedBefore;
          return row.stat?.[sortKey] || 0;
        };
        rows.sort((a, b) => sortValue(b) - sortValue(a));
        return { ok: true, available: true, action, by: sortKey, total: rows.length, rows: rows.slice(0, top) };
      }
      case "network": {
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const view = networkView(r.serial, {
          top: command?.top,
          by: command?.by,
          match: command?.match,
          initiators: command?.initiators,
          window: command?.window
        });
        if ("error" in view) return { ok: false, available: true, action, error: view.error, ...view.validBy && { validBy: [...view.validBy] } };
        return { ok: true, available: true, action, payload: view.payload };
      }
      case "timeline": {
        const r = getReport(api);
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const timeline = buildTimeline(r.serial, {
          fromCommit: command?.fromCommit,
          toCommit: command?.toCommit,
          minRequestMs: command?.minRequestMs,
          maxRequests: command?.top,
          exclude: command?.exclude
        });
        if ("error" in timeline) return { ok: false, available: true, action, error: timeline.error };
        const { ok: _ok, lanes, ...rest } = timeline;
        return { ok: true, available: true, action, payload: command?.format === "full" ? { ...rest, lanes } : rest };
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
    case "network": {
      const initiators = String(args.initiators ?? positional[3] ?? "");
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: "network",
        top: number("top", 0),
        by: String(args.by ?? positional[1] ?? "start"),
        ...typeof match === "string" && match && { match },
        ...initiators && { initiators: initiators.split(",").map((item) => item.trim()).filter(Boolean) },
        window: number("window", 4)
      });
    }
    case "timeline": {
      const exclude = args.exclude ?? positional[3];
      return dispatch(report, {
        action: "timeline",
        fromCommit: number("fromCommit", 0),
        toCommit: number("toCommit", 1),
        minRequestMs: number("minRequestMs", 2),
        top: number("top", 99),
        ...typeof exclude === "string" && exclude && { exclude },
        ...typeof args.format === "string" && { format: args.format }
      });
    }
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
  network       [top] [by] [match] [initiators] [windowMs]
                (--top N --by start|end|duration --match regex --initiators csv --window ms)
  timeline      [fromCommit] [toCommit] [minRequestMs] [exclude]
                (--fromCommit N --toCommit N --minRequestMs ms --top N --exclude regex --format full)
  source-search --name <regex> [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks network
commit-peek include values: stats,sources,timing,metrics,actions,rendered,network (atl: deprecated alias of metrics)
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
