# Performance triage

This file sets the read order for performance complaints. Start here whenever the
user says something is slow, late, janky or flickers. Other references explain
individual views; this one says which view to read first and how to sort the
complaint into a pattern before anyone proposes a fix.

The output of triage is one line:

```
trigger -> mechanism -> collateral -> user-visible cost   [pattern id, outcome]
```

Outcomes use one vocabulary everywhere: **Confirmed** (reproduced with runtime
evidence), **Needs evidence** (a named gap blocks the claim), **Observation**
(real but not shown to cost the user anything; carries no fix), **Rejected**
(evidence contradicts the hypothesis).

## Step 0. Restate the complaint

Name the user action (click, type, navigate, open, load) and the symptom (late,
janky, frozen, flicker, wrong data). Capture that action:

- An interaction on an open page: `avalanche-arm <clientId> <origin>`, perform the
  action, then `avalanche-status <clientId>`.
- Initial load: `reload-with-avalanche <clientId> <origin> 0 15000 5000`.
- A client-side route change: arm, then click the link. The page keeps its
  document, so the click is the origin like any other interaction.
- A full document navigation (the server returns a new page): the capture in the
  old document, the click included, does not carry over. Open the destination and
  capture it as an initial load.
- A browser Back or Forward press is not a recorded input: Avalanche records
  click, keydown, keyup, input, change and submit by default, and no history
  events. The default window then starts at the first commit after the
  capture's first recorded input (or at its first commit when none was
  recorded), not at the press. The origin is the earliest recorded input up to
  5 s before that commit (`origin.kind: "interaction"`), otherwise the commit
  itself (`origin.kind: "commit"`). Arm right before pressing Back or Forward
  and do not touch the page in between, or pass `avalanche-timeline` a
  `fromCommit` set to the first commit after the press. Say in the report which
  point the times are measured from.

Note the build type (development, profiling, production). Development builds and
StrictMode inflate render cost; label development-only costs as such. Without a
capture there is nothing to classify: stop and capture.

## Step 1. Waited or worked?

A user can wait because nothing was happening on the main thread (network,
timers, debounce), or because the main thread was busy (render, commit, effects,
layout, other scripts). Render counts do not answer a "waited" complaint. Three
more classes cover the rest: Moved (content jumps), Stuck (a boundary that never
resolves) and Missed (the capture did not hold the action's work).
`avalanche-summary <clientId>` gives the totals, the timeline text, and the `perf`
summary in one read; then read, in this order:

1. `avalanche-timeline <clientId>`: `perceived.waits[]` (`waitedMs`, `lockedBy`,
   `unlockedBy`, `lastRequests[].gapMs`, `updatesDuring`), `perceived.firstLockAt`,
   `perceived.settledAt`, `perceived.updatesAfterSettled` (`commits`, `rendered`),
   and `screen` (`vc50`, `vc90`, `vc100`). `perceived.waits[]` lists Suspense
   fallbacks only: a debounce or a request with no fallback on screen leaves it
   empty and `firstLockAt` null. For such a wait read `perceived.idleGaps[]`
   (`from`, `until`, `ms`, `endedBy`, longest first): stretches after the action
   with no request in flight, no long frame, and no React render or commit, and
   what ended each one (a request, a commit, or a long frame). A gap starts at
   the latest input before it, so for typing it runs from the last keystroke.
   Gaps shorter than `minIdleMs` (default 100 ms) are left out.
   `perceived.firstResponse` (`t`, `commitId`, `rendered`) is the first commit
   after the action. The `text` rendering prints both when no fallback was shown.
   A spinner or skeleton driven by state is not a fallback and is not in
   `perceived.waits[]`; Chippy does not report whether one was visible. Read
   `avalanche-dom-diff <clientId>` for the `+` op that inserted it and the `-` op
   that removed it, and see
   [Feedback during a wait](patterns-latency.md#feedback-during-a-wait).
2. `avalanche-perf <clientId>`: summary `totalBlockingMs`, `worstInteractionMs`,
   `longFrames` (a count); per event entry `inputDelay`, `processing`,
   `presentationDelay`; each `long-animation-frame` entry's `scripts[]`
   (`invoker`, `sourceURL`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`).
3. `avalanche-network <clientId>`: per request `startedAfter {commitId, gapMs}`,
   `startedDuringRender`, `landedBefore {commitId, gapMs}`, `commitsInFlight`,
   `cached`, `status`, and the relations `repeatOf`, `landedAfterNewer`,
   `chainedAfter`; summary `byInitiator`, `repeats`, `mostRepeated`,
   `landedAfterNewer`, `chained`, `longestChain`. For any wait, also run
   `avalanche-network <clientId> 50 start '' script,link`. A `perceived.waits[]`
   `lastRequests` label (host and last path segments) that matches one of these
   rows, or a script row that covers most of the wait (`waitedMs` for a
   fallback, otherwise the time from the action to `perceived.firstResponse`),
   is code loading, not data. On a warm repeat of the action the row is absent or `cached`.

Classify:

| Reading | Class | Next |
| --- | --- | --- |
| The long wait is covered by requests or an idle gap (`waitedMs` for a fallback, otherwise `perceived.idleGaps[].ms`); `updatesDuring` is low; `totalBlockingMs` is small next to the wait | Waited | Step 2N |
| `worstInteractionMs` or `longFrames` dominate; `processing` or `presentationDelay` is large | Worked | Step 2W |
| Both are large | Both | Report both; work on the larger share of the user's wait first |
| Content jumps: `avalanche-perf <clientId> layout-shift` entries line up with the symptom. Read the entries, not `summary.cls`: `cls` leaves out shifts with `hadRecentInput: true`, so a shift right after the click is missing from it | Moved | [LS-1](patterns-render.md#ls-1-late-or-resized-content-shifts-layout) |
| `perceived.settledAt` is null and `stillWaiting` names a boundary the action reached: its `perceived.waits[]` entry has `from` at or after 0 and `until: null`, and it is still on its fallback in a recapture that runs well past the expected response | Stuck | Not a capture error: report it as Confirmed with no pattern id and read [Not a wait or work](#not-a-wait-or-work) |
| No wait, long frame, request, or commit in the window lines up with the symptom, or `stillWaiting` names only a boundary the action never reached (its fallback was already shown before the origin, or the capture ended before the action's work did) | Missed | The window or the action was wrong: recapture with a longer window before classifying; a boundary the action reached that is still on its fallback is Stuck. When the complaint is idle DOM churn, background traffic, a hydration error or a push update, read [Not a wait or work](#not-a-wait-or-work) instead |

`perceived.updatesAfterSettled.commits > 0` does not by itself mean the capture
missed. It counts commits after the last fallback cleared and before the next
input; when they line up with the complaint, read them under Step 2W.

When the app reports its own load or interaction metric: a measure that ends
before `perceived.settledAt` or `screen.vc90` does not cover the visible update.
Its row in the `avalanche-timeline` text (`measure <name> → +<end>`, or
`lanes.perf[]` entries with `kind: "measure"` in `format full`) is in ms from the
timeline origin, like `settledAt` and `vc90`; `avalanche-perf`
`summary.longestMeasure` uses page-clock `startTime` and `duration`. Report the
difference as a metric gap, an Observation, not as a cost.

## Step 2N. Waited: what kind of wait?

| Evidence | Pattern |
| --- | --- |
| The first request starts only after the new view mounts; `startedAfter` points at a mount commit long after the action | [NW-1 late start](patterns-latency.md#nw-1-late-start-fetch-on-mount) |
| The first request starts within a frame of the action (its timeline `start` is under about 16 ms) and its own duration covers most of the wait | [NW-1](patterns-latency.md#nw-1-late-start-fetch-on-mount) (start it ahead of the action) and [NW-5](patterns-latency.md#nw-5-refetch-of-data-already-shown) (serve a repeat from cache); a real server cost only after both are rejected |
| A `script` or `link` row covers the fallback on the first open only; a warm repeat has no such row, or a `cached` one | [NW-4 lazy code](patterns-latency.md#nw-4-lazy-code-on-interaction) |
| A script row is followed by a request `startedAfter` the commit its code mounted, or by another script row that starts when it lands | [NW-4](patterns-latency.md#nw-4-lazy-code-on-interaction) (code waterfall), with [NW-2](patterns-latency.md#nw-2-request-waterfall) for the chain |
| The same request repeats on a reopen or a return to the view: `repeatOf` set, `cached: false`, `startedAfter` the remount commit, and a wait | [NW-5 refetch of data already shown](patterns-latency.md#nw-5-refetch-of-data-already-shown); when a close, reset or collapse unmounted the owner, `avalanche-commit-list <clientId> 15 unmountedSubtrees` shows it and [RM-1](patterns-render.md#rm-1-key-induced-remount) applies if the unmount was unintended |
| Content the user did not ask for yet sits on the main view's wait: its request or chunk is in that wait's `lastRequests`, or the main view unlocks only after it lands | [NW-6 non-critical content](patterns-latency.md#nw-6-non-critical-content-on-the-critical-path); prove it with [P-23](procedures.md) |
| After the action, a boundary that was showing content locks: a `perceived.waits[]` entry whose `lockedBy` commit has `hide` ops on that content in `avalanche-dom-diff` | [NW-7 fallback replaces content](patterns-latency.md#nw-7-fallback-replaces-content-already-shown) |
| The same lock, but the `lockedBy` commit has `-` ops on that content: the boundary remounted | [RM-1](patterns-render.md#rm-1-key-induced-remount) first (a transition keeps only content that stays mounted), then [NW-7](patterns-latency.md#nw-7-fallback-replaces-content-already-shown) |
| A read starts right after a write's response lands (`chainedAfter` names the write), and the commit it lands before changes little of the screen (a low `% screen` on its timeline row) | [NW-8 refetch after write](patterns-latency.md#nw-8-refetch-after-write) |
| Each request starts after the previous response: `chainedAfter` is set on each, and the summary `longestChain` lists the sequence and its total `ms` | [NW-2 waterfall](patterns-latency.md#nw-2-request-waterfall) |
| A `perceived.idleGaps[]` entry starts at the action, ends at the first request or commit (`endedBy`), and is close to a debounce wait | [LT-1 trailing-only debounce](patterns-latency.md#lt-1-trailing-only-debounce-on-a-discrete-action); two such gaps: [LT-2](patterns-latency.md#lt-2-stacked-debouncers) |
| Continuous input (typing in a search or filter field): a gap starts at the last keystroke and lasts about the debounce wait before results update | [LT-5 debounce in front of continuous input](patterns-latency.md#lt-5-debounce-in-front-of-continuous-input) |
| The same URL from the same initiator repeats (`repeatOf`, summary `mostRepeated`) on commits that did not change its inputs | [EF-4 refetch](patterns-effects.md#ef-4-fetch-in-effect-refetch-and-race), then [EF-1](patterns-effects.md#ef-1-effect-re-fires-from-identity) for the cause |
| The same URL is in flight at once from sibling consumers (overlapping `startTime` and `endTime`, `repeatOf` with a small `gapMs`), once per row, or twice because the inputs settled after mount | [EF-4 shared query](patterns-effects.md#shared-query) |
| A response for an older input lands after a newer one (`landedAfterNewer` on the older request), and the screen shows older data or flips twice | [NW-3 stale response race](patterns-latency.md#nw-3-stale-response-race) |
| The change appears only after the save returns, or no save request follows the last edit when the view closes | [LT-3 apply vs persist](patterns-latency.md#lt-3-apply-vs-persist) |

The relations are timing, not proof of cause. `repeatOf` matches by URL and
initiator only: Resource Timing has no method or body, so two POSTs with
different bodies count as repeats. `landedAfterNewer` compares requests to the
same endpoint (path, plus a GraphQL operation name when the URL carries one).
`chainedAfter` names the response that landed before the commit this request
started after, or one that finished at most 15 ms before it started. Confirm
each relation in source before you name a pattern.

`lastRequests` and `landedBefore` name candidates, not causes: a request that
ended just before an unlock overlapped the wait, which does not prove the view
waited for it. To prove that one request or chunk gates the view, run
[P-23](procedures.md). Chippy does not record a request's method or body, so a
write can be told from a read only by its URL, and GraphQL requests to one
endpoint share one timeline label unless the URL carries an operation name.

## Step 2W. Worked: where did the time go?

1. Read the phase split of the worst event entry in `avalanche-perf`:
   - `inputDelay` large: the thread was already busy when the user acted.
     Go to [LT-4](patterns-latency.md#lt-4-long-task-blocking-input).
   - `processing` large: event handlers plus the render and commit they start.
     Continue with items 2 and 3 below, then Step 3W.
   - `presentationDelay` large: layout, paint, or a large DOM mutation. Check
     `forcedStyleAndLayoutDuration` and `avalanche-dom-diff <clientId>`. Usually
     [EX-1](patterns-render.md#ex-1-expensive-render-with-real-input-changes) or
     [RW-5](patterns-render.md#rw-5-list-append-re-renders-every-row).
   - A long frame on a first open or a route switch whose `commits.during`
     commits are mostly `+` ops in `avalanche-dom-diff`: a mount, not a
     re-render. Go to [EX-2](patterns-render.md#ex-2-large-mount-commit).
   - Scrolling a virtualized list: read the "Virtual window shift" part of
     [RW-5](patterns-render.md#rw-5-list-append-re-renders-every-row).
2. Read `scripts[]`. Attribution names the entry point of a frame, and in a React
   app that is often React's scheduler, so a React `sourceURL` does not single out
   a component. A third-party `sourceURL` (analytics, ads, an extension) means the
   cost is not a React pattern: report it as script-bound and stop. A
   first-party `sourceURL` that is not React (the app's own module, or a library
   bundled with it): report the `sourceURL` and `sourceFunctionName`, perform the
   action twice in one capture, and compare the two `event` entries'
   `processing`. A first input much slower than the repeat is one-time
   initialization or module evaluation: go to
   [EX-2](patterns-render.md#ex-2-large-mount-commit), or
   [NW-4](patterns-latency.md#nw-4-lazy-code-on-interaction) when a `script` row
   landed just before the frame. When both are about as slow, the cost recurs:
   go to [LT-4](patterns-latency.md#lt-4-long-task-blocking-input), or continue
   with item 3 when React commits share the frame (`commits.during`).
3. Read broad to narrow: `avalanche-summary <clientId>` `topCommits` →
   `avalanche-hot-sources <clientId> 20` →
   `avalanche-commit-list <clientId> 15 collateral` (also `sources`, `restarts`,
   `unmountedSubtrees`, and `effects` in `full` or `amplifiers` mode) →
   `avalanche-commit-peek <clientId> <commitId> stats,sources,rendered,hooks,timing 6 40`
   for the worst commit.

## Step 3W. Trigger vs collateral

For the worst commit, separate what started the commit from what re-rendered
because of it. A hot component is not a cause.

- **Trigger:** `rendered[]` rows with `isSelfSource: true` (commit-peek), the
  commit's `latestAction`, and, for top commits, `avalanche-summary`
  `topCommits[].sources[].changedHooks[]` (`index`, `sameContent`). In every
  detection mode except `stats`, commit-peek `sources[].trashers[]` adds
  `prevValue` and `currentValue` for each changed hook.
  - `changedHooks[].sameContent: true`: state was replaced with an equal value under a
    new identity. Look upstream for [RW-1](patterns-render.md#rw-1-unstable-identity-reaching-a-memo-child)
    or [RW-7](patterns-render.md#rw-7-store-selector-returns-a-new-object); if the
    setter runs in an effect, [EF-2](patterns-effects.md#ef-2-derived-state-via-effect)
    or [EF-3](patterns-effects.md#ef-3-effect-chains).
  - `sameContent: false`: a real change. Do not "fix" the trigger; contain the
    collateral (RW-1 to RW-4) or accept it.
- **Collateral:** `rendered[]` rows without `isSelfSource`, walked up through
  `parentSourceId` and `ownerSourceId`. Their `propChanges[]` say what the render
  received: `kind: "ref-changed"` with `sameShallow: true` (a new object with the same
  values) or `changedKeys`. `avalanche-summary` `topCommits[].rebuiltProps` groups
  the same rebuilt prop across components.
  - `sameShallow: true` is waste only under a memo boundary that could have bailed
    out, or when measured render time matters. `rendered[]` does not say whether a
    row is wrapped in `memo`; confirm from the owner chain (`probe-owners`) or
    source before calling it waste.
  - Many consumers of one provider and `contextUpdates > 0`: [RW-3](patterns-render.md#rw-3-context-fan-out).
  - Siblings re-render along with the state owner: [RW-4](patterns-render.md#rw-4-state-held-too-high).
  - Every row re-renders on append: [RW-5](patterns-render.md#rw-5-list-append-re-renders-every-row).
- **Effects:** `avalanche-commit-list <clientId> 15 effects` and
  `rendered[].trasherCounts.effects`. `trasherCounts` are collected only when the
  capture ran in `full` or `amplifiers` detection mode, and the default effect
  thrash mode counts only non-primitive dependencies. Absence is not proof of no
  churn; recapture with `avalanche-recapture <clientId> full`. An effect that runs
  on every commit: [EF-1](patterns-effects.md#ef-1-effect-re-fires-from-identity).
  A commit whose trigger was set from an effect of the previous commit:
  [EF-2](patterns-effects.md#ef-2-derived-state-via-effect) or
  [EF-3](patterns-effects.md#ef-3-effect-chains).
- **Remount:** `unmountedSubtrees` or `unmountedComponents` non-zero on an update
  that should keep state: [RM-1](patterns-render.md#rm-1-key-induced-remount).
- **Expensive component:** large render time (`commit-peek ... timing`:
  `render.workMs`, `longestSliceMs`) on the commits where the component renders
  with real input changes:
  [EX-1](patterns-render.md#ex-1-expensive-render-with-real-input-changes).

A render is not a cost until measured. Chippy measures render time per commit,
not per component. Attribute it to one component with the React DevTools
Profiler on a profiling build, or with an A/B where one arm removes or memoizes
the component. Without that attribution, or below about 1 ms per commit on a
production or profiling build, report the row as an Observation.

## Not a wait or work

Some complaints fit neither class. Read the evidence below and report each as an
Observation unless it is shown to cost the user something; a boundary the action
reached and that never resolves is reported as Confirmed, not an Observation.

| Lens | Evidence |
| --- | --- |
| A boundary that never resolves | `page-boundaries <clientId>` shows it still on its fallback; the `avalanche-timeline` `boundaries[].location.chain` for its `stillWaiting` key names the components around it. Chippy does not name the promise it waits on, and `avalanche-network` lists a request only when it finishes, so a hung request is absent; check the browser's network panel for it. |
| Background or beacon traffic | `avalanche-network <clientId> 50 start '<url regex>'` (or `avalanche-network <clientId> 50 start '' beacon` for `sendBeacon` calls), and read `startedAfter`: rows with no input or commit near their start, or at a fixed interval, are background. Before calling a gap idle, read the timeline without `exclude`. |
| DOM churn while the page is idle | An async `eval-page <clientId> -` script that only waits (`await new Promise((r) => setTimeout(r, 3000))`) while nobody touches the page. `sideEffects.domMutations` above 0 with `rootsCommitted: 0` is DOM written outside React, which `avalanche-dom-diff` does not record. CSS animations are not DOM mutations and do not show here. |
| Hydration errors | Chippy does not report React recoverable or hydration errors as their own kind. Capture the load with `reload-with-avalanche` and read `avalanche-console <clientId> error`: React's default `onRecoverableError` reaches the console or the window error event, and both are recorded. A custom `onRecoverableError` that does not log leaves nothing to read. |
| A remote or push update | Chippy does not record WebSocket or server-sent event messages. Arm before the update arrives, note by hand when the external event was sent, and read the commit that applied it in `avalanche-timeline`; with no input, the origin is the first commit. |

## Step 4. Write the line, then choose a fix

Write the triage line with the pattern id and outcome. If the question is whether
React Compiler would solve it, read [react-compiler.md](react-compiler.md). To
choose a fix, follow the [fix ladder](fixing-performance.md#fix-ladder) and the
[report gate](fixing-performance.md#report-gate).
