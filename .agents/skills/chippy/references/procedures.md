# Chippy Procedures — Ceremonies, Procedures, Plays

The P-01..P-23 procedures turn routed Chippy cases into executable evidence and verification chains. Use one after [bdd-router](bdd-router.md) selects it.

Canonical phase contracts and apply gate live in [operating-model](operating-model.md). This file only defines executable procedure chains.

## Procedures

Named workflows that compose documented Chippy commands into repeatable chains. The command contract lives in the main [SKILL.md](../SKILL.md#command-surface).

### P-01 · Verify Runtime (Ceremony — every turn)

**When:** Before any probe, fiber, or avalanche action. Every single turn.

```
health → pages → request-snapshot <clientId>
```

1. `health` — helper alive?
2. `pages` — which page? Pick by URL, title, integration identity, and `latestSnapshotAt`. If two pages still match closely, ask which one is in scope.
3. `request-snapshot <clientId>` — fresh state from the live page.
4. Extract `clientId`. Never reuse stale clientId across turns.

**Done when:** clientId is confirmed fresh. Snapshot timestamp is current.

---

### P-02 · Trace Element to Source (Core Procedure)

**When:** User points at something visible and asks "what is this?" / "why does this show X?".

```
probe-dom → probe-owners → probe-props/probe-prop-value → open file at source.fileName:lineNumber
```

1. `probe-dom <clientId> <probeId>` — identify exact element, text, tag, source.
2. `probe-owners <clientId> <probeId>` — walk owner chain; read propNames at each level.
3. `probe-prop-value <clientId> <probeId> <propName> [ownerIndex]` — find which owner carries the value.
4. Open `source.fileName` at `lineNumber`. Read it. No grep.
5. If the task is to walk the React fiber path, use `probe-parents <clientId> <probeId>` for the `fiber.return` parent chain. If starting from a remembered fiber, run the [debug replay preflight](active-stimulus.md#debug-replay-preflight) only when `explain-component` is needed, then use `inspect-fiber-parents <clientId> <fiberId>`. `probe-owners` reads `_debugOwner` on debug builds; on production builds it falls back to component parents labeled `ownerStackKind: "parents"`.
6. If large component (`hookCount > 50`): run the [debug replay preflight](active-stimulus.md#debug-replay-preflight), then `explain-component`; use `describe-component` only if needed.
7. State finding in reporting format (📏 probe resolved to…).

**Done when:** component + file + line + prop forwarding hop all named.

---

### P-03 · Inspect Large Component (Procedure)

**When:** `hookCount > 50`, `parents > 50`, or `matchedStyles > 20` on a probed component.

```
explain-component → (if needed) describe-component → probe-prop-value / inspect-fiber-structure
```

**Replay preflight:** before step 1, follow the [debug replay preflight](active-stimulus.md#debug-replay-preflight). Name the target and disclose that the three structure commands can execute component and hook bodies without scheduling an application update. If render-time execution is unsafe or cannot be accepted for this target, use the fiber-only `probe-hooks-summary` / `inspect-fiber-hooks-summary`, props, and owners commands instead, and report that custom-hook ancestry was not replayed.

1. `explain-component <clientId> <probeId|fiberId|name>` — compact overview. It may run dispatcher-based debug replay, so inspect `replayStatus` and `warnings`; replay executes component and hook bodies without scheduling an application update.
2. Form a concrete question from the map.
3. If needed: `describe-component <clientId> <fiberIdOrName>` — full custom-hook tree. It has the same replay execution boundary as step 1.
4. Answer the concrete question with `probe-prop-value` or `inspect-fiber-structure <clientId> <fiberId> <hookIndex>`. Structure inspection may also replay; check its `replayStatus` and `warnings`.

**Done when:** concrete question answered with source evidence.

---

### P-04 · Runtime Performance Investigation (Play)

**When:** User reports lag, jank, slow click, slow scroll — on an already-open page.

```
avalanche-arm → [user/harness interacts] → avalanche-status → avalanche-summary → perf-triage (waited vs worked) → hot sources / commit list / commit peek, or timeline / network / perf
```

1. `avalanche-arm <clientId> <origin>` — arm on live page, NO reload.
2. Ask user to perform the slow interaction (or replay via Playwright).
3. `avalanche-status <clientId>` — confirm commits captured.
4. `avalanche-summary <clientId>` — totals, timeline text, top commits.
5. Decide waited vs worked with [perf-triage](perf-triage.md) Step 1. A wait goes to `avalanche-timeline`, `avalanche-network` and `avalanche-perf` ([P-21](#p-21--latency-and-wait-investigation-play)); stop reading render counts for it.
6. For work: `avalanche-hot-sources <clientId> 20` → `avalanche-commit-list <clientId> 15 collateral` → `avalanche-commit-peek <clientId> <commitId> stats,sources,rendered 6 40` on the peak commit.
7. `renderedByCommit`, `isSelfSource`, and `propChanges` are already present in the default `sources` capture. If the route needs `trasherCounts`, run `avalanche-recapture <clientId> full`, reproduce the identical interaction once, then repeat status → commit-list → `avalanche-commit-peek ... stats,sources,rendered`.
8. Separate trigger from collateral ([perf-triage](perf-triage.md) Step 3W) and match a pattern card.
9. Trace source via probe-owners or find-fibers.
10. Write the triage line, then P-15 (proof packet) → P-16 (fix gate, fix ladder, protections) → P-12 (verify).

**NEVER:** reload for runtime perf. Use `avalanche-arm` only.

---

### P-05 · Load Performance Investigation (Play)

**When:** User says "page is slow to load" / "initial paint is slow" / "first load takes too long".

```
reload-with-avalanche → avalanche-status → avalanche-summary → perf-triage → (worked) hot-sources → commit-list → commit-peek | (waited) timeline → network → P-21
```

1. `reload-with-avalanche <clientId> <origin> 0 15000 5000` — arms, reloads, waits settle.
2. `avalanche-status <clientId>` — confirm integrationMode, commitCount.
3. `avalanche-summary <clientId>`, then decide waited vs worked with [perf-triage](perf-triage.md) Step 1. Late starts and waterfalls are waits, not render cost: read `avalanche-timeline` and `avalanche-network` and continue with [P-21](#p-21--latency-and-wait-investigation-play).
4. Worked: `avalanche-hot-sources <clientId> 20` — top sources across the load window.
5. `avalanche-commit-list <clientId> 15 collateral` — identify the main wave.
6. `avalanche-commit-peek` — inspect before / during / after windows.
7. Trace source. Then P-15 → P-16 → P-12; re-run `reload-with-avalanche` per arm to verify.

**NEVER:** use `reload-with-avalanche` for runtime/interaction perf.

---

### P-06 · Stability Render — Subtree Grade (Play)

**When:** "Does this component re-render when it shouldn't?" / after a fix, verify no regression / suspect unstable memo.

```
verify runtime → recapture full mode → schedule one fiber render → settle 1s → status + commit-list + commit-peek → classify
```

1. `health` → `pages` → `request-snapshot` (P-01).
2. `avalanche-recapture <clientId> full` — install a clean full-mode capture so `trasherCounts` are recorded alongside `renderedByCommit`.
3. Schedule exactly one target render:
   - DOM/probe anchor: `eval-page <clientId> stability-nudge --testId <data-testid>`. For a probed component, resolve a current `fiberId` with `explain-component <clientId> <probeId>` or `find-fibers` and use the fiber route below.
   - current fiber token from `find-fibers`: `fiber-schedule-update <clientId> <fiberId>`.
4. `sleep 1` — settle.
5. `avalanche-status <clientId>` — read `commitCount` and confirm the capture is installed and active.
6. `avalanche-commit-list <clientId> 20 collateral` — enumerate every commit in this fresh nudge window and record its `commitId`.
7. For every listed commit: `avalanche-commit-peek <clientId> <commitId> stats,sources,rendered 3 50` — this is the mandatory source for `renderedTotal`, `stats.collateral`, `sourcesByCommit`, `renderedByCommit`, `propChanges`, and `trasherCounts`.
8. `avalanche-hot-sources <clientId> 12` — rank the source families after the bounded detail is present.
9. Classify using the verdict-to-signal table below. If no row matches, return to the real interaction capture and report a bounded result instead of forcing a verdict.
10. For leak: walk the top commit's collateral entries top → bottom → first collateral without memo or with defeated memo.
11. For trasher: find the same source with non-zero `trasherCounts` in at least two commit-peek results → trace the recorded hook via `avalanche-debug-hook <clientId> <sourceId> <hookIndex>`.
12. For unclear hook role: switch to P-07 (debug-hook).
13. If Observe classified the case as Complex and the proof packet would use `confidence: likely`, repeat steps 2–12 with the identical target, scheduling command, label, settle window, and read commands. The verdict and causal signature must repeat before Apply is eligible.
14. Build P-15. If the user requested a change and P-16 passes, apply one fix and run P-12 with the same nudge. Otherwise report the proof packet. Compare commitCount / renders / collateral / `trasherCounts` only after an authorized edit.

### P-06 verdict ↔ JSON signature

Maps the four verdicts to the exact Avalanche fields that produce them. Read `commit-peek include=stats,sources,rendered` after the nudge.

| Verdict | `commitCount` after nudge | `sourcesByCommit` pattern | `renderedByCommit` pattern | Next play |
|---|---|---|---|---|
| **clean** | 1 | nudged sourceId only (or empty) | nudged target only; no `trasherCounts` | None — invariant holds |
| **leak** | 1 | nudged sourceId only | high collateral count under target; no `propChanges` on collateral entries (cascade from non-memoized children) | step 10 — find collateral without memo |
| **leak+cascade** | >1 | same sourceId repeats across commits | `isSelfSource: true` on the same sourceId; no `propChanges` | P-07 on the self-source's hook |
| **trasher** | ≥2 | the same component source persists across commits | non-zero `trasherCounts` on that component in at least two commits | step 11 — `debug-hook` the recorded amplifier hook |

`renderedByCommit` is recorded in every detection mode, but `stats` never sets `isSelfSource` and only `full` (or `amplifiers`) records `trasherCounts`. Re-arm with `detectionMode: 'full'` before reading the trasher verdict.

Verdicts are mutually exclusive: persistent non-zero `trasherCounts` takes precedence. Without that signal, repeated self-source commits are `leak+cascade`; a different source alone is not a trasher.

**Anchor contract:** target one current composite fiber and schedule one extra render. No hook or prop is mutated. The extra commit and any render-time side effects or effects in that subtree are the pollution boundary.

---

### P-07 · Hook Interrogation (Procedure)

**When:** Avalanche or stability-render surfaced a `sourceId` + changed `hookIndex`. Hook role is unclear.

```
avalanche-recapture → reproduce trigger → avalanche-hot-sources → avalanche-debug-hook
```

1. Confirm `sourceId` and `hookIndex` from prior capture.
2. If a previous run returned `hook event not found` with `eventCount: 0`: `avalanche-recapture <clientId>` → reproduce the original trigger → re-read hot-sources for `sourceId` and `hookIndex`.
3. `avalanche-debug-hook <clientId> <sourceId> <hookIndex> 3`.
4. Read `primitive` first — routes to remediation branch entirely.
5. Read `parents`, `neighborhood`, and `resolvedComponentName`. debug-hook does not return hook values; take value and identity evidence from `commit-peek` or stability-render.
6. Match to root-cause table (SyncExternalStore / State / Reducer / Memo / Callback / Effect / Context).
7. If existing labels are insufficient, open the known component source and match the primitive against hook call order and neighboring hooks. If it remains ambiguous, report the exact localization gap; do not edit source during Prove.
8. Name the evidence-backed remediation branch. Return to fixing-performance for fix-layer choice.

**NEVER:** use debug-hook to find a source from scratch (use avalanche-hot-sources for that).

---

### P-08 · Context Wave Investigation (Procedure)

**When:** `contextUpdates` high in commit stats / "context is re-rendering too much".

```
avalanche-commit-list contextUpdates → commit-peek stats,sources,metrics → find-context-providers → unique provider fiber → direct schedule-update
```

1. `avalanche-commit-list <clientId> 15 contextUpdates` — identify context-heavy commits.
2. `avalanche-commit-peek <clientId> <commitId> stats,sources,metrics` — read contextUpdates field.
3. `eval-page <clientId> find-context-providers [--name regex]` — find provider fibers.
4. `eval-page <clientId> count-context-consumers --name <regex>` — blast radius.
5. Resolve a current provider fiber before entering P-06:
   - use the provider sample's `name` and `source.fileName` with `find-fibers --name <exact-name> [--file <escaped-file>] --max 5`;
   - require one match whose source and owner agree with the provider sample; narrow the name/file filters if several remain;
   - if no unique current fiber can be established, report the targeting gap rather than nudging an ancestor;
   - run P-06 with `fiber-schedule-update <clientId> <fiberId>` on that provider composite. Does its value identity churn when the provider itself re-renders?
6. If `SyncExternalStore`: use debug-hook (P-07) to check selector identity.
7. Build P-15. If the user requested a change and P-16 passes, choose the proven layer: memoize the provider value, split context, or narrow the selector. Then run P-12 with the same capture.

---

### P-09 · Large Capture — Paginated Analysis (Ceremony)

**When:** 100+ commits, multi-wave capture, shell output truncates.

```
avalanche-save → avalanche-offline summary → commit-list (multiple sort keys) → delegate ranges to subagents
```

1. `avalanche-save <clientId> .chippy-captures/run.json`.
2. `avalanche-offline .../run.json summary` — meta, total commits.
3. `avalanche-offline .../run.json commit-list 30 collateral` + `restarts` + `contextUpdates` — build timeline. Offline accepts the same sort keys as live.
4. Identify waves by question: setup / main wave / continuation / noise.
5. Per wave: `avalanche-offline commit-peek` on selected commit ids — reduce to stats+sources+metrics.
6. Delegate each range to a subagent with **one concrete pre-stated question**.
7. Collect compact findings. Join in main context. Rebuild crime scene: setup → main wave → noise.
8. Prefer one upstream fix over many local patches if multiple slices share one root.

**Rule:** No question = no subagent. No raw exports to subagents.

---

### P-10 · Source Trace — Fiber Path (Procedure)

**When:** Probe or find-fibers returned a fiber; need to trace where a value comes from without a live probe.

```
find-fibers → describe-component → inspect-fiber-structure → open file
```

1. `find-fibers <clientId> --name <ComponentName>` (or `--testid`, `--prop`, `--text`).
2. Run the [debug replay preflight](active-stimulus.md#debug-replay-preflight) for that exact fiber. If replay is unsafe or cannot be accepted, stay on fiber-only hook summaries/props/owners and report the ancestry limit.
3. For complex fiber (`hookCount > 50`): `describe-component <clientId> <fiberId>` — full hook tree.
4. `inspect-fiber-structure <clientId> <fiberId> <hookIndex> 3` — one hook + neighbors.
5. Open `source.fileName` at `lineNumber`. Read it.

---

### P-11 · Production / Minified Page (Ceremony)

**When:** Neither `_debugSource` nor a usable React 19 `_debugStack` source is available, and component names are minified.

1. Fall back to `data-testid`, `nearestTestId` on marker.
2. Use `componentStack` entries (the component parent chain) as locality context; walk leaf → root. Owner results carry `ownerStackKind: "parents"` here; do not describe them as owners.
3. Filter wrapper noise (HOCs, connectors, gates, placeholders) before ranking.
4. Use `probe-parents` for the `fiber.return` parent chain. `probe-owners` falls back to the same parent chain when `_debugOwner` is absent and labels it `ownerStackKind: "parents"`.
5. Be explicit: "source precision is weaker; component name may be minified."

---

### P-12 · Edit & Verify Cycle (Ceremony)

**When:** After any code change.

1. Edit source in workspace.
2. Wait for HMR or trigger reload.
3. Run `pages` again and select the current page by URL, title, integration identity, and recency. Never carry the old `clientId` through HMR, navigation, or reload without re-resolving it. If Mode A reloaded, repeat its required runtime load and explicit detector install before measurement.
4. `request-snapshot <currentClientId>` — fresh state from the re-resolved page.
5. Re-establish every evidence identity in the current page realm:
   - probe anchor: confirm the probe still resolves; reload may clear it, so re-place the same probe before continuing if necessary;
   - fiber anchor: run `find-fibers` again and use the new current `fiberId`;
   - Avalanche `sourceId + hookIndex`: start the required fresh capture, reproduce the trigger, and identify the source/hook again from the new commit evidence;
   - test-id anchor: resolve it again through the current page before stimulation.
6. Re-run the same probe/avalanche/stability commands that diagnosed the issue, using only the refreshed identities.
7. Compare structured output (not screenshots). For a performance fix, capture the before and after builds as A/B arms and run `ab-compare` with the protected scenarios ([verifying a fix](ab-testing.md#verifying-a-fix)).
8. Report: same signals improved? Residual signals? New signals? Announced changes seen, and nothing else?

**NEVER:** mark complete before the same measurement moved.

---

### P-13 · Automated Loop — Browser Harness (Play)

**When:** Task is repeatable, scripted, or runs in CI. No human driving browser.

```
open page → inject runtime → connect → install Avalanche → interact → read structured output → maybe Apply → verify
```

1. Install the devtools-hook shim with `addInitScript` before navigation, then navigate to the story or app URL.
2. Load the runtimes through one Mode A variant: packaged `installHelpers(..., { init: true })` before navigation, or post-navigation `inject.mjs` (preferred) / `inject.js` followed by `avalanche.iife.js`.
3. Confirm the page in `chippy.sh pages` — match by URL + dev client.
4. Run `avalanche-install <clientId>` before any Avalanche capture; runtime loading alone does not install the detector in Mode A.
5. For a post-install interaction capture, run `avalanche-clear <clientId>` and then trigger the interaction. Do not use helper origin-arming in Mode A. After reload, repeat the applicable runtime loading, client resolution, and detector install; boot commits before install remain unavailable.
6. Playwright performs the interaction.
7. Poll for stable state (interval 100–250ms, budget 5–15s).
8. Read structured output (probe, Avalanche, eval-page) and build P-15.
9. If the user requested a change and P-16 passes, edit source; otherwise stop with the proof packet.
10. After an edit, HMR or reload, repeat required injection/install steps, and verify with the same commands and timing window (P-12).

**Key rules:**
- devtools-hook shim must be `addInitScript` BEFORE `page.goto`.
- `inject.mjs` loads the Avalanche runtime; classic `inject.js` requires separate `avalanche.iife.js` injection.
- Mode A always requires `avalanche-install` before capture, whichever bootstrap loaded the runtime.
- Missing `__AVALANCHE__` = missing bundle injection, not a logic bug.
- `commitCount: 0` with `integrationMode: "none"` after a reproduced interaction = detector install was skipped or no post-install commit occurred.
- `window.__CHIPPY` + client in `pages` = connection success. `__chippyPageBridge` is NOT a top-level success signal.

---

### P-14 · Essence Discovery (Observe + Define Play)

**When:** The task is vague, points at behavior, or asks "why" before a fix is requested.

```
runtime anchor → first signal → case definition → invariant → possible roles → proof plan
```

1. Identify the **anchor** from observation:
   - visible element → probe id / nearestTestId / exact DOM text
   - interaction → exact gesture + page state + first measured signal
   - load issue → URL + reload window + first load signal
   - component question → fiber name/testId/source from live tree
2. State the **observation** using the [observation contract](operating-model.md#observation-contract).
3. State the **case** in one sentence using the [case definition contract](operating-model.md#case-definition-contract).
4. Name the **invariant**:
   - data invariant: displayed value should derive from X
   - ownership invariant: prop should be created by Y, not presentation fallback
   - render invariant: subtree should update once, not cascade
   - identity invariant: provider/selector/memo should remain stable for equal data
   - lifecycle invariant: effect should attach only when semantic dependency changes
5. Name plausible **roles** without choosing one yet:
   - value source / forwarder / fallback / renderer
   - update source / collateral / boundary / provider / store / mount
6. Select a proof plan:
   - value/ownership → P-02
   - component internals → P-03/P-10
   - runtime perf → P-04
   - load perf → P-05
   - stability/identity → P-06
   - hook primitive → P-07
   - context/store → P-08

**Done when:** Chippy has observed the anchor and can say what essence is being investigated before naming cause.

---

### P-15 · Proof Packet Assembly (Prove Ceremony)

**When:** Evidence has been gathered but the conclusion is not yet ready to apply.

```
normalize evidence → classify role → state confidence → name next gap
```

1. Gather the raw facts already observed:
   - runtime: `pages`, snapshot, probe, avalanche status
   - structure: owners, parents, hook tree, component stack
   - source: file, line, render block, dep array, provider value, selector, key
   - signal: prop value, hook primitive/value, commitStats, contextUpdates, hot source rank
2. Map facts to one role:
   - **source** — initiates update or creates value
   - **forwarder** — passes value but does not create it
   - **boundary** — should have pruned but did not
   - **collateral** — rendered due to upstream cause
   - **provider/store** — broadcasts or subscribes broadly
   - **mount/remount** — type/key/conditional tree replacement
   - **unknown** — evidence insufficient
3. Assign confidence:
   - `confirmed` — runtime + source agree, no unresolved hop
   - `likely` — runtime + source align but one non-critical hop remains
   - `partial` — only a segment is proven
4. Name exact next gap:
   - missing owner hop, missing hook primitive, missing provider value diff, missing before/after capture, etc.
5. Apply the [per-domain confidence rule](operating-model.md#per-domain-confidence-rule). Clear and Complicated cases require `confirmed`; repeatable Complex experiments may use `likely`; `partial` never passes. If the current domain's threshold is not met, route to the next proof procedure.

**Done when:** conclusion is explicit and falsifiable.

---

### P-16 · Fix Gate (Apply Decision Ceremony)

**When:** User asks for a fix or a proof packet suggests an edit.

```
proof packet → apply gate → protections → fix ladder rung → verification plan → edit
```

1. Check the Apply Gate from [operating-model](operating-model.md):
   - Definition exists.
   - Evidence exists: the pattern card's "Prove the problem" is met (status Confirmed).
   - A fix candidate is named (the pattern card's fix, not a guess).
   - Verification command exists.
2. If any gate is missing: return to Prove, do not edit.
3. List what the current code protects ([protection inventory](fixing-performance.md#protection-inventory)): every debounce, cache, memo, key, ordering or batching it relies on, and the scenario that proves each.
4. Choose the lowest [fix ladder](fixing-performance.md#fix-ladder) rung that removes the measured friction and keeps every protection. Change a mechanism's smallest knob (an edge, a dependency, a key) before removing or replacing it. When the mechanism is shared, change it at its owner or not at all.
5. State edit intent in plain language:
   - what changes
   - why this rung is correct and the lower ones are not
   - what signal should move after edit, and which changes are intended (fewer requests, one fewer commit)
6. Apply only if the user requested implementation or confirms.
7. Verify with P-12 using the same measurement, and report through the [report gate](fixing-performance.md#report-gate).

**Done when:** edit is either authorized and verified, or explicitly deferred.

---

### P-17 · Unstable Dependency Chain Play

**When:** Avalanche/stability/debug-hook shows Memo/Callback/Effect churn, or the StabilityChain pattern appears.

```
observe churn → define lifecycle/identity invariant → trace dep boundary → find semantic dependency → maybe fix in order
```

1. Observe the bottom symptom first:
   - effect re-attaches / cleanup runs repeatedly
   - state dispatch follows effect
   - hook primitive is Effect/LayoutEffect or State/Reducer
2. Define the invariant from that observation: effect/callback should depend on semantic data, not incidental object/function identity.
3. Trace one step upstream:
   - effect depends on callback?
   - callback depends on object/array/function?
   - object created inline by parent?
4. Name the actual semantic dependency:
   - e.g. `opts.mode`, not `opts`; `id`, not `item`; `query`, not `params` object.
5. Decide whether the Effect should exist at all ([patterns-effects](patterns-effects.md#two-questions-before-touching-an-effect)): derived state and chains move to render or the event handler (EF-2, EF-3).
6. If it stays, follow the [dependency order](patterns-effects.md#fixing-effect-dependencies): hoist, move inside, depend on primitives, updater form, `useEffectEvent`, and only then `useMemo` / `useCallback` upstream. Never suppress `exhaustive-deps`.
7. Verify after each step with P-06 or P-12.

**Done when:** the invariant is restored and the same capture/nudge proves fewer waves or stable lifecycle.

---

### P-18 · Remount / Key / Tree Replacement Play

**Distinguishing legitimate remount from accidental:**
- legitimate: parent branch identity changed (route changed, key bound to a domain id that actually changed, conditional flip, modal opened)
- accidental: parent branch identity is stable but key or component type is not (literal `key={Math.random()}`, `key={Symbol()}`, inline component type re-created each render)
- look for these key forms specifically: `Math.random()`, `Symbol()`, `new <Class>()`, fresh object/array reference each render



**When:** Avalanche shows high mount work during interaction or a subtree loses state.

```
observe mount/reset signal → define persistence invariant → trace key/type/conditional boundary → apply only after boundary named
```

1. Observe mount/reset signal:
   - `componentMountWorkCount` high
   - repeated new fibers in commit window
   - local state resets or effects attach as mount
2. Define invariant from observation: the subtree should persist across this interaction.
3. Trace boundary:
   - probe/fiber parent chain
   - inspect keys on repeated list items
   - inspect conditional branches that replace component type
   - inspect route/layout wrapper changes
4. Classify:
   - unstable key
   - component type created inline
   - conditional tree replacement
   - legitimate mount (data/page actually changed)
5. Apply gate:
   - fix only after exact boundary and source line are named.

**Done when:** mount cause is confirmed or declared legitimate.

---

### P-19 · Store Selector Essence Play

**When:** a `SyncExternalStore` hook, a store library's subscription hook, or a store restart signal appears. Pattern card: [RW-7](patterns-render.md#rw-7-store-selector-returns-a-new-object).

```
observe consumed data → define subscription invariant → prove subscribed data → compare width → maybe narrow or stabilize selector
```

1. Observe consumed data:
   - `probe-dom` + source read: what fields are rendered?
   - `probe-props` / hook output: what values enter the component?
2. Define invariant from observation: consumer should subscribe only to data it renders or semantically needs.
3. Prove subscribed data:
   - `avalanche-debug-hook` target primitive `SyncExternalStore`
   - `parents` and `neighborhood` for the selector hook; value evidence from `commit-peek` `sources`
4. Compare width:
   - subscribed object wider than consumed fields → over-broad selector
   - selector returns new object/array equal by value → identity churn
   - store writes unrelated fields frequently → store mutation rate issue
5. Apply gate:
   - narrow selector, return primitives, memoize selector output, or split store only after consumed vs subscribed data is proven.
6. Verify with same capture/nudge: fewer store restarts/collateral, same visible output.

**Done when:** consumed fields and subscribed fields are both named.

---

### P-20 · Noise Reduction Maneuver (Play)

**When:** unrelated work hides the target signal and Chippy needs a narrower branch to measure.

```
observe target + unrelated branch → define target invariant → prune or shallow unrelated branch → repeat same measurement → read clearer signal → return to real fix
```

1. Observe both sides first:
   - name the **target branch** that must remain measurable
   - name the **unrelated branch** creating noise
   - prove the same capture currently mixes both signals
2. Define the invariant:
   - what target behavior must still be visible after the maneuver?
   - what measurement will be repeated unchanged?
3. Pick the smallest safe cut:
   - **prune** an unrelated sibling branch entirely
   - **shallow** rendering below a named component with an early return / placeholder
   - prefer Storybook or local fixtures over a living product page
4. If the user authorized diagnostic source mutation, build P-15 and pass P-16 before editing. Otherwise move the target to a cleaner harness. For an authorized temporary edit:
   - comment out branch
   - add early return
   - keep the target branch intact

   Concrete maneuver examples:
   - prune right-nav/sidebar so content branch can be measured alone
   - early-return `null` from a sibling panel that keeps re-rendering on the same interaction
   - shallow below a named component by returning a placeholder instead of the full subtree
   - move the target into Storybook/local harness first if the living app mixes too many unrelated branches
5. Re-run the **same** measurement:
   - same interaction or same stability-render nudge
   - same capture window and same comparison fields
6. Read the reduced tree:
   - target signal clearer or smaller
   - unrelated branch work materially reduced
7. Return to the real fix:
   - revert the maneuver or replace it with the actual source/boundary fix

The temporary cut and its reversion are both source changes. Keep the exact diff and reversion plan in the proof packet.

Outputs:
- target branch name
- pruned/shallowed branch name
- exact temporary edit location
- before/after signal comparison
- next real fix

**Anchor contract:**
- target branch must remain measurable in the same capture after the cut
- cuts can only **prune** or **shallow** siblings, cousins, or descendants of the target
- ancestors cannot be pruned in the same tree — they hold the target; removing them removes the target
- if the only available noise is in an ancestor, this is no longer a noise-reduction maneuver in the same tree; it is a **change of harness** (move the target into Storybook or a local fixture — see R-03A)
- same capture must show target and unrelated work mixed before doing the maneuver

**Done when:** the maneuver reveals a cleaner target signal without changing the target invariant.

---

### P-21 · Latency and Wait Investigation (Play)

**When:** the user waited: a click, Enter or toggle feels late by a fixed amount; a spinner or fallback stays up; data appears late; results flip to an older input. [Perf triage](perf-triage.md) Step 1 classified the complaint as waited.

```
capture → avalanche-timeline → avalanche-network → avalanche-perf → pattern card (→ P-23 when a candidate gate is unproven) → source confirms the mechanism → P-15 → P-16 → P-12
```

1. Capture the interaction (P-04 steps 1–3) or the load (P-05 steps 1–2). When the complaint is about opening something again or coming back to a view, record both actions in one capture: open, close and reopen, or view, leave and return. `repeatOf` links repeats only within one capture. When the complaint is the first open, the cold run is the subject: capture it after a fresh load (a reload needs the user's permission; use `reload-with-avalanche`), not after a warm-up.
2. `avalanche-timeline <clientId>` — read `perceived.waits[]`: `waitedMs`, `lockedBy`, `lastRequests`, `updatesDuring`. `waits[]` lists Suspense fallbacks only; with no fallback on screen it is empty, so read `perceived.idleGaps[]` (`from`, `until`, `ms`, `endedBy`) and `perceived.firstResponse`. An idle gap has no request in flight, no long frame, and no render; one that starts at the action points at a timer or debounce. For typing, the gap starts at the last keystroke. A spinner or skeleton driven by state is not a wait in `waits[]`: find the commits that inserted and removed it with `avalanche-dom-diff <clientId>` (narrow it with `match`), and report whether any pending indicator was visible. The dom-diff `t` counts from the first listed commit, not from the action; for the time after the action, look up those `commitId`s in `lanes.commits[]` of `avalanche-timeline <clientId> "" "" "" "" full`. The lane keeps every lock, unlock and swap commit but only the 25 update commits that rendered the most; when a commit is missing, take its `startTime` from `avalanche-commit-peek <clientId> <commitId> timing` and subtract the timeline's `origin.at`.
3. `avalanche-network <clientId> 30 start` — for each request in the wait: `startedAfter` (and its gap), `landedBefore`, `commitsInFlight`, `cached`, `initiatorType`. Look for a late start, a prompt start whose own duration covers the wait, a chain of sequential requests (`chainedAfter`, summary `longestChain`), a repeated URL (`repeatOf`, `mostRepeated`), an earlier request that lands later (`landedAfterNewer`), or `script` and `link` rows (code loading, not data). These links are timing: they name candidates, not causes.
4. `avalanche-perf <clientId>` — confirm the main thread was free during the wait. A large `inputDelay` or `processing` is work, not a wait: switch to P-04.
5. Match the evidence to a card in [patterns-latency](patterns-latency.md): LT-1 trailing debounce, LT-2 stacked debouncers, LT-3 apply vs persist, [LT-5](patterns-latency.md#lt-5-debounce-in-front-of-continuous-input) debounce in front of continuous input, NW-1 late start, NW-2 waterfall, NW-3 stale race, [NW-4](patterns-latency.md#nw-4-lazy-code-on-interaction) lazy code on interaction, [NW-5](patterns-latency.md#nw-5-refetch-of-data-already-shown) refetch of data already shown, [NW-6](patterns-latency.md#nw-6-non-critical-content-on-the-critical-path) non-critical content on the critical path, [NW-7](patterns-latency.md#nw-7-fallback-replaces-content-already-shown) fallback replaces content already shown, [NW-8](patterns-latency.md#nw-8-refetch-after-write) refetch after write, or [EF-4](patterns-effects.md#ef-4-fetch-in-effect-refetch-and-race) refetch. To prove that one request or chunk gates the view, run P-23.
6. Read source only to confirm the mechanism the timeline shows (the debounce options, the fetch site, the key). Name what the mechanism protects.
7. Build P-15, pass P-16 (keep the mechanism; change its edge or start point), verify with P-12. The proof is the gap or `waitedMs` across at least 3 interleaved samples, with request counts unchanged or announced.

**NEVER:** explain a wait with render counts, or remove a debounce, cache or batch to remove a delay its edge or start point can fix.

**Done when:** the wait is attributed to one mechanism with timeline and network evidence, or declared a real server cost. Declare a server cost only after the earlier-start option ([NW-1](patterns-latency.md#nw-1-late-start-fetch-on-mount)) and the cache option ([NW-5](patterns-latency.md#nw-5-refetch-of-data-already-shown)) are each rejected with a reason, and report the request's start offset from the action and its duration. Chippy records no per-request time to first byte, so it cannot split the duration into server time and transfer. Read TTFB or `Server-Timing` for that request in the browser's network panel when the split matters.

---

### P-22 · React Compiler Decision (Procedure)

**When:** the user asks whether React Compiler would fix a performance problem, a finding's cost is identity-driven, or the compiler is already on and the page is still slow.

```
triage line → identity-driven? → compiled? → A/B with 'use no memo' → decide
```

1. Start from a triage line ([perf-triage](perf-triage.md)). If the complaint is a wait, an Effect chain, a remount or a real input change, the compiler is not the answer ([react-compiler](react-compiler.md#it-is-irrelevant)).
2. Check the cost is identity-driven: collateral `propChanges[]` with `sameShallow: true` or functions rebuilt every render; triggers with `changedHooks[].sameContent: true` in `avalanche-summary`.
3. Check whether the components are compiled ([react-compiler](react-compiler.md#is-this-component-compiled)): a `MemoCache` entry in `describe-component`, or compiler-runtime imports in the built source. Partial answers: library hooks, context with real value changes, Effects.
4. When compiled and still wasteful, look for a bailout or a non-compiled dependency.
5. Measure with an A/B: compiled vs `'use no memo'` on the suspect component, interleaved, at least 3 samples per arm, `ab-compare` behavior `equivalent`.
6. Report the decision: adopt the compiler for the affected code, fix at the library boundary, or continue triage.

**Done when:** the compiler is shown to remove the measured waste, or the remaining cost is named as outside what it changes.

---

### P-23 · Critical-Path Test (Procedure)

**When:** P-21 named a request or code chunk as a candidate gate (`lastRequests`, `landedBefore`, `chainedAfter`), and timing alone cannot say whether the view waits for it. Typical cases: non-critical content suspected of holding the main view (NW-6), or one link of a waterfall (NW-2).

```
name the candidate → arm A unchanged → arm B with the candidate delayed or blocked → avalanche-timeline per arm → compare unlock and settle times
```

1. Name one candidate by URL and initiator from `avalanche-network`. Test one candidate per pair of arms.
2. Chippy cannot delay or block a request. The harness sets the condition, as for any [A/B condition](ab-testing.md): it routes that one URL with a fixed added delay (for example 2000 ms) in arm B, or fails it. Arm A runs unchanged. Everything else stays the same in both arms: page, data, viewport, stimulus.
3. Capture each sample with `ab-capture <clientId> <armDir> [label]`, interleaved a, b, a, b, at least 3 samples per arm. Before each sample, reset to the same starting state and clear the capture (`avalanche-clear <clientId>`, or `reload-with-avalanche` with the user's permission), as in the [A/B workflow](ab-testing.md#workflow).
4. Read `avalanche-offline <sample> timeline` for each sample. For the boundary in question, compare `perceived.waits[].until` and `waitedMs`, and which commit unlocked it (`unlockedBy`); then `perceived.settledAt` and `screen.vc90`. With no fallback, compare `perceived.idleGaps[]` and when the content appeared: take the `commitId` of its insertion from `avalanche-offline <sample> dom-diff`, then that commit's `t` in `lanes.commits[]` of `avalanche-offline <sample> timeline --format full` (when the lane leaves it out, use the `startTime` from `avalanche-offline <sample> commit-peek <commitId> timing` minus `origin.at`). The dom-diff `t` counts from the first listed commit, so it does not compare across samples.
5. Decide:
   - the unlock time or `settledAt` moves by about the added delay: the candidate is on the critical path;
   - it moves by clearly less than the added delay: the candidate gates the view only together with another request or chunk that overlaps it; name that one from `lastRequests` or `landedBefore` and test it in its own pair of arms;
   - nothing moves: the candidate is not on the path, so look for the gate elsewhere;
   - with a blocked request, the boundary stays in `perceived.stillWaiting` or an error boundary shows: the view depends on it, and the failure path is now visible too.
6. Return to P-21 step 5 with the result. `ab-compare` does not judge waits, so report the per-arm timeline numbers.

**Done when:** each tested candidate is shown to move the unlock or settle time, or shown not to.

---
