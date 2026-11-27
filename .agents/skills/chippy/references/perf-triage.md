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

Note the build type (development, profiling, production). Development builds and
StrictMode inflate render cost; label development-only costs as such. Without a
capture there is nothing to classify: stop and capture.

## Step 1. Waited or worked?

A user can wait because nothing was happening on the main thread (network,
timers, debounce), or because the main thread was busy (render, commit, effects,
layout, other scripts). Render counts do not answer a "waited" complaint.
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
   Gaps shorter than
   `minIdleMs` (default 100 ms) are left out. `perceived.firstResponse`
   (`t`, `commitId`, `rendered`) is the first commit after the action. The
   `text` rendering prints both when no fallback was shown.
2. `avalanche-perf <clientId>`: summary `totalBlockingMs`, `worstInteractionMs`,
   `longFrames` (a count); per event entry `inputDelay`, `processing`,
   `presentationDelay`; each `long-animation-frame` entry's `scripts[]`
   (`invoker`, `sourceURL`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`).
3. `avalanche-network <clientId>`: per request `startedAfter {commitId, gapMs}`,
   `startedDuringRender`, `landedBefore {commitId, gapMs}`, `commitsInFlight`,
   `cached`, `status`, and the relations `repeatOf`, `landedAfterNewer`,
   `chainedAfter`; summary `byInitiator`, `repeats`, `mostRepeated`,
   `landedAfterNewer`, `chained`, `longestChain`.

Classify:

| Reading | Class | Next |
| --- | --- | --- |
| The long wait is covered by requests or an idle gap (`waitedMs` for a fallback, otherwise `perceived.idleGaps[].ms`); `updatesDuring` is low; `totalBlockingMs` is small next to the wait | Waited | Step 2N |
| `worstInteractionMs` or `longFrames` dominate; `processing` or `presentationDelay` is large | Worked | Step 2W |
| Both are large | Both | Report both; work on the larger share of the user's wait first |
| No wait, long frame, request, or commit in the window lines up with the symptom, or `perceived.settledAt` is null and `stillWaiting` names a boundary the action never reached | Missed | The window or the action was wrong; recapture before classifying |

`perceived.updatesAfterSettled.commits > 0` does not by itself mean the capture
missed. It counts commits after the last fallback cleared and before the next
input; when they line up with the complaint, read them under Step 2W.

## Step 2N. Waited: what kind of wait?

| Evidence | Pattern |
| --- | --- |
| The first request starts only after the new view mounts; `startedAfter` points at a mount commit long after the action | [NW-1 late start](patterns-latency.md#nw-1-late-start-fetch-on-mount) |
| Each request starts after the previous response: `chainedAfter` is set on each, and the summary `longestChain` lists the sequence and its total `ms` | [NW-2 waterfall](patterns-latency.md#nw-2-request-waterfall) |
| A `perceived.idleGaps[]` entry starts at the action, ends at the first request or commit (`endedBy`), and is close to a debounce wait | [LT-1 trailing-only debounce](patterns-latency.md#lt-1-trailing-only-debounce-on-a-discrete-action); two such gaps: [LT-2](patterns-latency.md#lt-2-stacked-debouncers) |
| The same URL from the same initiator repeats (`repeatOf`, summary `mostRepeated`) on commits that did not change its inputs | [EF-4 refetch](patterns-effects.md#ef-4-fetch-in-effect-refetch-and-race), then [EF-1](patterns-effects.md#ef-1-effect-re-fires-from-identity) for the cause |
| A response for an older input lands after a newer one (`landedAfterNewer` on the older request), and the screen shows older data or flips twice | [NW-3 stale response race](patterns-latency.md#nw-3-stale-response-race) |
| The change appears only after the save returns, or no save request follows the last edit when the view closes | [LT-3 apply vs persist](patterns-latency.md#lt-3-apply-vs-persist) |

The relations are timing, not proof of cause. `repeatOf` matches by URL and
initiator only: Resource Timing has no method or body, so two POSTs with
different bodies count as repeats. `landedAfterNewer` compares requests to the
same endpoint (path, plus a GraphQL operation name when the URL carries one).
`chainedAfter` names the response that landed before the commit this request
started after, or one that finished at most 15 ms before it started. Confirm
each relation in source before you name a pattern.

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
2. Read `scripts[]`. Attribution names the entry point of a frame, and in a React
   app that is often React's scheduler, so a React `sourceURL` does not single out
   a component. A third-party `sourceURL` (analytics, ads, an extension) means the
   cost is not a React pattern: report it as script-bound and stop.
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

## Step 4. Write the line, then choose a fix

Write the triage line with the pattern id and outcome. If the question is whether
React Compiler would solve it, read [react-compiler.md](react-compiler.md). To
choose a fix, follow the [fix ladder](fixing-performance.md#fix-ladder) and the
[report gate](fixing-performance.md#report-gate).
