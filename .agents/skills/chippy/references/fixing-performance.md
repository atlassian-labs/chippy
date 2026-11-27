# Fixing performance — avalanche-driven workflow

Use a capture to classify render behavior and choose a fix. Investigate one Provider or one source at a time.

This file owns three things: the [protection inventory](#protection-inventory), the [fix ladder](#fix-ladder) and the [report gate](#report-gate). The read order for a complaint lives in [perf-triage](perf-triage.md); the pattern cards live in [patterns-render](patterns-render.md), [patterns-effects](patterns-effects.md) and [patterns-latency](patterns-latency.md); the compiler decision lives in [react-compiler](react-compiler.md).

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
chippy.sh avalanche-commit-peek <clientId> <commitId> stats,sources,metrics 3 30
```

Do not pipe the full export through an ad-hoc reducer. Use prepared Chippy views. If they cannot expose the required Provider detail, report that command gap or add a first-class view before making a causal claim.

Why the settle window matters: stopping on reconnect is too early for heavy pages. Post-load React work can continue for seconds after the page is back, so a short window undercounts the load.

Context evidence identifies a Provider and source location. Open that file and line directly, then determine whether the value carries real data changes or only a new reference.

After context: use hot sources and one bounded commit peek for source and thrash signals.

### Applying the filter in practice

Filter rule for low-hanging fruit: **focus on shallow-equal churn only**. If the context payload carries genuinely new UI registrations, placements, targets, or other transport data, that is not a one-line churn fix.

Shallow-equal / identity-only candidates usually look like this:

- the Provider's consumers receive `propChanges[]` with `sameShallow: true`, or their `changedHooks[]` show `sameContent: true`, on every commit
- a large `rebuiltProps` group in `avalanche-summary` `topCommits[]` for the same value
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
| **Collateral** | `commit-peek N rendered` entry without `isSelfSource` | Re-rendered with no local change. Downstream blast victim. |

A hotspot is not necessarily a trigger. A collateral render is not a problem by itself. Find the trigger first; fix the trigger when it is an unintended change, and contain the collateral when the trigger is a real change and the collateral cost is measured.

A collateral row is waste only when it could have been skipped: it sits under a `memo` boundary and received only rebuilt props (`propChanges[]` with `sameShallow: true`), or its measured render time matters (about 1 ms or more per commit on a production or profiling build; Chippy measures time per commit, so attribute it with the React DevTools Profiler or an A/B). `rendered[]` does not say whether a component is wrapped in `memo`; confirm that from the owner chain or source.

> **Confirm hook kind and origin.** Once you have a source and a changed `hookIndex`, classification by primitive (`SyncExternalStore`, `State`, `Memo`, `Effect`, …) and custom-hook owner is the next decision. See [debug-hook](./debug-hook.md). Use it before picking a fix; the primitive narrows the remediation table to one row.

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

5. **Pick the lowest rung that removes the measured friction and keeps every protection**
   - If the source should not update, fix above.
   - If the source must update but children should not, fix boundary or children.
   - Among fixes that work, choose the lowest rung of the [fix ladder](#fix-ladder) and the boundary that stops propagation with the fewest changed lines.

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
   pattern: <card id, e.g. RW-2 or EF-1> (Confirmed | Needs evidence | Observation | Rejected) | unclassified
   protections: <what the code here provides that a fix must keep>
   fix: <lowest fix-ladder rung and the knob> | no fix yet
   confidence: confirmed | likely | partial
   next gap: <unknown field, or "none">
```

---

## Patterns

The pattern catalog lives in its own files. Each card says how to prove the problem, what the current code protects, the smallest fix, when the fix is wrong, and how to prove the fix.

| Family | Patterns | File |
|---|---|---|
| Render waste, expensive render, remount | RW-1 unstable identity to a memo child, RW-2 children as JSX, RW-3 context fan-out, RW-4 state held too high, RW-5 list append, RW-7 store selector, EX-1 expensive render, RM-1 key remount | [patterns-render](patterns-render.md) |
| Effects | EF-1 effect re-fires from identity, EF-2 derived state via effect, EF-3 effect chains, EF-4 fetch in effect | [patterns-effects](patterns-effects.md) |
| Waits and long tasks | LT-1 trailing-only debounce, LT-2 stacked debouncers, LT-3 apply vs persist, LT-4 long task, NW-1 late start, NW-2 waterfall, NW-3 stale response race | [patterns-latency](patterns-latency.md) |
| Compiler adoption | When the compiler is the full, partial or irrelevant answer | [react-compiler](react-compiler.md) |

---

## Protection inventory

Before changing a debounce, a memo, an Effect, a key, a cache, a selector or a loading boundary, write down what it protects. Typical protections: correctness of the final state, write ordering, save durability, server load, burst coalescing, focus and scroll, animation, accessibility, cleanup under StrictMode, and shared callers of the same mechanism.

Then choose the smallest knob that removes the friction and keeps every protection: a leading edge instead of removing a debounce, `flush()` instead of `cancel()` for a pending save, a stable callback instead of deleting a dependency, a memoized provider value instead of a new store. Restructure a mechanism only when its protections are re-measured after the change. Never bypass a shared mechanism for one caller; change it at its owner or propose the change to the owner.

Each protection becomes a protected scenario: an `ab-capture` arm or a written manual step that must behave the same after the fix ([ab-testing](ab-testing.md#verifying-a-fix)).

---

## Fix ladder

Climb from the top. Stop at the first rung that removes the measured friction and keeps every protection.

**Entry criteria.** The problem is Confirmed. Needs evidence goes back to Prove with the named capture; an Observation carries no fix. The protection inventory exists. The protected scenarios are written down.

| Rung | Fix | Use when | Wrong when |
|---|---|---|---|
| 0 | Measure in the right build | Always first: development builds, StrictMode double rendering and an attached profiler inflate cost | — (if the cost disappears in a production or profiling build, report an Observation) |
| 1 | Remove work that should not exist: derive in render, move event logic into the handler, reset with `key` ([patterns-effects](patterns-effects.md#removing-an-effect)) | The Effect does not synchronize with anything outside React | The Effect does synchronize with a subscription, the DOM or the network |
| 2 | Stabilize what should be stable, in the [dependency order](patterns-effects.md#fixing-effect-dependencies) | Identity changes, content does not (`sameShallow: true`, `sameContent: true`) | The value really changes, or the Effect must re-run on it |
| 3 | Adjust the edge of a timing mechanism: leading edge for discrete actions, `flush()` on Enter, blur, submit, unmount and `pagehide`, `cancel()` only for reads, one coalescing layer ([patterns-latency](patterns-latency.md#timing-mechanisms-keep-them-change-the-edge)) | A timer-sized idle gap in `avalanche-timeline` | The leading edge would double requests the server cannot absorb (keep trailing-only and flush the discrete action; `maxWait` caps the delay but does not reduce calls) |
| 4 | Start earlier or in parallel: start on intent, hoist queries, drop stale responses | Late start, waterfall or out-of-order rows in `avalanche-network` | Prefetch multiplies load for unlikely intents; B really needs A's result |
| 5 | Contain collateral with structure: move state down, lift content up, split a context or use store selectors, add a `memo` boundary with stable props | The trigger is a real change and the collateral cost is measured | The collateral is cheap, or the boundary's props are always new |
| 6 | Adopt or extend React Compiler ([react-compiler](react-compiler.md)) | Identity-driven waste across many components, or a compiled component that bails out | The cost is network, timing, Effects or a real value change |
| 7 | Reduce or defer render cost: `useDeferredValue` with a memoized slow child, `useTransition`, virtualization, yielding in long handlers | EX-1 or LT-4 with measured render time | The work must finish before the next paint (`useTransition` cannot wrap a controlled input's setter; use `useDeferredValue` there); virtualization breaks find-in-page, accessibility or scroll restoration the product needs |
| 8 | Restructure the mechanism: a new library, data flow or caching design | Rungs 1-7 cannot remove the friction, and every protection is re-measured after the change | A shared mechanism would be bypassed for one caller |

**Exit criteria.**
- `ab-compare`: the target timing is `better` with at least 3 samples per arm, captured interleaved; behavior is `equivalent` on the protected scenarios, or `behavior-changed` only in keys announced before the capture. For waits, compare `avalanche-timeline` per arm, because `ab-compare` does not judge waits.
- The triage line, re-read on the after-capture, no longer shows the pattern's signature.
- No new Effect re-runs, remounts or console errors.

---

## Report gate

A performance report or fix proposal may be sent only when all of these hold:

1. **Complaint and capture named.** The user action, the symptom, the capture, and the build type (development, profiling, production). Development-only costs are labeled.
2. **Waited vs worked stated** with the deciding numbers: the largest wait and what covered it (`perceived.waits[].waitedMs` when a fallback was shown, otherwise `perceived.idleGaps[].ms` and what ended it); `worstInteractionMs` and its dominant phase (`inputDelay`, `processing`, `presentationDelay`); `totalBlockingMs`.
3. **Triage line.** `trigger -> mechanism -> collateral -> cost`, with the trigger taken from `isSelfSource` rows, `changedHooks` or `latestAction` and the collateral from `rendered[]`. Hot components are not presented as causes.
4. **Pattern and outcome.** A pattern id from the catalog, or "unclassified", and an outcome: Confirmed, Needs evidence, Observation or Rejected. Observations carry no fix.
5. **Protection inventory** for any proposed change, and how the fix keeps each protection.
6. **Smallest knob.** The proposed rung, and why a lower rung does not remove the friction.
7. **Proof plan or proof.** For a proposal: the `ab-capture` arms, the protected scenarios, and the intended behavior changes announced in advance. For a verified fix: the `ab-compare` verdict and the timing change with at least 3 interleaved samples per arm, naming any `drifting` or `not-judged` timing.
8. **Contested advice and gaps marked.** Version-dependent advice names the version; evidence Chippy cannot provide is named as a gap, not inferred.
9. **No product edits unless asked.** The report proposes; the user decides.

---

## Worked examples

These two examples show the role reading behind the cards. The cards in the pattern files are the reference for fixes.

### Example — one source re-rendering a subtree on every commit

**Signal:** one component appears in `sources` across many commits, and many `rendered[]` rows without `isSelfSource` sit below it (`parentSourceId`, `ownerSourceId`).

**Read it:**
- `avalanche-summary` `topCommits[].sources[].changedHooks[]` names the changed hook `index` and whether `sameContent` is true. In `full` or `amplifiers` mode, `commit-peek <clientId> <commitId> sources` adds `trashers[]` with `prevValue` and `currentValue`.
- Map the hook index to its call with `avalanche-debug-hook` ([debug-hook](debug-hook.md)) or `probe-hooks`, then read why that hook changes: its dependencies, or the call site of its setter.
- `sameContent: true` means equal content under a new identity: [RW-1](patterns-render.md#rw-1-unstable-identity-reaching-a-memo-child), [RW-7](patterns-render.md#rw-7-store-selector-returns-a-new-object), or, when the setter runs in an Effect, [EF-2](patterns-effects.md#ef-2-derived-state-via-effect).
- `sameContent: false` means a real change. Leave the trigger and decide whether the collateral is worth containing.

### Example — a subtree with no data dependency renders with its parent

**Signal:** a subtree appears as `rendered[]` rows without `isSelfSource` on every commit, and its components do not read what changed. Their nearest common ancestor is a candidate trigger; confirm it with its `isSelfSource` row before naming it.

**Read it:**
- Is the collateral measured as costly? If not, report an Observation.
- Is there a `memo` boundary? If one exists, its `propChanges[]` say which prop defeats it ([RW-1](patterns-render.md#rw-1-unstable-identity-reaching-a-memo-child), [RW-2](patterns-render.md#rw-2-children-passed-as-jsx-defeat-memo)). If none exists, consider moving state down or lifting content up ([RW-4](patterns-render.md#rw-4-state-held-too-high)) before adding `memo`.
- A new `memo` boundary only helps when every prop it receives is stable. Place it on the highest owner that does not need to re-render when the trigger fires (walk `probe-owners` upward from a collateral component).
- Verify: re-capture the same action; the subtree disappears from `rendered[]`.

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

1. Rank commits with `avalanche-commit-list <clientId> 15 contextUpdates`, then find the provider with `eval-page <clientId> find-context-providers` and size it with `count-context-consumers` ([P-08](procedures.md)).
2. Classify it with a pattern card (usually [RW-3](patterns-render.md#rw-3-context-fan-out)).
3. Fix exactly that one Provider or source. No bundling.
4. Repeat the same capture and verify that its consumers leave `rendered[]`.
5. PR. Then next.

This keeps diffs reviewable and regressions attributable.

---

## Distinguishing shallow-equal churn from real data movement

Chippy has no provider value diff. Read the identity question from the fields it does emit:

| Pattern | Signal | Verdict |
|---|---|---|
| New identity, equal content | `changedHooks[].sameContent: true` in `avalanche-summary`; `propChanges[]` with `sameShallow: true`; a large `rebuiltProps` group with `sameShallow: true` | Identity churn: stabilize the value ([fix ladder](#fix-ladder) rung 2) |
| Real change in a few keys | `propChanges[].changedKeys` lists content keys (ids, text, flags, payload) | Real data movement: contain the collateral or accept it |
| Changes once, then stable | Only the mount commit shows the change | Mount-time initialization: usually fine |
| Changes on every keystroke or click with real content | `changedKeys` differ each commit | Intended reactivity: needs a structural fix (rung 5), not memoization |

Rule: in the first perf pass, take only the identity-only rows. Defer real data movement to a separate change with its own protection inventory.
