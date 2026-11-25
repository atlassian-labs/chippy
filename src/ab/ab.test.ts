import { describe, expect, it } from 'vitest';
import { settledFrom, spread, summarizeArm, type Arm } from './arm';
import { compareArms, judgeSpreads } from './compare';
import { observeSample } from './observations';
import { buildAbSample, unwrapFiberState } from './sample';
import type { FiberStateCapture } from '../chippy-bridge/fiber-state';

type FiberSpec = { id: string; name: string; key?: string; props?: Record<string, string> };

function fiberState(fibers: FiberSpec[]): FiberStateCapture {
  return {
    version: 1,
    identity: 'portable',
    capturedAt: '2026-11-25T00:00:00.000Z',
    page: { url: 'http://lab.test/story', title: 'Story' },
    fiberCount: fibers.length,
    truncated: false,
    fibers: fibers.map((f) => ({
      id: f.id,
      token: f.name,
      name: f.name,
      key: f.key ?? null,
      tag: 0,
      source: null,
      props: Object.fromEntries(Object.entries(f.props ?? {}).map(([k, v]) => [k, { kind: 'string', hash: `h:${v}`, preview: JSON.stringify(v), truncated: false }])),
    })),
  };
}

type RunSpec = {
  renders?: Record<string, number>;
  commits?: number;
  fibers?: FiberSpec[];
  dom?: Array<{ op: string; node: string; at: string; props?: [string, string | null, string | null][] }>;
  errors?: string[];
  renderMs?: number;
};

const BASE_FIBERS: FiberSpec[] = [
  { id: 'root/a:0', name: 'App' },
  { id: 'root/a:0/l:0', name: 'List', props: { filter: 'all' } },
  { id: 'root/a:0/l:0/r:0', name: 'Row', key: '1', props: { label: 'one' } },
];

function sample(run: RunSpec, index = 1) {
  const commits = run.commits ?? 2;
  const rendered = Object.entries(run.renders ?? { Row: 4 }).flatMap(([name, n]) =>
    Array.from({ length: n }, (_, i) => ({ sourceId: `${name}#${i}@1`, name, depth: 1, propChanges: [{ name: 'onSelect', kind: 'ref-changed', current: 'function onSelect' }] })));
  const commitStats = Object.fromEntries(Array.from({ length: commits }, (_, i) => [i + 1, [rendered.length / commits, 1]]));
  return buildAbSample({
    arm: 'arm',
    label: null,
    index,
    capturedAt: '2026-11-25T00:00:00.000Z',
    report: {
      meta: { version: 10 },
      commitStats,
      renderedByCommit: { 1: rendered },
      domByCommit: { 1: { changes: run.dom ?? [{ op: '~', node: 'span', at: 'Row', props: [['text', 'a', 'b']] }], ms: 0 } },
      consoleEntries: (run.errors ?? []).map((message, id) => ({ id, level: 'error', source: 'console', time: 0, repeat: 1, message, stack: null, location: null })),
      commitTimings: { 1: { render: { workMs: run.renderMs ?? 10 } } },
    },
    fiberState: fiberState(run.fibers ?? BASE_FIBERS),
    fiberStateError: null,
  });
}

function arm(name: string, runs: RunSpec[]): Arm {
  return { name, files: runs.map((_, i) => `${name}/sample-${i + 1}.json.gz`), skipped: 0, observations: runs.map((run, i) => observeSample(sample(run, i + 1))) };
}

describe('A/B spreads', () => {
  it('finds where a series settles', () => {
    expect(settledFrom([9, 7, 7, 7])).toBe(1);
    expect(settledFrom([7, 7])).toBe(0);
    expect(settledFrom([7, 8])).toBeNull();
    expect(settledFrom([7])).toBeNull();
    expect(spread([3, 1, 2, 10])).toMatchObject({ min: 1, median: 2.5, max: 10 });
  });

  it('judges counts by overlap of the two ranges, lower being better', () => {
    expect(judgeSpreads(spread([10, 12]), spread([4, 5]))).toBe('better');
    expect(judgeSpreads(spread([4, 5]), spread([10, 12]))).toBe('worse');
    expect(judgeSpreads(spread([4, 9]), spread([5, 12]))).toBe('noise');
    expect(judgeSpreads(spread([4, 4]), spread([4, 4]))).toBe('same');
    expect(judgeSpreads(spread([4]), spread([9]), false)).toBe('not-judged');
  });
});

describe('A/B arm', () => {
  it('reports a warm-up sample and the sample the arm settled from', () => {
    const report = summarizeArm(arm('flag-off', [{ renders: { Row: 9 } }, { renders: { Row: 4 } }, { renders: { Row: 4 } }]));
    expect(report).toMatchObject({ arm: 'flag-off', samples: 3, settled: true, settledFrom: 2 });
    expect(report.counts.totals.find((row) => row.key === 'renders')).toMatchObject({ min: 4, max: 9, stable: false, settledFrom: 2 });
    expect(report.warnings).toEqual([]);
  });

  it('lists behavior keys that vary inside the arm', () => {
    const random = (v: string) => [...BASE_FIBERS.slice(0, 2), { ...BASE_FIBERS[2], props: { label: v } }];
    const report = summarizeArm(arm('a', [{ fibers: random('x1') }, { fibers: random('x2') }]));
    expect(report.behavior.varying).toBe(1);
    expect(report.behavior.varyingTop[0]).toMatchObject({ kind: 'prop', label: 'App › List › Row[key=1] .label' });
  });

  it('warns that one sample has unknown noise and that an unsettled arm needs more samples', () => {
    expect(summarizeArm(arm('one', [{}])).warnings).toEqual([expect.stringContaining('has 1 sample')]);
    expect(summarizeArm(arm('jumpy', [{ commits: 2 }, { commits: 3 }])).warnings).toEqual([expect.stringContaining('has not settled')]);
  });
});

describe('A/B compare', () => {
  it('passes the gate and reports the saved work when only React work differs', () => {
    const before = arm('compiler-off', [{ renders: { Row: 6, List: 2 } }, { renders: { Row: 6, List: 2 } }]);
    const after = arm('compiler-on', [{ renders: { Row: 1, List: 2 } }, { renders: { Row: 1, List: 2 } }, { renders: { Row: 1, List: 2 } }]);
    const result = compareArms(before, after);
    expect(result.verdict).toBe('equivalent');
    expect(result.behavior.changed).toBe(0);
    expect(result.performance.totals.find((row) => row.key === 'renders')).toMatchObject({ a: { median: 8 }, b: { median: 3 }, delta: -5, change: 'better' });
    expect(result.performance.components[0]).toMatchObject({ key: 'identityChurn Row', change: 'better' });
    expect(result.performance.timings[0]).toMatchObject({ key: 'renderMs', change: 'not-judged' });
    expect(result.performance.timingNote).toContain('at least 3 samples');
  });

  it('fails the gate on a difference that is stable inside each arm', () => {
    const changed = BASE_FIBERS.map((f) => (f.name === 'List' ? { ...f, props: { filter: 'open' } } : f));
    const result = compareArms(arm('a', [{}, {}]), arm('b', [{ fibers: changed, errors: ['boom'] }, { fibers: changed, errors: ['boom'] }]));
    expect(result.verdict).toBe('behavior-changed');
    expect(result.behavior.items).toEqual([
      { kind: 'prop', label: 'App › List .filter', a: { value: 'set', preview: '"all"' }, b: { value: 'set', preview: '"open"' } },
      { kind: 'console', label: 'console.error', a: { value: 'absent', preview: null }, b: { value: '1×', preview: null } },
    ]);
  });

  it('leaves a key that varies inside an arm unjudged', () => {
    const label = (v: string) => [...BASE_FIBERS.slice(0, 2), { ...BASE_FIBERS[2], props: { label: v } }];
    const result = compareArms(arm('a', [{ fibers: label('r1') }, { fibers: label('r2') }]), arm('b', [{ fibers: label('r3') }, { fibers: label('r3') }]));
    expect(result.verdict).toBe('equivalent');
    expect(result.behavior).toMatchObject({ changed: 0, unjudged: 1 });
  });

  it('reports an added subtree once, not its props and descendants', () => {
    const extra = [...BASE_FIBERS, { id: 'root/a:0/b:0', name: 'Banner', props: { text: 'new' } }, { id: 'root/a:0/b:0/s:0', name: 'span', props: { children: 'new' } }];
    const result = compareArms(arm('a', [{}, {}]), arm('b', [{ fibers: extra }, { fibers: extra }]));
    expect(result.behavior.items).toEqual([{ kind: 'fiber', label: 'App › Banner', a: { value: 'absent', preview: null }, b: { value: 'present', preview: null } }]);
    expect(result.behavior.collapsed).toBe(3);
  });

  it('folds a parent children prop into the change below it', () => {
    const withChildren = (label: string) => [
      { id: 'root/a:0', name: 'App', props: { children: `<List ${label}>` } },
      { id: 'root/a:0/l:0', name: 'List', props: { label } },
    ];
    const result = compareArms(arm('a', [{ fibers: withChildren('x') }, { fibers: withChildren('x') }]), arm('b', [{ fibers: withChildren('y') }, { fibers: withChildren('y') }]));
    expect(result.behavior.items.map((item) => item.label)).toEqual(['App › List .label']);
  });

  it('reports a DOM change that only one arm makes', () => {
    const flicker: NonNullable<RunSpec['dom']> = [{ op: '~', node: 'span', at: 'Row', props: [['text', 'a', 'b']] }, { op: '+', node: 'div[data-testid=spinner]', at: 'List' }];
    const result = compareArms(arm('a', [{ dom: flicker }, { dom: flicker }]), arm('b', [{}, {}]));
    expect(result.verdict).toBe('behavior-changed');
    expect(result.behavior.items[0]).toMatchObject({ kind: 'dom', label: '+ div[data-testid=spinner] @ List', a: { value: '1×' }, b: { value: 'absent' } });
  });

  it('is inconclusive with one sample in an arm, and judges timings from three', () => {
    expect(compareArms(arm('a', [{}]), arm('b', [{}, {}]))).toMatchObject({ verdict: 'inconclusive', reasons: [expect.stringContaining('arm a has 1 sample')] });
    const slow = arm('a', [{ renderMs: 30 }, { renderMs: 32 }, { renderMs: 31 }]);
    const fast = arm('b', [{ renderMs: 12 }, { renderMs: 10 }, { renderMs: 11 }]);
    expect(compareArms(slow, fast).performance.timings[0]).toMatchObject({ key: 'renderMs', change: 'better', delta: -20 });
  });

  it('is inconclusive when one arm recorded no commits, rather than calling it better', () => {
    const result = compareArms(arm('a', [{}, {}]), arm('blank', [{ commits: 0, renders: {} }, { commits: 0, renders: {} }]));
    expect(result.verdict).toBe('inconclusive');
    expect(result.reasons).toEqual([expect.stringContaining('arm blank recorded no React commit in samples 1, 2')]);
    expect(result.warnings).toEqual([expect.stringContaining('recorded no React commit')]);
  });

  it('calls a timing that only falls across an arm drifting, not better', () => {
    const warming = arm('first', [{ renderMs: 21 }, { renderMs: 12 }, { renderMs: 8 }]);
    const warm = arm('second', [{ renderMs: 5 }, { renderMs: 5.4 }, { renderMs: 7 }]);
    const { performance } = compareArms(warming, warm);
    expect(performance.timings[0]).toMatchObject({ key: 'renderMs', change: 'drifting', drifting: ['first', 'second'] });
    expect(performance.timingNote).toContain('interleaved');
  });
});

describe('A/B sample', () => {
  it('reads the fiber state from a helper eval-probe response, or its error', () => {
    const state = fiberState(BASE_FIBERS);
    expect(unwrapFiberState({ ok: true, result: state })).toEqual({ state });
    expect(unwrapFiberState({ ok: false, result: { ok: false, error: 'bridge missing' } })).toEqual({ error: 'bridge missing' });
    expect(buildAbSample({ arm: 'a', label: null, index: 1, report: { meta: {}, commitStats: {} }, fiberState: null, fiberStateError: null }).fiberStateError).toBe('no fiber state');
  });
});
