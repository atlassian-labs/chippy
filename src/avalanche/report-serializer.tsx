/**
 * Report Serializer - Converts Report to serializable DTO.
 *
 * PROBLEM:
 * The Report interface contains non-serializable data (Fiber references, ComponentType functions)
 * which makes it unsuitable for JSON.stringify(), IPC, or network transmission.
 *
 * SOLUTION:
 * Strip non-serializable fields (fiber, type). Keep only what's needed:
 * - sourceId already contains component name (e.g., "MyComponent#1@5")
 * - Metrics and numerical data
 * - No need to convert anything - just omit problematic fields
 *
 * USAGE:
 * ```typescript
 * const report = detector.report(50);
 * const dto = serializeReport(report);
 *
 * // Now safe to serialize
 * const json = JSON.stringify(dto);
 *
 * // Send over IPC/network
 * postMessage({ type: 'report', data: dto });
 * ```
 *
 * DESIGN:
 * - Minimal DTO - only what you need for metrics/analysis
 * - sourceId already has component name - no conversion needed
 * - Drop fiber and type fields completely
 *
 * The serializer is also the trust boundary between page-side React objects
 * and helper/offline consumers. A DTO must remain stable after the page is
 * gone, so it carries evidence and summaries rather than live object identity.
 */

import type { CommitMetricsDelta, IntegrationMode } from './commit-metrics-adapter';

// ============================================================================
// DTO TYPES (Serializable - no function refs, no Fiber refs)
// ============================================================================

/**
 * Commit stats tuple: [collateral, sources, restarts, performedWork, effects, memos, callbacks,
 * contextUpdates, unmountedComponents, unmountedSubtrees]. Mirrors CommitStats in reporter.tsx.
 */
export type CommitStatsDTO = [
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
 * Per-commit counter deltas from the commit metrics adapter, keyed by counter
 * name. The counters depend on the adapter (see `meta.metricsAdapter`).
 */
export type CommitMetricsDeltaDTO = CommitMetricsDelta;

/** @deprecated Use CommitMetricsDeltaDTO. Kept for one release. */
export type ATLCommitDeltaDTO = CommitMetricsDeltaDTO;

/**
 * Commit timing data - measures React commit duration and detector overhead.
 */
export interface CommitTimingDTO {
  timeSinceLastCommit: number;
  detectorOverhead: number;
}

/**
 * Report metadata - profiling context and overhead metrics.
 */
export interface ReportMetaDTO {
  version: number;
  commits: number;
  config: {
    detectionLevel: 'stats' | 'sources' | 'amplifierMetrics' | 'amplifiers' | 'full';
    effectThrashMode: 'non-primitive' | 'all';
    captureFibers: boolean;
    historySize: number;
  };
  memoizedUpdatersSupport: {
    available: boolean;
    commitsWithData: number;
    coverage: string;
  };
  /** Commit-hook integration model; older reports used `'atl'` for `'adapter:atl'`. */
  integrationMode?: IntegrationMode | 'atl';
  /** Id of the commit metrics adapter that drove the report, or null. */
  metricsAdapter?: string | null;
  /** Per-field availability for commitStats indices and metricsByCommit. */
  dataAvailability?: Record<string, boolean>;
  amplifiersMetrics?: {
    totalHookThrashes: number;
    affectedComponentCount: number;
  };
  timing: {
    totalDetectorOverhead: number;
    avgDetectorOverhead: number;
    totalTimeSpan: number;
    avgTimeBetweenCommits: number;
  };
}

/**
 * Minimal serializable source - just the metrics, no functions/fibers.
 * sourceId already contains component name (e.g., "MyComponent#1@5")
 */
export interface SourceDTO {
  sourceId: string;
  depth: number;
  collateralUpdates: number;
  maxCollateralUpdates: number;
  maxPenetrationDepth: number;
  causedUpdates: number;
  restartWaste?: number;
  maxRestartWaste?: number;
}

/**
 * Source entry in sourcesByCommit - which sources fired in each commit.
 */
export interface SourceByCommitDTO {
  sourceId: string;
  depth: number;
  collateral: number;
  rank: number | null;
  sourceIndex: number | null;
  trashers?: Array<{ index: number; prevValue: unknown; currentValue: unknown }>;
  isRepeat?: boolean;
}

/**
 * Serializable Report - minimal data for metrics and analysis.
 * All non-serializable fields (fiber, type) are omitted.
 */
export interface SuspenseBoundaryEventDTO {
  depth: number;
  entered: boolean;
  left: boolean;
}

export interface UnmountSampleDTO {
  name: string;
  key: string | null;
  depth: number | null;
  count: number;
  source?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
}

export type PropChangeKindDTO = 'same' | 'ref-changed' | 'scalar-changed' | 'added' | 'removed';

export interface PropValueSummaryDTO {
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

export interface PropChangeEvidenceDTO {
  name: string;
  kind: PropChangeKindDTO;
  prev: PropValueSummaryDTO;
  current: PropValueSummaryDTO;
}

export interface RenderedComponentEvidenceDTO {
  sourceId: string;
  name: string;
  depth: number;
  parentSourceId: string | null;
  ownerSourceId: string | null;
  isSelfSource: boolean;
  propChanges: PropChangeEvidenceDTO[];
  hasPropChanges: boolean;
  trasherCounts: { effects: number; callbacks: number; memos: number };
}

export interface CommitInteractionActionDTO {
  id: number;
  lastCommitId: number;
  deltaTime: number;
  action: string;
  location: {
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
  };
}

export interface ReportDTO {
  meta: ReportMetaDTO;
  sources: SourceDTO[];
  commitStats: Record<number, CommitStatsDTO>;
  suspenseByCommit: Record<number, SuspenseBoundaryEventDTO[]>;
  sourcesByCommit?: Record<number, SourceByCommitDTO[]>;
  interactionsByCommit?: Record<number, CommitInteractionActionDTO[]>;
  renderedByCommit?: Record<number, RenderedComponentEvidenceDTO[]>;
  metricsByCommit?: Record<number, CommitMetricsDeltaDTO>;
  /** @deprecated Alias of `metricsByCommit`, kept for one release. */
  atlByCommit?: Record<number, CommitMetricsDeltaDTO>;
  timing?: Record<number, CommitTimingDTO>;
}

// ============================================================================
// SERIALIZATION FUNCTION
// ============================================================================

/**
 * Convert Report to serializable DTO.
 *
 * Strips non-serializable fields (fiber, type) and keeps only essential metrics.
 *
 * @param report - Full Report from detector.report()
 * @returns Minimal serializable ReportDTO safe for JSON.stringify()
 */
export function serializeReport(report: {
  meta: ReportMetaDTO;
  sources: Array<{
    sourceId: string;
    depth: number;
    causedUpdates: number;
    collateralUpdates: number;
    maxCollateralUpdates: number;
    maxPenetrationDepth: number;
    restartWaste?: number;
    maxRestartWaste?: number;
  }>;
  commitStats: Record<number, CommitStatsDTO>;
  sourcesByCommit?: Record<
    number,
    Array<{
      sourceId: string;
      depth: number;
      collateral: number;
      rank: number | null;
      sourceIndex: number | null;
      hooks?: Array<{ index: number; prevValue: unknown; currentValue: unknown }>;
      trashers?: Array<{ index: number; prevValue: unknown; currentValue: unknown }>;
      isRepeat?: boolean;
    }>
  >;
  suspenseByCommit?: Record<number, Array<{ depth: number; entered: boolean; left: boolean; fiber?: unknown }>>;
  interactionsByCommit?: Record<number, CommitInteractionActionDTO[]>;
  renderedByCommit?: Record<number, RenderedComponentEvidenceDTO[]>;
  metricsByCommit?: Record<number, CommitMetricsDeltaDTO>;
  /** @deprecated Alias of `metricsByCommit`, kept for one release. */
  atlByCommit?: Record<number, CommitMetricsDeltaDTO>;
  timing?: Record<number, CommitTimingDTO>;
}): ReportDTO {
  // Just extract the fields we need - no conversion necessary
  const sources: SourceDTO[] = report.sources.map((source) => ({
    sourceId: source.sourceId,
    depth: source.depth,
    causedUpdates: source.causedUpdates,
    collateralUpdates: source.collateralUpdates,
    maxCollateralUpdates: source.maxCollateralUpdates,
    maxPenetrationDepth: source.maxPenetrationDepth,
    ...(source.restartWaste !== undefined && { restartWaste: source.restartWaste }),
    ...(source.maxRestartWaste !== undefined && { maxRestartWaste: source.maxRestartWaste }),
  }));

  // Serialize sourcesByCommit (strip non-serializable type/fiber fields)
  const sourcesByCommit: Record<number, SourceByCommitDTO[]> | undefined = report.sourcesByCommit
    ? Object.fromEntries(
        Object.entries(report.sourcesByCommit).map(([commitId, commitSources]) => [
          commitId,
          commitSources.map((src) => ({
            sourceId: src.sourceId,
            depth: src.depth,
            collateral: src.collateral,
            rank: src.rank,
            sourceIndex: src.sourceIndex,
            ...((src.trashers || src.hooks) && { trashers: src.trashers || src.hooks }),
            ...(src.isRepeat && { isRepeat: true }),
          })),
        ])
      )
    : undefined;

  // Serialize suspenseByCommit — strip fiber refs (not serializable), keep scalar event fields
  const suspenseByCommit: Record<number, SuspenseBoundaryEventDTO[]> = {};
  if (report.suspenseByCommit) {
    for (const [k, evts] of Object.entries(report.suspenseByCommit)) {
      suspenseByCommit[Number(k)] = evts.map((e) => ({
        depth: e.depth,
        entered: e.entered,
        left: e.left,
      }));
    }
  }

  return {
    meta: report.meta,
    sources,
    commitStats: report.commitStats,
    suspenseByCommit,
    ...(sourcesByCommit && { sourcesByCommit }),
    ...(report.interactionsByCommit && { interactionsByCommit: report.interactionsByCommit }),
    ...(report.renderedByCommit && { renderedByCommit: report.renderedByCommit }),
    ...((report.metricsByCommit || report.atlByCommit) && {
      metricsByCommit: report.metricsByCommit || report.atlByCommit,
      atlByCommit: report.metricsByCommit || report.atlByCommit,
    }),
    ...(report.timing && { timing: report.timing }),
  };
}
