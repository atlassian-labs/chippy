# Plugins

The Chippy core has no product knowledge. It finds Error and Suspense boundaries
from fiber signals and captures commits through the React DevTools hook. Two
seams let a plugin add knowledge of a particular application:

| Seam | Adds | Built-in plugin |
| --- | --- | --- |
| Context provider | Boundary kinds, error-boundary fields, and probe card titles and fields | Jira ownership markers, `src/plugins/jira/` |
| Commit metrics adapter | Per-commit counters and restart counts from an instrumented react-dom | ATL metrics, `src/plugins/atl/` |

The bundle ships both built-in plugins but enables neither. The extension, the
console import, and `@atlassian/chippy/browser` load that bundle; a page opts in
in one of three ways:

| Route | When it applies |
| --- | --- |
| Check the plugin in the Chippy panel's settings | From the next page load; it reaches ATL's pre-page setup |
| Set `window.__CHIPPY_PLUGINS = ['jira', 'atl']` before the bundle loads | Console import and custom builds |
| Call `__AVALANCHE__.enablePlugins(['jira'])` | Immediately for Jira; for ATL, from the next Avalanche install |

`enableBuiltinPlugins()` in `src/plugins/index.ts` owns the list of built-in ids.
The standalone detector in `@atlassian/chippy/avalanche` does not include the
plugin list; a host registers the ATL adapter itself.

## Context providers

A context provider reads the probed fiber's ancestry and contributes to the
marker context that probes, the marker card, and `describeContext` report.

```ts
import type { ContextProvider } from '../layout-lab/marker-context';

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

Types and the registry live in `src/layout-lab/marker-context.ts`.

## Commit metrics adapters

An adapter wraps a host surface that counts renders, such as an instrumented
react-dom. The detector keeps capturing commits through DevTools; the adapter adds
counter deltas and the number of render passes React did not commit. Reports
name the source in `integrationMode`: `adapter:<id>`, or `devtools` without an
adapter.

Only one adapter is active. `registerCommitMetricsAdapter(adapter)` replaces the
earlier one and returns an unregister function; it applies to detectors installed
afterwards. The interface in `src/avalanche/commit-metrics-adapter.ts` documents
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

## Adding a plugin to the bundle

1. Put the plugin in `src/plugins/<name>/` with focused unit tests, following
   `src/plugins/jira/context-provider.test.ts` or
   `src/plugins/atl/commit-metrics-adapter.test.ts`.
2. Add it to `BUILTIN_PLUGINS` in `src/plugins/index.ts` to make it available to
   the opt-in routes above, and add a checkbox for it in
   `.agents/skills/chippy/extension/panel-settings.js`.
3. Rebuild the shipped bundles with `yarn avalanche:sync` and the skill archive
   with `yarn chippy:zip`.
4. If the plugin changes what agents see, such as a new boundary kind, document it
   in the skill's references.
