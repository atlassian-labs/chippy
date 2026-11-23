import { describe, expect, it } from 'vitest';
import type { PerfEntry } from './perf-capture';
import { linkPerfEntries, perfForCommit, perfSummary, perfView } from './perf-signals';

/**
 * Commits start at 100, 150, 400, 1000.
 * A long frame 90..300 holds commits 1 and 2; a measure 50..1100 spans them all.
 */
const commitTimings = {
  1: { startTime: 100 },
  2: { startTime: 150 },
  3: { startTime: 400 },
  4: { startTime: 1000 },
};

const perfEntries: PerfEntry[] = [
  { id: 1, entryType: 'navigation', name: 'https://app.test/', startTime: 0, duration: 900, ttfb: 120 },
  { id: 2, entryType: 'measure', name: 'ttai', startTime: 50, duration: 1050, detail: null },
  { id: 3, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 90, duration: 210, blockingDuration: 160, scripts: [] },
  { id: 4, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 410, duration: 60, blockingDuration: 10, scripts: [] },
  { id: 5, entryType: 'mark', name: 'board:ready', startTime: 420, duration: 0, detail: null },
  { id: 6, entryType: 'layout-shift', name: '', startTime: 500, duration: 0, value: 0.05, hadRecentInput: false, sources: [] },
  { id: 7, entryType: 'layout-shift', name: '', startTime: 900, duration: 0, value: 0.02, hadRecentInput: false, sources: [] },
  { id: 8, entryType: 'layout-shift', name: '', startTime: 950, duration: 0, value: 0.5, hadRecentInput: true, sources: [] },
  { id: 9, entryType: 'event', name: 'pointerdown', startTime: 95, duration: 40, interactionId: 3 },
  { id: 10, entryType: 'event', name: 'click', startTime: 96, duration: 220, interactionId: 3 },
  { id: 11, entryType: 'paint', name: 'first-contentful-paint', startTime: 310, duration: 0 },
  { id: 12, entryType: 'largest-contentful-paint', name: '', startTime: 700, duration: 0 },
];

const report = { meta: { perf: { enabled: true } as never }, commitTimings, perfEntries };

describe('linkPerfEntries', () => {
  it('lists commits that started inside the span and the last one at or before it', () => {
    const byId = Object.fromEntries(linkPerfEntries(report).map((e) => [e.id, e.commits]));
    expect(byId[3]).toEqual({ during: [1, 2], duringCount: 2, before: null });
    expect(byId[2]).toEqual({ during: [1, 2, 3, 4], duringCount: 4, before: null });
    expect(byId[5]).toEqual({ during: [], duringCount: 0, before: { commitId: 3, gapMs: 20 } });
  });
});

describe('perfSummary', () => {
  it('derives the page metrics', () => {
    expect(perfSummary(report)).toEqual({
      cls: 0.07,
      layoutShifts: 3,
      longFrames: 2,
      totalBlockingMs: 170,
      chippyFrames: { count: 0, blockingMs: 0 },
      worstFrame: { id: 3, startTime: 90, duration: 210, blockingDuration: 160, commits: [1, 2] },
      interactions: 1,
      worstInteractionMs: 220,
      lcpMs: 700,
      fcpMs: 310,
      ttfbMs: 120,
      marks: 1,
      measures: 1,
      longestMeasure: { name: 'ttai', startTime: 50, duration: 1050 },
    });
  });

  it('counts long task time over 50 ms as blocking where frames are missing', () => {
    const tasks: PerfEntry[] = [
      { id: 1, entryType: 'longtask', name: 'self', startTime: 0, duration: 120 },
      { id: 2, entryType: 'longtask', name: 'self', startTime: 500, duration: 60 },
    ];
    expect(perfSummary({ perfEntries: tasks })).toMatchObject({ longFrames: 2, totalBlockingMs: 80, worstFrame: null });
  });

  it("leaves Chippy's own long frames out of the page metrics", () => {
    // Frame 3 (90..300) has no attributed scripts and overlaps a Chippy command.
    const own = { ...report, ownWork: [{ start: 80, end: 320, label: 'eval-avalanche' }] };
    expect(perfSummary(own)).toMatchObject({
      longFrames: 1,
      totalBlockingMs: 10,
      chippyFrames: { count: 1, blockingMs: 160 },
      worstFrame: { id: 4 },
    });
  });
});

describe('perfView', () => {
  it('groups by type, ranks, and links each listed entry', () => {
    const out = perfView(report, { types: 'long-animation-frame,layout-shift', top: 1 });
    if (!('payload' in out)) throw new Error(out.error);
    expect(Object.keys(out.payload.entries).sort()).toEqual(['layout-shift', 'long-animation-frame']);
    expect(out.payload.entries['long-animation-frame']).toMatchObject({ count: 2, items: [{ id: 3, commits: { during: [1, 2] } }] });
    expect(out.payload.entries['layout-shift'].items.map((e) => e.id)).toEqual([8]);
    expect(out.payload.summary.longFrames).toBe(2);
  });

  it('filters by name and by commit range', () => {
    const named = perfView(report, { match: '^board' });
    if (!('payload' in named)) throw new Error(named.error);
    expect(Object.keys(named.payload.entries)).toEqual(['mark']);

    const ranged = perfView(report, { types: ['long-animation-frame', 'mark'], fromCommit: 3, toCommit: 3 });
    if (!('payload' in ranged)) throw new Error(ranged.error);
    expect(ranged.payload.entries['long-animation-frame'].items.map((e) => e.id)).toEqual([4]);
    expect(ranged.payload.entries.mark.items.map((e) => e.id)).toEqual([5]);
  });

  it('explains reports without entries and bad patterns', () => {
    expect(perfView({})).toEqual({ error: expect.stringContaining('report version 9') });
    expect(perfView({ meta: { perf: { enabled: false } as never } })).toEqual({ error: expect.stringContaining('switched off') });
    expect(perfView(report, { match: '(' })).toEqual({ error: expect.stringContaining('invalid match pattern') });
  });
});

describe('perfForCommit', () => {
  it('returns entries that hold the commit or follow it, longest first', () => {
    const near = perfForCommit(report, 3);
    expect(near.items.map((e) => e.id)).toEqual([2, 1, 4, 5, 6, 12, 7, 8]);
    expect(perfForCommit(report, 3, 2)).toMatchObject({ total: 8, items: [{ id: 2 }, { id: 1 }] });
  });
});
