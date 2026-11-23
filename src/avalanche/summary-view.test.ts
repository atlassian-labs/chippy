import { describe, expect, it } from 'vitest';
import { buildSummaryView } from './summary-view';

// Stat tuples follow UPSTREAM_COMMIT_STAT_KEYS: collateral, sources, restarts, performedWork, ...
const tuple = (collateral: number, sources: number) => [collateral, sources, 0, collateral + sources, 0, 0, 0, 0, 0, 0];

function report() {
  return {
    meta: { detectionMode: 'full' },
    sources: [{ sourceId: 'A#1@1' }, { sourceId: 'B#1@2' }],
    commitStats: { 1: tuple(2, 1), 2: tuple(9, 2), 3: tuple(9, 1) },
    commitTimings: {
      1: { startTime: 100, endTime: 104, ticks: 1, render: { workMs: 3 } },
      2: { startTime: 120, endTime: 130, paintAt: 145, ticks: 2, render: { workMs: 8.500000047683716 } },
    },
    sourcesByCommit: {
      2: [
        { sourceId: 'A#1@1', collateral: 6, trashers: [{ index: 0, prevValue: { a: 1 }, currentValue: { a: 1 } }, { index: 2, prevValue: 1, currentValue: 2 }] },
        { sourceId: 'B#1@2', collateral: 3, trashers: [] },
      ],
    },
    interactionsByCommit: { 2: [{ id: 7, type: 'click', target: 'button' }] },
    hooks: { 'demo.count': { start: null, end: { total: 3 }, steps: { 2: { n: 2 } }, errors: [] } },
  };
}

describe('buildSummaryView', () => {
  it('totals every commit and lists the top commits by collateral, then id', () => {
    const view = buildSummaryView(report(), { top: 2 });
    expect(view).toMatchObject({ commits: 3, firstCommitId: 1, lastCommitId: 3, sources: 2, meta: { detectionMode: 'full' } });
    expect(view.totals).toMatchObject({ collateral: 20, sources: 4, performedWork: 24 });
    expect(view.topCommits.map((c) => c.commitId)).toEqual([2, 3]);
  });

  it('describes each top commit: timing, sources, changed hooks, input, and pack steps', () => {
    const [commit] = buildSummaryView(report(), { top: 1, maxItems: 1 }).topCommits;
    expect(commit).toMatchObject({
      commitId: 2,
      stat: { collateral: 9, sources: 2 },
      renderMs: 8.5,
      ticks: 2,
      paintDelayMs: 15,
      sourcesTotal: 2,
      sources: [{ sourceId: 'A#1@1', collateralAtCommit: 6, changedHooks: [{ index: 0, sameContent: true }, { index: 2, sameContent: false }] }],
      hooks: { 'demo.count': { n: 2 } },
    });
    expect(commit.latestAction).not.toBeNull();
    // Zero counters are left out, and render time is rounded to 0.1 ms.
    expect(commit.stat).toEqual({ collateral: 9, sources: 2, performedWork: 11 });
  });

  it('carries the timeline as text, leaving structured waits and boundaries to avalanche-timeline', () => {
    const { timeline } = buildSummaryView(report());
    expect(Object.keys(timeline).sort()).toEqual(['omitted', 'origin', 'text', 'window']);
  });

  it('reports missing timings and evidence as null or empty, not zero', () => {
    const [, commit] = buildSummaryView(report(), { top: 2 }).topCommits;
    expect(commit).toMatchObject({ commitId: 3, atMs: null, renderMs: null, ticks: null, paintDelayMs: null, sourcesTotal: 0, sources: [], rebuiltProps: null, latestAction: null });
  });

  it('says which rebuilt object props of a top commit kept their values', () => {
    const r = {
      ...report(),
      renderedByCommit: {
        2: [{ sourceId: 'LayerUI#1@1', name: 'LayerUI', propChanges: [{ name: 'appState', kind: 'ref-changed', current: 'object{theme}', sameShallow: true, changedKeys: [], changedKeyCount: 0 }] }],
      },
    };
    const [commit] = buildSummaryView(r, { top: 1 }).topCommits;
    expect(commit.rebuiltProps).toEqual({
      sameShallow: 1,
      keysChanged: 0,
      notCompared: 0,
      groups: [{ prop: 'appState', component: 'LayerUI', sourceId: 'LayerUI#1@1', components: 1, sameShallow: true }],
      omittedGroups: 0,
    });
  });

  it('reports a commit just before the rounded origin at 0 ms, not -0', () => {
    // The timeline origin is rounded to 0.1 ms: 100.06 becomes 100.1, so the commit sits 0.04 ms before it.
    const r = report();
    r.commitTimings[1].startTime = 100.06;
    const commit = buildSummaryView(r, { top: 3 }).topCommits.find((c) => c.commitId === 1)!;
    expect(Object.is(commit.atMs, 0)).toBe(true);
  });

  it('falls back to the defaults for invalid limits and handles an empty capture', () => {
    expect(buildSummaryView(report(), { top: 'x', maxItems: -1 }).topCommits).toHaveLength(3);
    const empty = buildSummaryView({ meta: {}, commitStats: {} });
    expect(empty).toMatchObject({ commits: 0, firstCommitId: null, lastCommitId: null, sources: 0, topCommits: [] });
  });

  it('names the long frame each top commit ran in and summarizes the page metrics', () => {
    const r = {
      ...report(),
      perfEntries: [
        { id: 1, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 95, duration: 40, blockingDuration: 0, scripts: [] },
        { id: 2, entryType: 'mark', name: 'ready', startTime: 140, duration: 0 },
      ],
    };
    const view = buildSummaryView(r, { top: 3 });
    const byId = Object.fromEntries(view.topCommits.map((c) => [c.commitId, c.longFrame]));
    expect(byId[2]).toEqual({ atMs: -5, durationMs: 40, blockingMs: 0, commits: [1, 2] });
    expect(byId[3]).toBeNull();
    expect(view.perf).toMatchObject({ longFrames: 1, marks: 1, worstFrame: { id: 1, commits: [1, 2] } });
    expect(buildSummaryView(report()).perf).toBeNull();
  });
});

