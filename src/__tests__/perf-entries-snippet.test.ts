// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(__dirname, '../../.agents/skills/chippy/snippets/perf-entries.js'), 'utf8');

type Entry = Record<string, unknown> & { name: string; startTime: number; duration: number };

// Delivers `buffered` entries of the observed type, like a browser with `buffered: true`.
function stubObserver(buffered: Record<string, Entry[]>) {
  class FakeObserver {
    static supportedEntryTypes = ['mark', 'measure', 'paint', 'resource'];
    private type = '';
    constructor(private readonly callback: (list: { getEntries: () => Entry[] }) => void) {}
    observe({ type }: { type: string }) { this.type = type; }
    takeRecords() { return buffered[this.type] || []; }
    disconnect() {}
  }
  vi.stubGlobal('PerformanceObserver', FakeObserver);
}

// Runs the snippet the way the page bridge's eval-script does.
async function run(args: Record<string, string> = {}) {
  const ctx = { args, log: [] as string[], helpers: { getDisplayName: () => null, fiberInfo: () => null } };
  const factory = new Function('ctx', `"use strict"; return (async function chippyScript(ctx){\n${SOURCE}\n}).call(globalThis, ctx);`);
  return factory(ctx);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('perf-entries snippet: User Timing', () => {
  it('returns marks latest first and measures longest first, with bounded detail', async () => {
    stubObserver({
      mark: [
        { name: 'app-start', startTime: 10, duration: 0, detail: null },
        { name: 'data-ready', startTime: 250.04, duration: 0, detail: { route: '/board', ids: Array.from({ length: 100 }, (_, i) => i) } },
      ],
      measure: [
        { name: 'boot', startTime: 10, duration: 240.06, detail: 'cold' },
        { name: 'render', startTime: 250, duration: 30, detail: undefined },
      ],
    });
    const result = await run({ types: 'mark,measure' });

    expect(result.ok).toBe(true);
    expect(result.unsupported).toEqual([]);
    expect(result.summary).toEqual({ marks: 2, measures: 2, longestMeasure: { name: 'boot', duration: 240.1 } });
    expect(result.entries.mark.items.map((m: Entry) => m.name)).toEqual(['data-ready', 'app-start']);
    const [ready, start] = result.entries.mark.items;
    expect(ready.startTime).toBe(250);
    expect(ready.detail.startsWith('{"route":"/board","ids":[0,1,2')).toBe(true);
    expect(ready.detail.endsWith('…')).toBe(true);
    expect(ready.detail.length).toBe(201);
    expect(start.detail).toBeNull();
    expect(result.entries.measure.items).toEqual([
      { name: 'boot', startTime: 10, duration: 240.1, detail: '"cold"', commits: undefined },
      { name: 'render', startTime: 250, duration: 30, detail: null, commits: undefined },
    ]);
  });

  it('includes User Timing by default and keeps other supported types instead of failing', async () => {
    stubObserver({
      mark: [{ name: 'm', startTime: 5, duration: 0 }],
      resource: [{ name: 'https://example.test/app.js', startTime: 20, duration: 12.34 }],
    });
    const byDefault = await run();
    expect(byDefault.supported).toEqual(['paint', 'mark', 'measure']);
    expect(byDefault.entries.mark.count).toBe(1);

    const resources = await run({ types: 'resource' });
    expect(resources.ok).toBe(true);
    expect(resources.entries.resource.items).toEqual([{ name: 'https://example.test/app.js', startTime: 20, duration: 12.3 }]);
  });
});
