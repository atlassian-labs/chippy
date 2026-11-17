import { describe, expect, it } from 'vitest';
import type { NetworkRequest } from './network-capture';
import { linkNetworkRequests, networkByCommit, networkView } from './network-signals';

function request(id: number, url: string, startTime: number, endTime: number, initiatorType = 'fetch'): NetworkRequest {
  return {
    id, url, initiatorType, startTime, endTime, duration: endTime - startTime,
    status: 200, cached: false, startedBeforeCapture: false,
  };
}

/**
 * Timeline (ms):
 *   commit 1  render 100..110, commit 110..115
 *   commit 2  render 400..420, commit 420..425
 *   commit 3  render unknown,  commit 1200..1205
 */
const commitTimings = {
  1: { startTime: 110, endTime: 115, render: { renderStart: 100 } },
  2: { startTime: 420, endTime: 425, render: { renderStart: 400 } },
  3: { startTime: 1200, endTime: 1205, render: null },
};

const requests = [
  request(1, 'https://app.test/api/items', 130, 380),          // after commit 1, lands before commit 2
  request(2, 'https://app.test/api/user', 405, 1250),          // during commit 2 render, nothing after
  request(3, 'https://cdn.test/logo.png', 700, 710, 'img'),    // far from every commit
];

const report = { meta: { network: { supported: true } }, commitTimings, networkRequests: requests };

describe('linkNetworkRequests', () => {
  it('links each request to the commits around it', () => {
    const [items, user, logo] = linkNetworkRequests(report);
    expect(items).toMatchObject({
      startedAfter: { commitId: 1, gapMs: 15 },
      startedDuringRender: null,
      landedBefore: { commitId: 2, gapMs: 20 },
      commitsInFlight: 0,
    });
    expect(user).toMatchObject({
      startedAfter: null,
      startedDuringRender: 2,
      landedBefore: null,
      commitsInFlight: 2,
    });
    expect(logo).toMatchObject({ startedAfter: null, startedDuringRender: null, landedBefore: null });
  });

  it('honours the window and uses commit start when render start is unknown', () => {
    const [, , logo] = linkNetworkRequests(report, 500);
    expect(logo.startedAfter).toEqual({ commitId: 2, gapMs: 275 });
    expect(logo.landedBefore).toEqual({ commitId: 3, gapMs: 490 });
    const [items] = linkNetworkRequests(report, 10);
    expect(items.startedAfter).toBeNull();
    expect(items.landedBefore).toBeNull();
  });

  it('returns nothing for a report without network data', () => {
    expect(linkNetworkRequests({ commitTimings })).toEqual([]);
  });
});

describe('networkView', () => {
  it('summarizes, sorts, and limits rows', () => {
    const view = networkView(report, { by: 'duration', top: 2 });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.payload).toMatchObject({
      available: true,
      capture: { supported: true },
      windowMs: 250,
      by: 'duration',
      total: 3,
      summary: {
        byInitiator: { fetch: 2, img: 1 },
        landedBeforeCommit: 1,
        startedAfterCommit: 1,
        startedDuringRender: 1,
        longest: { id: 2, url: 'https://app.test/api/user', duration: 845 },
      },
    });
    expect((view.payload.rows as NetworkRequest[]).map((r) => r.id)).toEqual([2, 1]);
  });

  it('filters by URL pattern and initiator', () => {
    const matched = networkView(report, { match: 'API/', by: 'end' });
    expect(matched.ok && (matched.payload.rows as NetworkRequest[]).map((r) => r.id)).toEqual([1, 2]);
    const images = networkView(report, { initiators: ['IMG'] });
    expect(images.ok && images.payload.total).toBe(1);
  });

  it('rejects an unknown sort key and an invalid pattern', () => {
    expect(networkView(report, { by: 'size' })).toEqual({
      ok: false, error: 'unsupported network sort key: size', validBy: ['start', 'end', 'duration'],
    });
    const bad = networkView(report, { match: '(' });
    expect(bad.ok).toBe(false);
    expect('error' in bad && bad.error).toMatch(/^invalid match pattern/);
  });

  it('reports unavailable when the export has no network data', () => {
    const view = networkView({ commitTimings });
    expect(view.ok && view.payload).toMatchObject({ available: false, capture: null, total: 0 });
  });
});

describe('networkByCommit', () => {
  it('groups requests by the commit they link to and counts in-flight requests', () => {
    const byCommit = networkByCommit(report);
    expect(byCommit.get(1)?.startedAfter.map((r) => r.id)).toEqual([1]);
    expect(byCommit.get(2)?.landedBefore.map((r) => r.id)).toEqual([1]);
    expect(byCommit.get(2)?.startedDuringRender.map((r) => r.id)).toEqual([2]);
    expect(byCommit.get(2)?.inFlight).toBe(1);
    expect(byCommit.get(3)?.inFlight).toBe(1);
  });
});
