# Avalanche detector

Avalanche works with standard React DOM. Install the DevTools hook before React
evaluates so the renderer registers and sends commit callbacks. A commit
metrics adapter, supplied by a plugin, can add host-supplied counters; the
shipped bundle includes none. An adapter's metrics slot may be seeded on an unpatched page: DevTools remains the capture owner until an
adapter commit callback actually fires. Adapter callbacks then provide
additional counters and own capture without a duplicate DevTools report,
whether the adapter callback arrives before or after DevTools. An
empty metrics object cannot establish that an instrumented host is active.


Avalanche is a React commit profiler injected alongside Chippy. It records sources, collateral renders, context waves, hook churn, and restart-heavy commits.

Works on any React product. Operates in two modes; the mode is observed at runtime, not declared:

- **`adapter:<id>`** — A registered commit metrics adapter drives commits from an instrumented `react-dom`. Full fidelity: per-commit fiber walk **plus** render-counter delta math (restart counts, adapter counters, `metricsByCommit`). `report.meta.metricsAdapter` names the adapter.
- **`devtools`** — Any other React product. The detector chains into `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` (defining the hook if absent, augmenting if present). Per-commit fiber walk is fully reconstructed; render-counter delta math is **unavailable** (no patch to read counters from).

Mode promotes from `devtools` → `adapter:<id>` the first time the adapter's commit callback is actually invoked, never the other direction. Confirmed via `report.meta.integrationMode`.

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
| — | `metricsByCommit` | ✅ present | ❌ omitted |

To disambiguate "zero restarts measured" from "restarts not measurable in this mode", consult `report.meta.dataAvailability.restarts` (and `.metricsByCommit`). When `false`, treat that field as missing data, not as a real zero.

Implication for analysis: source detection, blast radius, hook ancestry, hot-source attribution, amplifier discovery, context churn — **all work in both modes**. Restart-waste attribution requires an `adapter:<id>` mode.
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
chippy.sh avalanche-summary my-client
chippy.sh avalanche-commit-list my-client 15 collateral
chippy.sh avalanche-commit-peek my-client 42 stats,sources,metrics 6 40
```

Use `reload-with-avalanche` only for initial-load profiling. Runtime performance uses `avalanche-arm`, then the user/harness interacts, then read status/list/peek.

### `avalanche-status <clientId>`
```bash
chippy.sh avalanche-status my-client
```
Look for `installed`, `hasMetricsGlobal`, `commitCount`. `renderedEvidence` is `{ maxEntries, entries, commits, evicted }`: the capture holds at most `maxEntries` `renderedByCommit` entries (default 250,000). Past it, the oldest commits' rendered evidence is dropped and `evicted` is `{ commits, entries, throughCommit }`; their stats, sources, and timings stay. To keep a long interaction's rendered evidence whole, `avalanche-clear` before reproducing it, or save before `evicted` appears.

### `reload-with-avalanche <clientId> <origin> [maxCommits] [timeoutMs] [settleMs] [captureFibers] [detectionMode]`
```bash
chippy.sh reload-with-avalanche my-client http://localhost:9000 0 15000 5000
```
Arms, reloads, waits for reconnect, waits settle window, then prints `avalanche-status` and the top 12 hot sources. Defaults: `0 5000 3000 true sources`. It exits 1 when the page does not reconnect within `timeoutMs`, and it leaves the arm in place until `avalanche-disarm`. With the extension or proxy mode, the reloaded document installs Avalanche before React's first commit, so boot commits are included. The reload step's ack reports `earlyStartup`: `registered` (extension), `handoff-only` (no extension; proxy mode still captures boot), `not-armed`, or `storage-unavailable` (the page blocked `sessionStorage`, so boot commits may be missed).

### `avalanche-summary <clientId> [top] [maxItems]`
```bash
chippy.sh avalanche-summary my-client
chippy.sh avalanche-summary my-client 10 5
```
The first read of a capture, in one call. It answers what an analysis asks first, so read it before the narrower commands below. `payload` holds:

- `commits`, `firstCommitId`, `lastCommitId`, `sources` (aggregate source count), and `totals`, the commit stats summed over every commit.
- `timeline`: the `avalanche-timeline` payload of the last interaction without `lanes` or `mermaid`, or `{error}` when it cannot be built.
- `topCommits`: the `top` commits (default 5) with the most collateral, ties by id. Each has `stat`, `atMs` (from the timeline origin, the last interaction; negative for commits before it), `renderMs`, `ticks`, `paintDelayMs` (commit end to paint), `sourcesTotal`, `sources` (the first `maxItems`, default 3: `sourceId`, `collateralAtCommit`, and `changedHooks` with `index` and `sameContent`, true when the new value equals the old one by content), `latestAction`, and `hooks` (each pack hook's step for that commit). A missing timing is `null`, not 0.
- `hooks`: each pack hook's start, end, step count, and errors; `null` when no pack hooks ran.
- `perf`: the [`avalanche-perf`](#avalanche-perf-clientid-types-top-match-fromcommit-tocommit) `summary` over the whole capture; `null` when the report has no performance entries.
- `console`: the [`avalanche-console`](#avalanche-console-clientid-levels-top-match-fromcommit-tocommit) `summary` over the whole capture; `null` before report version 10.
- `meta`: the capture metadata.

Each top commit also has `rebuiltProps`, read from `renderedByCommit`, or `null` when no rendered entry has a key diff: `sameShallow`, `keysChanged`, and `notCompared` count the `ref-changed` object and array prop changes of each kind, and `groups` (the first `maxItems`, then `omittedGroups`) merges identical changes of one prop across components, by `components` received: `prop`, the first `component` and `sourceId` in render order, and `sameShallow: true` or `changedKeys` (key names) with `changedKeyCount`. A large group with `sameShallow: true` is one rebuilt object that rendered many components for nothing.

Each top commit also has `longFrame`: the long animation frame it ran in (`atMs`, `durationMs`, `blockingMs`) and every commit that started in that frame, or `null`.

`sameContent: true` on a changed hook means a new reference with equal content: identity churn. Drill down with `avalanche-commit-peek`, `avalanche-timeline`, or `avalanche-dom-diff`.

### `avalanche-hot-sources <clientId> [limit]`
```bash
chippy.sh avalanche-hot-sources my-client 20
```
Top sources by collateral damage. Start here for a quick overview, but use `commit-list` + `commit-peek` for commit-level reasoning.

Output: `total` sources and `payload.items[]` sorted by `collateralUpdates` (default limit 20). Each item has `sourceId` (`Name#n@depth`), `depth`, `causedUpdates`, `collateralUpdates` (total renders it caused), `maxCollateralUpdates` (largest single wave), `maxPenetrationDepth` (levels below the source), and `restartWaste` (adapter modes only).

### `avalanche-commit-list <clientId> [top] [by]`
```bash
chippy.sh avalanche-commit-list my-client 15 collateral
chippy.sh avalanche-commit-list my-client 15 contextUpdates
```
Ranks commits. Rows are intentionally compact. If an event/action breadcrumb is linked to the commit, `latestAction` is clue-only: action name, delta from previous commit, DOM tag/text/test id, target fiber name, `ownerStackKind`, closest 10 owner/parent names, and full stack count. Do not treat `commit-list` as the full event dump. Defaults: top 20, by `collateral`.

Valid sort keys (live and offline):
```text
collateral sources restarts performedWork effects memos callbacks contextUpdates unmountedComponents unmountedSubtrees ticks network
```

Each row also carries `ticks`, the render slices React ran for that commit (see [Render ticks](#render-ticks)). `by ticks` ranks time-sliced and repeated renders first; commits with unknown ticks (`null`) sort last. Each row also carries `network: {landedBefore, startedAfter, startedDuringRender}` request counts (see [`avalanche-network`](#avalanche-network-clientid-top-by-match-initiators-windowms)); `by network` ranks commits by `landedBefore`.

Do **not** use undocumented keys like `byDuration`. Live and offline `commit-list` accept the same keys and return `ok:false` with `validBy` for any other key. The live shell command still exits 0: the helper envelope is `ok:true`, and the rejection is in `result.ok:false`, `result.error`, and `result.validBy`, so read `result.ok` before reading rows.

### `avalanche-commit-peek <clientId> <commitId> [include] [depth] [maxItems]`
```bash
chippy.sh avalanche-commit-peek my-client 42 stats,sources,metrics 3 20
chippy.sh avalanche-commit-peek my-client 42 stats,sources,actions 3 20
chippy.sh avalanche-commit-peek my-client 42 stats,rendered 3 20
```
Pull one commit across slices. Use `include` CSV to limit payload. `actions` returns full event breadcrumbs attached to this commit. `rendered` returns bounded structural evidence for components that rendered in the commit, including parent/source ids, shallow prop-change facts, self-source flag, and linked trasher counts.

Defaults: include `stats,sources,timing,metrics,hooks`, maxItems 20 (MCP and HTTP default to 50). `depth` is accepted for compatibility and has no effect. `maxItems` bounds the `sources`, `actions`, `rendered`, `unmounts`, and `network` arrays; each of those slices also reports its untrimmed `...Total`.

`network` returns `{landedBefore, landedBeforeTotal, startedAfter, startedAfterTotal, startedDuringRender, startedDuringRenderTotal, inFlight}`: the requests whose response finished just before this commit's render started, the requests that started just after it ended, the requests that started while it rendered, and how many were in flight when it committed. Rows have the `avalanche-network` shape. The link window is 250 ms; pass `window` through MCP or HTTP to change it.

`hooks` returns each loaded pack extension's `onStep` result for this commit, keyed like `report.hooks` (`{"<pack>.<extension>": value}`); extensions with no result for the commit are absent, and the slice is absent when no pack ran. Read the pack's `instructions` in `avalanche-status` first. `avalanche-status` also carries `hooks`: each extension's `start`, `end`, `stepCount`, `errors`, `errorCount`, and `stepDisabled`, without the per-commit steps.

Valid include values (live and offline):
```text
stats,sources,timing,metrics,hooks,unmounts,actions,rendered,network,dom,perf
```

`dom` returns `dom`, the DOM changes this commit made (the `avalanche-dom-diff` change shape, cut to `maxItems`), and `domTotal`, their untrimmed count. `domTruncated: true` is added when the commit changed more nodes than were recorded. `domTotal` is 0 for a commit that changed nothing in the DOM.

`perf` returns `perf`, the browser performance entries near this commit (those whose span holds the commit's start, and those that started after it and before the next commit), longest first and cut to `maxItems`, in the `avalanche-perf` entry shape, and `perfTotal`, their untrimmed count.

`console` returns `console`, the page's console entries logged after this commit started and before the next commit, earliest first and cut to `maxItems`, in the `avalanche-console` entry shape, and `consoleTotal`, their untrimmed count.

`unmounts` returns bounded branch-start samples for this one commit. It is a zoom-in surface, not a full export: use `commit-list ... unmountedComponents` / `unmountedSubtrees` for counts first, then `commit-peek N ... unmounts` to ask where teardown started and how large each sampled branch was.

`sources` rows: `sourceId`, `depth`, `collateralAtCommit`, `rankAtCommit` (position among all sources ranked by total waste), `trashers` (`[{ index, prevValue, currentValue }]` for changed hooks when the detection mode records amplifiers; primitives are exact and long strings are cut, while objects and arrays are bounded copies two levels deep with up to 8 entries, and DOM nodes, React elements, fibers, functions, promises, maps, sets, and repeated references become short `[...]` markers), `causedUpdatesTotal`, and `collateralUpdatesTotal`. `missing: true` marks an id that has no aggregate source row.

`all` is **not** a supported include value, and neither are `collaterals`, `context`, or `amplifiers`. Live and offline `commit-peek` reject unsupported includes and return `ok:false` with `validInclude`; as with `commit-list`, the live rejection arrives in `result` while the shell exits 0. Omit `include` for the default slice set, or pass an explicit CSV like `stats,sources,metrics` or `stats,unmounts`.

Response envelopes (live responses also add `targetClientId`, `resolvedFrom`, and `requestId`):
- commit-list: `{by,total,rows:[{commitId,stat,sourceCount,ticks,network,latestAction}]}`. Rows are top-level, not under `payload`.
- hot-sources: `{total,payload:{count,items:[...]}}`.
- commit-peek: `{payload:{commitId,found:true,stats,sources,sourcesTotal,timing,metrics,hooks,actions,actionsTotal,rendered,renderedTotal,unmounts,unmountsTotal,network,dom,domTotal,perf,perfTotal}}`, containing only the requested slices. An unknown commit returns flat `{commitId,found:false}` without `payload`.

### `avalanche-describe-action <clientId> <actionId>`
```bash
chippy.sh avalanche-describe-action my-client 7
```
Looks up one recorded event/action breadcrumb by id and returns the full payload. Use this after `commit-list` surfaces a useful `latestAction` id. Full payload includes DOM target, nearest test id, target fiber, and complete locality stack. In dev builds the stack is `ownerStackKind: "owners"`; in production bundles owners may be unavailable, so it falls back to `ownerStackKind: "parents"` using the React return chain. This is probe-like grounding for a click/key/input: DOM target + nearest meaningful fiber + locality stack.

Each action also carries `event`:
- `trusted`: the browser's `isTrusted`. It is false when page code dispatched the event.
- `key`: for key events, the named key (`Meta`, `Tab`, `Escape`), or `character` for any key that types a character, so captures hold no typed text.
- `modifiers`: modifier keys held during the event.

A trusted key event is not always a deliberate key press. Switching apps with Cmd+Tab or Alt+Tab sends the page a `Meta` or `Alt` keydown and keyup on the focused element. The timeline shows these details next to each input, for example `keydown Meta` or `keydown character with Shift dispatched`.

### `avalanche-perf <clientId> [types] [top] [match] [fromCommit] [toCommit]`
```bash
chippy.sh avalanche-perf my-client
chippy.sh avalanche-perf my-client long-animation-frame,layout-shift 10
chippy.sh avalanche-perf my-client mark,measure 50 '^ufo'
chippy.sh avalanche-perf my-client '' '' '' 30 42
```
Lists the browser performance entries Avalanche recorded during the capture. `types` is a CSV of `mark`, `measure`, `long-animation-frame`, `layout-shift`, `event`, `largest-contentful-paint`, `paint`, `navigation`, and `longtask` (default all). `top` caps entries per type (default 20): layout shifts are ranked by value, long frames by blocking time, long tasks, events, and measures by duration, and marks latest first. `match` is a case-insensitive regex on the entry name (mark or measure name, event type). `fromCommit` and `toCommit` keep entries that overlap the span from the first commit's start until the commit after the last one starts. Pass `""` to skip a position.

`payload` holds `status` (`meta.perf`), `summary`, and `entries[type]: {count, items}`. `summary` has `cls` (the largest session window of shifts without recent input), `layoutShifts`, `longFrames`, `totalBlockingMs` (long frame blocking time, or long task time over 50 ms where frames are unsupported), `worstFrame` with its commits, `chippyFrames` (`count` and `blockingMs` of long frames Chippy's own commands caused; `longFrames`, `totalBlockingMs`, and `worstFrame` leave them out), `interactions`, `worstInteractionMs`, `lcpMs`, `fcpMs`, `ttfbMs`, `marks`, `measures`, and `longestMeasure`, over the selected entries.

Every entry has `id`, `entryType`, `name`, `startTime`, `duration`, and `commits`: `during` (commits that started inside the entry's span, first ten), `duringCount`, and `before` (`{commitId, gapMs}`, the last commit that started at or before the entry). Type fields:

- marks and measures: `detail`, as one JSON line cut to 200 characters.
- long animation frames: `blockingDuration`, `renderStart`, `styleAndLayoutStart`, and `scripts`, the five longest (`duration`, `forcedStyleAndLayoutDuration`, `invoker`, `invokerType`, `sourceURL`, `sourceFunctionName`, `sourceCharPosition`; `chippy: true` marks Chippy's own code).
- layout shifts: `value`, `hadRecentInput`, and up to five `sources` with `element`, `testId`, `component`, `previousRect`, and `currentRect` (`[x, y, width, height]`).
- events: `interactionId`, `inputDelay`, `processing`, `presentationDelay`, and `target`. Events of 16 ms or more are recorded when they belong to an interaction; others, such as hover, from 50 ms.
- LCP: `renderTime`, `loadTime`, `size`, `url`, and `element`.
- navigation: `navigationType`, `ttfb`, `domContentLoaded`, `load`, and `transferSize`.

A long frame lists every commit that started inside it under `commits.during`: those commits ran without a paint between them, so the user saw none of them until the frame ended. Layout shifts and LCP are reported at the frame after the DOM moved, so read `before` for them; for long frames, events, and measures read `during`. Every link is temporal proximity, not proof of cause. A report recorded before version 9 has no entries and returns an error that says so.

### `avalanche-console <clientId> [levels] [top] [match] [fromCommit] [toCommit]`
```bash
chippy.sh avalanche-console my-client
chippy.sh avalanche-console my-client error,warn
chippy.sh avalanche-console my-client '' 100 'fetch|timeout'
chippy.sh avalanche-console my-client error '' '' 30 42
```
Lists the console messages Avalanche recorded during the capture: `console.error`, `warn`, `info`, `log`, and `debug` calls, uncaught errors, and unhandled promise rejections. `levels` is a CSV of `error`, `warn`, `info`, `log`, and `debug` (default all). `top` caps entries, earliest first (default 50). `match` is a case-insensitive regex on the message. `fromCommit` and `toCommit` keep entries from the first commit's start until the commit after the last one starts. Pass `""` to skip a position. Messages Chippy writes itself (`[avalanche] …`, `[Chippy …`) are left out; the MCP tool's `includeChippy` adds them.

`payload` holds `status` (`meta.console`), `summary`, `count` (entries that matched), `truncated`, and `entries`. `summary` counts occurrences of the page's own messages over the window, repeats included: `errors`, `warnings`, `other` (`info`, `log`, `debug`), `uncaught`, `rejections`, `chippy` (Chippy's entries, left out of the other counts), and `firstError` (`id`, `time`, `message`, `location`, `commitId`), usually the lead.

Every entry has `id`, `level`, `source` (`console`, `uncaught`, or `rejection`), `time` (`performance.now()`), `repeat` and `lastTime` (consecutive identical messages collapse into one entry), `message` (rejections start with `Uncaught (in promise)`; format tokens such as `%s` substituted, objects previewed two levels deep, cut to 1500 characters), `location` (`url:line:column` of the caller for errors and warnings, of the throw for an uncaught error or a rejected `Error`; `null` for other levels and for code without a script URL), `stack` (for errors and warnings; a logged `Error`'s own stack when there is one, otherwise the call stack, eight frames), `chippy: true` on Chippy's own messages, and `commit` (`{commitId, gapMs}`, the last commit that started at or before it). A warning React writes while rendering a commit links to that commit; every link is timing, not cause.

Capture runs only while the detector is installed. It wraps the console methods, so DevTools shows Chippy's bundle as the caller of each message unless that bundle is ignore-listed; `location` keeps the real caller. Each level keeps 200 entries, dropping its own oldest first, so log noise cannot push out errors; `meta.console.dropped` counts what went. A failed image or script load is not recorded (read `avalanche-network`). A report recorded before version 10 has no entries and returns an error that says so.

### `avalanche-network <clientId> [top] [by] [match] [initiators] [windowMs]`
```bash
chippy.sh avalanche-network my-client
chippy.sh avalanche-network my-client 10 duration
chippy.sh avalanche-network my-client 20 start '/api/' fetch,xmlhttprequest 500
```
Lists the network requests that finished during the capture and links each one to the commits around it. Use it when a commit may be waiting on data, or to see which requests an interaction started. Defaults: top 20, by `start`, window 250 ms. Pass `""` to skip a position.

Sort keys: `start` and `end` ascending, `duration` descending. Any other key returns `ok:false` with `validBy`. `match` is a case-insensitive URL regex; an invalid pattern returns `ok:false`. `initiators` filters by Resource Timing initiator type, such as `fetch`, `xmlhttprequest`, `script`, `img`, `css`, `link`, or `other`.

Output: `payload: {available, capture, windowMs, by, total, summary, rows}`.
- `available` is `false` when the report has no network data (an export from an earlier release).
- `capture` is `meta.network` (see [Report shape](#report-shape)).
- `summary`: `byInitiator` counts, `landedBeforeCommit`, `startedAfterCommit`, `startedDuringRender`, and `longest` (`{id, url, duration}`), all over the filtered requests.
- `rows[]`: `id`, `url` (cut to 300 characters), `initiatorType`, `startTime`, `endTime`, `duration`, `status` (null when the browser hides it), `cached` (true for a cache hit, false for a network transfer, null when cross-origin timing hides it), `startedBeforeCapture`, and the links below.

Links, each bounded by the window:
- `startedAfter: {commitId, gapMs}` — the last commit that ended before the request started. A passive effect or follow-up task of that commit may have issued it.
- `startedDuringRender: commitId` — the commit whose render was running when the request started, such as a render-time data read. Needs render-tick timing; `null` otherwise.
- `landedBefore: {commitId, gapMs}` — the first commit whose render started at or after the response finished. A state update from the response may have scheduled it.
- `commitsInFlight` — commits that committed while the request was in flight.

Every link is temporal proximity, not proof of cause. Confirm with the commit's sources (`commit-peek N sources,rendered`). The browser reports a request only when it finishes, so a request still in flight is not listed yet. Requests Chippy makes itself (module and source-map fetches, Chippy assets) are excluded and counted in `meta.network.ignoredOwn`.

### `avalanche-timeline <clientId> [fromCommit] [toCommit] [minRequestMs] [exclude] [format]`
```bash
chippy.sh avalanche-timeline my-client
chippy.sh avalanche-timeline my-client 40 90 100 'analytics|beacon'
chippy.sh avalanche-offline capture.json timeline --fromCommit 40 --format full
```
Puts user input, network requests, Suspense fallbacks, commits, browser performance entries, and console errors on one clock, in milliseconds from an origin. Use it to answer why an interaction or load felt slow, not only why it cost CPU. Defaults: the window runs from the first commit after the first recorded interaction to the last commit. Requests shorter than 50 ms are left out, and the 30 longest are kept (`--top` offline, `top` over HTTP). `exclude` is a case-insensitive URL regex. Pass `""` to skip a position.

The origin is the first interaction up to 5 s before the window's first commit, else that commit (`origin.kind`). Times before the origin are negative.

Commits are classified by what the user can see:
- `lock`: a Suspense boundary showed its fallback.
- `unlock`: a boundary showed its content.
- `swap`: both happened in one commit.
- `update`: no Suspense change. This is CPU work that may or may not change the screen.

When the capture records `paintAt`, everything the user sees is placed at paint time: fallback and content times in `boundaries`, screen changes, and VC. Commit rows stay at commit time. A commit whose paint was at least 50 ms after it gets `· painted +X` on its row, and the text header lists the longest of these under `Painted late`. A late paint means the task that ran the commit kept the main thread busy. Captures without `paintAt` use commit times.

Lock, unlock, and swap commits are always kept. Updates are ranked by rendered components (`maxCommits` 25), and the rest are counted in `omitted`.

Console entries are part of the story: errors (including uncaught errors and unhandled rejections) and warnings appear as `error` and `warn` rows at the time they were logged, with the caller's `file:line:column`, a `×N` repeat count, and the first line of the message. Other levels follow, up to `maxLogs` (default 20); errors and warnings are kept up to 50, and the rest are counted in `omitted.logs`. The console span runs from the origin until the commit after the window starts, or to the end of the capture, so an error logged after the last commit is still shown. The text header adds `Console: N errors, M warnings; first error +t (after cX): …`. Chippy's own messages are left out; read them, stacks, and every entry with `avalanche-console`.

Output: `payload: {origin, window, perceived, screen, boundaries, console, omitted, mermaid, text}`. `console` is `{errors, warnings, other, firstError}` over the console span, or null when the report has no console entries. `format map` adds `settleMapSvg`; `format full` adds `settleMapSvg` and `lanes`.
- `screen`: Visually Complete times from the recorded screen changes (null when the capture recorded none). `vc50`, `vc90`, `vc100` are the times by which 50%, 90%, and 100% of the viewport reached its final state; VC90 is when the page looks mostly finished, and lower is better. Areas that never changed count as complete from the origin. `changedShare` is the share of the viewport that changed at all, `changedVc90` is VC90 over that changed area only, and `late[]` lists the regions (`label`, `at`, `commitId`, `share`) that kept changing after it.
- `boundaries[]`: one entry per Suspense boundary with `boundary` (key `b<id>`), `depth`, `label`, and `location`. Waits carry the same `boundary` key, and `perceived.stillWaiting` lists these keys. `location.chain` lists five component parents, then up to five owners not already listed (`via: parent | owner | both`), each with `name`, `source` when known, and identifying string props such as `name`, `team`, `packageName`, or `testId`. `label` is the boundary's own `name` prop or key when set, else the first chain entry the other boundaries do not share, so a common wrapper is skipped. Waits, commits, and the chart use the label instead of `@depth`. Owners exist only in development builds.
- `settleMapSvg` (`format map` or `full`): an SVG of the viewport with each area colored by when it last changed, grey where nothing changed, and the last three regions labelled. Save it to a `.svg` file to view it.
- `perceived.waits[]`, longest first: `depth`, `from`, `until` (null while still shown), `waitedMs`, `lockedBy`, `unlockedBy`, `lastRequests` (up to three requests that overlapped the wait and finished before it cleared, latest first, with `gapMs` before the unlock), and `updatesDuring` (`{commits, rendered}` of update commits while the fallback was on screen).
- `perceived.firstLockAt`, `settledAt`, `stillWaiting`, `updatesAfterSettled`: waits that start after the next input belong to that input, so `settledAt` is the last unlock of the opening interaction, or null while one of its fallbacks is still shown.
- `mermaid`: a gantt chart with sections Input, Network (the three longest are `crit`), User waits, Screen (lock and unlock milestones), Screen changed (one milestone per commit that changed at least 1% of the viewport, with its share and region, plus a `VC90` milestone), Updates (the three heaviest are `crit`; each shows its screen share), and Console (up to 15 error and warning milestones; errors are `crit`). Render it in a ```` ```mermaid ```` block.
- `text`: the `perceived` summary followed by one aligned row per event.
- `lanes` (`format full`): `input`, `network`, `suspense`, `commits`, `perf`, `console`. Console rows have `id` (the `avalanche-console` entry id), `level`, `source`, `label`, `t`, `repeat`, `location`, and `afterCommit`. Commit rows have `commitId`, `t`, `renderStart`, `rendered`, `kind`, `suspense`, and `sources` (top two source names).

Limits:
- Waits are paired by the detector's boundary id, so sibling boundaries at one depth stay apart and a boundary that remounts reads as a new boundary. Reports saved before boundary ids existed pair by depth, and their keys read `@<depth>`.
- A request that ends just before an unlock is a candidate gate, not proof. Confirm it from the code that suspends, or from the unlock commit's sources.
- Screen changes are recorded from React's committed host nodes and their boxes, not from pixels. CSS animations, images that finish decoding later, and DOM writes outside React are not seen, a removed node counts only if Chippy measured it earlier, and a subtree React moved without remounting is not seen (React clears the insertion flag before the commit hook). Measuring boxes reads layout during the commit. Turn it off with the detector option `screenCapture: false`.
- Commit `endTime - startTime` is the detector's own overhead, so a commit has a duration only when the report records render start. Otherwise commits are drawn as points, and `rendered` stands in for work.

### `avalanche-dom-diff <clientId> [fromCommit] [toCommit] [match] [maxItems] [top]`
```bash
chippy.sh avalanche-dom-diff my-client
chippy.sh avalanche-dom-diff my-client 40 60 'item|row' 20
chippy.sh avalanche-offline capture.json dom-diff --match 'data-testid=toast'
```
Lists what each commit changed in the DOM, commits in order. Use it for flicker, content that appears and then disappears, a node that is removed and inserted instead of updated, or to check what one interaction did to the page. Defaults: every recorded commit, 100 commits (`top`), and 50 changes per commit (`maxItems`). `match` is a case-insensitive regex over each change's op, node, `at`, markup, and props; a commit with no matching change is left out. Pass `""` to skip a position.

Ordering: each commit is one change set. React applies all of a commit's DOM changes before the browser can paint, so two changes in one commit, in sibling branches or nested, happened together and have no order. Changes are listed in tree order only so the output is stable. Order exists only between commits.

Changes are read in the commit hook from the committed fibers, using each host fiber's previous props for the value before. Nothing observes or patches the DOM.

Output: `payload: {commits, commitsTotal, evicted?, text}`.
- `commits[]`: `commitId`, `t` (ms since the first listed commit, null without commit timings), `startTime` (`performance.now()` when the commit hook ran), `total` (changes after `match`), `changes` (cut to `maxItems`), and `truncated` when the commit changed more than 200 nodes and the rest were not recorded.
- `commitsTotal`: commits with a matching change; more than `commits.length` when `top` cut the list.
- `text`: one header per commit (`#7  +42ms · 3 changes`), changes grouped by `at`. Read it first.

Each change is `{op, node, at, props?, html?, elements?}`:
- `op`: `+` the topmost node of an inserted subtree; `-` the topmost node of a removed subtree; `~` an updated node; `move` a keyed node React moved among its siblings; `show`/`hide` Suspense content that stays mounted while its fallback is shown or cleared.
- `node`: `tag[data-testid=…]`, `tag#id`, `tag[role=…]`, or `tag`. A text node is `<parent> #text`.
- `at`: up to three nearest components above the node, outermost first, joined by ` › `; `(root)` when there are none. For a removed node, the components above the place it was removed from. Names are read at capture time, so production builds may show minified names.
- `props` (`~` only): `[name, before, after]` per changed prop, at most 12. `class`, `text` (textual children), `style.<key>` per style key, `innerHTML`, and other attributes. Strings are JSON-quoted and cut to 80 characters; null means the prop was absent. Handlers, refs, and keys are ignored.
- `html` and `elements` (every op except `~`): the opening tag, the start of the text, and the closing tag, cut to 200 characters; and the elements in the subtree, the node included, up to 1000 (`1000+` in `text`).

Limits:
- DOM writes outside React (a library writing to the DOM directly, `innerHTML` set by hand), attributes React does not own, and CSS animations are not recorded.
- The capture keeps 50,000 changes (`maxDomChanges`) and drops the oldest commits first; `meta.domDiff.evicted` and the first line of `text` say when that happened. `install` option `domDiff: false` turns the capture off.

### `avalanche-export <clientId> [lastN] [outFile]`
```bash
chippy.sh avalanche-export my-client
```
Full JSON export from live page. `lastN` does not trim the payload; to keep the last N commits, use `avalanche-save <clientId> <path> N`. With `outFile`, the raw helper envelope is written to that file instead of stdout, gzip-compressed when the path ends in `.gz`; unlike `avalanche-save`, it is not normalized for `avalanche-offline`. Like `avalanche-save`, it waits up to 60 seconds for the page. The JSON is about 700 bytes per rendered component per commit, several MB for a full re-render of a large tree. Large output is easy to truncate in the shell; prefer `avalanche-save` when the export will be inspected more than once.

### `avalanche-save <clientId> <path> [count]`
```bash
chippy.sh avalanche-save my-client .chippy-captures/raf-1846.json
chippy.sh avalanche-save my-client .chippy-captures/last-50.json 50
chippy.sh avalanche-save my-client .chippy-captures/run.json.gz
```
Save once. Analyze offline many times. A path ending in `.gz` is written gzip-compressed, and `avalanche-offline` reads it the same way; the response then adds `jsonBytes`, the uncompressed size. Use it for large captures: a full re-render of a few thousand components exports several MB of JSON, which compresses many times over. `count=0` or omitted saves the full export; `count=N` saves the last N commits. The save waits up to 60 seconds for the page, rather than the 5-second default of other commands, so a large capture completes.

Expected success response:
```json
{"ok":true,"file":".chippy-captures/raf-1846.json","bytes":12345,"commits":67}
```

Common failure:
```text
avalanche-analyze: response has no Avalanche export (expected meta and commitStats); check avalanche-status
```

No file is written. Re-check `avalanche-status` first: `installed`, `hasMetricsGlobal`, and `commitCount` should show a real capture. If status is empty, arm/reload correctly and capture again before saving. With `count=N`, per-commit data keeps the last N commits; aggregate `sources` totals still cover the whole capture.

### Panel Record and Stop
In the Chippy panel, **● Record** clears the capture, as `avalanche-clear` does, and **■ Stop** pauses the capture. Nothing else is saved: the recording is Avalanche's capture. Read it live with the `avalanche-*` commands, or save it with `avalanche-save`. Avalanche stays installed after Stop, and React DevTools still sees every commit, but nothing after Stop enters the capture: no commits, input, or requests that start later. Requests in flight at Stop still finish into it. `avalanche-status` and the report's `meta.capture` show `paused` and `pausedAt` (`performance.now()`). The next Record or `avalanche-clear` starts a new capture. Commits after Stop are not kept, so a read cannot include them; record again to capture them. Input on the panel itself is not captured, so Record and Stop do not appear in `interactionsByCommit`.

The Avalanche pill beside Record shows whether the capture includes the page's first render. Green: Avalanche was installed before React's first commit by an armed reload. Amber (`late`): it was installed on the live page. Grey (`off`): not installed. Clicking amber or grey reloads the page with Avalanche installed from page start, with the defaults of `reload-with-avalanche` and the mode chosen in the panel.

The **Sources | Full** toggle beside the pill sets the detection mode. `sources` is the default; `full` also records effect, memo, and callback dependency churn (`trasherCounts`). The toggle highlights the mode the capture runs at, shown as `detectionMode` in `avalanche-status`. While Avalanche runs, choosing the other mode reinstalls it now, as `avalanche-recapture` does: the capture starts again without the page load, and the pill turns amber. Click the pill to reload in the chosen mode and capture the load too. The choice is kept per origin for later reloads from the panel. The toggle is disabled during a recording.

### `avalanche-offline <path> <summary|commit-list|commit-peek|hot-sources|describe-action|network|timeline|dom-diff|source-search> ...`
```bash
chippy.sh avalanche-offline .chippy-captures/raf-1846.json summary
chippy.sh avalanche-offline .chippy-captures/raf-1846.json commit-list 10 collateral
chippy.sh avalanche-offline .chippy-captures/raf-1846.json commit-peek 42 stats,sources,rendered 20
chippy.sh avalanche-offline .chippy-captures/raf-1846.json source-search --name 'Issue(Row|List)'
```
Use saved captures without a live page. `commit-list`, `commit-peek`, `hot-sources`, `describe-action`, `network`, `perf`, `timeline`, and `dom-diff` run the same code as the live commands and return the same shapes, so sort keys and include values match the live tables above (`unmounts` is live-only; a saved capture always returns it empty).

Offline arguments: `commit-list [top] [by]`, `commit-peek <commitId> [include] [maxItems]` (no `depth`; the third value is maxItems, default 50), `hot-sources [limit]`, `describe-action <actionId>`, `network [top] [by] [match] [initiators] [windowMs]`, `perf [types] [top] [match] [fromCommit] [toCommit]`, `console [levels] [top] [match] [fromCommit] [toCommit]`, `timeline [fromCommit] [toCommit] [minRequestMs] [exclude]` (`--top N` keeps the N longest requests, `--format full` adds lanes), `dom-diff [fromCommit] [toCommit] [match] [maxItems]` (`--top N` caps commits), and `source-search --name <regex> [--top N]` (default top 50). Flags such as `--top`, `--by`, `--include`, `--maxItems`, `--match`, `--initiators`, and `--window` are accepted in place of positional values.

`summary [top] [maxItems]` returns the `avalanche-summary` digest, with its fields at the top level beside `ok` and `action`. `source-search --name <regex>` matches aggregate sources by `sourceId` and rendered components by name with per-instance render and self-source counts.

### `avalanche-arm <clientId> <origin> [maxCommits] [captureFibers] [detectionMode]`
```bash
chippy.sh avalanche-arm my-client http://localhost:9000 0 true sources
```
Clears the current capture, installs the detector on the live page, and stores an arm for this client and origin. Later `page-reload` calls deliver the arm to the new document. `maxCommits` does not cap commits: it sets how many commits each source keeps in its history (`historySize`) on those armed reloads, and `0` or omitted means 1000. The immediate live install ignores it and keeps one commit per source, so a source that fires in several commits appears only in its latest `sourcesByCommit` entry. When per-commit source history matters for a live interaction, use `avalanche-recapture <clientId> [detectionMode]` (1000 commits per source) instead.

### `avalanche-disarm <clientId> <origin>`
```bash
chippy.sh avalanche-disarm my-client http://localhost:9000
```
Removes the stored arm so later reloads start without capture. The detector already installed on the current page keeps recording.

### `page-reload <clientId>` / `page-wait-reload <clientId> [timeoutMs]`
```bash
chippy.sh page-reload my-client
chippy.sh page-wait-reload my-client 15000
```
Low-level reload helpers. Use when debugging injection timing. `page-wait-reload` returns `{reloaded,before,after,waitedMs}`. On timeout it returns `ok:true, reloaded:false` and exits 0, so check `reloaded`. `timeoutMs` defaults to 5000 and is clamped to 500-60000. On a Storybook integration it returns `{reloaded:true,remounted:true}` immediately.

## Event/action breadcrumbs

Avalanche records bounded browser event breadcrumbs while armed. Defaults are explicit user actions only: click, keydown, keyup, input, change, submit. Noisy streams such as wheel/scroll/move are opt-in via detector options. Options are `interactionCapture: 'off' | 'explicit' | 'noisy' | 'all'` (default `explicit`), `interactionEvents` (extra event names), and `interactionWindowMs` (default 1000 ms; links an event to the next commit within the window). `avalanche-install`, `avalanche-arm`, and MCP `install` do not forward them; pass them to `window.__AVALANCHE__.install({ ... })` in the page or to `createAvalancheDetector` in the npm package.

Breadcrumb linking is intentionally minimal: action id, action name, last commit id, delta time, capture `timestamp`, DOM target, nearest test id, target fiber, and locality stack. The agent reconstructs deeper source context on demand.

Read order:
1. `avalanche-commit-list` — compact latestAction clues only.
2. `avalanche-describe-action <id>` — full event breadcrumb by id.
3. `avalanche-commit-peek <commitId> ... actions` — all actions attached to one commit.

For locality: dev builds use `ownerStackKind: "owners"`; production/minified builds fall back to `ownerStackKind: "parents"`. Compact views keep the closest 10 names from the target-local side plus the full count. Full views may be large; inspect only when needed.

On a production build, Avalanche records minified names while it captures, and Chippy recovers authored names from the page's source maps when a command reads the capture, never during a commit. Each Avalanche command recovers names only for the components its result mentions, by source id or by name, then returns the result with those components renamed and a `nameRecovery` summary (see [Production component names](command-output-formats.md#production-component-names)). The rename covers every place a capture names a component: source ids, `renderedByCommit` entries, DOM change anchors (`at`), Suspense locations, screen region labels, perf entry owners, unmount samples, and interaction targets and owners, and so the summary and timeline text as well. A component that first mounts partway through the capture is renamed like any other. Components that minified to the same name share a source id, so recovery resolves all of them, and the counts from before recovery may combine several components.

A result that mentions a renamed component lists the renames in `componentNames: [{ name, minifiedName }]`, so the result can be matched against minified stack traces or bundle code. Exports and saved files carry the full table in `meta.componentNames`. A renamed `renderedByCommit` entry also keeps its runtime name in `minifiedName`. When components from different bundles minified to the same name and recovered different authored names, text fields such as `at` keep the minified name, because the text cannot tell them apart; `componentNames` lists each pair.

`renderedByCommit` names a component when it commits, so a component with no runtime name (an arrow function inside `forwardRef` or `memo`) is recorded as `Anonymous`. An export (`export`, `export-last`, `avalanche-save`) first recovers names for every component in the capture and renames their entries. A command spends up to 3 seconds on recovery; an export may spend up to half of its request timeout, at most 20 seconds. When `nameRecovery.skipped` is above zero the budget ran out: export again to name more, because resolved names are kept. Entries still `Anonymous` after that have no name in the source map either, for example components created by a factory function.

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
- `metricsByCommit[N]` — low-level adapter metrics for commit `N`
- `sources[].restartWaste` / `maxRestartWaste` — restart attribution per source across the capture (adapter modes only)
- `commitTimings[N]` — `startTime`, `endTime`, `timeSinceLastCommit`, `detectorOverhead`, `ticks`, and `render` for commit `N` (`commit-peek ... timing`)
- `commitTimings[N].paintAt` — when commit `N` reached the screen: the end of the rendering update in the first animation frame after the commit, on the same clock as `startTime`. Commits before one frame share a value. It is absent while that frame is pending and for commits made while the page was hidden. `paintAt - startTime` is how long the change waited for the main thread.
- `meta.renderTicks` — whether ticks are counted, from which signal, and why not when they are unavailable
- `meta.timeOrigin` — the page's `performance.timeOrigin` (Unix epoch ms)
- `networkRequests[]` — requests that finished during the capture, oldest first (`avalanche-network` row fields without the links)
- `meta.network` — `{supported, enabled, windowStart, requests, dropped, ignoredOwn}`: whether the browser delivers resource entries, whether capture is on, when the capture window opened (`performance.now()`, at install or clear), how many requests are kept, how many of the oldest were dropped past the 500-request limit, and how many of Chippy's own requests were excluded
- `screenByCommit[N]` — screen area commit `N` changed: `viewport`, `area`, `removedArea`, `share`, `rects` (`[left, top, right, bottom]`), `regions` (top five by area, labelled by test id or component), `nodes`, `truncated`, `ms`; present only for commits that changed a box
- `domByCommit[N]` — DOM changes commit `N` made: `changes` (the `avalanche-dom-diff` change shape, in tree order, with no order between them), `truncated`, `ms`; present only for commits that changed the DOM
- `meta.domDiff` — `{maxEntries, entries, commits, evicted}`: the change budget, how many changes and commits are kept, and which oldest commits were dropped (`evicted` is null when none were)
- suspense events carry `boundary` (a stable id per boundary within the capture) and `location` (the parent and owner chain described under `avalanche-timeline`)
- `perfEntries[]` — browser performance entries recorded during the capture, in arrival order (`avalanche-perf` entry fields without the commit links)
- `meta.perf` — `{enabled, observed, unsupported, windowStart, entries, byType, dropped, pausedAt}`: whether capture is on, the entry types this browser lets it observe and those it does not, when the capture window opened, how many entries are kept (in total and by type), how many of the oldest of each type were dropped past 300 per type, and when the capture was paused
- `consoleEntries[]` — console messages, uncaught errors, and unhandled rejections recorded during the capture, in arrival order (`avalanche-console` entry fields without the commit link)
- `meta.console` — `{enabled, installed, windowStart, entries, byLevel, dropped, pausedAt}`: whether capture is on and the console wrapped, when the window opened, how many entries are kept (in total and by level), how many of the oldest of each level were dropped past 200, and when the capture was paused
- `meta.version` — report format; 8 adds `networkRequests` and `meta.network`; 9 adds `perfEntries` and `meta.perf`; 10 adds `consoleEntries` and `meta.console`

### Render ticks

A tick is one uninterrupted render slice: React entering its render loop and leaving it, either to commit or to yield to the browser. `commitTimings[N].ticks` is how many slices React ran since the previous commit.

- `1` — the render finished in one task (sync lanes, `flushSync`, discrete input, or a short concurrent render).
- greater than `1` — React time-sliced the render (transitions, retries, idle work) and yielded between slices, or repeated it synchronously (error recovery, an external-store consistency check). Slices of renders React threw away or restarted count toward the commit that finally lands.
- `null` — ticks are not measurable on this page. Read `meta.renderTicks.reason`; do not read a missing count as one tick.

`commitTimings[N].render` holds the detail: `renderStart` / `renderEnd` (first slice start, last slice end, on the same clock as `startTime`), `workMs` (sum of slice durations), `yieldedMs` (time between slices, when the main thread ran other work), `longestSliceMs`, the first 32 `slices` as `[start, end]` pairs with `slicesTruncated`, and `partial`. `partial: true` means counting started while a render may already have been in progress, so the count is a lower bound; it is set on the first commit after Avalanche attaches to an already registered renderer.

Ticks are page-wide: when several roots render between two commits, their slices count toward the next commit.

| React build | Signal (`meta.renderTicks.sources`) | Availability |
|---|---|---|
| React 19+, development and production | `async-dispatcher` | Always |
| React 18, development or profiling build | `profiling-hooks` | When Avalanche is armed before React DevTools attaches (`reload-with-avalanche`); composes with the DevTools Timeline |
| React 18 production | none | Unavailable; `ticks` is `null` |

`meta.dataAvailability.ticks` is `false` when no signal is available.

### Aligning commits with browser performance data

`commitTimings[N].startTime` / `endTime` and each action's `timestamp` are `performance.now()` values on the page clock described by `meta.timeOrigin`. They share that clock with `PerformanceObserver` entries (`layout-shift`, `long-animation-frame`, `event`, `largest-contentful-paint`) and with DevTools Performance traces of the same page, so a commit can be placed next to the layout shift, long frame, or input it overlaps. `meta.timeOrigin + startTime` is the wall-clock time.

`startTime` is when React called the commit hook: after the commit's DOM mutations and layout effects, before passive effects. It marks the end of React's synchronous commit, not the start of render. Overlapping timestamps show temporal proximity; confirm causality with the commit's sources and rendered components.

Avalanche records these entries during the capture (`perfEntries`), so a saved export keeps them; [`avalanche-perf`](#avalanche-perf-clientid-types-top-match-fromcommit-tocommit) joins them to commits, live or offline. `eval-page <clientId> perf-entries` does the same alignment from the browser's buffers, which keep about 150 entries per type and only interactions of 104 ms or more. For each buffered entry it returns `commits.during` (commits whose `startTime` falls inside the entry) and `commits.before` (the latest commit at or before the entry, with `gapMs`). Layout shifts and LCP are point-in-time entries reported at the frame after the DOM moved, so `during` is almost always empty for them: read `before`. For long frames and interactions, read `during`. Arguments and limits are in the [snippet catalog](../snippets/README.md).

Network requests use the same clock. Avalanche records them from Resource Timing during the capture, and [`avalanche-network`](#avalanche-network-clientid-top-by-match-initiators-windowms) links each to the commits around it.

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
- `commit-peek` has no Suspense slice. Read `suspenseByCommit[N]` from an `avalanche-save` file (`{ depth, entered, left }` per transition).

## `renderedByCommit` — per-component render evidence

Populated in every detection mode. The mode decides which fields carry evidence: `stats` has no source tracking, so `isSelfSource` is never set; `trasherCounts` appear only when the mode is `full` or `amplifiers`. Pulled into `commit-peek` output via `include=rendered`.

Entries are compact: a field at its default value is left out. No `null` ids, no `false`, no empty list, no all-zero counts. A typical collateral render is one short line:

```json
{"sourceId":"T7#1@14","name":"Title","depth":14,"ownerSourceId":"T1#1@4"}
```

Shape (`?` = absent when at its default):

```text
renderedByCommit: Record<commitId: number, RenderedComponentEvidence[]>

RenderedComponentEvidence = {
  sourceId:        string,         // internal id 'T<typeId>#<n>@<depth>'; hot-sources and sources use '<Name>#<n>@<depth>', so join on name plus the '#<n>@<depth>' suffix
  name:            string,         // display name; 'Unknown' when unresolved
  depth:           number,
  parentSourceId?: string,         // nearest parent when it is a component
  ownerSourceId?:  string,         // source whose wave carried this render
  isSelfSource?:   true,           // this component's own state changed
  propChanges?:    PropChangeEvidence[],  // absent when no prop changed
  trasherCounts?:  { effects: number; callbacks: number; memos: number }  // absent when all are zero
}

PropChangeEvidence = {
  name:     string,                // prop key
  kind:     'added' | 'removed' | 'scalar-changed' | 'ref-changed',  // unchanged props are not listed
  prev?:    string,                // value summary; absent for 'added', and for 'ref-changed' when the shape did not change
  current?: string,                // value summary; absent for 'removed'
  // 'ref-changed' plain objects and arrays only, not in `stats` mode:
  sameShallow?:          true,     // every key holds the same value: only the identity changed
  changedKeys?:          PropKeyChange[],  // first 8 keys whose values differ, in key order; [] when sameShallow
  changedKeyCount?:      number,   // all keys that differ
  changedKeysTruncated?: true,     // changedKeys lists fewer than changedKeyCount
  keysNotCompared?:      number    // instead of the fields above: the value has more than 1000 keys, its key count
}

PropKeyChange = {
  key:      string,                // array index as a string for arrays
  kind:     'added' | 'removed' | 'scalar-changed' | 'ref-changed',  // 'ref-changed': a nested object or function with a new identity
  prev?:    string,                // value summary, for 'scalar-changed' and 'removed'
  current?: string                 // value summary, for 'scalar-changed' and 'added'
}
```

A value summary is one bounded line:

| Value | Summary |
|---|---|
| `undefined`, `null`, booleans, numbers, bigints | `undefined`, `null`, `true`, `21`, `10n` |
| string | `"text"`, quoted, so `21` and `"21"` differ; after 64 characters, `"…"(len 200)` |
| function | `function onClick`, or `function` when anonymous |
| array | `array(5)[1, "a", object{id}]`: the length and the first three items, not nested further |
| React element | `element <Row>`, `element <div>` |
| other object | `object{id,title,"a,b",…+3}`: the first five keys, quoted when not plain names, and how many more |

A `ref-changed` prop with only `current` got a new identity with the same shape: an equal-looking object or callback was recreated.

On a `ref-changed` plain object or array, the key diff compares the previous and current value one level deep with `Object.is`, at commit time:

- `sameShallow: true` with `changedKeys: []`: a new object with the same values. The component received nothing new through this prop; if it is the only changed prop, the render was wasted and the fix is upstream, where the object is rebuilt.
- `changedKeys` lists the keys that do carry new values. A `scalar-changed` key is a real data change; a `ref-changed` key is a nested object or function with a new identity, which may itself hold the same values (the diff does not go deeper).
- No key diff fields: a callback, React element, class instance, Map, or Set, or a capture in `stats` mode.

Mutating an object in place keeps its identity, so it never shows up as `ref-changed`.

Saves made before this format use the older expanded entries: `prev`/`current` as objects with `type`, `isFunction`, `preview` and `keysTop`, plus `hasPropChanges` and default-valued fields.

### Reading `trasherCounts`

`trasherCounts` reports how many amplifier observations (`effects`, `callbacks`, `memos`) the detector attributed to this component in this commit. **Non-zero means the component fired an effect/callback/memo whose dependency identity changed.** This is the routed signal for the "trasher" verdict in P-06.

Reading rules:
- `trasherCounts.effects > 0` — at least one `useEffect` re-ran from changed deps.
- `trasherCounts.callbacks > 0` — at least one `useCallback` produced a new function identity.
- `trasherCounts.memos > 0` — at least one `useMemo` recomputed.
- No `trasherCounts` in `renderedByCommit` while the component still appears in `sourcesByCommit` → render trigger is *not* amplifier-driven; look at `propChanges` for ref-changed props from above, or treat as self-update (`isSelfSource: true`).
- Same `sourceId` appears in `renderedByCommit` across many commits with persistent non-zero `trasherCounts` → confirmed trasher; trace the hook with `avalanche-debug-hook <clientId> <sourceId> <hookIndex>`.

### Reading `propChanges`

`propChanges` lists only the props that differed between prev and current. No `propChanges` means the parent passed the same prop identities — re-render trigger is internal (state/context/store/parent re-render of a non-memoized child).

Reading rules:
- `kind: 'ref-changed'` on a callback or object prop → likely upstream amplifier; trace the parent's `useCallback`/`useMemo` deps.
- `kind: 'scalar-changed'` → data actually changed; the render is justified if the component should react to that value.
- `kind: 'added'` / `'removed'` on optional props → parent toggled a feature; verify the toggle is intentional.
- No `propChanges` but component re-rendered → ancestor cascade. Look up the parent chain, not at this component.

### `renderedByCommit` prop-change taxonomy — read the simple case first

`renderedByCommit` is not a "why-did-you-render for three tricks". It is a per-commit prop-diff ledger. Read every rendered entry in this order:

| # | Signal | What it means | Typical classification | Fix layer / next step |
|---|---|---|---|---|
| 0 | `isSelfSource: true` | This component scheduled work for itself in this commit. | **self-source** | Inspect this component's changed hooks / callbacks / effects (P-07). |
| 1 | only `scalar-changed` props | Data actually changed (`number`, `string`, `boolean`, `null`). | **legitimate re-render** unless invariant says the scalar should not affect this child. | Verify invariant. If legitimate, stop; if not, move the scalar boundary up. |
| 2 | `added` / `removed` optional props | Parent toggled a feature or branch. | **conditional prop / branch change** | Verify the toggle is intentional; inspect the parent conditional if unexpected. |
| 3 | no `propChanges` and no `isSelfSource` | Parent/ancestor rendered and this component came along. | **cascade collateral** | Walk to `parentSourceId`; do not blame this component. |
| 4 | `ref-changed` function prop | Callback identity changed. | **identity churn** or legitimate callback update. | Walk to parent; inspect `useCallback` deps or inline function creation. |
| 5 | `ref-changed` object/array prop | Object identity changed. `sameShallow: true` means the contents are equal; `changedKeys` names the keys that changed. | `sameShallow`: **identity leak**. `changedKeys`: legitimate data change for those keys, unless the component reads none of them. | Walk to parent; inspect literal creation, selectors, `useMemo`, data normalization. |
| 6 | `ref-changed` `children` | JSX children identity changed. | **caller-created ReactElement churn** | Caller-only fix: hoist/memoize children at the caller. |
| 7 | any prop changes plus `trasherCounts > 0` | Prop churn and local hook churn are both present. | **mixed leak + amplifier** | Separate caller leak from local amplifier; prove both before editing. |

General rules:
- Start with the simple explanation. A `scalar-changed` prop is often correct behavior, not a performance bug.
- `ref-changed` means identity changed, not automatically "bad". It becomes a bug only when the component should not observe that identity change or when it defeats a memo boundary.
- If there are no `trasherCounts` and the only suspicious signal is `ref-changed`, treat it as a **caller-side identity question** first. Walk to `parentSourceId`; do not hunt for amplifier hooks in the child.
- If an entry has neither `propChanges` nor `isSelfSource`, it is collateral. Keep walking upward until the first self-source, context wave, or identity-changing parent.

#### Common identity fingerprints

These are common examples, not an exhaustive taxonomy:

| Pattern | Fingerprint | Reading | Caller-side remediation |
|---|---|---|---|
| Callback dep churn | `{ name: <callback>, kind: "ref-changed", current: "function <name>" }` often with a scalar dep also `scalar-changed` in the same commit | `useCallback(fn, [dep])` is tied to a dep that changes during the same interaction. | Use a functional updater (`setX((v) => !v)`) to remove the dep, or otherwise stabilize the callback identity. |
| Array/object literal | `{ name: <prop>, kind: "ref-changed", current: "object{…}" }` or `"array(n)[…]"`, with no `prev` and source shows a literal or freshly allocated object | Parent recreates an equal-looking object each render; `React.memo` shallow compare fails. | Hoist literal to module scope, `useMemo(() => […], [])`, or pass a stable reference. |
| JSX children pass-through | `{ name: "children", kind: "ref-changed", current: "element <Row>" }` or `"array(n)[element <Row>, …]"` on a memoized parent | Inline JSX creates fresh `ReactElement` objects/arrays each parent render; the memoized parent cannot save itself. | Caller-only: hoist children into a stable variable or pass memoized element children. |

### Reading `propChanges` + `trasherCounts` together — the source classification table

| `isSelfSource` | `propChanges` | `trasherCounts` | Classification | Next step |
|---|---|---|---|---|
| `true` | n/a | n/a | **self-source** (component triggered its own re-render) | P-07 hook interrogation on this component |
| absent | yes (ref-changed) | n/a | **collateral from upstream amplifier** | Walk to `parentSourceId`, run P-06 on that |
| absent | yes (scalar-changed only) | n/a | **legitimate re-render** (data changed) | Verify invariant — may be correct behavior |
| absent | absent | yes | **trasher** (this component is the amplifier) | P-07 on the changed hook |
| absent | absent | absent | **pure cascade collateral** | Walk to `parentSourceId`, look for the real trigger |

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
| **Commit details** | `sourcesByCommit[N]`, `metricsByCommit[N]`, `renderedByCommit[N]` | Which sources, rendered components, and restart counters were involved in that commit | Whether a downstream component could have bailed out |
| **Fiber/probe data** | owners, parents, props, hooks, source locations | How values crossed boundaries for a target component | Population scale |
| **Code** | hook deps, provider values, selectors, keys, memo boundaries | The implementation cause and fix layer | Runtime frequency without a capture |

### Read from broad to narrow

1. **Population shape.** Use raw React metrics to see whether the window is mostly render work, DOM work, mount work, context propagation, or discarded/restarted work.
2. **Commit selection.** Use `commit-list` to pick the commit that best represents the suspicious stat shape (`collateral`, `sources`, `restarts`, `performedWork`, `effects`, `memos`, `callbacks`, `contextUpdates`, `unmountedComponents`, `unmountedSubtrees`, `ticks`).
3. **Per-commit join.** Use `commit-peek` and read `commitStats[N]`, `sourcesByCommit[N]`, `metricsByCommit[N]`, and `renderedByCommit[N]` together.
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
- `renderedByCommit[N]`
- `commitTimings[N]`

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

Treat it as a strong proxy, not a courtroom fact. Confirm cause with `metricsByCommit[N]` counters (`commit-peek N metrics`, adapter modes only):
- `externalStoreRestartCount` — `useSyncExternalStore` races
- `priorityInterruptedWorkCount` — higher-priority work preempted this render
- `interruptedWorkCount` — other interrupted work

Large `restarts` with zero counters: still real, but needs more skepticism.
Large `restarts` with large `priorityInterruptedWorkCount`: concurrent-mode priority thrash. Look for what triggers the high-priority interruption.

## Scoping a capture

Three tools:
- temporal: short reload window, short settle, low commit cap
- ranking: `commit-list` by `collateral`, `restarts`, `contextUpdates`, or `sources`
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
| **After** | Did this wave stop, or did it leave repeating noise? | `commit-list` after N, sort by `collateral`, `restarts`, `effects`, `memos`, or `callbacks`, and check whether the same `sourceId` repeats in `commit-peek ... sources` |

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
- `commitCount: 0` with an installed detector: check `integrationMode` in `avalanche-status`. `none` or no commits after an interaction means the DevTools hook was installed after React DOM loaded; reload through a route that loads Chippy before page scripts, or reproduce a render after `avalanche-install`.
- Duplicate `__AVALANCHE__ already defined`: same bundle injected twice. Fix startup order before trusting results.
- On instrumented hosts, the adapter's metrics object may be reset during bootstrap/hydration. The adapter must restore the live metrics object before capture health is judged.

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
   chippy.sh avalanche-offline .chippy-captures/run.json commit-list 30 sources
   chippy.sh avalanche-offline .chippy-captures/run.json commit-list 30 contextUpdates
   ```
3. **Choose ranges by wave/question.** Setup, main wave, continuation/noise, or first-principles invariant. `commit-list` ranks globally; use the ranked rows plus timestamps/commit ids to define ranges.
4. **Reduce each range before delegation.** Use `commit-peek` on selected commit ids and `source-search --name` for known components. Give the subagent only the top suspicious commits and relevant stats/sources/metrics/rendered slices. No raw exports.
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
