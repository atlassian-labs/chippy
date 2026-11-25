/**
 * An arm: the samples taken under one condition. Its spread is the noise
 * baseline for a comparison — a key that differs between the samples of one
 * arm cannot tell two arms apart.
 *
 * `summarizeArm` answers the single-arm question: is this observation
 * repeatable, and from which sample did it settle?
 */
import { behaviorKind, BEHAVIOR_KINDS, type BehaviorKind, type ObservationLayer, type Observations } from './observations';

export const ABSENT = '∅';
export const DEFAULT_AB_TOP = 20;

/** Count keys whose agreement means the run repeated: the interaction did the same React work. */
const CORE_COUNTS = ['commits', 'renders', 'collateral'];

export type Arm = {
  name: string;
  /** Sample files, in order, after `skip`. */
  files: string[];
  skipped: number;
  observations: Observations[];
};

export type Spread = { min: number; median: number; max: number; values: number[] };

export function spread(values: number[]): Spread {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median: Math.round(median * 10) / 10, max: sorted[sorted.length - 1], values };
}

/**
 * The 0-based sample from which every later value is equal, with at least two
 * samples agreeing; null when the last two samples differ.
 */
export function settledFrom(values: number[]): number | null {
  if (values.length < 2) return null;
  const last = values[values.length - 1];
  if (values[values.length - 2] !== last) return null;
  let from = values.length - 2;
  while (from > 0 && values[from - 1] === last) from--;
  return from;
}

export function countSeries(arm: Arm, key: string): number[] {
  return arm.observations.map((obs) => obs.counts.get(key) ?? 0);
}

/** Timing values of the samples that recorded the key. */
export function timingSeries(arm: Arm, key: string): number[] {
  return arm.observations.map((obs) => obs.timings.get(key)).filter((v): v is number => v !== undefined);
}

export function behaviorValues(arm: Arm, key: string): string[] {
  return arm.observations.map((obs) => obs.behavior.get(key) ?? ABSENT);
}

/** A layer counts only when every sample of the arm carried it. */
export function armLayers(arm: Arm): Record<ObservationLayer, 'all' | 'some' | 'none'> {
  const layers = Object.keys(arm.observations[0]?.layers ?? {}) as ObservationLayer[];
  return Object.fromEntries(layers.map((layer) => {
    const n = arm.observations.filter((obs) => obs.layers[layer]).length;
    return [layer, n === arm.observations.length ? 'all' : n ? 'some' : 'none'];
  })) as Record<ObservationLayer, 'all' | 'some' | 'none'>;
}

export function behaviorLayer(kind: BehaviorKind): ObservationLayer {
  return kind === 'fiber' || kind === 'prop' ? 'fibers' : kind === 'request' ? 'network' : kind;
}

export function keysOf(arms: Arm[], field: 'behavior' | 'counts' | 'timings'): string[] {
  const keys = new Set<string>();
  for (const arm of arms) for (const obs of arm.observations) for (const key of obs[field].keys()) keys.add(key);
  return Array.from(keys).sort();
}

export type ArmStability = {
  /** Samples used, after `skip`. */
  samples: number;
  /** 1-based sample from which the core counts (commits, renders, collateral) agree; null when they never do. */
  settledFrom: number | null;
  settled: boolean;
};

export function armStability(arm: Arm): ArmStability {
  const froms = CORE_COUNTS
    .filter((key) => arm.observations.some((obs) => obs.counts.has(key)))
    .map((key) => settledFrom(countSeries(arm, key)));
  const settled = arm.observations.length >= 2 && froms.every((from) => from !== null);
  return {
    samples: arm.observations.length,
    settledFrom: settled ? Math.max(0, ...(froms as number[])) + 1 : null,
    settled,
  };
}

function pageWarnings(arm: Arm): string[] {
  const paths = new Set(arm.observations.map((obs) => {
    try { return obs.page.url ? new URL(obs.page.url).pathname : null; } catch { return obs.page.url; }
  }).filter(Boolean));
  return paths.size > 1 ? [`arm ${arm.name} has samples from ${paths.size} pages: ${Array.from(paths).join(', ')}`] : [];
}

/** 1-based numbers of the samples that recorded no React commit. */
export function emptySamples(arm: Arm): number[] {
  return arm.observations.flatMap((obs, i) => ((obs.counts.get('commits') ?? 0) === 0 ? [i + 1] : []));
}

export function armWarnings(arm: Arm): string[] {
  const warnings = pageWarnings(arm);
  const empty = emptySamples(arm);
  if (empty.length) warnings.push(`arm ${arm.name}: sample${empty.length === 1 ? '' : 's'} ${empty.join(', ')} recorded no React commit; check that the page rendered and Avalanche was recording`);
  if (arm.observations.length < 2) warnings.push(`arm ${arm.name} has ${arm.observations.length} sample: its noise is unknown; take at least 2`);
  for (const [layer, coverage] of Object.entries(armLayers(arm))) {
    if (coverage === 'some') warnings.push(`arm ${arm.name}: only some samples carry ${layer}; it is not judged`);
  }
  const stability = armStability(arm);
  if (arm.observations.length >= 2 && !stability.settled) {
    warnings.push(`arm ${arm.name} has not settled: its last two samples differ in commits, renders, or collateral; take more samples, or drop warm-up samples with --skip`);
  }
  return warnings;
}

export function isTotalKey(key: string): boolean {
  return !key.includes(' ');
}

export function summarizeArm(arm: Arm, options: { top?: unknown } = {}) {
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_AB_TOP));
  const behaviorKeys = keysOf([arm], 'behavior');
  const byKind = Object.fromEntries(BEHAVIOR_KINDS.map((kind) => [kind, { keys: 0, varying: 0 }])) as Record<BehaviorKind, { keys: number; varying: number }>;
  const varying: Array<{ kind: BehaviorKind; label: string; distinct: number; preview: string | null }> = [];
  for (const key of behaviorKeys) {
    const kind = behaviorKind(key);
    byKind[kind].keys++;
    const distinct = new Set(behaviorValues(arm, key)).size;
    if (distinct > 1) {
      byKind[kind].varying++;
      const owner = arm.observations.find((obs) => obs.behavior.has(key))!;
      varying.push({ kind, distinct, ...owner.describe(key) });
    }
  }

  const countRows = keysOf([arm], 'counts').map((key) => {
    const values = countSeries(arm, key);
    const s = spread(values);
    const from = settledFrom(values);
    return { key, ...s, stable: s.min === s.max, settledFrom: from === null ? null : from + 1 };
  });
  const byMedian = (a: { median: number }, b: { median: number }) => b.median - a.median;

  return {
    ok: true as const,
    arm: arm.name,
    files: arm.files,
    skipped: arm.skipped,
    ...armStability(arm),
    layers: armLayers(arm),
    behavior: {
      keys: behaviorKeys.length,
      varying: varying.length,
      byKind,
      /** Keys that differ between samples: they cannot be judged in a comparison. */
      varyingTop: varying.slice(0, top),
    },
    counts: {
      totals: countRows.filter((row) => isTotalKey(row.key)),
      components: countRows.filter((row) => !isTotalKey(row.key)).sort(byMedian).slice(0, top),
      varyingComponents: countRows.filter((row) => !isTotalKey(row.key) && !row.stable).length,
    },
    timings: keysOf([arm], 'timings').map((key) => ({ key, ...spread(timingSeries(arm, key)) })),
    warnings: armWarnings(arm),
  };
}
