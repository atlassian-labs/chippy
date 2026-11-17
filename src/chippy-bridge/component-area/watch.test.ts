import { afterEach, describe, expect, it } from 'vitest';
import type { AreaOptions, AreaReport } from './measure';
import { readAreaWatch, startAreaWatch, stopAreaWatch, type AreaWatchDeps } from './watch';

// A scripted page: each frame returns the next report, and time advances by
// hand so the summary's milestones are exact.
function scriptedDeps(frames: Array<Partial<AreaReport> & { targets?: AreaReport['targets'] }>) {
  let now = 1000;
  let index = 0;
  let onChange: () => void = () => {};
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let nextId = 1;
  const deps: AreaWatchDeps = {
    measure: (_options: AreaOptions) => {
      const frame = frames[Math.min(index++, frames.length - 1)];
      return {
        ok: true, at: now, cellSize: 1, stats: { elements: 0, textRects: 0, ms: 0 },
        root: { label: 'modal', rect: { left: 0, top: 0, right: 0, bottom: 0 }, area: 100 },
        placeholder: { area: 0, share: 0 }, content: { area: 0, share: 0 }, targets: [],
        ...frame,
      } as AreaReport;
    },
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ fn, at: now + ms, id }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    frame: (fn) => fn(),
    observe: (cb) => { onChange = cb; return () => { onChange = () => {}; }; },
  };
  return {
    deps,
    mutateAt(ms: number) {
      now = 1000 + ms;
      onChange();
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= now) timers.shift()!.fn();
    },
  };
}

function target(label: string, area: number, contentArea: number, placeholderArea = 0) {
  const [kind, name] = label.split(':') as ['testid', string];
  return { label, kind, name, elements: 1, area, share: 0, contentArea, contentShare: 0, placeholderArea };
}

afterEach(() => { stopAreaWatch(); });

describe('area watch', () => {
  it('reports when sections appear and when placeholders clear', () => {
    const page = scriptedDeps([
      { placeholder: { area: 80, share: 0.8 } },
      { placeholder: { area: 80, share: 0.8 }, content: { area: 10, share: 0.1 }, targets: [target('testid:header', 20, 10)] },
      { content: { area: 40, share: 0.4 }, targets: [target('testid:header', 20, 10), target('testid:description', 50, 30)] },
    ]);
    startAreaWatch({ testIds: ['header', 'description', 'comments'] }, page.deps);
    page.mutateAt(100);
    page.mutateAt(300);
    const summary = stopAreaWatch();
    if (!summary.ok) throw new Error('watch not started');
    expect(summary.samples.map((s) => s.t)).toEqual([0, 100, 300]);
    expect(summary.placeholder).toMatchObject({ firstAt: 0, peakArea: 80, clearedAt: 300 });
    expect(summary.targets['testid:header']).toMatchObject({ firstSeenAt: 100, firstContentAt: 100, finalArea: 20 });
    expect(summary.targets['testid:description']).toMatchObject({ firstSeenAt: 300, finalContent: 30 });
    expect(summary.targets['testid:comments']).toMatchObject({ firstSeenAt: null, finalArea: 0 });
    expect(summary.content).toMatchObject({ finalArea: 40, reached50At: 300, reached100At: 300 });
  });

  it('keeps only samples whose values changed', () => {
    const page = scriptedDeps([{}, {}, { content: { area: 5, share: 0.05 } }]);
    startAreaWatch({}, page.deps);
    page.mutateAt(100);
    page.mutateAt(200);
    const summary = readAreaWatch();
    if (!summary.ok) throw new Error('watch not started');
    expect(summary.measurements).toBe(3);
    expect(summary.samples.map((s) => s.t)).toEqual([0, 200]);
  });

  it('throttles measurements to the interval', () => {
    const page = scriptedDeps([{}]);
    startAreaWatch({ intervalMs: 100 }, page.deps);
    page.mutateAt(10);
    page.mutateAt(20);
    page.mutateAt(100);
    const summary = readAreaWatch();
    if (!summary.ok) throw new Error('watch not started');
    expect(summary.measurements).toBe(2);
  });

  it('stops after the duration and reports why', () => {
    const page = scriptedDeps([{}]);
    startAreaWatch({ durationMs: 500 }, page.deps);
    page.mutateAt(600);
    const summary = readAreaWatch();
    if (!summary.ok) throw new Error('watch not started');
    expect(summary).toMatchObject({ active: false, stoppedReason: 'duration' });
  });
});
