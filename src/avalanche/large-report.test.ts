// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { evalAvalanche, type AvalancheApi } from '../chippy-bridge/avalanche-commands';
import { buildReport, type ProfilerState } from './reporter';

const COMMITS = 120;
const SOURCES = 400;
const BUSY_COMMIT = 54;

// A page-sized capture: hundreds of sources fire in one commit, and their
// changed hooks hold refs to DOM nodes that point back at their fibers, which
// is what React refs look like on a real page.
function largeState(): ProfilerState {
  const sources: ProfilerState['sources'] = new Map();
  for (let i = 0; i < SOURCES; i++) {
    const type = Object.defineProperty(function () { return null; }, 'name', { value: `Cell${i}` });
    const node = document.createElement('button');
    const fiber: Record<string, unknown> = { tag: 5, stateNode: node, return: null, memoizedProps: {} };
    (node as unknown as Record<string, unknown>).__reactFiber$test = fiber;
    const updateHistory: Record<number, Record<number, { prevValue: unknown; currentValue: unknown }>> = {
      [BUSY_COMMIT]: { 0: { prevValue: { current: null }, currentValue: { current: node } } },
    };
    const collateralByCommit: Record<number, number> = { [BUSY_COMMIT]: SOURCES - i };
    for (let commit = 1; commit <= COMMITS; commit += 7) {
      updateHistory[commit] = { 1: { prevValue: commit, currentValue: { node, items: [node, node] } } };
      collateralByCommit[commit] = 1 + (i % 5);
    }
    sources.set(`T${i}#1@${i}`, {
      type, depth: i, renderCount: 1, causedUpdates: 1, collateralUpdates: SOURCES - i,
      maxCollateralUpdates: SOURCES - i, maxPenetrationDepth: i + 3,
      updateHistory, collateralByCommit,
    } as never);
  }
  const commitStats: ProfilerState['commitStats'] = {};
  for (let commit = 1; commit <= COMMITS; commit++) {
    commitStats[commit] = [10, commit === BUSY_COMMIT ? SOURCES : 1, 0, 3000, 0, 0, 0, 0, 0, 0] as never;
  }
  return {
    commits: COMMITS, sources, amplifiers: new Map(), amplifierSources: new Map(), thrashCounts: null,
    memoizedUpdatersAvailable: false, commitsWithMemoizedUpdaters: 0, commitStats,
    metricsByCommit: {}, lastMetricsSnapshot: null, commitTimings: {}, lastCommitEndTime: 0,
    suspenseByCommit: {}, unmountsByCommit: {}, interactionActions: [], interactionsByCommit: {},
    networkRequests: [], renderedByCommit: {},
  };
}

function apiFor(state: ProfilerState): AvalancheApi {
  return { report: (topN = 10) => buildReport(state, false, topN, 'effect') as never };
}

describe('Avalanche commands on a large capture', () => {
  it('peeks a commit with hundreds of sources quickly, JSON-safe, with every row resolved', () => {
    const api = apiFor(largeState());
    const started = performance.now();
    const result = evalAvalanche({ action: 'commit-peek', commitId: BUSY_COMMIT, include: ['sources', 'actions'], maxItems: 4 }, api, null);
    const text = JSON.stringify(result);
    const elapsed = performance.now() - started;
    const payload = result.payload as { sources: Array<Record<string, unknown>>; sourcesTotal: number };
    expect(payload.sourcesTotal).toBe(SOURCES);
    expect(payload.sources).toHaveLength(4);
    expect(payload.sources.some((row) => row.missing)).toBe(false);
    expect(payload.sources[0].trashers).toEqual([
      { index: 0, prevValue: { current: null }, currentValue: { current: '[HTMLButtonElement button]' } },
    ]);
    expect(text.length).toBeLessThan(4000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('exports the whole capture as JSON with every source', () => {
    const api = apiFor(largeState());
    const result = evalAvalanche({ action: 'export' }, api, null);
    expect(result.ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(result.payload));
    expect(saved.sources).toHaveLength(SOURCES);
    expect(saved.sourcesByCommit[BUSY_COMMIT]).toHaveLength(SOURCES);
  });

  it('ranks more than ten hot sources when the limit asks for them', () => {
    const result = evalAvalanche({ action: 'hot-sources', limit: 50 }, apiFor(largeState()), null);
    expect(result.total).toBe(SOURCES);
    expect((result.payload as { count: number }).count).toBe(50);
  });
});
