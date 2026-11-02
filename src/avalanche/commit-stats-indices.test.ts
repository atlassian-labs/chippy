import { describe, expect, it } from 'vitest';
import {
  CS_COLLATERAL,
  CS_SOURCES,
  CS_RESTARTS,
  CS_PERFORMED_WORK,
  CS_EFFECTS,
  CS_MEMOS,
  CS_CALLBACKS,
  CS_CONTEXT_UPDATES,
  CS_UNMOUNTED_COMPONENTS,
  CS_UNMOUNTED_SUBTREES,
  COMMIT_STATS_LENGTH,
  ALL_COMMIT_STATS_INDICES,
} from './commit-stats-indices';

describe('commit-stats-indices', () => {
  it('defines all 10 indices with correct values', () => {
    expect(CS_COLLATERAL).toBe(0);
    expect(CS_SOURCES).toBe(1);
    expect(CS_RESTARTS).toBe(2);
    expect(CS_PERFORMED_WORK).toBe(3);
    expect(CS_EFFECTS).toBe(4);
    expect(CS_MEMOS).toBe(5);
    expect(CS_CALLBACKS).toBe(6);
    expect(CS_CONTEXT_UPDATES).toBe(7);
    expect(CS_UNMOUNTED_COMPONENTS).toBe(8);
    expect(CS_UNMOUNTED_SUBTREES).toBe(9);
  });

  it('defines COMMIT_STATS_LENGTH as 10', () => {
    expect(COMMIT_STATS_LENGTH).toBe(10);
  });

  it('all values are unique', () => {
    const values = [
      CS_COLLATERAL,
      CS_SOURCES,
      CS_RESTARTS,
      CS_PERFORMED_WORK,
      CS_EFFECTS,
      CS_MEMOS,
      CS_CALLBACKS,
      CS_CONTEXT_UPDATES,
      CS_UNMOUNTED_COMPONENTS,
      CS_UNMOUNTED_SUBTREES,
    ];
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(10);
  });

  it('ALL_COMMIT_STATS_INDICES covers 0..9 in order', () => {
    expect(ALL_COMMIT_STATS_INDICES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ALL_COMMIT_STATS_INDICES length equals COMMIT_STATS_LENGTH', () => {
    expect(ALL_COMMIT_STATS_INDICES.length).toBe(COMMIT_STATS_LENGTH);
  });
});
