/**
 * Types and helpers for writing a Chippy plugin. `chippy pack` bundles a
 * plugin module's default export into a custom skill and extension build.
 */
import type { ChippyPlugin } from '../../../src/plugins/index';

export type { ChippyPlugin, PluginStatus } from '../../../src/plugins/index';
export type {
  ContextBoundaryKind,
  ContextContribution,
  ContextField,
  ContextProvider,
} from '../../../src/layout-lab/marker-context';
export type { Fiber } from '../../../src/layout-lab/fiber-walk';
export type {
  CommitMetricsAdapter,
  CommitMetricsDelta,
  CommitMetricsMeasurement,
  CommitMetricsRoot,
  CommitMetricsSnapshot,
} from '../../../src/avalanche/commit-metrics-adapter';
/** Display name of a fiber's `type`: function, class, memo, or forwardRef. */
export { getDisplayName } from '../../../src/layout-lab/fiber-walk';
/** Fiber name helpers that commit metrics adapters use for hook ancestry. */
export { getComponentName, isComponentFiber } from '../../../src/avalanche/internals';

/** Identity helper that type-checks a plugin definition. */
export function definePlugin(plugin: ChippyPlugin): ChippyPlugin {
  return plugin;
}
