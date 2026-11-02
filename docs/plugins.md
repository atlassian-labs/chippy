# Plugins

The Chippy core has no product knowledge. It finds Error and Suspense boundaries
from fiber signals and captures commits through the React DevTools hook. Two
seams let a plugin add knowledge of a particular application:

| Seam | Adds | Built-in plugin |
| --- | --- | --- |
| Context provider | Boundary kinds, error-boundary fields, and probe card titles and fields | Jira: labels the team-ownership boundaries Jira pages render |
| Commit metrics adapter | Per-commit counters and restart counts from an instrumented react-dom | ATL: reads counters from Atlassian's instrumented react-dom |

A plugin is an object with an `id`, an optional `label`, and a context provider,
a commit metrics adapter, or both. The bundle registers both built-in plugins but
enables neither; [`chippy pack`](#packing-a-custom-build) adds more plugins and
default selections without forking Chippy. The extension, the console import,
and `@atlassian/chippy/browser` load that bundle; a page opts in in one of three
ways (both built-in plugins do nothing on other apps):

| Route | When it applies |
| --- | --- |
| Check the plugin in the Chippy panel's settings | From the next page load; it reaches ATL's pre-page setup |
| Set `window.__CHIPPY_PLUGINS = ['jira', 'atl']` before the bundle loads | Console import and custom builds |
| Call `__AVALANCHE__.enablePlugins(['jira'])` | Immediately for Jira; for ATL, from the next Avalanche install |

The page's own selection, from the startup config or `__CHIPPY_PLUGINS`, wins
over a packed build's defaults. `__AVALANCHE__.listPlugins()` lists the registered
plugins and which ones run. The
standalone detector in `@atlassian/chippy/avalanche` does not include it; a host
registers the ATL adapter itself.

## Context providers

A context provider reads the probed fiber's ancestry and contributes to the
marker context that probes, the marker card, and `describeContext` report.

```ts
import type { ContextProvider } from '@atlassian/chippy/plugin';

export const featureGateProvider: ContextProvider = {
  id: 'feature-gate',
  kinds: [{ kind: 'gate', label: 'gate', accent: '#6554c0' }],
  describe(fibers) {
    const index = fibers.findIndex((fiber) => fiber.type?.displayName === 'FeatureGate');
    if (index < 0) return { boundaries: { gate: null } };
    const flag = String(fibers[index].memoizedProps?.flag ?? '');
    return {
      boundaries: { gate: { distance: index, flag } },
      titles: { gate: `Gate ${flag}` },
      fields: { gate: [{ label: 'Flag', value: flag }] },
    };
  },
  matchBoundary: (fiber) => (fiber.type?.displayName === 'FeatureGate' ? 'gate' : null),
};
```

- `describe(fibers)` receives the probed fiber first, then its parent path, then
  its debug-owner path. Return `null` or any subset of `ContextContribution`. A
  `null` boundary records that the provider looked and found nothing.
- `kinds` must not reuse the core kinds `error` and `suspense`.
- `errorEnrichment` merges fields onto the error boundary the core found.
- `matchBoundary(fiber)` lets the panel highlight the provider's boundaries in the
  page.
- Registering the same `id` again replaces the earlier provider. A provider that
  throws is skipped, so it cannot break inspection.

Register a provider from the bundle, or from the page at runtime:

```js
__AVALANCHE__.layoutLab.registerContextProvider(featureGateProvider);
```

The `ContextProvider` type in `@atlassian/chippy/plugin` documents each field.

## Commit metrics adapters

An adapter wraps a host surface that counts renders, such as an instrumented
react-dom. The detector keeps capturing commits through DevTools; the adapter adds
counter deltas and the number of render passes React did not commit. Reports
name the source in `integrationMode`: `adapter:<id>`, or `devtools` without an
adapter.

Only one adapter is active. `registerCommitMetricsAdapter(adapter)` replaces the
earlier one and returns an unregister function; it applies to detectors installed
afterwards. The `CommitMetricsAdapter` type in `@atlassian/chippy/plugin` documents
each method. In short:

- `isAvailable`, `snapshot`, and `measure(before, after, committedComponents, commitId)`
  read the counters and turn two snapshots into `{ delta, restarts }`.
- `attach`, `isAttached`, `reattach`, and `detach` wire the host's commit callback
  to the detector and recover when the host replaces its surface.
- `prepare` seeds the surface before a detector installs. `prePage(config)` runs
  before React evaluates, from the extension's early bootstrap through
  `__AVALANCHE__.runPrePageHooks(config)`. A failing `prePage` falls back to
  DevTools capture.
- `frameFilters` hides the host's own stack frames from hook ancestry.

With the npm library:

```ts
import { atlCommitMetricsAdapter, registerCommitMetricsAdapter } from '@atlassian/chippy/avalanche';

registerCommitMetricsAdapter(atlCommitMetricsAdapter);
```

## Packing a custom build

An organization can ship its own plugins, defaults, and documentation as a
separate skill and extension built from the published package. Write each plugin
as a module whose default export is the plugin:

```ts
// src/feature-gate.ts
import { definePlugin, getDisplayName } from '@atlassian/chippy/plugin';

export default definePlugin({
  id: 'feature-gate',
  contextProvider: {
    id: 'feature-gate',
    kinds: [{ kind: 'gate', label: 'gate', accent: '#6554c0' }],
    describe(fibers) {
      const index = fibers.findIndex((fiber) => getDisplayName(fiber.type) === 'FeatureGate');
      return { boundaries: { gate: index < 0 ? null : { distance: index } } };
    },
  },
});
```

Then describe the build in `chippy.config.mjs`:

```js
export default {
  plugins: [{ id: 'feature-gate', label: 'Feature gates', entry: './src/feature-gate.ts' }],
  // Built-in or packed ids that run until the user saves their own selection.
  defaultPlugins: ['feature-gate', 'jira'],
  // Manifest fields. Set `key` to keep a stable extension id across uploads.
  extension: { name: 'Chippy (Example)', version: '0.4.24.1' },
  // Files copied onto the skill; `<name>.append.md` appends to `<name>.md`.
  skill: { overlay: './skill-overlay' },
  outDir: './chippy-build',
};
```

Run `npx @atlassian/chippy pack` with `esbuild` installed in the same project.
The command writes:

- `chippy-build/chippy/`, the skill with its extension in `extension/`;
- `chippy-build/chippy-skill.zip` and `chippy-build/chippy-extension.zip`.

The packer appends the bundled plugins to the runtime bundle, so the extension,
the helper-served console import, and Playwright sessions all load them, and
registration happens before the ATL pre-page hook runs. It adds the plugins to
the panel's settings and makes `defaultPlugins` the extension's initial
selection. To update, bump `@atlassian/chippy` and pack again.
