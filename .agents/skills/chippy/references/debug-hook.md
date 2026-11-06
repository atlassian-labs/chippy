# Debug-hook

Fiber-to-source hook locator. Resolves a single hook on a single committed source: not just what primitive hook it is, but **how to find that hook in source** when React only gave you a flat primitive index like `230`.

Not a profiler. Not a source finder for the component itself. Not a wave analyzer. A focused **locator/interrogation tool** for a hook you already suspect.

Lifecycle stage: **hook localization after triage/experiment**. Enter only when a prior commit analysis or stability-render result already gives a `sourceId` and changed `hookIndex`.

Exit when you can walk from the known component source to the target hook using the output: primitive kind, custom-hook parent frames, relative order, and any `DebugValue` landmarks in `neighborhood`. Then return to [fixing-performance](fixing-performance.md) for fix-layer choice, or to provider/context analysis if the result is `Context` or still ambiguous.

Purpose: React fibers store only the real primitive hook chain. They do not preserve the nested custom-hook structure developers read in source. `debug-hook` exists to bridge that gap. Given a known source component and a hook index from the capture, it looks up the matching hook call recorded while the component rendered and returns its primitive plus the stack frames of the custom hooks that called it, with nearby calls as landmarks, so Chippy can say *which* `useMemo` / `useState` / `useSyncExternalStore` to inspect in code.

Capability boundary: debug-hook does **not** find the component source from scratch. It starts from a component/source location already known from prior Chippy/Avalanche evidence. Its job is to convert a flat hook coordinate into a source-walkable path inside that known component.

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

- `sourceId` — source id from the same capture. Both the public form from a report (e.g. `StoreReader#1@6`) and the internal id are accepted.
- `hookIndex` — source-local hook index from the capture. It is mapped through `sourceHookIndices` onto the recorded hook event stream; the result reports both `hookIndex` and the resolved `eventIndex`.
- `window` — neighborhood radius around the target event. Default `3`. A recorded hook call is included when `|eventIndex - target eventIndex| <= window`.

## Output

`ok: true` results contain `sourceId` (resolved id), `requestedSourceId`, `componentName`, `resolvedComponentName`, `hookIndex`, `eventIndex`, `sourceHookIndices`, `primitive`, `parents`, `neighborhood`, `eventCount`, `status`, and `caveat`.

## Read order

Always read the output in this order. Stop at the first step that gives you the answer.

1. `primitive` — chooses the remediation branch. Read first.
2. `parents` — stack frames (`{ name, loc }`) recorded when the hook ran during a real render; custom-hook names appear here. Empty `parents` can mean the hook is called directly in the component.
3. `neighborhood` — `{ hookIndex, eventIndex, primitive, parents }` for recorded hook calls within `window` of the target. Use it for relative order and landmarks such as `DebugValue`.
4. `resolvedComponentName` — differs from `componentName` when events were matched by a partial name; treat the result as ambiguous then.

## Field semantics

- `primitive` — primitive React hook kind derived from the dispatcher method: `SyncExternalStore`, `State`, `Reducer`, `Memo`, `Callback`, `Effect`, `LayoutEffect`, `Ref`, `Context`, `DebugValue`, `Id`, `ImperativeHandle`, `InsertionEffect`, `DeferredValue`, `Transition`, `CacheRefresh`, `MemoCache`. Any other dispatcher method is reported under its raw method name (for example `use`).
- `parents` — the target call's stack frames with Chippy-internal and component frames removed. **Empty parents does not mean failure.**
- `eventCount` — number of hook calls recorded for the component; `status` — state of the hook-call recorder.
- `caveat` — reminder that ancestry comes from passive stack capture and index mapping; read it before trusting `parents` in bundled code.

## Failures

| Result | Meaning | Next |
|---|---|---|
| `error: 'debug-hook requires sourceId and numeric hookIndex'` | Missing or non-numeric argument. | Pass both arguments. |
| `error: 'not installed'` or `'debugHook() unavailable on __AVALANCHE__ API'` | No detector, or a runtime without debug-hook. | `avalanche-install`, reproduce, retry. |
| `error: 'sourceId not found'` | The id is not in this capture. | Re-read `avalanche-hot-sources` or `avalanche-commit-peek <clientId> <commitId> sources` from the same capture. |
| `error: 'hook event not found'` with `eventCount: 0` | No render of this component was recorded since install. | Reproduce the interaction once, then retry. |
| `error: 'hook event not found'` with `eventCount > 0` | `hookIndex` maps outside the recorded hook stream. | Re-pick `hookIndex`. |

## What to do next, by primitive

- **SyncExternalStore** — external store fired. See *Root causes / remediations*.
- **State / Reducer** — in-component update. Trace the `setX` / `dispatch` caller. Two sub-cases:
  - value churn — the new state is genuinely different.
  - identity churn — `dispatch` / `setX` is treated as identity-stable, but the consumer received a new object (e.g. a closed-over reducer rebuilt every render). Check whether the dispatcher itself is recreated.
- **Memo / Callback** — identity churn. Inspect the deps array; an object/function/array rebuilt each render is the usual cause.
- **Effect / LayoutEffect / InsertionEffect** — side-effect ran. Inspect deps. Effect *running* is rarely the perf cause; the effect's body is. If body calls `setState`, jump to State cascade.
- **Ref** — mutation, not a render cause. Mark benign.
- **Context** — the consumer read a context; the cause is the provider value. Switch to provider-side analysis (`stability-render` on the provider value).
- **DebugValue / Id / MemoCache** — diagnostic / structural calls. Not a cause. Re-pick `hookIndex`; use `DebugValue` entries in `neighborhood` as landmarks.
- **DeferredValue / Transition / CacheRefresh** — concurrent-mode primitives. Treat as advisory; cause is upstream.
- **ImperativeHandle** — handle re-creation; rare cause.
- **Other (raw method name)** — dispatcher method not in the classifier. Report as a debug-hook gap; do not guess.

## Root causes / remediations

Mutually exclusive rows. Pick by `primitive` and the **detection** column. debug-hook localizes the call site; it does not return hook values or `useDebugValue` labels. Value and identity evidence comes from the commit report (`avalanche-commit-peek`) or `stability-render`. Join `primitive`, `parents`, and `neighborhood` with the known component's hook call order. If that still cannot distinguish the call site, report the localization gap rather than editing source during Prove.

| Primitive | Root cause | Detection (debug-hook plus commit evidence) | Remediation |
|---|---|---|---|
| SyncExternalStore | **over-broad subscription** | `primitive` is SyncExternalStore; the hook changes each commit by fields the consumer does not read, and `parents` points at a selector returning a wide slice. | Narrow the slice to only fields the consumer reads. Return primitives where possible. |
| SyncExternalStore | **selector returns wrong identity** | Value deep-equals the previous one but identity differs each commit; the selector named by `parents` builds a new object/array (`map`/`filter`/`{...}`/`[...]`). | Stable selector: memoize, return a primitive, or subscribe with shallow-equal. |
| SyncExternalStore | **store mutation rate too high** | Identity *and* value change; multiple unrelated sources hit the same store on the same commit. | Split store, debounce writes, or move the read closer to the consumer. |
| State / Reducer | **unconditional setState in render or layout effect** | The same source and hook resolve repeatedly per interaction; the state oscillates or grows each commit. | Hoist or guard the update. Remove the avoidable setState. |
| State / Reducer | **dispatcher identity churn** | State *value* unchanged but consumers below re-render; reducer object recreated per render. | Stabilize reducer/dispatcher identity (module scope or `useRef`). |
| Memo / Callback | **deps contain a recreated reference** | `primitive` is Memo/Callback on a hot source; a parent re-renders with new object/function props. | Stabilize deps (lift constants, memoize source object, switch to primitive deps). |
| Effect / LayoutEffect | **deps churn** | Effect runs every commit; deps array contains a recreated reference. | Stabilize deps. Then verify the effect is needed at all. |
| Context | **provider value identity churn** | `primitive` is Context (or provider rendered directly above the source); value identity differs commit-over-commit. | Memoize provider value or split context. Use `stability-render` on the provider to verify. |
| Ref | none — benign | `primitive` is Ref. | No action. |
| Other | classifier gap | `primitive` is a raw dispatcher method name. | Report as debug-hook gap. Do not invent a cause. |

## Read existing landmarks

Use the existing output. No source edits.

**Stop (you have the answer) when all hold:**

- `primitive` is a single concrete kind (not a raw method name, not `MemoCache`).
- `resolvedComponentName` equals `componentName`.
- `parents` either names the custom hook you expected, OR is empty *and* the source component itself is the owner you expected.
- you can name the store / state / memo this hook represents in one sentence using the data shown.

**The runtime result is insufficient if any hold:**

- `parents` is generic-only (only primitive hook names such as `useState`) and you cannot tell which logical hook it represents. (Empty `parents` + recognizable source name is *not* this case — that is a stop.)
- `resolvedComponentName` differs from `componentName`.
- multiple sibling hooks in `neighborhood` have the same primitive and you cannot tell them apart.
- repeated triggers produce identical-looking output and existing landmarks do not distinguish the call sites.

When the runtime result is insufficient, open the already-known component source and align the primitive with hook call order, custom-hook calls, and the returned neighborhood. If more than one call site still fits, report the result as ambiguous with the exact candidate calls. Adding diagnostic source labels is a separate, user-authorized change and must pass the normal P-15/P-16 edit gate before it occurs.

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

## Recovering from `hook event not found`

debug-hook reads hook calls recorded while the detector was installed. If the response is `hook event not found` with `eventCount: 0`, the current capture has no renders of that component. No reload is required:

1. Reset the capture on the live page: `chippy.sh avalanche-recapture <clientId>` does install + clear + status in one call.
2. Reproduce the trigger:
   - Interactive (extension): ask the user to redo the same interaction so the new detector observes it.
   - Playwright: re-run the same Playwright step that produced the symptom.
3. Re-read `sourceId` and `hookIndex` from the new capture, then re-run `avalanche-debug-hook`.

Only renders after install are recorded; the *next* capture window contains the hook events.

## Limits

- Minified production: `parents` degrade — function names collapse to short aliases or empty strings. Primitive classification still works.
- Hook ancestry comes from passive stack capture during real renders (see `caveat`); component-name stack parsing can be ambiguous in bundled or minified code, and custom-hook ownership can be shallower than the source nesting.
- `hookIndex` is mapped onto the recorded event stream through `sourceHookIndices`; when the mapping is missing, `hookIndex` is used as the event index directly. Confirm `eventIndex` and `neighborhood` order against the component source.
