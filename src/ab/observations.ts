/**
 * What one A/B sample observed, split by how a comparison may judge it:
 *
 * - `behavior`: what the user can see or the app emits — the end fiber state
 *   (each fiber, each prop), the DOM changes made on the way, console errors
 *   and warnings, and network requests. An optimization must keep all of it.
 * - `counts`: React work — commits, renders, collateral, identity churn. An
 *   optimization is expected to change these.
 * - `timings`: milliseconds. Noisy; judged only over enough samples.
 *
 * Keys are stable across samples and builds, so samples can be lined up key
 * by key rather than commit by commit (commit ids are per capture).
 */
import { tupleToStats, UPSTREAM_COMMIT_STAT_KEYS } from '../avalanche/commit-stats';
import { perfSummary } from '../avalanche/perf-signals';
import type { FiberStateCapture, FiberStateEntry } from '../chippy-bridge/fiber-state';
import type { AbSample } from './sample';

export type ObservationLayer = 'fibers' | 'dom' | 'console' | 'network' | 'rendered' | 'perf';

export type Observations = {
  behavior: Map<string, string>;
  counts: Map<string, number>;
  timings: Map<string, number>;
  /** Which evidence the sample carried; a layer missing from a sample is not judged. */
  layers: Record<ObservationLayer, boolean>;
  page: { url: string | null };
  /** A readable label for a behavior key, and the value's preview where one exists. */
  describe(key: string): { label: string; preview: string | null };
};

/** Separates the parts of a behavior key. */
const SEP = '\t';

export const BEHAVIOR_KINDS = ['fiber', 'prop', 'dom', 'console', 'request'] as const;
export type BehaviorKind = typeof BEHAVIOR_KINDS[number];

export function behaviorKind(key: string): BehaviorKind {
  return key.slice(0, key.indexOf(SEP)) as BehaviorKind;
}

/** For `fiber` and `prop` keys, the fiber id; null otherwise. */
export function fiberIdOf(key: string): string | null {
  const kind = behaviorKind(key);
  if (kind !== 'fiber' && kind !== 'prop') return null;
  return key.split(SEP)[1];
}

/** The parent fiber id of a capture fiber id (`<parentPath>/<hash>:<n>`); null at the root. */
export function parentFiberId(id: string): string | null {
  const slash = id.lastIndexOf('/');
  if (slash < 0) return null;
  const parent = id.slice(0, slash);
  return parent === 'root' ? null : parent;
}

function add(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function fiberLabeler(state: FiberStateCapture | null) {
  const byId = new Map<string, FiberStateEntry>((state?.fibers ?? []).map((entry) => [entry.id, entry]));
  return (id: string): string => {
    const names: string[] = [];
    for (let current: string | null = id; current; current = parentFiberId(current)) {
      const entry = byId.get(current);
      if (!entry) break;
      names.unshift(entry.key == null ? entry.name : `${entry.name}[key=${entry.key}]`);
    }
    if (!names.length) return id;
    return names.length > 5 ? `… › ${names.slice(-5).join(' › ')}` : names.join(' › ');
  };
}

function observeFibers(state: FiberStateCapture, behavior: Map<string, string>) {
  for (const entry of state.fibers) {
    behavior.set(['fiber', entry.id].join(SEP), entry.name);
    for (const [name, prop] of Object.entries(entry.props)) {
      behavior.set(['prop', entry.id, name].join(SEP), `${prop.kind}:${prop.hash}${prop.truncated ? '~' : ''}`);
    }
  }
}

type DomChangeLike = { op?: unknown; node?: unknown; at?: unknown; props?: unknown; html?: unknown };

function domSignature(change: DomChangeLike): string {
  const props = Array.isArray(change.props)
    ? (change.props as unknown[][]).map((p) => `${String(p?.[0])}=${p?.[2] == null ? '∅' : String(p[2])}`).join(' ')
    : String(change.html ?? '');
  return ['dom', String(change.op), String(change.node), String(change.at), props].join(SEP);
}

function observeReport(report: Record<string, any>, obs: Observations) {
  const { behavior, counts, timings, layers } = obs;
  const commitStats = (report.commitStats ?? {}) as Record<string, unknown>;
  const ids = Object.keys(commitStats);
  counts.set('commits', ids.length);
  for (const key of UPSTREAM_COMMIT_STAT_KEYS) counts.set(key, 0);
  for (const id of ids) {
    const stats = tupleToStats(commitStats[id]);
    if (stats) for (const key of UPSTREAM_COMMIT_STAT_KEYS) add(counts, key, stats[key]);
  }

  if (report.renderedByCommit && typeof report.renderedByCommit === 'object') {
    layers.rendered = true;
    counts.set('renders', 0);
    counts.set('identityChurn', 0);
    counts.set('trashers', 0);
    for (const entries of Object.values(report.renderedByCommit as Record<string, any[]>)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = String(entry?.name ?? 'Unknown');
        add(counts, 'renders');
        add(counts, `renders ${name}`);
        for (const change of Array.isArray(entry?.propChanges) ? entry.propChanges : []) {
          // A new identity with the same content: what memoization removes.
          const churn = change?.kind === 'ref-changed'
            && (change.sameShallow === true || String(change.current ?? '').startsWith('function'));
          if (churn) { add(counts, 'identityChurn'); add(counts, `identityChurn ${name}`); }
        }
        const t = entry?.trasherCounts;
        if (t) add(counts, 'trashers', Number(t.effects || 0) + Number(t.callbacks || 0) + Number(t.memos || 0));
      }
    }
  }

  let renderMs = 0;
  let timed = false;
  for (const timing of Object.values((report.commitTimings ?? {}) as Record<string, any>)) {
    const work = Number(timing?.render?.workMs);
    if (Number.isFinite(work)) { renderMs += work; timed = true; }
  }
  if (timed) timings.set('renderMs', Math.round(renderMs * 10) / 10);

  if (report.domByCommit && typeof report.domByCommit === 'object') {
    layers.dom = true;
    for (const diff of Object.values(report.domByCommit as Record<string, { changes?: DomChangeLike[] }>)) {
      for (const change of diff?.changes ?? []) {
        const key = domSignature(change);
        behavior.set(key, String(Number(behavior.get(key) ?? 0) + 1));
      }
    }
  }

  if (Array.isArray(report.consoleEntries)) {
    layers.console = true;
    for (const entry of report.consoleEntries) {
      if (entry?.chippy || (entry?.level !== 'error' && entry?.level !== 'warn')) continue;
      const key = ['console', entry.level, String(entry.message ?? '')].join(SEP);
      behavior.set(key, String(Number(behavior.get(key) ?? 0) + Number(entry.repeat || 1)));
    }
  }

  if (Array.isArray(report.networkRequests)) {
    layers.network = true;
    for (const request of report.networkRequests) {
      if (request?.startedBeforeCapture) continue;
      const key = ['request', String(request?.initiatorType ?? 'other'), String(request?.url ?? '')].join(SEP);
      behavior.set(key, String(Number(behavior.get(key) ?? 0) + 1));
    }
  }

  if (Array.isArray(report.perfEntries)) {
    layers.perf = true;
    const perf = perfSummary(report as Parameters<typeof perfSummary>[0]);
    counts.set('longFrames', perf.longFrames);
    counts.set('layoutShifts', perf.layoutShifts);
    timings.set('totalBlockingMs', perf.totalBlockingMs);
    if (perf.worstInteractionMs != null) timings.set('worstInteractionMs', perf.worstInteractionMs);
    timings.set('cls', perf.cls);
  }
}

export function observeSample(sample: AbSample): Observations {
  const state = sample.fiberState;
  const label = fiberLabeler(state);
  const entries = new Map((state?.fibers ?? []).map((entry) => [entry.id, entry]));
  const obs: Observations = {
    behavior: new Map(),
    counts: new Map(),
    timings: new Map(),
    layers: { fibers: false, dom: false, console: false, network: false, rendered: false, perf: false },
    page: { url: state?.page?.url ?? null },
    describe(key) {
      const parts = key.split(SEP);
      switch (parts[0]) {
        case 'fiber': return { label: label(parts[1]), preview: null };
        case 'prop': return { label: `${label(parts[1])} .${parts[2]}`, preview: entries.get(parts[1])?.props[parts[2]]?.preview ?? null };
        case 'dom': return { label: `${parts[1]} ${parts[2]} @ ${parts[3]}`, preview: parts[4] || null };
        case 'console': return { label: `console.${parts[1]}`, preview: parts[2].slice(0, 200) };
        case 'request': return { label: `${parts[1]} ${parts[2]}`, preview: null };
        default: return { label: key, preview: null };
      }
    },
  };
  if (state) {
    obs.layers.fibers = true;
    observeFibers(state, obs.behavior);
  }
  observeReport(sample.report, obs);
  return obs;
}
