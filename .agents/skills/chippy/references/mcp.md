# Chippy over MCP

Use the local stdio MCP adapter when your agent host supports MCP tools. It starts
or reuses the helper automatically, so the agent does not need a shell command to
start a background server. The browser still needs the extension, module import,
or Storybook integration.

## Configure the host

Install the Chippy skill, then add this server to your host's MCP configuration.
Replace the example path with the **absolute installed skill path**; JSON arguments
do not expand `~`.

```json
{
  "mcpServers": {
    "chippy": {
      "command": "node",
      "args": ["/absolute/path/to/chippy/scripts/chippy-mcp.cjs"]
    }
  }
}
```

Node.js 22.12+ is required. The executable bundles its MCP dependencies and their
licenses; the installed skill needs no `npm install`. The Chippy npm library also
includes the `chippy-mcp` executable, usable after installing its local tarball.
Host configuration syntax varies; the example shows the command and arguments
that the host must launch, not a file Chippy installs into your host.

Start with `chippy_status`, then `chippy_pages`. Select a page by URL and title,
read `chippy_snapshot`, and inspect the relevant probe or find components directly.
A ready helper with `browserConnected: false` means enable Chippy on a browser page,
not restart the server. The skill's replay, stimulus, evidence, and edit rules apply
to MCP calls exactly as they do to CLI calls.

## Helper lifecycle and sandbox behavior

- New helpers bind to `127.0.0.1:7823`. Set `CHIPPY_HELPER_PORT` in the MCP process
  environment to use another port (integer 1–65535); configure the browser's helper
  URL to match. Set `CHIPPY_HELPER_HOST` (for example `0.0.0.0`) only when the
  browser must reach the helper over the network. The adapter always connects to
  loopback on that port.
- A matching helper version is reused. An incompatible response or occupied port
  produces a tool error; Chippy does not replace that process. Stop or upgrade it
  explicitly, or choose another port.
- The helper is a persistent shared service. Closing the MCP host/session closes
  the stdio adapter but leaves the helper, probes, and other sessions available.
  Default-port helpers can be stopped with the existing `chippy.sh stop` when no
  session needs them. Chippy does not kill other helpers on shutdown.
- `chippy_status` returns `helperUrl`, `startedPid` (the child started by this MCP
  process, otherwise null), `lifetime: "persistent"`, `browserConnected`, `pages`,
  `hint`, and `ok`. An empty page list is normal setup state.
- The MCP process needs host permission to launch Node and connect to the helper.
  MCP avoids reliance on the agent's shell sandbox only when the host launches
  MCP servers with suitable access. It cannot bridge an isolated container to a
  browser without networking/forwarding supplied by the environment.
- Logs use stderr; stdout contains only MCP messages. Requests are cancellable.
  Helper errors are returned as MCP tool errors, not as successful empty evidence.

The adapter reads the helper's access token from `~/.chippy/helper-<port>.token`
(or `$CHIPPY_STATE_DIR`) on each request, so it keeps working after a helper
restart. `CHIPPY_HELPER_TOKEN` overrides the file. Reusing an existing helper does
not change its listening address.

## Tools

All page tools require `clientId`. Resolve it afresh after navigation. Optional
`timeoutMs` defaults to 5000 and accepts integers 1–60000, except annotation waits,
which default to 30000. Structured results preserve the existing helper response
and are also included as JSON text.

| Tool | Arguments and behavior |
| --- | --- |
| `chippy_status` | No arguments; starts/reuses helper and reports browser readiness. |
| `chippy_pages` | No arguments; lists connected pages. |
| `chippy_snapshot` | `clientId`, `refresh` (default false). Reads stored evidence; true requests an asynchronous refresh, so read again after the page responds. |
| `chippy_probe` | `clientId`, `probeId`, `view`, optional `ownerIndex`, `prop`, `parentLevel`, `max`, `timeoutMs`. Views: `dom`, `parents`, `boundaries`, `owners`, `props`, `prop-value`, `hooks`, `hooks-summary`. `prop-value` requires `prop`. `owners` uses the existing live-owner route and cached-snapshot fallback. |
| `chippy_find_fibers` | `clientId`, `filters`, optional `timeoutMs`. Filters: `name`, `file`, `prop`, `testid`, `text`, `max`. Returns current fibers; refresh ids after commits or HMR. |
| `chippy_inspect_fiber` | `clientId`, `fiberId`, `view`, optional `hookIndex`, `windowSize`, `max`, `timeoutMs`. Views: `props`, `owners`, `parents`, `boundaries`, `hooks`, `hooks-summary`, `structure`, `describe`, `explain`. `structure` requires `hookIndex`. Replay-capable views can execute component/hook bodies. |
| `chippy_avalanche` | `clientId`, `action`, optional fields described below. Uses the existing Avalanche command builder. |
| `chippy_interact` | `clientId`, `action`, `target`, optional `targetKind` (default `selector`; alternatives `probeId`, `fiberId`), `propName`, `args`, `ownerIndex`, `timeoutMs`. Actions: `click`, `prop-contract`, `invoke`, `schedule-update`. `targetKind` selects click resolution; other actions take a fiber id as `target`. `prop-contract` and `invoke` require `propName`; `invoke` forwards a JSON argument array. Name the stimulus before execution and prove callback contracts before invoking them. |
| `chippy_wait_annotation` | `clientId`, optional `timeoutMs` (default 30000, maximum 60000). Consumes one UI intent/comment, waits once, or returns normal `status: "timeout"`. Repeat only while the user-requested loop remains active; cancellation closes the HTTP long poll. |

Avalanche actions: `status`, `install`, `uninstall`, `clear`, `export`,
`export-last`, `hot-sources`, `commit-list`, `commit-peek`, `debug-hook`,
`describe-action`. `install` starts capture; `clear` resets evidence;
`uninstall` stops capture. Optional `options` contains `detectionMode`
(`stats`, `sources`, `amplifiers`, `full`), `historySize`, and `captureFibers`.
Analysis fields are `limit`, `count`, `top`, `by`, `commitId`, `include` (array),
`depth`, `maxItems`, `sourceId`, `hookIndex`, `window`, `actionId`, and `timeoutMs`.
Use captured ids for commit, hook, and action analysis. See the
[Avalanche reference](avalanche-detector.md) for result semantics.

Indices are nonnegative integers; limits, counts, maxima, and window sizes are
positive integers, except Avalanche's `window`, which permits zero. Fields apply
to their selected view/action; for example, owner selection does not apply to the
owner-chain list. These nine tools cover the main inspection, capture, and UI-intent
loop. The CLI remains available for recipes, snippets, reload/arm workflows,
state comparisons, and other commands not exposed here. MCP does not change those
contracts or modify agent-host lifecycle hooks.
