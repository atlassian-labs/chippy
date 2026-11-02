# Debug-hook

Fiber-to-source hook locator. Resolves a single hook on a single committed source: not just what primitive hook it is, but **how to find that hook in source** when React only gave you a flat primitive index like `230`.

Not a profiler. Not a source finder for the component itself. Not a wave analyzer. A focused **locator/interrogation tool** for a hook you already suspect.

Lifecycle stage: **hook localization after triage/experiment**. Enter only when a prior commit analysis or stability-render result already gives a `sourceId` and changed `hookIndex`.

Exit when you can walk from the known component source to the target hook using the output: primitive kind, custom-hook parent folders, relative order, and any `useDebugValue` landmarks. Then return to [fixing-performance](fixing-performance.md) for fix-layer choice, or to provider/context analysis if the result is `Context`/`partial`.

Purpose: React fibers store only the real primitive hook chain. They do not preserve the nested custom-hook structure developers read in source. `debug-hook` exists to bridge that gap. Given a known source component and a primitive hook index, it should reconstruct enough nested structure — component → custom hooks → primitive hooks, plus relative landmarks such as `useDebugValue` — that Chippy can say *which* `useMemo` / `useState` / `useSyncExternalStore` to inspect in code.

Capability boundary: debug-hook does **not** find the component source from scratch. It starts from a component/source location already known from prior Chippy/Avalanche evidence. Its job is to convert a flat fiber hook coordinate into a source-walkable path inside that known component.

## When to use

Use after **another tool already pointed at a source and a changed hook index**:

- avalanche commit-peek surfaced a hot/source component with a changed hook index
- stability-render shows leak/cascade isolated to a single source

Do not use to:

- find sources (`avalanche-hot-sources`, `avalanche-commit-list`)
- find triggers / waves (`fixing-performance`)
- grade a subtree (`stability-render`)
- read all hooks on a fiber (this tool answers about **one** hook + its near neighbors)

## Inputs

- `sourceId` — public id from a report (e.g. `StoreReader#1@6`)
- `hookIndex` — fiber `memoizedState` index of the changed hook
- `windowSize` — included neighborhood radius around the target index. Default `3`. Operationally: hook is included when `|hook.index - target| <= windowSize`.

## Read order

Always read the output in this order. Stop at the first step that gives you the answer.

1. `target.primitive` — chooses the remediation branch entirely. Read first.
2. `target.value` — current committed hook value summary. This is now the primary evidence.
3. `parents` — custom-hook owner chain if available. Can be empty in the working fiber-chain reconstruction.
4. `target.debugValues` — semantic labels if available.
5. `neighborhood[*].debugValues` — labels on adjacent hooks when available.
6. `flat` — one-liner summary for log-scrolling humans, not for decisions.

## Field semantics

- `target.primitive` — primitive React hook kind: `SyncExternalStore`, `State`, `Reducer`, `Memo`, `Callback`, `Effect`, `LayoutEffect`, `Ref`, `Context`, `DebugValue`, `Id`, `ImperativeHandle`, `InsertionEffect`, `DeferredValue`, `Transition`, `CacheRefresh`, `MemoCache`, `Unknown`.
- `parents` — custom-hook owner chain when available from hook metadata. **Empty parents does not mean failure**: it can mean the target hook is called directly inside the component, or that the current reconstruction only knows the component frame. Empty `parents` + non-empty `target` is still `confirmed`.
- `neighborhood` — primitive hooks within `windowSize` of the target.
- `confidence` — tri-state. See below.
- `reconstruction` — tells you which runtime strategy produced the answer. Current working path is `fiber-hook-chain + _debugHookTypes`.

## Confidence

The API field `confidence` is binary: `confirmed | partial`. A third logical state — *unknown* — is not a `confidence` value; it is signaled by `ok: false` or a present `renderError`. Read all three together.

| state | how to detect | next |
|---|---|---|
| `confirmed` | `ok: true`, `confidence: 'confirmed'`, `target` resolved, no `renderError`. | act on remediation table. |
| `partial` | `ok: true`, `confidence: 'partial'`, no `target` (index out of range, `Context`, `DebugValue`, or `MemoCache` cell). | re-pick `hookIndex`, or switch to provider/context analysis. |
| *unknown* (logical) | `ok: false` or `renderError` present. | report `renderError`. Do not infer cause. Re-run once if it looks transient; otherwise raise it as a tool gap. |

## What to do next, by primitive

- **SyncExternalStore** — external store fired. See *Root causes / remediations*.
- **State / Reducer** — in-component update. Trace the `setX` / `dispatch` caller. Two sub-cases:
  - value churn — the new state is genuinely different.
  - identity churn — `dispatch` / `setX` is treated as identity-stable, but the consumer received a new object (e.g. a closed-over reducer rebuilt every render). Check whether the dispatcher itself is recreated.
- **Memo / Callback** — identity churn. Inspect the deps array; an object/function/array rebuilt each render is the usual cause.
- **Effect / LayoutEffect / InsertionEffect** — side-effect ran. Inspect deps. Effect *running* is rarely the perf cause; the effect's body is. If body calls `setState`, jump to State cascade.
- **Ref** — mutation, not a render cause. Mark benign.
- **Context** — has no fiber `memoizedState` slot you can index. Switch to provider-side analysis (`stability-render` on the provider value).
- **DebugValue / Id / MemoCache** — diagnostic / structural slots. Not a cause. Re-pick `hookIndex`.
- **DeferredValue / Transition / CacheRefresh** — concurrent-mode primitives. Treat as advisory; cause is upstream.
- **ImperativeHandle** — handle re-creation; rare cause.
- **Unknown** — hook shape did not match any classifier. Report as a debug-hook gap; do not guess.

## Root causes / remediations

Mutually exclusive rows. Pick by `target.primitive` and the **detection** column. Detection columns may mention `debugValues` fields such as `selector`; use them only when the source already emits those labels. When labels are absent, join the primitive and value with the known component's hook call order. If that still cannot distinguish the call site, report the localization gap rather than editing source during Prove.

| Primitive | Root cause | Detection (from debugHook output) | Remediation |
|---|---|---|---|
| SyncExternalStore | **over-broad subscription** | `target.value` differs each commit *and* differs by fields the consumer doesn't read; debugValues `selector` returns a wide slice (object/array of many keys). | Narrow the slice to only fields the consumer reads. Return primitives where possible. |
| SyncExternalStore | **selector returns wrong identity** | `target.value` deep-equals previous but identity differs each commit (new object/array literal); debugValues `selector` ends in `map`/`filter`/`{...}`/`[...]`. | Stable selector: memoize, return a primitive, or subscribe with shallow-equal. |
| SyncExternalStore | **store mutation rate too high** | identity *and* value change, debugValues store is shared, multiple unrelated sources hit the same store on the same commit. | Split store, debounce writes, or move the read closer to the consumer. |
| State / Reducer | **unconditional setState in render or layout effect** | repeated `confirmed` debugHook results on the same source per interaction; State value oscillates / monotonic-grows each commit. | Hoist or guard the update. Remove the avoidable setState. |
| State / Reducer | **dispatcher identity churn** | State *value* unchanged but consumers below re-render; reducer object recreated per render. | Stabilize reducer/dispatcher identity (module scope or `useRef`). |
| Memo / Callback | **deps contain a recreated reference** | `target.primitive` is Memo/Callback on a hot source; debugValues / context show a parent re-rendering with new object/function props. | Stabilize deps (lift constants, memoize source object, switch to primitive deps). |
| Effect / LayoutEffect | **deps churn** | Effect runs every commit; deps array contains a recreated reference. | Stabilize deps. Then verify the effect is needed at all. |
| Context | **provider value identity churn** | `target.primitive` is Context (or provider rendered directly above the source); value identity differs commit-over-commit. | Memoize provider value or split context. Use `stability-render` on the provider to verify. |
| Ref | none — benign | `target.primitive` is Ref. | No action. |
| Unknown | classifier gap | `target.primitive === 'Unknown'`. | Report as debug-hook gap. Do not invent a cause. |

## Read existing `useDebugValue` landmarks

Use the existing output. No source edits.

**Stop (you have the answer) when all hold:**

- `target.primitive` is a single concrete kind (not `Unknown`, not `MemoCache`).
- `target.value` is a primitive, OR a stable reference already named in `debugValues`.
- `parents` either names the custom hook you expected, OR is empty *and* the source component itself is the owner you expected.
- you can name the store / state / memo this hook represents in one sentence using the data shown.

**The runtime result is insufficient if any hold:**

- `parents` is generic-only (`["useState"]`, `["useReducer"]`) and you cannot tell which logical hook it represents. (Empty `parents` + recognizable source name is *not* this case — that's a stop, see Phase A above.)
- `target.value` renders as `[object]`, `[function]`, `[array:N]` and the identity matters for the question.
- multiple sibling hooks in `neighborhood` have the same primitive and you cannot tell them apart.
- repeated triggers produce identical-looking output and existing labels do not distinguish the call sites.

When the runtime result is insufficient, open the already-known component source and align the primitive with hook call order, custom-hook calls, and the returned neighborhood. If more than one call site still fits, return `confidence: partial` with the exact ambiguous calls. Adding diagnostic source labels is a separate, user-authorized change and must pass the normal P-15/P-16 edit gate before it occurs.

## Playwright verification path

Use this exact flow when verifying debug-hook under Playwright without the browser extension. Playwright is a contract here, not a specific runner. Runtime globals must match the names defined in the Chippy skill's **Runtime globals contract** — only `window.__CHIPPY` and `window.__AVALANCHE__` (with the trailing `__`) are valid.

Prerequisites (do not skip):

- Chippy helper is running (`chippy.sh start`, `chippy.sh health` ok).
- The target page is being served and can be opened by Playwright.

Steps:

1. Install the helper-served devtools-hook shim with `addInitScript` before navigation, then open the exact target page in Playwright.
2. Inject `inject.mjs` (preferred), or inject `inject.js` followed by `avalanche.iife.js`.
3. Verify the connection with `chippy.sh pages` and pick the matching `dev` client for that page URL.
4. Run `chippy.sh avalanche-install <clientId>`; loading `window.__AVALANCHE__` does not install the detector in Mode A.
5. Run `chippy.sh avalanche-clear <clientId>`, then replay one trigger through Playwright.
6. Read runtime source evidence from `avalanche-hot-sources` / `avalanche-commit-peek`.
7. Run `chippy.sh avalanche-debug-hook <clientId> <sourceId> <hookIndex> 3`.

Do not treat missing top-level `__chippyPageBridge` as an injection failure. In this mode the reliable checks are `window.__CHIPPY` in the page, `window.__AVALANCHE__` after step 4, and the matching client appearing in `chippy.sh pages`. Any other global name (e.g. `window.__avalanche`) is wrong by contract.

## Recovering from `source fiber unavailable`

debug-hook needs the detector to retain fibers. If the response is:

```
{ ok: false, error: "source fiber unavailable; install with captureFibers=true" }
```

the current capture cannot answer debug-hook. No reload is required:

1. Re-install the detector with fiber capture on the live page:
   `chippy.sh avalanche-install <clientId>` (uses `captureFibers=true`, `detectionMode=sources`).
2. Clear and reset history if needed: `chippy.sh avalanche-recapture <clientId>` does install + clear + status in one call.
3. Reproduce the trigger:
   - Interactive (extension): ask the user to redo the same interaction so the new detector observes it.
   - Playwright: re-run the same Playwright step that produced the symptom.
4. Re-run `avalanche-debug-hook` with the same `sourceId` + `hookIndex`.

Never preload-only. Fiber capture is a runtime setting and can be activated at any time; only the *next* capture window contains fiber data.

## Limits

- Minified production: `parents` degrade — function names collapse to short aliases or empty strings. Primitive classification still works.
- Current working implementation reconstructs from the fiber hook chain plus `_debugHookTypes`. That makes primitive/value output reliable, but custom-hook ownership can be shallower than the ideal replay-based form.
- `Context`, `DebugValue`, `MemoCache` do not occupy indexable `memoizedState` slots in the way the other hooks do; expect `partial` confidence if `hookIndex` lands on them.
