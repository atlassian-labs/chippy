import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from './console-capture';
import { consoleForCommit, consoleSummary, consoleView, linkConsoleEntries } from './console-signals';

const entry = (id: number, time: number, extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id, time, level: 'log', source: 'console', repeat: 1, message: `m${id}`, stack: null, location: null, ...extra,
});

const report = {
  meta: { console: { enabled: true, installed: true, windowStart: 0, entries: 5, byLevel: {}, dropped: {}, pausedAt: null } },
  commitTimings: { 1: { startTime: 100 }, 2: { startTime: 200 }, 3: { startTime: 300 } },
  consoleEntries: [
    entry(1, 50, { level: 'warn' }),
    entry(2, 120, { level: 'error', message: 'Failed to fetch board', location: 'app.js:1:2', repeat: 2 }),
    entry(3, 130, { message: '[avalanche] start', chippy: true }),
    entry(4, 250, { level: 'error', source: 'rejection', message: 'Uncaught (in promise) 500' }),
    entry(5, 320, { level: 'info' }),
  ],
};

describe('console signals', () => {
  it('links each entry to the last commit that started before it', () => {
    expect(linkConsoleEntries(report).map((e) => e.commit)).toEqual([
      null,
      { commitId: 1, gapMs: 20 },
      { commitId: 1, gapMs: 30 },
      { commitId: 2, gapMs: 50 },
      { commitId: 3, gapMs: 20 },
    ]);
  });

  it('counts the page\'s occurrences, repeats included, and names the first error', () => {
    expect(consoleSummary(report)).toEqual({
      errors: 3, warnings: 1, other: 1, uncaught: 0, rejections: 1, chippy: 1,
      firstError: { id: 2, time: 120, message: 'Failed to fetch board', location: 'app.js:1:2', commitId: 1 },
    });
  });

  it('filters by level, message, and commit window, and leaves out Chippy\'s own messages', () => {
    const view = consoleView(report, { levels: 'error,log', match: 'fetch|start|m5' }) as any;
    expect(view.payload.entries.map((e: ConsoleEntry) => e.id)).toEqual([2]);
    expect((consoleView(report, { chippy: true, match: 'avalanche' }) as any).payload.entries.map((e: ConsoleEntry) => e.id)).toEqual([3]);
    const windowed = consoleView(report, { fromCommit: 2, toCommit: 2 }) as any;
    expect(windowed.payload.entries.map((e: ConsoleEntry) => e.id)).toEqual([4]);
    expect(windowed.payload.summary.errors).toBe(1);
    expect((consoleView(report, { top: 2 }) as any).payload).toMatchObject({ count: 4, truncated: true });
  });

  it('reports a bad pattern and a report without console entries', () => {
    expect(consoleView(report, { match: '(' })).toMatchObject({ error: expect.stringContaining('invalid match pattern') });
    expect(consoleView({})).toMatchObject({ error: expect.stringContaining('report version 10') });
    expect(consoleView({ meta: { console: { ...report.meta.console, enabled: false } } })).toMatchObject({ error: expect.stringContaining('switched off') });
  });

  it('returns the page\'s entries logged during one commit', () => {
    expect(consoleForCommit(report, 1)).toMatchObject({ total: 1, items: [{ id: 2 }] });
  });
});
