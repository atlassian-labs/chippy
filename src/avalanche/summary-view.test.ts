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
      2: { startTime: 120, endTime: 130, paintAt: 145, ticks: 2, render: { workMs: 8.5 } },
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
  });

  it('reports missing timings and evidence as null or empty, not zero', () => {
    const [, commit] = buildSummaryView(report(), { top: 2 }).topCommits;
    expect(commit).toMatchObject({ commitId: 3, atMs: null, renderMs: null, ticks: null, paintDelayMs: null, sourcesTotal: 0, sources: [], latestAction: null });
  });

  it('falls back to the defaults for invalid limits and handles an empty capture', () => {
    expect(buildSummaryView(report(), { top: 'x', maxItems: -1 }).topCommits).toHaveLength(3);
    const empty = buildSummaryView({ meta: {}, commitStats: {} });
    expect(empty).toMatchObject({ commits: 0, firstCommitId: null, lastCommitId: null, sources: 0, topCommits: [] });
  });
});
