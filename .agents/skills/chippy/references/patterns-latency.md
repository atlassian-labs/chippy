# Latency and network patterns

These are the patterns for "waited" complaints: the user waited while the main
thread was mostly idle, because of a timer, a debounce or the network. They also
cover long tasks that block input. Reach them from
[perf-triage.md](perf-triage.md) Step 2N or Step 2W. The card fields are explained
in [patterns-render.md](patterns-render.md).

- Timers and input: [LT-1](#lt-1-trailing-only-debounce-on-a-discrete-action)
  trailing-only debounce, [LT-2](#lt-2-stacked-debouncers) stacked debouncers,
  [LT-3](#lt-3-apply-vs-persist) apply vs persist,
  [LT-4](#lt-4-long-task-blocking-input) long task blocking input,
  [LT-5](#lt-5-debounce-in-front-of-continuous-input) debounce in front of
  continuous input.
- Network and code: [NW-1](#nw-1-late-start-fetch-on-mount) late start,
  [NW-2](#nw-2-request-waterfall) waterfall,
  [NW-3](#nw-3-stale-response-race) stale response race,
  [NW-4](#nw-4-lazy-code-on-interaction) lazy code on interaction,
  [NW-5](#nw-5-refetch-of-data-already-shown) refetch of data already shown,
  [NW-6](#nw-6-non-critical-content-on-the-critical-path) non-critical content on
  the critical path, [NW-7](#nw-7-fallback-replaces-content-already-shown)
  fallback replaces content already shown,
  [NW-8](#nw-8-refetch-after-write) refetch after write.
- [Feedback during a wait](#feedback-during-a-wait): what the user saw while
  nothing showed a fallback.

Render counts do not explain a wait. Read `avalanche-timeline`, `avalanche-network`
and `avalanche-perf` first; read source only to confirm what the timeline shows.

## Timing mechanisms: keep them, change the edge

A debounce, throttle, batch or cache was added to protect something: server load,
write ordering, render cost, analytics volume. Removing it removes the protection.
The usual fix is one knob on the existing mechanism.

lodash `debounce(fn, wait, options)` semantics (lodash 4):

| Option or method | Behavior |
| --- | --- |
| default (`leading: false`, `trailing: true`) | `fn` runs `wait` ms after the last call. A single click waits the full `wait`. |
| `leading: true, trailing: true` | The first call runs at once; the trailing call runs only if there was another call during the wait. Bursts still coalesce. |
| `leading: true, trailing: false` | The first call runs at once; the rest of the burst is dropped, including the final value. Wrong for saves. |
| `maxWait` | Upper bound on how long `fn` can be delayed during a continuous burst. |
| `flush()` | Runs the pending call now. Use it when the pending call must not be lost or delayed. |
| `cancel()` | Drops the pending call. |
| `throttle(fn, wait)` | `debounce` with `leading: true`, `trailing: true` and `maxWait: wait`. |

Other debounce helpers (hook libraries, hand-written `setTimeout`) have different
defaults; read the one in use before naming its edge.

Save vs read rule: **flush saves, cancel reads.** A pending save that is cancelled
on unmount, close or navigation loses the user's edit. A pending search or read
that is cancelled loses nothing.

## LT-1. Trailing-only debounce on a discrete action

- **Symptom:** a click, Enter or toggle feels late by the same amount every time
  (for example 300 ms).
- **Prove the problem:** `avalanche-timeline` shows a wait after the action with no
  main-thread work and no request in flight, close to the debounce `wait`: a
  `perceived.idleGaps[]` entry starts at the action (or the last keystroke), lasts about `wait` ms,
  and its `endedBy` names the request or commit the debounce released
  ([perf-triage](perf-triage.md#step-1-waited-or-worked)). `perceived.waits[]`
  stays empty when no fallback is shown. `startedAfter` links a request to the
  commit before it only within the network window (250 ms by default); to read
  the gap there, pass a larger window:
  `avalanche-network <clientId> 30 start "" "" 2000`. Source confirms a trailing
  debounce.
- **What it protects:** coalescing bursts, server load, write ordering.
- **Smallest fix:** keep the debounce and change its edge: `leading: true` (with
  `trailing: true` so the last value of a burst still lands), or call `flush()` on
  Enter, blur and submit. On clear, `cancel()` and act at once.
- **Larger fixes:** debounce only the continuous input (typing) and send discrete
  actions straight through; throttle continuous streams.
- **Compiler:** no.
- **Wrong when:** the action is continuous and the leading edge would fire on a
  partial value (typing: see
  [LT-5](#lt-5-debounce-in-front-of-continuous-input)); leading plus trailing
  doubles requests the server cannot absorb (keep trailing-only and `flush()` on
  the discrete action instead; `maxWait` caps the delay and can add calls, so it
  does not reduce them).
- **Prove the fix:** the gap disappears from `avalanche-timeline` across at least 3
  interleaved samples per arm ([ab-testing](ab-testing.md#verifying-a-fix));
  request count unchanged or as announced; `ab-compare` behavior `equivalent` on
  the final DOM.

## LT-2. Stacked debouncers

- **Symptom:** the delay is the sum of several waits (a component debounce, a hook
  debounce, a client batch).
- **Prove the problem:** `perceived.idleGaps[]` holds a gap longer than any
  single configured wait, or two gaps separated by a small commit (the first
  ended by a commit, the second by the request); source shows
  more than one coalescing layer on the same path.
- **What it protects:** each layer was added for a resource: render cost, server
  load, analytics volume.
- **Smallest fix:** keep one coalescing layer, at the owner of the protected
  resource; make the others pass-through or leading-edge.
- **Larger fixes:** centralize the policy in the shared client. When the layer is
  shared, change it at its owner; never bypass a shared mechanism for one caller.
- **Compiler:** no.
- **Wrong when:** the layers protect different resources and each is measured as
  necessary.
- **Prove the fix:** the gap equals one wait or less; request volume unchanged
  within noise.

## LT-3. Apply vs persist

- **Symptom:** the UI waits for a save before showing the change, or a debounced
  save is lost when the view closes.
- **Prove the problem:** the commit that shows the change follows the save
  response (`landedBefore` links it to the save request). For loss: after the last
  edit, no save request appears in `avalanche-network` before the view unmounts.
- **What it protects:** waiting for the server avoids showing a change that then
  fails; debouncing protects write volume and ordering.
- **Smallest fix:** apply locally at once and persist in the background; `flush()`
  pending saves on unmount, and on `pagehide` (or `visibilitychange` to hidden)
  with a request that survives unload (`fetch` with `keepalive: true` or
  `navigator.sendBeacon`); `cancel()` only reads. React's
  `useOptimistic` shows the optimistic value while an Action runs, and its setter
  must be called inside an Action or transition.
- **Larger fixes:** serialize or version writes (`useActionState` runs queued
  actions in order; a version check rejects stale writes); show failure and roll
  back.
- **Compiler:** no.
- **Wrong when:** the operation is irreversible or often rejected. Aborting a write
  request does not undo a server mutation.
- **Prove the fix:** the change appears in the first commit after the action; the
  save request appears after close in `avalanche-network`; a failure scenario in
  `ab-compare` shows the rollback.

## LT-4. Long task blocking input

- **Symptom:** the page ignores a click or keypress for hundreds of milliseconds;
  typing stutters.
- **Prove the problem:** `avalanche-perf`: the worst event entry has a large
  `inputDelay` (busy before the input) or `processing` (handler plus render);
  the `long-animation-frame` entries carry `scripts[]`. Script attribution names the entry point of the
  work, which in a React app is often React's scheduler, so continue to
  `avalanche-commit-peek ... timing,rendered` for the component cost. A third-party
  `sourceURL` is not the app's React code. Interaction to Next Paint is good at
  200 ms or less at the 75th percentile in the field.
- **What it protects:** synchronous work in a handler keeps state consistent before
  the next paint.
- **Smallest fix:** in a long handler, make the visual update first, then yield
  (`scheduler.yield()` where supported, `setTimeout` otherwise) before the
  non-urgent work.
- **Larger fixes:** `useTransition` for the non-urgent render; split hydration;
  move pure computation to a worker; reduce third-party script cost.
- **Compiler:** no, unless the time is identity-driven re-render
  ([RW-1](patterns-render.md#rw-1-unstable-identity-reaching-a-memo-child)).
- **Wrong when:** the work must finish before the next paint for correctness.
- **Prove the fix:** `worstInteractionMs` and the large phase improve across at
  least 3 interleaved samples; `ab-compare` behavior `equivalent`.

## LT-5. Debounce in front of continuous input

- **Symptom:** in a search or filter field, results update late after the user
  stops typing, or results from one field change when another instance is used.
- **Prove the problem:** measure from the last keystroke, not from the origin
  (the first keystroke). The gap after an input starts at that input, so a
  `perceived.idleGaps[]` entry that starts at the last keystroke and lasts about
  the debounce `wait` is the debounce; its `endedBy` names the request or commit it
  released. When `endedBy` is a commit and no request follows, the debounced work
  is client-side only. The spacing of `lanes.input[]` entries (`format full`)
  is the user's typing rhythm. A state-to-URL sync shows as a second commit right
  after the result commit with the same heavy sources
  (`commit-peek ... sources,rendered`). Source confirms where the debounced
  function is created.
- **What it protects:** server load from one request per keystroke; render cost
  of filtering on every key.
- **Smallest fix:** keep the debounce and tune it: set `wait` a little above the
  measured gap between keystrokes, and set `maxWait` when results should appear
  during continuous typing. Create the debounced function per instance
  (`useMemo` or `useRef`), not at module scope, where every instance shares one
  timer and one instance's call replaces another's.
- **Larger fixes:** when the debounced work is purely client-side (filtering data
  already loaded) and the debounced function drives nothing else (URL writes,
  analytics), `useDeferredValue` on the input value with a memoized slow child
  can replace it; first check in source what else the debounced call does, since
  a deferred render still runs a filter pass whenever the main thread is free.
  Write the URL and the state in one update, or derive the state from the URL, so
  the sync does not add a second full commit.
- **Compiler:** no.
- **Wrong when:** the debounce protects a server from per-keystroke requests;
  `useDeferredValue` defers rendering, not fetches, so keep the debounce and tune
  `wait` and `maxWait`.
- **Prove the fix:** the gap from the last keystroke shrinks to the new `wait` or
  disappears across at least 3 interleaved samples; request count for the same
  typed string unchanged or as announced; `ab-compare` behavior `equivalent` on
  the final DOM.

## NW-1. Late start (fetch on mount)

- **Symptom:** after navigation, opening a panel or loading more, a spinner shows
  for the whole request. Two shapes: the request starts only after the new view
  mounts (late start), or it starts promptly and its own duration is the wait.
- **Prove the problem:** late start: in `avalanche-network` the first request is
  `startedAfter` the mount commit of the new view, well after the action;
  `perceived.waits[]` is `lockedBy` that view's loading boundary and
  `lastRequests` cover most of `waitedMs`. Prompt start: the request starts
  within a frame of the action, and its `duration` covers most of `waitedMs` (or,
  with no fallback, most of the time to the commit it is `landedBefore`). Report
  the request's start offset from the action and its duration. Chippy records no
  per-request server timing (TTFB or `Server-Timing`), so read those in the
  browser's network panel. Before you call a prompt start a server cost, check
  whether the request could start before the action (prefetch on intent, at idle
  or on visibility) or be served from cache
  ([NW-5](#nw-5-refetch-of-data-already-shown)); for a prompt start, those and
  paging less data (cursor pagination) are the levers below.
- **What it protects:** fetching on mount keeps data ownership local and avoids
  loading data the user never opens.
- **Smallest fix:** start the request when intent is known: in the event handler,
  or on hover, focus or pointerdown. Examples: Relay `loadQuery` in the handler;
  a query library's prefetch with a freshness window so the mounted query reuses
  the result; React Router's `<Link prefetch="intent">` (framework mode only).
  Check the API names for the installed version. Earlier still: prefetch likely
  next data at idle after the page settles; prefetch on visibility (an
  `IntersectionObserver` on the load-more control, or a scroll-distance
  threshold); when a preload already exists behind a hover delay, shorten the
  delay (or also start the preload on pointerdown or focus) and keep the preload.
- **Larger fixes:** route-level loaders; load code and data together. For lists,
  cursor pagination (fetch the next page, not the whole list again with a larger
  count), and prefetch the next page when the load-more control becomes visible.
- **Compiler:** no.
- **Wrong when:** intent predicts poorly and prefetching multiplies server load;
  data must be fresh at display time.
- **Prove the fix:** the request starts at or before the action commit, or the
  row is `cached`; `waitedMs` better across at least 3 samples; announce any
  request-count change.

## NW-2. Request waterfall

- **Symptom:** load time is the sum of several sequential requests.
- **Prove the problem:** request B is `startedAfter` the commit that request A is
  `landedBefore` (B's `chainedAfter` names A), repeated down the tree; the
  network summary `longestChain` lists the sequence and its total `ms`; each request starts in a child that mounts
  only after its parent's data arrives. Code-first variant: link 1 is a `script`
  (or `link`) row, a lazy chunk, and the data request is `chainedAfter` it
  because it starts in the code that chunk mounted; nested lazy boundaries chain
  script rows. Read it without an `initiators` filter, or with
  `script,link,fetch,xmlhttprequest`, and fix the code link with
  [NW-4](#nw-4-lazy-code-on-interaction).
- **What it protects:** a real data dependency (B needs A's result), or code
  splitting that delays the child.
- **Smallest fix:** hoist independent queries to the common parent or route and
  start them together.
- **Larger fixes:** one query or a server-side join; prefetch child data in the
  parent's loader. In React 19, suspended siblings are pre-rendered after the
  fallback commits, so their requests start a little later than the first one but
  do not wait for it to finish.
- **Compiler:** no.
- **Wrong when:** B really depends on A's response.
- **Prove the fix:** the requests overlap in `avalanche-network`;
  `perceived.settledAt` is earlier.

## NW-3. Stale response race

- **Symptom:** fast typing or switching shows results for an older input, or the
  screen flips between results.
- **Prove the problem:** `avalanche-network` lists two requests from the same
  initiator with different parameters, and the earlier-started one lands later
  (its `landedAfterNewer` names the newer request and `lateMs`);
  the commit after the late response replaces newer content
  (`commit-peek ... dom,network`).
- **What it protects:** showing every response may be intended (a log); aborting
  can waste server work already done.
- **Smallest fix:** drop stale responses: an `ignore` flag set in Effect cleanup, a
  request-id ref compared on arrival, or an `AbortController` whose signal is passed
  to `fetch` ([EF-4](patterns-effects.md#ef-4-fetch-in-effect-refetch-and-race)).
- **Larger fixes:** a data library keyed by input, so only the current key renders.
- **Compiler:** no.
- **Wrong when:** the request is a write; aborting does not undo it.
- **Prove the fix:** the final DOM matches the last input in every sample;
  `ab-compare` behavior `equivalent` on the final state.

## NW-4. Lazy code on interaction

- **Symptom:** the first open of a menu, dialog, panel or route waits; later
  opens are fast.
- **Prove the problem:** run `avalanche-network <clientId> 30 start "" script,link`.
  With the user's permission to reload, capture the first open, then a second
  open in the same recording. Script rows appear only on the cold open, inside
  the wait (in `perceived.waits[].lastRequests`, or covering most of
  `waitedMs`); on the warm open they are absent or `cached`. When the complaint
  is the first open, the cold sample is the subject: compare a cold arm with a
  warm arm instead of dropping it with `--skip`. Chippy does not say which lazy
  component a chunk belongs to; match the chunk URL to the dynamic import in
  source or the build's chunk names.
- **What it protects:** bundle size and parse cost of the initial load.
- **Smallest fix:** call the dynamic import, or the entry point's preload, on
  hover, focus or pointerdown, or when the parent menu opens; keep the import
  promise at module scope so `lazy` reuses it. Start the view's query beside the
  import from the same entry point, so code and data load together instead of as
  a [waterfall](#nw-2-request-waterfall).
- **Larger fixes:** preload at idle after the page settles;
  `<link rel="modulepreload">`; preload the chunk's dependent assets (string
  bundles, images) with it; bundle always-visible sections into the parent chunk;
  merge nested lazy boundaries.
- **Compiler:** no.
- **Wrong when:** the chunk is large and the intent is rare, so preloading spends
  bandwidth for most users.
- **Prove the fix:** on the cold open, script rows start before the action commit
  or are `cached`; `waitedMs` better across at least 3 cold samples per arm.

## NW-5. Refetch of data already shown

- **Symptom:** closing and reopening a panel, leaving and returning to a view, or
  a reset or collapse and expand shows a spinner again for data the user already
  saw.
- **Prove the problem:** record open, close and reopen (or view, leave and
  return) in one capture; `repeatOf` links requests only within one capture. The
  reopen request carries `repeatOf` naming the first request, `cached: false`,
  and `startedAfter` the remount commit, and a wait follows. `repeatOf` matches
  URL and initiator only: on a shared GraphQL endpoint without an operation name
  in the URL it can pair different queries, so confirm in source that the reopen
  issues the same query and variables. When the close, reset or collapse
  unmounted the owner, `avalanche-commit-list <clientId> 15 unmountedSubtrees`
  finds the teardown commit, and `avalanche-commit-peek <clientId> N
  stats,unmounts` (live only) names where teardown began
  ([RM-1](patterns-render.md#rm-1-key-induced-remount)).
  A query-library cache hit makes no request, so its row is absent; `cached: true`
  means the browser's HTTP cache served it.
- **What it protects:** freshness: the data may have changed while the view was
  closed.
- **Smallest fix:** use a cache-first or cache-and-network (stale-while-revalidate)
  fetch policy for this query, and retain the query past unmount (the library's
  retain or garbage-collection time). Check the API names for the installed
  version. For collapse and expand, keep the subtree mounted but hidden.
- **Larger fixes:** a per-scope or per-session cache for slow, rarely changing
  lookups; filter a cached superset locally when a filter broadens or narrows;
  seed a detail view from data already in a list.
- **Compiler:** no.
- **Wrong when:** the data must be fresh when shown; a hidden subtree keeps its
  Effects and subscriptions running.
- **Prove the fix:** on reopen the content appears in the first commit after the
  action; the reopen row is absent, `cached`, or a background revalidation that
  no fallback waits on; `waitedMs` better across at least 3 samples.

## NW-6. Non-critical content on the critical path

- **Symptom:** the main view or primary control appears only when a secondary
  section (a side panel, a recommendation list, a feature badge) finishes
  loading.
- **Prove the problem:** one `perceived.waits[]` entry covers both the primary
  content and the secondary region (`boundaries[].location.chain` names the
  boundary), and its `lastRequests` include a request the primary content does
  not read. `lastRequests` and `landedBefore` name candidates, not causes. Prove
  the request is on the critical path with P-23 in [procedures.md](procedures.md):
  the harness blocks or delays that one request as an A/B condition, and
  `avalanche-timeline` (or `avalanche-offline <sample> timeline`) per arm shows
  whether `unlockedBy` or `settledAt` moves. Chippy cannot block or delay a
  request itself.
- **What it protects:** one boundary reveals the view at once, without pop-in or
  layout shift.
- **Smallest fix:** move the Suspense boundary below the primary control, so the
  secondary section suspends alone; or load the non-critical data without
  suspending and render the section when it arrives.
- **Larger fixes:** split one boundary into one per region, so regions stream in;
  skip a lazy load when parent data already says the section is empty; mount a
  feature only when it is invoked, and prefetch its code at idle.
- **Compiler:** no.
- **Wrong when:** the regions must appear together, or the late region would
  shift the primary content
  ([LS-1](patterns-render.md#ls-1-late-or-resized-content-shifts-layout));
  the primary content reads the "secondary" data.
- **Prove the fix:** the primary content unlocks before the secondary request
  lands, across at least 3 samples per arm; `avalanche-offline <sample> perf
  layout-shift` on each sample shows no new shifts in the fixed arm.

## NW-7. Fallback replaces content already shown

- **Symptom:** a tab switch, filter, navigation or post-save refetch replaces
  visible content with a spinner or skeleton, then shows the new content.
- **Prove the problem:** after the action, a `perceived.waits[]` entry locks a
  boundary that was showing content, and `avalanche-dom-diff` on the lock commit
  shows `hide` ops on that content (it stays mounted behind the fallback). `-` ops
  on the content instead mean the boundary remounted
  ([RM-1](patterns-render.md#rm-1-key-induced-remount)).
- **What it protects:** the fallback tells the user the view is changing; stale
  content can mislead.
- **Smallest fix:** wrap the update that suspends in `startTransition`, so React
  keeps the shown content while the new render suspends; or `useDeferredValue` on
  the query key; or a non-suspending refetch that keeps the previous data (check
  the option name for the installed query library). Pair it with a pending
  indicator ([Feedback during a wait](#feedback-during-a-wait)).
- **Larger fixes:** route navigations in transitions (check the router's option
  for the installed version); keep boundary keys stable across the update.
- **Compiler:** no.
- **Wrong when:** stale content would mislead, such as the previous record under a
  new title; the boundary remounts, because a transition keeps only content that
  stays mounted (fix the key first).
- **Prove the fix:** no lock on that boundary and no `hide` ops after the action;
  a pending indicator is visible during the wait; `ab-compare` behavior
  `equivalent` on the final DOM.

## NW-8. Refetch after write

- **Symptom:** after a save, toggle or reorder, the view waits for a second
  request before it settles, although the change was already applied or the
  response already held the new data.
- **Prove the problem:** a read starts right after the write's response lands
  (its `chainedAfter` names the write), and the commit it is `landedBefore`
  changes little of the screen (a low `% screen` on its `avalanche-timeline`
  row; `screenByCommit` in an `avalanche-save` report has the detail, and has no
  entry for a commit that changed no box). Resource Timing has no method or
  body, so a row cannot prove a write. An operation name in the URL (a GraphQL
  `operation`, `operationName` or `opName` parameter, or a path that names the
  action) suggests which request is the write; confirm the method in source or
  the browser's network panel.
- **What it protects:** a refetch makes the screen match the server, including
  fields the write changed as a side effect.
- **Smallest fix:** write the mutation response into the cache instead of
  refetching; scope invalidation to the keys the write changed.
- **Larger fixes:** coalesce several refetches after one write into one; apply a
  realtime payload directly instead of pulling.
- **Compiler:** no.
- **Wrong when:** the write changes server-derived data the response does not
  return (counts, ordering, permissions).
- **Prove the fix:** no read is `chainedAfter` the write, or it no longer gates
  `settledAt`; the final DOM is `equivalent` in `ab-compare`.

## Feedback during a wait

With no Suspense fallback, `perceived.waits[]` is empty, and Chippy does not
report whether a loading indicator was visible. Find the window with
`perceived.firstResponse` (the first commit at or after the action; `t` is its
paint time when known) and
`perceived.idleGaps[]`, then read what the screen showed: `avalanche-dom-diff`
over those commits shows a spinner inserted (`+`) and removed (`-`), and
`eval-page <clientId> component-area --placeholder-names <regex>` counts a
skeleton driven by state as placeholder. Report whether any pending indicator
was visible, and from when.

When nothing acknowledged the action, show `isPending` from a transition next to
the control, or keep the stale content with a spinner overlay
([NW-7](#nw-7-fallback-replaces-content-already-shown)). Do not replace shown
content with a fallback only to signal progress.

## Sources

- [lodash debounce](https://lodash.com/docs/4.17.15#debounce) and
  [throttle](https://lodash.com/docs/4.17.15#throttle).
- web.dev: [INP](https://web.dev/articles/inp),
  [Optimize INP](https://web.dev/articles/optimize-inp),
  [Optimize long tasks](https://web.dev/articles/optimize-long-tasks);
  Chrome: [Long Animation Frames](https://developer.chrome.com/docs/web-platform/long-animation-frames),
  [scheduler.yield](https://developer.chrome.com/blog/use-scheduler-yield).
- React: [useOptimistic](https://react.dev/reference/react/useOptimistic),
  [useActionState](https://react.dev/reference/react/useActionState),
  [React 19](https://react.dev/blog/2024/12/05/react-19),
  [lazy](https://react.dev/reference/react/lazy),
  [Suspense: preventing already revealed content from hiding](https://react.dev/reference/react/Suspense#preventing-already-revealed-content-from-hiding),
  [useTransition](https://react.dev/reference/react/useTransition),
  [useDeferredValue](https://react.dev/reference/react/useDeferredValue).
- MDN: [rel=modulepreload](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/modulepreload),
  [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver).
- [Relay loadQuery](https://relay.dev/docs/api-reference/load-query/);
  TanStack Query [prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
  and [request waterfalls](https://tanstack.com/query/latest/docs/framework/react/guides/request-waterfalls).
