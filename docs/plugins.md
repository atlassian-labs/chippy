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
- `label(fiber, kind)` returns the application's own name for a fiber, or null.
  `kind` is the core classification: `suspense`, `error` (a class with error
  lifecycles), or `component`. Page scripts read it as `ref.label`, and the
  overlay uses it as the default box label. The first provider with an answer
  wins.
- Registering the same `id` again replaces the earlier provider. A provider that
  throws is skipped, so it cannot break inspection.

Register a provider from the bundle, or from the page at runtime:

```js
__AVALANCHE__.layoutLab.registerContextProvider(featureGateProvider);
```

To register a whole plugin at runtime, call
`__AVALANCHE__.registerPlugin({ id, label, contextProvider, commitMetricsAdapter })`.
It runs once its id is enabled, replaces an earlier plugin with the same id, and
returns an unregister function.

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
  `getComponentName(fiber)` and `isComponentFiber(fiber.tag)` from
  `@atlassian/chippy/plugin` name and classify fibers the same way the detector
  does when an adapter builds hook ancestry.

With the npm library:

```ts
import { atlCommitMetricsAdapter, registerCommitMetricsAdapter } from '@atlassian/chippy/avalanche';

registerCommitMetricsAdapter(atlCommitMetricsAdapter);
```

## Packs

A pack adds product knowledge as data, not code: one JSON document that a
product team keeps and shares itself, then loads into an installed Chippy.
Chippy ships no product packs. A pack has these parts, all optional except `id`:

| Field | Becomes |
| --- | --- |
| `id`, `label` | The plugin id and its label. A pack whose id matches a built-in plugin replaces it. |
| `instructions` | Markdown for agents on how to read the pack's data. It appears in `status().packs` and in every report the pack contributes to. |
| `components` | Component rules compiled into a context provider. |
| `labels` | How the application names its boundaries, read by page scripts as `ref.label`. |
| `avalancheExtensions` | Named extensions, such as `{ "counters": { ... } }`. Each has its own optional `instructions`, an `onInit` script run once when the pack loads, and `onStart`, `onStep`, and `onEnd` script bodies run with each Avalanche recording. |

```json
{
  "id": "regions",
  "instructions": "A `region` boundary names the owning area; `teamName` is its owner. `hooks[\"regions.counters\"].steps[commitId]` is the change in `window.__APP_COUNTERS` during that commit.",
  "components": [
    {
      "kind": "region",
      "accent": "#0c66e4",
      "match": { "names": ["RegionMark"], "pattern": "^Region___" },
      "nameParts": { "separator": "___", "keys": ["marker", "name", "package"] },
      "title": ["parts.name", "props.name", "name"],
      "data": { "name": ["parts.name", "props.name"], "teamName": "props.teamName" },
      "fields": [{ "label": "team", "value": "props.teamName" }]
    },
    {
      "kind": "error",
      "match": { "names": ["AppErrorBoundary"] },
      "data": { "id": "props.id", "teamName": "props.teamName" }
    }
  ],
  "avalancheExtensions": {
    "counters": {
      "onInit": "window.__APP_COUNTERS = window.__APP_COUNTERS || {};",
      "onStart": "ctx.state.last = Object.assign({}, window.__APP_COUNTERS);",
      "onStep": "var m = window.__APP_COUNTERS || {}, d = {}; for (var k in m) if (m[k] !== ctx.state.last[k]) d[k] = m[k] - (ctx.state.last[k] || 0); ctx.state.last = Object.assign({}, m); return d;"
    }
  }
}
```

**Component rules.** Each rule matches the nearest component in the probed
ancestry by exact `names` or a `pattern` regular expression. A rule of a new
`kind` becomes that kind's boundary, with `distance`, `componentName`, and its
`data`. A rule of kind `error` adds its `data` to the core error boundary
instead; `showError` asks the probe card to show the error boundary. Values are
references, or lists of references tried in order until one is non-empty:
`name` (the display name), `props.<key>` (a scalar prop), or `parts.<key>` (a
segment of the display name split by `nameParts`).

**Label rules.** A boundary's fiber name is often generic (`Suspense`) or
minified, while the application names it elsewhere: in a prop, or in a marker
component next to it. Each `labels` rule names the fibers of one kind (`for`:
`suspense`, `error`, or a kind from `components`) with a value reference read
from the fiber itself (`from: "self"`, the default), or from the nearest
component within `within` named components above it (`parents`) or below it
(`children`) whose display name matches `match`. `within` defaults to 3 and is
at most 10. Rules for one kind are tried in order, and the first non-empty value
wins. `note` explains the convention to people reading the pack; Chippy ignores
it.

```json
"labels": [
  { "for": "suspense", "from": "parents", "match": { "names": ["LazySection"] }, "value": "props.name",
    "note": "LazySection wraps every lazy Suspense and names the section." },
  { "for": "error", "value": ["props.id", "props.name"] },
  { "for": "region", "nameParts": { "separator": "___", "keys": ["marker", "name"] }, "value": "parts.name" }
]
```

The built-in Jira plugin carries its rules in the same form
(`src/plugins/jira/labels.ts`), so a Jira pack that replaces it can copy them.

**Initializing the page.** A pack must not expect the globals it reads to
exist; `onInit` creates them. It runs once when the pack registers, with
`ctx = { id }` (the extension's report key), before any recording. A pack loaded from the extension settings
or the startup config registers before the page's own scripts run, so `onInit`
can create a slot an instrumented renderer must find while it evaluates. A pack
loaded later with `registerPack` initializes too late for that; reload the page.
Write `onInit` to be idempotent, because the bundle can evaluate twice on one
page, and to leave a global the host already owns alone. A throwing `onInit`
is reported in `status().packs[].initErrors` as `"<report key>: <error>"`; the
pack still loads.

**Avalanche extensions.** Each extension is separate: it has its own `ctx.state`,
errors, and report entry under `hooks["<pack id>.<extension name>"]`, so one pack
can combine, for example, a counter reader and a slot initializer. Extension
names match `/^[a-z][a-z0-9-]*$/`. An extension without `instructions` carries the
pack's. Each recording script is a function body called with `ctx`:
`ctx.state` lasts for one recording, `ctx.commits` counts captured commits, and
in `onStep`, `ctx.commit` holds `{ id, components, startTime, endTime, root }`.
Return values become report evidence under the extension's key: `start`,
`steps[commitId]`, and `end`, next to its `instructions`. Agents read them
without the full export: `avalanche-status` returns each extension's `start`,
`end`, and errors under `hooks`, and `avalanche-commit-peek` returns one
commit's step results in its `hooks` slice. A throwing
script is recorded in `errors` and never stops capture; an `onStep` that fails
20 times stops for the rest of the recording. Scripts compile with
`new Function`, so a page whose Content Security Policy forbids `unsafe-eval`
reports the compile error in `status().packs[].compileErrors` and from each phase.

**Loading packs.**

| Route | When it applies |
| --- | --- |
| Paste into **Packs** in the Chippy panel's settings | From the next page load. The panel keeps several packs; switch each on or off, and only the active ones load. |
| Set `window.__CHIPPY_PACKS = [pack]` before the bundle loads | Console import and custom builds |
| `__CHIPPY_STARTUP_CONFIG.packs` | Hosts that write the startup config |
| `__AVALANCHE__.registerPack(pack)`, `unregisterPack(id)`, `listPacks()` | Immediately, for the current page only. A pack loaded during a recording steps from the next commit without running `onStart`; reset the recording for a full run. |

Packs loaded at startup that fail validation are listed in
`window.__CHIPPY_PACK_RESULTS__`. A pack runs page script on every origin where
Chippy is enabled, so load only packs you trust. The page cannot write packs
into the extension's storage.

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

Run `npx @atlassian/chippy pack` (or `pack --config <file>` for another config
path) with `esbuild` installed in the same project and `zip` on the `PATH`.
Paths resolve against the config file's directory; `outDir` defaults to
`chippy-build`. Plugin ids must match `/^[a-z][a-z0-9-]*$/`, be unique, and not
reuse `jira` or `atl`; the config's `id` and `label` (default: the id) replace
the module's own. `extension` also accepts `description`. Unknown keys fail the
build, and the packer refuses to replace an `outDir/chippy` that is not a Chippy
skill. The command writes:

- `chippy-build/chippy/`, the skill with its extension in `extension/`;
- `chippy-build/chippy-skill.zip` and `chippy-build/chippy-extension.zip`.

The packer appends the bundled plugins to the runtime bundle, so the extension,
the helper-served console import, and Playwright sessions all load them, and
registration happens before the ATL pre-page hook runs. It adds the plugins to
the panel's settings and makes `defaultPlugins` the extension's initial
selection. To update, bump `@atlassian/chippy` and pack again.
