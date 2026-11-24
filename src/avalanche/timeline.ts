/**
 * One timeline for an Avalanche report: user input, network requests,
 * Suspense fallbacks, and React commits on the shared `performance.now()`
 * clock, relative to an origin (by default the interaction that started the
 * window).
 *
 * The timeline is organized around what the user can see. A Suspense boundary
 * that shows its fallback ("lock") and later shows its content ("unlock") is a
 * wait the user experiences, however little work it involves. Other commits
 * are updates: they cost CPU and may or may not change the screen. The
 * `perceived` summary lists each wait with the requests that were still in
 * flight when it ended and the updates that ran while it waited.
 *
 * Browser performance entries the report carries (`perfEntries`) form a
 * `perf` lane: long animation frames, User Timing measures and marks, layout
 * shifts, slow events, and LCP. A long frame that spans several commits ran
 * them without a paint between them.
 *
 * Console entries (`consoleEntries`) form a `console` lane: errors, uncaught
 * errors, rejections, and warnings, then other levels up to `maxLogs`. The
 * lane runs from the origin until the commit after the window starts, or to
 * the end of the capture, so an error after the last commit is still told.
 * Chippy's own messages are left out.
 *
 * Produces structured lanes plus two renderings: a Mermaid gantt chart for
 * chat or docs, and an aligned text listing for terminals. Runs on report
 * data, live or saved, so capture pays nothing for it.
 *
 * Lines up events in time; it does not prove cause. A request that ends just
 * before an unlock is a candidate, not a proven gate. Waits are paired by
 * the detector's boundary id (by depth in reports without ids), so a boundary
 * that remounts reads as a new boundary. Commit `endTime - startTime` is the detector's
 * own overhead, so render time is reported only when the report records a
 * render start.
 *
 * Commits run inside tasks, and the browser paints only after the task ends.
 * When the report records `paintAt` (when the commit reached the screen),
 * what the user sees is placed at that time: Suspense waits, screen changes,
 * and VC50/VC90/VC100. Commit rows keep the commit time and note the paint
 * when it came at least `PAINT_NOTE_MS` later. Reports without `paintAt` use
 * commit times throughout.
 */

import type { ConsoleEntry, ConsoleLevel, ConsoleSource } from './console-capture';
import type { NetworkRequest } from './network-capture';
import { isOwnFrame, type OwnWorkSpan } from './own-work';
import type { PerfEntry } from './perf-capture';
import type { ScreenChange } from './screen-changes';
import { screenStability, settleMapSvg, type ScreenFrame, type ScreenStability } from './screen-stability';
import { distinguishingLabels, type SuspenseLocation } from './suspense-location';

type Tuple = unknown[];
type ReportLike = {
  commitStats?: Record<string, Tuple>;
  renderedByCommit?: Record<string, unknown[]>;
  commitTimings?: Record<string, { startTime?: unknown; endTime?: unknown; paintAt?: unknown; render?: { renderStart?: unknown } | null }>;
  suspenseByCommit?: Record<string, Array<{ depth?: unknown; boundary?: unknown; entered?: unknown; left?: unknown; location?: SuspenseLocation }>>;
  screenByCommit?: Record<string, ScreenChange>;
  sourcesByCommit?: Record<string, Array<{ sourceId?: unknown; collateral?: unknown }>>;
  interactionsByCommit?: Record<string, Array<{ id?: unknown; action?: unknown; timestamp?: unknown; location?: { dom?: { nearestTestId?: unknown; text?: unknown; tag?: unknown } }; event?: { trusted?: unknown; key?: unknown; modifiers?: unknown } }>>;
  networkRequests?: NetworkRequest[];
  perfEntries?: PerfEntry[];
  consoleEntries?: ConsoleEntry[];
  ownWork?: OwnWorkSpan[];
  [key: string]: unknown;
};

export interface TimelineOptions {
  /** First commit id in the window (default: the first commit at or after the first interaction). */
  fromCommit?: number;
  /** Last commit id in the window (default: the last commit). */
  toCommit?: number;
  /** Requests shorter than this are left out (default 50 ms). */
  minRequestMs?: number;
  /** Most requests drawn, longest kept (default 30). */
  maxRequests?: number;
  /** Most update commits drawn, by rendered components; lock and unlock commits are always kept (default 25). */
  maxCommits?: number;
  /** Requests whose URL matches this case-insensitive regex are left out. */
  exclude?: string;
  /** Most User Timing marks listed, earliest kept (default 40). */
  maxMarks?: number;
  /** Most console info, log, and debug messages listed, earliest kept (default 20). Errors and warnings are kept up to 50. */
  maxLogs?: number;
  /** Also render the settle map SVG (each part of the screen colored by when it last changed). */
  settleMap?: boolean;
}

export type CommitKind = 'lock' | 'unlock' | 'swap' | 'update';

function inputDetail(event: { trusted?: unknown; key?: unknown; modifiers?: unknown } | undefined): string | null {
  if (!event || typeof event !== 'object') return null;
  const parts: string[] = [];
  if (typeof event.key === 'string') parts.push(event.key);
  const held = Array.isArray(event.modifiers) ? event.modifiers.filter((m): m is string => typeof m === 'string' && m !== event.key) : [];
  if (held.length) parts.push('with ' + held.join('+'));
  if (event.trusted === false) parts.push('dispatched');
  return parts.length ? parts.join(' ') : null;
}

function inputLabel(i: TimelineInput): string {
  return i.action + (i.detail ? ' ' + i.detail : '') + (i.target ? ' ' + i.target : '');
}

/**
 * `detail` names the key and held modifiers, and says when page code dispatched
 * the event (`dispatched`). Trusted key events also come from switching apps
 * (Cmd+Tab sends the page Meta keydown/keyup), so a key event is not proof of
 * a deliberate key press.
 */
export interface TimelineInput { t: number; action: string; target: string | null; detail: string | null }
export interface TimelineRequest { id: number; label: string; start: number; end: number; durationMs: number; initiatorType: string; cached: boolean }
/** A console message on the timeline: its first line, cut to 140 characters. */
export interface TimelineConsole {
  id: number;
  level: ConsoleLevel;
  source: ConsoleSource;
  label: string;
  t: number;
  repeat: number;
  /** `file:line:column` of the caller, when the entry has one. */
  location: string | null;
  /** The last commit that started at or before the message. */
  afterCommit: number | null;
}
/** Browser performance entries drawn on the timeline. */
export type TimelinePerfKind = 'frame' | 'measure' | 'mark' | 'shift' | 'event' | 'lcp';
export interface TimelinePerf {
  id: number;
  kind: TimelinePerfKind;
  label: string;
  start: number;
  end: number;
  durationMs: number;
  /** Long frames: blocking time. Layout shifts: the shift value. Events: input delay. */
  value: number | null;
  /** Commits that started inside the entry's span. */
  commits: number[];
  /** Long frames: true when Chippy's own work caused the frame; such frames stay out of the blocking totals. */
  chippy?: true;
}
export interface TimelineSuspense {
  /** `b<id>` from the detector, or `@<depth>` for reports without boundary ids. */
  boundary: string;
  depth: number;
  /** Boundary name, else the first parent or owner that sets it apart from the other boundaries. */
  label: string | null;
  start: number;
  end: number | null;
  enteredAt: number;
  leftAt: number | null;
}
export interface TimelineCommit {
  commitId: number;
  t: number;
  /** Render start relative to the origin, when the report records it. */
  renderStart: number | null;
  /** When the commit reached the screen, relative to the origin, when the report records it. */
  paintAt: number | null;
  rendered: number;
  kind: CommitKind;
  suspense: string[];
  sources: string[];
  /** Screen area this commit changed, when the report records it. */
  screen: { share: number; region: string | null } | null;
}

export interface TimelineBoundary {
  boundary: string;
  depth: number;
  label: string | null;
  /** Five parents and five owners with identifying props; see `suspense-location.ts`. */
  location: SuspenseLocation | null;
}

export interface PerceivedWait {
  boundary: string;
  depth: number;
  label: string | null;
  from: number;
  until: number | null;
  waitedMs: number;
  lockedBy: number;
  unlockedBy: number | null;
  /** Requests that overlapped the wait and finished before it ended, latest first. */
  lastRequests: Array<{ label: string; end: number; gapMs: number }>;
  /** Update commits that ran while the fallback was on screen. */
  updatesDuring: { commits: number; rendered: number };
}

export interface TimelineResult {
  ok: true;
  origin: { at: number; kind: 'interaction' | 'commit' };
  window: { fromCommit: number; toCommit: number; start: number; end: number };
  perceived: {
    firstLockAt: number | null;
    /** Last unlock of the waits that started before the next input; null while one still waits. */
    settledAt: number | null;
    /** Boundary keys (see `boundaries`) whose fallback was still shown at the end. */
    stillWaiting: string[];
    waits: PerceivedWait[];
    updatesAfterSettled: { commits: number; rendered: number };
  };
  /** Each Suspense boundary in the window, with where it sits in the app. */
  boundaries: TimelineBoundary[];
  /** Visually Complete times and late regions, from per-commit screen changes; null when the report has none. */
  screen: ScreenStability | null;
  /** SVG of the viewport colored by when each part last changed; only with `settleMap`. */
  settleMapSvg?: string | null;
  lanes: { input: TimelineInput[]; network: TimelineRequest[]; suspense: TimelineSuspense[]; commits: TimelineCommit[]; perf: TimelinePerf[]; console: TimelineConsole[] };
  omitted: { requests: number; commits: number; marks: number; logs: number };
  /** Page console messages in the lane's span; null when the report has no console entries. */
  console: { errors: number; warnings: number; other: number; firstError: TimelineConsole | null } | null;
  mermaid: string;
  text: string;
}

export type TimelineOutcome = TimelineResult | { ok: false; error: string };

const round = (n: number) => Math.round(n);

export function requestLabel(url: string): string {
  try {
    const parsed = new URL(url, 'http://local.invalid');
    const op = parsed.searchParams.get('operation') || parsed.searchParams.get('operationName') || parsed.searchParams.get('opName');
    if (op) return op;
    const segments = parsed.pathname.split('/').filter((s) => s && !/^[0-9a-f]{16,}$/i.test(s) && !/^\d+$/.test(s));
    const tail = segments.slice(-2).join('/') || parsed.pathname;
    return parsed.host === 'local.invalid' ? tail : parsed.host + ' …/' + tail;
  } catch (_) {
    return url.slice(0, 60);
  }
}

function commitStart(report: ReportLike, id: number): number | null {
  const start = Number(report.commitTimings?.[String(id)]?.startTime);
  return Number.isFinite(start) ? start : null;
}

/** Paint at least this long after its commit is called out in the text listing. */
export const PAINT_NOTE_MS = 50;

function commitPaint(report: ReportLike, id: number, start: number): number | null {
  const paint = Number(report.commitTimings?.[String(id)]?.paintAt);
  return Number.isFinite(paint) && paint >= start ? paint : null;
}

function renderedCount(report: ReportLike, id: number): number {
  const fromStats = Number(report.commitStats?.[String(id)]?.[3] || 0); // performedWork
  if (fromStats > 0) return fromStats;
  const list = report.renderedByCommit?.[String(id)];
  return Array.isArray(list) ? list.length : 0;
}

function screenOf(report: ReportLike, id: number): TimelineCommit['screen'] {
  const change = report.screenByCommit?.[String(id)];
  if (!change || typeof change.share !== 'number') return null;
  return { share: change.share, region: change.regions?.[0]?.label ?? null };
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

function kindOf(events: Array<{ entered?: unknown; left?: unknown }>): CommitKind {
  const enters = events.some((e) => e.entered);
  const leaves = events.some((e) => e.left);
  return enters && leaves ? 'swap' : enters ? 'lock' : leaves ? 'unlock' : 'update';
}

export function buildTimeline(report: ReportLike, options: TimelineOptions = {}): TimelineOutcome {
  const ids = Object.keys(report.commitTimings ?? {}).map(Number)
    .filter((id) => Number.isFinite(id) && commitStart(report, id) !== null).sort((a, b) => a - b);
  if (ids.length === 0) return { ok: false, error: 'report has no commit timings (report version 6 or later is required)' };
  const startOf = (id: number) => commitStart(report, id)!;
  // When the user could see the commit: its paint, else its commit time.
  const shownOf = (id: number) => commitPaint(report, id, startOf(id)) ?? startOf(id);

  // Interactions repeat under every commit that followed them; keep each once.
  const interactions = new Map<string, TimelineInput>();
  for (const list of Object.values(report.interactionsByCommit ?? {})) {
    for (const item of list || []) {
      const t = Number(item.timestamp);
      if (!Number.isFinite(t)) continue;
      const key = String(item.id ?? '') + '@' + t;
      const dom = item.location?.dom;
      const target = dom ? String(dom.nearestTestId || dom.text || dom.tag || '') || null : null;
      if (!interactions.has(key)) interactions.set(key, { t, action: String(item.action || 'input'), target, detail: inputDetail(item.event) });
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
  // The origin is the first interaction at or before the window, within 5 s, so
  // events that page code dispatched after it do not hide it.
  const originInput = inputs.find((input) => input.t <= windowStart && windowStart - input.t <= 5000);
  const origin = originInput ? originInput.t : windowStart;
  const rel = (t: number) => round(t - origin);

  const input = inputs.filter((i) => i.t >= origin && i.t <= windowEnd).map((i) => ({ ...i, t: rel(i.t) }));

  let exclude: RegExp | null = null;
  try { exclude = options.exclude ? new RegExp(options.exclude, 'i') : null; } catch (_) { exclude = null; }
  const minRequestMs = options.minRequestMs ?? 50;
  const inWindow = (report.networkRequests ?? []).filter((r) =>
    r.endTime >= origin && r.startTime <= windowEnd && !(exclude && exclude.test(r.url)));
  const toRequest = (r: NetworkRequest): TimelineRequest => ({
    id: r.id, label: requestLabel(r.url), start: rel(r.startTime), end: rel(r.endTime),
    durationMs: round(r.duration), initiatorType: r.initiatorType, cached: !!r.cached,
  });
  const drawable = inWindow.filter((r) => r.duration >= minRequestMs);
  const kept = [...drawable].sort((a, b) => b.duration - a.duration).slice(0, options.maxRequests ?? 30)
    .sort((a, b) => a.startTime - b.startTime);
  const network = kept.map(toRequest);
  const nextAfterWindow = ids.find((id) => id > windowIds[windowIds.length - 1]);
  const consoleLane = consoleLaneOf(report.consoleEntries, origin, nextAfterWindow === undefined ? Infinity : startOf(nextAfterWindow),
    ids.map((id) => ({ id, start: startOf(id) })), rel, options.maxLogs ?? 20);
  const perfLane = perfLaneOf(report.perfEntries ?? [], report.ownWork, origin, windowEnd, ids.map((id) => ({ id, start: startOf(id) })), rel, options.maxMarks ?? 40);

  // Pair Suspense enter/leave events by boundary (the detector's id, else the
  // depth), from the start of the report so a wait that began before the
  // window is still seen ending inside it, and only up to the window's end so
  // later unlocks read as still waiting.
  const boundaryKey = (event: { depth?: unknown; boundary?: unknown }) =>
    typeof event.boundary === 'number' ? 'b' + event.boundary : '@' + Number(event.depth);
  const open = new Map<string, number[]>();
  const suspense: TimelineSuspense[] = [];
  const boundaryInfo = new Map<string, { depth: number; location: SuspenseLocation | null }>();
  for (const id of ids.filter((commit) => commit <= windowIds[windowIds.length - 1])) {
    for (const event of report.suspenseByCommit?.[String(id)] ?? []) {
      const depth = Number(event.depth);
      if (!Number.isFinite(depth)) continue;
      const boundary = boundaryKey(event);
      const info = boundaryInfo.get(boundary);
      if (!info) boundaryInfo.set(boundary, { depth, location: event.location ?? null });
      else if (!info.location && event.location) info.location = event.location;
      if (event.entered) open.set(boundary, [...(open.get(boundary) || []), id]);
      if (event.left) {
        const entered = open.get(boundary)?.shift();
        if (entered === undefined) continue;
        if (startOf(id) >= windowStart && startOf(entered) <= windowEnd) {
          suspense.push({
            boundary, depth, label: null,
            start: rel(shownOf(entered)), end: rel(shownOf(id)), enteredAt: entered, leftAt: id,
          });
        }
      }
    }
  }
  for (const [boundary, stack] of open) {
    for (const entered of stack) {
      if (startOf(entered) <= windowEnd) {
        const { depth } = boundaryInfo.get(boundary)!;
        suspense.push({ boundary, depth, label: null, start: rel(shownOf(entered)), end: null, enteredAt: entered, leftAt: null });
      }
    }
  }
  suspense.sort((a, b) => a.start - b.start || a.depth - b.depth);
  // Label boundaries against each other.
  const boundaryKeys = Array.from(new Set(suspense.map((s) => s.boundary)));
  const labels = distinguishingLabels(boundaryKeys.map((key) => boundaryInfo.get(key)?.location));
  const labelByKey = new Map(boundaryKeys.map((key, i) => [key, labels[i]]));
  for (const s of suspense) s.label = labelByKey.get(s.boundary) ?? null;
  const boundaryName = (event: { depth?: unknown; boundary?: unknown }) => {
    const key = boundaryKey(event);
    return labelByKey.get(key) || '@' + Number(event.depth);
  };

  // Screen changes inside the window, on the origin clock.
  const frames: ScreenFrame[] = windowIds
    .map((id) => ({ commitId: id, t: rel(shownOf(id)), change: report.screenByCommit?.[String(id)] }))
    .filter((f): f is ScreenFrame => !!f.change && Array.isArray(f.change.rects));

  const allCommits: TimelineCommit[] = windowIds.map((id) => {
    const events = report.suspenseByCommit?.[String(id)] ?? [];
    const renderStart = Number(report.commitTimings?.[String(id)]?.render?.renderStart);
    const paint = commitPaint(report, id, startOf(id));
    const sources = (report.sourcesByCommit?.[String(id)] ?? [])
      .slice().sort((a, b) => Number(b.collateral || 0) - Number(a.collateral || 0))
      .map((s) => String(s.sourceId || '').split('#')[0]).filter(Boolean);
    return {
      commitId: id,
      t: rel(startOf(id)),
      renderStart: Number.isFinite(renderStart) && renderStart <= startOf(id) ? rel(renderStart) : null,
      paintAt: paint === null ? null : rel(paint),
      rendered: renderedCount(report, id),
      kind: kindOf(events),
      suspense: events.map((e) => (e.entered ? 'enter ' : 'leave ') + boundaryName(e)),
      sources: Array.from(new Set(sources)).slice(0, 2),
      screen: screenOf(report, id),
    };
  });
  const updates = allCommits.filter((c) => c.kind === 'update');
  const topUpdates = new Set([...updates].filter((c) => c.rendered > 0).sort((a, b) => b.rendered - a.rendered)
    .slice(0, options.maxCommits ?? 25).map((c) => c.commitId));
  const commits = allCommits.filter((c) => c.kind !== 'update' || topUpdates.has(c.commitId));

  const sumUpdates = (list: TimelineCommit[]) => ({ commits: list.length, rendered: list.reduce((n, c) => n + c.rendered, 0) });
  const allRequests = inWindow.map(toRequest);
  const waits: PerceivedWait[] = suspense.map((s) => {
    const until = s.end ?? rel(windowEnd);
    const lastRequests = allRequests
      .filter((r) => r.end <= until && r.end >= s.start)
      .sort((a, b) => b.end - a.end).slice(0, 3)
      .map((r) => ({ label: r.label, end: r.end, gapMs: until - r.end }));
    return {
      boundary: s.boundary, depth: s.depth, label: s.label, from: s.start, until: s.end, waitedMs: until - s.start, lockedBy: s.enteredAt, unlockedBy: s.leftAt,
      lastRequests: s.end === null ? [] : lastRequests,
      updatesDuring: sumUpdates(updates.filter((c) => c.commitId > s.enteredAt && (s.leftAt === null || c.commitId < s.leftAt))),
    };
  }).sort((a, b) => b.waitedMs - a.waitedMs);
  // Settling belongs to the interaction that opened the window: waits started
  // after the next input belong to that input instead.
  const nextInput = input.find((i) => i.t > 0);
  const ownWaits = suspense.filter((s) => !nextInput || s.start < nextInput.t);
  const stillWaiting = ownWaits.filter((s) => s.end === null).map((s) => s.boundary);
  const unlocks = ownWaits.filter((s) => s.end !== null).map((s) => s.end!);
  const settledAt = stillWaiting.length === 0 && unlocks.length ? Math.max(...unlocks) : null;

  const result: TimelineResult = {
    ok: true,
    origin: { at: Math.round(origin * 10) / 10, kind: originInput ? 'interaction' : 'commit' },
    window: { fromCommit: windowIds[0], toCommit: windowIds[windowIds.length - 1], start: rel(windowStart), end: rel(windowEnd) },
    perceived: {
      firstLockAt: suspense.length ? suspense[0].start : null,
      settledAt,
      stillWaiting,
      waits,
      updatesAfterSettled: sumUpdates(settledAt === null ? [] : updates.filter((c) => c.t > settledAt && (!nextInput || c.t < nextInput.t))),
    },
    boundaries: boundaryKeys.map((key) => ({ boundary: key, depth: boundaryInfo.get(key)!.depth, label: labelByKey.get(key) ?? null, location: boundaryInfo.get(key)!.location })),
    screen: screenStability(frames),
    ...(options.settleMap && { settleMapSvg: settleMapSvg(frames) }),
    lanes: { input, network, suspense, commits, perf: perfLane.lane, console: consoleLane.lane },
    omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length, marks: perfLane.omittedMarks, logs: consoleLane.omittedLogs },
    console: consoleLane.summary,
    mermaid: '',
    text: '',
  };
  result.mermaid = renderMermaid(result);
  result.text = renderText(result);
  return result;
}

const CONSOLE_LABEL_MAX = 140;
const MAX_CONSOLE_ALERTS = 50;
const ALERT_LEVELS = new Set<ConsoleLevel>(['error', 'warn']);

function shortLocation(location: string | null): string | null {
  if (!location) return null;
  const match = /([^/]*:\d+:\d+)$/.exec(location);
  return match ? match[1] : location;
}

function consoleLaneOf(
  entries: ConsoleEntry[] | undefined, origin: number, end: number,
  commitStarts: Array<{ id: number; start: number }>, rel: (t: number) => number, maxLogs: number,
): { lane: TimelineConsole[]; omittedLogs: number; summary: TimelineResult['console'] } {
  if (!Array.isArray(entries)) return { lane: [], omittedLogs: 0, summary: null };
  const page = entries.filter((e) => !e.chippy && (e.lastTime ?? e.time) >= origin && e.time < end)
    .sort((a, b) => a.time - b.time);
  const toItem = (e: ConsoleEntry): TimelineConsole => {
    let after: number | null = null;
    for (const c of commitStarts) { if (c.start > e.time) break; after = c.id; }
    const first = String(e.message).split('\n')[0].trim();
    return {
      id: e.id, level: e.level, source: e.source,
      label: first.length > CONSOLE_LABEL_MAX ? first.slice(0, CONSOLE_LABEL_MAX - 1) + '…' : first,
      t: rel(e.time), repeat: e.repeat, location: shortLocation(e.location), afterCommit: after,
    };
  };
  const alerts = page.filter((e) => ALERT_LEVELS.has(e.level));
  const others = page.filter((e) => !ALERT_LEVELS.has(e.level));
  const keptAlerts = alerts.slice(0, MAX_CONSOLE_ALERTS);
  const keptOthers = others.slice(0, maxLogs);
  const lane = [...keptAlerts, ...keptOthers].sort((a, b) => a.time - b.time).map(toItem);
  const count = (keep: (e: ConsoleEntry) => boolean) => page.filter(keep).reduce((n, e) => n + e.repeat, 0);
  const firstError = page.find((e) => e.level === 'error');
  return {
    lane,
    omittedLogs: alerts.length - keptAlerts.length + others.length - keptOthers.length,
    summary: {
      errors: count((e) => e.level === 'error'),
      warnings: count((e) => e.level === 'warn'),
      other: count((e) => !ALERT_LEVELS.has(e.level)),
      firstError: firstError ? toItem(firstError) : null,
    },
  };
}

const consoleText = (c: TimelineConsole) =>
  `${c.source === 'uncaught' ? 'uncaught ' : ''}${c.label}${c.repeat > 1 ? ` ×${c.repeat}` : ''}${c.location ? ' · ' + c.location : ''}`;

const SHIFT_MIN = 0.001;
const EVENT_MIN_MS = 50;

function perfLaneOf(
  entries: PerfEntry[], ownWork: OwnWorkSpan[] | undefined, origin: number, windowEnd: number,
  commitStarts: Array<{ id: number; start: number }>, rel: (t: number) => number, maxMarks: number,
): { lane: TimelinePerf[]; omittedMarks: number } {
  const lane: TimelinePerf[] = [];
  let marks = 0;
  let omittedMarks = 0;
  const sorted = entries.filter((e) => e.startTime + (e.duration || 0) >= origin && e.startTime <= windowEnd)
    .sort((a, b) => a.startTime - b.startTime);
  for (const e of sorted) {
    let kind: TimelinePerfKind | null = null;
    let label = e.name;
    let value: number | null = null;
    let chippy = false;
    if (e.entryType === 'long-animation-frame' || e.entryType === 'longtask') {
      kind = 'frame';
      // Long tasks carry no blocking time; count what ran past 50 ms, as total blocking time does.
      value = e.entryType === 'longtask' ? round(Math.max(0, e.duration - 50)) : e.blockingDuration ?? null;
      const script = e.scripts?.[0];
      label = script ? [script.invoker, script.sourceFunctionName, script.sourceURL?.split('/').pop()].filter(Boolean).join(' ') : '';
      chippy = isOwnFrame(e, ownWork);
      if (chippy) label = 'Chippy';
    } else if (e.entryType === 'measure' && e.duration >= 1) kind = 'measure';
    else if (e.entryType === 'measure' || e.entryType === 'mark') {
      if (marks >= maxMarks) { omittedMarks += 1; continue; }
      marks += 1;
      kind = 'mark';
    } else if (e.entryType === 'layout-shift' && (e.value ?? 0) >= SHIFT_MIN && !e.hadRecentInput) {
      kind = 'shift';
      value = e.value ?? null;
      const source = e.sources?.find((s) => s.component || s.testId);
      label = source ? source.component || source.testId || '' : '';
    } else if (e.entryType === 'event' && e.duration >= EVENT_MIN_MS) {
      kind = 'event';
      value = e.inputDelay ?? null;
      label = e.name + (e.target ? ' ' + (e.target.testId || e.target.component || e.target.element || '') : '');
    } else if (e.entryType === 'largest-contentful-paint') {
      kind = 'lcp';
      label = e.element ? e.element.testId || e.element.component || e.element.element || '' : '';
    }
    if (!kind) continue;
    const end = e.startTime + (e.duration || 0);
    lane.push({
      id: e.id, kind, label: label.trim(), start: rel(e.startTime), end: rel(end), durationMs: round(e.duration || 0), value,
      commits: commitStarts.filter((c) => c.start >= e.startTime && c.start <= end).map((c) => c.id),
      ...(chippy && { chippy: true as const }),
    });
  }
  return { lane, omittedMarks };
}

const commitSpan = (ids: number[]) => (ids.length === 0 ? '' : ids.length === 1 ? `c${ids[0]}` : `c${ids[0]}–c${ids[ids.length - 1]}`);

// Gantt statements that start with one of these words are directives, not
// tasks: a task named "click card" fails to parse as a click binding.
const GANTT_KEYWORDS = /^(click|call|href|section|title|dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|inclusiveenddates|topaxis|acctitle|accdescr|displaymode|gantt)\b/i;

// Mermaid task names cannot contain ':' or '#', and ';' ends a statement.
export function ganttTaskName(raw: string): string {
  const name = raw.replace(/[:#;]/g, ' ').replace(/%%/g, '% %').replace(/\s+/g, ' ').trim() || 'unnamed';
  return GANTT_KEYWORDS.test(name) ? '· ' + name : name;
}
const safe = ganttTaskName;

function renderMermaid(result: TimelineResult): string {
  const { input, network, suspense, commits } = result.lanes;
  const end = result.window.end;
  const slow = new Set([...network].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3).map((r) => r.id));
  const updates = commits.filter((c) => c.kind === 'update');
  const heavy = new Set([...updates].sort((a, b) => b.rendered - a.rendered).slice(0, 3).filter((c) => c.rendered > 0).map((c) => c.commitId));
  const bar = (start: number, stop: number) => `${start}, ${Math.max(stop, start + 1)}`;
  const lines = [
    'gantt',
    `  title Commits ${result.window.fromCommit}–${result.window.toCommit}, ms from ${result.origin.kind === 'interaction' ? 'the interaction' : 'the first commit'}`,
    '  dateFormat x',
    '  axisFormat %S.%L',
  ];
  if (input.length) {
    lines.push('  section Input');
    input.forEach((i, n) => lines.push(`  ${safe('input ' + inputLabel(i))} :milestone, in${n}, ${i.t}, ${i.t}`));
  }
  if (network.length) {
    lines.push('  section Network');
    for (const r of network) lines.push(`  ${safe(r.label)} ${r.durationMs}ms :${slow.has(r.id) ? 'crit, ' : ''}net${r.id}, ${bar(r.start, r.end)}`);
  }
  const browser = result.lanes.perf.filter((p) => p.kind === 'frame' || p.kind === 'measure');
  if (browser.length) {
    lines.push('  section Browser (long frames, measures)');
    for (const p of browser) {
      const name = p.kind === 'frame' ? `long frame ${p.durationMs}ms${p.commits.length ? ' ' + commitSpan(p.commits) : ''}` : `${p.label} ${p.durationMs}ms`;
      lines.push(`  ${safe(name)} :${p.kind === 'frame' ? 'crit, ' : ''}perf${p.id}, ${bar(p.start, p.end)}`);
    }
  }
  const alerts = result.lanes.console.filter((c) => c.level === 'error' || c.level === 'warn').slice(0, 15);
  if (alerts.length) {
    lines.push('  section Console (errors, warnings)');
    for (const c of alerts) lines.push(`  ${safe(`${c.level} ${c.label.slice(0, 60)}${c.repeat > 1 ? ' ×' + c.repeat : ''}`)} :${c.level === 'error' ? 'crit, ' : ''}milestone, log${c.id}, ${c.t}, ${c.t}`);
  }
  if (suspense.length) {
    lines.push('  section User waits (fallback shown)');
    suspense.forEach((s, n) => {
      const stop = s.end ?? end;
      const label = s.end === null ? 'still waiting' : `${stop - s.start}ms`;
      lines.push(`  ${safe(s.label || '@' + s.depth)} ${label} :${s.end === null ? 'active' : 'crit'}, sus${n}, ${bar(s.start, stop)}`);
    });
  }
  const screen = commits.filter((c) => c.kind !== 'update');
  if (screen.length) {
    lines.push('  section Screen (lock or unlock)');
    for (const c of screen) lines.push(`  c${c.commitId} ${c.kind} ${safe(c.suspense.join(' '))} :milestone, c${c.commitId}, ${c.t}, ${c.t}`);
  }
  const visible = commits.filter((c) => c.screen && c.screen.share >= 0.01);
  if (result.screen) {
    lines.push('  section Screen changed (share of viewport)');
    for (const c of visible) {
      const at = c.paintAt ?? c.t;
      lines.push(`  c${c.commitId} ${percent(c.screen!.share)}${c.screen!.region ? ' ' + safe(c.screen!.region) : ''} :milestone, sc${c.commitId}, ${at}, ${at}`);
    }
    lines.push(`  VC90 +${result.screen.vc90} :crit, milestone, vc90, ${result.screen.vc90}, ${result.screen.vc90}`);
  }
  if (updates.length) {
    lines.push('  section Updates (CPU, no Suspense change)');
    for (const c of updates) {
      const what = c.sources.length ? safe(c.sources.join(', ')) : '';
      const span = c.renderStart === null ? `milestone, c${c.commitId}, ${c.t}, ${c.t}` : `c${c.commitId}, ${bar(c.renderStart, c.t)}`;
      const seen = result.screen ? (c.screen ? ` ${percent(c.screen.share)} screen` : ' 0% screen') : '';
      lines.push(`  c${c.commitId} ${c.rendered} rendered${seen}${what ? ' ' + what : ''} :${heavy.has(c.commitId) ? 'crit, ' : ''}${span}`);
    }
  }
  return lines.join('\n');
}

function renderText(result: TimelineResult): string {
  const p = result.perceived;
  const header: string[] = [];
  if (p.waits.length === 0) header.push('No Suspense fallback was shown in this window.');
  else {
    header.push(p.settledAt !== null
      ? `Fallbacks first shown at +${p.firstLockAt}, all cleared at +${p.settledAt}; ${p.updatesAfterSettled.commits} updates (${p.updatesAfterSettled.rendered} rendered) ran after that, before the next input.`
      : `Fallbacks first shown at +${p.firstLockAt}; still waiting at the end: ${p.stillWaiting.map((key) => result.boundaries.find((b) => b.boundary === key)?.label || key).join(', ')}.`);
    for (const w of p.waits.slice(0, 5)) {
      const last = w.lastRequests[0];
      header.push(`  wait ${w.label || '@' + w.depth} ${w.waitedMs}ms (+${w.from} → ${w.until === null ? 'end' : '+' + w.until})` +
        `, ${w.updatesDuring.commits} updates (${w.updatesDuring.rendered} rendered) meanwhile` +
        (last ? `, last request before unlock: ${last.label} (+${last.end}, ${last.gapMs}ms before)` : ''));
    }
  }

  const sc = result.screen;
  const painted = result.lanes.commits.some((c) => c.paintAt !== null);
  if (sc) {
    header.push(`Visually complete${painted ? ' (at paint)' : ''}: VC50 +${sc.vc50}, VC90 +${sc.vc90}, VC100 +${sc.vc100}; ${percent(sc.changedShare)} of the viewport changed` +
      (sc.changedVc90 !== null ? `, 90% of that by +${sc.changedVc90}` : '') + '.');
    if (sc.late.length) header.push(`  changing after that: ${sc.late.map((l) => `${l.label} +${l.at} (c${l.commitId}, ${percent(l.share)})`).join(', ')}`);
  }

  const delayed = result.lanes.commits.filter((c) => c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS);
  if (delayed.length) {
    const worst = [...delayed].sort((a, b) => (b.paintAt! - b.t) - (a.paintAt! - a.t)).slice(0, 5);
    header.push(`Painted late (the commit's task kept running): ${worst.map((c) => `c${c.commitId} +${c.t} → painted +${c.paintAt} (${c.paintAt! - c.t}ms)`).join(', ')}.`);
  }

  const frames = result.lanes.perf.filter((p) => p.kind === 'frame' && !p.chippy);
  const ownFrames = result.lanes.perf.filter((p) => p.kind === 'frame' && p.chippy);
  if (frames.length) {
    const worst = [...frames].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
    header.push(`Long frames (no paint inside): ${frames.length}, ${Math.round(frames.reduce((sum, p) => sum + (p.value ?? 0), 0))}ms blocking; longest ${worst.map((p) => `+${p.start} ${p.durationMs}ms${p.commits.length ? ' (' + commitSpan(p.commits) + ')' : ''}`).join(', ')}.`);
  }
  if (ownFrames.length) {
    header.push(`Chippy's own long frames, left out of the totals: ${ownFrames.length}, ${Math.round(ownFrames.reduce((sum, p) => sum + (p.value ?? 0), 0))}ms blocking.`);
  }

  const cs = result.console;
  if (cs && cs.errors + cs.warnings > 0) {
    const fe = cs.firstError;
    header.push(`Console: ${cs.errors} errors, ${cs.warnings} warnings` +
      (fe ? `; first error +${fe.t}${fe.afterCommit !== null ? ` (after c${fe.afterCommit})` : ''}: ${consoleText(fe)}` : '') + '.');
  }

  type Row = { t: number; lane: string; text: string };
  const rows: Row[] = [];
  for (const i of result.lanes.input) rows.push({ t: i.t, lane: 'input', text: inputLabel(i) });
  for (const r of result.lanes.network) rows.push({ t: r.start, lane: 'net', text: `${r.label}  → +${r.end} (${r.durationMs}ms${r.cached ? ', cached' : ''})` });
  for (const s of result.lanes.suspense) {
    rows.push({ t: s.start, lane: 'wait', text: `fallback ${s.label || '@' + s.depth} ` + (s.end === null ? 'still shown at the end' : `until +${s.end} (${s.end - s.start}ms, c${s.enteredAt}→c${s.leftAt})`) });
  }
  for (const c of result.lanes.commits) {
    const lane = c.kind === 'update' ? 'react' : 'SCRN';
    const seen = c.screen ? ` · ${percent(c.screen.share)} screen${c.screen.region ? ' ' + c.screen.region : ''}` : sc ? ' · 0% screen' : '';
    const paint = c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS ? ` · painted +${c.paintAt}` : '';
    rows.push({ t: c.t, lane, text: `c${c.commitId} ${c.kind === 'update' ? '' : c.kind + ' '}${c.rendered} rendered${seen}${c.sources.length ? ' · ' + c.sources.join(', ') : ''}${c.suspense.length ? ' · ' + c.suspense.join(', ') : ''}${paint}` });
  }
  for (const p of result.lanes.perf) {
    const commits = p.commits.length ? ` · ${commitSpan(p.commits)}` : '';
    const text =
      p.kind === 'frame' ? `long frame ${p.durationMs}ms (${p.value ?? 0}ms blocking) → +${p.end}${p.label ? ' · ' + p.label : ''}${commits}` :
        p.kind === 'measure' ? `measure ${p.label} → +${p.end} (${p.durationMs}ms)` :
          p.kind === 'mark' ? `mark ${p.label}` :
            p.kind === 'shift' ? `layout shift ${p.value}${p.label ? ' · ' + p.label : ''}` :
              p.kind === 'event' ? `slow ${p.label} ${p.durationMs}ms (input delay ${p.value ?? 0}ms)` :
                `LCP${p.label ? ' ' + p.label : ''}`;
    rows.push({ t: p.start, lane: p.kind === 'frame' ? 'frame' : 'perf', text });
  }
  for (const c of result.lanes.console) rows.push({ t: c.t, lane: c.level, text: consoleText(c) });
  const order: Record<string, number> = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4, frame: 5, perf: 6, error: 7, warn: 7, info: 7, log: 7, debug: 7 };
  // Console rows share one rank so messages logged in one millisecond keep their order.
  rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
  const width = Math.max(...rows.map((r) => String(r.t).length), 1);
  return [...header, '', ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join('\n');
}
