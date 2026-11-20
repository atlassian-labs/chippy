/** Standalone commit detector. Install the bootstrap before React DOM loads. */
export { createAvalancheDetector, DETECTION_LEVEL } from '../avalanche/detector';
export type { DetectorOptions, Report, ReportOptions, SortBy } from '../avalanche/reporter';
export {
  type CommitMetricsAdapter,
  type IntegrationMode,
  registerCommitMetricsAdapter,
} from '../avalanche/commit-metrics-adapter';
