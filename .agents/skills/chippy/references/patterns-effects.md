# Effect patterns

These are the patterns where an Effect causes extra commits, repeated work or
repeated requests. Reach them from [perf-triage.md](perf-triage.md). The card
fields are explained in [patterns-render.md](patterns-render.md).

## Two questions before touching an Effect

1. **Does this Effect synchronize with something outside React?** A subscription,
   a DOM measurement, a timer, a network request for what is on screen. If yes, it
   is a real Effect: keep it and fix its dependencies
   ([EF-1](#ef-1-effect-re-fires-from-identity)). If no, it is probably work that
   belongs in render or in an event handler
   ([EF-2](#ef-2-derived-state-via-effect), [EF-3](#ef-3-effect-chains)).
2. **Why does this code run?** Because the component was displayed: an Effect.
   Because the user did something: the event handler for that action.

## Removing an Effect

From React's "You Might Not Need an Effect":

| Effect today | Replace with |
| --- | --- |
| Sets state computed from props or other state | Compute it during render; `useMemo` if it is expensive |
| Resets all state when a prop changes | Give the component a `key` from that prop |
| Adjusts part of the state when a prop changes | Compute from the prop in render; as a last resort, adjust state during render guarded by a stored previous value |
| Runs logic because the user acted (submit, buy, toggle) | Run it in that event handler |
| Notifies a parent after the state changed | Call the parent's callback in the same event handler |
| Sets state that makes another Effect set state | Compute all next state in the handler that started it ([EF-3](#ef-3-effect-chains)) |
| Subscribes to an external store | `useSyncExternalStore` |
| Initializes the app once | A module-level guard or code outside components |

React batches every `setState` call inside one event handler into one render, so
moving a chain into the handler turns several commits into one.

## Fixing Effect dependencies

When the Effect must stay, change the code so a dependency is no longer needed;
never hide it. Work down this list (React's "Removing Effect Dependencies") and
stop at the first step that applies:

1. Hoist a static object or function out of the component.
2. Move an object or function used only by the Effect inside the Effect.
3. Depend on the primitive fields the Effect reads (`options.roomId`, not
   `options`).
4. Compute with a pure function defined outside the component.
5. Use the updater form, `setItems(items => [...items, item])`, so current state is
   not a dependency.
6. Read values the Effect should not react to through `useEffectEvent` (stable in
   React 19.2; earlier versions use a ref to the latest callback).
7. Only then stabilize the value upstream with `useMemo` or `useCallback`.

Never suppress `react-hooks/exhaustive-deps`. A suppressed dependency still
changes; the Effect just reads a stale value. Removing a dependency is correct
only when the code no longer reads it.

In development, StrictMode mounts, unmounts and mounts again to test cleanup.
One extra setup/cleanup pair on mount is expected and is not EF-1.

## EF-1. Effect re-fires from identity

- **Symptom:** an Effect (a subscription, a listener, a request, a measurement)
  tears down and runs again on every parent render.
- **Prove the problem:** `avalanche-commit-list <clientId> 15 effects` shows the
  commits; `rendered[].trasherCounts.effects > 0` for the component. These counts
  exist only in `full` or `amplifiers` detection mode, and by default an Effect re-run
  is counted only when an object, array or function dependency changed; a re-run
  driven by a primitive dependency is not counted. In `full` mode, commit-peek
  `sources[].trashers[]` shows `prevValue` and `currentValue` of the changed hooks.
  To repeat a render without user input, use the controlled nudge in
  [stability-render.md](stability-render.md). `avalanche-debug-hook` names the
  dependency hook ([debug-hook.md](debug-hook.md)).
- **What it protects:** the dependency may be listed because the Effect must see
  the latest callback; dropping it makes the Effect read stale values.
- **Smallest fix:** the dependency order above, usually step 2, 3 or 6.
- **Larger fixes:** stabilize the callback upstream with `useCallback` and honest
  dependencies; adopt the compiler for the owner chain.
- **Compiler:** partly. Compiled code memoizes values used as dependencies, so
  identity-driven re-runs may stop, but dependency comparison is unchanged and the
  compiler may memoize differently from hand-written code. Re-count Effect runs
  after adoption.
- **Wrong when:** the Effect must re-synchronize when the value changes; narrowing
  to one primitive while the Effect reads other fields; suppressing the linter;
  switching to `useLayoutEffect` (changes timing, not frequency).
- **Prove the fix:** Effect runs in `commit-list ... effects` drop to the real
  changes; `ab-compare` behavior `equivalent`; StrictMode remounts still clean up.

## EF-2. Derived state via effect

- **Symptom:** each change renders twice: once with stale derived values, then
  again after an Effect sets them. Wrong content can flash.
- **Prove the problem:** one action produces two consecutive commits; the second
  commit's `isSelfSource` row is the same component whose Effect ran in the first
  (`commit-list ... effects`). React 19.2 Performance Tracks in Chrome DevTools can
  flag cascading updates too.
- **What it protects:** the Effect may sync with an external value, or reset local
  state when a prop changes.
- **Smallest fix:** compute the value during render; reset with a `key`.

  ```jsx
  // Before: two commits per change
  const [visible, setVisible] = useState([]);
  useEffect(() => setVisible(items.filter(matches)), [items, matches]);

  // After: one commit
  const visible = useMemo(() => items.filter(matches), [items, matches]);
  ```
- **Larger fixes:** move ownership so the derived value lives with its source.
- **Compiler:** no.
- **Wrong when:** the Effect reads the DOM (measuring in `useLayoutEffect` and
  setting state is valid); the derived value is user-editable after it is
  initialized.
- **Prove the fix:** one commit per action; the flash is gone; `ab-compare`
  behavior `equivalent`.

## EF-3. Effect chains

- **Symptom:** one user action produces a sequence of commits, each started by an
  Effect reacting to the state set by the previous one.
- **Prove the problem:** `commit-list` shows several commits for one action, each
  with an Effect-driven `isSelfSource` row (`by=effects`, then `by=sources`);
  `perceived.waits[].updatesDuring` is high with no request in flight.
- **What it protects:** a chain can encode a real order (a step needs the previous
  step's result). Chains that wait on the network, such as dependent dropdowns
  that load options, are legitimate.
- **Smallest fix:** compute all next state in the event handler that started the
  chain:

  ```jsx
  function handlePlace(card) {
    const nextCount = count + 1;
    setCard(card);
    setCount(nextCount);
    if (nextCount === LIMIT) setRound(r => r + 1);
  }
  ```
- **Larger fixes:** `useReducer` so related transitions are computed together;
  derive intermediate values instead of storing them.
- **Compiler:** no.
- **Wrong when:** each step really waits for an external result or a DOM
  measurement.
- **Prove the fix:** one commit (or one per network response) for the action;
  `ab-compare` behavior `equivalent` on the final DOM and state.

## EF-4. Fetch in effect: refetch and race

- **Symptom:** the same request repeats on unrelated renders, or a slow older
  response overwrites a newer one.
- **Prove the problem:** `avalanche-network` lists the same URL from the same
  initiator (`repeatOf` on each repeat, summary `mostRepeated`), `startedAfter` commits that did not change the query inputs, and
  `commit-list ... effects` shows the fetching Effect re-running. For the race, the
  earlier-started request lands later and the final DOM shows its data
  ([NW-3](patterns-latency.md#nw-3-stale-response-race)).
- **What it protects:** fetching what is on screen in an Effect is legitimate; the
  dependency list makes it refetch when the query really changes.
- **Smallest fix:** depend on the primitive query key, not an options object; drop
  stale responses in cleanup:

  ```jsx
  useEffect(() => {
    const controller = new AbortController();
    fetch(url(query), { signal: controller.signal })
      .then(r => r.json())
      .then(setResults)
      .catch(error => { if (error.name !== 'AbortError') setError(error); });
    return () => controller.abort();
  }, [query]);
  ```

  The signal must reach `fetch`; aborting a controller nobody listens to cancels
  nothing. An `ignore` flag set in cleanup works when cancellation is not possible.
- **Larger fixes:** a data library that caches and dedupes by key, or a framework
  loader.
- **Compiler:** partly; it can stop identity-driven refetches, not races.
- **Wrong when:** the inputs really changed; the data must refresh (a cache
  freshness question: see
  [NW-5](patterns-latency.md#nw-5-refetch-of-data-already-shown)).
- **Prove the fix:** one request per real key change in `avalanche-network`;
  announce the fewer requests before `ab-compare`; the final DOM matches the last
  input.

### Shared query

The same request can repeat without any Effect re-running: sibling consumers
each fetch it, every row fetches the same list or lookup, or one consumer fetches
twice because its inputs settled after mount. For sibling and per-row duplicates,
the `avalanche-network` rows share a URL and overlap in time, and each repeat's
`repeatOf` has a small `gapMs`. `repeatOf` links only an identical URL and
initiator, so a fetch with a placeholder followed by one with the real value
usually has no `repeatOf`: look for two rows to the same endpoint with different
query values close together, the first one's `startedAfter` being the mount
commit. Chippy does not say which component started a request; find the
consumers of that query in source.

- **Smallest fix:** let one owner fetch and pass the result down, or give every
  consumer the same query key and fetch policy so the query library dedupes them
  (check the API names for the installed version). Differing options on the same
  key can defeat deduplication.
- **Larger fixes:** wait for the final inputs before the first fetch: skip or
  disable the query while a route param or a feature flag is still unresolved,
  instead of fetching with a placeholder and again with the real value. Gate on
  a parent's data only when the query needs it and the placeholder result is
  thrown away anyway; otherwise start the query in parallel, because gating
  serializes the requests
  ([NW-2](patterns-latency.md#nw-2-request-waterfall)). Key the query on the
  minimal inputs it reads (the route params it uses, not the full URL or a whole
  options object), so unrelated changes do not create a new key.
- **Wrong when:** consumers need different freshness or fetch policies; rows
  fetch different ids (different URLs, no `repeatOf`): that is a batching
  question, not this card.
- **Prove the fix:** one request per key in `avalanche-network`, with no
  `repeatOf` at a small `gapMs`; announce the fewer requests before `ab-compare`.

## Sources

- React: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect),
  [Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies),
  [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects),
  [useEffectEvent](https://react.dev/reference/react/useEffectEvent),
  [Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects),
  [Lifecycle of Reactive Effects](https://react.dev/learn/lifecycle-of-reactive-effects),
  [React 19.2](https://react.dev/blog/2025/10/01/react-19-2).
