# Fixing performance — avalanche-driven workflow

Use a capture to classify render behavior and choose a fix for the three most common avalanche patterns. Investigate one Provider or one source at a time.

Lifecycle stage: **commit analysis → attribution → fix-layer decision**. Enter after Avalanche has captured the real load/interaction and you have candidate commits/sources from `avalanche-commit-list` or `avalanche-hot-sources`.

Exit when you can name the source/boundary/prune layer and the evidence-backed edit. If the hypothesis needs a reproducible subtree check, switch to [stability-render](stability-render.md). If a known source has a changed `hookIndex` but the hook role is unclear, switch to [debug-hook](debug-hook.md). After an edit, verify by repeating the same capture or the same stability-render nudge.

The remediation patterns below are candidates, not edit authorization. Apply one only when user intent permits and the P-15 proof packet passes the P-16 Apply gate; otherwise report the proven layer and verification command.

## Capture the right window, then read context first

Enter this reference with a real capture. Match the capture to the reported symptom:

```bash
# Runtime or interaction performance: no reload.
chippy.sh avalanche-arm <clientId> <origin>
# Reproduce the interaction, then read:
chippy.sh avalanche-status <clientId>
chippy.sh avalanche-hot-sources <clientId> 12

# Initial-load performance: arm, reload, reconnect, and settle.
chippy.sh reload-with-avalanche <clientId> <origin> 0 30000 5000
```

For initial load with many context updates, rank the bounded commits before opening detail:

```bash
chippy.sh avalanche-commit-list <clientId> 20 contextUpdates
chippy.sh avalanche-commit-peek <clientId> <commitId> stats,sources,atl 3 30
```

Do not pipe the full export through an ad-hoc reducer. Use prepared Chippy views. If they cannot expose the required Provider detail, report that command gap or add a first-class view before making a causal claim.

Why the settle window matters: stopping on reconnect is too early for heavy pages. Post-load React work can continue for seconds after the page is back, so a short window undercounts the load.

Context evidence identifies a Provider and source location. Open that file and line directly, then determine whether the value carries real data changes or only a new reference.

After context: use hot sources and one bounded commit peek for source and thrash signals.

### Applying the filter in practice

Filter rule for low-hanging fruit: **focus on shallow-equal churn only**. If the context payload carries genuinely new UI registrations, placements, targets, or other transport data, that is not a one-line churn fix.

Shallow-equal / identity-only candidates usually look like this:

- `identity changed` on every commit for the same Provider
- `object → object` with stable semantics and no meaningful field delta
- Provider `value={...}` built inline in render
- memoized wrapper exists, but the payload inside it still changes identity for no product reason

Not shallow-equal / skip for the first pass:

- registration-style fields such as `targets`, `placements`, mounted item registries, popup registries
- transport-layer payloads that legitimately reflect new items appearing on screen
- content field changes such as images, labels, IDs, flags, or fetched data

### Capture lesson

Low commit counts on reload are often caused by **stopping too early**, not only by injection timing. `reload-with-avalanche` should include a settle window after reconnect.

Rule: use `reload-with-avalanche <clientId> <origin> 0 30000 5000` as an example starting point for heavy pages. Treat the timeout and settle values as local tuning knobs. Only blame injection timing after the stop timing is correct.

---

## Classification — triage before fixing

Every component avalanche sees is one of three roles. Never confuse them.

| Role | Avalanche field | Meaning |
|---|---|---|
| **Trigger** | `commit-peek N sources` entry, or `commit-peek N rendered` entry with `isSelfSource: true` | Hook state changed here. This started the cascade. |
| **Hotspot** | Appears in `sources` frequently across commits | Renders often — may or may not be a trigger. |
| **Collateral** | `commit-peek N rendered` entry with `isSelfSource: false` | Re-rendered with no local change. Downstream blast victim. |

A hotspot is not necessarily a trigger. A collateral is not a problem by itself — its parent is. Fix the trigger, not the collateral.

> **Confirm hook kind and origin.** Once you have a source and a changed `hookIndex`, classification by primitive (`SyncExternalStore`, `State`, `Memo`, `Effect`, …) and custom-hook owner is the next decision. See [debug-hook](./debug-hook.md). Use it before picking a fix layer; the primitive narrows the remediation table to one row.

### Cross-reference — per-commit metrics and restart attribution

Triage uses two facts that live in [avalanche-detector → Per-commit join](./avalanche-detector.md#per-commit-join):

- **Per-commit join.** `commitStats[N]`, `sourcesByCommit[N]`, `metricsByCommit[N]`, `renderedByCommit[N]`, and `commitTimings[N]` share the same commit index `N`. To go from "this commit was hot" to "who fired it", join by `N`. Without this, source ranking is guesswork.
- **`restartWaste` per source.** `avalanche-hot-sources` ranks by `collateralUpdates` only. A low-collateral source can still be the worst offender if its commits get heavily restarted (Suspense throw, priority preemption, useSES mid-render). Check `restartWaste` on each row before declaring a winner.

Practical use:
- "Above the source" check → look at `commitStats[N]` for the suspect commit. If `restarts > 0` and `sources` is empty, the wave is a **ghost restart** — the trigger is upstream/external, not in the source list.
- "Boundary" check → join `commitStats[N]` (high `collateral`, high `contextUpdates`) with `sourcesByCommit[N]` to see which source's identity churn caused the blast.
- "Below" check → if `commitStats[N].collateral` is high but `restarts` and `contextUpdates` are low, children failed to prune; fix is downstream.
- Restart cause → confirm with the `metricsByCommit[N]` counters (`commit-peek N metrics`): `externalStoreRestartCount` (`useSyncExternalStore` races), `priorityInterruptedWorkCount` (higher-priority preemption), `interruptedWorkCount` (other interrupted work).


## Propagation model — source, boundary, prune

Three relations matter:
- **owner** = who created the fiber in React terms; the render site, prop source, or slot producer
- **parent** = who wraps it in the rendered tree; the structural container around it
- **slot** = owner appears inside a different parent chain because a child was passed in and rendered elsewhere; composition / dependency-injection shape

For performance work:
- use **owners** to find who is responsible for creating unstable children, callbacks, or provider values
- use **parents** to find where propagation spreads through wrappers, lists, layout shells, and context regions
- look for **own parents in own children** patterns to detect slots: the same owner contributes a child that later lives under a different parent region

A source component may need to update. That alone does not make it the fix target.

Three separate questions:

1. **Why did this source update?**
2. **Why did that update propagate into children?**
3. **Why did those children fail to prune / bail out?**

Same avalanche can be fixed in three different places:

| Layer | Question | Typical fix location |
|---|---|---|
| **Above the source** | Did a parent/context/store force this source to update? | Parent effect, provider value, store selector, wrapper transport |
| **At the boundary** | Did the source recreate values that force child work? | Prop boundary, JSX identity, inline object/array/function, context value |
| **Below the source** | Did children fail to prune when inputs were stable enough? | `React.memo`, stable callbacks, stable derived props, subtree split |

Rule: a source may be legitimate. The bug can still be that it drags children with it, or that children fail to stop the wave.

### Decision tree — where the fix lives

1. **Confirm the trigger**
   - A `commit-peek N sources` entry, or a `rendered` entry with `isSelfSource: true` = local update happened here.
   - If no local updater exists, you may be looking at propagation from above.

2. **Check above the source**
   - Did a parent/provider/store update force this source to run?
   - Avalanche clues: repeated parent-owned sources, context/provider churn, route/data boundary churn, wrapper transport.
   - Fiber clues: owner chain shows the value entering from above.

3. **Check the boundary at the source**
   - Did this render create new `children`, JSX, objects, arrays, callbacks, or context values?
   - Avalanche clues: source updates are legitimate, but child collateral is broad and stable.
   - Fiber clues: owner/prop chain shows identity-only values crossing into children.

4. **Check below the source**
   - Did children have enough stable inputs to bail out?
   - Avalanche clues: large repeated collateral with no local hook change in children.
   - Fiber clues: child subtree does not depend on the changed field, but still renders.

5. **Pick the highest fix that removes the most waste**
   - If the source should not update, fix above.
   - If the source must update but children should not, fix boundary or children.
   - Prefer the highest stable boundary that stops propagation cleanly.

### What to inspect above vs boundary vs below

**Above the source**
- Parent effects that dispatch on every render or on unstable deps.
- Provider values recreated every render.
- Store selectors returning new references for equal data.
- Wrapper layers transporting new identities into the source.

**At the boundary**
- Inline object/array literals.
- Inline JSX nodes or mapped children rebuilt every render.
- Fresh callbacks passed into memoized children.
- Context `value={...}` rebuilt in render.

**Below the source**
- Missing `React.memo` at subtree root.
- Memo boundary exists but props are unstable.
- Child derives large props every render instead of memoizing.
- Child consumes broad context/store state when it only needs a narrow field.

### Fiber + avalanche together

Use avalanche to locate **where the wave starts and how far it travels**.
Use fiber/probes to locate **why a value crosses a boundary and who could stop it**.

- Avalanche answers: trigger, repeat count, collateral breadth, penetration depth.
- Fiber answers: owner chain, prop names, prop values, hook location, boundary composition.

Never stop at: "this component updated".
Next questions are always:
- why did its children receive work?
- which boundary failed to prune?
- would the cleanest fix be above, at, or below this component?

### Single-component render causality

Avalanche can support single-component render reasoning, but only after the component is joined to a specific commit. Raw React metrics are population statistics; they do not name the cause for one component.

Ask the precise question:

```text
Why did <Component> participate in commit N?
```

Not:

```text
Why does <Component> render in general?
```

The same component may participate for different reasons across different commits: mount, parent propagation, local state, context, external store, remount, or discarded/restarted work.

#### Required evidence before naming a cause

For a target component, collect:

1. **Identity** — component name, file, line, key if repeated.
2. **Commit** — the specific `N` where it participated.
3. **Role** — source, collateral, hotspot, mount/remount, context/store participant, or restart/discarded work.
4. **Commit join** — `commitStats[N]`, `sourcesByCommit[N]`, `renderedByCommit[N]`, and `metricsByCommit[N]` (including restart counters) for the same `N`.
5. **Fiber flow** — owner chain, parent chain, props, hook count, and specific hook/prop values when needed.
6. **Source proof** — hook deps, setter call site, provider value construction, selector identity, keys, or memo boundary in code.

No role, no cause. No commit, no cause. No source/fiber proof, only partial confidence.

#### Role → reasoning table

| Target role in commit `N` | Correct conclusion | Next proof |
|---|---|---|
| **Source** | The component has local update evidence in this commit | Map changed hook/source to hook call, setter, effect, store callback, or reducer path |
| **Collateral** | The component rendered because work propagated into it; it is probably a victim | Find causing source/parent/provider and inspect prop/context/memo boundary |
| **Hotspot** | The component appears often, but may be source or victim | Inspect per-commit role; do not fix by frequency alone |
| **Context participant** | A provider changed in the same commit and may have forced consumers | Verify the target consumes that context and inspect value diff for real data vs identity churn |
| **External store participant** | Store snapshot/subscription may have changed or restarted render | Inspect `useSyncExternalStore`, selector identity, snapshot equality, and restart fields |
| **Mount/remount** | This is not just a re-render; React created new fiber/component work | Inspect keys, conditional branches, route/layout swaps, component types created inside render |
| **Restart/discarded work** | React executed render work that may not have committed | Inspect `externalStoreRestartCount`, `priorityInterruptedWorkCount`, `interruptedWorkCount`, Suspense/store timing |

#### Cause categories

Use these cause statements only when their evidence is present:

| Cause | Evidence | Safe wording |
|---|---|---|
| Local state/reducer update | Target is source; changed hook maps to `useState`/`useReducer` | "Rendered because its own state/reducer changed." |
| Effect cascade | Source hook/effect dispatches repeatedly or deps are unstable | "Rendered because an effect scheduled an update from unstable deps." |
| Parent propagation | Target is collateral under a source/parent | "Rendered as collateral from parent/source work." |
| Prop identity change | Memoized target received changed prop/ref/children identity | "Could not bail out because `<prop>` changed identity." |
| Context propagation | Provider update in same commit; target consumes context | "Rendered because context value changed above it." |
| External store update | Store hook/source/restart evidence | "Rendered because its external-store snapshot changed or restarted." |
| Remount | Mount counters/key/tree replacement evidence | "Remounted due to key/tree/type change, not normal re-render." |
| Restart/preemption | Raw render executions exceed classified committed work with side fields | "React executed render work that was discarded/interrupted." |

#### Wording discipline

Bad:

```text
Component X rendered 800 times.
```

Good:

```text
React executed 800 component render paths in this commit window.
Component X appeared as collateral in commit 42 from source Y.
The target had no local source evidence, so X is a victim unless prop/context proof says otherwise.
```

Bad:

```text
X is slow because it appears in hot sources.
```

Good:

```text
X is a hotspot across 12 commits. In the representative commit, X is collateral from Y.
Fix belongs above X or at the Y→X boundary, not inside X yet.
```

#### Single-component report format

```text
📏 target: <Component> @ <file>:<line>
   commit: <N>
   role: source | collateral | hotspot | context | store | mount/remount | restart/discarded
   commit shape: collateral=<n>, sources=<n>, restarts=<n>, contextUpdates=<n>
   raw work: component renders=<hooks+classes>, DOM=<domWorkCount>, mounts=<componentMountWorkCount>
   value/source path: <hook/prop/context/store> from <Owner/Parent/Provider> @ <file>:<line>
   cause: <one sentence using the evidence-backed category>
   fix layer: above source | at boundary | below source | no fix yet
   confidence: confirmed | likely | partial
   next gap: <unknown field, or "none">
```

---

## Pattern 1 — Context Provider emitting new value identity with equal data

**Signal:** `contextChanges[]` shows high `count` for one Provider. `changeSummary` says `"fields: ..."` or `"identity changed"` but values look the same.

**Why it happens:** The Provider's parent re-renders and constructs a new object/array literal inline:
```jsx
// Bad — new object every render
<MyContext.Provider value={{ user, settings }}>
```

**Fix: `useMemo` the context value.**
```jsx
const ctxValue = useMemo(() => ({ user, settings }), [user, settings]);
<MyContext.Provider value={ctxValue}>
```

**How to find the Provider:**
- `contextChanges[N].source.fileName` + `lineNumber` — open that file at that line.
- Look at the JSX returned by that component. Find the `<X.Provider value={...}>` call.
- If `value` is an inline literal, that is the bug.

**Verify:** Re-arm, reload, re-read `contextChanges[]`. Count for that Provider should drop to 0 or 1 (initial mount only).

---

## Pattern 2 — setState cascade (source → collateral blast)

**Signal:** One component appears in `sources` across many commits. Its `trashers` in `commit-peek N sources` show state flipping (often back and forth). Many `commit-peek N rendered` entries with `isSelfSource: false` sit below it (`parentSourceId` / `ownerSourceId`).

**Why it happens:** A `setState` fires on every render or in an effect with unstable deps, causing the component to re-render, which propagates to all its children.

**Sub-pattern A — unstable JSX passed as prop.**
Parent re-renders → creates new JSX node → child sees new `children` prop → child re-renders.
```jsx
// Bad — new JSX identity every render
<Child items={data.map(d => <Row key={d.id} {...d} />)} />
```
Fix: extract to a memoized variable or component:
```jsx
const rows = useMemo(() => data.map(d => <Row key={d.id} {...d} />), [data]);
<Child items={rows} />
```

**Sub-pattern B — effect with missing or unstable deps.**
```jsx
// Bad — runs every render because `config` is new each render
useEffect(() => { setState(derive(config)); }, [config]);
```
Fix: stabilize the dep (memoize `config`) or derive inside render without an effect.

**How to find the source:**
- Open `sources[N].source.fileName` + `lineNumber`.
- Read `trashers` in `commit-peek N sources` — which hook index, what changed.
- Match `hookIndex` to the component's hook chain (use `probe-hooks` if needed).
- Trace why that hook fires: look at its deps or the dispatch call site.

---

## Pattern 3 — Collateral blast with no data dependency (missing memo boundary)

**Signal:** A subtree appears as `commit-peek N rendered` entries with `isSelfSource: false` on every commit. The components have no local hook changes and are not data-dependent on what changed. The nearest common ancestor (`P3`) is the blast source.

**Why it happens:** A parent re-renders (for a legitimate reason) and pulls its entire subtree with it — even parts that don't care about the change. No `memo` boundary exists to stop the propagation.

**Fix: `React.memo` on the subtree root.**
```jsx
// Wrap the expensive, stable subtree
const StablePanel = React.memo(function StablePanel({ config }) {
  return <ExpensiveTree config={config} />;
});
```

**Rules for memo boundaries:**
- Wrap at the highest stable point in the subtree, not deep inside it.
- Props passed to the memoized component must themselves be stable (primitives or memoized objects). Passing an inline `{}` or `[]` defeats the memo.
- If the memoized component receives callbacks, wrap those in `useCallback`.

**How to find where to place the boundary:**
- Place P1 on a collateral component. Run `probe-owners` — walk the owner chain upward.
- The memo boundary goes on the highest owner that does **not** need to re-render when the trigger fires.
- Verify: after adding `memo`, re-capture. The component should disappear from the collateral `rendered` entries.

---

## Fiber reading — what you need before fixing anything

For any of the above patterns, you need to understand the fiber composition before touching code. The sequence:

1. **`probe-dom <clientId> <probeId>`** — exact element and text. Orient.
2. **`probe-owners <clientId> <probeId>`** — full owner chain with `propNames` at each level. Find where the value enters.
3. **`probe-prop-value <clientId> <probeId> <propName> [ownerIndex]`** — confirm identity of the suspect value.
4. **Open file at `source.fileName` + `lineNumber`** — never grep when probe has a location.
5. **`probe-hooks <clientId> <probeId>`** — only if hook index from avalanche needs mapping to actual hook call.

`propNames` at each owner tells you what can flow in. `hookCount` warns you if spelunking local state will be expensive. `owners[N]` is coordinates into the owner chain — `ownerIndex 0` = immediate owner.

---

## Analysis modes — when the obvious commit is not enough

Use these modes when a full-page interactive capture is noisy or the largest commit looks inevitable. They are lenses over the same Avalanche data, not new commands. If one capture spans too many waves to hold in context, use paginated subagent analysis from [avalanche-detector](avalanche-detector.md) and join findings before choosing a fix.

### Mode: noise reduction

Goal: reduce the small repeated birds so the real signal is easier to see.

Use when:
- the main commit is large but mostly legitimate work
- many later commits repeat small sources, effects, callbacks, memos, or context updates
- the page feels busy after the obvious interaction should be done

Process:

```text
1. Accept that the big commit may be necessary.
2. Inspect commits after the main wave.
3. Rank by repeated sources, `effects`, `memos`, `callbacks`, or `contextUpdates`.
4. Pick one small repeated source/provider.
5. Ask whether it represents real data movement or identity/noise.
6. Fix one noisy bird, then re-capture to see what signal remains.
```

Typical fixes:
- memoize provider values that recreate equal data
- stabilize callbacks/objects passed across memo boundaries
- narrow store/context selectors
- stop effects that dispatch because deps changed identity

Report as:

```text
The large commit is not the first fix target. It contains necessary <mount/data/UI> work.
The reducible noise is commits <N..M>: repeated <source/provider/effect> caused by <identity/store/effect>.
Fixing that should make future captures cleaner and expose remaining real work.
```

### Mode: first principles

Goal: ask what should have been different earlier so the future wave was smaller.

Use when:
- a later commit is large but downstream of an earlier setup choice
- a provider/store/list/key/selector decision made the later wave inevitable
- you need an architectural fix, not a local patch inside the hot component

Process:

```text
1. Pick the later visible wave.
2. Walk backward until the first source/provider/store/key/identity setup that made it happen.
3. Ask what invariant should have held before the wave.
4. Choose the earliest boundary that could have preserved that invariant.
5. Verify by re-running the same interaction and checking later commits shrink or disappear.
```

Examples:
- If commit 42 remounts a list because keys changed, the fix is the earlier key/data identity setup, not the row render body.
- If commit 42 blasts consumers because provider value changed identity, the fix is the provider value construction before the blast.
- If commits 43-47 continue because an effect sees fresh deps, the fix is the dependency source that existed before those effects fired.

Report as:

```text
The future wave was caused by an earlier broken invariant: <invariant>.
Fix belongs before the hot commit at <source/boundary/provider/store setup>.
Expected verification: later commits lose <collateral/context/restart/repeat> signal.
```

---

## PR discipline — one Provider / one source at a time

400 context updates is a list of independent problems. Each fix is:

1. Pick the highest-count Provider from `contextChanges` grouping.
2. Classify (Pattern 1, 2, or 3).
3. Fix exactly that one Provider or source. No bundling.
4. Re-arm, reload, verify count drops.
5. PR. Then next.

This keeps diffs reviewable and regressions attributable.

---

## Distinguishing shallow-equal churn from real data movement

Look at `changeSummary` and `prevValue` / `currValue` in `contextChanges[]`:

| Pattern | Signal | Verdict |
|---|---|---|
| Value changes on every commit, content identical | `"identity changed"` or `object → object` with stable semantics | Pure churn — fix with memoization or cached object identity |
| Value changes in registration-style fields | `"fields: placements"`, `"fields: targets"`, similar append/replace transport fields | Real data movement — skip for low-hanging pass |
| Value changes in content fields | `"fields: avatarImage"`, text, IDs, flags, payload data | Real data movement — skip unless proven shallow-equal after inspection |
| Value changes once, then stable | Single entry in `contextChanges` | Mount-time init — probably fine |
| Value changes on every keystroke/click | Many entries, content actually changes | Intentional reactivity — needs deeper refactor |

Rule: during the first perf pass, take only the shallow-equal / identity-only rows. Defer registration and transport churn to a separate refactor track.
