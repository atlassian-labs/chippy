# Render patterns

These are the patterns for render waste, expensive renders, mount cost, remounts
and layout shifts. Reach them from [perf-triage.md](perf-triage.md): render waste
and remounts from Step 3W once the trigger and the collateral are separated,
expensive renders and mount cost (EX-1, EX-2) from Step 2W, and layout shifts
(LS-1) from the Step 1 "Moved" row. Effects are in
[patterns-effects.md](patterns-effects.md); waits are in
[patterns-latency.md](patterns-latency.md).

Every card has the same fields:

- **Prove the problem:** the Chippy evidence that makes the pattern Confirmed.
- **What it protects:** what the current code guarantees. List it before you
  change anything; the fix must keep it.
- **Smallest fix:** the lowest [fix ladder](fixing-performance.md#fix-ladder) rung
  that usually removes the friction.
- **Compiler:** whether [React Compiler](react-compiler.md) removes the cost by
  itself (yes, partly, no).
- **Wrong when:** cases where the fix is incorrect or useless.
- **Prove the fix:** what the after-capture and `ab-compare` must show.

Field locations used below: `rendered[]` comes from
`avalanche-commit-peek <clientId> <commitId> stats,sources,rendered`; each row has
`isSelfSource`, `parentSourceId`, `ownerSourceId`, `propChanges[]` (`kind`,
`sameShallow`, `changedKeys`) and, in `full` or `amplifiers` mode, `trasherCounts`.
`avalanche-summary` `topCommits[]` carries `sources[].changedHooks[]` (`index`,
`sameContent`) and `rebuiltProps`.

A render is waste only when it could have been skipped (a memo boundary that
received only rebuilt props) or when its measured render time matters (about 1 ms
or more per commit on a production or profiling build). Below that, report an
Observation.

## RW-1. Unstable identity reaching a memo child

- **Symptom:** a `memo` child re-renders on every parent commit although nothing
  it shows changed.
- **Prove the problem:** in `rendered[]` the child has a `propChanges[]` entry with
  `kind: "ref-changed"` and `sameShallow: true`, or a function prop that changes
  every commit. `rebuiltProps` in `avalanche-summary` shows the same prop rebuilt
  across commits. `probe-props` (identities) or `fiber-prop-contract` on the child
  names the prop. Confirm the child is wrapped in `memo` from the owner chain or
  source; `rendered[]` does not say so.
- **What it protects:** a fresh object can carry new data on some paths; an inline
  callback always sees the latest state.
- **Smallest fix:** stabilize the one always-new prop. Hoist a static literal out
  of the component, pass primitives instead of an object, or wrap the callback in
  `useCallback` with honest dependencies.
- **Larger fixes:** adopt the compiler for the parent; restructure so the child
  receives primitives or `children`; move the state that rebuilds the prop down.
- **Compiler:** yes, when the parent is compiled.
- **Wrong when:** the value really changes each commit; the child is not a memo
  boundary, so a stable prop saves nothing; the child is cheap; a custom
  `arePropsEqual` would hide a real change.
- **Prove the fix:** the child is absent from `rendered[]` for the same action, or
  present only with real `changedKeys`; `ab-compare` behavior `equivalent`.

## RW-2. Children passed as JSX defeat memo

- **Symptom:** a `memo` component that receives `children` re-renders whenever
  its parent does.
- **Prove the problem:** the `rendered[]` row lists a `children` prop change while
  the content is the same. Read `commit-peek`, not `ab-compare`: `ab-compare`
  folds a parent's `children` prop into `collapsed`.
- **What it protects:** composition; the parent owns layout without the child
  knowing its content.
- **Smallest fix:** move `memo` to the component that renders the expensive
  content, or memoize the children element in the parent when its inputs are
  stable.
- **Larger fixes:** lift content up: let the stateful wrapper accept `children`
  from a parent that does not re-render, so the element keeps its identity.
- **Compiler:** yes; compiled parents cache JSX elements.
- **Wrong when:** the children really change each render; nothing below the memo
  boundary is expensive.
- **Prove the fix:** `children` no longer changes for the action; the component is
  absent from `rendered[]` on unrelated parent commits.

## RW-3. Context fan-out

- **Symptom:** one small change re-renders many distant components that read the
  same context.
- **Prove the problem:** `avalanche-commit-list <clientId> 15 contextUpdates` finds
  the commits; `rendered[]` lists many consumers with no prop changes.
  `eval-page <clientId> find-context-providers` locates the provider and
  `eval-page <clientId> count-context-consumers --name <regex>` sizes the blast
  radius ([P-08](procedures.md)). Then decide whether the provider value is a new
  object built in render with equal content, or a real change. Chippy has no
  provider value diff; read the provider's render and its hooks.
- **What it protects:** every consumer sees the current value without prop
  drilling. Splitting changes the API every consumer imports, and a consumer that
  reads both halves still re-renders when either changes.
- **Smallest fix:** when only identity changes, memoize the value over its real
  inputs:

  ```jsx
  const value = useMemo(() => ({ user, settings }), [user, settings]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  ```

  Setters from `useState` and `dispatch` from `useReducer` are already stable.
- **Larger fixes:** split the context by update rate (state and dispatch, fast and
  slow fields); move wide consumers to a `useSyncExternalStore`-backed store with
  selectors ([RW-7](#rw-7-store-selector-returns-a-new-object)).
- **Compiler:** partly. A compiled provider component keeps the value stable when
  its inputs are equal, but a real value change still re-renders every consumer,
  including consumers wrapped in `memo`: context bypasses the memo comparison.
- **Wrong when:** the value really changes and every consumer uses the changed
  field; consumers are cheap.
- **Prove the fix:** fewer consumers in `rendered[]` for the same action;
  `ab-compare` behavior `equivalent` on the screens that read the context.

## RW-4. State held too high

- **Symptom:** typing or toggling in one widget re-renders large unrelated
  siblings.
- **Prove the problem:** the `isSelfSource` row is a high ancestor whose changed
  hook is local UI state (an input value, an open flag); collateral spans sibling
  subtrees whose `propChanges[]` do not mention that state.
- **What it protects:** the state may sit high because a sibling reads it on
  submit, because it must survive the widget unmounting, or because siblings reset
  together.
- **Smallest fix:** move the state into the component that uses it; expose the
  value to the parent on submit through a callback.
- **Larger fixes:** lift content up (pass the unaffected siblings as `children`);
  use a store with selectors when distant components share the state.
- **Compiler:** partly; compiled parents skip unchanged JSX, but the owner still
  renders.
- **Wrong when:** the state must outlive the child, or several siblings really read
  it.
- **Prove the fix:** the trigger is now the small component; collateral stays in
  its subtree; `ab-compare` behavior `equivalent` for the submit and reset
  scenarios.

## RW-5. List append re-renders every row

- **Symptom:** adding one item (a message, a log line, a row) gets slower as the
  list grows.
- **Prove the problem:** `rendered[]` for the append commit lists every row, with
  `sameShallow: true` props or a shared callback prop that changed. Confirm from
  `probe-owners` or source whether the row is wrapped in `memo`: an unmemoized row
  re-renders with its parent whatever its props are. Keys matter here only when
  items are inserted before existing ones or keys change on append; that remounts
  rows instead of re-rendering them ([RM-1](#rm-1-key-induced-remount)).
- **What it protects:** rows may need a shared handler or selection state; index
  keys may exist because items have no id.
- **Smallest fix:** `memo` the row and pass it stable props (an id and a stable
  handler instead of a closure over the item); key rows by item id when items are
  inserted before existing ones.
- **Larger fixes:** virtualize long lists (weigh find-in-page, accessibility and
  scroll restoration); keep unchanged items' identity in the data layer.
- **Compiler:** partly; it stabilizes handlers in compiled parents but cannot keep
  identity of items the data layer recreates.
- **Wrong when:** rows are cheap and the list is short; the data layer recreates
  every item on each fetch, so `memo` cannot help until identity is kept upstream.
- **Prove the fix:** the append commit renders only the new row and the container;
  `renderMs` stays flat as the list grows.

**Virtual window shift.** In a virtualized list, scrolling moves the window: some
rows mount and the rest stay mounted. Only the entering rows have to render.
Entering rows are the `+` ops in `avalanche-dom-diff` for the scroll commit. In
that commit's `rendered[]`, a row whose `sourceId` already appeared in any
earlier commit of the capture stayed mounted; `rendered[]` lists only the
components that rendered, so do not compare with the previous commit alone.
Rows that stayed mounted and rendered with `sameShallow: true` props, or with no
`propChanges` under an unmemoized row, are the memo waste. When every
stayed-mounted row instead shows a `scalar-changed` or `ref-changed` item or id
prop, the rows are keyed by window position and receive new items on each
scroll. Scroll is not an input by default (`interactionEvents: ['scroll']` in
an in-page install records it, see [R-11F](bdd-router.md)), so without it the
`avalanche-timeline` origin is an earlier
click or the window's first commit (`origin.kind`), not the scroll. Fixes:
memoize rows on the item's identity, key rows by item id rather than by window
position, and render a cheap read-only cell until hover or focus needs the
interactive one.

## RW-7. Store selector returns a new object

- **Symptom:** components subscribed to a store re-render on every store update,
  including unrelated ones; in the worst case, an update loop.
- **Prove the problem:** consumers appear in `rendered[]` on commits triggered by an
  unrelated store change; their `SyncExternalStore` hook changed with
  `sameContent: true`. `avalanche-debug-hook` on that hook shows the selector
  ([P-19](procedures.md)).
- **What it protects:** object selectors are convenient and read one consistent
  snapshot.
- **Smallest fix:** select primitives, or wrap an object selector with the
  library's shallow-equality helper. For a custom `useSyncExternalStore`,
  `getSnapshot` must return a cached value when the store has not changed, and
  `subscribe` must be stable. Some libraries turn a new-object selector into an
  error ("Maximum update depth exceeded") rather than extra renders.
- **Larger fixes:** split the store slice; derive with a memoized selector.
- **Compiler:** no; the selector runs inside the library.
- **Wrong when:** the selected data really changes; a shallow helper would hide a
  nested mutation.
- **Prove the fix:** consumers are absent from `rendered[]` for unrelated store
  updates; no `getSnapshot` warning in `avalanche-console`.

## EX-1. Expensive render with real input changes

- **Symptom:** one component is slow every time its inputs change; memoization does
  not help because the inputs really change.
- **Prove the problem:** the commits where the component renders have large render
  time (`commit-peek ... timing,rendered`: `render.workMs`, `longestSliceMs`), its
  `propChanges[]` show real changes, and `avalanche-perf` shows large `processing`
  or `presentationDelay` for the interaction. Chippy measures time per commit, not
  per component: attribute it to this component with the React DevTools Profiler
  on a profiling build, or with an A/B that memoizes or removes it.
  `avalanche-hot-sources` ranks render counts, not time.
- **What it protects:** synchronous rendering keeps the view consistent with the
  input.
- **Smallest fix:** memoize the expensive calculation with `useMemo` when it depends
  on a subset of inputs; move pure heavy work out of render.
- **Larger fixes:** `useDeferredValue` for the slow part (the slow child must be
  memoized, or deferring saves nothing); `useTransition` for non-urgent updates;
  virtualization; smaller DOM; a worker for pure computation.
- **Compiler:** no.
- **Wrong when:** the cost exists only in development; deferral would show stale
  data the user acts on. For controlled text, `useTransition` cannot wrap the
  input's setter; keep the input synchronous and pass the value through
  `useDeferredValue` to the slow child instead.
- **Prove the fix:** `worstInteractionMs` and `renderMs` `better` in `ab-compare`
  with at least 3 interleaved samples per arm, `renders <Name>` not worse, and
  behavior `equivalent`.

## EX-2. Large mount commit

- **Symptom:** opening a view, switching a route or using a feature for the first
  time produces one long frame with little or no wasted re-rendering.
- **Prove the problem:** `avalanche-perf <clientId> long-animation-frame` gives the
  frame; its `commits.during` lists the commits that ran in it. The shipped
  capture does not count mounts per commit (only a commit metrics adapter adds
  `mountWorkCount`): read `avalanche-dom-diff <clientId> <fromCommit> <toCommit>`
  for those commits, where a mount commit is mostly `+` ops (inserted subtrees)
  rather than `~` updates. A `scripts[]` entry whose `sourceURL` matches
  a `script` row in `avalanche-network <clientId> '' '' '' script` that landed just
  before the frame is module evaluation of a newly loaded chunk
  ([NW-4](patterns-latency.md#nw-4-lazy-code-on-interaction)). When the first
  input is slower than a repeat of the same input in one capture (`event` entries:
  `processing`), the extra cost is one-time initialization.
- **What it protects:** the whole view appears at once and consistent, without
  sections popping in.
- **Smallest fix:** defer secondary or offscreen subtrees until after the first
  paint or until idle; render the route switch in a transition so the current
  view stays responsive while the next one mounts.
- **Larger fixes:** keep a shared layout mounted across sibling routes so only the
  leaf mounts; virtualize the first mount of a long list; move first-use
  initialization to open or idle; preload the chunk before the action (NW-4).
- **Compiler:** no; a first mount has nothing to reuse.
- **Wrong when:** the cost exists only in development; the deferred subtree is what
  the user opened the view for; deferral moves content after paint and adds a
  layout shift ([LS-1](#ls-1-late-or-resized-content-shifts-layout)).
- **Prove the fix:** the long frame for the action is shorter (`blockingDuration`);
  `worstInteractionMs` or `totalBlockingMs` `better` in `ab-compare`. When the
  complaint is the first open, compare cold samples instead of dropping them with
  `--skip`.

## RM-1. Key-induced remount

- **Symptom:** focus, scroll or local state is lost on update; a subtree flickers or
  re-runs mount effects and requests.
- **Prove the problem:** `avalanche-commit-list <clientId> 15 unmountedSubtrees` (or
  `unmountedComponents`) is non-zero on an update commit;
  `commit-peek ... unmounts` shows where teardown started; the same component
  mounts again in that commit. The key comes from `Math.random()`, `Date.now()`, or
  data that changes; or a component type is defined inside render, so each render
  creates a new type ([P-18](procedures.md)). Index keys on a reordered list do not
  remount: the rows stay mounted and their state follows the position, so state
  shows on the wrong item. That is a correctness bug, not a remount.
- **What it protects:** some keys reset state on purpose, when the identity of the
  thing shown changes.
- **Smallest fix:** key by a stable id; hoist component definitions out of render.
- **Larger fixes:** when only some fields should reset, keep the key and lift the
  preserved state above it.
- **Compiler:** no.
- **Wrong when:** the key changes exactly when the entity changes and the reset is
  intended.
- **Prove the fix:** `unmountedSubtrees` is zero for the action; `fiber-state-compare`
  between captures before and after the action shows no `fiber-removed` /
  `fiber-added` pair for the subtree; mount-time requests disappear from
  `avalanche-network`. Announce the fewer requests before `ab-compare` so the
  change reads as intended.

## LS-1. Late or resized content shifts layout

- **Symptom:** content jumps after it appears: a section arrives late and pushes
  the rest down, or a toolbar wraps when an item is added.
- **Prove the problem:** read the entries, not the summary:
  `avalanche-perf <clientId> layout-shift` lists each shift with `value`,
  `hadRecentInput`, and up to five `sources` (`component`, `testId`,
  `previousRect`, `currentRect`). `summary.cls` and the `avalanche-timeline` shift
  lane leave out shifts with `hadRecentInput: true`, so a shift right after the
  click is missing there. The entry's `commits.before` names the commit that moved
  the DOM; `avalanche-commit-peek <clientId> <commitId> dom,network` shows what it
  inserted or resized and which response landed before it.
- **What it protects:** content shows as soon as it is ready; elements size to
  content whose size is not known in advance.
- **Smallest fix:** reserve the space: a `min-height`, an `aspect-ratio`, or a
  skeleton of the final size.
- **Larger fixes:** hoist the late fetch so the content arrives with the first
  paint; replace wrapping with an overflow menu; size from container queries
  instead of the content.
- **Compiler:** no.
- **Wrong when:** the move is the expected answer to the input (a section the user
  expanded); the reserved space stays empty in the common case.
- **Prove the fix:** the shift entries for the action are gone or have smaller
  `value`. `ab-compare` judges `cls`, which skips shifts with recent input; for
  those, compare the entries per arm with `avalanche-offline <sample> perf
  layout-shift`.

## Sources

- React: [memo](https://react.dev/reference/react/memo),
  [useMemo](https://react.dev/reference/react/useMemo),
  [useCallback](https://react.dev/reference/react/useCallback),
  [useContext](https://react.dev/reference/react/useContext),
  [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore),
  [useDeferredValue](https://react.dev/reference/react/useDeferredValue),
  [useTransition](https://react.dev/reference/react/useTransition),
  [Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state),
  [Rendering lists](https://react.dev/learn/rendering-lists).
- Dan Abramov, [Before You memo()](https://overreacted.io/before-you-memo/).
