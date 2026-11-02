/** Public Avalanche entry point; keep React-internal implementation behind the
 * detector and metrics adapter rather than exposing their internal helpers. */
export { createAvalancheDetector, DETECTION_LEVEL } from './detector';
export {
  type CommitMetricsAdapter,
  type IntegrationMode,
  getCommitMetricsAdapter,
  registerCommitMetricsAdapter,
} from './commit-metrics-adapter';
