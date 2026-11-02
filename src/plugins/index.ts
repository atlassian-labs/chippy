/**
 * Built-in plugins shipped with the Chippy bundle. The core runtime has no
 * product knowledge, and the bundle enables no plugin by default. A page opts
 * in through the startup config (`plugins: ['jira', 'atl']`), the
 * `__CHIPPY_PLUGINS` global, or `__AVALANCHE__.enablePlugins()`.
 */

import { registerCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { registerContextProvider } from '../layout-lab/marker-context';
import { atlCommitMetricsAdapter } from './atl/commit-metrics-adapter';
import { jiraContextProvider } from './jira/context-provider';

const BUILTIN_PLUGINS = {
  jira: () => registerContextProvider(jiraContextProvider),
  atl: () => registerCommitMetricsAdapter(atlCommitMetricsAdapter),
} as const;

export type BuiltinPluginId = keyof typeof BUILTIN_PLUGINS;

const enabled = new Map<BuiltinPluginId, () => void>();

/**
 * Enable the named built-in plugins. Unknown ids and non-array input are
 * ignored, and enabling a plugin twice is a no-op. Returns the ids that are
 * enabled afterwards.
 */
export function enableBuiltinPlugins(ids: unknown): BuiltinPluginId[] {
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !Object.hasOwn(BUILTIN_PLUGINS, id) || enabled.has(id as BuiltinPluginId)) continue;
    enabled.set(id as BuiltinPluginId, BUILTIN_PLUGINS[id as BuiltinPluginId]());
  }
  return [...enabled.keys()];
}

/** Disable every enabled built-in plugin. */
export function disableBuiltinPlugins(): void {
  for (const unregister of [...enabled.values()].reverse()) unregister();
  enabled.clear();
}
