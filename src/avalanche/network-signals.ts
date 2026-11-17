/**
 * Joins captured network requests to captured commits on the shared
 * `performance.now()` clock. Runs on report data (live or a saved export), so
 * the commit hot path pays nothing for it.
 *
 * Three links per request, each bounded by a window in ms:
 *   startedAfter         the last commit that ended before the request started:
 *                        a passive effect or follow-up task of that commit may
 *                        have issued it.
 *   startedDuringRender  the commit whose render was running when the request
 *                        started: a render-time fetch, such as a Suspense data
 *                        read. Needs render-tick timing.
 *   landedBefore         the first commit whose render started after the
 *                        response finished: a state update from the response
 *                        may have scheduled it.
 * Every link is temporal proximity, not proof of cause.
 */

import type { NetworkRequest } from './network-capture';

export const DEFAULT_NETWORK_WINDOW_MS = 250;
export const NETWORK_SORT_KEYS = ['start', 'end', 'duration'] as const;
export type NetworkSortKey = typeof NETWORK_SORT_KEYS[number];

type TimingLike = { startTime?: unknown; endTime?: unknown; render?: { renderStart?: unknown } | null };

interface CommitAnchor {
  commitId: number;
  /** Render start when render ticks are known, otherwise the commit start. */
  renderStart: number;
  renderStartKnown: boolean;
  commitStart: number;
  commitEnd: number;
}

export interface CommitLink {
  commitId: number;
  gapMs: number;
}

export interface RequestCommitLinks {
  startedAfter: CommitLink | null;
  startedDuringRender: number | null;
  landedBefore: CommitLink | null;
  /** Commits that committed while the request was in flight. */
  commitsInFlight: number;
}

export type LinkedRequest = NetworkRequest & RequestCommitLinks;

const round = (value: number): number => Math.round(value * 10) / 10;

function commitAnchors(commitTimings: Record<string, TimingLike> | null | undefined): CommitAnchor[] {
  const anchors: CommitAnchor[] = [];
  for (const [id, timing] of Object.entries(commitTimings ?? {})) {
    const commitStart = Number(timing?.startTime);
    const commitEnd = Number(timing?.endTime);
    if (!Number.isFinite(commitStart) || !Number.isFinite(commitEnd)) continue;
    const renderStart = Number(timing?.render?.renderStart);
    const renderStartKnown = Number.isFinite(renderStart) && renderStart <= commitStart;
    anchors.push({
      commitId: Number(id),
      renderStart: renderStartKnown ? renderStart : commitStart,
      renderStartKnown,
      commitStart,
      commitEnd,
    });
  }
  return anchors.sort((a, b) => a.commitStart - b.commitStart);
}

/** Index of the first anchor whose `key` is >= value (anchors are time-ordered). */
function firstAtOrAfter(anchors: CommitAnchor[], value: number, key: 'commitStart' | 'commitEnd'): number {
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][key] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function linkRequest(request: NetworkRequest, anchors: CommitAnchor[], windowMs: number): RequestCommitLinks {
  const { startTime, endTime } = request;

  const afterIndex = firstAtOrAfter(anchors, startTime, 'commitEnd') - 1;
  const after = afterIndex >= 0 ? anchors[afterIndex] : null;
  const startedAfter = after && startTime - after.commitEnd <= windowMs
    ? { commitId: after.commitId, gapMs: round(startTime - after.commitEnd) }
    : null;

  const rendering = anchors[firstAtOrAfter(anchors, startTime, 'commitStart')];
  const startedDuringRender = rendering && rendering.renderStartKnown && rendering.renderStart <= startTime
    ? rendering.commitId
    : null;

  let landedBefore: CommitLink | null = null;
  for (let i = firstAtOrAfter(anchors, endTime, 'commitStart'); i < anchors.length; i++) {
    const anchor = anchors[i];
    if (anchor.renderStart - endTime > windowMs) break;
    if (anchor.renderStart >= endTime) {
      landedBefore = { commitId: anchor.commitId, gapMs: round(anchor.renderStart - endTime) };
      break;
    }
  }

  const commitsInFlight = firstAtOrAfter(anchors, endTime, 'commitStart') - firstAtOrAfter(anchors, startTime, 'commitStart');
  return { startedAfter, startedDuringRender, landedBefore, commitsInFlight: Math.max(0, commitsInFlight) };
}

type ReportLike = {
  meta?: { network?: unknown } & Record<string, unknown>;
  networkRequests?: unknown;
  commitTimings?: Record<string, TimingLike>;
};

function requestsOf(report: ReportLike): NetworkRequest[] {
  return Array.isArray(report.networkRequests) ? (report.networkRequests as NetworkRequest[]) : [];
}

function windowOf(windowMs: unknown): number {
  const value = Number(windowMs);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NETWORK_WINDOW_MS;
}

/** Every captured request with its commit links. */
export function linkNetworkRequests(report: ReportLike, windowMs?: unknown): LinkedRequest[] {
  const anchors = commitAnchors(report.commitTimings);
  const window = windowOf(windowMs);
  return requestsOf(report).map((request) => ({ ...request, ...linkRequest(request, anchors, window) }));
}

export interface NetworkViewOptions {
  top?: unknown;
  by?: unknown;
  match?: unknown;
  initiators?: unknown;
  window?: unknown;
}

export type NetworkViewResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string; validBy?: readonly string[] };

/** The `network` action: captured requests, filtered, sorted, and linked to commits. */
export function networkView(report: ReportLike, options: NetworkViewOptions = {}): NetworkViewResult {
  const by = String(options.by || 'start');
  if (!(NETWORK_SORT_KEYS as readonly string[]).includes(by)) {
    return { ok: false, error: 'unsupported network sort key: ' + by, validBy: NETWORK_SORT_KEYS };
  }
  let pattern: RegExp | null = null;
  if (typeof options.match === 'string' && options.match) {
    try {
      pattern = new RegExp(options.match, 'i');
    } catch (error) {
      return { ok: false, error: 'invalid match pattern: ' + (error as Error).message };
    }
  }
  const initiators = Array.isArray(options.initiators)
    ? options.initiators.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  const top = Number.isFinite(Number(options.top)) && Number(options.top) > 0 ? Math.floor(Number(options.top)) : 20;
  const windowMs = windowOf(options.window);

  const linked = linkNetworkRequests(report, windowMs).filter((request) =>
    (!pattern || pattern.test(request.url)) &&
    (initiators.length === 0 || initiators.includes(request.initiatorType.toLowerCase())));

  const byInitiator: Record<string, number> = {};
  let landedBeforeCommit = 0;
  let startedAfterCommit = 0;
  let startedDuringRender = 0;
  let longest: LinkedRequest | null = null;
  for (const request of linked) {
    byInitiator[request.initiatorType] = (byInitiator[request.initiatorType] || 0) + 1;
    if (request.landedBefore) landedBeforeCommit += 1;
    if (request.startedAfter) startedAfterCommit += 1;
    if (request.startedDuringRender !== null) startedDuringRender += 1;
    if (!longest || request.duration > longest.duration) longest = request;
  }

  const sorted = linked.slice().sort((a, b) =>
    by === 'duration' ? b.duration - a.duration : by === 'end' ? a.endTime - b.endTime : a.startTime - b.startTime);

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
        longest: longest ? { id: longest.id, url: longest.url, duration: longest.duration } : null,
      },
      rows: sorted.slice(0, top),
    },
  };
}

export interface CommitNetwork {
  /** Requests whose response finished just before this commit's render started. */
  landedBefore: LinkedRequest[];
  /** Requests that started just after this commit ended. */
  startedAfter: LinkedRequest[];
  /** Requests that started while this commit was rendering. */
  startedDuringRender: LinkedRequest[];
  /** Requests in flight when this commit committed. */
  inFlight: number;
}

/** Per-commit grouping of linked requests, keyed by commit id. */
export function networkByCommit(report: ReportLike, windowMs?: unknown): Map<number, CommitNetwork> {
  const out = new Map<number, CommitNetwork>();
  const entry = (commitId: number): CommitNetwork => {
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
