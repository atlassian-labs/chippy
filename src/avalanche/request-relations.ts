/**
 * Relations between captured requests, on top of their commit links.
 *
 *   repeatOf          an earlier request with the same URL and initiator: a
 *                     duplicate fetch or a refetch of data already loaded.
 *   landedAfterNewer  a request to the same endpoint that started later but
 *                     finished first: the older response arrives last and can
 *                     overwrite newer results unless the caller discards it.
 *   chainedAfter      the request this one most likely waited for: either a
 *                     response that landed before the commit this request
 *                     started after, or a response that finished just before it
 *                     started with no commit between (a `.then` chain). A chain
 *                     of these is a request waterfall.
 *
 * Resource Timing has no method or body, so "same URL" also matches POSTs with
 * different bodies. Every relation is timing, not proof of cause.
 */

import type { LinkedRequest } from './network-signals';

/** A response that finished at most this long before a request started may have started it. */
export const DIRECT_CHAIN_GAP_MS = 15;

export interface RequestRelations {
  repeatOf: { id: number; gapMs: number } | null;
  landedAfterNewer: { id: number; lateMs: number } | null;
  chainedAfter: { id: number; viaCommit: number | null; gapMs: number } | null;
}

const OPERATION_PARAMS = ['operation', 'operationName', 'opName'];
const round = (value: number): number => Math.round(value * 10) / 10;

/** The URL without its query, except a GraphQL operation name. */
export function endpointKey(url: string): string {
  try {
    const parsed = new URL(url, 'http://local.invalid');
    const op = OPERATION_PARAMS.map((name) => parsed.searchParams.get(name)).find(Boolean);
    return parsed.origin + parsed.pathname + (op ? '?op=' + op : '');
  } catch (_) {
    return url.split('?')[0];
  }
}

export function relateRequests(requests: LinkedRequest[]): Map<number, RequestRelations> {
  const byStart = requests.slice().sort((a, b) => a.startTime - b.startTime || a.id - b.id);
  const out = new Map<number, RequestRelations>();
  const lastByUrl = new Map<string, LinkedRequest>();
  const byEndpoint = new Map<string, LinkedRequest[]>();
  const landedBeforeCommit = new Map<number, LinkedRequest>();
  for (const request of byStart) {
    if (request.landedBefore) {
      const prior = landedBeforeCommit.get(request.landedBefore.commitId);
      if (!prior || request.endTime > prior.endTime) landedBeforeCommit.set(request.landedBefore.commitId, request);
    }
  }

  for (const request of byStart) {
    const urlKey = request.initiatorType + ' ' + request.url;
    const previous = lastByUrl.get(urlKey);
    lastByUrl.set(urlKey, request);

    let chainedAfter: RequestRelations['chainedAfter'] = null;
    const viaCommit = request.startedAfter?.commitId;
    const landed = viaCommit === undefined ? undefined : landedBeforeCommit.get(viaCommit);
    if (viaCommit !== undefined && landed && landed.id !== request.id && landed.endTime <= request.startTime) {
      chainedAfter = { id: landed.id, viaCommit, gapMs: round(request.startTime - landed.endTime) };
    } else {
      // A response that finished just before this request, with no commit after it.
      const commitEnd = request.startedAfter ? request.startTime - request.startedAfter.gapMs : -Infinity;
      let best: LinkedRequest | null = null;
      for (const other of byStart) {
        if (other.startTime >= request.startTime) break;
        const gap = request.startTime - other.endTime;
        if (gap >= 0 && gap <= DIRECT_CHAIN_GAP_MS && other.endTime >= commitEnd && (!best || other.endTime > best.endTime)) best = other;
      }
      if (best) chainedAfter = { id: best.id, viaCommit: null, gapMs: round(request.startTime - best.endTime) };
    }

    out.set(request.id, {
      repeatOf: previous ? { id: previous.id, gapMs: round(request.startTime - previous.startTime) } : null,
      landedAfterNewer: null,
      chainedAfter,
    });

    const endpoint = endpointKey(request.url) + ' ' + request.initiatorType;
    const peers = byEndpoint.get(endpoint) ?? [];
    // Older requests to this endpoint still in flight that finish after this one.
    for (const older of peers) {
      if (older.endTime <= request.endTime || older.startTime >= request.startTime) continue;
      const relation = out.get(older.id)!;
      const lateMs = round(older.endTime - request.endTime);
      if (!relation.landedAfterNewer || lateMs > relation.landedAfterNewer.lateMs) relation.landedAfterNewer = { id: request.id, lateMs };
    }
    peers.push(request);
    byEndpoint.set(endpoint, peers);
  }
  return out;
}

/** Follows `chainedAfter` back from each request; returns the longest chain, earliest first. */
export function longestChain(requests: LinkedRequest[], relations: Map<number, RequestRelations>): { ids: number[]; ms: number } | null {
  const byId = new Map(requests.map((request) => [request.id, request]));
  const depth = new Map<number, number[]>();
  const chainOf = (id: number, seen: Set<number>): number[] => {
    const cached = depth.get(id);
    if (cached) return cached;
    const parent = relations.get(id)?.chainedAfter?.id;
    const chain = parent !== undefined && byId.has(parent) && !seen.has(parent)
      ? [...chainOf(parent, new Set(seen).add(id)), id]
      : [id];
    depth.set(id, chain);
    return chain;
  };
  let best: number[] = [];
  for (const request of requests) {
    const chain = chainOf(request.id, new Set([request.id]));
    if (chain.length > best.length) best = chain;
  }
  if (best.length < 2) return null;
  const first = byId.get(best[0])!;
  const last = byId.get(best[best.length - 1])!;
  return { ids: best, ms: round(last.endTime - first.startTime) };
}
