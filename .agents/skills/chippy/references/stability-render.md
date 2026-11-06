# Stability render — controlled re-render probe

A scoped, repeatable performance probe. The user does not interact. Chippy nudges a single fiber, watches what shakes loose in avalanche, and grades the subtree against a clean re-render baseline.

Lifecycle stage: **experiment and verification**. Enter when there is a target subtree/source to test, or after a fix from real-capture analysis needs a deterministic regression check.

Exit with one of: clean, leak, leak+cascade, or trasher when the required signature matches. If none matches, report a bounded result and return to real interaction capture instead of forcing a verdict. Clean → done or use as baseline. Leak → return to [fixing-performance](fixing-performance.md) for boundary/source/prune choice. Changed hook index on the same source → use [debug-hook](debug-hook.md). Different source/trasher → return to real capture or commit analysis; do not keep nudging the wrong target.

> **Routing lives in [SKILL.md](../SKILL.md#route-by-question).** Use the controlled-nudge procedure for a settled component; start with a real Avalanche capture when the question is which interaction or load is slow.

---

## Execution model — how the nudge actually happens

Stability-render is **not a Playwright test, not a CI harness, and not a separate process.** It is one Chippy command (`chippy.sh eval-page`) that ships a JavaScript snippet over the existing helper-server WebSocket into a connected page. The extension, module import, and Storybook addon all provide that connection. The snippet runs *inside the page*, in the same JavaScript realm as React itself, and reaches the target fiber through the same React internals the rest of Chippy uses.

```
┌──────────────┐    chippy.sh eval-page <client> stability-nudge
│ agent shell  │───────────────────────────────────────────────┐
└──────────────┘                                                │
                                                                ▼
                                              ┌──────────────────────────┐
                                              │ chippy helper (HTTP+WS)  │
                                              └──────────────┬───────────┘
                                                             │ WS message
                                                             ▼
                                              ┌──────────────────────────┐
                                              │ Chippy page integration  │
                                              │ extension/import/addon   │
                                              └──────────────┬───────────┘
                                                             │ runs snippet body
                                                             ▼
                                              ┌──────────────────────────┐
                                              │ stability-nudge.js       │
                                              │   resolve target → fiber │
                                              │   call scheduleUpdate(fiber)  │
                                              └──────────────┬───────────┘
                                                             │ React schedules render
                                                             ▼
                                              ┌──────────────────────────┐
                                              │ avalanche detector       │
                                              │ records commit + sources │
                                              └──────────────┬───────────┘
                                                             │ status / commit-list / commit-peek / hot-sources
                                                             ▼
                                                       agent reads
```

What this means in practice:

- **Any page connected through the extension, module import, or Storybook addon is a valid target.** The helper connection is the prerequisite, not a particular automation tool.
- **No Playwright action is required.** The snippet itself is the stimulus.
- **Reproducibility comes from the snippet, not the runner.** Same `--testId` + same React tree → same commit shape, every time. That is why the procedure is reliable for verification.
- **The snippet is a normal Chippy snippet.** It lives at `./snippets/stability-nudge.js` and obeys the standard `eval-page` `ctx` contract (`ctx.args`, `ctx.log`). Nothing about it is special-cased in the helper.
- **Playwright is optional, not required.** If Playwright is driving the page, it can navigate before the agent runs the procedure. Once the page is connected, Playwright is no longer in the loop. The nudge itself never goes through Playwright.

---

## Concepts

| Term | Meaning |
|---|---|
| **Nudge** | One render scheduled on a current composite fiber through the React DevTools renderer. The minimal stimulus. |
| **Wave** | Commits scheduled by one nudge, including async follow-ups inside the settle window. |
| **Render factor** | `commits / 1`. Ideal is `~1` for a clean parent flip. `>1` means children are scheduling extra work. |
| **Blast radius** | Number of distinct components that committed because of the nudge. |
| **Trasher** | A component with non-zero effect/callback/memo `trasherCounts` in at least two commits from the same nudge. |

A clean subtree under a parent nudge: 1 commit, 0 collateral outside the expected path, 0 context waves, 0 restarts, render factor `~1`.

---

## Procedure

```
verify runtime
→ pick target fiber (parent OR branch root)
→ recapture avalanche in full mode
→ nudge the fiber
→ settle 1000 ms
→ read status + every commit via commit-list / commit-peek + hot-sources
→ classify: clean / leak / leak+cascade / trasher
→ (if dirty) walk the bounded commit detail top → bottom
→ build proof packet at highest stable boundary
→ if authorized, pass Apply gate and edit
→ re-run the same procedure to verify
```

### Step 1 — verify runtime

`health` → `pages` → `request-snapshot <clientId>`. Standard Phase 1 from SKILL.md. Never reuse a stale `clientId`.

### Step 2 — pick the target

Two cases drive different targets:

**Case A — parent update (memoization audit)**
- Target = the parent component the user named (or the P3 of two probes).
- Hypothesis: "this parent re-rendering should not move anything visible below the next memo boundary."
- Bad outcome: avalanche shows children re-rendering. Top → bottom, find the first child that lacks `React.memo` or whose memo is defeated by an unstable prop.

**Case B — branch update (trasher audit)**
- Target = a branch root that the user expects to re-render exactly once on each input change.
- Hypothesis: "every component in this branch renders exactly once per nudge (render factor ~1)."
- Bad outcome: the same component records non-zero `trasherCounts` in at least two commits. Inspect the recorded hook/dependency samples to find the persistent amplifier.

### Step 3 — start a clean full-mode capture

```bash
./scripts/chippy.sh avalanche-recapture <clientId> full
```

No reload. `avalanche-recapture ... full` installs a fresh detector and clears history so the nudge is the only thing in the window. Full mode is required for the `trasherCounts` signatures used below; `commit-peek` `rendered` entries are recorded in every mode.

### Step 4 — nudge the fiber

```bash
./scripts/chippy.sh eval-page <clientId> stability-nudge --testId <data-testid> [--ownerIndex N] [--label <text>] [--dryRun true]
# Example: nudge the parent of the test-id target
./scripts/chippy.sh eval-page <clientId> stability-nudge --testId stability-chain --ownerIndex 1 --label parent-nudge
```

`--ownerIndex` defaults to `0` (the target itself); `--label` is echoed into `ctx.log`; `--dryRun true` resolves the target without scheduling.

Target selection:
- `--testId <data-testid>` — fully automated. DOM → fiber via the React fiber key. Use this for fixtures and any component that already exposes a `data-testid`.
- `--probeId <id>` — targets the nearest component of a placed probe (`1`, `2`, or `3`), using the same probe resolution as `probe-props` and `probe-hooks`. Returns `reason: probe-not-placed: <id>` when that probe is not placed.

The snippet returns `{ ok, fiberName, source, ownerIndex }`. If `ok: false`, read `reason` — on a dev build the common cause is the devtools-hook shim missing at page boot (`no-scheduleUpdate`). To nudge a parent instead of the target, use `--ownerIndex 1`. See **Update mechanism** below.

If a current `fiberId` has already been established with `find-fibers`, use the capability directly instead:

```bash
./scripts/chippy.sh fiber-schedule-update <clientId> <fiberId>
```

Re-resolve the fiber after any intervening commit, HMR, navigation, or reload.

### Step 5 — settle

```bash
sleep 1
```

One second covers the nudge commit plus any synchronous follow-up commits scheduled during render. Heavier subtrees (large lists, Suspense) warrant `2` seconds; do not exceed `3` — beyond that you are catching unrelated work.

### Step 6 — read

```bash
./scripts/chippy.sh avalanche-status <clientId>
./scripts/chippy.sh avalanche-commit-list <clientId> 20 collateral
# Repeat for every commitId returned in this fresh nudge window:
./scripts/chippy.sh avalanche-commit-peek <clientId> <commitId> stats,sources,rendered 3 50
./scripts/chippy.sh avalanche-hot-sources <clientId> 12
```

Read in this order:
1. `avalanche-status.commitCount` — how many waves occurred; count alone is not a verdict.
2. `avalanche-commit-list` — the complete set of commit IDs in this fresh bounded window.
3. Each `commit-peek.stats` — `collateral`, `sources`, and `restarts`.
4. Each `commit-peek.sources` — whether the nudged or another source repeats.
5. Each `commit-peek.rendered` — exact target/collateral entries (`renderedTotal` is the full count), `propChanges`, and every `trasherCounts` field.
6. `hot-sources` — ranking corroboration after the per-commit verdict evidence is present.

### Step 7 — classify

| Verdict | `commitCount` | `commit-peek.sources` pattern | `commit-peek.rendered` pattern |
|---|---|---|---|
| **clean** | 1 | nudged sourceId only (or empty) | nudged target only; every `trasherCounts` field is zero |
| **leak** | 1 | nudged sourceId only | high collateral count under target; `propChanges` empty on collateral entries |
| **leak+cascade** | >1 | same sourceId repeats across commits | `isSelfSource: true` on that source; `propChanges` empty |
| **trasher** | ≥2 | the same component source persists across commits | non-zero `trasherCounts` on that component in at least two commits |

Apply the rows as mutually exclusive classifications: persistent non-zero `trasherCounts` takes precedence. A different source or a high render count without that field is not enough for `trasher`; if no row matches, report the unmatched signature and return to real interaction capture.

### Step 8 — locate the offender

For **leak** (Case A):
- `avalanche-commit-list <clientId> 20 collateral`.
- Walk the top commit's `commit-peek <commitId> rendered` entries with `isSelfSource: false` top → bottom from the nudged fiber.
- The first collateral with stable inputs but no `React.memo` is the boundary fix. The first collateral with `React.memo` but unstable props (inline object, fresh callback, new JSX) is a boundary that needs prop stabilization above it.

> **Attribute the leak.** When the offending fiber is identified but its hook role is unclear, run [debug-hook](./debug-hook.md) on **the same nudged source** with the changed `hookIndex` from this commit. Do not switch sources. The primitive + `parents` chain pins down whether the cause is selector identity, dispatcher churn, or unstable deps.

For **trasher** (Case B):
- `avalanche-commit-list <clientId> 20 sources`.
- For each candidate commit, run `avalanche-commit-peek <clientId> <commitId> stats,sources,rendered` and find the same component with non-zero `trasherCounts` in at least two commits.
- Read its bounded `trashers[]` samples for `hookIndex`, `hookType`, and changed dependency indices, then use `avalanche-debug-hook` on that source and hook index.

### Before Apply in a Complex case

When the proof packet uses `confidence: likely` in the Complex domain, clear the capture and repeat the identical nudge, target, label, settle window, and read commands before any edit. The same verdict and causal signature must recur; the post-edit run is verification, not the repeatability evidence that authorizes Apply.

### Step 9 — verify the fix

Re-enter at Step 1 and re-resolve the current page and target before Step 3. A reload can clear probes, and any commit/HMR/reload can replace the current fiber:

- test-id target: resolve the same test-id again in the current page;
- probe target: confirm the probe still resolves or re-place it on the same DOM target;
- direct fiber target: run `find-fibers` again and use the new current token;
- prior `sourceId + hookIndex`: obtain them again from the fresh post-edit capture rather than carrying capture coordinates forward.

Then re-run from Step 3 with the same semantic target, `--ownerIndex`, and `--label`. Compare:
- `commitCount` should drop toward 1.
- `commit-peek.renderedTotal` should drop.
- `commit-peek.stats.collateral` should drop.
- The previously top hot-source should disappear or fall in rank.

If the numbers do not move, the fix was at the wrong layer. Re-classify before editing again.

---

## Update mechanism — `scheduleUpdate`

The snippet uses one mechanism: the React DevTools renderer's **`scheduleUpdate(fiber)`**. This is the exact internal React DevTools itself calls to force a component to re-render (the same path behind "force re-render" and hook-value editing in the DevTools panel).

### Capability vs procedure

The mechanism is a **bundle capability**, not snippet logic. It ships in `avalanche.iife.js` (source `src/chippy-bridge/fiber-schedule-update.ts`) and is exposed two ways:

- **Bridge command** — `fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]`. Use this directly when you already have a `fiberId` from `find-fibers` and just want one re-render. Returns `{ ok, scheduled, fiberName, source, ownerIndex }`.
- **`stability-nudge` snippet** — the **procedure** layer. It resolves a `--probeId` or `--testId` to a fiber (DOM context the bridge does not have), climbs `--ownerIndex`, then delegates the re-render to the same capability.

The split keeps version-coupled React internals in one bundled capability while the snippet owns probe/test-id resolution and procedure composition.

It is reached via the registered renderer:

```
__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.get(id).scheduleUpdate(fiber)
```

Internally (`react-dom` dev build) it is simply:

```js
scheduleUpdate = function (fiber) {
  var root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  if (root !== null) scheduleUpdateOnFiber(root, fiber, SyncLane, NoTimestamp);
};
```

Why this is the only strategy:

- **Universal.** Works on any composite fiber — function components (including **hookless** ones), `memo`, `forwardRef`, and class components alike. No `useState`/`useReducer` required.
- **Zero pollution.** It marks a lane and schedules; it does **not** mutate any hook value or prop. There is no "nudge anchor" to keep clean, no opaque slot left behind.
- **React-sanctioned.** It is the mechanism React ships for DevTools, not a hand-rolled lane write.

### Requirements

`scheduleUpdate` is registered **only in development React builds**, and only when the devtools-hook shim was present before `react-dom` evaluated (so the renderer registered into `__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers`). On a **production** build there is no `scheduleUpdate` and the nudge reports `no-scheduleUpdate`. For Playwright injection order, use [mode-a-injection](mode-a-injection.md).

### Why not `useState` dispatch / `forceUpdate` / direct lane writes?

- A `useState` dispatch only works if the target *has* a state hook, and it **pollutes** that hook's value (the old "anchor contract"). `scheduleUpdate` has neither limitation.
- `forceUpdate` only covers class components.
- Direct lane writes (`fiber.lanes |= 1`) are version-coupled (lane layout shifted across 18.0/18.2/18.3) and produce a marked fiber with no scheduled work. `scheduleUpdate` calls the real scheduler.

### Failure modes and recovery

| `reason` | Cause | Recovery |
|---|---|---|
| `missing-target` | Neither `--probeId` nor `--testId` was supplied. | Pass one. |
| `testid-not-found` | The DOM does not contain that `data-testid`. | Snapshot the page state; story may not have rendered. |
| `no-composite-fiber-for-testid` | The element is detached or not React-owned. | Pick a different node. |
| `owner-out-of-range` | `--ownerIndex` overshot the owner chain. | Lower `ownerIndex`. |
| `probe-not-placed` / `no-resolver` / `no-composite-fiber` | The `--probeId` probe is not placed, the probe runtime is not loaded, or the probe has no composite fiber. | Place the probe, use `--testId`, or resolve a `fiberId` and run `fiber-schedule-update`. |
| `bridge-capability-missing` | The Avalanche bridge runtime is not loaded in the page. | Check that `window.__AVALANCHE__` is present; reconnect through a route that loads Avalanche. |
| `schedule-failed` | The capability returned no reason. | Read `error`, capture the page console, and retry once on a freshly resolved fiber. |
| `no-scheduleUpdate` | Production React build, or the devtools-hook shim was not installed before `react-dom` evaluated. | Use a dev build; ensure the shim runs at page boot (extension `document_start` / Playwright `addInitScript`). |
| `scheduleUpdate-threw` | React threw synchronously while scheduling. | Capture the page console — usually a render error masking the schedule. |

---

## Snippet contract

`stability-nudge.js` (in `snippets/`) accepts:

| arg | required | meaning |
|---|---|---|
| `--testId <string>` | one of | `data-testid` attribute — resolves DOM → fiber directly |
| `--probeId <id>` | one of | placed probe (`1`, `2`, `3`) — resolves to its nearest composite fiber |
| `--ownerIndex <N>` | no | walk N steps up the owner chain (0 = target itself) |
| `--label <string>` | no | echoed into `ctx.log` for human-readable trace |
| `--dryRun <true\|false>` | no | resolve + report fiber, do not schedule |

Returns:
```json
{
  "ok": true,
  "fiberName": "StabilityChain",
  "source": { "fileName": "...", "lineNumber": 88 },
  "ownerIndex": 0,
  "label": "parent-nudge"
}
```

See **Update mechanism → Failure modes** for the `ok: false` reasons.

---

## Reporting format

```
📏 stability render: <FiberName> @ <file>:<line>
   waves: <commitCount>  renders: <renderedTotal>  collateral: <N>
   verdict: clean | leak | leak+cascade | trasher
   first offender: <ComponentName> @ <file>:<line>  reason: <missing memo | unstable prop | unstable dep | …>
   confidence: confirmed | likely | partial
   next gap: <…>
```

Never report `clean` without a render-factor number. Never report `trasher` without naming the offending amplifier hook and the dependency that changed.

---

## Boundaries

- **Active stimulus, zero hook/prop mutation.** The snippet schedules one render without changing a hook or prop. The extra commit is the stimulus, and render-time side effects or effects in the subtree may run.
- **One nudge per capture.** Multiple nudges in the same window confound attribution. Always `avalanche-clear` between nudges.
- **No interaction overlap.** The user must not be clicking the page during a nudge. State the rule before running.
- **Do not nudge providers from above.** A nudge on a context provider's parent will look like a context wave; that is not a stability test, that is a propagation test. Pick a sibling boundary instead.

---

## Worked example — `memo → useCallback → useEffect` chain

Fixture pattern: `StabilityChain` demonstrates the unfixed identity chain. Fixed companion pattern: `StabilityChainFixed` demonstrates the corrected chain.

The chain Chippy is supposed to recognise:

```
Parent
 └─ unstable object literal in render: opts = { mode }
    └─ Leaf gets opts as prop (new identity every render)
       └─ useCallback(handler, [opts])         ← deps include unstable object
          └─ useEffect(..., [handler])          ← deps include unstable callback
             └─ effect body: setState(...)      ← schedules another render
```

Three separate things go wrong, but they are NOT three independent bugs. They are one upstream identity flip flowing downhill into progressively worse symptoms.

### What the capture should show

Nudge target: `Parent` (`StabilityChain`). One nudge.

| Signal | Expected reading |
|---|---|
| `commitCount` | `>1` — the effect's `setState` schedules a follow-up commit |
| Top hot-source | `Leaf` — re-renders not because of its own logic, but because its effect dispatches |
| `commit-peek <commitId> sources` `trashers` on `Leaf` | a hook flipping each commit (the effect-driven setState) |
| Effect re-attach count | grows linearly with commits — visible in DOM as `attach/detach: N/N-1` |

That last row is the smoking gun. **An effect re-attaching every commit is not a perf issue, it is a correctness issue.** Subscriptions get torn down and rebuilt; cleanup ordering matters; analytics double-fire; fetches race themselves.

### Recognising the chain — top → bottom

Chippy reads the chain in **damage order**, not in source order:

1. **Effect re-fire** = worst. Run `avalanche-commit-peek` on the top commit, look at `Leaf`'s `trashers` in the `sources` section. If a `useEffect` appears there every commit, the effect is re-firing.
2. **Callback identity flip** = the cause of the effect re-fire. Inspect `Leaf`'s `useCallback` (probe-hooks shows the dep array). If the dep is a non-primitive that changes identity, that's the link.
3. **Object identity flip** = the cause of the callback identity flip. Walk `_debugOwner` up to `Parent`, read `probe-props`. If `opts` is a fresh object each render with no upstream `useMemo`, that's the root.

This is **top → bottom in the codebase** (Parent at the top of the file owns the root cause) but **bottom → top in the avalanche reading** (the symptom shows up at the leaf, the cause is at the parent). Do not reverse the order.

### Fix order — effect first, then memo/callback

These are remediation candidates for the worked pattern. A source edit still requires user intent plus the P-15 proof packet and P-16 Apply gate; verify any authorized edit with the same nudge.

Prioritize the effect retrigger as the correctness issue. Memo/callback fixes come afterward when they are still needed to prevent the wider avalanche.

Why this order matters:

- Fixing the memo/callback first hides the effect bug. The effect stops re-firing because its deps stop flipping — but if a future change reintroduces an unstable dep, the effect breaks again silently.
- Fixing the effect first forces the question "why is this effect treating an unstable identity as semantic input?" — which usually reveals the effect was wrong about what its real dependency is (`opts.mode`, not `opts`).

Three iterative steps. Each is verified with one stability-render capture before moving on.

#### Step 1 — stop the effect from re-firing (correctness fix)

The effect attaches a subscription and dispatches state. It depends on `handler`, but what it actually cares about is `opts.mode` — a primitive. The fix is one of:

- Narrow the dep to the primitive: depend on `opts.mode`, not on `handler`.
- Read the current `handler` via a ref inside the effect, so the effect attaches once and the body always uses the latest closure.
- If the subscription is the only side effect, move attach/detach to a `useLayoutEffect` keyed on the stable subscription target rather than on a callback identity.

**Pointer for the agent:**
- Location: the `Leaf` component's `useEffect(..., [handler])`.
- Question to answer before editing: *what does this effect semantically depend on — the function identity, or the data the function reads?*
- After the fix, re-run stability-render. Expected: `commitCount` drops to 1; `attach/detach` no longer grows per nudge.

#### Step 2 — stabilise the callback (avalanche prevention)

After Step 1 the effect is fine, but the callback still flips identity every render. That is harmless on its own — but the moment a memoised child uses it as a prop, the cascade comes back. Fix this *before* memoising any children, not *after*.

**Pointer for the agent:**
- Location: `Leaf`'s `useCallback(handler, [opts])`.
- Same dep narrowing logic as Step 1: depend on `opts.mode`, not on `opts`. The callback's body only uses `opts.mode`, so the wider dep is overcautious and breaks memoisation.
- After the fix, re-run stability-render. Expected: callback identity stable across nudges; `Leaf`'s render count for the nudge stays at 1.

#### Step 3 — stabilise the upstream object (defence in depth)

`Parent` builds `opts = { mode }` inline. Step 1 + Step 2 made downstream consumers immune to that, but the next consumer added to this subtree will get the same trap. Wrap the object once.

**Pointer for the agent:**
- Location: the parent's `const opts = { mode };`.
- Wrap with `useMemo(() => ({ mode }), [mode])` — or, if `mode` is the only field, pass `mode` directly and drop the object.
- After the fix, re-run stability-render. Expected: same numbers as after Step 2. This step is *prevention*, not *repair* — measurable improvement is "no regression when a new memoised consumer is added".

### What "deep explanation" means here

When Chippy reports findings on this chain, every pointer must answer three questions:

1. **What flips?** Name the identity that changes. (`opts` object reference; `handler` function reference; `useEffect` cleanup/attach pair.)
2. **Why does that flip propagate?** Name the dep array or prop boundary it crosses. (Dep array of `useCallback`; dep array of `useEffect`; prop `opts` from Parent to Leaf.)
3. **What invariant breaks?** Name the runtime consequence, not just "re-render". (Subscription torn down each commit; effect cleanup races body; setState-in-effect creates a render loop bounded only by React's max nested-update guard.)

If a pointer omits any of those, it is not a deep enough explanation. State the gap explicitly rather than papering over it.

### What this section is NOT

- Not a fix. Chippy proposes pointers; the agent edits.
- Not a rewrite. Three small, independent diffs in one file.
- Not a "boil the ocean" memoisation pass. Only the three identities on the chain that the capture proved are involved.

---

## Cross-links

- [avalanche-detector](./avalanche-detector.md) — capture surface, commit join, restart semantics.
- [fixing-performance](./fixing-performance.md) — where the fix lives (above / boundary / below).
- [browser-runtime-api](./browser-runtime-api.md) — `window.__CHIPPY.resolveProbes`, `window.__CHIPPY.inspectReact`.
- [hooks-inspection](./hooks-inspection.md) — hook walk shape, used to read hook state after a nudge.
