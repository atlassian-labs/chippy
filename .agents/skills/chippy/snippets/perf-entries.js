// Browser performance entries, mapped to components and Avalanche commits.
//
// READ-ONLY. Reads the entries the browser has buffered for this document
// (PerformanceObserver with `buffered: true`) and returns them compactly:
//   layout-shift           value, hadRecentInput, source nodes → component
//   long-animation-frame   duration, blockingDuration, top scripts with forced layout
//   event                  slow interaction timings (the inputs to INP) → target component
//   largest-contentful-paint  LCP time, size, element → component
//   paint, navigation      FCP and TTFB / DOMContentLoaded / load
//
// When Avalanche is installed, each entry also carries the commits it lines up
// with on the shared `performance.now()` clock (see references/avalanche-detector.md,
// "Aligning commits with browser performance data"). Alignment is temporal
// proximity, not causality.
//
// The browser keeps a bounded buffer per entry type (about 150 entries; 200
// for long animation frames). On a long-lived page the oldest entries are gone.
// The event buffer holds only events that took at least 104 ms; faster
// interactions are never buffered, so they do not appear here.
//
// Args:
//   --types <csv>        entry types (default: all listed above that the browser supports)
//   --since <ms>         only entries with startTime >= since (performance.now() ms; default 0)
//   --max <N>            entries returned per type, slowest/largest first (default 20)
//   --scripts <N>        scripts kept per long animation frame (default 5)
//   --commits <N>        overlapping commit ids kept per entry (default 10)
//
// Returns: { ok, timeOrigin, now, supported, unsupported, avalanche, summary, entries }

const ALL_TYPES = ['layout-shift', 'long-animation-frame', 'event', 'largest-contentful-paint', 'paint', 'navigation'];
const supportedTypes = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
const requested = ctx.args.types ? String(ctx.args.types).split(',').map((s) => s.trim()).filter(Boolean) : ALL_TYPES;
const types = requested.filter((t) => supportedTypes.includes(t));
const unsupported = requested.filter((t) => !supportedTypes.includes(t));
const since = Number(ctx.args.since) || 0;
const max = Number(ctx.args.max) || 20;
const scriptMax = Number(ctx.args.scripts) || 5;
const commitMax = Number(ctx.args.commits) || 10;
const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

// ── Collect buffered entries ────────────────────────────────────────────────
async function collect(type) {
  const seen = [];
  await new Promise((resolve) => {
    let observer;
    const done = () => {
      try { seen.push(...observer.takeRecords()); observer.disconnect(); } catch (_) {}
      resolve();
    };
    try {
      observer = new PerformanceObserver((list) => { seen.push(...list.getEntries()); });
      observer.observe({ type, buffered: true });
    } catch (e) {
      ctx.log.push(type + ': ' + (e && e.message));
      resolve();
      return;
    }
    // Buffered entries are delivered in the next observer task.
    setTimeout(done, 50);
  });
  return seen.filter((e) => e.startTime >= since);
}

// ── DOM node → component ────────────────────────────────────────────────────
const { getDisplayName, fiberInfo } = ctx.helpers;
function componentOf(node) {
  let el = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!el) return null;
  const testId = el.closest ? el.closest('[data-testid]')?.getAttribute('data-testid') || null : null;
  let fiber = null;
  for (let cur = el; cur && !fiber; cur = cur.parentElement) {
    const key = Object.keys(cur).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (key) fiber = cur[key];
  }
  while (fiber && (typeof fiber.type === 'string' || fiber.type == null)) fiber = fiber.return;
  const info = fiber ? fiberInfo(fiber) : null;
  return {
    element: el.tagName ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : null,
    testId,
    component: fiber ? getDisplayName(fiber) : null,
    source: info ? info.source || null : null,
  };
}

// ── Avalanche commits on the same clock ─────────────────────────────────────
let commits = [];
let avalanche = null;
try {
  const api = globalThis.__AVALANCHE__;
  const report = api && typeof api.report === 'function' ? api.report() : null;
  const timings = report && report.commitTimings;
  if (timings && typeof timings === 'object') {
    commits = Object.keys(timings)
      .map((id) => ({ id: Number(id), start: timings[id].startTime, end: timings[id].endTime }))
      .filter((c) => typeof c.start === 'number')
      .sort((a, b) => a.start - b.start);
    avalanche = {
      commits: commits.length,
      reportVersion: report.meta ? report.meta.version : null,
      timeOriginMatches: report.meta ? report.meta.timeOrigin === performance.timeOrigin : null,
    };
    if (!commits.length && Object.keys(timings).length) {
      ctx.log.push('Avalanche report has no absolute commit timestamps; reinstall a current runtime (report version 7+).');
    }
  }
} catch (e) {
  ctx.log.push('avalanche: ' + (e && e.message));
}

// `during`: commits that ended inside [from, to]. `before`: the latest commit
// that ended at or before `from`, with the gap in ms.
function commitsNear(from, to) {
  if (!commits.length) return undefined;
  const during = commits.filter((c) => c.start >= from && c.start <= to).map((c) => c.id);
  let before = null;
  for (const c of commits) {
    if (c.start <= from) before = c;
    else break;
  }
  return {
    during: during.slice(0, commitMax),
    duringCount: during.length,
    before: before ? { commitId: before.id, gapMs: round(from - before.start) } : null,
  };
}

// ── Per-type shaping ────────────────────────────────────────────────────────
const shape = {
  'layout-shift': (e) => ({
    startTime: round(e.startTime),
    value: Math.round(e.value * 10000) / 10000,
    hadRecentInput: e.hadRecentInput,
    sources: (e.sources || []).slice(0, 5).map((s) => ({
      ...componentOf(s.node),
      previousRect: s.previousRect ? [round(s.previousRect.x), round(s.previousRect.y), round(s.previousRect.width), round(s.previousRect.height)] : null,
      currentRect: s.currentRect ? [round(s.currentRect.x), round(s.currentRect.y), round(s.currentRect.width), round(s.currentRect.height)] : null,
    })),
    commits: commitsNear(e.startTime, e.startTime),
  }),
  'long-animation-frame': (e) => ({
    startTime: round(e.startTime),
    duration: round(e.duration),
    blockingDuration: round(e.blockingDuration),
    renderStart: round(e.renderStart),
    styleAndLayoutStart: round(e.styleAndLayoutStart),
    scripts: (e.scripts || [])
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, scriptMax)
      .map((s) => ({
        duration: round(s.duration),
        forcedStyleAndLayoutDuration: round(s.forcedStyleAndLayoutDuration),
        invoker: s.invoker || null,
        invokerType: s.invokerType || null,
        sourceURL: s.sourceURL || null,
        sourceFunctionName: s.sourceFunctionName || null,
        sourceCharPosition: typeof s.sourceCharPosition === 'number' ? s.sourceCharPosition : null,
      })),
    commits: commitsNear(e.startTime, e.startTime + e.duration),
  }),
  event: (e) => ({
    name: e.name,
    startTime: round(e.startTime),
    duration: e.duration,
    inputDelay: round(e.processingStart - e.startTime),
    processing: round(e.processingEnd - e.processingStart),
    presentationDelay: round(e.startTime + e.duration - e.processingEnd),
    interactionId: e.interactionId || 0,
    target: componentOf(e.target),
    commits: commitsNear(e.startTime, e.startTime + e.duration),
  }),
  'largest-contentful-paint': (e) => ({
    startTime: round(e.startTime),
    renderTime: round(e.renderTime),
    loadTime: round(e.loadTime),
    size: e.size,
    url: e.url || null,
    element: componentOf(e.element),
    commits: commitsNear(e.startTime, e.startTime),
  }),
  paint: (e) => ({ name: e.name, startTime: round(e.startTime) }),
  navigation: (e) => ({
    type: e.type,
    ttfb: round(e.responseStart),
    domContentLoaded: round(e.domContentLoadedEventEnd),
    load: round(e.loadEventEnd),
    transferSize: e.transferSize,
  }),
};

const rank = {
  'layout-shift': (e) => e.value,
  'long-animation-frame': (e) => e.blockingDuration,
  event: (e) => e.duration,
};

// ── Summary metrics ─────────────────────────────────────────────────────────
// CLS: largest session window (gap < 1 s, window < 5 s) of shifts without recent input.
function cumulativeLayoutShift(shifts) {
  let best = 0;
  let current = 0;
  let first = null;
  let last = null;
  for (const s of shifts) {
    if (s.hadRecentInput) continue;
    if (first !== null && s.startTime - last < 1000 && s.startTime - first < 5000) {
      current += s.value;
    } else {
      current = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    best = Math.max(best, current);
  }
  return Math.round(best * 10000) / 10000;
}

const raw = {};
for (const type of types) raw[type] = await collect(type);

const summary = {};
if (raw['layout-shift']) {
  summary.cls = cumulativeLayoutShift(raw['layout-shift']);
  summary.layoutShifts = raw['layout-shift'].length;
}
if (raw['long-animation-frame']) {
  summary.longFrames = raw['long-animation-frame'].length;
  summary.totalBlockingMs = round(raw['long-animation-frame'].reduce((sum, e) => sum + (e.blockingDuration || 0), 0));
}
if (raw.event) {
  // Longest duration per interaction. Real INP is a high percentile over all
  // interactions; with few interactions this is the worst one.
  const perInteraction = new Map();
  for (const e of raw.event) {
    if (!e.interactionId) continue;
    perInteraction.set(e.interactionId, Math.max(perInteraction.get(e.interactionId) || 0, e.duration));
  }
  summary.interactions = perInteraction.size;
  summary.worstInteractionMs = perInteraction.size ? Math.max(...perInteraction.values()) : null;
}
if (raw['largest-contentful-paint'] && raw['largest-contentful-paint'].length) {
  summary.lcpMs = round(raw['largest-contentful-paint'][raw['largest-contentful-paint'].length - 1].startTime);
}
if (raw.paint) {
  const fcp = raw.paint.find((e) => e.name === 'first-contentful-paint');
  summary.fcpMs = fcp ? round(fcp.startTime) : null;
}
if (raw.navigation && raw.navigation[0]) summary.ttfbMs = round(raw.navigation[0].responseStart);

const entries = {};
for (const type of types) {
  const list = raw[type].slice();
  if (rank[type]) list.sort((a, b) => rank[type](b) - rank[type](a));
  entries[type] = { count: raw[type].length, items: list.slice(0, max).map(shape[type]) };
}

return {
  ok: true,
  timeOrigin: performance.timeOrigin,
  now: round(performance.now()),
  supported: types,
  unsupported,
  avalanche,
  summary,
  entries,
};
