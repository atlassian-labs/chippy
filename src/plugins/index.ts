/**
 * Chippy plugin registry. The core runtime has no product knowledge; plugins
 * add it through the context provider and commit metrics adapter seams.
 *
 * The bundle ships no plugins of its own. A packed build (`chippy pack`)
 * appends them through `__AVALANCHE__.registerPlugin()`, and packs register
 * theirs at load. A plugin runs only once it is both registered and enabled. A
 * page enables plugins through the startup config (`plugins: ['my-plugin']`), the
 * `__CHIPPY_PLUGINS` global, or `__AVALANCHE__.enablePlugins()`; a packed
 * build can name defaults for pages that do neither.
 */

import { type AvalancheHooks, registerAvalancheHooks } from '../avalanche/avalanche-hooks';
import { type CommitMetricsAdapter, registerCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { type ContextProvider, registerContextProvider } from '../layout-lab/marker-context';

export type ChippyPlugin = {
  /** Stable id used to enable the plugin, e.g. `'my-plugin'`. */
  id: string;
  /** Short name shown in the extension's plugin settings. */
  label?: string;
  contextProvider?: ContextProvider;
  commitMetricsAdapter?: CommitMetricsAdapter;
  /** Per-recording callbacks whose results land in the Avalanche report under `hooks[<id>]`. */
  /** One hook set, or several (for example a pack's named Avalanche extensions). */
  avalancheHooks?: AvalancheHooks | AvalancheHooks[];
};

export type PluginStatus = { id: string; label: string; enabled: boolean };

const registered = new Map<string, ChippyPlugin>();
const requested = new Set<string>();
const active = new Map<string, () => void>();
let explicitSelection = false;

function activate(plugin: ChippyPlugin): void {
  const hookSets = plugin.avalancheHooks ? ([] as AvalancheHooks[]).concat(plugin.avalancheHooks) : [];
  const unregister = [
    plugin.contextProvider && registerContextProvider(plugin.contextProvider),
    plugin.commitMetricsAdapter && registerCommitMetricsAdapter(plugin.commitMetricsAdapter),
    ...hookSets.map(registerAvalancheHooks),
  ].filter((fn): fn is () => void => typeof fn === 'function');
  active.set(plugin.id, () => {
    for (const fn of unregister.reverse()) fn();
  });
}

function deactivate(id: string): void {
  active.get(id)?.();
  active.delete(id);
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Register a plugin. It starts at once if its id was already enabled.
 * Registering the same id again replaces the earlier plugin.
 */
export function registerPlugin(plugin: ChippyPlugin): () => void {
  if (!plugin || !validId(plugin.id)) throw new TypeError('registerPlugin expects a plugin with a non-empty id');
  deactivate(plugin.id);
  registered.set(plugin.id, plugin);
  if (requested.has(plugin.id)) activate(plugin);
  return () => {
    if (registered.get(plugin.id) !== plugin) return;
    deactivate(plugin.id);
    registered.delete(plugin.id);
  };
}

/**
 * Enable plugins by id. An id that is not registered yet starts when its
 * plugin registers; non-string ids are ignored. Returns the running ids.
 */
export function enablePlugins(ids: unknown): string[] {
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!validId(id) || requested.has(id)) continue;
    requested.add(id);
    const plugin = registered.get(id);
    if (plugin && !active.has(id)) activate(plugin);
  }
  return [...active.keys()];
}

/**
 * Record the page's own plugin selection. Once a page has chosen, build
 * defaults no longer apply, so a user who turned a default off keeps it off.
 */
export function selectPlugins(ids: unknown): string[] {
  explicitSelection = true;
  return enablePlugins(ids);
}

/** Enable a packed build's default plugins unless the page made its own selection. */
export function enableDefaultPlugins(ids: unknown): string[] {
  return explicitSelection ? [...active.keys()] : enablePlugins(ids);
}

export function listPlugins(): PluginStatus[] {
  return [...registered.values()].map((plugin) => ({
    id: plugin.id,
    label: plugin.label ?? plugin.id,
    enabled: active.has(plugin.id),
  }));
}

/** Stop every plugin and forget all registrations and selections. Test helper. */
export function resetPlugins(): void {
  for (const id of [...active.keys()].reverse()) deactivate(id);
  registered.clear();
  requested.clear();
  explicitSelection = false;
}
