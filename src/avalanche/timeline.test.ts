import { describe, expect, it } from 'vitest';
import { buildTimeline, ganttTaskName, requestLabel, type TimelineResult } from './timeline';

// Click at 1000. Commit 1 shows a fallback at depth 10; a request ends at
// 1400; commit 2 is an update while waiting; commit 3 reveals the content.
// A second click at 3000 opens and closes its own short wait.
const report = {
  commitTimings: {
    1: { startTime: 1100, endTime: 1105, render: null },
    2: { startTime: 1200, endTime: 1201, render: { renderStart: 1180 } },
    3: { startTime: 1500, endTime: 1520, render: null },
    4: { startTime: 1600, endTime: 1601, render: null },
    5: { startTime: 3050, endTime: 3051, render: null },
    6: { startTime: 3100, endTime: 3101, render: null },
  },
  commitStats: {
    1: [0, 1, 0, 40], 2: [0, 1, 0, 300], 3: [0, 1, 0, 900], 4: [0, 1, 0, 5], 5: [0, 1, 0, 3], 6: [0, 1, 0, 3],
  },
  suspenseByCommit: {
    1: [{ depth: 10, entered: true, left: false }],
    3: [{ depth: 10, entered: false, left: true }],
    5: [{ depth: 20, entered: true, left: false }],
    6: [{ depth: 20, entered: false, left: true }],
  },
  sourcesByCommit: { 2: [{ sourceId: 'Busy#1@3', collateral: 10 }] },
  interactionsByCommit: {
    1: [{ id: 7, action: 'click', timestamp: 1000, location: { dom: { nearestTestId: 'card' } } }],
    2: [{ id: 7, action: 'click', timestamp: 1000, location: { dom: { nearestTestId: 'card' } } }],
    5: [{ id: 8, action: 'click', timestamp: 3000, location: { dom: { nearestTestId: 'close' } } }],
  },
  networkRequests: [
    { id: 1, url: 'https://api.test/graphql?operation=ItemQuery', initiatorType: 'fetch', startTime: 1010, endTime: 1400, duration: 390, status: 200, cached: false, startedBeforeCapture: false },
    { id: 2, url: 'https://api.test/tiny', initiatorType: 'fetch', startTime: 1010, endTime: 1020, duration: 10, status: 200, cached: false, startedBeforeCapture: false },
  ],
};

function built(options = {}): TimelineResult {
  const result = buildTimeline(report as never, options);
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('buildTimeline', () => {
  it('measures time from the interaction and dedupes repeated interactions', () => {
    const t = built();
    expect(t.origin).toEqual({ at: 1000, kind: 'interaction' });
    expect(t.lanes.input).toEqual([
      { t: 0, action: 'click', target: 'card' },
      { t: 2000, action: 'click', target: 'close' },
    ]);
  });

  it('pairs Suspense lock and unlock into user waits with what ran meanwhile', () => {
    const t = built();
    expect(t.lanes.suspense.map((s) => [s.depth, s.start, s.end])).toEqual([[10, 100, 500], [20, 2050, 2100]]);
    const wait = t.perceived.waits.find((w) => w.depth === 10)!;
    expect(wait).toMatchObject({ waitedMs: 400, lockedBy: 1, unlockedBy: 3, updatesDuring: { commits: 1, rendered: 300 } });
    expect(wait.lastRequests[0]).toEqual({ label: 'ItemQuery', end: 400, gapMs: 100 });
  });

  it('settles the opening interaction before the next input starts its own wait', () => {
    const t = built();
    expect(t.perceived).toMatchObject({ firstLockAt: 100, settledAt: 500, stillWaiting: [], updatesAfterSettled: { commits: 1, rendered: 5 } });
  });

  it('classifies commits and uses render start only when it is recorded', () => {
    const t = built();
    const byId = Object.fromEntries(t.lanes.commits.map((c) => [c.commitId, c]));
    expect(byId[1]).toMatchObject({ kind: 'lock', renderStart: null });
    expect(byId[2]).toMatchObject({ kind: 'update', renderStart: 180, rendered: 300, sources: ['Busy'] });
    expect(byId[3]).toMatchObject({ kind: 'unlock' });
  });

  it('reports a fallback still shown at the end of the window', () => {
    const t = built({ toCommit: 2 });
    expect(t.perceived).toMatchObject({ settledAt: null, stillWaiting: [10] });
    expect(t.lanes.suspense[0]).toMatchObject({ depth: 10, end: null });
  });

  it('drops short requests and renders a valid-looking gantt', () => {
    const t = built();
    expect(t.lanes.network.map((r) => r.label)).toEqual(['ItemQuery']);
    expect(t.mermaid.split('\n')[0]).toBe('gantt');
    expect(t.mermaid).toContain('section User waits (fallback shown)');
    expect(t.mermaid).toContain('ItemQuery 390ms :crit, net1, 10, 400');
    expect(t.mermaid).toContain('c2 300 rendered Busy :crit, c2, 180, 200');
    // Task names must not carry Mermaid separators.
    for (const line of t.mermaid.split('\n').filter((l) => l.includes(' :'))) {
      expect(line.slice(0, line.lastIndexOf(' :'))).not.toMatch(/[:#;]/);
    }
    expect(t.text).toContain('all cleared at +500');
  });

  it('never starts a task line with a gantt keyword', () => {
    const t = built();
    expect(t.mermaid).toContain('user click card :milestone, in0, 0, 0');
    const keyword = /^(click|call|href|section|title|dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|acctitle|accdescr)\b/i;
    const tasks = t.mermaid.split('\n').slice(4).map((line) => line.trim()).filter((line) => !line.startsWith('section '));
    for (const line of tasks) expect(line).not.toMatch(keyword);
    expect(ganttTaskName('click card')).toBe('· click card');
    expect(ganttTaskName('Section header')).toBe('· Section header');
    expect(ganttTaskName('Clicker list')).toBe('Clicker list');
    expect(ganttTaskName('a: b # c ; d %% e')).toBe('a b c d % % e');
  });

  it('labels requests by GraphQL operation, else by path', () => {
    expect(requestLabel('https://x.test/gql?operationName=Foo')).toBe('Foo');
    expect(requestLabel('https://x.test/api/v2/items/123')).toBe('x.test …/v2/items');
  });

  it('fails clearly without commit timings', () => {
    expect(buildTimeline({} as never)).toMatchObject({ ok: false });
  });
});
