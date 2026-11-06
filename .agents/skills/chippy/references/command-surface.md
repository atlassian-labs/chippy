# Chippy command surface

For typed tools with automatic helper startup, use the [MCP adapter](mcp.md).
This page owns the CLI contract; MCP keeps that implementation available as an
alternative transport for the main inspection loop.

Map each task to the public shell command that owns it. Run `./scripts/chippy.sh help` from the skill directory for mechanical signatures and [command-output-formats](command-output-formats.md) for exact response shapes.

Every command that contacts the helper must run outside the agent sandbox. The agent runs the command; the user only controls visible browser actions when required.

## Recipe lookup

| Command | Purpose |
|---|---|
| `recipes <query...> [--limit N]` | Search the local grep-friendly task corpus without contacting the helper. It defaults to five results and accepts limits from 1 through 20. Each result includes an answer, completion signal, guardrail, and canonical deeper references. |

Use recipe search when the operation or recovery route is not already obvious. It streams `recipes.txt` rather than loading the corpus into memory and ranks exact, prefix, and one-edit typo matches with a small BM25-style scorer. Plain `rg '^id=.*term' references/recipes.txt` or `rg 'term' references/recipes.txt` remains available when deterministic textual matching is preferable.

## Runtime and connection

| Command | Purpose |
|---|---|
| `start`, `stop`, `health` | Own the local helper lifecycle and readiness check. `start` backgrounds itself and binds `127.0.0.1`; `start --host 0.0.0.0` binds wide only when the user asks for network access. `chippy.sh` always uses port 7823 and ignores `CHIPPY_HELPER_PORT`, so it cannot reach a helper that MCP started on another port. `start` honors `CHIPPY_HELPER_HOST`. Every command reads the token from `CHIPPY_HELPER_TOKEN`, or from `${CHIPPY_STATE_DIR:-~/.chippy}/helper-7823.token`. |
| `inject-url` | Print the classic `inject.js` URL to stdout, and the document-scoped reload warning plus the second required asset to stderr. `inject.js` alone installs Chippy without the bridge; load `avalanche.iife.js` after it, or prefer the single ESM import for new injection workflows. |
| `pages [slice]` | List currently connected pages. This is connection truth. |
| `recent-pages` | List the ten newest page activity records (hello, snapshot, focus/visibility/pointer, command) from helper memory, including pages that have since disconnected. Use it to trace a reload or navigation; it is not connection truth. |
| `page <clientId> [slice]` | Read one connected page with `minimal`, `standard`, or `full` detail. |
| `snapshot <clientId> [slice]` | Read the helper's latest stored snapshot for a page. Probe `intent` and `comment` survive `minimal`, `standard`, and `full` slices. |
| `request-snapshot <clientId>` | Ask the connected page to emit a fresh snapshot. |
| `wait <clientId> [timeoutSeconds]` | Consume the oldest queued user-attached probe annotation, or wait for the next one. Default 300 seconds; valid range 1–1800. This is one cancellable long poll and never changes host hooks or configuration. |
| `activate`, `deactivate` | Change Chippy activation state for one connected page. |
| `context-ui <clientId> <on\|off>` | Show or hide context-provider enrichment (for example Jira ownership and error-boundary fields) in the active probe UI, including Storybook marker cards. It defaults to `on`; this command changes the current connected page at runtime. |
| `ensure-probes`, `clear-probes` | Install or remove probe markers. Preserve probes while they remain evidence. |
| `show-status`, `hide-status` | Accepted for compatibility; the page renders no status text, so `show-status` shows nothing to the user. Connection state appears in the Chippy panel. Report progress in chat. |
| `command <type> [clientId]` | Generic command escape hatch. Prefer explicit subcommands. |

## Probe inspection

| Command | Purpose |
|---|---|
| `get-computed-style` | Read computed style for a resolved probe target or bounded parent/selector. |
| `probe-dom` | Read the exact DOM target, text, attributes, source, styles, and test-id boundary. |
| `probe-parents` | Read the `fiber.return` parent chain from a probe target. This is the production-safe fiber-walk command. |
| `probe-boundaries` | Read every Error/Suspense boundary from the probe target to the root, ordered inner → outer. |
| `probe-owners`, `probe-owner` | Read the React debug-build `_debugOwner` chain or one owner by positional index. On production builds the result falls back to the component parent chain and says so with `ownerStackKind: "parents"`. |
| `probe-props`, `probe-prop-value` | Read serializable props, reference identities, or one named prop at a chosen owner. |
| `probe-hooks`, `probe-hooks-summary` | Read the hook tree or its prepared compact summary. |

Start value traces with `probe-dom`, then owners, then props. Open the reported source location before searching the repository.

## Fiber inspection and active stimulus

| Command | Purpose |
|---|---|
| `find-fibers` | Find current fibers by component name, source file, prop, test-id, or text. |
| `fiber-state-capture`, `fiber-state-list`, `fiber-state-compare` | Retain compact fiber/prop fingerprints for two rendered states—even on different pages—and return only their bounded structural diff. |
| `page-boundaries` | Read the whole page as a nested Error/Suspense-only forest. Ordinary component fibers are removed while declarative-boundary containment is preserved. |
| `explain-component` | Return compact semantic text by default; use `--complexity` for the bounded complexity section or `--json` for the full transport payload. May use dispatcher replay, with status and warnings in the result. |
| `describe-component` | Return the detailed hook tree as plain text by default; use `--json` for the full transport payload. May use dispatcher replay and degrades to fiber-only evidence when replay is unavailable. |
| `inspect-fiber-hooks`, `inspect-fiber-hooks-summary` | Read detailed or compact hook data for one fiber. |
| `inspect-fiber-props`, `inspect-fiber-owners`, `inspect-fiber-parents`, `inspect-fiber-boundaries` | Read props, `_debugOwner`, `fiber.return` parent context, or the complete declarative-boundary chain for one remembered fiber after `explain-component` or `find-fibers` yields a `fiberId`. |
| `inspect-fiber-structure` | Return one hook and its neighboring folder structure; may use dispatcher replay and reports replay warnings. |
| `page-click` | Click exactly one resolved DOM target. Active stimulus; requires an anchor contract. |
| `fiber-prop-contract` | Inspect a function prop before invocation. Read-only. |
| `fiber-invoke` | Invoke one proven function prop, optionally with JSON arguments. Active stimulus. |
| `fiber-schedule-update` | Schedule one DevTools renderer update on a current composite fiber. Active stimulus; does not mutate a hook or prop. |

Run the [debug replay preflight](active-stimulus.md#debug-replay-preflight) before `explain-component`, `describe-component`, or `inspect-fiber-structure`.

Load [active-stimulus](active-stimulus.md) before an active command. A `fiber:*` token lives in the current page realm, but React may replace the current fiber after any commit. Re-run `find-fibers` after state changes, interactions, HMR, navigation, or reload instead of assuming a remembered token still points at the current alternate.

## Avalanche capture and analysis

| Command | Purpose |
|---|---|
| `avalanche-clear` | Clear capture history before a new bounded measurement. |
| `avalanche-status` | Read installation, capture, and commit-count state. |
| `avalanche-install`, `avalanche-recapture` | Install with fiber capture or reinstall and clear in one sequence. |
| `avalanche-arm`, `avalanche-disarm` | Control live interaction capture without reloading the page. |
| `reload-with-avalanche` | Arm, reload, wait, settle, and print initial-load evidence. |
| `avalanche-hot-sources` | Rank source families before opening commit detail. |
| `avalanche-commit-list` | Rank compact commits by a supported signal. |
| `avalanche-commit-peek` | Join bounded detail for one commit. |
| `avalanche-describe-action` | Expand one action breadcrumb and its owner/parent context. |
| `avalanche-debug-hook` | Interrogate one captured `sourceId + hookIndex`. |
| `avalanche-export` | Return the full export, optionally written to a file; `lastN` does not trim it. Use `avalanche-save ... N` for the last N commits. Do not open this first. |
| `avalanche-save` | Save a full or bounded export for repeated offline analysis. |
| `avalanche-offline` | Run `summary`, `commit-list`, `commit-peek`, `hot-sources`, `describe-action`, or `source-search --name` over a saved export; shapes match the live commands. |

### Capture modes

| Mode | Use it for | Boundary |
|---|---|---|
| `sources` | Default source and commit attribution; rendered components with prop changes and `isSelfSource` | `trasherCounts` stay zero |
| `full` | Everything in `sources` plus amplifier (`trasherCounts`) evidence | Higher collection cost |
| `stats` | Aggregate capture statistics; rendered components with prop changes | No source tracking: `isSelfSource` stays false |
| `amplifiers` | Same capture as `full` | Alias kept for compatibility |

`avalanche-arm` and `reload-with-avalanche` also accept `captureFibers=true|false`. Keep it `true` when debug-hook or fiber-backed analysis may follow.

### Commit selectors

`avalanche-commit-list` live `by` values are `collateral`, `sources`, `restarts`, `performedWork`, `effects`, `memos`, `callbacks`, `contextUpdates`, `unmountedComponents`, and `unmountedSubtrees`.

`avalanche-commit-peek` live `include` values are `stats`, `sources`, `timing`, `metrics`, `unmounts`, `actions`, and `rendered`; `atl` is a deprecated alias of `metrics`. `rendered` works in every mode; `trasherCounts` in it need `full` or `amplifiers`. `timing` returns `startTime` and `endTime` on the page's `performance.now()` clock, plus `timeSinceLastCommit` and `detectorOverhead`.

Load [avalanche-detector](avalanche-detector.md) for schemas and evidence-reading rules.

## Snippets, navigation, and automation

| Command | Purpose |
|---|---|
| `eval-snippets` | List packaged snippets. |
| `eval-page` | Execute one packaged or local snippet in the connected page realm with `--key value` arguments. |
| `page-reload`, `page-wait-reload` | Request a reload and wait for the helper's reconnect transition. For a Storybook integration, `page-reload` emits `FORCE_REMOUNT`, remounting only the current SUT without navigating the preview iframe; it fails with HTTP 409 when no rendered story matches the selection. |
| `handoff-to-playwright` | Launch a helper-owned Playwright browser on the page URL with the selected probe descriptors, register it as a helper client, and return the new `targetClientId`. |
| `proxy-state`, `proxy-start`, `proxy-stop` | Inspect or control the helper's local proxy. |

`eval-page` has a fixed five-second page-script timeout through the shell wrapper. The helper HTTP API accepts a timeout field, but `chippy.sh eval-page` does not expose a timeout option.

## Full signatures

```text
start | stop | health | inject-url
recipes <query...> [--limit N]
pages [slice] | recent-pages | page <clientId> [slice]
snapshot <clientId> [slice] | request-snapshot <clientId>
wait <clientId> [timeoutSeconds]
activate <clientId> | deactivate <clientId>
context-ui <clientId> <on|off>
ensure-probes <clientId> | clear-probes <clientId>
show-status <clientId> <text> | hide-status <clientId>
command <type> [clientId]
get-computed-style <clientId> <probeId> [parentLevel] [selector]
probe-dom <clientId> <probeId> [parentLevel]
probe-parents <clientId> <probeId> [max]
probe-boundaries <clientId> <probeId> [max]
probe-owners <clientId> <probeId>
probe-owner <clientId> <probeId> <ownerIndex>
probe-props <clientId> <probeId> [ownerIndex]
probe-prop-value <clientId> <probeId> <propName> [ownerIndex]
probe-hooks <clientId> <probeId>
probe-hooks-summary <clientId> <probeId>
page-click <clientId> <selector|probeId|fiberId>
fiber-prop-contract <clientId> <fiberId> <propName>
fiber-invoke <clientId> <fiberId> <propName> [--args JSON]
fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]
find-fibers <clientId> [--name regex] [--file regex] [--prop name] [--testid regex] [--text regex] [--max N]
fiber-state-capture <clientId> [label] [maxFibers]
fiber-state-list
fiber-state-compare <beforeCaptureId> <afterCaptureId> [maxChanges]
page-boundaries <clientId> [max]
inspect-fiber-hooks <clientId> <fiberId>
inspect-fiber-hooks-summary <clientId> <fiberId>
inspect-fiber-props <clientId> <fiberId>
inspect-fiber-owners <clientId> <fiberId>
inspect-fiber-parents <clientId> <fiberId> [max]
inspect-fiber-boundaries <clientId> <fiberId> [max]
inspect-fiber-structure <clientId> <fiberId> <hookIndex> [windowSize]
describe-component <clientId> <fiberIdOrName> [--text|--json]
explain-component <clientId> <probeId|fiberId|name> [--text|--json|--complexity]
avalanche-clear <clientId>
avalanche-status <clientId>
avalanche-export <clientId> [lastN] [outFile]
avalanche-hot-sources <clientId> [limit]
avalanche-commit-list <clientId> [top] [by]
avalanche-commit-peek <clientId> <commitId> [include] [depth] [maxItems]
avalanche-describe-action <clientId> <actionId>
avalanche-install <clientId> [detectionMode]
avalanche-recapture <clientId> [detectionMode]
avalanche-debug-hook <clientId> <sourceId> <hookIndex> [window]
avalanche-save <clientId> <file> [count]
avalanche-offline <file> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search> [args...]
eval-page <clientId> <snippet-file-or-name> [--key value ...]
eval-snippets
avalanche-arm <clientId> <origin> [maxCommits] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]
avalanche-disarm <clientId> <origin>
page-reload <clientId>
page-wait-reload <clientId> [timeoutMs]
reload-with-avalanche <clientId> <origin> [maxCommits] [timeoutMs] [settleMs] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]
handoff-to-playwright <clientId> [url] [probeIdsCsv] [browserName] [headless]
proxy-state | proxy-start <targetPort> [originalUrl] | proxy-stop
```
