# Hook metrics — `setStateCount` + the hook-update tracker

Reference for the two snippets that consume the react-dom patch's hook metrics:
`hook-metrics` (read-only) and `hook-tracker` (drives the `onHookUpdate` callback).
They belong to the ATL plugin: they read the ATL adapter's `__ATL_REACT_METRICS`
slot and need Atlassian's patched `react-dom` to report anything.

These are the **why** layer under Avalanche. Avalanche tells you *what* re-rendered and
*how much collateral* a commit caused. Hook metrics tell you *why a component's work
repeated*: how many state dispatches were scheduled, and which memo/callback/effect slots
recomputed because their deps actually changed. ~99% of the time you reach for these
**after** an Avalanche capture has already named a hot component.

## What the patch emits

The react-dom patch adds exactly two hook-related surfaces to the host metrics object
`__ATL_REACT_METRICS`:

| Surface | Kind | Meaning | Where it fires |
|---|---|---|---|
| `setStateCount` | plain counter | `useState`/`useReducer` **dispatches scheduled** | `dispatchSetState` / reducer dispatch, bumped unconditionally (`m.setStateCount++`) |
| `onHookUpdate(fiber, kind, slot)` | callback slot | one memo/callback/effect **recomputed because its deps changed** | update path only, *after* the deps-equality check — never on mount, never when deps were equal |

Hook kinds are numeric on the hot path: **`1 = memo`, `2 = callback`, `3 = effect`**.

**The metrics object is host-owned.** The patch never creates it and never stores hook
history — it only *bumps a counter* and *calls a callback if one is present*. This is the
core distinction from Avalanche:

- **Avalanche** installs everything for itself (`window.__AVALANCHE__`, its own detector).
- **Hook metrics** are emitted by the patched runtime into a slot the *app* owns. Chippy
  **reads** `setStateCount`, and **installs one thing** — the `onHookUpdate` callback — the
  same way the patch's own `hookTracker.ts` is meant to be installed independently.

### `setStateCount` caveats

- The host may seed `setStateCount` as `null`. The patch then does `null++` → `NaN`. Once
  numeric it is monotonic-per-run. `hook-metrics` reports `setStateCountValid:false` and a
  note when it sees a non-finite value instead of pretending it is a clean counter.
- Some hosts **wipe** `__ATL_REACT_METRICS` to
  `undefined` after hydration. `hook-metrics` reports `present:false, wiped:true`. The
  `hook-tracker install` action **seeds a minimal object** in that case so the tracker can
  still own `onHookUpdate` — it never overwrites an existing host object.

## `hook-metrics` — read-only

```bash
./scripts/chippy.sh eval-page <clientId> hook-metrics
./scripts/chippy.sh eval-page <clientId> hook-metrics --keys setStateCount,contextUpdateCount,totalCommitCount
./scripts/chippy.sh eval-page <clientId> hook-metrics --raw     # every own key, functions tagged
```

Returns `{ present, wiped, setStateCount, setStateCountValid, onHookUpdateInstalled, counters:{…} }`.
Use it to read the current dispatch volume without installing anything. If `present:false`,
the host hasn't created the object yet (or wiped it) — use `hook-tracker install` to own the
slot regardless.

## `hook-tracker` — drive the hook-update tracker

State persists across calls on `window.__CHIPPY_HOOK_TRACKER`, because install / reproduce /
read / uninstall are separate `eval-page` invocations.

```bash
CID=<clientId>
./scripts/chippy.sh eval-page $CID hook-tracker --action install          # own onHookUpdate, mode=counts
./scripts/chippy.sh eval-page $CID hook-tracker --action mode --mode debug # carry fiber refs for source locations
#   ... reproduce the interaction (user gesture, or Playwright clicks) ...
./scripts/chippy.sh eval-page $CID hook-tracker --action counts            # source of truth, compact
./scripts/chippy.sh eval-page $CID hook-tracker --action histogram --buckets 3,6,11
./scripts/chippy.sh eval-page $CID hook-tracker --action offenders --threshold 10
./scripts/chippy.sh eval-page $CID hook-tracker --action uninstall         # restore slot (only if still owned)
```

### Actions

| Action | Effect |
|---|---|
| `install` | seed metrics if absent, set `onHookUpdate = record`, mode → `counts` |
| `mode --mode off\|counts\|debug` | `off` no-ops; `counts` aggregates; `debug` additionally keeps the last fiber per type so `offenders` can report source file:line |
| `status` | installed?, mode, whether we still own the slot, entry count, current `setStateCount` |
| `counts` | per component-type: `{ totalUpdates, activeSlots, slots:[{slot,count,kind}] }`, sorted |
| `histogram --buckets a,b,c` | DB-safe: for each kind, count of `type:slot` identities whose total reached each bucket |
| `offenders --threshold N [--top M]` | dev-only: slots with `count > N`, carrying component name + source (needs `debug` mode) |
| `reset` | clear counts, stay installed |
| `uninstall` | restore `onHookUpdate` **only if we still own it**; retains last counts for a final read |

### Reading the numbers

- Counts aggregate by **component type**, not per instance — 100 rows of the same list item
  collapse into one entry. This is intentional (type-level hotspots), matching `hookTracker.ts`.
- `counts[slot]` is how many times that hook slot recomputed. `type[slot]` is the numeric kind.
- **Use `counts`/`histogram` in prod-like runs; `offenders` only in dev**, since minified
  bundles have no readable hook ids or source.
- A slot with a high count = a memo/callback/effect whose **deps keep changing**. That is
  dependency churn, and it is usually an unstable identity upstream (a new object/array/
  function created every render), not a bug in the memo itself.

## Lighthouse numbers vs Avalanche — the cost argument

The most useful framing for these metrics is **lighthouse numbers**: cheap integer
counters you could sample on every hydration and every route transition and forward to a
dashboard, for *real users in realtime*.

- **Avalanche** hooks React at a low level (`onCommitFiberRoot` + full fiber walk per
  commit). It sees the whole picture — collateral, penetration depth, context waves,
  unmount branches — but that instrumentation is far too expensive to leave on for every
  user. It is an *on-demand debugger*.
- **The patch's metrics** are just `count++` inline in react-dom plus one optional
  callback. Reading `setStateCount` is reading an integer. That is cheap enough to ship.

So the two are not competitors — they sit at opposite ends of a cost/detail axis:

| | `setStateCount` / hook-tracker | Avalanche |
|---|---|---|
| Cost | integer read / one callback | full fiber walk per commit |
| Detail | counts only (no tree, no collateral) | complete commit graph |
| Realtime / all-users | yes (lighthouse) | no (on-demand only) |
| Answers | "how much settling happened" | "what re-rendered and how far it spread" |

## `hook-metrics-sample` — labeled before/after delta in one call

The "lighthouse number" as a first-class read. Sample the counter, optionally click a
`data-testid`, sample again, return the delta:

```bash
./scripts/chippy.sh eval-page <clientId> hook-metrics-sample --label hydration --settleMs 500
./scripts/chippy.sh eval-page <clientId> hook-metrics-sample --label tick --click tick --clicks 4
```

Returns `{ available, label, before, after, delta, clicked, settleMs }`. **Metric-optional:**
if the patch is absent / wiped / `NaN` it returns `{ available:false, reason }` and never
throws.

## Avalanche integration — `setStateCount` per commit

When the react-dom patch is present, Avalanche now records `setStateCount` **per commit** as
an optional field on the ATL commit delta (`ATLCommitDelta.setStateCount`,
`ATLCommitDeltaDTO.setStateCount`). Read it with:

```bash
./scripts/chippy.sh avalanche-commit-peek <clientId> <commitId> atl
# → "atl": { ..., "setStateCount": 12 }
```

**Optional and self-degrading.** It is computed only when `__ATL_REACT_METRICS` is live at
commit time (`atlDeltaAvailable`), and the delta line is omitted entirely when neither
snapshot carries a numeric `setStateCount` — so on an unpatched host the field is simply
absent, never a bogus `0`. Every other ATL delta field can be `null` while `setStateCount`
is a real number; they are independent.

A sequence such as **1, 12, 1** distinguishes one top-level dispatch, a batched effect or
store wave, and another single dispatch. Treat the per-commit value as a *commit-shape*
signal: it distinguishes a burst of state dispatches from a single top-level update, but it
does not locate their source.

**Does it aid source detection?** Modestly, and only as a *disambiguator*, not a locator.
Avalanche already names the source component and `nearestTestId`. `setStateCount` per commit
adds one axis: a commit with `performedWork` high but `setStateCount` low = re-render driven
from *above* (props/context), not local state; high `setStateCount` = the work originated
from state dispatches in that commit window. It narrows *which kind* of trigger to chase; it
does not by itself point at a file. Treat it as a tie-breaker on top of the owner chain,
never a replacement for it. **And because the patch is optional, never build a source-tracing
procedure that requires it** — it is an enrichment when present, nothing when absent.

## What this diagnoses (and how it pairs with Avalanche)

| Symptom | Metric read | Interpretation | Next |
|---|---|---|---|
| Component renders far more than its parent | `setStateCount` climbing on one interaction | high state-dispatch volume — often a store/effect firing setState in a loop | trace the dispatcher; check for setState-in-render or effect cascades |
| Avalanche shows a hot source, unclear why | `hook-tracker counts` on that type | one slot thrashing vs many slots each once | one slot → chase that dep's identity; many slots → the whole component re-runs (parent/props identity) |
| Suspected unstable memoization | `offenders` (debug) | a `memo`/`callback` slot with count ≈ render count | the memo's deps are unstable — fix identity **above** the boundary (see [fixing-performance](fixing-performance.md)) |
| Effect running too often | `histogram` effect column | count of effect identities reaching each bucket | effect deps churn → stabilize deps or split the effect |
| Type-level hotspot across many instances | `counts` aggregation | one component type dominates total updates | fix once at the type, not per instance |

**Lifecycle placement** (see [evidence and edit gates](../SKILL.md#evidence-and-edit-gates)):

1. **Triage** with Avalanche (`avalanche-hot-sources`, `avalanche-commit-list`) → candidate hot component.
2. **Attribution**: `hook-tracker install` → reproduce → `counts` on that component type →
   is it *one slot thrashing* (dep churn) or *the whole component re-running* (identity/props)?
3. **Experiment**: after a fix, `hook-tracker reset` → reproduce → `counts` again, or use
   [stability-render](stability-render.md) to verify without a user gesture. Same signal,
   before/after.
4. **`uninstall`** to hand the slot back.

## Anchor contract

`hook-tracker` does **not** mutate product state, hooks, or props. It only:

- reads `setStateCount` (a counter the patch already writes), and
- **owns `onHookUpdate`** — a slot the host leaves for exactly this purpose.

What becomes opaque while installed: any *other* consumer of `onHookUpdate` is displaced
until `uninstall`. `uninstall` restores the slot **only if Chippy still owns it** (it checks
`onHookUpdate === record`), so a host that re-seeded the object after install is not clobbered.
If the host wiped the object and `install` had to seed one, that seeded object persists after
uninstall with `onHookUpdate = undefined` — harmless, and re-wiped on the next host reset.

Always `uninstall` when the investigation is done, and `reset` between reproduction runs so
counts from an earlier gesture don't bleed into the next measurement.
