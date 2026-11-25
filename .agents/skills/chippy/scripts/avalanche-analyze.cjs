#!/usr/bin/env node
// Generated from src/avalanche/offline-cli.ts by `yarn chippy:mcp:build`; do not edit.

// src/avalanche/offline-cli.ts
var import_node_fs2 = require("node:fs");
var import_node_zlib2 = require("node:zlib");

// src/avalanche/avalanche-hooks.ts
function summarizeHookResults(results) {
  if (!results) return null;
  const out = {};
  for (const [id, { steps, instructions: _instructions, ...rest }] of Object.entries(results)) {
    out[id] = { ...rest, stepCount: Object.keys(steps ?? {}).length };
  }
  return out;
}
function hookStepsAt(results, commitId) {
  const out = {};
  for (const [id, result] of Object.entries(results ?? {})) {
    const steps = result?.steps ?? {};
    const value = steps[commitId] ?? steps[String(commitId)];
    if (value !== void 0) out[id] = value;
  }
  return out;
}

// src/avalanche/commit-stats.ts
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

// src/avalanche/console-signals.ts
var DEFAULT_CONSOLE_TOP = 50;
var round = (value) => Math.round(value * 10) / 10;
function commitStarts(report) {
  return Object.entries(report.commitTimings ?? {}).map(([id, timing]) => ({ id: Number(id), start: Number(timing?.startTime) })).filter((c) => Number.isFinite(c.id) && Number.isFinite(c.start)).sort((a, b) => a.start - b.start);
}
function linkConsoleEntries(report, entries = report.consoleEntries ?? []) {
  const commits = commitStarts(report);
  return entries.map((entry) => {
    let before = null;
    for (const c of commits) {
      if (c.start > entry.time) break;
      before = c;
    }
    return { ...entry, commit: before ? { commitId: before.id, gapMs: round(entry.time - before.start) } : null };
  });
}
function consoleSummary(report, entries = report.consoleEntries ?? []) {
  const page = entries.filter((e) => !e.chippy);
  const count = (keep) => page.filter(keep).reduce((sum, e) => sum + e.repeat, 0);
  const first = page.find((e) => e.level === "error");
  const firstLinked = first ? linkConsoleEntries(report, [first])[0] : null;
  return {
    errors: count((e) => e.level === "error"),
    warnings: count((e) => e.level === "warn"),
    other: count((e) => e.level !== "error" && e.level !== "warn"),
    uncaught: count((e) => e.source === "uncaught"),
    rejections: count((e) => e.source === "rejection"),
    chippy: entries.length - page.length,
    firstError: firstLinked ? { id: firstLinked.id, time: firstLinked.time, message: firstLinked.message, location: firstLinked.location, commitId: firstLinked.commit?.commitId ?? null } : null
  };
}
function commitStart(report, id) {
  const n = Number(id);
  if (id === void 0 || id === null || id === "" || !Number.isFinite(n)) return null;
  const start = Number(report.commitTimings?.[String(n)]?.startTime);
  return Number.isFinite(start) ? start : null;
}
function consoleView(report, options = {}) {
  const status = report.meta?.console ?? null;
  if (!Array.isArray(report.consoleEntries)) {
    return {
      error: status && !status.enabled ? "console capture is switched off for this detector" : "this report has no consoleEntries: it was recorded before report version 10, or by a runtime without console capture"
    };
  }
  const top = Number(options.top) > 0 ? Math.floor(Number(options.top)) : DEFAULT_CONSOLE_TOP;
  const levels = Array.isArray(options.levels) ? options.levels.map(String) : typeof options.levels === "string" && options.levels ? options.levels.split(",").map((l) => l.trim()).filter(Boolean) : null;
  let match = null;
  if (typeof options.match === "string" && options.match) {
    try {
      match = new RegExp(options.match, "i");
    } catch (error) {
      return { error: `invalid match pattern: ${error.message}` };
    }
  }
  const includeChippy = options.chippy === true || options.chippy === "true";
  const from = commitStart(report, options.fromCommit);
  const last = commitStart(report, options.toCommit);
  const next = last === null ? null : commitStarts(report).find((c) => c.start > last)?.start ?? Infinity;
  const windowed = report.consoleEntries.filter((e) => (from === null || (e.lastTime ?? e.time) >= from) && (next === null || e.time < next));
  const selected = windowed.filter((e) => (includeChippy || !e.chippy) && (!levels || levels.includes(e.level)) && (!match || match.test(e.message)));
  return {
    payload: {
      status,
      summary: consoleSummary(report, windowed),
      count: selected.length,
      truncated: selected.length > top,
      entries: linkConsoleEntries(report, selected.slice(0, top))
    }
  };
}
function consoleForCommit(report, commitId, maxItems = DEFAULT_CONSOLE_TOP) {
  const near = linkConsoleEntries(report).filter((e) => !e.chippy && e.commit?.commitId === commitId);
  return { total: near.length, items: near.slice(0, maxItems) };
}

// src/avalanche/own-work.ts
function isOwnFrame(frame, own) {
  const scripts = frame.scripts ?? [];
  const pageScriptMs = scripts.reduce((sum, script) => sum + (script.chippy ? 0 : script.duration || 0), 0);
  if (pageScriptMs * 2 >= frame.duration) return false;
  if (scripts.some((script) => script.chippy)) return true;
  const from = frame.startTime;
  const to = frame.startTime + frame.duration;
  return !!own?.some((span) => span.start < to && span.end > from);
}

// src/avalanche/perf-signals.ts
var DEFAULT_PERF_TOP = 20;
var MAX_LINKED_COMMITS = 10;
var round2 = (value) => Math.round(value * 10) / 10;
function commitStarts2(report) {
  return Object.entries(report.commitTimings ?? {}).map(([id, timing]) => ({ id: Number(id), start: Number(timing?.startTime) })).filter((c) => Number.isFinite(c.id) && Number.isFinite(c.start)).sort((a, b) => a.start - b.start);
}
function linkPerfEntries(report, entries = report.perfEntries ?? []) {
  const commits = commitStarts2(report);
  return entries.map((entry) => {
    const from = entry.startTime;
    const to = entry.startTime + (entry.duration || 0);
    const during = [];
    let before = null;
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
        before: before ? { commitId: before.id, gapMs: round2(from - before.start) } : null
      }
    };
  });
}
function cumulativeLayoutShift(shifts) {
  let best = 0;
  let current = 0;
  let first = null;
  let last = null;
  for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    if (s.hadRecentInput) continue;
    if (first !== null && last !== null && s.startTime - last < 1e3 && s.startTime - first < 5e3) current += s.value ?? 0;
    else {
      current = s.value ?? 0;
      first = s.startTime;
    }
    last = s.startTime;
    best = Math.max(best, current);
  }
  return Math.round(best * 1e4) / 1e4;
}
function perfSummary(report, entries = report.perfEntries ?? []) {
  const of = (type) => entries.filter((e) => e.entryType === type);
  const own = (e) => isOwnFrame(e, report.ownWork);
  const blockingOf = (e) => e.entryType === "longtask" ? Math.max(0, e.duration - 50) : e.blockingDuration ?? 0;
  const allLong = [...of("long-animation-frame"), ...of("long-animation-frame").length ? [] : of("longtask")];
  const chippyLong = allLong.filter(own);
  const frames = of("long-animation-frame").filter((e) => !own(e));
  const tasks = of("longtask").filter((e) => !own(e));
  const events = of("event");
  const measures = of("measure");
  const lcp = of("largest-contentful-paint").sort((a, b) => a.startTime - b.startTime).at(-1);
  const fcp = of("paint").find((e) => e.name === "first-contentful-paint");
  const navigation = of("navigation")[0];
  const worst = frames.reduce((best, e) => !best || (e.blockingDuration ?? 0) > (best.blockingDuration ?? 0) ? e : best, null);
  const worstLinked = worst ? linkPerfEntries(report, [worst])[0] : null;
  const perInteraction = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (!e.interactionId) continue;
    perInteraction.set(e.interactionId, Math.max(perInteraction.get(e.interactionId) ?? 0, e.duration));
  }
  const longest = measures.reduce((best, e) => !best || e.duration > best.duration ? e : best, null);
  const blocking = of("long-animation-frame").length ? frames.reduce((sum, e) => sum + (e.blockingDuration ?? 0), 0) : tasks.reduce((sum, e) => sum + Math.max(0, e.duration - 50), 0);
  return {
    cls: cumulativeLayoutShift(of("layout-shift")),
    layoutShifts: of("layout-shift").length,
    longFrames: frames.length || tasks.length,
    totalBlockingMs: round2(blocking),
    chippyFrames: { count: chippyLong.length, blockingMs: round2(chippyLong.reduce((sum, e) => sum + blockingOf(e), 0)) },
    worstFrame: worstLinked ? {
      id: worstLinked.id,
      startTime: worstLinked.startTime,
      duration: worstLinked.duration,
      blockingDuration: worstLinked.blockingDuration ?? 0,
      commits: worstLinked.commits.during
    } : null,
    interactions: perInteraction.size,
    worstInteractionMs: perInteraction.size ? Math.max(...perInteraction.values()) : null,
    lcpMs: lcp ? lcp.startTime : null,
    fcpMs: fcp ? fcp.startTime : null,
    ttfbMs: navigation?.ttfb ?? null,
    marks: of("mark").length,
    measures: measures.length,
    longestMeasure: longest ? { name: longest.name, startTime: longest.startTime, duration: longest.duration } : null
  };
}
var RANK = {
  "layout-shift": (e) => e.value ?? 0,
  "long-animation-frame": (e) => e.blockingDuration ?? 0,
  longtask: (e) => e.duration,
  event: (e) => e.duration,
  measure: (e) => e.duration
};
function commitStart2(report, id) {
  const n = Number(id);
  if (id === void 0 || id === null || id === "" || !Number.isFinite(n)) return null;
  const start = Number(report.commitTimings?.[String(n)]?.startTime);
  return Number.isFinite(start) ? start : null;
}
function perfView(report, options = {}) {
  const status = report.meta?.perf ?? null;
  if (!Array.isArray(report.perfEntries)) {
    return {
      error: status && !status.enabled ? "performance entry capture is switched off for this detector" : "this report has no perfEntries: it was recorded before report version 9, or by a runtime without performance capture"
    };
  }
  const top = Number(options.top) > 0 ? Math.floor(Number(options.top)) : DEFAULT_PERF_TOP;
  const requested = Array.isArray(options.types) ? options.types.map(String) : typeof options.types === "string" && options.types ? options.types.split(",").map((t) => t.trim()).filter(Boolean) : null;
  let match = null;
  if (typeof options.match === "string" && options.match) {
    try {
      match = new RegExp(options.match, "i");
    } catch (error) {
      return { error: `invalid match pattern: ${error.message}` };
    }
  }
  const from = commitStart2(report, options.fromCommit);
  const last = commitStart2(report, options.toCommit);
  const next = last === null ? null : commitStarts2(report).find((c) => c.start > last)?.start ?? Infinity;
  const selected = report.perfEntries.filter((e) => (!requested || requested.includes(e.entryType)) && (!match || match.test(e.name)) && (from === null || e.startTime + (e.duration || 0) >= from) && (next === null || e.startTime < next));
  const byType = {};
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
      entries: byType
    }
  };
}
function perfForCommit(report, commitId, maxItems = DEFAULT_PERF_TOP) {
  const near = linkPerfEntries(report).filter((e) => e.commits.during.includes(commitId) || e.commits.before?.commitId === commitId);
  near.sort((a, b) => b.duration - a.duration || a.startTime - b.startTime);
  return { total: near.length, items: near.slice(0, maxItems) };
}

// src/avalanche/rebuilt-props.ts
function summarizeRebuiltProps(rendered, maxItems) {
  if (!Array.isArray(rendered)) return null;
  const groups = /* @__PURE__ */ new Map();
  let sameShallow = 0;
  let keysChanged = 0;
  let notCompared = 0;
  for (const entry of rendered) {
    const e = entry;
    if (!e || !Array.isArray(e.propChanges)) continue;
    for (const raw of e.propChanges) {
      const change = raw;
      if (!change || change.kind !== "ref-changed") continue;
      const prop = String(change.name);
      let row;
      if (change.sameShallow === true) {
        sameShallow++;
        row = { sameShallow: true };
      } else if (Array.isArray(change.changedKeys)) {
        keysChanged++;
        row = { changedKeys: change.changedKeys.map((k) => String(k?.key)), changedKeyCount: Number(change.changedKeyCount) || change.changedKeys.length };
      } else if (typeof change.keysNotCompared === "number") {
        notCompared++;
        row = { keysNotCompared: change.keysNotCompared };
      } else {
        continue;
      }
      const key = `${prop}\0${String(change.current)}\0${JSON.stringify(row)}`;
      const group = groups.get(key);
      if (group) group.components++;
      else groups.set(key, { prop, component: e.name ?? null, sourceId: e.sourceId ?? null, components: 1, ...row });
    }
  }
  if (!groups.size) return null;
  const sorted = [...groups.values()].sort((a, b) => b.components - a.components || Number(!!b.sameShallow) - Number(!!a.sameShallow));
  return {
    sameShallow,
    keysChanged,
    notCompared,
    groups: sorted.slice(0, maxItems),
    omittedGroups: Math.max(0, sorted.length - maxItems)
  };
}

// src/avalanche/screen-stability.ts
var GRID_COLUMNS = 48;
function grid(frames) {
  const [width, height] = frames[frames.length - 1].change.viewport;
  const cols = GRID_COLUMNS;
  const rows = Math.max(1, Math.round(cols * height / Math.max(1, width)));
  const cw = width / cols;
  const ch = height / rows;
  const last = new Float64Array(cols * rows).fill(Number.NaN);
  for (const frame of frames) {
    for (const [l, t, r, b] of frame.change.rects) {
      const c0 = Math.max(0, Math.round(l / cw));
      const c1 = Math.min(cols, Math.round(r / cw));
      const r0 = Math.max(0, Math.round(t / ch));
      const r1 = Math.min(rows, Math.round(b / ch));
      for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) last[y * cols + x] = frame.t;
    }
  }
  return { width, height, cols, rows, cw, ch, last };
}
function timeAtShare(times2, total, share, floor) {
  if (total === 0) return null;
  const sorted = times2.slice().sort((a, b) => a - b);
  const needed = Math.ceil(total * share);
  const missing = total - sorted.length;
  if (needed <= missing) return floor;
  return sorted[Math.min(sorted.length - 1, needed - missing - 1)];
}
function screenStability(frames) {
  const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;
  const g = grid(sorted);
  const changedTimes = [];
  for (const value of g.last) if (!Number.isNaN(value)) changedTimes.push(value);
  const total = g.last.length;
  const vc = (share) => timeAtShare(changedTimes, total, share, 0) ?? 0;
  const changedVc90 = timeAtShare(changedTimes, changedTimes.length, 0.9, 0);
  const late = changedVc90 === null ? [] : sorted.filter((f) => f.t > changedVc90 && f.change.regions.length).reverse().slice(0, 5).map((f) => ({ label: f.change.regions[0].label, at: f.t, commitId: f.commitId, share: f.change.share }));
  return {
    viewport: [g.width, g.height],
    changedShare: Math.round(changedTimes.length / total * 1e3) / 1e3,
    vc50: vc(0.5),
    vc90: vc(0.9),
    vc100: changedTimes.length ? Math.max(...changedTimes) : 0,
    changedVc90,
    late,
    visibleCommits: sorted.filter((f) => f.change.share >= 0.01).length
  };
}
var RAMP = ["#fde9a9", "#fbcf7d", "#f7b35a", "#f0953f", "#e5762e", "#d45726", "#bd3b22", "#9f2420", "#7d121c", "#590616"];
var UNCHANGED = "#e6e6e6";
function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}
function settleMapSvg(frames, title = "When each part of the screen last changed") {
  const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;
  const g = grid(sorted);
  const times2 = Array.from(g.last).filter((v) => !Number.isNaN(v));
  const min = Math.min(...times2);
  const max = Math.max(...times2);
  const bucket = (t) => max === min ? RAMP.length - 1 : Math.min(RAMP.length - 1, Math.floor((t - min) / (max - min) * RAMP.length));
  const scale = Math.min(1, 640 / g.width);
  const w = Math.round(g.width * scale);
  const h = Math.round(g.height * scale);
  const cw = g.cw * scale;
  const ch = g.ch * scale;
  const legendH = 34;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + legendH}" width="${w}" height="${h + legendH}" font-family="system-ui, sans-serif" font-size="11" shape-rendering="crispEdges">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${UNCHANGED}"/>`
  ];
  for (let y = 0; y < g.rows; y++) {
    let x = 0;
    while (x < g.cols) {
      const value = g.last[y * g.cols + x];
      if (Number.isNaN(value)) {
        x++;
        continue;
      }
      const color = bucket(value);
      let end = x + 1;
      while (end < g.cols && !Number.isNaN(g.last[y * g.cols + end]) && bucket(g.last[y * g.cols + end]) === color) end++;
      parts.push(`<rect x="${(x * cw).toFixed(1)}" y="${(y * ch).toFixed(1)}" width="${((end - x) * cw).toFixed(1)}" height="${ch.toFixed(1)}" fill="${RAMP[color]}"/>`);
      x = end;
    }
  }
  for (const frame of sorted.slice(-3)) {
    const [l, t, r, b] = frame.change.rects[0];
    const label = frame.change.regions[0]?.label;
    if (!label) continue;
    const cx = (l + r) / 2 * scale;
    const cy = (t + b) / 2 * scale;
    parts.push(`<text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${escapeXml(`${label} +${frame.t}`)}</text>`);
  }
  const sw = Math.max(18, Math.floor((w - 120) / RAMP.length));
  parts.push(`<rect x="0" y="${h + 8}" width="14" height="12" fill="${UNCHANGED}"/><text x="18" y="${h + 18}" fill="#444">unchanged</text>`);
  RAMP.forEach((color, i) => parts.push(`<rect x="${90 + i * sw}" y="${h + 8}" width="${sw}" height="12" fill="${color}"/>`));
  parts.push(`<text x="90" y="${h + 31}" fill="#444">+${min} ms</text>`);
  parts.push(`<text x="${90 + RAMP.length * sw}" y="${h + 31}" text-anchor="end" fill="#444">+${max} ms</text>`);
  parts.push("</svg>");
  return parts.join("");
}

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

// src/chippy-bridge/component-origin.ts
var FORWARD_REF = Symbol.for("react.forward_ref");
var MEMO = Symbol.for("react.memo");

// src/avalanche/internals.tsx
var Placement = 2;
var ChildDeletion = 16;
var Update = 4;

// src/avalanche/suspense-location.ts
function entryKey(entry) {
  return entry.name + (entry.props ? JSON.stringify(entry.props) : "") + (entry.source ? `@${entry.source.fileName}:${entry.source.lineNumber}` : "");
}
function entryLabel(entry) {
  const props = entry.props ? Object.entries(entry.props).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  return props ? `${entry.name} ${props}` : entry.name;
}
function distinguishingLabels(locations) {
  const counts = /* @__PURE__ */ new Map();
  for (const location of locations) {
    if (!location) continue;
    for (const key of new Set(location.chain.map(entryKey))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = locations.filter(Boolean).length;
  return locations.map((location) => {
    if (!location) return null;
    if (location.name) return location.name;
    const chain = location.chain;
    if (chain.length === 0) return location.fallback ? `fallback ${location.fallback}` : null;
    const unique = total > 1 ? chain.filter((e) => (counts.get(entryKey(e)) || 0) < total) : chain;
    const pick = unique.find((e) => e.props) || unique[0] || chain.find((e) => e.props) || chain[0];
    return entryLabel(pick);
  });
}

// src/avalanche/timeline.ts
function inputDetail(event) {
  if (!event || typeof event !== "object") return null;
  const parts = [];
  if (typeof event.key === "string") parts.push(event.key);
  const held = Array.isArray(event.modifiers) ? event.modifiers.filter((m) => typeof m === "string" && m !== event.key) : [];
  if (held.length) parts.push("with " + held.join("+"));
  if (event.trusted === false) parts.push("dispatched");
  return parts.length ? parts.join(" ") : null;
}
function inputLabel(i) {
  return i.action + (i.detail ? " " + i.detail : "") + (i.target ? " " + i.target : "");
}
var round3 = (n) => Math.round(n);
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
function commitStart3(report, id) {
  const start = Number(report.commitTimings?.[String(id)]?.startTime);
  return Number.isFinite(start) ? start : null;
}
var PAINT_NOTE_MS = 50;
function commitPaint(report, id, start) {
  const paint = Number(report.commitTimings?.[String(id)]?.paintAt);
  return Number.isFinite(paint) && paint >= start ? paint : null;
}
function renderedCount(report, id) {
  const fromStats = Number(report.commitStats?.[String(id)]?.[3] || 0);
  if (fromStats > 0) return fromStats;
  const list = report.renderedByCommit?.[String(id)];
  return Array.isArray(list) ? list.length : 0;
}
function screenOf(report, id) {
  const change = report.screenByCommit?.[String(id)];
  if (!change || typeof change.share !== "number") return null;
  return { share: change.share, region: change.regions?.[0]?.label ?? null };
}
var percent = (share) => `${Math.round(share * 100)}%`;
function kindOf(events) {
  const enters = events.some((e) => e.entered);
  const leaves = events.some((e) => e.left);
  return enters && leaves ? "swap" : enters ? "lock" : leaves ? "unlock" : "update";
}
function buildTimeline(report, options = {}) {
  const ids = Object.keys(report.commitTimings ?? {}).map(Number).filter((id) => Number.isFinite(id) && commitStart3(report, id) !== null).sort((a, b) => a - b);
  if (ids.length === 0) return { ok: false, error: "report has no commit timings (report version 6 or later is required)" };
  const startOf = (id) => commitStart3(report, id);
  const shownOf = (id) => commitPaint(report, id, startOf(id)) ?? startOf(id);
  const interactions = /* @__PURE__ */ new Map();
  for (const list of Object.values(report.interactionsByCommit ?? {})) {
    for (const item of list || []) {
      const t = Number(item.timestamp);
      if (!Number.isFinite(t)) continue;
      const key = String(item.id ?? "") + "@" + t;
      const dom = item.location?.dom;
      const target = dom ? String(dom.nearestTestId || dom.text || dom.tag || "") || null : null;
      if (!interactions.has(key)) interactions.set(key, { t, action: String(item.action || "input"), target, detail: inputDetail(item.event) });
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
  const originInput = inputs.find((input2) => input2.t <= windowStart && windowStart - input2.t <= 5e3);
  const origin = originInput ? originInput.t : windowStart;
  const rel = (t) => round3(t - origin);
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
    durationMs: round3(r.duration),
    initiatorType: r.initiatorType,
    cached: !!r.cached
  });
  const drawable = inWindow.filter((r) => r.duration >= minRequestMs);
  const kept = [...drawable].sort((a, b) => b.duration - a.duration).slice(0, options.maxRequests ?? 30).sort((a, b) => a.startTime - b.startTime);
  const network = kept.map(toRequest);
  const nextAfterWindow = ids.find((id) => id > windowIds[windowIds.length - 1]);
  const consoleLane = consoleLaneOf(
    report.consoleEntries,
    origin,
    nextAfterWindow === void 0 ? Infinity : startOf(nextAfterWindow),
    ids.map((id) => ({ id, start: startOf(id) })),
    rel,
    options.maxLogs ?? 20
  );
  const perfLane = perfLaneOf(report.perfEntries ?? [], report.ownWork, origin, windowEnd, ids.map((id) => ({ id, start: startOf(id) })), rel, options.maxMarks ?? 40);
  const boundaryKey = (event) => typeof event.boundary === "number" ? "b" + event.boundary : "@" + Number(event.depth);
  const open = /* @__PURE__ */ new Map();
  const suspense = [];
  const boundaryInfo = /* @__PURE__ */ new Map();
  for (const id of ids.filter((commit) => commit <= windowIds[windowIds.length - 1])) {
    for (const event of report.suspenseByCommit?.[String(id)] ?? []) {
      const depth = Number(event.depth);
      if (!Number.isFinite(depth)) continue;
      const boundary = boundaryKey(event);
      const info = boundaryInfo.get(boundary);
      if (!info) boundaryInfo.set(boundary, { depth, location: event.location ?? null });
      else if (!info.location && event.location) info.location = event.location;
      if (event.entered) open.set(boundary, [...open.get(boundary) || [], id]);
      if (event.left) {
        const entered = open.get(boundary)?.shift();
        if (entered === void 0) continue;
        if (startOf(id) >= windowStart && startOf(entered) <= windowEnd) {
          suspense.push({
            boundary,
            depth,
            label: null,
            start: rel(shownOf(entered)),
            end: rel(shownOf(id)),
            enteredAt: entered,
            leftAt: id
          });
        }
      }
    }
  }
  for (const [boundary, stack] of open) {
    for (const entered of stack) {
      if (startOf(entered) <= windowEnd) {
        const { depth } = boundaryInfo.get(boundary);
        suspense.push({ boundary, depth, label: null, start: rel(shownOf(entered)), end: null, enteredAt: entered, leftAt: null });
      }
    }
  }
  suspense.sort((a, b) => a.start - b.start || a.depth - b.depth);
  const boundaryKeys = Array.from(new Set(suspense.map((s) => s.boundary)));
  const labels = distinguishingLabels(boundaryKeys.map((key) => boundaryInfo.get(key)?.location));
  const labelByKey = new Map(boundaryKeys.map((key, i) => [key, labels[i]]));
  for (const s of suspense) s.label = labelByKey.get(s.boundary) ?? null;
  const boundaryName = (event) => {
    const key = boundaryKey(event);
    return labelByKey.get(key) || "@" + Number(event.depth);
  };
  const frames = windowIds.map((id) => ({ commitId: id, t: rel(shownOf(id)), change: report.screenByCommit?.[String(id)] })).filter((f) => !!f.change && Array.isArray(f.change.rects));
  const allCommits = windowIds.map((id) => {
    const events = report.suspenseByCommit?.[String(id)] ?? [];
    const renderStart = Number(report.commitTimings?.[String(id)]?.render?.renderStart);
    const paint = commitPaint(report, id, startOf(id));
    const sources = (report.sourcesByCommit?.[String(id)] ?? []).slice().sort((a, b) => Number(b.collateral || 0) - Number(a.collateral || 0)).map((s) => String(s.sourceId || "").split("#")[0]).filter(Boolean);
    return {
      commitId: id,
      t: rel(startOf(id)),
      renderStart: Number.isFinite(renderStart) && renderStart <= startOf(id) ? rel(renderStart) : null,
      paintAt: paint === null ? null : rel(paint),
      rendered: renderedCount(report, id),
      kind: kindOf(events),
      suspense: events.map((e) => (e.entered ? "enter " : "leave ") + boundaryName(e)),
      sources: Array.from(new Set(sources)).slice(0, 2),
      screen: screenOf(report, id)
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
      boundary: s.boundary,
      depth: s.depth,
      label: s.label,
      from: s.start,
      until: s.end,
      waitedMs: until - s.start,
      lockedBy: s.enteredAt,
      unlockedBy: s.leftAt,
      lastRequests: s.end === null ? [] : lastRequests,
      updatesDuring: sumUpdates(updates.filter((c) => c.commitId > s.enteredAt && (s.leftAt === null || c.commitId < s.leftAt)))
    };
  }).sort((a, b) => b.waitedMs - a.waitedMs);
  const nextInput = input.find((i) => i.t > 0);
  const ownWaits = suspense.filter((s) => !nextInput || s.start < nextInput.t);
  const stillWaiting = ownWaits.filter((s) => s.end === null).map((s) => s.boundary);
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
    boundaries: boundaryKeys.map((key) => ({ boundary: key, depth: boundaryInfo.get(key).depth, label: labelByKey.get(key) ?? null, location: boundaryInfo.get(key).location })),
    screen: screenStability(frames),
    ...options.settleMap && { settleMapSvg: settleMapSvg(frames) },
    lanes: { input, network, suspense, commits, perf: perfLane.lane, console: consoleLane.lane },
    omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length, marks: perfLane.omittedMarks, logs: consoleLane.omittedLogs },
    console: consoleLane.summary,
    mermaid: "",
    text: ""
  };
  result.mermaid = renderMermaid(result);
  result.text = renderText(result);
  return result;
}
var CONSOLE_LABEL_MAX = 140;
var MAX_CONSOLE_ALERTS = 50;
var ALERT_LEVELS = /* @__PURE__ */ new Set(["error", "warn"]);
function shortLocation(location) {
  if (!location) return null;
  const match = /([^/]*:\d+:\d+)$/.exec(location);
  return match ? match[1] : location;
}
function consoleLaneOf(entries, origin, end, commitStarts3, rel, maxLogs) {
  if (!Array.isArray(entries)) return { lane: [], omittedLogs: 0, summary: null };
  const page = entries.filter((e) => !e.chippy && (e.lastTime ?? e.time) >= origin && e.time < end).sort((a, b) => a.time - b.time);
  const toItem = (e) => {
    let after = null;
    for (const c of commitStarts3) {
      if (c.start > e.time) break;
      after = c.id;
    }
    const first = String(e.message).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
    return {
      id: e.id,
      level: e.level,
      source: e.source,
      label: first.length > CONSOLE_LABEL_MAX ? first.slice(0, CONSOLE_LABEL_MAX - 1) + "\u2026" : first,
      t: rel(e.time),
      repeat: e.repeat,
      location: shortLocation(e.location),
      afterCommit: after
    };
  };
  const alerts = page.filter((e) => ALERT_LEVELS.has(e.level));
  const others = page.filter((e) => !ALERT_LEVELS.has(e.level));
  const keptAlerts = alerts.slice(0, MAX_CONSOLE_ALERTS);
  const keptOthers = others.slice(0, maxLogs);
  const lane = [...keptAlerts, ...keptOthers].sort((a, b) => a.time - b.time).map(toItem);
  const count = (keep) => page.filter(keep).reduce((n, e) => n + e.repeat, 0);
  const firstError = page.find((e) => e.level === "error");
  return {
    lane,
    omittedLogs: alerts.length - keptAlerts.length + others.length - keptOthers.length,
    summary: {
      errors: count((e) => e.level === "error"),
      warnings: count((e) => e.level === "warn"),
      other: count((e) => !ALERT_LEVELS.has(e.level)),
      firstError: firstError ? toItem(firstError) : null
    }
  };
}
function grouped(items, key) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.count += 1;
    else groups.set(k, { item, count: 1 });
  }
  return Array.from(groups.values());
}
var times = (count) => count > 1 ? ` \xD7${count}` : "";
var waitKey = (w) => `${w.label || "@" + w.depth}|${w.from}|${w.until}|${w.lockedBy}|${w.unlockedBy}`;
var suspenseKey = (s) => `${s.label || "@" + s.depth}|${s.start}|${s.end}|${s.enteredAt}|${s.leftAt}`;
var drawnStart = (p) => Math.max(p.start, 0);
var beforeOrigin = (p) => p.start < 0 ? `, started ${-p.start}ms before the origin` : "";
var consoleText = (c) => `${c.source === "uncaught" ? "uncaught " : ""}${c.label}${c.repeat > 1 ? ` \xD7${c.repeat}` : ""}${c.location ? " \xB7 " + c.location : ""}`;
var SHIFT_MIN = 1e-3;
var EVENT_MIN_MS = 50;
function perfLaneOf(entries, ownWork, origin, windowEnd, commitStarts3, rel, maxMarks) {
  const lane = [];
  let marks = 0;
  let omittedMarks = 0;
  const sorted = entries.filter((e) => e.startTime + (e.duration || 0) >= origin && e.startTime <= windowEnd).sort((a, b) => a.startTime - b.startTime);
  for (const e of sorted) {
    let kind = null;
    let label = e.name;
    let value = null;
    let chippy = false;
    if (e.entryType === "long-animation-frame" || e.entryType === "longtask") {
      kind = "frame";
      value = e.entryType === "longtask" ? round3(Math.max(0, e.duration - 50)) : e.blockingDuration ?? null;
      const script = e.scripts?.[0];
      label = script ? [script.invoker, script.sourceFunctionName, script.sourceURL?.split("/").pop()].filter(Boolean).join(" ") : "";
      chippy = isOwnFrame(e, ownWork);
      if (chippy) label = "Chippy";
    } else if (e.entryType === "measure" && e.duration >= 1) kind = "measure";
    else if (e.entryType === "measure" || e.entryType === "mark") {
      if (marks >= maxMarks) {
        omittedMarks += 1;
        continue;
      }
      marks += 1;
      kind = "mark";
    } else if (e.entryType === "layout-shift" && (e.value ?? 0) >= SHIFT_MIN && !e.hadRecentInput) {
      kind = "shift";
      value = e.value ?? null;
      const source = e.sources?.find((s) => s.component || s.testId);
      label = source ? source.component || source.testId || "" : "";
    } else if (e.entryType === "event" && e.duration >= EVENT_MIN_MS) {
      kind = "event";
      value = e.inputDelay ?? null;
      label = e.name + (e.target ? " " + (e.target.testId || e.target.component || e.target.element || "") : "");
    } else if (e.entryType === "largest-contentful-paint") {
      kind = "lcp";
      label = e.element ? e.element.testId || e.element.component || e.element.element || "" : "";
    }
    if (!kind) continue;
    const end = e.startTime + (e.duration || 0);
    lane.push({
      id: e.id,
      kind,
      label: label.trim(),
      start: rel(e.startTime),
      end: rel(end),
      durationMs: round3(e.duration || 0),
      value,
      commits: commitStarts3.filter((c) => c.start >= e.startTime && c.start <= end).map((c) => c.id),
      ...chippy && { chippy: true }
    });
  }
  return { lane, omittedMarks };
}
var commitSpan = (ids) => ids.length === 0 ? "" : ids.length === 1 ? `c${ids[0]}` : `c${ids[0]}\u2013c${ids[ids.length - 1]}`;
var GANTT_KEYWORDS = /^(click|call|href|section|title|dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|inclusiveenddates|topaxis|acctitle|accdescr|displaymode|gantt)\b/i;
function ganttTaskName(raw) {
  const name = raw.replace(/[:#;]/g, " ").replace(/%%/g, "% %").replace(/\s+/g, " ").trim() || "unnamed";
  return GANTT_KEYWORDS.test(name) ? "\xB7 " + name : name;
}
var safe = ganttTaskName;
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
    input.forEach((i, n) => lines.push(`  ${safe("input " + inputLabel(i))} :milestone, in${n}, ${i.t}, ${i.t}`));
  }
  if (network.length) {
    lines.push("  section Network");
    for (const r of network) lines.push(`  ${safe(r.label)} ${r.durationMs}ms :${slow.has(r.id) ? "crit, " : ""}net${r.id}, ${bar(r.start, r.end)}`);
  }
  const browser = result.lanes.perf.filter((p) => p.kind === "frame" || p.kind === "measure");
  if (browser.length) {
    lines.push("  section Browser (long frames, measures)");
    for (const p of browser) {
      const name = (p.kind === "frame" ? `long frame ${p.durationMs}ms${p.commits.length ? " " + commitSpan(p.commits) : ""}` : `${p.label} ${p.durationMs}ms`) + (p.start < 0 ? " from before" : "");
      lines.push(`  ${safe(name)} :${p.kind === "frame" ? "crit, " : ""}perf${p.id}, ${bar(drawnStart(p), p.end)}`);
    }
  }
  const alerts = result.lanes.console.filter((c) => c.level === "error" || c.level === "warn").slice(0, 15);
  if (alerts.length) {
    lines.push("  section Console (errors, warnings)");
    for (const c of alerts) lines.push(`  ${safe(`${c.level} ${c.label.slice(0, 60)}${c.repeat > 1 ? " \xD7" + c.repeat : ""}`)} :${c.level === "error" ? "crit, " : ""}milestone, log${c.id}, ${c.t}, ${c.t}`);
  }
  if (suspense.length) {
    lines.push("  section User waits (fallback shown)");
    grouped(suspense, suspenseKey).forEach(({ item: s, count }, n) => {
      const stop = s.end ?? end;
      const label = s.end === null ? "still waiting" : `${stop - s.start}ms`;
      lines.push(`  ${safe((s.label || "@" + s.depth) + times(count))} ${label} :${s.end === null ? "active" : "crit"}, sus${n}, ${bar(s.start, stop)}`);
    });
  }
  const screen = commits.filter((c) => c.kind !== "update");
  if (screen.length) {
    lines.push("  section Screen (lock or unlock)");
    for (const c of screen) lines.push(`  c${c.commitId} ${c.kind} ${safe(c.suspense.join(" "))} :milestone, c${c.commitId}, ${c.t}, ${c.t}`);
  }
  const visible = commits.filter((c) => c.screen && c.screen.share >= 0.01);
  if (result.screen) {
    lines.push("  section Screen changed (share of viewport)");
    for (const c of visible) {
      const at2 = c.paintAt ?? c.t;
      lines.push(`  c${c.commitId} ${percent(c.screen.share)}${c.screen.region ? " " + safe(c.screen.region) : ""} :milestone, sc${c.commitId}, ${at2}, ${at2}`);
    }
    lines.push(`  VC90 +${result.screen.vc90} :crit, milestone, vc90, ${result.screen.vc90}, ${result.screen.vc90}`);
  }
  if (updates.length) {
    lines.push("  section Updates (CPU, no Suspense change)");
    for (const c of updates) {
      const what = c.sources.length ? safe(c.sources.join(", ")) : "";
      const span = c.renderStart === null ? `milestone, c${c.commitId}, ${c.t}, ${c.t}` : `c${c.commitId}, ${bar(c.renderStart, c.t)}`;
      const seen = result.screen ? c.screen ? ` ${percent(c.screen.share)} screen` : " 0% screen" : "";
      lines.push(`  c${c.commitId} ${c.rendered} rendered${seen}${what ? " " + what : ""} :${heavy.has(c.commitId) ? "crit, " : ""}${span}`);
    }
  }
  return lines.join("\n");
}
function renderText(result) {
  const p = result.perceived;
  const header = [];
  if (p.waits.length === 0) header.push("No Suspense fallback was shown in this window.");
  else {
    header.push(p.settledAt !== null ? `Fallbacks first shown at +${p.firstLockAt}, all cleared at +${p.settledAt}; ${p.updatesAfterSettled.commits} updates (${p.updatesAfterSettled.rendered} rendered) ran after that, before the next input.` : `Fallbacks first shown at +${p.firstLockAt}; still waiting at the end: ${Array.from(new Set(p.stillWaiting.map((key) => result.boundaries.find((b) => b.boundary === key)?.label || key))).join(", ")}.`);
    for (const { item: w, count } of grouped(p.waits, waitKey).slice(0, 5)) {
      const last = w.lastRequests[0];
      header.push(`  wait ${w.label || "@" + w.depth}${times(count)} ${w.waitedMs}ms (+${w.from} \u2192 ${w.until === null ? "end" : "+" + w.until}), ${w.updatesDuring.commits} updates (${w.updatesDuring.rendered} rendered) meanwhile` + (last ? `, last request before unlock: ${last.label} (+${last.end}, ${last.gapMs}ms before)` : ""));
    }
  }
  const sc = result.screen;
  const painted = result.lanes.commits.some((c) => c.paintAt !== null);
  if (sc) {
    header.push(`Visually complete${painted ? " (at paint)" : ""}: VC50 +${sc.vc50}, VC90 +${sc.vc90}, VC100 +${sc.vc100}; ${percent(sc.changedShare)} of the viewport changed` + (sc.changedVc90 !== null ? `, 90% of that by +${sc.changedVc90}` : "") + ".");
    if (sc.late.length) header.push(`  changing after that: ${sc.late.map((l) => `${l.label} +${l.at} (c${l.commitId}, ${percent(l.share)})`).join(", ")}`);
  }
  const delayed = result.lanes.commits.filter((c) => c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS);
  if (delayed.length) {
    const worst = [...delayed].sort((a, b) => b.paintAt - b.t - (a.paintAt - a.t)).slice(0, 5);
    header.push(`Painted late (the commit's task kept running): ${worst.map((c) => `c${c.commitId} +${c.t} \u2192 painted +${c.paintAt} (${c.paintAt - c.t}ms)`).join(", ")}.`);
  }
  const frames = result.lanes.perf.filter((p2) => p2.kind === "frame" && !p2.chippy);
  const ownFrames = result.lanes.perf.filter((p2) => p2.kind === "frame" && p2.chippy);
  if (frames.length) {
    const worst = [...frames].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
    header.push(`Long frames (no paint inside): ${frames.length}, ${Math.round(frames.reduce((sum, p2) => sum + (p2.value ?? 0), 0))}ms blocking; longest ${worst.map((p2) => `+${p2.start} ${p2.durationMs}ms${p2.commits.length ? " (" + commitSpan(p2.commits) + ")" : ""}`).join(", ")}.`);
  }
  if (ownFrames.length) {
    header.push(`Chippy's own long frames, left out of the totals: ${ownFrames.length}, ${Math.round(ownFrames.reduce((sum, p2) => sum + (p2.value ?? 0), 0))}ms blocking.`);
  }
  const cs = result.console;
  if (cs && cs.errors + cs.warnings > 0) {
    const fe = cs.firstError;
    header.push(`Console: ${cs.errors} errors, ${cs.warnings} warnings` + (fe ? `; first error +${fe.t}${fe.afterCommit !== null ? ` (after c${fe.afterCommit})` : ""}: ${consoleText(fe)}` : "") + ".");
  }
  const rows = [];
  for (const i of result.lanes.input) rows.push({ t: i.t, lane: "input", text: inputLabel(i) });
  for (const r of result.lanes.network) rows.push({ t: r.start, lane: "net", text: `${r.label}  \u2192 +${r.end} (${r.durationMs}ms${r.cached ? ", cached" : ""})` });
  for (const { item: s, count } of grouped(result.lanes.suspense, suspenseKey)) {
    rows.push({ t: s.start, lane: "wait", text: `fallback ${s.label || "@" + s.depth}${times(count)} ` + (s.end === null ? "still shown at the end" : `until +${s.end} (${s.end - s.start}ms, c${s.enteredAt}\u2192c${s.leftAt})`) });
  }
  for (const c of result.lanes.commits) {
    const lane = c.kind === "update" ? "react" : "SCRN";
    const seen = c.screen ? ` \xB7 ${percent(c.screen.share)} screen${c.screen.region ? " " + c.screen.region : ""}` : sc ? " \xB7 0% screen" : "";
    const paint = c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS ? ` \xB7 painted +${c.paintAt}` : "";
    rows.push({ t: c.t, lane, text: `c${c.commitId} ${c.kind === "update" ? "" : c.kind + " "}${c.rendered} rendered${seen}${c.sources.length ? " \xB7 " + c.sources.join(", ") : ""}${c.suspense.length ? " \xB7 " + c.suspense.join(", ") : ""}${paint}` });
  }
  for (const p2 of result.lanes.perf) {
    const commits = p2.commits.length ? ` \xB7 ${commitSpan(p2.commits)}` : "";
    const text = p2.kind === "frame" ? `long frame ${p2.durationMs}ms (${p2.value ?? 0}ms blocking${beforeOrigin(p2)}) \u2192 +${p2.end}${p2.label ? " \xB7 " + p2.label : ""}${commits}` : p2.kind === "measure" ? `measure ${p2.label} \u2192 +${p2.end} (${p2.durationMs}ms${beforeOrigin(p2)})` : p2.kind === "mark" ? `mark ${p2.label}` : p2.kind === "shift" ? `layout shift ${p2.value}${p2.label ? " \xB7 " + p2.label : ""}` : p2.kind === "event" ? `slow ${p2.label} ${p2.durationMs}ms (input delay ${p2.value ?? 0}ms)` : `LCP${p2.label ? " " + p2.label : ""}`;
    rows.push({ t: drawnStart(p2), lane: p2.kind === "frame" ? "frame" : "perf", text });
  }
  for (const c of result.lanes.console) rows.push({ t: c.t, lane: c.level, text: consoleText(c) });
  const order = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4, frame: 5, perf: 6, error: 7, warn: 7, info: 7, log: 7, debug: 7 };
  rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
  const width = Math.max(...rows.map((r) => String(r.t).length), 1);
  return [...header, "", ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join("\n");
}

// src/avalanche/summary-view.ts
var SUMMARY_DEFAULT_TOP = 5;
var SUMMARY_DEFAULT_MAX_ITEMS = 3;
function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function finite(value) {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
}
function ms(value) {
  return Math.round(value) || 0;
}
function at(map, id) {
  return map?.[id] ?? map?.[String(id)];
}
function sameContent(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
function sourceRows(entries, maxItems) {
  return entries.slice(0, maxItems).map((entry) => {
    const e = entry && typeof entry === "object" ? entry : { sourceId: entry };
    return {
      sourceId: e.sourceId ?? null,
      collateralAtCommit: finite(e.collateral),
      changedHooks: (Array.isArray(e.trashers) ? e.trashers : []).map((t) => ({
        index: t?.index ?? null,
        sameContent: sameContent(t?.prevValue, t?.currentValue)
      }))
    };
  });
}
function frameOf(frames, commitId, origin) {
  const frame = frames.find((f) => f.commits.during.includes(commitId));
  if (!frame) return null;
  return {
    atMs: origin === null ? null : ms(frame.startTime - origin),
    durationMs: ms(frame.duration),
    blockingMs: ms(frame.blockingDuration ?? 0),
    commits: frame.commits.during
  };
}
function compactTimeline(report) {
  const timeline = buildTimeline(report);
  if ("error" in timeline) return { error: timeline.error };
  const { origin, window: window2, omitted, text } = timeline;
  return { origin, window: window2, omitted, text };
}
function nonZero(stats) {
  return stats ? Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== 0)) : null;
}
function tenths(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}
function buildSummaryView(report, options = {}) {
  const top = positive(options.top, SUMMARY_DEFAULT_TOP);
  const maxItems = positive(options.maxItems, SUMMARY_DEFAULT_MAX_ITEMS);
  const commitStats = report.commitStats ?? {};
  const ids = Object.keys(commitStats).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const totals = Object.fromEntries(UPSTREAM_COMMIT_STAT_KEYS.map((key) => [key, 0]));
  const statsById = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const stats = tupleToStats(at(commitStats, id));
    statsById.set(id, stats);
    if (stats) for (const key of UPSTREAM_COMMIT_STAT_KEYS) totals[key] += stats[key];
  }
  const timeline = compactTimeline(report);
  const origin = "origin" in timeline ? finite(timeline.origin.at) : null;
  const frames = Array.isArray(report.perfEntries) ? linkPerfEntries(report, report.perfEntries.filter((e) => e.entryType === "long-animation-frame" || e.entryType === "longtask")) : [];
  const topCommits = ids.slice().sort((a, b) => (statsById.get(b)?.collateral ?? 0) - (statsById.get(a)?.collateral ?? 0) || a - b).slice(0, top).map((commitId) => {
    const timing = at(report.commitTimings, commitId);
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
      longFrame: frameOf(frames, commitId, origin)
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
    console: Array.isArray(report.consoleEntries) ? consoleSummary(report) : null,
    meta: report.meta ?? null
  };
}

// src/chippy-bridge/component-name-tokens.ts
var MAX_TOKENS = 5e3;
var MAX_TOKEN_LENGTH = 80;
var MAX_DEPTH = 12;
var SEPARATORS = /[^\w$]+/;
var IDENTIFIER2 = /^[A-Za-z_$][\w$]*$/;
var RENAME_TABLE_KEY = "componentNames";
function nameTokensIn(value, limit = MAX_TOKENS) {
  const found = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const addWords = (text) => {
    for (const word of text.split(SEPARATORS)) {
      if (found.size >= limit) return;
      if (word.length <= MAX_TOKEN_LENGTH && IDENTIFIER2.test(word)) found.add(word);
    }
  };
  const visit = (node, depth) => {
    if (found.size >= limit) return;
    if (typeof node === "string") {
      addWords(node);
      return;
    }
    if (!node || typeof node !== "object" || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      if (key === RENAME_TABLE_KEY) continue;
      addWords(key);
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return found;
}
function isRename(value) {
  const rename = value;
  return !!rename && typeof rename.name === "string" && typeof rename.minifiedName === "string";
}
function componentNamesIn(value, renames) {
  if (!Array.isArray(renames) || renames.length === 0) return [];
  const tokens = nameTokensIn(value);
  return renames.filter((rename) => isRename(rename) && tokens.has(rename.name));
}

// src/avalanche/network-signals.ts
var DEFAULT_NETWORK_WINDOW_MS = 250;
var NETWORK_SORT_KEYS = ["start", "end", "duration"];
var round4 = (value) => Math.round(value * 10) / 10;
function commitAnchors(commitTimings) {
  const anchors = [];
  for (const [id, timing] of Object.entries(commitTimings ?? {})) {
    const commitStart4 = Number(timing?.startTime);
    const commitEnd = Number(timing?.endTime);
    if (!Number.isFinite(commitStart4) || !Number.isFinite(commitEnd)) continue;
    const renderStart = Number(timing?.render?.renderStart);
    const renderStartKnown = Number.isFinite(renderStart) && renderStart <= commitStart4;
    anchors.push({
      commitId: Number(id),
      renderStart: renderStartKnown ? renderStart : commitStart4,
      renderStartKnown,
      commitStart: commitStart4,
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
  const startedAfter = after && startTime - after.commitEnd <= windowMs ? { commitId: after.commitId, gapMs: round4(startTime - after.commitEnd) } : null;
  const rendering = anchors[firstAtOrAfter(anchors, startTime, "commitStart")];
  const startedDuringRender = rendering && rendering.renderStartKnown && rendering.renderStart <= startTime ? rendering.commitId : null;
  let landedBefore = null;
  for (let i = firstAtOrAfter(anchors, endTime, "commitStart"); i < anchors.length; i++) {
    const anchor = anchors[i];
    if (anchor.renderStart - endTime > windowMs) break;
    if (anchor.renderStart >= endTime) {
      landedBefore = { commitId: anchor.commitId, gapMs: round4(anchor.renderStart - endTime) };
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
  const window2 = windowOf(windowMs);
  return requestsOf(report).map((request) => ({ ...request, ...linkRequest(request, anchors, window2) }));
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

// src/avalanche/screen-changes.ts
var Visibility = 8192;
var MUTATION_MASK = Placement | Update | ChildDeletion | Visibility;

// src/avalanche/dom-diff.ts
var MAX_ELEMENT_COUNT = 1e3;

// src/avalanche/dom-diff-view.ts
var DEFAULT_DOM_DIFF_COMMITS = 100;
var DEFAULT_DOM_DIFF_CHANGES = 50;
var ORDER_NOTE = "Each commit is one change set: its changes reached the DOM together and have no order. Order is between commits.";
function searchable(change) {
  const props = (change.props || []).map(([name, before, after]) => `${name} ${before ?? ""} ${after ?? ""}`).join(" ");
  return `${change.op} ${change.node} ${change.at} ${change.html ?? ""} ${props}`;
}
function formatProps(props) {
  return (props || []).map(([name, before, after]) => `${name} ${before ?? "\u2205"} \u2192 ${after ?? "\u2205"}`).join("; ");
}
function formatDomChange(change) {
  if (change.op === "~") return `~ ${change.node}  ${formatProps(change.props)}`;
  const size = change.elements && change.elements > 1 ? ` (${change.elements}${change.elements >= MAX_ELEMENT_COUNT ? "+" : ""} el)` : "";
  return `${change.op} ${change.node}${size}  ${change.html ?? ""}`;
}
function renderCommit(view) {
  const when = view.t === null ? "" : `  +${view.t}ms`;
  const shown = view.changes.length < view.total ? `${view.changes.length} of ${view.total}` : String(view.total);
  const lines = [`#${view.commitId}${when} \xB7 ${shown} change${view.total === 1 ? "" : "s"}${view.truncated ? " (commit truncated)" : ""}`];
  const groups = /* @__PURE__ */ new Map();
  for (const change of view.changes) {
    const list = groups.get(change.at);
    if (list) list.push(change);
    else groups.set(change.at, [change]);
  }
  for (const [at2, changes] of groups) {
    lines.push(`  ${at2}`);
    for (const change of changes) lines.push(`    ${formatDomChange(change)}`);
  }
  return lines;
}
function buildDomDiffView(report, options = {}) {
  let pattern = null;
  if (options.match) {
    try {
      pattern = new RegExp(options.match, "i");
    } catch (error) {
      return { error: "invalid match regex: " + (error.message || String(error)) };
    }
  }
  const from = Number.isFinite(Number(options.fromCommit)) && options.fromCommit != null ? Number(options.fromCommit) : -Infinity;
  const to = Number.isFinite(Number(options.toCommit)) && options.toCommit != null ? Number(options.toCommit) : Infinity;
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_DOM_DIFF_COMMITS));
  const maxItems = Math.max(1, Math.floor(Number(options.maxItems) || DEFAULT_DOM_DIFF_CHANGES));
  const byCommit = report.domByCommit || {};
  const ids = Object.keys(byCommit).map(Number).filter((id) => Number.isFinite(id) && id >= from && id <= to).sort((a, b) => a - b);
  const matched = [];
  for (const commitId of ids) {
    const diff = byCommit[String(commitId)];
    const changes = pattern ? diff.changes.filter((change) => pattern.test(searchable(change))) : diff.changes;
    if (changes.length) matched.push({ commitId, diff, changes });
  }
  const listed = matched.slice(0, top);
  const startOf = (id) => {
    const start = report.commitTimings?.[String(id)]?.startTime;
    return typeof start === "number" && Number.isFinite(start) ? start : null;
  };
  const origin = listed.length ? startOf(listed[0].commitId) : null;
  const commits = listed.map(({ commitId, diff, changes }) => {
    const startTime = startOf(commitId);
    return {
      commitId,
      t: startTime === null || origin === null ? null : Math.round((startTime - origin) * 10) / 10,
      startTime,
      total: changes.length,
      changes: changes.slice(0, maxItems),
      ...diff.truncated && { truncated: true }
    };
  });
  const evicted = report.meta?.domDiff?.evicted ?? null;
  const lines = [ORDER_NOTE];
  if (evicted) lines.push(`Commits up to #${evicted.throughCommit} may have lost their DOM changes to the capture budget.`);
  if (!commits.length) lines.push(pattern ? "No DOM change matched." : "No DOM changes recorded.");
  for (const view of commits) lines.push(...renderCommit(view));
  if (matched.length > commits.length) lines.push(`\u2026 ${matched.length - commits.length} more commits; narrow with fromCommit/toCommit or raise top.`);
  return {
    commits,
    commitsTotal: matched.length,
    ...evicted && { evicted },
    text: lines.join("\n")
  };
}

// src/chippy-bridge/avalanche-commands.ts
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
  let slice;
  const report = () => slice === void 0 ? slice = getReport(api) : slice;
  const result = runAvalanche(command, api, mod, report);
  return slice ? withComponentNames(result, slice) : result;
}
function withComponentNames(result, slice) {
  if (!result.ok || "error" in slice || WHOLE_CAPTURE_ACTIONS.has(result.action)) return result;
  const meta = slice.serial.meta;
  const componentNames = componentNamesIn(result, meta?.componentNames);
  return componentNames.length > 0 ? { ...result, componentNames } : result;
}
function runAvalanche(command, api, mod, report) {
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
        const r = report();
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
        const r = report();
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
        const include = Array.isArray(command?.include) && command.include.length ? command.include : ["stats", "sources", "timing", "metrics", "hooks"];
        const allowedInclude = ["stats", "sources", "timing", "metrics", "hooks", "unmounts", "actions", "rendered", "network", "dom", "perf", "console"];
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
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const ser = r.serial || {};
        const tuple = ser.commitStats?.[commitId] || ser.commitStats?.[String(commitId)] || null;
        const sourceIds = ser.sourcesByCommit?.[commitId] || ser.sourcesByCommit?.[String(commitId)] || [];
        const timing = ser.commitTimings?.[commitId] || ser.commitTimings?.[String(commitId)] || null;
        const metricsMap = ser.metricsByCommit;
        const metrics = metricsMap?.[commitId] || metricsMap?.[String(commitId)] || null;
        const actions = ser.interactionsByCommit?.[commitId] || ser.interactionsByCommit?.[String(commitId)] || [];
        const rendered = ser.renderedByCommit?.[commitId] || ser.renderedByCommit?.[String(commitId)] || [];
        const hookSteps = hookStepsAt(ser.hooks, commitId);
        if (!tuple && !sourceIds.length && !timing && !metrics && !actions.length && !rendered.length && !Object.keys(hookSteps).length) {
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
        if (include.includes("hooks") && ser.hooks) out.hooks = hookSteps;
        if (include.includes("actions")) {
          out.actions = actions.slice(0, maxItems);
          out.actionsTotal = actions.length;
        }
        if (include.includes("rendered")) {
          out.rendered = rendered.slice(0, maxItems);
          out.renderedTotal = rendered.length;
          const evicted = ser.meta?.renderedEvidence?.evicted;
          if (!rendered.length && evicted && Number(evicted.throughCommit) >= commitId) out.renderedEvicted = true;
        }
        if (include.includes("dom")) {
          const dom = ser.domByCommit?.[commitId] || ser.domByCommit?.[String(commitId)] || null;
          out.dom = dom ? dom.changes.slice(0, maxItems) : [];
          out.domTotal = dom ? dom.changes.length : 0;
          if (dom?.truncated) out.domTruncated = true;
        }
        if (include.includes("network")) {
          out.network = compactNetwork(networkByCommit(ser, command?.window).get(commitId), maxItems);
        }
        if (include.includes("perf")) {
          const perf = perfForCommit(ser, commitId, maxItems);
          out.perf = perf.items;
          out.perfTotal = perf.total;
        }
        if (include.includes("console")) {
          const logged = consoleForCommit(ser, commitId, maxItems);
          out.console = logged.items;
          out.consoleTotal = logged.total;
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
        const r = report();
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
        const r = report();
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
        const r = report();
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
      case "perf": {
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const view = perfView(r.serial, {
          types: command?.types,
          top: command?.top,
          match: command?.match,
          fromCommit: command?.fromCommit,
          toCommit: command?.toCommit
        });
        if ("error" in view) return { ok: false, available: true, action, error: view.error };
        return { ok: true, available: true, action, payload: view.payload };
      }
      case "console": {
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const view = consoleView(r.serial, {
          levels: command?.levels,
          top: command?.top,
          match: command?.match,
          fromCommit: command?.fromCommit,
          toCommit: command?.toCommit,
          chippy: command?.includeChippy
        });
        if ("error" in view) return { ok: false, available: true, action, error: view.error };
        return { ok: true, available: true, action, payload: view.payload };
      }
      case "timeline": {
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const timeline = buildTimeline(r.serial, {
          fromCommit: command?.fromCommit,
          toCommit: command?.toCommit,
          minRequestMs: command?.minRequestMs,
          maxRequests: command?.top,
          exclude: command?.exclude,
          settleMap: command?.format === "full" || command?.format === "map"
        });
        if ("error" in timeline) return { ok: false, available: true, action, error: timeline.error };
        const { ok: _ok, lanes, ...rest } = timeline;
        return { ok: true, available: true, action, payload: command?.format === "full" ? { ...rest, lanes } : rest };
      }
      case "dom-diff": {
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        const view = buildDomDiffView(r.serial, {
          fromCommit: command?.fromCommit,
          toCommit: command?.toCommit,
          match: command?.match,
          top: command?.top,
          maxItems: command?.maxItems
        });
        if ("error" in view) return { ok: false, available: true, action, error: view.error };
        return { ok: true, available: true, action, payload: view };
      }
      case "summary": {
        const r = report();
        if (!r || "error" in r) {
          return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
        }
        return { ok: true, available: true, action, payload: buildSummaryView(r.serial, { top: command?.top, maxItems: command?.maxItems }) };
      }
      // Removed: start, stop, metrics, help — not present on the current public surface.
      default:
        return { ok: false, available: true, action, error: "Unknown avalanche action: " + action };
    }
  } catch (error) {
    return { ok: false, available: true, action, error: error?.message || String(error) };
  }
}
var WHOLE_CAPTURE_ACTIONS = /* @__PURE__ */ new Set(["export", "export-last"]);

// src/avalanche/offline.ts
var PER_COMMIT_KEYS = [
  "commitStats",
  "suspenseByCommit",
  "sourcesByCommit",
  "interactionsByCommit",
  "renderedByCommit",
  "screenByCommit",
  "domByCommit",
  "metricsByCommit",
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
  if (report.hooks && typeof report.hooks === "object") {
    out.hooks = Object.fromEntries(
      Object.entries(report.hooks).map(([id, result]) => [
        id,
        { ...result, steps: Object.fromEntries(Object.entries(result?.steps ?? {}).filter(([commitId]) => keep.has(commitId))) }
      ])
    );
  }
  out.meta = { ...report.meta, keptLastCommits: keep.size };
  return out;
}
function dispatch(report, command) {
  const result = evalAvalanche(command, { report: () => report }, null);
  const { available: _available, ...rest } = result;
  return rest;
}
function summary(report, options = {}) {
  const view = buildSummaryView(report, options);
  const componentNames = componentNamesIn(view, report.meta?.componentNames);
  return { ok: true, action: "summary", ...view, ...componentNames.length > 0 && { componentNames } };
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
    const raw = args[flag] ?? positional[index];
    if (raw === void 0 || raw === null || raw === "") return void 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : void 0;
  };
  switch (command) {
    case "summary":
      return summary(report, { top: number("top", 0), maxItems: number("maxItems", 1) });
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
    case "perf": {
      const types = args.types ?? positional[0];
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: "perf",
        ...typeof types === "string" && types && { types },
        top: number("top", 1),
        ...typeof match === "string" && match && { match },
        fromCommit: number("fromCommit", 3),
        toCommit: number("toCommit", 4)
      });
    }
    case "console": {
      const levels = args.levels ?? positional[0];
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: "console",
        ...typeof levels === "string" && levels && { levels },
        top: number("top", 1),
        ...typeof match === "string" && match && { match },
        fromCommit: number("fromCommit", 3),
        toCommit: number("toCommit", 4),
        ...(args.includeChippy === true || args.includeChippy === "true") && { includeChippy: true }
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
    case "dom-diff": {
      const match = args.match ?? positional[2];
      return dispatch(report, {
        action: "dom-diff",
        fromCommit: number("fromCommit", 0),
        toCommit: number("toCommit", 1),
        ...typeof match === "string" && match && { match },
        maxItems: number("maxItems", 3),
        top: number("top", 99)
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

// src/ab/observations.ts
var SEP = "	";
var BEHAVIOR_KINDS = ["fiber", "prop", "dom", "console", "request"];
function behaviorKind(key) {
  return key.slice(0, key.indexOf(SEP));
}
function fiberIdOf(key) {
  const kind = behaviorKind(key);
  if (kind !== "fiber" && kind !== "prop") return null;
  return key.split(SEP)[1];
}
function parentFiberId(id) {
  const slash = id.lastIndexOf("/");
  if (slash < 0) return null;
  const parent = id.slice(0, slash);
  return parent === "root" ? null : parent;
}
function add(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}
function fiberLabeler(state) {
  const byId = new Map((state?.fibers ?? []).map((entry) => [entry.id, entry]));
  return (id) => {
    const names = [];
    for (let current = id; current; current = parentFiberId(current)) {
      const entry = byId.get(current);
      if (!entry) break;
      names.unshift(entry.key == null ? entry.name : `${entry.name}[key=${entry.key}]`);
    }
    if (!names.length) return id;
    return names.length > 5 ? `\u2026 \u203A ${names.slice(-5).join(" \u203A ")}` : names.join(" \u203A ");
  };
}
function observeFibers(state, behavior) {
  for (const entry of state.fibers) {
    behavior.set(["fiber", entry.id].join(SEP), entry.name);
    for (const [name, prop] of Object.entries(entry.props)) {
      behavior.set(["prop", entry.id, name].join(SEP), `${prop.kind}:${prop.hash}${prop.truncated ? "~" : ""}`);
    }
  }
}
function domSignature(change) {
  const props = Array.isArray(change.props) ? change.props.map((p) => `${String(p?.[0])}=${p?.[2] == null ? "\u2205" : String(p[2])}`).join(" ") : String(change.html ?? "");
  return ["dom", String(change.op), String(change.node), String(change.at), props].join(SEP);
}
function observeReport(report, obs) {
  const { behavior, counts, timings, layers } = obs;
  const commitStats = report.commitStats ?? {};
  const ids = Object.keys(commitStats);
  counts.set("commits", ids.length);
  for (const key of UPSTREAM_COMMIT_STAT_KEYS) counts.set(key, 0);
  for (const id of ids) {
    const stats = tupleToStats(commitStats[id]);
    if (stats) for (const key of UPSTREAM_COMMIT_STAT_KEYS) add(counts, key, stats[key]);
  }
  if (report.renderedByCommit && typeof report.renderedByCommit === "object") {
    layers.rendered = true;
    counts.set("renders", 0);
    counts.set("identityChurn", 0);
    counts.set("trashers", 0);
    for (const entries of Object.values(report.renderedByCommit)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = String(entry?.name ?? "Unknown");
        add(counts, "renders");
        add(counts, `renders ${name}`);
        for (const change of Array.isArray(entry?.propChanges) ? entry.propChanges : []) {
          const churn = change?.kind === "ref-changed" && (change.sameShallow === true || String(change.current ?? "").startsWith("function"));
          if (churn) {
            add(counts, "identityChurn");
            add(counts, `identityChurn ${name}`);
          }
        }
        const t = entry?.trasherCounts;
        if (t) add(counts, "trashers", Number(t.effects || 0) + Number(t.callbacks || 0) + Number(t.memos || 0));
      }
    }
  }
  let renderMs = 0;
  let timed = false;
  for (const timing of Object.values(report.commitTimings ?? {})) {
    const work = Number(timing?.render?.workMs);
    if (Number.isFinite(work)) {
      renderMs += work;
      timed = true;
    }
  }
  if (timed) timings.set("renderMs", Math.round(renderMs * 10) / 10);
  if (report.domByCommit && typeof report.domByCommit === "object") {
    layers.dom = true;
    for (const diff of Object.values(report.domByCommit)) {
      for (const change of diff?.changes ?? []) {
        const key = domSignature(change);
        behavior.set(key, String(Number(behavior.get(key) ?? 0) + 1));
      }
    }
  }
  if (Array.isArray(report.consoleEntries)) {
    layers.console = true;
    for (const entry of report.consoleEntries) {
      if (entry?.chippy || entry?.level !== "error" && entry?.level !== "warn") continue;
      const key = ["console", entry.level, String(entry.message ?? "")].join(SEP);
      behavior.set(key, String(Number(behavior.get(key) ?? 0) + Number(entry.repeat || 1)));
    }
  }
  if (Array.isArray(report.networkRequests)) {
    layers.network = true;
    for (const request of report.networkRequests) {
      if (request?.startedBeforeCapture) continue;
      const key = ["request", String(request?.initiatorType ?? "other"), String(request?.url ?? "")].join(SEP);
      behavior.set(key, String(Number(behavior.get(key) ?? 0) + 1));
    }
  }
  if (Array.isArray(report.perfEntries)) {
    layers.perf = true;
    const perf = perfSummary(report);
    counts.set("longFrames", perf.longFrames);
    counts.set("layoutShifts", perf.layoutShifts);
    timings.set("totalBlockingMs", perf.totalBlockingMs);
    if (perf.worstInteractionMs != null) timings.set("worstInteractionMs", perf.worstInteractionMs);
    timings.set("cls", perf.cls);
  }
}
function observeSample(sample) {
  const state = sample.fiberState;
  const label = fiberLabeler(state);
  const entries = new Map((state?.fibers ?? []).map((entry) => [entry.id, entry]));
  const obs = {
    behavior: /* @__PURE__ */ new Map(),
    counts: /* @__PURE__ */ new Map(),
    timings: /* @__PURE__ */ new Map(),
    layers: { fibers: false, dom: false, console: false, network: false, rendered: false, perf: false },
    page: { url: state?.page?.url ?? null },
    describe(key) {
      const parts = key.split(SEP);
      switch (parts[0]) {
        case "fiber":
          return { label: label(parts[1]), preview: null };
        case "prop":
          return { label: `${label(parts[1])} .${parts[2]}`, preview: entries.get(parts[1])?.props[parts[2]]?.preview ?? null };
        case "dom":
          return { label: `${parts[1]} ${parts[2]} @ ${parts[3]}`, preview: parts[4] || null };
        case "console":
          return { label: `console.${parts[1]}`, preview: parts[2].slice(0, 200) };
        case "request":
          return { label: `${parts[1]} ${parts[2]}`, preview: null };
        default:
          return { label: key, preview: null };
      }
    }
  };
  if (state) {
    obs.layers.fibers = true;
    observeFibers(state, obs.behavior);
  }
  observeReport(sample.report, obs);
  return obs;
}

// src/ab/arm.ts
var ABSENT = "\u2205";
var DEFAULT_AB_TOP = 20;
var CORE_COUNTS = ["commits", "renders", "collateral"];
function spread(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median: Math.round(median * 10) / 10, max: sorted[sorted.length - 1], values };
}
function settledFrom(values) {
  if (values.length < 2) return null;
  const last = values[values.length - 1];
  if (values[values.length - 2] !== last) return null;
  let from = values.length - 2;
  while (from > 0 && values[from - 1] === last) from--;
  return from;
}
function countSeries(arm, key) {
  return arm.observations.map((obs) => obs.counts.get(key) ?? 0);
}
function timingSeries(arm, key) {
  return arm.observations.map((obs) => obs.timings.get(key)).filter((v) => v !== void 0);
}
function behaviorValues(arm, key) {
  return arm.observations.map((obs) => obs.behavior.get(key) ?? ABSENT);
}
function armLayers(arm) {
  const layers = Object.keys(arm.observations[0]?.layers ?? {});
  return Object.fromEntries(layers.map((layer) => {
    const n = arm.observations.filter((obs) => obs.layers[layer]).length;
    return [layer, n === arm.observations.length ? "all" : n ? "some" : "none"];
  }));
}
function behaviorLayer(kind) {
  return kind === "fiber" || kind === "prop" ? "fibers" : kind === "request" ? "network" : kind;
}
function keysOf(arms, field) {
  const keys = /* @__PURE__ */ new Set();
  for (const arm of arms) for (const obs of arm.observations) for (const key of obs[field].keys()) keys.add(key);
  return Array.from(keys).sort();
}
function armStability(arm) {
  const froms = CORE_COUNTS.filter((key) => arm.observations.some((obs) => obs.counts.has(key))).map((key) => settledFrom(countSeries(arm, key)));
  const settled = arm.observations.length >= 2 && froms.every((from) => from !== null);
  return {
    samples: arm.observations.length,
    settledFrom: settled ? Math.max(0, ...froms) + 1 : null,
    settled
  };
}
function pageWarnings(arm) {
  const paths = new Set(arm.observations.map((obs) => {
    try {
      return obs.page.url ? new URL(obs.page.url).pathname : null;
    } catch {
      return obs.page.url;
    }
  }).filter(Boolean));
  return paths.size > 1 ? [`arm ${arm.name} has samples from ${paths.size} pages: ${Array.from(paths).join(", ")}`] : [];
}
function emptySamples(arm) {
  return arm.observations.flatMap((obs, i) => (obs.counts.get("commits") ?? 0) === 0 ? [i + 1] : []);
}
function armWarnings(arm) {
  const warnings = pageWarnings(arm);
  const empty = emptySamples(arm);
  if (empty.length) warnings.push(`arm ${arm.name}: sample${empty.length === 1 ? "" : "s"} ${empty.join(", ")} recorded no React commit; check that the page rendered and Avalanche was recording`);
  if (arm.observations.length < 2) warnings.push(`arm ${arm.name} has ${arm.observations.length} sample: its noise is unknown; take at least 2`);
  for (const [layer, coverage] of Object.entries(armLayers(arm))) {
    if (coverage === "some") warnings.push(`arm ${arm.name}: only some samples carry ${layer}; it is not judged`);
  }
  const stability = armStability(arm);
  if (arm.observations.length >= 2 && !stability.settled) {
    warnings.push(`arm ${arm.name} has not settled: its last two samples differ in commits, renders, or collateral; take more samples, or drop warm-up samples with --skip`);
  }
  return warnings;
}
function isTotalKey(key) {
  return !key.includes(" ");
}
function summarizeArm(arm, options = {}) {
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_AB_TOP));
  const behaviorKeys = keysOf([arm], "behavior");
  const byKind = Object.fromEntries(BEHAVIOR_KINDS.map((kind) => [kind, { keys: 0, varying: 0 }]));
  const varying = [];
  for (const key of behaviorKeys) {
    const kind = behaviorKind(key);
    byKind[kind].keys++;
    const distinct = new Set(behaviorValues(arm, key)).size;
    if (distinct > 1) {
      byKind[kind].varying++;
      const owner = arm.observations.find((obs) => obs.behavior.has(key));
      varying.push({ kind, distinct, ...owner.describe(key) });
    }
  }
  const countRows = keysOf([arm], "counts").map((key) => {
    const values = countSeries(arm, key);
    const s = spread(values);
    const from = settledFrom(values);
    return { key, ...s, stable: s.min === s.max, settledFrom: from === null ? null : from + 1 };
  });
  const byMedian = (a, b) => b.median - a.median;
  return {
    ok: true,
    arm: arm.name,
    files: arm.files,
    skipped: arm.skipped,
    ...armStability(arm),
    layers: armLayers(arm),
    behavior: {
      keys: behaviorKeys.length,
      varying: varying.length,
      byKind,
      /** Keys that differ between samples: they cannot be judged in a comparison. */
      varyingTop: varying.slice(0, top)
    },
    counts: {
      totals: countRows.filter((row) => isTotalKey(row.key)),
      components: countRows.filter((row) => !isTotalKey(row.key)).sort(byMedian).slice(0, top),
      varyingComponents: countRows.filter((row) => !isTotalKey(row.key) && !row.stable).length
    },
    timings: keysOf([arm], "timings").map((key) => ({ key, ...spread(timingSeries(arm, key)) })),
    warnings: armWarnings(arm)
  };
}

// src/ab/compare.ts
var MIN_TIMING_SAMPLES = 3;
function isDrifting(values) {
  if (values.length < MIN_TIMING_SAMPLES) return false;
  const steps = values.slice(1).map((v, i) => Math.sign(v - values[i]));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}
function judgeSpreads(a, b, judged = true) {
  if (!judged) return "not-judged";
  if (a.min === a.max && b.min === b.max && a.min === b.min) return "same";
  if (b.max < a.min) return "better";
  if (b.min > a.max) return "worse";
  return "noise";
}
function side(arm, key, value) {
  if (value === ABSENT) return { value: "absent", preview: null };
  const owner = arm.observations.find((obs) => obs.behavior.has(key));
  const kind = behaviorKind(key);
  if (kind === "fiber") return { value: "present", preview: null };
  if (kind === "prop") return { value: "set", preview: owner?.describe(key).preview ?? null };
  return { value: `${value}\xD7`, preview: null };
}
var KIND_ORDER = ["dom", "fiber", "prop", "console", "request"];
function rootDifferences(keys) {
  const fibers = new Set(keys.filter((k) => behaviorKind(k) === "fiber").map((k) => fiberIdOf(k)));
  const changedIds = keys.map(fiberIdOf).filter((id) => id !== null);
  const underFiber = (id) => {
    for (let p = parentFiberId(id); p; p = parentFiberId(p)) if (fibers.has(p)) return true;
    return false;
  };
  const kept = keys.filter((key) => {
    const id = fiberIdOf(key);
    if (id === null) return true;
    if (underFiber(id)) return false;
    if (behaviorKind(key) === "prop") {
      if (fibers.has(id)) return false;
      if (key.endsWith("	children") && changedIds.some((other) => other.startsWith(`${id}/`))) return false;
    }
    return true;
  });
  return { kept, collapsed: keys.length - kept.length };
}
function groupByLabel(rows) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const id = `${row.kind}	${row.label}`;
    const group = groups.get(id);
    if (group) group.count++;
    else groups.set(id, { ...row, count: 1 });
  }
  return [...groups.values()].sort((x, y) => y.count - x.count);
}
function compareBehavior(a, b, top) {
  const layersA = armLayers(a);
  const layersB = armLayers(b);
  const byKind = Object.fromEntries(BEHAVIOR_KINDS.map((kind) => [kind, { judged: 0, unjudged: 0, changed: 0 }]));
  const changed = [];
  const unjudged = [];
  let notCovered = 0;
  for (const key of keysOf([a, b], "behavior")) {
    const kind = behaviorKind(key);
    const layer = behaviorLayer(kind);
    if (layersA[layer] !== "all" || layersB[layer] !== "all") {
      notCovered++;
      continue;
    }
    const va = new Set(behaviorValues(a, key));
    const vb = new Set(behaviorValues(b, key));
    if (va.size > 1 || vb.size > 1) {
      byKind[kind].unjudged++;
      unjudged.push(key);
      continue;
    }
    byKind[kind].judged++;
    const [left] = va;
    const [right] = vb;
    if (left !== right) changed.push(key);
  }
  const { kept, collapsed } = rootDifferences(changed);
  for (const key of kept) byKind[behaviorKind(key)].changed++;
  kept.sort((x, y) => KIND_ORDER.indexOf(behaviorKind(x)) - KIND_ORDER.indexOf(behaviorKind(y)) || (x < y ? -1 : 1));
  const describe = (key) => (a.observations.find((o) => o.behavior.has(key)) ?? b.observations.find((o) => o.behavior.has(key))).describe(key);
  return {
    changed: kept.length,
    /** Differences hidden under a root difference: an added fiber's props, a parent's `children`. */
    collapsed,
    unjudged: unjudged.length,
    /** Keys of a layer that a sample of either arm did not carry. */
    notCovered,
    byKind,
    items: kept.slice(0, top).map((key) => ({
      kind: behaviorKind(key),
      label: describe(key).label,
      ...behaviorKind(key) === "dom" && { detail: describe(key).preview },
      a: side(a, key, behaviorValues(a, key)[0]),
      b: side(b, key, behaviorValues(b, key)[0])
    })),
    unjudgedTop: groupByLabel(unjudged.map((key) => ({ kind: behaviorKind(key), label: describe(key).label }))).slice(0, Math.min(top, 10))
  };
}
function perfRow(key, a, b, judged = true) {
  return { key, a: { min: a.min, median: a.median, max: a.max }, b: { min: b.min, median: b.median, max: b.max }, delta: Math.round((b.median - a.median) * 10) / 10, change: judgeSpreads(a, b, judged) };
}
function comparePerformance(a, b, top) {
  const rows = keysOf([a, b], "counts").map((key) => perfRow(key, spread(countSeries(a, key)), spread(countSeries(b, key))));
  const components = rows.filter((row) => !isTotalKey(row.key) && row.change !== "same").sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.key < y.key ? -1 : 1));
  const timingJudged = a.observations.length >= MIN_TIMING_SAMPLES && b.observations.length >= MIN_TIMING_SAMPLES;
  const timings = keysOf([a, b], "timings").flatMap((key) => {
    const va = timingSeries(a, key);
    const vb = timingSeries(b, key);
    if (!va.length || !vb.length) return [];
    const row = perfRow(key, spread(va), spread(vb), timingJudged);
    const drifting = [[a, va], [b, vb]].filter(([, values]) => isDrifting(values)).map(([arm]) => arm.name);
    return [drifting.length && (row.change === "better" || row.change === "worse") ? { ...row, change: "drifting", drifting } : row];
  });
  const tally = (change) => rows.filter((row) => row.change === change).length;
  return {
    better: tally("better"),
    worse: tally("worse"),
    noise: tally("noise"),
    totals: rows.filter((row) => isTotalKey(row.key)),
    components: components.slice(0, top),
    componentsChanged: components.length,
    timings,
    timingNote: !timingJudged ? `timings are judged with at least ${MIN_TIMING_SAMPLES} samples per arm` : timings.some((row) => row.change === "drifting") ? "a drifting timing only climbed or fell across an arm's samples; skip warm-up samples with --skip, add samples, or capture the arms interleaved (a, b, a, b)" : null
  };
}
function compareArms(a, b, options = {}) {
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_AB_TOP));
  const behavior = compareBehavior(a, b, top);
  const performance2 = comparePerformance(a, b, top);
  const reasons = [];
  for (const arm of [a, b]) {
    if (arm.observations.length < 2) reasons.push(`arm ${arm.name} has ${arm.observations.length} sample: noise inside it is unknown, so no difference can be told from noise`);
  }
  for (const [arm, other] of [[a, b], [b, a]]) {
    const empty = emptySamples(arm);
    if (empty.length && emptySamples(other).length < other.observations.length) {
      reasons.push(`arm ${arm.name} recorded no React commit in sample${empty.length === 1 ? "" : "s"} ${empty.join(", ")} while arm ${other.name} did: an empty capture is not less work`);
    }
  }
  const judged = BEHAVIOR_KINDS.reduce((sum, kind) => sum + behavior.byKind[kind].judged, 0);
  if (!judged) reasons.push("no behavior key could be judged: both arms need fiber state or DOM changes in every sample");
  const verdict = reasons.length ? "inconclusive" : behavior.changed ? "behavior-changed" : "equivalent";
  if (verdict === "behavior-changed") reasons.push(`${behavior.changed} behavior difference${behavior.changed === 1 ? "" : "s"} stable inside each arm`);
  return {
    ok: true,
    verdict,
    reasons,
    arms: {
      a: { name: a.name, files: a.files, skipped: a.skipped, ...armStability(a) },
      b: { name: b.name, files: b.files, skipped: b.skipped, ...armStability(b) }
    },
    behavior,
    performance: performance2,
    warnings: [...armWarnings(a), ...armWarnings(b)]
  };
}

// src/ab/files.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_zlib = require("node:zlib");

// src/ab/sample.ts
var AB_SAMPLE_KIND = "chippy-ab-sample";
function isAbSample(value) {
  const v = value;
  return !!v && typeof v === "object" && v.kind === AB_SAMPLE_KIND && v.version === 1 && !!v.report && typeof v.report === "object" && typeof v.report.commitStats === "object";
}
function unwrapFiberState(value) {
  const candidates = [value, value?.result, value?.payload?.result, value?.payload];
  const state = candidates.find((c) => c && typeof c === "object" && c.version === 1 && Array.isArray(c.fibers));
  if (state) return { state };
  const error = candidates.map((c) => c && typeof c === "object" ? c.error : null).find((e) => typeof e === "string");
  return { error: error || "response has no fiber state capture" };
}
function buildAbSample(input) {
  return {
    kind: AB_SAMPLE_KIND,
    version: 1,
    arm: input.arm,
    label: input.label,
    index: input.index,
    capturedAt: input.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    report: input.report,
    fiberState: input.fiberState,
    fiberStateError: input.fiberState ? null : input.fiberStateError ?? "no fiber state"
  };
}

// src/ab/files.ts
var SAMPLE_FILE = /^sample-(\d+)\.json(\.gz)?$/;
function readJsonFile(file) {
  const bytes = (0, import_node_fs.readFileSync)(file);
  const gzipped = bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139;
  return JSON.parse((gzipped ? (0, import_node_zlib.gunzipSync)(bytes) : bytes).toString("utf8"));
}
function sampleFiles(dir) {
  return (0, import_node_fs.readdirSync)(dir).map((name) => ({ name, match: SAMPLE_FILE.exec(name) })).filter((entry) => entry.match).sort((x, y) => Number(x.match[1]) - Number(y.match[1])).map((entry) => (0, import_node_path.join)(dir, entry.name));
}
function resolveArm(spec) {
  if ((0, import_node_fs.existsSync)(spec) && (0, import_node_fs.statSync)(spec).isDirectory()) {
    return { name: (0, import_node_path.basename)((0, import_node_path.resolve)(spec)), files: sampleFiles(spec) };
  }
  const files = spec.split(",").map((s) => s.trim()).filter(Boolean);
  return { name: files.length === 1 ? (0, import_node_path.basename)(files[0]) : spec, files };
}
function loadArm(spec, options = {}) {
  const { name, files } = resolveArm(spec);
  if (!files.length) throw new Error(`arm ${spec} has no sample files (expected sample-<n>.json.gz from ab-capture)`);
  const skip = Math.max(0, Math.floor(Number(options.skip) || 0));
  if (skip >= files.length) throw new Error(`--skip ${skip} leaves no sample in arm ${name} (${files.length} samples)`);
  const used = files.slice(skip);
  const observations = used.map((file) => {
    const sample = readJsonFile(file);
    if (!isAbSample(sample)) throw new Error(`${file} is not an A/B sample (write samples with ab-capture)`);
    return observeSample(sample);
  });
  return { name, files: used, skipped: skip, observations };
}
function nextSamplePath(dir) {
  (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  const last = sampleFiles(dir).map((file) => Number(SAMPLE_FILE.exec((0, import_node_path.basename)(file))[1])).pop() ?? 0;
  const index = last + 1;
  return { file: (0, import_node_path.join)(dir, `sample-${index}.json.gz`), index };
}
function writeSample(dir, input) {
  const { file, index } = nextSamplePath(dir);
  const sample = buildAbSample({ ...input, arm: (0, import_node_path.basename)((0, import_node_path.resolve)(dir)), index });
  const data = (0, import_node_zlib.gzipSync)(JSON.stringify(sample), { level: 1 });
  (0, import_node_fs.writeFileSync)(file, data);
  return { file, sample, bytes: data.length };
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
  perf          [types] [top] [match] [fromCommit] [toCommit]
                (--types csv --top N --match regex --fromCommit N --toCommit N)
  timeline      [fromCommit] [toCommit] [minRequestMs] [exclude]
                (--fromCommit N --toCommit N --minRequestMs ms --top N --exclude regex --format summary|map|full)
  dom-diff      [fromCommit] [toCommit] [match] [maxItems]
                (--fromCommit N --toCommit N --match regex --maxItems N --top N)
  source-search --name <regex> [--top N]

A/B (an arm is a directory of samples, or comma-separated sample files):
  ab-save    <armDir> <fiberStateFile> [label] < export response
  ab-arm     <arm> [--skip N] [--top N]
  ab-compare <armA> <armB> [--skip N] [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks network
commit-peek include values: stats,sources,timing,metrics,hooks,actions,rendered,network,dom,perf
perf types: mark measure long-animation-frame layout-shift event
  largest-contentful-paint paint navigation longtask
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
function readSaved(file) {
  const bytes = (0, import_node_fs2.readFileSync)(file);
  const gzipped = bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139;
  return (gzipped ? (0, import_node_zlib2.gunzipSync)(bytes) : bytes).toString("utf8");
}
function main(argv) {
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (argv[0] === "normalize") {
    const report2 = unwrapSavedReport(parseJson((0, import_node_fs2.readFileSync)(0, "utf8"), "helper response"));
    if (!report2) fail("response has no Avalanche export (expected meta and commitStats); check avalanche-status");
    const trimmed = keepLastCommits(report2, Number(argv[1]) || 0);
    process.stdout.write(JSON.stringify(trimmed));
    return;
  }
  if (argv[0] === "save") {
    const out = argv[2];
    if (!out) fail("save requires <count> <file>");
    const response = parseJson((0, import_node_fs2.readFileSync)(0, "utf8"), "helper response");
    const report2 = unwrapSavedReport(response);
    if (!report2) fail("response has no Avalanche export (expected meta and commitStats); check avalanche-status");
    const nameRecovery = response?.nameRecovery ?? response?.result?.nameRecovery;
    const trimmed = keepLastCommits(report2, Number(argv[1]) || 0);
    const text = JSON.stringify(trimmed);
    const data = out.endsWith(".gz") ? (0, import_node_zlib2.gzipSync)(text, { level: 1 }) : text;
    (0, import_node_fs2.writeFileSync)(out, data);
    const commits = Object.keys(trimmed.commitStats || {}).length;
    const jsonBytes = Buffer.byteLength(text);
    const bytes = typeof data === "string" ? jsonBytes : data.length;
    process.stdout.write(`${JSON.stringify({ ok: true, file: out, bytes, ...bytes !== jsonBytes && { jsonBytes }, commits, ...nameRecovery ? { nameRecovery } : {} })}
`);
    return;
  }
  if (argv[0] === "ab-save") {
    const [, dir, fiberFile, label] = argv;
    if (!dir || !fiberFile) fail("ab-save requires <armDir> <fiberStateFile> [label]");
    const report2 = unwrapSavedReport(parseJson((0, import_node_fs2.readFileSync)(0, "utf8"), "helper response"));
    if (!report2) fail("response has no Avalanche export (expected meta and commitStats); install Avalanche and run the stimulus first");
    let fiber;
    try {
      fiber = unwrapFiberState(readJsonFile(fiberFile));
    } catch (error) {
      fiber = { error: error.message };
    }
    (0, import_node_fs2.rmSync)(fiberFile, { force: true });
    const { file: file2, sample, bytes } = writeSample(dir, {
      label: label || null,
      report: report2,
      fiberState: "state" in fiber ? fiber.state : null,
      fiberStateError: "error" in fiber ? fiber.error : null
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      file: file2,
      arm: sample.arm,
      sample: sample.index,
      label: sample.label,
      bytes,
      commits: Object.keys(report2.commitStats).length,
      fibers: sample.fiberState?.fiberCount ?? null,
      ...sample.fiberStateError && { fiberStateError: sample.fiberStateError }
    })}
`);
    return;
  }
  if (argv[0] === "ab-arm" || argv[0] === "ab-compare") {
    const args = parseArgs(argv.slice(1));
    const want = argv[0] === "ab-arm" ? 1 : 2;
    if (args._.length < want) fail(argv[0] === "ab-arm" ? "ab-arm requires <arm>" : "ab-compare requires <armA> <armB>");
    let arms;
    try {
      arms = args._.slice(0, want).map((spec) => loadArm(spec, { skip: args.skip }));
    } catch (error) {
      fail(error.message);
    }
    const result2 = want === 1 ? summarizeArm(arms[0], { top: args.top }) : compareArms(arms[0], arms[1], { top: args.top });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    return;
  }
  const [file, command, ...rest] = argv;
  if (!command) fail("command missing");
  const report = unwrapSavedReport(parseJson(readSaved(file), file));
  if (!report) fail(`${file} is not an Avalanche export (expected meta and commitStats)`);
  const result = analyzeSavedReport(report, command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  if (result.ok === false) process.exitCode = 1;
}
main(process.argv.slice(2));
