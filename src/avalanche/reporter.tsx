/**
 * Projects the detector's live fiber history into ranked evidence and the
 * serializable report consumed by bridge commands and offline analysis. The
 * detector owns capture-time truth; this layer owns interpretation and output
 * ordering, so presentation changes do not alter hot-path collection.
 */

import type { ComponentType, ChangedHook, Fiber, ThrashInfo } from './internals';
import { CS_RESTARTS } from './commit-stats-indices';
import { getComponentName } from './internals';
import type { ReportDTO } from './report-serializer';
import { serializeReport } from './report-serializer';
import {
  type CommitMetricsAdapter,
  type CommitMetricsDelta,
  type CommitMetricsSnapshot,
  type IntegrationMode,
  adapterIdFromMode,
} from './commit-metrics-adapter';

export type SortBy = 'effect' | 'callback' | 'memo' | 'total';

export interface Source {
  sourceId: string; // Human-readable ID (e.g., "Counter#1@3" in dev, "Unknown#1@3" in prod)
  type: ComponentType;
  depth: number;
  renderCount: number;
  causedUpdates: number;
  collateralUpdates: number;
  maxCollateralUpdates: number;
  maxPenetrationDepth: number; // Relative to source depth (how deep the avalanche went)
  updateHistory: Record<number, Record<number, ChangedHook> | 'repeat' | string>;
  collateralByCommit: Record<number, number>; // Per-commit collateral for this source
  fiber?: Fiber;
  /** Changed hook indices from this source's latest self-update; maps debugHook indices to debug-render events. */
  debugHookIndices?: number[];

  /**
   * RESTART WASTE TRACKING - identifies sources contributing to restart waste
   *
   * Restarts = wasted renders (component rendered but work was discarded)
   * Attribution: proportional to sources that fired in each commit with restarts
   *
   * Example: Commit has 1000 restarts, 2 sources fire
   *   → Each source attributed 500 restarts
   *
   * High restartWaste = this source triggers commits that cause React to restart work
   */
  restartWaste?: number; // Total restarts attributed to this source across all commits
  maxRestartWaste?: number; // Max restarts in a single commit
  restartWasteByCommit?: Record<number, number>; // Per-commit restart waste for this source

  /**
   * Components that were amplified when this source triggered them.
   * These are components that re-rendered with unstable hooks (effects, callbacks, memos).
   * Includes both:
   * - This source itself (if it has unstable hooks)
   * - Descendant components that re-rendered with unstable hooks
   */
  amplified?: Array<{
    /** Component that amplified work */
    sourceId: string;
    type: ComponentType;
    depth: number;
    /** Total effect amplifications across all commits */
    effectCount: number;
    /** Total callback amplifications across all commits */
    callbackCount: number;
    /** Total memo amplifications across all commits */
    memoCount: number;
    /** Total hook amplifications (effect + callback + memo) */
    hooksTotal: number;
    /** Commits where this component amplified work */
    commitIds: number[];
    /** Per-commit breakdown: { commitId: { effects, callbacks, memos } } */
    byCommit: Record<number, { effects: number; callbacks: number; memos: number }>;
    /** Latest amplification details */
    lastAmplification: {
      depth: number;
      thrashedHooks: ThrashInfo[];
      fiber?: Fiber;
    };
  }>;
}

export interface Amplifier {
  type: ComponentType;
  renderCount: number;
  instancesTotal: number;
  maxInstancesPerCommit: number;
  hooksTotal: number;
  maxHooksPerCommit: number;
  effectCount: number;
  callbackCount: number;
  memoCount: number;
  lastAmplification: {
    depth: number;
    thrashedHooks: ThrashInfo[];
    fiber?: Fiber;
  };
}

/**
 * Linked thrasher - connects thrashing info to source identity.
 *
 * This enables:
 * - thrasher.sourceId → navigate to source
 * - thrasher.isSource → prioritize fixes (source+thrasher = high impact)
 * - thrasher.commitIds → correlate with commitStats
 * - source.thrashing → see hook instability for a source
 */
export interface AmplifierSource {
  /** Human-readable ID (e.g., "Counter#1@5" in dev, "Unknown#1@5" in prod) */
  sourceId: string;
  /** Component type (function reference) */
  type: ComponentType;
  /** Depth in component tree */
  depth: number;

  /** Collateral damage caused by this source (0 if not tracked) */
  collateralUpdates: number;

  /** Total effect amplifications across all commits */
  effectCount: number;
  /** Total callback amplifications across all commits */
  callbackCount: number;
  /** Total memo amplifications across all commits */
  memoCount: number;
  /** Total hook amplifications (effect + callback + memo) */
  hooksTotal: number;

  /** Commits where this component amplified work */
  commitIds: number[];
  /** Per-commit breakdown: { commitId: { effects, callbacks, memos } } */
  byCommit: Record<number, { effects: number; callbacks: number; memos: number }>;

  /** If not a source, which sourceId caused this to re-render? */
  causedBySourceId: string | null;

  /** Latest amplification details */
  lastAmplification: {
    depth: number;
    thrashedHooks: ThrashInfo[];
    fiber?: Fiber;
  };
}

/**
 * Commit stats tuple: [collateral, sources, restarts, performedWork, effects, memos, callbacks, contextUpdates, unmountedComponents, unmountedSubtrees]
 * Use these numbers to find which commits to investigate in DevTools.
 * - collateral: components re-rendered as victims
 * - sources: components that initiated updates (update sources)
 * - restarts: extra renders due to external store mutations, priority changes, etc.
 * - performedWork: components with PerformedWork flag (actual work React processed)
 * - effects/memos/callbacks: thrashing hooks (effects likely cause next commit!)
 * - contextUpdates: number of Context Providers whose value changed this commit
 * - unmountedComponents: total component fibers unmounted this commit
 * - unmountedSubtrees: number of distinct unmount "branch starts" (topmost deleted components)
 */
export type CommitStats = [
  collateral: number,
  sources: number,
  restarts: number,
  performedWork: number,
  effects: number,
  memos: number,
  callbacks: number,
  contextUpdates: number,
  unmountedComponents: number,
  unmountedSubtrees: number,
];

/**
 * Human-readable keys for CommitStats tuple positions.
 * Use with commitStats[commit][commitStatsKeys.collateral]
 */
export const commitStatsKeys = {
  collateral: 0,
  sources: 1,
  restarts: 2,
  performedWork: 3,
  effects: 4,
  memos: 5,
  callbacks: 6,
  contextUpdates: 7,
  unmountedComponents: 8,
  unmountedSubtrees: 9,
} as const;

/**
 * Report metadata - profiling context and overhead metrics.
 */
export interface ReportMeta {
  /** Report format version - increment when changing data structure */
  version: number;
  /**
   * `performance.timeOrigin` of the captured page (Unix epoch ms). Every
   * absolute timestamp in the report (`commitTimings[N].startTime/endTime`,
   * `interactionsByCommit[N][i].timestamp`) is `performance.now()` on this
   * clock, so `timeOrigin + startTime` is the commit's wall-clock time and
   * the raw value lines up with DevTools traces and PerformanceObserver entries.
   */
  timeOrigin: number;
  /** Total commits processed */
  commits: number;
  /** Detector configuration used during profiling */
  config: {
    /** Detection level: 'stats' (minimal), 'sources', 'amplifiers', or 'full' */
    detectionLevel: DetectionLevel;
    /** Effect thrashing sensitivity: 'non-primitive' or 'all' */
    effectThrashMode: 'non-primitive' | 'all';
    /** Whether fibers were captured (for debugging) */
    captureFibers: boolean;
    /** Update history size per source */
    historySize: number;
  };
  /** memoizedUpdaters availability and coverage */
  memoizedUpdatersSupport: {
    available: boolean;
    commitsWithData: number;
    coverage: string;
  };
  /**
   * Which commit-hook integration model produced this report. Determines what
   * is reliably present in `commitStats[N]` and `metricsByCommit[N]`.
   *
   * 'adapter:<id>' — A commit metrics adapter (for example `adapter:atl`) drove
   *              the commit callback with host render counters. ALL fields below
   *              are populated and `metricsByCommit` is present.
   * 'devtools' — Reconstructed entirely from the React DevTools commit hook
   *              (fiber walk only). The fiber-walk fields are real measurements:
   *              collateral, sources, performedWork, effects, memos, callbacks,
   *              contextUpdates. The render-counter math (restarts) is NOT
   *              available — `commitStats[N][2]` will be 0 (semantically
   *              "unknown / not measurable in this mode") and `metricsByCommit`
   *              is empty. This is normal on stock react-dom.
   * 'none'     — Detector wasn't installed when this report was generated.
   *
   * Reports before the adapter seam used `'atl'` for `'adapter:atl'`.
   */
  integrationMode: IntegrationMode;
  /** Id of the commit metrics adapter that drove this report, or null. */
  metricsAdapter: string | null;
  /**
   * Per-field availability map for `commitStats[N]` indices. `false` means the
   * value is a placeholder (typically 0) that consumers should treat as unknown
   * rather than a real measurement of zero.
   *
   * Stable across all commits in a given report — set once from integrationMode.
   */
  dataAvailability: {
    /** [0] perCommit.totalCollateral — reconstructed from fiber walk */
    collateral: boolean;
    /** [1] perCommit.selfUpdated.size — reconstructed from fiber walk */
    sources: boolean;
    /** [2] derived from the adapter's render-counter delta — only in 'adapter:<id>' mode */
    restarts: boolean;
    /** [3] perCommit.committedComponentCount — reconstructed from fiber walk */
    performedWork: boolean;
    /** [4] perCommit.effectCount — reconstructed from fiber walk */
    effects: boolean;
    /** [5] perCommit.memoCount — reconstructed from fiber walk */
    memos: boolean;
    /** [6] perCommit.callbackCount — reconstructed from fiber walk */
    callbacks: boolean;
    /** [7] perCommit.contextUpdates — reconstructed from fiber walk */
    contextUpdates: boolean;
    /** Adapter counters in metricsByCommit — only in 'adapter:<id>' mode */
    metricsByCommit: boolean;
    /** @deprecated Alias of `metricsByCommit`, kept for one release. */
    atlByCommit: boolean;
  };
  /** Amplifier summary (when detectionMode: 'amplifierMetrics') */
  amplifiersMetrics?: {
    totalHookThrashes: number;
    affectedComponentCount: number;
  };
  /**
   * Timing summary - shows detector overhead and commit durations.
   * Use this to justify avalanche-detector overhead in production.
   */
  timing: {
    /** Total time spent in detector across all commits (ms) */
    totalDetectorOverhead: number;
    /** Average detector overhead per commit (ms) */
    avgDetectorOverhead: number;
    /** Total time from first to last commit (ms) */
    totalTimeSpan: number;
    /** Average time between commits (ms) */
    avgTimeBetweenCommits: number;
  };
}

export interface HostUnmountSummary {
  elements: number;
  text: number;
  tagsTop: Array<[string, number]>;
  testIdsTop: Array<[string, number]>;
  rolesTop: Array<[string, number]>;
  ariaLabels: string[];
  textHints: string[];
}

export interface UnmountSample {
  name: string;
  key: string | null;
  depth: number | null;
  count: number;
  source?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  host?: HostUnmountSummary;
}

export type InteractionCaptureLevel = 'off' | 'explicit' | 'noisy' | 'all';

export interface InteractionActionLocation {
  dom: {
    tag: string | null;
    text: string;
    nearestTestId: string | null;
  };
  targetFiber: {
    name: string | null;
    key: string | null;
    source: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
    ownerStackKind: 'owners' | 'parents';
    ownerStack: Array<{
      name: string | null;
      key: string | null;
      props: string[];
      hookCount: number;
      hookCountTruncated: boolean;
      hookCountMax: number;
      source: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
    }>;
  } | null;
}

export interface InteractionAction {
  /** Sequential action id within this detector capture. */
  id: number;
  /** Native event name, e.g. click, keydown, wheel. */
  action: string;
  /** performance.now() at event capture time. Kept live-only; DTO emits deltaTime. */
  timestamp: number;
  /** DOM-grounded event target plus target component/ownership stack. */
  location: InteractionActionLocation;
}

export type PropChangeKind = 'same' | 'ref-changed' | 'scalar-changed' | 'added' | 'removed';

export interface PropValueSummary {
  type: string;
  isArray: boolean;
  isFunction: boolean;
  isNull: boolean;
  preview: string;
  display?: string;
  length?: number;
  keysTop?: string[];
  sample?: unknown[];
}

export interface PropChangeEvidence {
  name: string;
  kind: PropChangeKind;
  prev: PropValueSummary;
  current: PropValueSummary;
}

export interface RenderedComponentEvidence {
  sourceId: string;
  name: string;
  depth: number;
  parentSourceId: string | null;
  ownerSourceId: string | null;
  isSelfSource: boolean;
  propChanges: PropChangeEvidence[];
  hasPropChanges: boolean;
  trasherCounts: { effects: number; callbacks: number; memos: number };
}

export interface CommitInteractionAction {
  /** Original action id — must match InteractionAction.id for describe-action lookup. */
  id: number;
  /** Last commit id at the moment this action was observed. */
  lastCommitId: number;
  /** Milliseconds from action capture to the linked commit. */
  deltaTime: number;
  /** performance.now() at event capture time, on the `meta.timeOrigin` clock. */
  timestamp: number;
  action: string;
  location: InteractionAction['location'];
}

export interface Report {
  /** Metadata: version, counts, overhead metrics */
  meta: ReportMeta;
  /** Components that caused updates, sorted by collateral damage */
  sources: Source[];
  /** Bridge to DevTools - maps commit ID to sources that fired in that commit */
  sourcesByCommit: Record<
    number,
    Array<{
      sourceId: string;
      type: ComponentType;
      depth: number;
      /** Collateral damage caused by this source in THIS commit */
      collateral: number;
      /** Position in top N sources list (1-based), or null if not in top N */
      rank: number | null;
      /** Index into sources[] array for full accumulated data, or null if not in top N */
      sourceIndex: number | null;
      hooks?: Array<{ index: number; prevValue: unknown; currentValue: unknown }>;
      isRepeat?: boolean;
    }>
  >;
  /**
   * Per-commit metrics to find the needle: [collateral, effects, memos, callbacks]
   * High collateral = avalanche. High effects = likely causes next commit!
   */
  commitStats: Record<number, CommitStats>;
  /**
   * Per-commit timing data - correlate restarts with commit duration.
   * High commitStats[N].restarts + high commitTimings[N].timeSinceLastCommit = React wasted work.
   */
  commitTimings: Record<number, CommitTiming>;
  /**
   * Per-commit counter deltas from the commit metrics adapter - low-level React
   * work per commit. With the ATL adapter:
   * metricsByCommit[N].componentRenderWithHooksCount + finishClassComponentCount
   * should equal commitStats[N].collateral + commitStats[N].sources
   */
  metricsByCommit?: Record<number, CommitMetricsDelta>;
  /** @deprecated Alias of `metricsByCommit`, kept for one release. */
  atlByCommit?: Record<number, CommitMetricsDelta>;
  /** @deprecated Use amplifierSources instead for full source linkage */
  amplifiers?: Amplifier[];
  /**
   * Amplifier sources - components that amplified the update cost with hook re-executions.
   * Shows which components responded to updates with expensive work (effects, memos, callbacks).
   * Linked to the source that triggered them.
   */
  amplifierSources?: AmplifierSource[];
  /**
   * Per-commit Suspense boundary transitions.
   * Only populated for commits where at least one boundary entered or left fallback.
   * Empty object when no Suspense transitions occurred during the capture.
   */
  suspenseByCommit: Record<number, SuspenseBoundaryEvent[]>;

  /** Bounded samples of component subtrees unmounted per commit. */
  unmountsByCommit?: Record<number, UnmountSample[]>;

  /** Compact user/browser actions linked to nearby commits. */
  interactionsByCommit?: Record<number, CommitInteractionAction[]>;

  /** Structural evidence for each component that rendered in a commit. */
  renderedByCommit?: Record<number, RenderedComponentEvidence[]>;

  /**
   * Convert this report to a serializable DTO (safe for JSON.stringify, IPC, network).
   * Strips non-serializable fields like Fiber references and ComponentType functions.
   */
  toSerializable(): ReportDTO;
}

export interface DetectorOptions {
  ignore?: ComponentType[];
  effectThrashMode?: 'non-primitive' | 'all';
  captureFibers?: boolean;
  /**
   * Detection mode - controls what the detector tracks (tiered for performance):
   *
   * Use DETECTION_LEVEL constants for clarity:
   * - DETECTION_LEVEL.LEVEL1_STATS ('stats'): Only commitStats, super fast
   * - DETECTION_LEVEL.LEVEL2_SOURCES ('sources'): + source tracking
   * - DETECTION_LEVEL.LEVEL3_AMPLIFIER_METRICS ('amplifierMetrics'): + aggregate amplifier counts only
   * - DETECTION_LEVEL.LEVEL3_AMPLIFIERS ('amplifiers'): + full amplifier arrays
   *
   * Shortcuts:
   * - false: Alias for 'stats' (minimal overhead)
   * - true: Alias for 'full' (maximum detail)
   *
   * Performance hierarchy (fastest to slowest):
   * stats < sources < amplifierMetrics < amplifiers ≈ full
   */
  detectionMode?:
    | boolean
    | 'full'
    | 'amplifiers'
    | 'amplifierMetrics'
    | 'sources'
    | 'stats'
    | false;

  historySize?: number;

  /**
   * Browser action capture level. Defaults to 'explicit' to capture high-signal
   * actions (click/keyboard/input) while leaving noisy wheel/move capture opt-in.
   */
  interactionCapture?: InteractionCaptureLevel;

  /** Extra native event names to capture in addition to the selected level. */
  interactionEvents?: string[];

  /** Time window for linking captured actions to a commit, in ms. Default: 1000. */
  interactionWindowMs?: number;

  /**
   * Commit metrics adapter for host render counters. Defaults to the adapter
   * registered with `registerCommitMetricsAdapter` when the detector installs.
   * Pass `null` to run on the DevTools hook only.
   */
  metricsAdapter?: CommitMetricsAdapter | null;

  /** @deprecated Historical option used by older call sites. Prefer `detector.report(topN)` */
  topN?: number;
}

export type ThrashMode = 'full' | 'counts' | false;
export type DetectionLevel = 'stats' | 'sources' | 'amplifierMetrics' | 'amplifiers' | 'full';

/**
 * Internal amplifier source state - keyed by sourceId for navigation.
 */
export interface AmplifierSourceState {
  type: ComponentType;
  depth: number;
  effectCount: number;
  callbackCount: number;
  memoCount: number;
  hooksTotal: number;
  commitIds: number[];
  byCommit: Record<number, { effects: number; callbacks: number; memos: number }>;
  /** sourceId that caused this component to re-render (if not self-caused) */
  causedBySourceId: string | null;
  lastAmplification: {
    depth: number;
    thrashedHooks: ThrashInfo[];
    fiber?: Fiber;
  };
}

/**
 * Commit timing data - measures React commit duration and detector overhead.
 * All times in milliseconds.
 */
export interface CommitTiming {
  /**
   * performance.now() when the commit hook started, on the `meta.timeOrigin`
   * clock. React calls the hook after the commit's mutation and layout phases
   * and before passive effects, so this marks the end of React's synchronous
   * commit, not the start of render.
   */
  startTime: number;
  /** performance.now() when the detector finished processing this commit. */
  endTime: number;
  /** Time from previous commit end to this commit end (includes React work + idle time) */
  timeSinceLastCommit: number;
  /** Time spent in avalanche detector processing (our overhead) */
  detectorOverhead: number;
}

/**
 * Internal profiler state - tracks all avalanche detection data.
 *
 * This is the core state structure that accumulates across commits.
 * Most users should use the `Report` interface from `detector.report()` instead.
 */
export interface ProfilerState {
  /** Total commits processed since install() or reset() */
  commits: number;

  /**
   * All detected sources, keyed by stable source ID (e.g., "Button#1@3").
   * Source = component that caused an update (not just re-rendered).
   */
  sources: Map<string, Omit<Source, 'sourceId'>>;

  /** @deprecated Use amplifierSources instead */
  amplifiers: Map<ComponentType, Omit<Amplifier, 'type'>>;

  /**
   * Amplifier sources keyed by sourceId.
   * Enables source↔amplifier navigation and per-commit breakdown.
   */
  amplifierSources: Map<string, AmplifierSourceState>;

  /**
   * Aggregate thrashing counts (only if detectThrashing: 'counts').
   * Lightweight alternative to full thrashing analysis.
   */
  thrashCounts: null | { totalHooks: number; affectedComponents: Set<ComponentType> };

  /** Whether React DevTools hook exposes memoizedUpdaters (React 18.3.1+) */
  memoizedUpdatersAvailable: boolean;

  /** Number of commits where memoizedUpdaters data was present */
  commitsWithMemoizedUpdaters: number;

  /** Per-commit stats: [collateral, effects, memos, callbacks] */
  commitStats: Record<number, CommitStats>;

  /**
   * Per-commit counter deltas from the commit metrics adapter.
   * Enables full reconciliation with Avalanche counts.
   */
  metricsByCommit: Record<number, CommitMetricsDelta>;

  /** Last adapter snapshot (for delta calculation) */
  lastMetricsSnapshot: CommitMetricsSnapshot | null;

  /**
   * Per-commit timing data - measures commit duration and detector overhead.
   * Enables correlation: high restarts → longer commit times.
   */
  commitTimings: Record<number, CommitTiming>;

  /** Timestamp when last commit ended (for delta calculation) */
  lastCommitEndTime: number;

  /**
   * Per-commit Suspense boundary transitions.
   * Only populated for commits where at least one boundary entered or left fallback.
   */
  suspenseByCommit: Record<number, SuspenseBoundaryEvent[]>;

  /** Bounded samples of component subtrees unmounted per commit. */
  unmountsByCommit: Record<number, UnmountSample[]>;

  /** Recent action breadcrumbs captured from native events. */
  interactionActions: InteractionAction[];

  /** Compact user/browser actions linked to nearby commits. */
  interactionsByCommit: Record<number, CommitInteractionAction[]>;

  /** Structural evidence for each component that rendered in a commit. */
  renderedByCommit: Record<number, RenderedComponentEvidence[]>;
}

function isTrueSource(s: Source): boolean {
  const commits = Object.values(s.updateHistory);
  if (commits.length === 0) return false;

  // A source is "true" if ANY commit in the retained window has a concrete hook entry.
  // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
  for (let i = 0; i < commits.length; i++) {
    const entry = commits[i];
    if (!entry || entry === 'repeat') {
      // Skip empty or repeat entries
    } else if (typeof entry === 'object' && entry !== null) {
      if (Object.values(entry).some((hook) => hook !== 'repeat')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * A Suspense boundary state transition captured during a commit.
 * Only emitted when the boundary actually entered or left the fallback state.
 * Boundaries that render without delay (no fallback shown) produce no events.
 */
export interface SuspenseBoundaryEvent {
  /** Tree depth of the Suspense fiber */
  depth: number;
  /** true = boundary entered fallback (primary → suspended) */
  entered: boolean;
  /** true = boundary left fallback (suspended → primary revealed) */
  left: boolean;
  /** The Suspense fiber itself (only present when captureFibers is true) */
  fiber?: Fiber;
}

export interface ReportOptions {
  /** Minimum collateral damage to include a source in sourcesByCommit (default: 0 - show all) */
  minCollateral?: number;
}

export function buildReport(
  state: ProfilerState,
  thrashMode: ThrashMode,
  topN: number,
  sortBy: SortBy,
  options: ReportOptions = {},
  detectorConfig?: {
    effectThrashMode: 'non-primitive' | 'all';
    captureFibers: boolean;
    historySize: number;
    detectionLevel?: DetectionLevel;
    /**
     * Integration model that produced this report. Determines what's reliable
     * in commitStats and metricsByCommit. Defaults to 'none'.
     */
    integrationMode?: IntegrationMode;
  }
): Report {
  const { minCollateral = 1 } = options;

  // Helper to generate human-readable sourceId from internal ID (e.g., "T1#2@3" -> "Counter#2@3")
  const toHumanReadableId = (internalId: string, type: ComponentType, depth: number): string => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const componentName = getComponentName({ type } as Fiber);
    // Extract instance number from internal ID (e.g., "T1#2@3" -> "2")
    const match = internalId.match(/#(\d+)@/);
    const instanceNum = match ? match[1] : '1';
    return `${componentName}#${instanceNum}@${depth}`;
  };

  // Map internal IDs to human-readable IDs for the report
  const idMapping = new Map<string, string>(); // internalId -> humanId

  // Build ALL sources first (for accurate sourcesByCommit)
  const allSources = Array.from(state.sources.entries())
    .map(([internalId, s]) => {
      const humanId = toHumanReadableId(internalId, s.type, s.depth);
      idMapping.set(internalId, humanId);

      return {
        sourceId: humanId,
        ...s,
        maxPenetrationDepth: Math.max(0, s.maxPenetrationDepth - s.depth), // Convert to relative depth (never negative!)
        // Initialize restart waste tracking
        restartWaste: 0,
        maxRestartWaste: 0,
        restartWasteByCommit: {},
      };
    })
    .filter(isTrueSource);

  // RESTART WASTE ATTRIBUTION
  // Distribute restarts proportionally to sources that fired in each commit
  // This identifies sources contributing to restart waste
  Object.entries(state.commitStats).forEach(([commitIdStr, stats]) => {
    const commitId = Number(commitIdStr);
    const restarts = stats[CS_RESTARTS]; // commitStats[CS_RESTARTS] = restart count

    if (restarts === 0) return;

    // Find all sources that fired in this commit
    const sourcesInCommit = allSources.filter(
      (source) => source.updateHistory[commitId] !== undefined
    );

    if (sourcesInCommit.length === 0) {
      // Ghost restarts (Suspense, priority interruption, external store)
      // No sources to attribute to - these are not directly caused by component updates
      return;
    }

    // Distribute restarts proportionally among sources
    const restartsPerSource = restarts / sourcesInCommit.length;

    // Mutate the source objects directly (they're from allSources array we own)
    for (const sourceItem of sourcesInCommit) {
      sourceItem.restartWaste += restartsPerSource;
      sourceItem.restartWasteByCommit[commitId] = restartsPerSource;

      if (restartsPerSource > sourceItem.maxRestartWaste) {
        sourceItem.maxRestartWaste = restartsPerSource;
      }
    }
  });

  // Build amplified array for each source (Direction 1: Source → Amplified components)
  if (thrashMode === 'full') {
    for (const sourceItem of allSources) {
      const amplifiedByThisSource: Source['amplified'] = [];

      // Find all components that were amplified when this source triggered them
      state.amplifierSources.forEach((amplifierData, amplifierInternalId) => {
        const amplifierHumanId =
          idMapping.get(amplifierInternalId) ||
          toHumanReadableId(amplifierInternalId, amplifierData.type, amplifierData.depth);

        // Check if this component was amplified by the current source
        // amplifierData.causedBySourceId is the INTERNAL id, need to convert to human id
        const causedByHumanId = amplifierData.causedBySourceId
          ? idMapping.get(amplifierData.causedBySourceId)
          : null;

        if (causedByHumanId === sourceItem.sourceId || amplifierHumanId === sourceItem.sourceId) {
          // This component was either:
          // 1. Amplified by this source (descendant with unstable hooks)
          // 2. IS this source (self-amplification - source has unstable hooks)
          amplifiedByThisSource.push({
            sourceId: amplifierHumanId,
            type: amplifierData.type,
            depth: amplifierData.depth,
            effectCount: amplifierData.effectCount,
            callbackCount: amplifierData.callbackCount,
            memoCount: amplifierData.memoCount,
            hooksTotal: amplifierData.hooksTotal,
            commitIds: amplifierData.commitIds,
            byCommit: amplifierData.byCommit,
            lastAmplification: amplifierData.lastAmplification,
          });
        }
      });

      if (amplifiedByThisSource.length > 0) {
        sourceItem.amplified = amplifiedByThisSource;
      }
    }
  }

  // Top N sources - update sources sorted by TOTAL WASTE (collateral + restarts)
  // This identifies the real offenders, including those causing restart waste
  const sources = [...allSources]
    .sort((a, b) => {
      const aTotalWaste = a.collateralUpdates + (a.restartWaste || 0);
      const bTotalWaste = b.collateralUpdates + (b.restartWaste || 0);
      return (
        bTotalWaste - aTotalWaste ||
        b.maxCollateralUpdates - a.maxCollateralUpdates ||
        (b.maxRestartWaste || 0) - (a.maxRestartWaste || 0)
      );
    })
    .slice(0, topN);

  const coverage =
    state.commits > 0
      ? Math.round((state.commitsWithMemoizedUpdaters / state.commits) * 100) + '%'
      : '0%';

  // Calculate timing summary
  const timingEntries = Object.values(state.commitTimings);
  const totalDetectorOverhead = timingEntries.reduce((sum, t) => sum + t.detectorOverhead, 0);
  const totalTimeSpan = timingEntries.reduce((sum, t) => sum + t.timeSinceLastCommit, 0);
  const avgDetectorOverhead =
    timingEntries.length > 0 ? totalDetectorOverhead / timingEntries.length : 0;
  const avgTimeBetweenCommits = timingEntries.length > 0 ? totalTimeSpan / timingEntries.length : 0;

  // Build lookup map for top N sources (sourceId → { rank, index })
  const topNLookup = new Map<string, { rank: number; index: number }>();
  for (let i = 0; i < sources.length; i++) {
    topNLookup.set(sources[i].sourceId, { rank: i + 1, index: i });
  }

  // Build sourcesByCommit from ALL sources (not just top N!)
  // This ensures commitStats[N].sources matches sourcesByCommit[N].length
  const sourcesByCommit: Report['sourcesByCommit'] = {};

  // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
  allSources.forEach((source) => {
    // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
    Object.entries(source.updateHistory).forEach(([commitIdStr, data]) => {
      const commitId = Number(commitIdStr);

      // Diagnostic strings like "detector-only" are not "this source fired in this commit".
      // They exist only to explain detector/React disagreement. Do not surface them in sourcesByCommit.
      if (typeof data === 'string' && data !== 'repeat') {
        return;
      }

      // Get per-commit collateral for this source
      const collateral = source.collateralByCommit?.[commitId] ?? 0;

      // Skip sources below minCollateral threshold
      if (collateral < minCollateral) {
        return;
      }

      if (!sourcesByCommit[commitId]) {
        sourcesByCommit[commitId] = [];
      }

      const isRepeat = data === 'repeat';

      // Build detailed hook info
      let hookChanges:
        | Array<{ index: number; prevValue: unknown; currentValue: unknown }>
        | undefined;
      if (typeof data === 'object' && data !== null) {
        // eslint-disable-next-line @atlassian/perf-linting/no-quadratic-complexity
        hookChanges = Object.entries(data).map(([index, hookData]) => ({
          index: Number(index),
          prevValue:
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            hookData !== 'repeat' ? (hookData as { prevValue: unknown }).prevValue : undefined,
          currentValue:
            hookData !== 'repeat'
              ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                (hookData as { currentValue: unknown }).currentValue
              : undefined,
        }));
      }

      // Get rank and index (null if not in top N)
      const lookup = topNLookup.get(source.sourceId);
      const rank = lookup?.rank ?? null;
      const sourceIndex = lookup?.index ?? null;

      const entry: Report['sourcesByCommit'][number][number] = {
        sourceId: source.sourceId,
        type: source.type,
        depth: source.depth,
        collateral,
        rank,
        sourceIndex,
      };

      if (hookChanges && hookChanges.length > 0) {
        entry.hooks = hookChanges;
      }
      if (isRepeat) {
        entry.isRepeat = true;
      }

      sourcesByCommit[commitId].push(entry);
    });
  });

  // Only include metricsByCommit if there's data
  const hasMetricsData = Object.keys(state.metricsByCommit).length > 0;

  // Build meta object
  const integrationMode = detectorConfig?.integrationMode ?? 'none';
  const metricsAdapter = adapterIdFromMode(integrationMode);
  const metricsAvailable = metricsAdapter !== null && hasMetricsData;
  const meta: ReportMeta = {
    version: 7, // v7: meta.timeOrigin; absolute commitTimings[N].startTime/endTime; action timestamps
    timeOrigin: performance.timeOrigin,
    commits: state.commits,
    config: {
      detectionLevel: detectorConfig?.detectionLevel ?? 'full',
      effectThrashMode: detectorConfig?.effectThrashMode ?? 'non-primitive',
      captureFibers: detectorConfig?.captureFibers ?? false,
      historySize: detectorConfig?.historySize ?? 1,
    },
    memoizedUpdatersSupport: {
      available: state.memoizedUpdatersAvailable,
      commitsWithData: state.commitsWithMemoizedUpdaters,
      coverage,
    },
    integrationMode,
    metricsAdapter,
    // Per-field availability — fiber-walk fields are always real measurements
    // because recordTree() runs in every mode. The only adapter-exclusive
    // datapoint is the render-counter delta (restarts, metricsByCommit).
    dataAvailability: {
      collateral: true,
      sources: true,
      restarts: metricsAvailable,
      performedWork: true,
      effects: true,
      memos: true,
      callbacks: true,
      contextUpdates: true,
      metricsByCommit: metricsAvailable,
      atlByCommit: metricsAvailable,
    },
    timing: {
      totalDetectorOverhead,
      avgDetectorOverhead,
      totalTimeSpan,
      avgTimeBetweenCommits,
    },
  };

  const base: Report = {
    meta,
    sources,
    sourcesByCommit,
    commitStats: state.commitStats,
    commitTimings: state.commitTimings,
    suspenseByCommit: state.suspenseByCommit,
    unmountsByCommit: state.unmountsByCommit,
    interactionsByCommit: state.interactionsByCommit,
    renderedByCommit: state.renderedByCommit,
    ...(hasMetricsData && { metricsByCommit: state.metricsByCommit, atlByCommit: state.metricsByCommit }),
    toSerializable() {
      return serializeReport(this);
    },
  };

  if (thrashMode === 'full') {
    const getSortValue = (amplifier: Amplifier) => {
      if (sortBy === 'effect') return amplifier.effectCount;
      if (sortBy === 'callback') return amplifier.callbackCount;
      if (sortBy === 'memo') return amplifier.memoCount;
      if (sortBy === 'total') return amplifier.hooksTotal;
      return amplifier.effectCount;
    };

    const getLinkedSortValue = (as: AmplifierSource) => {
      if (sortBy === 'effect') return as.effectCount;
      if (sortBy === 'callback') return as.callbackCount;
      if (sortBy === 'memo') return as.memoCount;
      if (sortBy === 'total') return as.hooksTotal;
      return as.effectCount;
    };

    // Build amplifierSources
    const amplifierSources: AmplifierSource[] = Array.from(state.amplifierSources.entries())
      .map(([internalId, lt]) => {
        const humanId =
          idMapping.get(internalId) || toHumanReadableId(internalId, lt.type, lt.depth);
        const sourceData = state.sources.get(internalId);

        return {
          sourceId: humanId,
          type: lt.type,
          depth: lt.depth,
          collateralUpdates: sourceData?.collateralUpdates ?? 0,
          effectCount: lt.effectCount,
          callbackCount: lt.callbackCount,
          memoCount: lt.memoCount,
          hooksTotal: lt.hooksTotal,
          commitIds: lt.commitIds,
          byCommit: lt.byCommit,
          causedBySourceId: lt.causedBySourceId
            ? idMapping.get(lt.causedBySourceId) || lt.causedBySourceId
            : null,
          lastAmplification: lt.lastAmplification,
        };
      })
      .sort((a, b) => getLinkedSortValue(b) - getLinkedSortValue(a) || b.hooksTotal - a.hooksTotal)
      .slice(0, topN);

    return {
      ...base,
      amplifiers: Array.from(state.amplifiers.entries())
        .map(([type, s]) => ({ type, ...s }))
        .sort(
          (a, b) =>
            getSortValue(b) - getSortValue(a) ||
            b.hooksTotal - a.hooksTotal ||
            b.maxHooksPerCommit - a.maxHooksPerCommit
        )
        .slice(0, topN),
      amplifierSources,
    };
  }

  if (thrashMode === 'counts' && state.thrashCounts) {
    // Add amplifier metrics to meta
    meta.amplifiersMetrics = {
      totalHookThrashes: state.thrashCounts.totalHooks,
      affectedComponentCount: state.thrashCounts.affectedComponents.size,
    };
  }

  return base;
}
