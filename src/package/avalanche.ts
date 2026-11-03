/** Standalone commit detector. Install the bootstrap before React DOM loads. */
export { createAvalancheDetector, DETECTION_LEVEL } from '../avalanche/detector';
export type { DetectorOptions, Report, ReportOptions, SortBy } from '../avalanche/reporter';
export {
  type CommitMetricsAdapter,
  type IntegrationMode,
  registerCommitMetricsAdapter,
} from '../avalanche/commit-metrics-adapter';
/** Opt-in adapter for hosts whose react-dom writes `__ATL_REACT_METRICS`. */
export {
  atlCommitMetricsAdapter,
  createATLCommitMetricsAdapter,
} from '../plugins/atl/commit-metrics-adapter';
