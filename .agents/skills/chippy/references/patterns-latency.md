# Latency and network patterns

These are the patterns for "waited" complaints: the user waited while the main
thread was mostly idle, because of a timer, a debounce or the network. They also
cover long tasks that block input. Reach them from
[perf-triage.md](perf-triage.md) Step 2N or Step 2W. The card fields are explained
in [patterns-render.md](patterns-render.md).

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
  main-thread work and no request in flight, close to the debounce `wait`: the
  request `start` or the next commit `t` in the lanes (`format full`) sits about
  `wait` ms after the input at 0 ([perf-triage](perf-triage.md#step-1-waited-or-worked)).
  `perceived.waits[]` stays empty when no fallback is shown. `startedAfter` links a
  request to the commit before it only within the network window (250 ms by
  default); to read the gap there, pass a larger window:
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
  partial value; leading plus trailing doubles requests the server cannot absorb
  (keep trailing-only and `flush()` on the discrete action instead; `maxWait` caps
  the delay and can add calls, so it does not reduce them).
- **Prove the fix:** the gap disappears from `avalanche-timeline` across at least 3
  interleaved samples per arm ([ab-testing](ab-testing.md#verifying-a-fix)); request count unchanged or as announced; `ab-compare`
  behavior `equivalent` on the final DOM.

## LT-2. Stacked debouncers

- **Symptom:** the delay is the sum of several waits (a component debounce, a hook
  debounce, a client batch).
- **Prove the problem:** `avalanche-timeline` shows an idle gap longer than any
  single configured wait, or two idle gaps separated by a small commit; source shows
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

## NW-1. Late start (fetch on mount)

- **Symptom:** after navigation or opening a panel, a spinner shows for the whole
  request; the request starts only after the new view mounts.
- **Prove the problem:** in `avalanche-network` the first request is `startedAfter`
  the mount commit of the new view, well after the action; `perceived.waits[]` is
  `lockedBy` that view's loading boundary and `lastRequests` cover most of
  `waitedMs`.
- **What it protects:** fetching on mount keeps data ownership local and avoids
  loading data the user never opens.
- **Smallest fix:** start the request when intent is known: in the event handler,
  or on hover, focus or pointerdown. Examples: Relay `loadQuery` in the handler;
  a query library's prefetch with a freshness window so the mounted query reuses
  the result; React Router's `<Link prefetch="intent">` (framework mode only).
  Check the API names for the installed version.
- **Larger fixes:** route-level loaders; load code and data together.
- **Compiler:** no.
- **Wrong when:** intent predicts poorly and prefetching multiplies server load;
  data must be fresh at display time.
- **Prove the fix:** the request starts at or before the action commit; `waitedMs`
  better across at least 3 samples; announce any request-count change.

## NW-2. Request waterfall

- **Symptom:** load time is the sum of several sequential requests.
- **Prove the problem:** request B is `startedAfter` the commit that request A is
  `landedBefore`, repeated down the tree; each request starts in a child that mounts
  only after its parent's data arrives.
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
  initiator with different parameters, and the earlier-started one lands later;
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
  [React 19](https://react.dev/blog/2024/12/05/react-19).
- [Relay loadQuery](https://relay.dev/docs/api-reference/load-query/);
  TanStack Query [prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
  and [request waterfalls](https://tanstack.com/query/latest/docs/framework/react/guides/request-waterfalls).
