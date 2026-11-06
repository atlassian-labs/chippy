# Browser runtime API

The injected bundle exposes `window.__CHIPPY` in the page. The APIs below are
nested capabilities on that public root.

## Connection state

- `window.__CHIPPY.connState` — `connected`, `reconnecting`, `failed`, or `yielded`. `yielded` means the extension bridge stood down because another integration (Storybook or a console import) owns the page.
- `window.__CHIPPY.standDown` — `{ at, owner }` after the extension bridge yields; read `chippy.sh pages` for the live owner.

## `window.__CHIPPY.inspectReact`

Fiber inspection helpers for React pages.

- `inspectNode(domNode)`
- `findByText(text, root?)` / `findBySelector(selector, root?)` — `root` defaults to `document`
- `inspectAtPoint(x, y)` — `[{ node, inspection }]` for every element at the point
- `getFiberFromNode(domNode)` / `getClosestFiber(domNode)` — the node's own fiber / nearest ancestor fiber
- `getNearestCompositeFiber(fiber)` — nearest component (non-host) fiber on the `return` path
- `describeFiber(fiber)`
- `getOwnerChain(fiber)` / `getReturnChain(fiber)`
- `getReactInternalKeys(domNode)`

## `window.__CHIPPY.layoutLab`

Probe overlay and state.

- `exposeDefaultMarkers()`
- `getMarkerProbe(id)`
- `getMarkerState(id)`
- `getAllMarkerStates()`
- `setMarkerAnnotation(id, { intent, comment })`
- `probePoint(x, y)`
- `clearAll()`
- `snapToDock(id)`
- `markerColors`

Important behavior:
- P1 is red, P2 is green
- extension-owned pages initially render one small bottom-corner Chippy launcher; expanding it reveals compact `P1 — drag to source` / `P2 — drag to source` rows that serve as each probe's dock and detail surface
- dragging a probe does not collapse the panel; an undocked probe uses document coordinates and stays anchored to its target while the page scrolls
- the extension toolbar popup contains only Enable and Disable for the current origin; helper and proxy configuration stay in the in-page panel
- extension-owned panels expose the helper URL and plugin settings behind the gear; the isolated content script mounts the form in a closed shadow root, with no iframe and no page access to extension storage
- Storybook host-panel mode keeps a standalone dock in the preview frame because probe details live in the manager frame
- docked probes are inactive
- drop a placed probe back on its row to dock it again; the header buttons collapse the panel to the launcher or move it to the other side of the viewport
- clicking a boundary card also highlights that boundary's DOM on the page and scrolls it into view
- saving the gear form reconnects the page to the new helper URL immediately
- while dragging:
  - ← / → walks DOM element levels (up/down the DOM tree)
  - ↑ / ↓ walks fiber parent chain (up/down React component tree)
- clicking an owner name in the panel jumps the probe to that owner's fiber
- active P1/P2 cards accept an intent (`explain`, `investigate`, or `change`) and a free-text comment; changing the intent stores both fields immediately, while Enter in the comment stores them and Shift+Enter inserts a newline
- probe/connection refreshes patch keyed panel nodes in place instead of replacing the panel subtree; existing probe rows, controls, focus, unsubmitted drafts, the settings slot, and its content-script-owned shadow host survive ordinary refreshes
- Context-provider cards (for example Jira ownership and error-boundary fields) are visible by default when recognized markers exist; `context-ui <clientId> on|off` changes that presentation for the current connected page
- probe highlights and parent borders are overlay-only, never DOM mutations

`getMarkerState(id)` and `getMarkerProbe(id)` always include `intent` (`"explain" | "investigate" | "change" | null`) and `comment` (`string`). `setMarkerAnnotation` patch-merges omitted fields, normalizes unsupported intents to `null`, caps comments at 2,000 characters, and emits `layout-lab:update` with reason `marker-annotation-change`.

## `window.__CHIPPY.pageBridge`

Bridge between the page and the helper.

The helper must be a real local process reachable by the user's browser. The agent — not the user — owns starting it: invoke `./scripts/chippy.sh start` using outside-sandbox / escalated execution. Do not start the helper inside the sandbox and assume the extension can see it; sandboxed Node servers and ports may be private to the sandbox. Every helper-contacting command must also run outside the sandbox, because they connect to the real `127.0.0.1:7823`. If connectivity is unclear, the agent runs `./scripts/chippy.sh start` (outside-sandbox) and verifies with `./scripts/chippy.sh pages`. Asking the user to open a terminal and run `chippy.sh` is a last-resort fallback only.

- `activate()`
- `deactivate()`
- `publishSnapshot(reason)`
- `setProbeAnnotation(probeId, { intent, comment })`
- `ensureProbes()`
- `clearProbes()`
- `showStatus(text)` / `hideStatus()` — compatibility no-ops; nothing renders in the page
- `getState()` — includes `integration: { kind, who, source, reinjectsOnReload, reloadAction }`
- `applyConfig({ helperBaseUrl, activated, integration?, contextUiEnabled? })`

`contextUiEnabled` defaults to `true`. It controls only context-provider cards in the active probe UI, including Storybook marker cards; generic probe resolution and snapshots continue when it is false.

Source reads are cross-version. React <=18 locations come from `_debugSource`; when the module the page loaded for that file carries a source map, its recorded literal is mapped back to correct lines shifted by an earlier transform. React 19 locations start at `_debugStack`, skip dependency frames, and resolve the served module through its inline or external Source Map v3 payload. Snapshot publication is immediate and may be followed by a `<reason>-source-resolved` snapshot when the authored position differs; `find-fibers`, `describe-component`, and `explain-component` await the mapped position.

`integration.kind` is `extension`, `import`, or `storybook`. It is `null` for proxy and Playwright-loaded pages. `who` names the host that established Chippy and `source` points to its real setup source file. Import integrations report `reinjectsOnReload: false`; a full reload/navigation requires the user or automation to run the import again.

## Storybook addon panels

Probes start hidden in Storybook. **Show probes** in the Chippy panel header (or `ensure-probes <clientId>`) places the P1/P2 dock in the preview, and **Hide probes** (or `clear-probes`) removes it. Selecting the **Avalanche** tab clears placed probes and installs capture. Avalanche history is cleared when the story changes, remounts (including `page-reload`), or hot-updates.

The Chippy panel presents probe targets rather than transport counters. While a probe is held in the preview, left/right walk DOM targets and up/down walk the React component chain.

For an active P1/P2 marker, the panel renders the same intent selector and comment field as the in-page panel. Changing the intent or pressing Enter in the comment sends one `set-probe-annotation` command into the preview; Shift+Enter inserts a newline. The resulting marker snapshot carries both fields through the helper in every slice mode. The helper also queues the resulting `marker-annotation-change` for an explicit `chippy.sh wait`; it does not wake an idle task or modify host lifecycle hooks.

When a placed probe resolves context from a registered provider (for example the Jira plugin's ownership and `JSErrorBoundary` fields), its marker card shows the available fields. Markers without such context render no context section and no empty placeholder. The bridge exposes this as `markers[id].context`; the field is `null` when no recognized context exists or `contextUiEnabled` is off.

The Avalanche panel installs and refreshes capture state while selected. It groups equivalent commit shapes, shows hot sources first, and keeps individual commits and connection diagnostics behind disclosures.

When either panel is `failed` or `reconnecting`, it may offer:

```bash
npx skills add atlassian-labs/chippy --skill chippy -g
```

That command installs the Chippy skill with the skills CLI when it is absent. It does not start or verify the helper; the agent still follows [troubleshooting](troubleshooting.md) and runs the helper checks.

## `window.__CHIPPY.resolveProbes` / `window.__CHIPPY.resolveProbesCompact`

Resolve one or more probes into DOM + React + source summaries.

- `window.__CHIPPY.resolveProbes('1', '2')` — full summary per probe id (`null` for an unplaced probe)
- `window.__CHIPPY.resolveProbesCompact('1', '2')` — compact summary per probe id

Compact results include:
- `confidence` and `note`
- `nearestTestId`
- `dom` — `tag`, `text`, `fiberType`, `source`, DOM `parents`, `matchedStyles`
- `component` — see below; non-dev builds also carry `componentStack`
- `__crossSourceHints` — present when the probes come from different build modes
- `__commonParent` — nearest component shared by both probes, when one exists

`component` includes:
- `propNames` — all prop keys (excluding `children`) on the probe component
- `hookCount` / `hookCountTruncated` / `hookCountMax` — hook-count complexity signal on the probe component
- `owners[N].propNames` — prop keys on each owner in the chain
- `owners[N].hookCount` / `hookCountTruncated` / `hookCountMax` — same complexity signal for each owner

Always surface `key` when present.

## `window.__AVALANCHE__`

Prefer the `avalanche-*` shell commands. Read the page global directly only when the helper cannot reach the page, for example right after a reload in [mode-a-injection](mode-a-injection.md).

- `status()` — `{ installed, hasMetricsGlobal, commitCount, integrationMode, metricsAdapter }`
- `exportLast(n?)` — same as `report()` with default arguments; `n` currently has no effect. Use `chippy.sh avalanche-save <clientId> <file> N` to keep only the last N commits
- `report(topN?, sortBy?)` — live report; `topN` defaults to 10 and `sortBy` is `effect` (default), `callback`, `memo`, or `total`
- `install(options?)`, `uninstall()`, `reset()` — with no options, non-development builds install `amplifiers` mode with `historySize: 1` and no fiber capture; `avalanche-install` sets its own options
- `enablePlugins(ids)`, `listPlugins()` — see [React compatibility](../SKILL.md#react-compatibility) in `SKILL.md`

Before `install`, `report`, `exportLast`, and `debugHook` return `{ ok: false, error: 'not installed' }`.

## Page-bridge request examples (sent from helper → page bridge)

These common probe, inspection, and stimulus requests run in-page and return results asynchronously via WebSocket. The [command surface](command-surface.md) is the complete public shell-command catalog.

### `eval-probe-dom`
```js
{ type: 'eval-probe-dom', requestId, probeId, parentLevel? }
```
Returns the selected DOM target's structure, attributes, text, source, styles, and nearest test-id boundary.

### `eval-probe-props`
```js
{ type: 'eval-probe-props', requestId, probeId, ownerIndex? }
```
Returns `{ name, ownerIndex, pod, nonPod, children }`. See `probe-props` in command-output-formats.md.

### `eval-probe-boundaries`
```js
{ type: 'eval-probe-boundaries', requestId, probeId, max? }
```
Returns every Error/Suspense boundary on the probe fiber's rendered parent path, ordered inner → outer. This is read-only and does not use debug replay.

### `page-boundaries`
```js
{ type: 'page-boundaries', requestId, max? }
```
Returns the current page's React roots pruned to a nested Error/Suspense-only forest. Each surviving node has a reusable `fiberId`, source and DOM summaries, boundary nesting distance, and Suspense status.

### `eval-prop-value`
```js
{ type: 'eval-prop-value', requestId, probeId, prop, ownerIndex? }
```
Returns `{ name, ownerIndex, prop, type, value }`.

### `eval-probe-hooks`
```js
{ type: 'eval-probe-hooks', requestId, probeId }
```
Returns `{ name, hookCount, truncated, maxHooks, hooks[] }`. See `probe-hooks` in command-output-formats.md.

### `eval-probe-hooks-summary`
```js
{ type: 'eval-probe-hooks-summary', requestId, probeId }
```
Returns the prepared compact hook summary documented under `probe-hooks-summary` in command-output-formats.md.

### `page-click`
```js
{ type: 'page-click', requestId, target: { selector? , probeId? , fiberId? } }
```
Active stimulus. Resolves exactly one target kind: CSS selector, probe DOM target, or remembered fiber DOM node. Selector clicks require a single match; ambiguous selectors refuse. Returns `{ ok, mode, target, selector, probeId, fiberId }`.

### `fiber-prop-contract`
```js
{ type: 'fiber-prop-contract', requestId, fiberId, propName }
```
Read-only inspection. Reads `memoizedProps[propName]` from the remembered fiber and returns callable-shape evidence: `fiberName`, `source`, `propNames`, `propType`, `isFunction`, `fnLength`, `fnName`, and `fnSourcePreview`. This command does not invoke the prop.

### `fiber-invoke`
```js
{ type: 'fiber-invoke', requestId, fiberId, propName, args? }
```
Active stimulus. Reads `memoizedProps[propName]` from the remembered fiber and invokes it if it is a function. Use only after `fiber-prop-contract` and source inspection prove the callback argument contract. Returns `{ ok, fiberId, fiberName, propName, propType, fnLength, invoked, args, async, returnValue }` or a refusal/throw/rejection payload.

### `fiber-schedule-update`

```
{ type: 'fiber-schedule-update', requestId, fiberId, ownerIndex? }
```

Forces one re-render on the resolved fiber via the DevTools renderer's `scheduleUpdate`. Response is an `eval-probe-result` carrying `{ ok, scheduled, fiberName, source, ownerIndex }` or `{ ok:false, reason }`.

Each request shown above responds with `{ type: 'eval-probe-result', clientId, requestId, result }` back to the helper.

## Runtime source maps

The helper serves `/__chippy/avalanche.iife.js.map` and
`/__chippy/avalanche.es.js.map` as source-map JSON for the corresponding runtime
bundles. These include authored sources and source content for browser developer
tools. They describe Chippy's runtime; they do not supply an inspected app's
source maps.
