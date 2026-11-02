# Avalanche detector

Avalanche works with standard React DOM. Install the DevTools hook before React
evaluates so the renderer registers and sends commit callbacks. A commit
metrics adapter can add host-supplied counters; the shipped bundle registers
the built-in ATL adapter for Atlassian's patched `react-dom`. Its metrics slot
may be seeded on an unpatched page: DevTools remains the capture owner until an
adapter commit callback actually fires. Adapter callbacks then provide
additional counters and own capture without a duplicate DevTools report,
whether the adapter callback arrives before or after DevTools. An
empty metrics object cannot establish that a patched host is active.


Avalanche is a React commit profiler injected alongside Chippy. It records sources, collateral renders, context waves, hook churn, and restart-heavy commits.

Works on any React product. Operates in two modes; the mode is observed at runtime, not declared:

- **`adapter:<id>`** — A registered commit metrics adapter drives commits. With the built-in ATL adapter (`adapter:atl`), patched `react-dom` (Atlassian products) drives `window.__ATL_REACT_METRICS`. Full fidelity: per-commit fiber walk **plus** render-counter delta math (restart counts, adapter counters, `metricsByCommit`). `report.meta.metricsAdapter` names the adapter. Captures from earlier releases report `atl` for `adapter:atl`.
- **`devtools`** — Any other React product. The detector chains into `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` (defining the hook if absent, augmenting if present). Per-commit fiber walk is fully reconstructed; render-counter delta math is **unavailable** (no patch to read counters from).

Mode promotes from `devtools` → `adapter:<id>` the first time the adapter's commit callback (for ATL, `__ATL_REACT_METRICS.onCommitFiberRoot`) is actually invoked, never the other direction. Confirmed via `report.meta.integrationMode`.

## What's available per mode

`recordTree()` runs identically in both modes — the React fiber tree is the same. Per-commit metrics that come from the fiber walk are real measurements in both modes:

| `commitStats[N]` index | Field | `adapter:<id>` | `devtools` |
|---|---|---|---|
| 0 | `collateral` | ✅ | ✅ |
| 1 | `sources` | ✅ | ✅ |
| 2 | `restarts` | ✅ real | ⚠ always 0 — semantically "unknown" |
| 3 | `performedWork` | ✅ | ✅ |
| 4 | `effects` | ✅ | ✅ |
| 5 | `memos` | ✅ | ✅ |
| 6 | `callbacks` | ✅ | ✅ |
| 7 | `contextUpdates` | ✅ | ✅ |
| 8 | `unmountedComponents` | ✅ | ✅ |
| 9 | `unmountedSubtrees` | ✅ | ✅ |
| — | `metricsByCommit` (deprecated alias `atlByCommit`) | ✅ present | ❌ omitted |

To disambiguate "zero restarts measured" from "restarts not measurable in this mode", consult `report.meta.dataAvailability.restarts` (and `.metricsByCommit`). When `false`, treat that field as missing data, not as a real zero.

Implication for analysis: source detection, blast radius, hook ancestry, hot-source attribution, amplifier discovery, context churn — **all work in both modes**. Restart-waste attribution requires an adapter mode such as `adapter:atl`.
Does not require: React DevTools UI, Profiler tab, or manual recording.

Cross-link: use [fixing-performance](fixing-performance.md) when deciding whether the fix belongs above the source, at the boundary, or below it.

## When to use

- lag, jank, or "everything re-rendered"
- probe shows suspicious hook count but cause is unclear
- before/after a performance fix
- commit-by-commit diff on a saved capture

## How capture works

Avalanche is mid-flight. Start from a live page, reload or interact, then read the capture.

Basic loop:
1. get `clientId`
2. arm reload if you need page-load commits
3. interact or reload
4. read `status`, `hot-sources`, `commit-list`, `commit-peek`
5. save export if you need repeated analysis

First captured commit has no prior snapshot. Treat commit `2+` as stronger signal.

## Commands

### Runtime performance happy path

For a live interaction investigation, run these as **separate commands**. Do not combine hot sources, commit list, and commit peek in one shell command on real captures; output can truncate and hide the useful slice.

```bash
chippy.sh avalanche-arm my-client http://localhost:9000
# user performs the slow interaction
chippy.sh avalanche-status my-client
chippy.sh avalanche-commit-list my-client 15 collateral
chippy.sh avalanche-commit-peek my-client 42 stats,sources,metrics 6 40
```

Use `reload-with-avalanche` only for initial-load profiling. Runtime performance uses `avalanche-arm`, then the user/harness interacts, then read status/list/peek.

### `avalanche-status <clientId>`
```bash
chippy.sh avalanche-status my-client
```
Look for `installed`, `hasMetricsGlobal`, `commitCount`.

### `reload-with-avalanche <clientId> <origin> [maxCommits] [timeoutMs] [settleMs]`
```bash
chippy.sh reload-with-avalanche my-client http://localhost:9000 0 15000 5000
```
Arms, reloads, waits for reconnect, waits settle window, then prints capture status.

### `avalanche-hot-sources <clientId> [limit]`
```bash
chippy.sh avalanche-hot-sources my-client 20
```
Top sources by collateral damage. Start here for a quick overview, but use `commit-list` + `commit-peek` for commit-level reasoning.

### `avalanche-commit-list <clientId> [top] [by]`
```bash
chippy.sh avalanche-commit-list my-client 15 collateral
chippy.sh avalanche-commit-list my-client 15 contextUpdates
```
Ranks commits. Rows are intentionally compact. If an event/action breadcrumb is linked to the commit, `latestAction` is clue-only: action name, delta from previous commit, DOM tag/text/test id, target fiber name, `ownerStackKind`, closest 10 owner/parent names, and full stack count. Do not treat `commit-list` as the full event dump.

Valid live sort keys:
```text
collateral sources restarts performedWork effects memos callbacks contextUpdates unmountedComponents unmountedSubtrees
```

Do **not** use undocumented keys like `byDuration`. The live bridge rejects unsupported keys and returns `ok:false` with `validBy`. Offline analysis has a different, richer derived-key set; do not mix live and offline sort keys.

### `avalanche-commit-peek <clientId> <commitId> [include] [depth] [maxItems]`
```bash
chippy.sh avalanche-commit-peek my-client 42 stats,sources,metrics 3 20
chippy.sh avalanche-commit-peek my-client 42 stats,sources,actions 3 20
chippy.sh avalanche-commit-peek my-client 42 stats,rendered 3 20
```
Pull one commit across slices. Use `include` CSV to limit payload. `actions` returns full event breadcrumbs attached to this commit. `rendered` returns bounded structural evidence for components that rendered in the commit, including parent/source ids, shallow prop-change facts, self-source flag, and linked trasher counts.

Effective live include values:
```text
stats,sources,timing,metrics,unmounts,actions,rendered
```

`atl` is a deprecated alias of `metrics`; it returns the same slice under `atl`.

`unmounts` returns bounded branch-start samples for this one commit. It is a zoom-in surface, not a full export: use `commit-list ... unmountedComponents` / `unmountedSubtrees` for counts first, then `commit-peek N ... unmounts` to ask where teardown started and how large each sampled branch was.

The wrapper accepts CSV strings, but the current live in-page bridge only emits the upstream-shaped slices above. `collaterals`, `context`, and `amplifiers` are useful for offline saved-capture analysis when those arrays exist in the saved payload; they are not reliable live slices.

`all` is **not** a supported include value. The live bridge rejects unsupported includes and returns `ok:false` with `validInclude`. Omit `include` for the default live slice set, or pass an explicit CSV like `stats,sources,metrics` or `stats,unmounts`.

### `avalanche-describe-action <clientId> <actionId>`
```bash
chippy.sh avalanche-describe-action my-client 7
```
Looks up one recorded event/action breadcrumb by id and returns the full payload. Use this after `commit-list` surfaces a useful `latestAction` id. Full payload includes DOM target, nearest test id, target fiber, and complete locality stack. In dev builds the stack is `ownerStackKind: "owners"`; in production bundles owners may be unavailable, so it falls back to `ownerStackKind: "parents"` using the React return chain. This is probe-like grounding for a click/key/input: DOM target + nearest meaningful fiber + locality stack.

### `avalanche-export <clientId> [lastN]`
```bash
chippy.sh avalanche-export my-client
```
Full JSON export from live page. Large output is easy to truncate in the shell; prefer `avalanche-save` when the export will be inspected more than once.

### `avalanche-save <clientId> <path> [count]`
```bash
chippy.sh avalanche-save my-client .chippy-captures/raf-1846.json
chippy.sh avalanche-save my-client .chippy-captures/last-50.json 50
```
Save once. Analyze offline many times. `count=0` or omitted saves the full export; `count=N` saves the last N commits.

Expected success response:
```json
{"ok":true,"file":".chippy-captures/raf-1846.json","bytes":12345,"commits":67}
```

Common failure:
```text
avalanche-analyze: response has no Avalanche export (expected meta and commitStats); check avalanche-status
```

No file is written. Re-check `avalanche-status` first: `installed`, `hasMetricsGlobal`, and `commitCount` should show a real capture. If status is empty, arm/reload correctly and capture again before saving. With `count=N`, per-commit data keeps the last N commits; aggregate `sources` totals still cover the whole capture.

### `avalanche-offline <path> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search> ...`
```bash
chippy.sh avalanche-offline .chippy-captures/raf-1846.json summary
chippy.sh avalanche-offline .chippy-captures/raf-1846.json commit-list 10 collateral
chippy.sh avalanche-offline .chippy-captures/raf-1846.json commit-peek 42 stats,sources,rendered 20
chippy.sh avalanche-offline .chippy-captures/raf-1846.json source-search --name 'Issue(Row|List)'
```
Use saved captures without a live page. `commit-list`, `commit-peek`, `hot-sources`, and `describe-action` run the same code as the live commands and return the same shapes, so sort keys and include values match the live tables above (`unmounts` is live-only).

`summary` returns commit count, first/last commit id, source count, and totals of the commit stats. `source-search --name <regex>` matches aggregate sources by `sourceId` and, for `detectionMode=full` captures, rendered components by name with per-instance render and self-source counts.

### `avalanche-arm <clientId> <origin> [maxCommits]`
```bash
chippy.sh avalanche-arm my-client http://localhost:9000 200
```
Arm runtime capture on this origin without reloading.

### `avalanche-disarm <clientId> <origin>`
```bash
chippy.sh avalanche-disarm my-client http://localhost:9000
```
Cancel armed reload capture.

### `page-reload <clientId>` / `page-wait-reload <clientId> [timeoutMs]`
```bash
chippy.sh page-reload my-client
chippy.sh page-wait-reload my-client 15000
```
Low-level reload helpers. Use when debugging injection timing.

## Event/action breadcrumbs

Avalanche records bounded browser event breadcrumbs while armed. Defaults are explicit user actions only: click, keydown, keyup, input, change, submit. Noisy streams such as wheel/scroll/move are opt-in via detector options (`interactionCapture: 'noisy' | 'all'`) or explicit `interactionEvents`.

Breadcrumb linking is intentionally minimal: action id, action name, last commit id, delta time, DOM target, nearest test id, target fiber, and locality stack. The agent reconstructs deeper source context on demand.

Read order:
1. `avalanche-commit-list` — compact latestAction clues only.
2. `avalanche-describe-action <id>` — full event breadcrumb by id.
3. `avalanche-commit-peek <commitId> ... actions` — all actions attached to one commit.

For locality: dev builds use `ownerStackKind: "owners"`; production/minified builds fall back to `ownerStackKind: "parents"`. Compact views keep the closest 10 names from the target-local side plus the full count. Full views may be large; inspect only when needed.

## Observability design principle

When a capture cannot answer the question, improve observability deliberately:

- add the smallest first-class, bounded, tested surface that answers the missing question
- keep broad tools broad and detail tools detailed: `commit-list` ranks counts, `commit-peek` zooms into one commit, `export` stays lean
- do not widen default payloads or dump raw trees because one investigation needed detail
- preserve tool shape: one include/query should answer one question (`stats`, `sources`, `metrics`, `unmounts`)
- write a focused test for the new observable before trusting live output

## Report shape

Start with these fields:
- `meta` — capture metadata; `meta.commits` is total processed commits
- `sources` — aggregated hot sources across window
- `sourcesByCommit[N]` — sources for commit `N`
- `commitStats[N]` — fixed tuple for commit `N`
- `metricsByCommit[N]` — low-level adapter metrics for commit `N` (deprecated alias `atlByCommit`)
- `restartWasteByCommit[N]` — restart-heavy source attribution for commit `N`

`commitStats[N]` tuple:
```text
[0] collateral
[1] sources
[2] restarts
[3] performedWork
[4] effects
[5] memos
[6] callbacks
[7] contextUpdates
[8] unmountedComponents
[9] unmountedSubtrees
```

Unmount reading:
- `unmountedComponents` = total component fibers torn down in that commit
- `unmountedSubtrees` = branch starts of teardown, useful for naming where the unmount begins
- high `unmountedComponents` with low `unmountedSubtrees` = one large branch removed
- high `unmountedSubtrees` = multiple branch starts; suspect conditional replacement, key churn, route/layout swap, or broad tree replacement
- `commit-peek N stats,unmounts` returns bounded branch-start samples for commit `N`; samples are triage anchors, not an exhaustive list of removed components
- branch samples include `name`, `source`, `depth`, `count`, and a `host` summary derived from DOM-rendering fibers when present in the branch: `elements`, `text`, `tagsTop`, `testIdsTop`, `rolesTop`, `ariaLabels`, `textHints`
- For user asks like `DOM unmounts`, `real DOM teardown`, `regions`, or `where was removed`, answer DOM-first: root family count, largest branch counts, `testIdsTop`, `rolesTop`, `tagsTop`, `ariaLabels`, and `textHints` before component/provider labels.
- host summary provides spatial evidence from fibers only. Do not use MutationObserver, DOM monkeypatching, or geometry for default Avalanche unmount reads; those surfaces are noisier, easier to perturb, and belong only in explicit debug instrumentation.
- Read unmount samples as **where teardown started and how much was removed**. Component names label the branch root; they are secondary to branch position and host/testid/text hints.

Suspense reading:
- `suspenseByCommit[N]` records boundary transitions for commit `N`
- `entered=true` = boundary entered fallback
- `left=true` = boundary revealed primary content
- boundaries that render without delay are intentionally silent — no `suspenseByCommit` entry means no fallback transition recorded, not "nothing happened"
- treat the boundary as branch metadata first; trace below it before blaming placeholder wrappers

## `renderedByCommit` — per-component render evidence

Populated when the detector is armed with `detectionMode: 'full'`. Empty under `detectionMode: 'sources'` or `'stats'`. Pulled into `commit-peek` output via `include=rendered`.

Top-level shape (`?` = optional, may be absent or `null`; everything else is required):

```text
renderedByCommit: Record<commitId: number, RenderedComponentEvidence[]>

RenderedComponentEvidence = {
  sourceId:        number,                     // joins to sourcesByCommit / hot-sources
  name:            string,                     // component display name; "Unknown" if unresolved
  parentId:        number | null,              // sourceId of nearest rendered parent (root = null)
  isSelfSource:    boolean,                    // true if the component re-rendered itself
  propChanges:     PropChangeEvidence[],       // [] when no diff (not absent)
  trasherCounts:   { effects: number; callbacks: number; memos: number },
                                               // all three always present; 0 when no amplifier hits
  trashers?:       TrasherEvidence[],          // bounded samples for non-zero trasherCounts
  selfTime?:       number,                     // ms; only when Profiler timing available
  actualDuration?: number                      // ms; only when Profiler timing available
}
```

`PropChangeEvidence`:

```text
PropChangeEvidence = {
  name:    string,                             // prop key
  kind:    'added' | 'removed' | 'scalar-changed' | 'ref-changed' | 'unchanged',
  prev?:   PropValueSummary,                   // present when kind ∈ {removed, scalar-changed, ref-changed, unchanged}
  current?: PropValueSummary                   // present when kind ∈ {added, scalar-changed, ref-changed, unchanged}
}
```

`PropValueSummary` (bounded — no deep clone):

```text
PropValueSummary = {
  type:     'string'|'number'|'boolean'|'null'|'undefined'|'function'|'array'|'object'|'symbol'|'bigint',
  preview:  string,                            // human-readable summary; always present
  length?:  number,                            // arrays + strings
  keysTop?: string[],                          // objects: up to N top-level keys
  sample?:  unknown                            // arrays: bounded element sample
}
```

`TrasherEvidence` (bounded — samples the changed hook deps, not every occurrence):

```text
TrasherEvidence = {
  hookIndex:          number,
  hookType:           'effect' | 'callback' | 'memo',
  effectTag?:         number,
  changedDepIndices:  number[],
  changedDeps:        Array<{
    index:   number,
    prev:    PropValueSummary,
    current: PropValueSummary,
    origin:  { type: unknown; hookIndex: number; depth: number; hookType: string } | null
  }>
}
```

For effects, `changedDeps` is the first stop: it names the dependency index and bounded prev/current summaries that caused the effect to re-run.

Cross-reference: the producer is `src/avalanche/detector.tsx` (`diffProps`, `summarizePropValue`, `detectHookThrashing`); the DTO mapper is `src/avalanche/report-serializer.tsx` (`RenderedComponentEvidenceDTO`).

### Reading `trasherCounts`

`trasherCounts` reports how many amplifier observations (`effects`, `callbacks`, `memos`) the detector attributed to this component in this commit. **Non-zero means the component fired an effect/callback/memo whose dependency identity changed.** This is the routed signal for the "trasher" verdict in P-06.

Reading rules:
- `trasherCounts.effects > 0` — at least one `useEffect` re-ran from changed deps.
- `trasherCounts.callbacks > 0` — at least one `useCallback` produced a new function identity.
- `trasherCounts.memos > 0` — at least one `useMemo` recomputed.
- All three zero in `renderedByCommit` while the component still appears in `sourcesByCommit` → render trigger is *not* amplifier-driven; look at `propChanges` for ref-changed props from above, or treat as self-update (`isSelfSource: true`).
- Same `sourceId` appears in `renderedByCommit` across many commits with persistent non-zero `trasherCounts` → confirmed trasher; trace the hook with `avalanche-debug-hook <clientId> <sourceId> <hookIndex>`.

### Reading `propChanges`

`propChanges` lists only the props that differed between prev and current. An empty array means the parent passed the same prop identities — re-render trigger is internal (state/context/store/parent re-render of a non-memoized child).

Reading rules:
- `kind: 'ref-changed'` on a callback or object prop → likely upstream amplifier; trace the parent's `useCallback`/`useMemo` deps.
- `kind: 'scalar-changed'` → data actually changed; the render is justified if the component should react to that value.
- `kind: 'added'` / `'removed'` on optional props → parent toggled a feature; verify the toggle is intentional.
- All props `unchanged` but component re-rendered → ancestor cascade. Look up the parent chain, not at this component.

### `renderedByCommit` prop-change taxonomy — read the simple case first

`renderedByCommit` is not a "why-did-you-render for three tricks". It is a per-commit prop-diff ledger. Read every rendered entry in this order:

| # | Signal | What it means | Typical classification | Fix layer / next step |
|---|---|---|---|---|
| 0 | `isSelfSource: true` | This component scheduled work for itself in this commit. | **self-source** | Inspect this component's changed hooks / callbacks / effects (P-07). |
| 1 | only `scalar-changed` props | Data actually changed (`number`, `string`, `boolean`, `null`). | **legitimate re-render** unless invariant says the scalar should not affect this child. | Verify invariant. If legitimate, stop; if not, move the scalar boundary up. |
| 2 | `added` / `removed` optional props | Parent toggled a feature or branch. | **conditional prop / branch change** | Verify the toggle is intentional; inspect the parent conditional if unexpected. |
| 3 | no prop changes and `isSelfSource: false` | Parent/ancestor rendered and this component came along. | **cascade collateral** | Walk to `parentId`; do not blame this component. |
| 4 | `ref-changed` function prop | Callback identity changed. | **identity churn** or legitimate callback update. | Walk to parent; inspect `useCallback` deps or inline function creation. |
| 5 | `ref-changed` object/array prop | Object identity changed. Contents may still be equal. | **identity leak** or legitimate data object change. | Walk to parent; inspect literal creation, selectors, `useMemo`, data normalization. |
| 6 | `ref-changed` `children` | JSX children identity changed. | **caller-created ReactElement churn** | Caller-only fix: hoist/memoize children at the caller. |
| 7 | any prop changes plus `trasherCounts > 0` | Prop churn and local hook churn are both present. | **mixed leak + amplifier** | Separate caller leak from local amplifier; prove both before editing. |

General rules:
- Start with the simple explanation. A `scalar-changed` prop is often correct behavior, not a performance bug.
- `ref-changed` means identity changed, not automatically "bad". It becomes a bug only when the component should not observe that identity change or when it defeats a memo boundary.
- If `trasherCounts` are all zero and the only suspicious signal is `ref-changed`, treat it as a **caller-side identity question** first. Walk to `parentId`; do not hunt for amplifier hooks in the child.
- If `propChanges` is empty and `isSelfSource` is false, this entry is collateral. Keep walking upward until the first self-source, context wave, or identity-changing parent.

#### Common identity fingerprints

These are common examples, not an exhaustive taxonomy:

| Pattern | Fingerprint | Reading | Caller-side remediation |
|---|---|---|---|
| Callback dep churn | `{ name: <callback>, kind: "ref-changed", prev.type: "function", current.type: "function" }` often with a scalar dep also `scalar-changed` in the same commit | `useCallback(fn, [dep])` is tied to a dep that changes during the same interaction. | Use a functional updater (`setX((v) => !v)`) to remove the dep, or otherwise stabilize the callback identity. |
| Array/object literal | `{ name: <prop>, kind: "ref-changed", prev.type: "object", current.type: "object" }` and source shows a literal or freshly allocated object | Parent recreates an equal-looking object each render; `React.memo` shallow compare fails. | Hoist literal to module scope, `useMemo(() => […], [])`, or pass a stable reference. |
| JSX children pass-through | `{ name: "children", kind: "ref-changed", prev.type: "object", current.type: "object" }` on a memoized parent | Inline JSX creates fresh `ReactElement` objects/arrays each parent render; the memoized parent cannot save itself. | Caller-only: hoist children into a stable variable or pass memoized element children. |

### Reading `propChanges` + `trasherCounts` together — the source classification table

| `isSelfSource` | `propChanges` has changes | `trasherCounts > 0` | Classification | Next step |
|---|---|---|---|---|
| `true` | n/a | n/a | **self-source** (component triggered its own re-render) | P-07 hook interrogation on this component |
| `false` | yes (ref-changed) | n/a | **collateral from upstream amplifier** | Walk to `parentId`, run P-06 on that |
| `false` | yes (scalar-changed only) | n/a | **legitimate re-render** (data changed) | Verify invariant — may be correct behavior |
| `false` | empty | yes | **trasher** (this component is the amplifier) | P-07 on the changed hook |
| `false` | empty | no | **pure cascade collateral** | Walk to `parentId`, look for the real trigger |

## Reading signals correctly

React metrics are **population statistics**. Avalanche is **commit evidence**.

Do not read raw counters as single-component causality. A counter like `componentRenderWithHooksCount: 800` means React executed 800 function-component render paths in the capture/commit window. It does not say which visible component was the root cause, whether every execution committed, or which prop/hook/context made one component render.

Use this hierarchy:

```text
population metrics → shape and scale
commit details      → what happened in one React commit
fiber/probe/source  → why a specific component participated
before/after diff   → whether the same waste disappeared
```

### Signal layers

| Layer | Examples | Answers | Does not answer |
|---|---|---|---|
| **Population metrics** | `componentRenderWithHooksCount`, `domWorkCount`, `contextUpdateCount`, `mountWorkCount` | How much React work happened overall | Why one component rendered |
| **Commit stats** | `commitStats[N]` | Shape of one commit: source count, collateral breadth, restarts, context/effect/memo/callback churn | Exact prop/hook cause |
| **Commit details** | `sourcesByCommit[N]`, `contextUpdatesByCommit[N]`, `restartWasteByCommit[N]` | Which sources/providers/restart signals were involved in that commit | Whether a downstream component could have bailed out |
| **Fiber/probe data** | owners, parents, props, hooks, source locations | How values crossed boundaries for a target component | Population scale |
| **Code** | hook deps, provider values, selectors, keys, memo boundaries | The implementation cause and fix layer | Runtime frequency without a capture |

### Read from broad to narrow

1. **Population shape.** Use raw React metrics to see whether the window is mostly render work, DOM work, mount work, context propagation, or discarded/restarted work.
2. **Commit selection.** Use live `commit-list` to pick the commit that best represents the suspicious upstream stat shape (`collateral`, `sources`, `restarts`, `performedWork`, `effects`, `memos`, `callbacks`, `contextUpdates`). Use offline `commit-list` for saved-capture derived keys like `amplifiers`, `repeats`, or `restartProxy`.
3. **Per-commit join.** Use `commit-peek` and read `commitStats[N]`, `sourcesByCommit[N]`, `metricsByCommit[N]`, and restart/context side channels together.
4. **Role classification.** Classify a component as source, hotspot, collateral, mount/remount, context/store participant, or restart/discarded work.
5. **Fiber trace.** Use probes to inspect owner/parent/prop/hook flow before naming a specific cause.
6. **Source trace.** Open the exact source location and verify hook deps, setter call sites, provider values, selector identity, keys, or memo boundaries.
7. **Diff.** Re-run the same capture window after one fix and compare the same signals.

### Population metric reading

| Metric | Correct reading | Common mistake |
|---|---|---|
| `componentRenderWithHooksCount` | Function-component render executions, including work that may not commit | Calling it visible re-render count |
| `finishClassComponentCount` | Class component render completions | Ignoring class work in total render executions |
| `componentRenderWithHooksCount + finishClassComponentCount` | Raw component render executions in the window | Treating it as root-cause count |
| `componentWorkCount` | Component-level fiber work | Assuming every unit changed DOM |
| `commitWorkCount` | Work that reached commit phase | Treating all render executions as committed |
| `domWorkCount` | Host DOM/text fiber work | Assuming component render noise changed the DOM |
| `mountWorkCount` / `componentMountWorkCount` | New fiber/component work; high during an interaction suggests remounting | Calling remounts normal re-renders |
| `updateWorkCount` / `componentUpdateWorkCount` | Existing fiber/component update work | Assuming updates explain why they happened |
| `contextUpdateCount` | Context provider value propagation count | Assuming all consumers changed meaningful data |
| `legacyContextUpdateCount` | Legacy context propagation | Treating it like modern context without checking class paths |
| `externalStoreRestartCount` | `useSyncExternalStore` restart signal | Optimizing collateral children first |
| `priorityInterruptedWorkCount` | Work abandoned due to higher-priority preemption | Calling it component churn |
| `renderRootSyncCount` / `renderRootConcurrentCount` | Root render passes by mode | Treating pass count as component count |
| `totalTickCount` / `ticksCount` | Scheduler/render ticks | Treating ticks as commits |

### Commit-stat reading

`commitStats[N]` is the shape of commit `N`:

| Field | Correct reading |
|---|---|
| `collateral` | Components that rendered without local source evidence; blast radius / victims |
| `sources` | Components Avalanche identified as update origins in that commit |
| `restarts` | Render executions discarded before commit; confirm with side fields |
| `performedWork` | Fibers React marked with performed work during commit |
| `effects` | Effect dependency churn/amplifier signal |
| `memos` | Memo dependency churn/amplifier signal |
| `callbacks` | Callback dependency churn/amplifier signal |
| `contextUpdates` | Context provider changes associated with the commit |

Pattern reads:

```text
high sources + high collateral
→ source started a broad wave

low sources + high collateral
→ likely propagation from parent/context/store or missing boundary

high contextUpdates + high collateral
→ provider wave; inspect value diff before assuming churn

high restarts with side fields
→ discarded work; do not optimize random collateral first

high mount work during interaction
→ remount problem: keys, conditional tree replacement, route/layout swap

high domWorkCount
→ host tree work happened; not just harmless component function calls
```

### Reconciliation checks

Use raw React metrics to check whether Avalanche classification explains the work:

```text
atlTotal = componentRenderWithHooksCount + finishClassComponentCount
classifiedTotal = commitStats[N].collateral + commitStats[N].sources
```

Read the gap:

```text
atlTotal ≈ classifiedTotal
→ Avalanche classification accounts for most component render work

atlTotal >> classifiedTotal
→ discarded/restarted work, unclassified work, or measurement mismatch; inspect restart side fields

componentMountWorkCount high while expecting update-only
→ remount, unstable keys, conditional subtree replacement, or component type churn

domWorkCount high
→ real host tree work; check DOM-changing props/list replacement/layout subtree
```

Do not call `atlTotal` "component X rendered N times". It is population data. Single-component wording requires commit details plus fiber/source evidence.

## Per-commit join

These slices share the same commit index `N`:
- `commitStats[N]`
- `sourcesByCommit[N]`
- `metricsByCommit[N]`
- `restartWasteByCommit[N]`
- `contextUpdatesByCommit[N]`

Use `commit-list` to pick a commit. Use `commit-peek` to inspect the same `N` across slices. Never compare `commitStats[42]` to `sourcesByCommit[43]` or a different capture window.

## Restart semantics

`restarts` = **discarded render executions**. React called the render function but threw away the result before commit.

Not "render cycles restarted". Not "component mounted and unmounted". A render ran, produced output, and that output was discarded.

Formula:
```text
atlTotal = componentRenderWithHooksCount + finishClassComponentCount
restarts = max(0, atlTotal - committedComponents)
```

Example: `atlTotal = 2116`, `committedComponents = 3` → `restarts = 2113` means 2113 render executions discarded in that commit window.

Treat it as a strong proxy, not a courtroom fact. Confirm cause with side fields:
- `externalStoreRestarts` — `useSyncExternalStore` races
- `priorityInterruptions` — higher-priority work preempted this render
- `fiberInterruptions` — interrupted fiber work without a cleaner subtype

Large `restarts` with zero side fields: still real, but needs more skepticism.
Large `restarts` with large `priorityInterruptions`: concurrent-mode priority thrash. Look for what triggers the high-priority interruption.

## Scoping a capture

Three tools:
- temporal: short reload window, short settle, low commit cap
- ranking: live `commit-list` by `collateral`, `restarts`, or `contextUpdates`; offline `commit-list` by derived keys like `restartProxy`, `amplifiers`, or `repeats`
- filtering: save export, then use `source-search` or offline `commit-peek`

Do not scope avalanche by selector. Scope by time window, commit, or component name (`source-search --name`). Exports carry no source file paths, so file-based scoping is not available.

## Commit inspection discipline — rebuild the crime scene

Do not chase the largest commit by default. A large commit can be inevitable: route content appears, a list legitimately receives new data, or a modal mounts real UI. Large means expensive; it does **not** mean causal or fixable.

For interactive Avalanche, rebuild the order of events:

```text
1. Pick a suspicious commit.
2. Inspect the commits before it: what changed that made this wave possible?
3. Inspect the suspicious commit: what work happened here, and which parts were necessary?
4. Inspect the commits after it: what continued, repeated, or became avoidable noise?
5. Decide whether the fix belongs in the past, the commit itself, or the future cleanup.
```

### Before / during / after read

| Window | Question | Tool read |
|---|---|---|
| **Before** | What earlier source/provider/store/key/identity change set up this wave? | `commit-list` around the target, `commit-peek` on N-1/N-2/N-3, sort by `sources` or `contextUpdates` |
| **During** | Which work in this commit was necessary vs collateral/noisy? | `commit-peek N stats,sources,metrics`, add `unmounts` when teardown counts are high, then probe/source for the top source, provider, or branch root |
| **After** | Did this wave stop, or did it leave repeating noise? | `commit-list` after N, sort by `collateral`, `restarts`, `effects`, `memos`, `callbacks`, or offline `repeats` |

### Two-direction 5 whys

Run both directions when a capture is messy.

**Step backward — why did this happen?**

```text
Why did this commit render?
→ because this source/provider/store changed
→ why did that source change?
→ why did the parent/store/effect produce that value?
→ why did no boundary prune it?
→ what earlier commit or setup made this inevitable?
```

**Step forward — why did this continue?**

```text
Why were there commits after the main wave?
→ because an effect/store/subscription/context update fired
→ why did it fire after the main commit?
→ why did the result still look new/noisy?
→ why did consumers fail to bail out?
→ which small repeated source would reduce noise and reveal the real signal?
```

### Reading rule

A useful Avalanche answer is not "commit 42 is largest". It is:

```text
commit 39 set up <source/provider/identity>
commit 42 performed necessary <mount/update> plus noisy <collateral/restarts>
commits 43-47 continued because <effect/store/context/identity>
therefore fix <earlier setup | boundary | later noise source>
```

## Thrash and memo reading

Look for:
- repeated source across many commits
- high collateral with low source count
- amplifiers: unstable `memo` / `callback` / `effect` deps
- context waves: repeated provider identity churn

Hook churn means the source changed. It does not mean the fix is inside that component.

## Confirming a fix

After a change:
- same interaction, same window
- lower `collateral`
- fewer repeated commits from same source
- fewer amplifiers or context waves
- hot source drops or remains but with lower blast radius

## Troubleshooting

- Manifest or extension script change: reload the extension.
- Bundle change: reload the page.
- Helper-server change: `chippy.sh stop` then `chippy.sh start`.
- `commitCount: 0` with installed detector: verify patched `react-dom` and reload path.
- Duplicate `__AVALANCHE__ already defined`: same bundle injected twice. Fix startup order before trusting results.
- On Jira-like pages, metrics may be reset during bootstrap/hydration. Chippy must preserve or restore the live metrics object before judging capture health.

## Working with subagents — paginated Avalanche analysis

Large captures can exceed one agent's useful working memory. Do not limit analysis to the main context when the capture naturally splits into waves, ranges, or questions. Use subagents as page workers over reduced slices.

### When to paginate

Use paginated subagent analysis when:
- the capture has 100+ commits or shell output truncates useful details
- the capture spans multiple interaction waves, async loading phases, or post-interaction cleanup
- one large commit is not enough to explain the page behavior
- before/during/after reasoning needs separate setup, main-wave, and noise analysis

Do **not** paginate when one `commit-peek` answers the question, or when adjacent commits are tightly coupled and splitting would hide causality. In that case, keep the before/during/after chain in the main context.

### Core rule

Partition by **question**, not by equal commit count.

Good slices:
```text
commits 0-30: what setup made the later wave inevitable?
commits 31-60: was the main wave necessary work or avoidable collateral?
commits 61-100: what repeated after the UI should have settled?
```

Bad slice:
```text
commits 0-50: analyze this
```

### Workflow

1. **Save once.**
   ```bash
   chippy.sh avalanche-save my-client .chippy-captures/run.json
   ```
2. **Build a top-level timeline in the main context.**
   ```bash
   chippy.sh avalanche-offline .chippy-captures/run.json summary
   chippy.sh avalanche-offline .chippy-captures/run.json commit-list 30 collateral
   chippy.sh avalanche-offline .chippy-captures/run.json commit-list 30 repeats
   chippy.sh avalanche-offline .chippy-captures/run.json commit-list 30 contextUpdates
   ```
3. **Choose ranges by wave/question.** Setup, main wave, continuation/noise, or first-principles invariant. `commit-list` ranks globally; use the ranked rows plus timestamps/commit ids to define ranges.
4. **Reduce each range before delegation.** Use `commit-peek` on selected commit ids and `source-search --name` for known components. Give the subagent only the top suspicious commits and relevant stats/sources/context/metrics slices. No raw exports.
5. **Ask one concrete question per subagent.**
6. **Collect compact findings.** Each subagent returns commit range, role, evidence, likely fix layer, confidence, and next gap.
7. **Join findings in the main context.** Rebuild the crime scene across slices: setup → main wave → continued noise. Ask whether slices share one earlier root cause before accepting fragmented fixes.

### Subagent prompt shape

```text
Analyze reduced Avalanche slice <commit range> from <saved capture path or pasted compact slice>.
Question: <one concrete question>.
Use population-vs-commit reading rules: raw React metrics are population stats; do not claim single-component causality without source/fiber evidence.
Return only:
- range and commits inspected
- role: setup | main wave | continuation | noise | unknown
- top source/provider/store/key/identity signal
- evidence from stats/sources/context/metrics
- likely fix layer: earlier setup | boundary | later noise source | no fix here
- confidence: confirmed | likely | partial
- next gap
Do not return raw payload.
```

### Example questions

```text
In commits 0-30, what earlier provider/store/key/identity setup made the later wave inevitable?
```

```text
In commits 31-60, is the largest commit mostly necessary mount/data work or avoidable collateral?
```

```text
In commits 61-100, which repeated source/provider/effect keeps firing after the interaction should have settled?
```

```text
Across this slice, do the repeated commits share one source, or are they independent noisy birds?
```

### Guardrails

- No concrete question, no subagent.
- No raw exports; reduce payload first.
- No "analyze this slice" prompts.
- Each slice must be joinable back to the global timeline.
- If a subagent finds local symptoms only, the main agent still asks: "what earlier commit made this possible?"
- If multiple slices point to the same provider/store/key/identity source, prefer one upstream fix over many local patches.
