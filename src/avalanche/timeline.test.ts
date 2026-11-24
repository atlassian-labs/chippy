import { describe, expect, it } from 'vitest';
import { buildTimeline, ganttTaskName, requestLabel, type TimelineResult } from './timeline';

// Click at 1000. Commit 1 shows a fallback at depth 10; a request ends at
// 1400; commit 2 is an update while waiting; commit 3 reveals the content.
// A second click at 3000 opens and closes its own short wait.
const wrapper = { via: 'parent', name: 'Boundary' };
function screen(rects: number[][], label: string, share: number) {
  return { viewport: [1000, 500], area: 0, removedArea: 0, share, rects, regions: [{ label, area: 0 }], nodes: 1, ms: 0 };
}

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
    1: [{ depth: 10, entered: true, left: false, location: { chain: [wrapper, { via: 'parent', name: 'ItemBody', props: { name: 'item-body' } }] } }],
    3: [{ depth: 10, entered: false, left: true }],
    5: [{ depth: 20, entered: true, left: false, location: { chain: [wrapper, { via: 'owner', name: 'CloseDialog' }] } }],
    6: [{ depth: 20, entered: false, left: true }],
  },
  screenByCommit: {
    1: screen([[0, 0, 1000, 400]], 'skeleton', 0.8),
    3: screen([[0, 0, 1000, 400]], 'item-body', 0.8),
    4: screen([[0, 400, 1000, 500]], 'footer', 0.2),
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
      { t: 0, action: 'click', target: 'card', detail: null },
      { t: 2000, action: 'click', target: 'close', detail: null },
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
    expect(t.perceived).toMatchObject({ settledAt: null, stillWaiting: ['@10'] });
    expect(t.lanes.suspense[0]).toMatchObject({ depth: 10, end: null });
  });

  it('drops short requests and renders a valid-looking gantt', () => {
    const t = built();
    expect(t.lanes.network.map((r) => r.label)).toEqual(['ItemQuery']);
    expect(t.mermaid.split('\n')[0]).toBe('gantt');
    expect(t.mermaid).toContain('section User waits (fallback shown)');
    expect(t.mermaid).toContain('ItemQuery 390ms :crit, net1, 10, 400');
    expect(t.mermaid).toContain('c2 300 rendered 0% screen Busy :crit, c2, 180, 200');
    // Task names must not carry Mermaid separators.
    for (const line of t.mermaid.split('\n').filter((l) => l.includes(' :'))) {
      expect(line.slice(0, line.lastIndexOf(' :'))).not.toMatch(/[:#;]/);
    }
    expect(t.text).toContain('all cleared at +500');
  });

  it('never starts a task line with a gantt keyword', () => {
    const t = built();
    expect(t.mermaid).toContain('input click card :milestone, in0, 0, 0');
    const keyword = /^(click|call|href|section|title|dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|acctitle|accdescr)\b/i;
    const tasks = t.mermaid.split('\n').slice(4).map((line) => line.trim()).filter((line) => !line.startsWith('section '));
    for (const line of tasks) expect(line).not.toMatch(keyword);
    expect(ganttTaskName('click card')).toBe('· click card');
    expect(ganttTaskName('Section header')).toBe('· Section header');
    expect(ganttTaskName('Clicker list')).toBe('Clicker list');
    expect(ganttTaskName('a: b # c ; d %% e')).toBe('a b c d % % e');
  });

  it('labels each wait by the first location entry its boundary does not share', () => {
    const t = built();
    expect(t.lanes.suspense.map((s) => s.label)).toEqual(['ItemBody name=item-body', 'CloseDialog']);
    expect(t.boundaries[0]).toMatchObject({ depth: 10, label: 'ItemBody name=item-body', location: { chain: [{ name: 'Boundary' }, { name: 'ItemBody' }] } });
    expect(t.perceived.waits.find((w) => w.depth === 10)!.label).toBe('ItemBody name=item-body');
    expect(t.mermaid).toContain('ItemBody name=item-body 400ms :crit');
    expect(t.text).toContain('wait ItemBody name=item-body 400ms');
  });

  it('reports visual completeness and the share of the screen each commit changed', () => {
    const t = built();
    expect(t.screen).toMatchObject({ vc50: 500, vc90: 600, vc100: 600, changedShare: 1 });
    const byId = Object.fromEntries(t.lanes.commits.map((c) => [c.commitId, c]));
    expect(byId[3].screen).toEqual({ share: 0.8, region: 'item-body' });
    expect(byId[2].screen).toBeNull();
    expect(t.mermaid).toContain('section Screen changed (share of viewport)');
    expect(t.mermaid).toContain('c3 80% item-body :milestone, sc3, 500, 500');
    expect(t.mermaid).toContain('VC90 +600 :crit, milestone, vc90, 600, 600');
    expect(t.mermaid).toContain('c2 300 rendered 0% screen Busy');
    expect(t.text).toContain('Visually complete: VC50 +500, VC90 +600, VC100 +600');
    expect(t.settleMapSvg).toBeUndefined();
    expect(built({ settleMap: true }).settleMapSvg).toContain('<svg');
  });

  it('names keys and modifiers, and marks events that page code dispatched', () => {
    const t = buildTimeline({
      ...report,
      interactionsByCommit: {
        ...report.interactionsByCommit,
        2: [
          { id: 7, action: 'click', timestamp: 1000, location: { dom: { nearestTestId: 'card' } } },
          { id: 9, action: 'keydown', timestamp: 1150, location: { dom: { nearestTestId: 'card' } }, event: { trusted: true, key: 'Meta', modifiers: ['Meta'] } },
          { id: 10, action: 'keydown', timestamp: 1160, location: { dom: { nearestTestId: 'card' } }, event: { trusted: false, key: 'character', modifiers: ['Shift'] } },
        ],
      },
    } as never);
    if ('error' in t) throw new Error(t.error);
    expect(t.lanes.input.map((i) => i.detail)).toEqual([null, 'Meta', 'character with Shift dispatched', null]);
    expect(t.text).toContain('input  keydown Meta card');
    expect(t.mermaid).toContain('input keydown character with Shift dispatched card');
  });

  it('starts at the first input when page code dispatches another before the first commit', () => {
    const t = buildTimeline({
      ...report,
      interactionsByCommit: {
        ...report.interactionsByCommit,
        1: [
          { id: 7, action: 'click', timestamp: 1000, location: { dom: { nearestTestId: 'card' } }, event: { trusted: true } },
          { id: 8, action: 'click', timestamp: 1008, location: { dom: { tag: 'a' } }, event: { trusted: false } },
        ],
      },
    } as never);
    if ('error' in t) throw new Error(t.error);
    expect(t.origin).toEqual({ at: 1000, kind: 'interaction' });
    expect(t.lanes.input.slice(0, 2).map((i) => [i.t, i.target])).toEqual([[0, 'card'], [8, 'a']]);
  });

  it('places what the user sees at paint time when the report records it', () => {
    // Commits 3 and 4 ran in one long task that ended at 2300.
    const painted = {
      ...report,
      commitTimings: {
        ...report.commitTimings,
        1: { ...report.commitTimings[1], paintAt: 1110 },
        3: { ...report.commitTimings[3], paintAt: 2300 },
        4: { ...report.commitTimings[4], paintAt: 2300 },
      },
    };
    const t = buildTimeline(painted as never) as TimelineResult;
    expect(t.screen).toMatchObject({ vc50: 1300, vc90: 1300, vc100: 1300 });
    const wait = t.perceived.waits.find((w) => w.depth === 10)!;
    expect([wait.from, wait.until, wait.updatesDuring.commits]).toEqual([110, 1300, 1]);
    const byId = Object.fromEntries(t.lanes.commits.map((c) => [c.commitId, c]));
    expect([byId[3].t, byId[3].paintAt, byId[2].paintAt]).toEqual([500, 1300, null]);
    expect(t.text).toContain('Visually complete (at paint): VC50 +1300');
    expect(t.text).toContain('Painted late (the commit\'s task kept running): c3 +500 → painted +1300 (800ms), c4 +600 → painted +1300 (700ms)');
    expect(t.text).toMatch(/c3 unlock .* · painted \+1300/);
    expect(t.text).not.toContain('c1 lock 40 rendered · 80% screen skeleton · enter ItemBody name=item-body · painted');
  });

  it('labels requests by GraphQL operation, else by path', () => {
    expect(requestLabel('https://x.test/gql?operationName=Foo')).toBe('Foo');
    expect(requestLabel('https://x.test/api/v2/items/123')).toBe('x.test …/v2/items');
  });

  it('fails clearly without commit timings', () => {
    expect(buildTimeline({} as never)).toMatchObject({ ok: false });
  });
});

describe('sibling boundaries', () => {
  it('keeps boundaries at the same depth apart by detector id', () => {
    const a = { chain: [{ via: 'parent' as const, name: 'Header' }] };
    const b = { chain: [{ via: 'parent' as const, name: 'Body' }] };
    const t = buildTimeline({
      ...report,
      suspenseByCommit: {
        1: [{ depth: 10, boundary: 1, entered: true, left: false, location: a }, { depth: 10, boundary: 2, entered: true, left: false, location: b }],
        3: [{ depth: 10, boundary: 1, entered: false, left: true }],
        5: [{ depth: 10, boundary: 2, entered: false, left: true }],
      },
    } as never, { fromCommit: 1 }) as TimelineResult;
    expect(t.boundaries.map((x) => [x.boundary, x.label])).toEqual([['b1', 'Header'], ['b2', 'Body']]);
    expect(t.lanes.suspense.map((s) => [s.label, s.enteredAt, s.leftAt])).toEqual([['Header', 1, 3], ['Body', 1, 5]]);
  });
});

describe('perf lane', () => {
  it('draws long frames, measures, marks, and shifts on the perf lane, linked to commits', () => {
    const perfEntries = [
      { id: 1, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 1090, duration: 130, blockingDuration: 80,
        scripts: [{ duration: 100, invoker: 'MessagePort.onmessage', sourceFunctionName: 'flush', sourceURL: 'https://app.test/static/react.js' }] },
      { id: 2, entryType: 'measure', name: 'ttai', startTime: 1000, duration: 600 },
      { id: 3, entryType: 'mark', name: 'ready', startTime: 1600, duration: 0 },
      { id: 4, entryType: 'mark', name: 'ready-2', startTime: 1601, duration: 0 },
      { id: 5, entryType: 'layout-shift', name: '', startTime: 1520, duration: 0, value: 0.02, hadRecentInput: false, sources: [{ element: 'div', testId: 'footer', component: null }] },
      { id: 6, entryType: 'layout-shift', name: '', startTime: 1521, duration: 0, value: 0.0001, hadRecentInput: false, sources: [] },
      { id: 7, entryType: 'mark', name: 'before-window', startTime: 500, duration: 0 },
    ];
    const result = buildTimeline({ ...report, perfEntries } as never, { maxMarks: 1 });
    if ('error' in result) throw new Error(result.error);
    expect(result.lanes.perf.map((p) => [p.kind, p.label, p.start, p.end, p.value, p.commits])).toEqual([
      ['measure', 'ttai', 0, 600, null, [1, 2, 3, 4]],
      ['frame', 'MessagePort.onmessage flush react.js', 90, 220, 80, [1, 2]],
      ['shift', 'footer', 520, 520, 0.02, []],
      ['mark', 'ready', 600, 600, null, [4]],
    ]);
    expect(result.omitted.marks).toBe(1);
    expect(result.text).toContain('Long frames (no paint inside): 1, 80ms blocking; longest +90 130ms (c1–c2).');
    expect(result.text).toContain('frame  long frame 130ms (80ms blocking) → +220 · MessagePort.onmessage flush react.js · c1–c2');
    expect(result.mermaid).toContain('section Browser (long frames, measures)');
    expect(result.mermaid).toContain('long frame 130ms c1–c2 :crit, perf1, 90, 220');
  });

  it("labels Chippy's own long frames and leaves them out of the blocking total", () => {
    const perfEntries = [
      { id: 1, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 1090, duration: 130, blockingDuration: 80,
        scripts: [{ duration: 100, invoker: 'MessagePort.onmessage', sourceFunctionName: 'flush', sourceURL: 'https://app.test/static/react.js' }] },
      // No attributed scripts, inside a Chippy command: Chrome hides extension scripts.
      { id: 2, entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 1300, duration: 200, blockingDuration: 150, scripts: [] },
    ];
    const ownWork = [{ start: 1000, end: 1550, label: 'eval-avalanche' }];
    const result = buildTimeline({ ...report, perfEntries, ownWork } as never);
    if ('error' in result) throw new Error(result.error);
    expect(result.lanes.perf.filter((p) => p.kind === 'frame').map((p) => [p.id, p.label, p.chippy ?? false])).toEqual([
      [1, 'MessagePort.onmessage flush react.js', false],
      [2, 'Chippy', true],
    ]);
    expect(result.text).toContain('Long frames (no paint inside): 1, 80ms blocking;');
    expect(result.text).toContain("Chippy's own long frames, left out of the totals: 1, 150ms blocking.");
  });

  it('counts long task time over 50 ms as blocking where frames are missing', () => {
    const perfEntries = [{ id: 1, entryType: 'longtask', name: 'self', startTime: 1090, duration: 120 }];
    const result = buildTimeline({ ...report, perfEntries } as never);
    if ('error' in result) throw new Error(result.error);
    expect(result.lanes.perf).toEqual([{ id: 1, kind: 'frame', label: '', start: 90, end: 210, durationMs: 120, value: 70, commits: [1, 2] }]);
  });
  it('tells console errors, warnings, and logs on the timeline, linked to commits', () => {
    const entry = (id: number, level: string, source: string, time: number, message: string, extra = {}) =>
      ({ id, level, source, time, repeat: 1, message, stack: null, location: null, ...extra });
    const consoleEntries = [
      entry(1, 'log', 'console', 900, 'before the click'),
      entry(2, 'warn', 'console', 1150, 'Each child should have a unique key', { repeat: 3, lastTime: 1160, location: 'https://app.test/src/List.tsx:12:5' }),
      entry(3, 'error', 'uncaught', 1510, 'TypeError: x is undefined\n    at render', { location: 'https://app.test/src/Item.tsx:40:9' }),
      entry(4, 'info', 'console', 1520, 'one'),
      entry(5, 'info', 'console', 1530, 'two'),
      entry(6, 'error', 'console', 1540, 'chippy says hi', { chippy: true }),
      entry(7, 'error', 'rejection', 2000, 'Uncaught (in promise) late'),
      entry(8, 'error', 'console', 3200, 'after commit 5 starts'),
    ];
    const result = buildTimeline({ ...report, consoleEntries } as never, { toCommit: 4, maxLogs: 1 });
    if ('error' in result) throw new Error(result.error);
    expect(result.lanes.console.map((c) => [c.id, c.level, c.t, c.afterCommit])).toEqual([
      [2, 'warn', 150, 1], [3, 'error', 510, 3], [4, 'info', 520, 3], [7, 'error', 1000, 4],
    ]);
    expect(result.lanes.console[1]).toMatchObject({ label: 'TypeError: x is undefined', location: 'Item.tsx:40:9' });
    expect(result.omitted.logs).toBe(1);
    expect(result.console).toMatchObject({ errors: 2, warnings: 3, other: 2, firstError: { id: 3 } });
    expect(result.text).toContain('Console: 2 errors, 3 warnings; first error +510 (after c3): uncaught TypeError: x is undefined · Item.tsx:40:9.');
    expect(result.text).toMatch(/\+ *150 +warn +Each child should have a unique key ×3 · List\.tsx:12:5/);
    expect(result.text).not.toContain('chippy says hi');
    expect(result.mermaid).toContain('section Console (errors, warnings)');
    expect(result.mermaid).toMatch(/:crit, milestone, log3, 510, 510/);
    const whole = buildTimeline({ ...report, consoleEntries } as never);
    if ('error' in whole) throw new Error(whole.error);
    expect(whole.lanes.console.at(-1)).toMatchObject({ id: 8, t: 2200, afterCommit: 6 });
  });

  it('has no console lane or summary when the report has no console entries', () => {
    const t = built();
    expect(t.lanes.console).toEqual([]);
    expect(t.console).toBeNull();
    expect(t.text).not.toContain('Console:');
  });
});

