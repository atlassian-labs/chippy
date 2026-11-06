# Chippy BDD Router — Situation Matrix & Iteration Cycles

The router maps an observed Chippy situation to one capability, procedure, command chain, and verification signal.

Canonical contracts:
- Phase model, proof packet, and apply gate: [operating-model](operating-model.md)
- Domain positioning and OODA evidence iteration: [cynefin](cynefin.md)
- P-01..P-20 procedure steps: [procedures](procedures.md)
- Command contract: main [SKILL.md](../SKILL.md#command-surface)

## Domain tags by router section

The router picks the procedure once the domain is named. Each section below operates predominantly in one Cynefin domain. Within the selected procedure, use OODA to choose the next bounded evidence move. If evidence no longer fits the section's domain, reposition before routing again.

| Section | Predominant domain | Sensor or experiment? |
|---|---|---|
| 3.1 Identification & Tracing | 🔍 Complicated | Sensors (probes, find-fibers, source read). Move to 🌀 only when forwarding chain breaks. |
| 3.2 Performance — Runtime | 🌀 Complex | Safe-to-fail experiments (avalanche-arm, stability-nudge). `confirmed` rare; `likely`/`partial` is normal. |
| 3.3 Performance — Load | 🌀 Complex | Experiment (reload-with-avalanche). Load capture is a perturbation; cause is read from emergent wave. |
| 3.4 Context & Store | 🔍 Complicated → 🌀 Complex | Sensors locate provider; stability-render is the experiment when identity is suspected. |
| 3.5 Automated / Browser Harness | 🔍 Complicated | Sensors over Playwright. Failures here are often 🔥 (injection order, helper down) — stabilize first. |
| 3.6 Production and Jira Pages | 🔍 Complicated | Sensors against minified source. Owner-chain analysis with taxonomy filter. |
| 3.7 Tool Boundaries & Gaps | 🔥 Chaotic → ❓ Disorder | Runtime is broken or capability is missing. Stabilize or report; do not analyze. |

Read the GIVEN column first. Pick the row that best matches the situation. Follow THEN exactly.

## Table of contents

- [Router](#router)
  - [Identification & Tracing](#31-identification--tracing)
  - [Performance — Runtime](#32-performance--runtime)
  - [Performance — Load](#33-performance--load)
  - [Context & Store](#34-context--store)
  - [Automated / Browser Harness](#35-automated--browser-harness)
  - [Production and Jira Pages](#36-production-and-jira-pages)
  - [Tool Boundaries & Gaps](#37-tool-boundaries--gaps)
- [Iteration Patterns & Cycles](#iteration-patterns--cycles)

## Router


**Format:** `GIVEN <situation> WHEN <intent> THEN <procedure> + <commands> + <verification>`

Read the GIVEN column first. Pick the row that best matches the situation. Follow THEN exactly.

---

### 3.1 Identification & Tracing

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-01 | User points at visible text/element | "What is this?" / "Where does X come from?" | P-14 → P-01 → P-02 → P-15 | `probe-dom` → `probe-owners` → `probe-prop-value` → open file | Proof packet: component + file + line + value source |
| R-02 | Probe resolved, component has `hookCount > 50` | "What is this component doing?" | P-14 → P-01 → P-03 → P-15 | replay preflight → `explain-component` → `describe-component` → `inspect-fiber-structure` | Essence of component stated before cause/fix |
| R-03 | No probe placed, component name known | "Find X in the live tree" | P-14 → P-10 → P-15 | `find-fibers --name X` → replay preflight → `describe-component` → open file | fiberId resolved, file:line confirmed |
| R-03A | Same feature exists in Storybook/local fixture and living app | "Where should Chippy investigate first?" | P-14 → P-13/P-20 → P-15 | prefer direct story or local harness before living app | Better-named tree chosen first; same branch signal easier to isolate |
| R-04 | Probe placed, style mismatch | "Why does this look wrong?" | P-14 → P-02 then `get-computed-style` → P-15 | `probe-dom` → `get-computed-style` → matchedStyles | Style rule source identified; renderer vs data source separated |
| R-05 | No connected page | Any probe/fiber task | Define runtime gap, then branch on helper health | `health`; unavailable → install Chippy if absent, then agent starts/verifies helper; healthy + `pages` empty → follow the integration's reconnect/reload action | `health` succeeds and page appears in `chippy.sh pages` |
| R-06 | Production page (minified) | Trace source | P-14 → P-11 → P-15 | `probe-owners`, `nearestTestId`, `componentStack` (plus `jira-taxonomy` on Jira pages) | Parent chain walked (`ownerStackKind: "parents"`); source named with caveat |
| R-07 | Two pages match target | Any | Ask user which page | `pages` output shown, user picks by URL/title | clientId confirmed by user |
| R-08 | User asks "why" but target/invariant unclear | Deep grasp first | P-14 only | Ask/derive anchor + invariant; no specialized tool until case defined | Case definition exists |
| R-09 | Evidence identifies only a forwarding wrapper | Continue proof, do not conclude | P-02 → P-15 | `probe-owners` deeper → `probe-prop-value` at next owner → open caller | Creator named, not just forwarder |
| R-09A | User asks for fix while trace is partial | Separate Apply from Prove | P-15 → P-16 gate fails → continue proof | Next missing evidence command selected | No edit until proof packet is confirmed |

---

### 3.2 Performance — Runtime

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-10 | Open page, user reports lag on interaction | "Why is clicking X slow?" | P-14 → P-04 → P-15 | `avalanche-arm` → interact → `avalanche-status` → `hot-sources` → `commit-list` → `commit-peek` | Proof packet: trigger + role + file:line |
| R-11 | Open page, jank during scroll/animation | "Why is scrolling janky?" | P-14 → P-04 → P-15 | Same as R-10 | Hot source identified; blast radius measured; cause not inferred from hotspot alone |
| R-11A | Page reports layout shift, long frames, or slow INP | "What moved the layout?" / "Why is this frame long?" | P-14 → P-04 → P-15 | `avalanche-arm` → interact → `eval-page perf-entries` → `commit-peek <commits.before or during> stats,sources,rendered` | Entry named with its component and nearest commit; that commit's source proven separately, not inferred from timing |
| R-12 | Capture has >100 commits | Analyse without losing context | P-09 → P-15 | `avalanche-save` → `avalanche-offline` → subagent per wave | Crime scene rebuilt: setup → wave → noise |
| R-13 | Suspected unstable memo or context | "Does this re-render when it shouldn't?" | P-14 → P-06 → P-15 | `avalanche-recapture full` → schedule one target render → settle → status → commit-list → commit-peek `stats,sources,rendered` → classify | `commitCount`, `collateral`, `trasherCounts`, verdict, render invariant |
| R-14 | Stability-render shows leak, hook role unclear | "Which hook causes this?" | P-07 → P-15 | `avalanche-recapture` → reproduce trigger → `avalanche-debug-hook` | `primitive` confirmed; remediation branch chosen |
| R-15 | Context updates high in commit list | "Why is context re-rendering everything?" | P-14 → P-08 → P-15 | `commit-list contextUpdates` → `commit-peek` → provider sample → unique `find-fibers` match → direct schedule-update | Provider value identity confirmed stable/unstable |
| R-15A | Unmounts appear during interaction | "What branch is being torn down?" | P-14 → P-18 → P-15 | `commit-list unmountedSubtrees` → `commit-peek stats,sources,atl` → owner/key/type trace | Branch start named; legitimate teardown vs accidental remount separated; Chippy states where unmount starts |
| R-15B | Suspense boundary likely entered or left fallback | "Did Suspense cause this wave?" | P-14 → P-04 → P-15 | `commit-peek stats,sources,metrics` → `avalanche-save` and read `suspenseByCommit[N]` (`commit-peek` has no Suspense slice) + source trace below boundary | Boundary transition named as enter/leave; Chippy says whether to look at boundary or below it; placeholder separated from business source |
| R-15C | One sibling/cousin/descendant branch is noisy enough to hide target signal in the same tree | "Can we isolate this branch in place?" | P-14 → P-15 → P-16 → P-20 → P-12 | prove mixed branches → authorize temporary prune/shallow edit → same capture → revert plan | Same target signal becomes smaller/clearer without unrelated branch work; ancestors untouched; maneuver declared temporary |
| R-15D | Only available noise is in an ancestor (cannot be pruned in place) | "Can we move the target to a cleaner harness?" | P-14 → R-03A → P-13 → P-12 | move target into Storybook/local fixture; re-measure same signal there | Target rendered without ancestor noise; same measurement repeated in new harness |
| R-16 | After fix applied | "Did the fix work?" | P-12 | Same capture as before fix; compare `collateral`, `commitCount`, hot-source rank | Same signals reduced; no new signals added |
| R-17 | User asks "optimize this" but trigger is unknown | Observe before defining optimization target | P-14 → choose P-04/P-05/P-06 | Anchor the target in visible element / interaction / load window first | Measurement route chosen from observed anchor + case definition |
| R-18 | Avalanche shows hot component but no source proof (not yet known if self-updater) | Avoid hotspot fallacy | P-04 → P-02/P-10 → P-15 | `avalanche-recapture full` → repeat identical interaction → `commit-list` → `commit-peek stats,sources,rendered` → check `isSelfSource` + `propChanges` → owners/source | Hotspot classified as self-source / amplifier-driven / cascade collateral per `renderedByCommit` table |
| R-18A | Avalanche source has `isSelfSource: true` in `renderedByCommit` (confirmed self-updater) | "Why does this component re-render itself?" | P-04 full-mode branch → P-07 → P-15 | confirm full-mode capture → `commit-peek rendered` → confirm `isSelfSource` → `avalanche-debug-hook <sourceId> <hookIndex>` | Self-source confirmed; trigger hook + primitive named |
| R-19 | Effect/callback/memo churn appears (suspected, not yet quantified) | Trace dependency chain | P-17 → P-15 | `avalanche-debug-hook` or hook structure → source dep arrays | Semantic dependency named before fix |
| R-19C | `commit-peek include=rendered` shows non-zero `trasherCounts` on a component | "Which hook is the amplifier?" | P-06 → P-07 → P-15 | `commit-peek include=rendered` → identify `trasherCounts.{effects,callbacks,memos}` → `avalanche-debug-hook` on that hook | Trasher verdict supported by `trasherCounts > 0` across ≥2 commits; offending hook + primitive named |
| R-19D | `propChanges` shows `ref-changed` callback or object prop on a re-rendered child | "Who passed the unstable identity?" | P-04 full-mode branch → re-resolve child → walk current owners → P-06 on parent | `avalanche-recapture full` → repeat interaction → `commit-peek rendered` → read `ref-changed` prop → re-resolve child → owners → same-anchor parent nudge | Parent identity churn confirmed; amplifier hook in parent named |
| R-19A | Mount work high during interaction | Prove remount essence | P-18 → P-15 | `commit-peek stats,sources,atl` → owner/key/type trace | Unstable key/type/conditional boundary named or mount declared legitimate |
| R-19B | User asks to apply perf fix after proof | Fix as separate capability | P-16 → P-12 | Apply gate → edit → same capture | Edit allowed only after proof packet + verification plan |

---

### 3.3 Performance — Load

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-20 | Page is slow to first paint | "Why is initial load slow?" | P-14 → P-05 → P-15 | `reload-with-avalanche` → `avalanche-status` → `hot-sources` → `commit-list` → `commit-peek` | Load invariant + integration mode + top sources ranked |
| R-20A | LCP or CLS is poor on load | "Why is LCP late?" / "What shifts during load?" | P-14 → P-05 → P-15 | `reload-with-avalanche` → `eval-page perf-entries` → `commit-peek` on the commits before the LCP entry and each shift | LCP element and shift sources named with components; commits before them read for sources |
| R-21 | Load capture has low commit count | "Did capture miss early commits?" | Prove capture quality before cause | `reload-with-avalanche` with higher `settleMs` (5000+) | commitCount increases or gap is reported as capture limitation |
| R-22 | After load perf fix | "Did the fix improve load?" | P-05 again + P-12 | Re-run `reload-with-avalanche`, compare hot-sources | Same sources lower rank or absent |
| R-23 | Load wave looks large | Decide necessary vs avoidable work | P-05 → before/during/after read → P-15 | `commit-peek` on N-2/N-1/N/N+1 | Setup/main/noise roles separated |
| R-24 | Initial load includes Suspense/lazy boundaries | Avoid blaming transport | P-11 + P-05 → P-15 | `commit-peek` + taxonomy/source trace below placeholder | Business source separated from placeholder/wrapper |
| R-25 | User asks to fix load before cause known | Apply gate blocks edit | P-15 → P-16 fails | Choose next proof command | No edit until source/boundary role proven |

---

### 3.4 Context & Store

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-30 | Too many re-renders, context suspected | "Find what context is thrashing" | P-14 → P-08 → P-15 | `find-context-providers` → `count-context-consumers` → resolve provider with `find-fibers` → `fiber-schedule-update` | Provider identity and consumer blast radius measured |
| R-31 | Legacy context suspected | "Are there legacy context users?" | P-14 → eval-page snippet → P-15 | `eval-page find-legacy-context` | Producer/consumer pairs listed |
| R-32 | `debug-hook` returns `Context` primitive | Investigate provider side | P-08 + stability-render → P-15 | provider sample → unique `find-fibers` match → `fiber-schedule-update` → classify | Provider value stable/unstable confirmed |
| R-33 | SyncExternalStore hook, over-broad selector | Prove subscription width first | P-19 → P-15 → maybe P-16 | `avalanche-debug-hook` (`primitive`, `parents`, `neighborhood`) → source selector read → consumed/subscribed comparison | Consumed fields and subscribed fields both named |
| R-34 | Selector returns object/array each render | Prove identity churn | P-19 | `debug-hook` `primitive`/`parents` + source selector read; identity evidence from `commit-peek` or stability-render | Equal-data/new-identity condition proven |
| R-35 | Store updates frequently but consumer reads one field | Prove broad store mutation | P-19 → P-15 | compare value changes from commit evidence (`commit-peek` `stats,sources,rendered`) to rendered fields | Store mutation rate vs consumer need separated |
| R-36 | Context provider value is inline object/function | Prove value identity, not just source shape | P-08 → P-06 → source read | unique provider fiber → direct schedule-update → open provider file | Runtime wave + source inline value both present |
| R-37 | User asks to split context/store immediately | Apply gate | P-15 → P-16 | proof packet must name provider/store, consumers, consumed fields | Split/narrow only after blast radius proven |

---

### 3.5 Automated / Browser Harness

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-40 | Running against a page without the extension | Automated Chippy loop | P-13 | shim before navigation → packaged init loader or ad-hoc runtime load → `pages` → `avalanche-install` → `avalanche-clear` → interact → read | Client appears in `pages`; detector reports installed; structured output returned |
| R-41 | Bridge commands return `bridge module not loaded` | Inject missing bundle | Check injection order | Inject `avalanche.iife.js` AFTER `inject.js` | Bridge commands return real data, not fallback |
| R-42 | devtools-hook shim not installed before nav | React hook state missing | Fix install order | `addInitScript` BEFORE `page.goto` | `replayComponentHooks` returns hook data, not fiber-only fallback |
| R-43 | Need repeatable regression check | CI/pre-merge verification | P-06 (stability-render) + P-13 | Same `--testId` + same React tree → same nudge → compare output | commitCount and collateral match expected baseline |
| R-44 | Automation reads once and fails intermittently | Race condition | Poll instead of single read | Poll at 100–250ms intervals; budget 5–15s per state type | State stable for 2+ consecutive reads before proceeding |

---

### 3.6 Production and Jira Pages

| ID | GIVEN | WHEN | THEN: Procedure | THEN: Key Commands | THEN: Verified By |
|---|---|---|---|---|---|
| R-50 | Jira page, avalanche source is `Connect(X)` | Classify ownership | Apply jira-taxonomy | Promote `X` or nearest Jira-owned child; filter Connect wrapper | Business component named as source, not wrapper |
| R-51 | `ComponentWithCondition[]` in source list | Classify | Apply jira-taxonomy | Treat as path metadata; promote nearest self-updater with `whatChanged` | Real source named; gate treated as branch metadata |
| R-52 | `SuspensePlaceholder` is largest hot source | Classify | Apply jira-taxonomy | Inspect nearest Jira-owned child/self-updater below | Actual update origin named below placeholder |
| R-53 | `Container(X)` in source list | Classify | Apply jira-taxonomy | Keep as candidate (SweetState boundary); inspect for concrete field changes | Real data boundary confirmed or ruled out |

---

### 3.7 Tool Boundaries & Gaps

| ID | GIVEN | WHEN | THEN |
|---|---|---|---|
| R-60 | Requested operation not in command surface | Any | Report capability gap. Do not invent. Do not grep Chippy source. |
| R-61 | Global present (`window.__avalanche`) but not in contract | Validate integration | Read `avalanche-status`; confirm `integrationMode`. Presence ≠ integration. |
| R-62 | `debug-hook` returns `hook event not found` with `eventCount: 0` | Record a render | `avalanche-recapture <clientId>` → reproduce trigger → re-read `sourceId` and `hookIndex` → re-run `debug-hook` |
| R-63 | `debug-hook` `primitive` is Context/DebugValue/MemoCache | Re-pick hookIndex | Switch to provider-side analysis; context has no indexable memoizedState slot |
| R-64 | Capture `commitCount: 0` with detector installed | Verify integration mode | Check `hasMetricsGlobal`, `integrationMode`, `metricsAdapter`; reload page if needed |
| R-65 | Duplicate `__AVALANCHE__ already defined` | Fix startup order | Injected twice. Fix order before trusting output. |
| R-66 | Subagent needed for large data | Delegate | State **one concrete pre-stated question**. No raw exports. No "analyze this" prompts. |

---

## Iteration Patterns & Cycles

### Cycle A — Observe/Position → Define → Prove with OODA → Maybe Apply (Core Loop)

```
[Observe / Position] read-only orientation → anchor first signal → name Cynefin domain
    ↓
[Define] case + invariant + scope from the first signal
    ↓
[OODA Observe] read the smallest current signal
    ↓
[OODA Orient] compare domain + invariant + evidence + next gap
    ↓
[OODA Decide] choose one permitted sensor / experiment / stabilizer
    ↓
[OODA Act] execute that evidence move — this is not source Apply
    ↓
[Evidence] classify source / forwarder / boundary / collateral / provider / store / mount / unknown
    ↓
[Enough?] no → OODA Observe | domain changed → Position | yes → Proof packet
    ↓
[Proof packet] confidence + next gap
    ↓
[Apply gate] user intent + fix layer + verification command
    ↓
[Maybe edit] source code only if gate passes
    ↓
[Verify] same measurement, compare signals
    ↓
[Stable?] yes → done | no → back to [Define or Proof plan]
```

Fixing is optional and late. The loop can end after **Proof packet** when the user asked for understanding only. OODA Act never bypasses the Apply gate. If evidence changes the apparent case, redefine it; if it changes the cause/effect posture, reposition before proving deeper.

---

### Cycle B — Performance Triage Ladder

```
1. User reports slow [interaction | load]
2. Capture (arm for runtime, reload-with-avalanche for load)
3. hot-sources → quick triage (shape + scale)
4. commit-list → pick suspicious commit
5. commit-peek → join evidence (stats + sources + atl)
6. Probe/fiber → why this component? (owners, props, hooks)
7. Code → implementation cause (deps, selector, provider value, keys)
8. If user intent permits and P-15/P-16 pass, edit source
9. Repeat capture → same window, same signals, compare
```

Rules:
- Never jump from step 3 to step 7.
- Never call a cause "confirmed" without step 6 + 7 evidence.
- Never mark hotspot as trigger without causal chain.

---

### Cycle C — Stability Verification Loop

```
1. Recapture avalanche in full mode
2. Schedule one target render (`stability-nudge` or direct fiber command)
3. Settle 1s
4. Read (status + commit-list + commit-peek `stats,sources,rendered` for every commit + hot-sources)
5. Classify (clean / leak / leak+cascade / trasher)
6. If dirty: locate offender (commit-list → debug-hook)
7. If the user requested a change and the Apply gate passes, fix the proven layer
8. Go to 1 — same target and scheduling command, compare
```

Use this loop as a regression check after any performance edit. Keep the same `--testId` and `--ownerIndex`; compare `commitCount`, `commit-peek` `renderedTotal`, and `stats.collateral`.

---

### Cycle D — Read Hierarchy (Avalanche Signal Order)

```
Population metrics → shape and scale
Commit stats → shape of one commit
Commit details → sources / providers / restarts
Fiber / probe → why specific component participated
Code → implementation cause
Before/after diff → fix confirmed
```

Never skip levels. Never claim single-component causality from population metrics alone.

---

### Cycle E — Large Capture Analysis

```
1. Save export once
2. Build global timeline (summary + commit-list by multiple sort keys)
3. Identify waves by question, not by equal commit count
4. Reduce each wave to commit-peek slices
5. Delegate one concrete question per subagent
6. Collect compact findings
7. Join: setup → main wave → noise
8. Ask: do multiple slices share one upstream root cause?
9. If yes: one upstream fix > many local patches
```

---

## Part 5 — Verification Checklist

Before marking any Chippy task complete:

### Tracing task
- [ ] Observation anchor recorded (probe/fiber/testId/text/page state)
- [ ] Case defined from observed anchor
- [ ] Component named (not "a wrapper")
- [ ] File named (`source.fileName`)
- [ ] Line named (`lineNumber`) or render block
- [ ] Prop forwarding hops named (or "none")
- [ ] Confidence level stated: `confirmed | likely | partial`
- [ ] Next gap stated ("none" if done)

### Performance task
- [ ] First observation recorded (interaction/load/subtree + initial signal)
- [ ] Case and invariant defined from observation
- [ ] Trigger identified (interaction or load)
- [ ] Source classified (source / hotspot / collateral / mount / context / store)
- [ ] Causal chain stated: source → why → propagation → blast radius
- [ ] Fix layer decided: above source | boundary | below source
- [ ] Before/after measurement compared (same signals, same window)
- [ ] Hot source rank changed (or explained why not)

### Stability-render task
- [ ] Target observed first (probe/testId/fiber exists in current runtime)
- [ ] Stability invariant defined from target observation
- [ ] Nudge target confirmed (testId or probeId)
- [ ] Verdict stated: clean / leak / leak+cascade / trasher
- [ ] Render factor stated (`commits / 1`)
- [ ] Offender named if dirty (component + file + line)
- [ ] Re-run after fix compared

### Debug-hook task
- [ ] `primitive` read first
- [ ] Remediation branch chosen from table (not guessed)
- [ ] `resolvedComponentName` matches `componentName`; otherwise treat the result as ambiguous
- [ ] If ambiguous or the primitive is Context/DebugValue/MemoCache: re-pick hookIndex or switch to provider analysis

### Automated task
- [ ] Bundle injection order verified (devtools-hook shim before nav)
- [ ] `avalanche.iife.js` injected if bridge commands used
- [ ] Connection confirmed via `chippy.sh pages` (not `__chippyPageBridge`)
- [ ] Polling used (not single read)
- [ ] Structured output compared (not just screenshot)

---

*End of Chippy BDD Router reference.*
