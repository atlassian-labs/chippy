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
 * Produces structured lanes plus two renderings: a Mermaid gantt chart for
 * chat or docs, and an aligned text listing for terminals. Runs on report
 * data, live or saved, so capture pays nothing for it.
 *
 * Lines up events in time; it does not prove cause. A request that ends just
 * before an unlock is a candidate, not a proven gate. Waits are paired by
 * boundary depth from enter/leave events, so a boundary that remounts at the
 * same depth reads as one wait. Commit `endTime - startTime` is the detector's
 * own overhead, so render time is reported only when the report records a
 * render start.
 */

import type { NetworkRequest } from './network-capture';

type Tuple = unknown[];
type ReportLike = {
  commitStats?: Record<string, Tuple>;
  renderedByCommit?: Record<string, unknown[]>;
  commitTimings?: Record<string, { startTime?: unknown; endTime?: unknown; render?: { renderStart?: unknown } | null }>;
  suspenseByCommit?: Record<string, Array<{ depth?: unknown; entered?: unknown; left?: unknown }>>;
  sourcesByCommit?: Record<string, Array<{ sourceId?: unknown; collateral?: unknown }>>;
  interactionsByCommit?: Record<string, Array<{ id?: unknown; action?: unknown; timestamp?: unknown; location?: { dom?: { nearestTestId?: unknown; text?: unknown; tag?: unknown } } }>>;
  networkRequests?: NetworkRequest[];
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
}

export type CommitKind = 'lock' | 'unlock' | 'swap' | 'update';

export interface TimelineInput { t: number; action: string; target: string | null }
export interface TimelineRequest { id: number; label: string; start: number; end: number; durationMs: number; initiatorType: string; cached: boolean }
export interface TimelineSuspense { depth: number; start: number; end: number | null; enteredAt: number; leftAt: number | null }
export interface TimelineCommit {
  commitId: number;
  t: number;
  /** Render start relative to the origin, when the report records it. */
  renderStart: number | null;
  rendered: number;
  kind: CommitKind;
  suspense: string[];
  sources: string[];
}

export interface PerceivedWait {
  depth: number;
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
    stillWaiting: number[];
    waits: PerceivedWait[];
    updatesAfterSettled: { commits: number; rendered: number };
  };
  lanes: { input: TimelineInput[]; network: TimelineRequest[]; suspense: TimelineSuspense[]; commits: TimelineCommit[] };
  omitted: { requests: number; commits: number };
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

function renderedCount(report: ReportLike, id: number): number {
  const fromStats = Number(report.commitStats?.[String(id)]?.[3] || 0); // performedWork
  if (fromStats > 0) return fromStats;
  const list = report.renderedByCommit?.[String(id)];
  return Array.isArray(list) ? list.length : 0;
}

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

  // Interactions repeat under every commit that followed them; keep each once.
  const interactions = new Map<string, TimelineInput>();
  for (const list of Object.values(report.interactionsByCommit ?? {})) {
    for (const item of list || []) {
      const t = Number(item.timestamp);
      if (!Number.isFinite(t)) continue;
      const key = String(item.id ?? '') + '@' + t;
      const dom = item.location?.dom;
      const target = dom ? String(dom.nearestTestId || dom.text || dom.tag || '') || null : null;
      if (!interactions.has(key)) interactions.set(key, { t, action: String(item.action || 'input'), target });
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
  // The origin is the latest interaction at or before the window, within 5 s.
  const originInput = [...inputs].reverse().find((input) => input.t <= windowStart && windowStart - input.t <= 5000);
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

  // Pair Suspense enter/leave events by boundary depth, from the start of the
  // report so a wait that began before the window is still seen ending inside
  // it, and only up to the window's end so later unlocks read as still waiting.
  const open = new Map<number, number[]>();
  const suspense: TimelineSuspense[] = [];
  for (const id of ids.filter((commit) => commit <= windowIds[windowIds.length - 1])) {
    for (const event of report.suspenseByCommit?.[String(id)] ?? []) {
      const depth = Number(event.depth);
      if (!Number.isFinite(depth)) continue;
      if (event.entered) open.set(depth, [...(open.get(depth) || []), id]);
      if (event.left) {
        const enteredId = open.get(depth)?.shift();
        if (enteredId === undefined) continue;
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

  const allCommits: TimelineCommit[] = windowIds.map((id) => {
    const events = report.suspenseByCommit?.[String(id)] ?? [];
    const renderStart = Number(report.commitTimings?.[String(id)]?.render?.renderStart);
    const sources = (report.sourcesByCommit?.[String(id)] ?? [])
      .slice().sort((a, b) => Number(b.collateral || 0) - Number(a.collateral || 0))
      .map((s) => String(s.sourceId || '').split('#')[0]).filter(Boolean);
    return {
      commitId: id,
      t: rel(startOf(id)),
      renderStart: Number.isFinite(renderStart) && renderStart <= startOf(id) ? rel(renderStart) : null,
      rendered: renderedCount(report, id),
      kind: kindOf(events),
      suspense: events.map((e) => (e.entered ? 'enter' : 'leave') + '@' + e.depth),
      sources: Array.from(new Set(sources)).slice(0, 2),
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
      depth: s.depth, from: s.start, until: s.end, waitedMs: until - s.start, lockedBy: s.enteredAt, unlockedBy: s.leftAt,
      lastRequests: s.end === null ? [] : lastRequests,
      updatesDuring: sumUpdates(updates.filter((c) => c.t > s.start && c.t < until)),
    };
  }).sort((a, b) => b.waitedMs - a.waitedMs);
  // Settling belongs to the interaction that opened the window: waits started
  // after the next input belong to that input instead.
  const nextInput = input.find((i) => i.t > 0);
  const ownWaits = suspense.filter((s) => !nextInput || s.start < nextInput.t);
  const stillWaiting = ownWaits.filter((s) => s.end === null).map((s) => s.depth);
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
    lanes: { input, network, suspense, commits },
    omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length },
    mermaid: '',
    text: '',
  };
  result.mermaid = renderMermaid(result);
  result.text = renderText(result);
  return result;
}

// Mermaid task names cannot contain ':' or '#', and ';' ends a statement.
const safe = (s: string) => s.replace(/[:#;]/g, ' ').replace(/\s+/g, ' ').trim();

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
    input.forEach((i, n) => lines.push(`  ${safe(i.action + (i.target ? ' ' + i.target : ''))} :milestone, in${n}, ${i.t}, ${i.t}`));
  }
  if (network.length) {
    lines.push('  section Network');
    for (const r of network) lines.push(`  ${safe(r.label)} ${r.durationMs}ms :${slow.has(r.id) ? 'crit, ' : ''}net${r.id}, ${bar(r.start, r.end)}`);
  }
  if (suspense.length) {
    lines.push('  section User waits (fallback shown)');
    suspense.forEach((s, n) => {
      const stop = s.end ?? end;
      const label = s.end === null ? 'still waiting' : `${stop - s.start}ms`;
      lines.push(`  @${s.depth} ${label} :${s.end === null ? 'active' : 'crit'}, sus${n}, ${bar(s.start, stop)}`);
    });
  }
  const screen = commits.filter((c) => c.kind !== 'update');
  if (screen.length) {
    lines.push('  section Screen (lock or unlock)');
    for (const c of screen) lines.push(`  c${c.commitId} ${c.kind} ${safe(c.suspense.join(' '))} :milestone, c${c.commitId}, ${c.t}, ${c.t}`);
  }
  if (updates.length) {
    lines.push('  section Updates (CPU, no Suspense change)');
    for (const c of updates) {
      const what = safe(c.sources.join(', '));
      const span = c.renderStart === null ? `milestone, c${c.commitId}, ${c.t}, ${c.t}` : `c${c.commitId}, ${bar(c.renderStart, c.t)}`;
      lines.push(`  c${c.commitId} ${c.rendered} rendered${what ? ' ' + what : ''} :${heavy.has(c.commitId) ? 'crit, ' : ''}${span}`);
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
      : `Fallbacks first shown at +${p.firstLockAt}; still waiting at the end: @${p.stillWaiting.join(', @')}.`);
    for (const w of p.waits.slice(0, 5)) {
      const last = w.lastRequests[0];
      header.push(`  wait @${w.depth} ${w.waitedMs}ms (+${w.from} → ${w.until === null ? 'end' : '+' + w.until})` +
        `, ${w.updatesDuring.commits} updates (${w.updatesDuring.rendered} rendered) meanwhile` +
        (last ? `, last request before unlock: ${last.label} (+${last.end}, ${last.gapMs}ms before)` : ''));
    }
  }

  type Row = { t: number; lane: string; text: string };
  const rows: Row[] = [];
  for (const i of result.lanes.input) rows.push({ t: i.t, lane: 'input', text: i.action + (i.target ? ' ' + i.target : '') });
  for (const r of result.lanes.network) rows.push({ t: r.start, lane: 'net', text: `${r.label}  → +${r.end} (${r.durationMs}ms${r.cached ? ', cached' : ''})` });
  for (const s of result.lanes.suspense) {
    rows.push({ t: s.start, lane: 'wait', text: `fallback @${s.depth} ` + (s.end === null ? 'still shown at the end' : `until +${s.end} (${s.end - s.start}ms, c${s.enteredAt}→c${s.leftAt})`) });
  }
  for (const c of result.lanes.commits) {
    const lane = c.kind === 'update' ? 'react' : 'SCRN';
    rows.push({ t: c.t, lane, text: `c${c.commitId} ${c.kind === 'update' ? '' : c.kind + ' '}${c.rendered} rendered${c.sources.length ? ' · ' + c.sources.join(', ') : ''}${c.suspense.length ? ' · ' + c.suspense.join(' ') : ''}` });
  }
  const order: Record<string, number> = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4 };
  rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
  const width = Math.max(...rows.map((r) => String(r.t).length), 1);
  return [...header, '', ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join('\n');
}
