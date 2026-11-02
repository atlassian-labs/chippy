# Chippy snippets

Snippets are version-controlled page-realm programs executed through `chippy.sh eval-page`. Use them for a reusable inspection question or reproducible procedure that existing commands cannot answer and that does not justify another bridge round trip.

Do not add a snippet to walk React fibers from a probe or remembered fiber until `probe-parents`, `explain-component`, `inspect-fiber-parents`, and `find-fibers` have proven the command surface cannot supply the path evidence. `probe-owners` reads debug-build `_debugOwner`, not the `fiber.return` parent chain; do not use it as a production-build route.

Most snippets are read-only. Active or stateful snippets declare the target they touch, the state they own, and what becomes ambiguous after execution.

## Run a snippet

From the Chippy skill directory:

```bash
./scripts/chippy.sh eval-snippets
./scripts/chippy.sh eval-page <clientId> <snippet-name> [--key value ...]
```

`snippet-name` resolves to `snippets/<name>.js`. An absolute path or a path relative to the current directory also works.

The shell wrapper forwards every `--key value` pair into `ctx.args`, coercing numbers and `true`/`false`. Its page-script timeout is fixed at five seconds; the wrapper does not expose a timeout override.

## Choose a packaged snippet

| Snippet | Kind | Use it when |
|---|---|---|
| `find-context-providers` | Read-only | List modern `React.createContext` providers; filter with `--name <regex>`. |
| `find-legacy-context` | Read-only | Find legacy `childContextTypes` / `contextTypes` producers and consumers. |
| `count-context-consumers` | Read-only | Count consumers for a Context display-name regex with `--name`. |
| `find-prop` | Read-only | Find fibers by prop name or value when a probe revealed a clue but the owner chain is broad. |
| `hook-metrics` | Read-only (ATL plugin) | Read the host `__ATL_REACT_METRICS`, including NaN/undefined-safe `setStateCount`. |
| `hook-metrics-sample` | Active, bounded (ATL plugin) | Measure a labeled before/after `setStateCount` delta, optionally clicking one test-id. |
| `hook-tracker` | Stateful instrument (ATL plugin) | Install, query, reset, or remove the `onHookUpdate` recomputation tracker. |
| `stability-nudge` | Active stimulus | Schedule one controlled component render for the stability-render procedure. |

Read [hook metrics](../references/hook-metrics.md) before using the metrics snippets. Read [stability render](../references/stability-render.md) before using `stability-nudge`.

## Authoring contract

Each snippet is the body of an `async function (ctx) { ... }` executed in the connected page. Return a JSON-serializable value.

`ctx` provides:

| Field | Contract |
|---|---|
| `ctx.args` | Object built from `--key value` pairs. |
| `ctx.log` | Array of human-readable trace strings returned with the result. |
| `ctx.helpers.getRootFibers()` | Root fibers across all React renderers on the page. |
| `ctx.helpers.walkAll(visit, opts?)` | Walk every fiber; `opts.limit` defaults to 200,000. |
| `ctx.helpers.findFibers(predicate, opts?)` | Return matching fibers; `opts.max` defaults to 5,000. |
| `ctx.helpers.getDisplayName(fiber)` | Best-effort display name. |
| `ctx.helpers.fiberInfo(fiber)` | Circular-safe view of name, source, owner, and DOM context. |
| `ctx.helpers.ancestorFibers(fiber, max?)` | Walk the fiber return chain. |
| `ctx.helpers.devtoolsHook()` | Raw React DevTools global hook when a documented procedure requires it. |

Prefer the smallest result that answers the question. Return summaries or bounded matches, not entire fiber trees.

## Result envelope

`eval-page` returns this shape:

```json
{
  "ok": true,
  "durationMs": 42,
  "log": ["matched 3 fibers"],
  "result": { "count": 3 }
}
```

The helper removes circular references, trims depth, represents functions as strings, and caps arrays at 200 items per level.

## Safety and ownership

- Do not commit secrets or return sensitive page data.
- Keep read-only snippets read-only.
- For an active snippet, document the exact target, stimulus, owned state, pollution boundary, and required cleanup or recapture.
- Use a current composite fiber for render stimuli. Re-resolve it after state changes or navigation.
- Use one stimulus per bounded capture. Clear or recapture before repeating it.
- Promote version-coupled React internals to a tested bridge capability; keep procedure and target resolution in the snippet.

`hook-tracker` owns `window.__CHIPPY_HOOK_TRACKER` and the host `onHookUpdate` callback until `--action uninstall`. `stability-nudge` delegates the render to the bundled `fiber-schedule-update` capability and owns no hook or prop state.

## Add or revise a snippet

1. Name the reusable question or procedure and choose read-only, active, or stateful behavior.
2. Add one JavaScript file under `snippets/` with a bounded input and result contract.
3. Document its arguments, ownership, failure shape, and cleanup in this catalog or its owning reference.
4. Exercise it through `eval-page`, not by calling its body directly.
5. If the snippet becomes a documented multi-step procedure, link its canonical reference from [the reference guide](../references/README.md).
