import { describe, expect, it } from 'vitest';
import { evalAvalanche } from '../chippy-bridge/avalanche-commands';
import { createRenderedEvidenceStore } from './rendered-evidence-store';

describe('rendered evidence store', () => {
  it('drops the oldest commits past the entry budget and reports them', () => {
    const byCommit: Record<number, number[]> = {};
    const store = createRenderedEvidenceStore(byCommit, 5);
    store.add(1, [1, 1]);
    store.add(2, [2, 2]);
    expect(store.status()).toEqual({ maxEntries: 5, entries: 4, commits: 2, evicted: null });
    store.add(3, [3, 3, 3]);
    expect(Object.keys(byCommit)).toEqual(['2', '3']);
    store.add(4, [4]);
    expect(Object.keys(byCommit)).toEqual(['3', '4']);
    expect(store.status()).toEqual({ maxEntries: 5, entries: 4, commits: 2, evicted: { commits: 2, entries: 4, throughCommit: 2 } });
    expect(store.inEvictedRange(1)).toBe(true);
    expect(store.inEvictedRange(3)).toBe(false);
  });

  it('keeps the newest commit even when it alone is over budget', () => {
    const byCommit: Record<number, number[]> = {};
    const store = createRenderedEvidenceStore(byCommit, 2);
    store.add(1, [1]);
    store.add(2, [2, 2, 2]);
    expect(Object.keys(byCommit)).toEqual(['2']);
    expect(store.status().entries).toBe(3);
  });

  it('replaces a commit stored twice without counting it twice', () => {
    const byCommit: Record<number, number[]> = {};
    const store = createRenderedEvidenceStore(byCommit, 10);
    store.add(1, [1, 1, 1]);
    store.add(1, [1]);
    expect(store.status()).toMatchObject({ entries: 1, commits: 1 });
  });

  it('reset clears entries and the eviction record', () => {
    const byCommit: Record<number, number[]> = {};
    const store = createRenderedEvidenceStore(byCommit, 1);
    store.add(1, [1]);
    store.add(2, [2]);
    store.reset();
    expect(byCommit).toEqual({});
    expect(store.status()).toEqual({ maxEntries: 1, entries: 0, commits: 0, evicted: null });
  });

  it('commit-peek marks a commit whose rendered evidence was dropped', () => {
    const report = {
      meta: { renderedEvidence: { maxEntries: 1, entries: 1, commits: 1, evicted: { commits: 1, entries: 1, throughCommit: 1 } } },
      sources: [],
      commitStats: { 1: [0, 0], 2: [0, 0] },
      renderedByCommit: { 2: [{ sourceId: 'T1#1@1', name: 'A' }] },
    };
    const peek = (commitId: number) => (evalAvalanche(
      { action: 'commit-peek', commitId, include: ['stats', 'rendered'] } as any,
      { report: () => report } as any,
      null,
    ) as any).payload;
    expect(peek(1).renderedEvicted).toBe(true);
    expect(peek(2).renderedEvicted).toBeUndefined();
    expect(peek(2).renderedTotal).toBe(1);
  });
});
