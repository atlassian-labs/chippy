/**
 * Arm against arm: did anything user-visible change, and what did the React
 * work do differently?
 *
 * The behavior gate counts a key as changed only when it is stable inside
 * each arm and differs between them; a key that varies inside an arm (a
 * timestamp, a random id) is listed as unjudged instead. A count changes
 * when the two arms' ranges do not overlap. Timings need three samples per
 * arm before they are judged, and a timing that only climbs or only falls
 * across an arm's samples (a warm-up, a JIT, a cache filling) is drifting:
 * its range says when the arm was captured, not what the condition costs.
 */
import {
  ABSENT, armLayers, armStability, armWarnings, emptySamples, behaviorLayer, behaviorValues, countSeries,
  DEFAULT_AB_TOP, isTotalKey, keysOf, spread, timingSeries, type Arm, type Spread,
} from './arm';
import { behaviorKind, BEHAVIOR_KINDS, fiberIdOf, parentFiberId, type BehaviorKind } from './observations';

export const MIN_TIMING_SAMPLES = 3;

export type AbVerdict = 'equivalent' | 'behavior-changed' | 'inconclusive';

/** Lower is better for every count and timing. */
export type PerfChange = 'better' | 'worse' | 'same' | 'noise' | 'drifting' | 'not-judged';

/** True when every sample moves the same way as the one before it, over three or more samples. */
export function isDrifting(values: number[]): boolean {
  if (values.length < MIN_TIMING_SAMPLES) return false;
  const steps = values.slice(1).map((v, i) => Math.sign(v - values[i]));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

export function judgeSpreads(a: Spread, b: Spread, judged = true): PerfChange {
  if (!judged) return 'not-judged';
  if (a.min === a.max && b.min === b.max && a.min === b.min) return 'same';
  if (b.max < a.min) return 'better';
  if (b.min > a.max) return 'worse';
  return 'noise';
}

type BehaviorSide = { value: string; preview: string | null };

function side(arm: Arm, key: string, value: string): BehaviorSide {
  if (value === ABSENT) return { value: 'absent', preview: null };
  const owner = arm.observations.find((obs) => obs.behavior.has(key));
  const kind = behaviorKind(key);
  if (kind === 'fiber') return { value: 'present', preview: null };
  if (kind === 'prop') return { value: 'set', preview: owner?.describe(key).preview ?? null };
  return { value: `${value}×`, preview: null };
}

const KIND_ORDER: BehaviorKind[] = ['dom', 'fiber', 'prop', 'console', 'request'];

/**
 * Keeps the root of each difference: a fiber added or removed hides its props
 * and descendants, and a `children` prop that changed because something below
 * it changed is the same difference seen from above.
 */
function rootDifferences(keys: string[]): { kept: string[]; collapsed: number } {
  const fibers = new Set(keys.filter((k) => behaviorKind(k) === 'fiber').map((k) => fiberIdOf(k)!));
  const changedIds = keys.map(fiberIdOf).filter((id): id is string => id !== null);
  const underFiber = (id: string) => {
    for (let p = parentFiberId(id); p; p = parentFiberId(p)) if (fibers.has(p)) return true;
    return false;
  };
  const kept = keys.filter((key) => {
    const id = fiberIdOf(key);
    if (id === null) return true;
    if (underFiber(id)) return false;
    if (behaviorKind(key) === 'prop') {
      if (fibers.has(id)) return false;
      if (key.endsWith('\tchildren') && changedIds.some((other) => other.startsWith(`${id}/`))) return false;
    }
    return true;
  });
  return { kept, collapsed: keys.length - kept.length };
}

/** Folds keys that read the same (one DOM edit in each of 30 list rows) into one row with a count. */
function groupByLabel(rows: Array<{ kind: BehaviorKind; label: string }>) {
  const groups = new Map<string, { kind: BehaviorKind; label: string; count: number }>();
  for (const row of rows) {
    const id = `${row.kind}\t${row.label}`;
    const group = groups.get(id);
    if (group) group.count++;
    else groups.set(id, { ...row, count: 1 });
  }
  return [...groups.values()].sort((x, y) => y.count - x.count);
}

function compareBehavior(a: Arm, b: Arm, top: number) {
  const layersA = armLayers(a);
  const layersB = armLayers(b);
  const byKind = Object.fromEntries(BEHAVIOR_KINDS.map((kind) => [kind, { judged: 0, unjudged: 0, changed: 0 }])) as
    Record<BehaviorKind, { judged: number; unjudged: number; changed: number }>;
  const changed: string[] = [];
  const unjudged: string[] = [];
  let notCovered = 0;
  for (const key of keysOf([a, b], 'behavior')) {
    const kind = behaviorKind(key);
    const layer = behaviorLayer(kind);
    if (layersA[layer] !== 'all' || layersB[layer] !== 'all') { notCovered++; continue; }
    const va = new Set(behaviorValues(a, key));
    const vb = new Set(behaviorValues(b, key));
    if (va.size > 1 || vb.size > 1) { byKind[kind].unjudged++; unjudged.push(key); continue; }
    byKind[kind].judged++;
    const [left] = va;
    const [right] = vb;
    if (left !== right) changed.push(key);
  }
  const { kept, collapsed } = rootDifferences(changed);
  for (const key of kept) byKind[behaviorKind(key)].changed++;
  kept.sort((x, y) => KIND_ORDER.indexOf(behaviorKind(x)) - KIND_ORDER.indexOf(behaviorKind(y)) || (x < y ? -1 : 1));
  const describe = (key: string) => (a.observations.find((o) => o.behavior.has(key)) ?? b.observations.find((o) => o.behavior.has(key)))!.describe(key);
  return {
    changed: kept.length,
    /** Differences hidden under a root difference: an added fiber's props, a parent's `children`. */
    collapsed,
    unjudged: unjudged.length,
    /** Keys of a layer that a sample of either arm did not carry. */
    notCovered,
    byKind,
    items: kept.slice(0, top).map((key) => ({
      kind: behaviorKind(key),
      label: describe(key).label,
      ...(behaviorKind(key) === 'dom' && { detail: describe(key).preview }),
      a: side(a, key, behaviorValues(a, key)[0]),
      b: side(b, key, behaviorValues(b, key)[0]),
    })),
    unjudgedTop: groupByLabel(unjudged.map((key) => ({ kind: behaviorKind(key), label: describe(key).label }))).slice(0, Math.min(top, 10)),
  };
}

function perfRow(key: string, a: Spread, b: Spread, judged = true) {
  return { key, a: { min: a.min, median: a.median, max: a.max }, b: { min: b.min, median: b.median, max: b.max }, delta: Math.round((b.median - a.median) * 10) / 10, change: judgeSpreads(a, b, judged) };
}

function comparePerformance(a: Arm, b: Arm, top: number) {
  const rows = keysOf([a, b], 'counts').map((key) => perfRow(key, spread(countSeries(a, key)), spread(countSeries(b, key))));
  const components = rows.filter((row) => !isTotalKey(row.key) && row.change !== 'same')
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.key < y.key ? -1 : 1));
  const timingJudged = a.observations.length >= MIN_TIMING_SAMPLES && b.observations.length >= MIN_TIMING_SAMPLES;
  const timings = keysOf([a, b], 'timings').flatMap((key) => {
    const va = timingSeries(a, key);
    const vb = timingSeries(b, key);
    if (!va.length || !vb.length) return [];
    const row = perfRow(key, spread(va), spread(vb), timingJudged);
    const drifting = ([[a, va], [b, vb]] as const).filter(([, values]) => isDrifting(values)).map(([arm]) => arm.name);
    return [drifting.length && (row.change === 'better' || row.change === 'worse') ? { ...row, change: 'drifting' as const, drifting } : row];
  });
  const tally = (change: PerfChange) => rows.filter((row) => row.change === change).length;
  return {
    better: tally('better'),
    worse: tally('worse'),
    noise: tally('noise'),
    totals: rows.filter((row) => isTotalKey(row.key)),
    components: components.slice(0, top),
    componentsChanged: components.length,
    timings,
    timingNote: !timingJudged
      ? `timings are judged with at least ${MIN_TIMING_SAMPLES} samples per arm`
      : timings.some((row) => row.change === 'drifting')
        ? 'a drifting timing only climbed or fell across an arm\'s samples; skip warm-up samples with --skip, add samples, or capture the arms interleaved (a, b, a, b)'
        : null,
  };
}

export function compareArms(a: Arm, b: Arm, options: { top?: unknown } = {}) {
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_AB_TOP));
  const behavior = compareBehavior(a, b, top);
  const performance = comparePerformance(a, b, top);
  const reasons: string[] = [];
  for (const arm of [a, b]) {
    if (arm.observations.length < 2) reasons.push(`arm ${arm.name} has ${arm.observations.length} sample: noise inside it is unknown, so no difference can be told from noise`);
  }
  for (const [arm, other] of [[a, b], [b, a]]) {
    const empty = emptySamples(arm);
    if (empty.length && emptySamples(other).length < other.observations.length) {
      reasons.push(`arm ${arm.name} recorded no React commit in sample${empty.length === 1 ? '' : 's'} ${empty.join(', ')} while arm ${other.name} did: an empty capture is not less work`);
    }
  }
  const judged = BEHAVIOR_KINDS.reduce((sum, kind) => sum + behavior.byKind[kind].judged, 0);
  if (!judged) reasons.push('no behavior key could be judged: both arms need fiber state or DOM changes in every sample');
  const verdict: AbVerdict = reasons.length ? 'inconclusive' : behavior.changed ? 'behavior-changed' : 'equivalent';
  if (verdict === 'behavior-changed') reasons.push(`${behavior.changed} behavior difference${behavior.changed === 1 ? '' : 's'} stable inside each arm`);
  return {
    ok: true as const,
    verdict,
    reasons,
    arms: {
      a: { name: a.name, files: a.files, skipped: a.skipped, ...armStability(a) },
      b: { name: b.name, files: b.files, skipped: b.skipped, ...armStability(b) },
    },
    behavior,
    performance,
    warnings: [...armWarnings(a), ...armWarnings(b)],
  };
}
