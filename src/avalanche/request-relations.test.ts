import { describe, expect, it } from 'vitest';
import type { NetworkRequest } from './network-capture';
import { linkNetworkRequests, networkView } from './network-signals';
import { endpointKey, longestChain, relateRequests } from './request-relations';

function request(id: number, url: string, startTime: number, endTime: number): NetworkRequest {
  return { id, url, initiatorType: 'fetch', startTime, endTime, duration: endTime - startTime, status: 200, cached: false, startedBeforeCapture: false };
}

// commit 1 renders 90..100 and commits 100..110; commit 2 renders 310..320 and commits 320..325.
const commitTimings = {
  1: { startTime: 100, endTime: 110, render: { renderStart: 90 } },
  2: { startTime: 320, endTime: 325, render: { renderStart: 310 } },
};
const report = {
  commitTimings,
  networkRequests: [
    request(1, 'https://app.test/graphql?operation=Projects', 120, 300), // lands before commit 2
    request(2, 'https://app.test/graphql?operation=Fields', 330, 500),   // starts after commit 2: waits on 1
    request(3, 'https://app.test/api/search?q=a', 140, 900),             // older search, lands last
    request(4, 'https://app.test/api/search?q=ab', 200, 400),            // newer search, lands first
    request(5, 'https://app.test/api/items', 600, 650),
    request(6, 'https://app.test/api/items', 700, 720),                  // same URL again
    request(7, 'https://app.test/api/next', 655, 680),                   // starts 5 ms after 5 ends
  ],
};

describe('relateRequests', () => {
  const linked = linkNetworkRequests(report);
  const relations = relateRequests(linked);

  it('links a request to the response that landed before the commit it started after', () => {
    expect(relations.get(2)!.chainedAfter).toEqual({ id: 1, viaCommit: 2, gapMs: 30 });
  });

  it('links a request that starts right after a response with no commit between', () => {
    expect(relations.get(7)!.chainedAfter).toEqual({ id: 5, viaCommit: null, gapMs: 5 });
    expect(relations.get(6)!.chainedAfter).toBeNull();
  });

  it('flags repeats of the same URL and responses that land after a newer request', () => {
    expect(relations.get(6)!.repeatOf).toEqual({ id: 5, gapMs: 100 });
    expect(relations.get(5)!.repeatOf).toBeNull();
    expect(relations.get(3)!.landedAfterNewer).toEqual({ id: 4, lateMs: 500 });
    expect(relations.get(4)!.landedAfterNewer).toBeNull();
  });

  it('finds the longest chain', () => {
    expect(longestChain(linked, relations)).toEqual({ ids: [1, 2], ms: 380 });
  });

  it('keys endpoints by path and GraphQL operation', () => {
    expect(endpointKey('https://a.test/graphql?operation=X&v=1')).toBe('https://a.test/graphql?op=X');
    expect(endpointKey('https://a.test/search?q=1')).toBe('https://a.test/search');
  });
});

describe('relateRequests edge cases', () => {
  it('links a direct chain even when a commit ended just before the request', () => {
    // Commit 1 ends at 110; A ends at 113 (after it); B starts at 115.
    const linked = linkNetworkRequests({ commitTimings: { 1: { startTime: 100, endTime: 110 } }, networkRequests: [
      request(1, 'https://app.test/a', 20, 113),
      request(2, 'https://app.test/b', 115, 200),
    ] });
    expect(relateRequests(linked).get(2)!.chainedAfter).toEqual({ id: 1, viaCommit: null, gapMs: 2 });
  });

  it('credits a commit between the response and the request, not a direct chain', () => {
    // A ends at 95, commit 1 commits 100..105, B starts at 108: A -> commit 1 -> B.
    const linked = linkNetworkRequests({ commitTimings: { 1: { startTime: 100, endTime: 105 } }, networkRequests: [
      request(1, 'https://app.test/a', 20, 95),
      request(2, 'https://app.test/b', 108, 200),
    ] });
    expect(relateRequests(linked).get(2)!.chainedAfter).toEqual({ id: 1, viaCommit: 1, gapMs: 13 });
  });

  it('does not credit a response that ended before an unrelated commit', () => {
    // A ends at 95 and lands before commit 2; B starts 5 ms after commit 1, which A did not cause.
    const linked = linkNetworkRequests({ commitTimings: { 1: { startTime: 100, endTime: 105, render: { renderStart: 90 } }, 2: { startTime: 300, endTime: 305, render: { renderStart: 290 } } }, networkRequests: [
      request(1, 'https://app.test/a', 20, 95),
      request(2, 'https://app.test/b', 110, 200),
    ] });
    expect(relateRequests(linked).get(2)!.chainedAfter).toBeNull();
  });

  it('counts every request to a URL repeated under several initiators', () => {
    const xhr = (id: number, start: number) => ({ ...request(id, 'https://app.test/x', start, start + 10), initiatorType: 'xmlhttprequest' });
    const view = networkView({ commitTimings: {}, networkRequests: [
      request(1, 'https://app.test/x', 0, 10), request(2, 'https://app.test/x', 100, 110), xhr(3, 200), xhr(4, 300),
    ] }, { top: 10 });
    expect(view.ok && view.payload.summary).toMatchObject({ repeats: 2, mostRepeated: [{ url: 'https://app.test/x', count: 4 }] });
  });
});

describe('networkView relations', () => {
  it('adds relations to rows and counts them in the summary', () => {
    const view = networkView(report, { top: 10 });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.payload.summary).toMatchObject({
      repeats: 1,
      mostRepeated: [{ url: 'https://app.test/api/items', count: 2 }],
      landedAfterNewer: 1,
      chained: 2,
      longestChain: { ids: [1, 2], ms: 380 },
    });
    const rows = view.payload.rows as Array<{ id: number; chainedAfter: unknown }>;
    expect(rows.find((r) => r.id === 2)!.chainedAfter).toEqual({ id: 1, viaCommit: 2, gapMs: 30 });
  });

  it('keeps relations to requests the filter hides', () => {
    const view = networkView(report, { match: 'Fields' });
    const rows = view.ok ? (view.payload.rows as Array<{ chainedAfter: { id: number } | null }>) : [];
    expect(rows[0].chainedAfter?.id).toBe(1);
  });
});
