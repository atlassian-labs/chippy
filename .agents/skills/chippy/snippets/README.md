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
| `perf-entries` | Read-only | Read buffered layout shifts, long animation frames, slow interactions, LCP, FCP, and TTFB; name the component behind each, and list nearby Avalanche commits. |

Read [hook metrics](../references/hook-metrics.md) before using the metrics snippets. Read [stability render](../references/stability-render.md) before using `stability-nudge`.

### `perf-entries`

```bash
./scripts/chippy.sh eval-page <clientId> perf-entries [--types layout-shift,event] [--since <ms>] [--max 20] [--scripts 5] [--commits 10]
```

`--types` defaults to `layout-shift`, `long-animation-frame`, `event`, `largest-contentful-paint`, `paint`, and `navigation`, limited to what the browser supports (`unsupported` lists the rest). `--since` drops entries that started before a `performance.now()` value, for example a commit's `startTime`. `--max` caps entries per type; layout shifts, long frames, and events are ranked largest first. `--scripts` caps the scripts kept per long frame, and `--commits` caps the ids in `commits.during`.

The result has `summary` (`cls` as the largest session window, `layoutShifts`, `longFrames`, `totalBlockingMs`, `interactions`, `worstInteractionMs`, `lcpMs`, `fcpMs`, `ttfbMs`) and `entries[type].items`. Shift sources, interaction targets, and the LCP element carry `component`, `source`, `testId`, and `element`; `component` is `null` when the node is not rendered by React, for example `body`. With Avalanche installed, `avalanche` reports the commit count and report version, and each entry carries `commits.during` and `commits.before`. Report version 7 or later is required for the commit join.

Limits come from the browser: each entry type keeps a bounded buffer (about 150 entries; 200 for long animation frames), and only events of 104 ms or more are buffered. `worstInteractionMs` is the worst buffered interaction, not a percentile INP. Run the snippet soon after the interaction you are measuring.

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
