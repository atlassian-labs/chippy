# Troubleshooting

## Helper is down
- `/__chippy/health` fails
- no pages in `/__chippy/api/pages`
- the Storybook Chippy and Avalanche panels conditionally offer `npx skills add atlassian-labs/chippy --skill chippy -g` while their connection state is `failed` or `reconnecting`
- the in-page Chippy panel header shows `● helper unavailable` (red) or `● reconnecting` (yellow) instead of `● connected`; hover it to see the helper URL the page is trying to reach
- `health`, `pages`, `recent-pages`, `page`, and `proxy-state` print only curl's raw error (for example `curl: (7) Failed to connect`) instead of the structured helper explanation; exit code 7 means the helper is not running, and 22 means it rejected the request (for example a 401 token mismatch)
- Chippy must run outside the agent sandbox; the agent owns this, not the user
- sandbox failure mode: the helper can look alive inside the agent environment, but the browser cannot reach its isolated Node server/port
- fix: agent runs `./scripts/chippy.sh start` using outside-sandbox / escalated execution, then verifies with `./scripts/chippy.sh health` and `./scripts/chippy.sh pages` (also outside-sandbox)
- do not ask the user to open a terminal to start the helper; that is a last-resort fallback only if outside-sandbox execution is genuinely unavailable
- do not try helper-contacting commands inside the sandbox first; `start`, `stop`, `health`, `pages`, `page`, snapshots, probes, fiber inspection, live avalanche commands, `eval-page`, page reload/wait, and proxy commands all need access to the real `127.0.0.1:7823`
- allowlisting the Chippy wrapper in any agent runner that supports it is helpful but not enough; helper-contacting `chippy.sh` commands must still run outside the sandbox on every attempt that needs `127.0.0.1:7823`
- allowlist the absolute install path of `chippy.sh` on this machine if the runner supports it

## Helper returns 401 or 403
- 401: command routes require the helper's access token; `chippy.sh`, MCP, and the Playwright probes send it automatically
- the running helper writes its token to `~/.chippy/helper-7823.token` (or `$CHIPPY_STATE_DIR`); a missing or stale file usually means another process holds the port or the file was removed
- fix: `./scripts/chippy.sh stop`, then `./scripts/chippy.sh start` (outside the sandbox), so the new helper writes a fresh token
- custom HTTP clients send the token as the `X-Chippy-Token` header
- 403: the request's `Host` is not a loopback name; use `127.0.0.1` or `localhost`, or start the helper with `CHIPPY_HELPER_ALLOWED_HOSTS` set to the forwarded name
- browser on another machine (remote dev environment, container): the helper binds `127.0.0.1` by default; use an SSH tunnel, or ask for a wide bind with `./scripts/chippy.sh stop` then `./scripts/chippy.sh start --host 0.0.0.0`

## Helper returns 504
- the helper delivered the command to the page but no reply arrived before its wait ran out; the page may be busy, mid-reload or navigation, or no longer reading messages
- `chippy.sh` prints `observed: http_status=504`, a `next:` hint to try lighter round trips, and exits 22; the `error:` line names the wait that expired:

| `error` | Commands | Default wait | How to change it |
| --- | --- | --- | --- |
| `Timeout waiting for eval-script result` | `eval-page` | `scriptTimeoutMs` + 3000 ms (8000 ms by default) | `eval-page ... --script-timeout <ms>`, up to 120000 |
| `Timeout waiting for avalanche result` | `avalanche-*` | 5000 ms; `avalanche-export`, `avalanche-save`, and `ab-capture` use 60000 ms | `timeoutMs` in the request body; MCP accepts up to 60000 |
| `Timeout waiting for eval-probe result` | probe inspection (not `probe-owners`), `inspect-fiber-*`, `find-fibers`, `page-boundaries`, `describe-component`, `explain-component` | 5000 ms; `ab-capture` uses 30000 ms for its fiber state | `timeoutMs` in the request body; MCP accepts up to 60000 |
| `Timeout waiting for probe command result` | `page-click`, `fiber-invoke`, `fiber-schedule-update`, `fiber-prop-contract`, `fiber-state-capture`, `fiber-state-compare` | 10000 ms | `timeoutMs` in the request body; MCP accepts up to 60000 for click and invoke |
| `Timeout waiting for computed style result` | `get-computed-style` | 5000 ms | `timeoutMs` in the request body |
| `Timeout waiting for reload ack` | `page-reload` | 1500 ms, fixed | none |

- first check that the page still answers a light request: `./scripts/chippy.sh pages`, then `./scripts/chippy.sh request-snapshot <clientId>`; if it does not, pick the current client from `pages` or reconnect the page (see "No connected pages")
- if light requests succeed and only a heavy command times out, make it smaller (a bounded `avalanche-save <clientId> <file> <count>`, or `find-fibers` with a smaller `--max` or `--depth`) or give it a larger timeout
- a script that outruns its own `--script-timeout` is not a 504: the helper answers 200 with `timedOut: true` and an `error` containing `script timeout after <ms>ms; the script may still be running in the page`, and `eval-page` exits 1
- after a `reload ack` 504 the page may still reload; run `page-wait-reload <clientId> [timeoutMs]` before reloading again; a 409 means the page answered and refused
- `probe-owners` does not return 504; on a live timeout it answers from the last snapshot with `source: "snapshot"`, or with `ok: false` when no snapshot holds the probe
- a page whose runtime is older than the helper ignores command types it does not know, which also surfaces as a 504; see "Page runtime is older than the helper"

## Helper request fails with a curl exit code
- `health`, `pages`, `recent-pages`, `page`, and `proxy-state` call curl directly with `-fsS`: they print only curl's line (for example `curl: (7) Failed to connect`), drop the helper's JSON error body, and exit with curl's code
- other helper commands, except `start` and `stop`, print `Chippy helper request failed.` with `observed:`, `meaning:`, and the helper's `error`, `hint`, and `next` fields; any HTTP status of 400 or higher exits 22
- `chippy.sh` sets no curl timeout; the helper owns page round-trip timeouts and reports them as HTTP 504. `wait` is a long poll that holds the request for up to `timeoutSeconds` (default 300, at most 1800); `status: "timeout"` from it is an empty result, not a failure

| What you see | Meaning | Recovery |
| --- | --- | --- |
| `curl_exit=7` or `curl: (7) Failed to connect` | Nothing answered on `127.0.0.1:7823`: the helper is not running, or the command ran inside the sandbox | Outside the sandbox: `./scripts/chippy.sh start`, then `health` |
| `curl_exit=28` | curl hit a time limit of its own (its connect timeout, or a `max-time` in a curl config file such as `~/.curlrc`) | Retry once, then check `pages` and `request-snapshot <clientId>` |
| `curl_exit=52` or `curl_exit=56` | The connection closed without a response, usually because the helper exited or restarted | Run `health`; if it fails, `stop` then `start`, and retry |
| `http_status=504` | The helper is up but the page did not answer in time | See "Helper returns 504" |
| `http_status=401`, or `curl: (22) ... error: 401` from `page`, `recent-pages`, or `proxy-state` | Token mismatch | See "Helper returns 401 or 403" |
| other `http_status=4xx` or `5xx` (exit 22) | The helper rejected or failed the request | Follow the printed `error`, `hint`, and `next`; when a direct-curl command printed only `curl: (22)`, run a wrapper command such as `snapshot <clientId>` to see the helper's message |
| `Failed to start Chippy helper.` | `/health` did not answer about 10 s after launch; the helper's own output is discarded | Rerun `start` outside the sandbox; if it still fails, run the helper in the foreground to see its startup error |
| `Timed out waiting for Chippy helper to stop` | `/health` still answered about 5 s after `stop` | Run `health` to see what holds port 7823, then `stop` again outside the sandbox |

## No connected pages
- extension may not be installed
- origin may not be enabled
- page may not have been reloaded after enabling
- the extension could not inject into the tab (restricted pages such as `chrome://` and the Chrome Web Store cannot be scripted)
- proxy route: open the page on `http://127.0.0.1:7823<path>`, not on the dev server's port; `proxy-state` must show a non-null `injectTarget` whose `pathname` (and `search`, when set) matches the opened address; otherwise restart with `proxy-start <targetPort> <originalUrl>`
- do not search Chippy's own source code to answer live questions like "where is p1?"
- instead, explain that there is no live probe state yet and help the user connect or reload the target page

## Iframe content is missing or an iframe has no client
- an iframe is a separate page: commands on the top page's client do not see or click inside it; use the iframe's own client from `pages`
- extension: enable the iframe's own origin; enabling the top page's origin does not cover a cross-origin iframe
- an iframe with an opaque origin (`about:srcdoc`, sandboxed without `allow-same-origin`) cannot be enabled by origin
- `page.frame.parentClientId` is `null` with `unconfirmedParentClientId` set: the parent frame has no Chippy client, or it has not confirmed the link yet; load Chippy in the parent frame too
- an iframe client is connected but shows no Chippy panel: this is the default for child frames; run `activate <clientId>` on that frame to show the panel and remember it for that frame's address. The choice is stored in the frame's `localStorage`, so a fresh browser profile or a frame without storage starts hidden again

## Bundle failed to load
- extension: the extension injects its packaged scripts, not `inject.js`; check the page console for `[chippy-ext]` injection errors, check the helper URL configured in the extension, then reload the page
- script tag, console import, or Playwright bootstrap: check the page network tab for `/__chippy/inject.js`, `/__chippy/inject.mjs`, or `avalanche.iife.js`, and check the page's CSP
- `import()` rejects with `Chippy runtime already owned by ...`: another integration (for example the Storybook addon) already owns the page; use its client from `pages`

## Bridge connected but the Avalanche runtime is missing
- the page has the Chippy bridge but not the Avalanche runtime, so probes, fiber reads, `find-fibers`, state capture, replay, and Avalanche commands have no implementation
- probe and fiber commands answer HTTP 503: `chippy.sh` prints `error: bridge module not loaded` and a `hint:` naming `avalanche.iife.js`, then exits 22
- `avalanche-*` commands answer HTTP 200 and exit 0, but `result.available` is `false` and `result.code` is `"bridge-module-missing"`; read that as a missing runtime, not an empty capture
- common causes: `inject.js` loaded by script tag without `avalanche.iife.js`, the page's CSP blocked the runtime, or the runtime failed to load (see "Bundle failed to load")
- fix: import `/__chippy/inject.mjs`, or reload a page managed by the extension or proxy (ask before reloading); confirm with `./scripts/chippy.sh avalanche-status <clientId>`
- `extension asset not found: avalanche.iife.js` (HTTP 404; `avalanche.es.js` for `inject.mjs` imports): the running helper's install lacks the runtime bundle; `stop`, then `start` with the `chippy.sh` of a complete skill install (the helper serves files next to its own script, not the working directory)

## Avalanche runtime loaded but commit capture not installed
- a Chippy panel's Record button shows `Avalanche is not installed: reload with Avalanche first.` when commit capture was never installed in this document
- fix: `./scripts/chippy.sh avalanche-install <clientId>` without a reload, or `./scripts/chippy.sh reload-with-avalanche <clientId> <origin>` (ask before reloading)
- `reload-with-avalanche: the page did not reconnect within <ms>ms after the reload.`: Chippy did not load again in the new document; skip the reload (`avalanche-install`, trigger the interaction, then `avalanche-status`), or in an agent-driven Playwright browser load the runtimes as init scripts (`installHelpers(page, { init: true })`)

## Page runtime is older than the helper
- `Unknown avalanche action: <action>` or `debugHook() unavailable on __AVALANCHE__ API`: the page's runtime does not implement what the helper asked for, usually because it is older than the installed skill
- `report() unavailable`: the runtime has no `report()`, or `report()` returned nothing
- the page bridge ignores command types it does not know, so a newer command can surface as a 504 `Timeout waiting for ... result`; a busy or reloading page gives the same 504
- check `bridgeVersion` in `./scripts/chippy.sh pages`; update the extension to match the skill and reload the page
- `Client not found: <id>. Run 'pages' to see connected clients.` (HTTP 404): the page reloaded or navigated and its client id changed; use the current `clientId` from `pages`

## Debug-hook finds nothing
- `avalanche-debug-hook` answers `{ ok: true, payload }` whenever it reaches the page detector, so page-side failures are in `payload.ok` and `payload.error`
- `payload.error: 'not installed'` or `'debugHook unavailable'`: load the current Avalanche bundle, run `./scripts/chippy.sh avalanche-recapture <clientId>`, repeat the interaction, and retry
- `payload.error: 'sourceId not found'`: the id is not in the current capture; `avalanche-clear`, `avalanche-recapture`, and reset drop the sources, so read the id again with `avalanche-hot-sources` or `avalanche-commit-peek <clientId> <commitId> sources`
- `payload.error: 'hook event not found'` with `eventCount: 0`: no hook calls were recorded for that component; the recorder installs during the first commit Avalanche observes, so only later renders are recorded, and reset clears them; recapture, repeat the interaction, and read the source and index again
- `payload.error: 'hook event not found'` with `eventCount > 0`: the index points past the recorded calls (at most 600 per component); pick the index again, or reproduce the render that reaches the hook
- events match by component name, with a fallback to a partial name match; with minified names, check `componentName` against `resolvedComponentName`
- outer `ok: false` means the command did not reach the detector: `'__AVALANCHE__ not available'` (load the bundle, then `avalanche-install`), `'debugHook() unavailable on __AVALANCHE__ API'` (load the current bundle), or `'debug-hook requires sourceId and numeric hookIndex'` (pass both from the same capture)
- with `eventCount: 0`, read `payload.status.reason`; it covers all components, so it is absent when other components recorded calls:

| `status.reason` | Meaning | Next |
| --- | --- | --- |
| `no __REACT_DEVTOOLS_GLOBAL_HOOK__ on window` | The hook shim did not run before react-dom evaluated | Ask before reloading; load the page with the shim installed before navigation, then `avalanche-install` |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__ present but renderers Map is empty` | react-dom evaluated before the shim | Ask before reloading; reload with the shim installed first |
| `renderer registered but no currentDispatcherRef` | The renderer exposes no dispatcher reference | Fall back to commit evidence and `inspect-fiber-hooks-summary`; report that the hook could not be located |
| `debug-render not installed` | No commit ran since install, or the dispatcher could not be patched | Repeat the interaction; if it persists after commits, fall back to commit evidence |
| `capture engine installed but no hook events recorded yet` | No component rendered after the recorder installed | Repeat the interaction once and retry |

- frames stay minified: `sourceMaps.status: 'none'` means mapping threw (read the raw frames); a `failures` entry `timed out; still loading, retry` improves on retry; `script fetch failed`, `no sourceMappingURL`, `bad sourceMappingURL`, `source map fetch failed`, and `unreadable source map` are cached per script URL, so a retry returns the same failure; read `primitive`, frame `url`, and the neighborhood instead

## Debug replay is partial or fiber-only
- applies to `describe-component`, `inspect-fiber-structure`, and `explain-component`; read `replayStatus`, `replayError`, and `warnings`
- `Unknown fiberId: <id>`: the id is not in this page bridge's registry, which empties after a reload or bridge reinstall; get a fresh fiberId
- `No fiber matches name: <name>` (`describe-component`, `explain-component`): no live fiber has that name; find it with `find-fibers` or a probe
- `bridge module not loaded`: see "Bridge connected but the Avalanche runtime is missing"

| Signal | Meaning | Next |
| --- | --- | --- |
| `avalanche.iife.js not loaded`, `fiber-only-fallback` | The replay module is missing (`explain-component`) | Load the bundle; until then the result is fiber-only |
| `ReactCurrentDispatcher not found`, `fiber-only-fallback` | No renderer dispatcher reference was found, often because the shim was installed after react-dom evaluated | Ask before reloading with the shim installed first; otherwise treat the result as fiber-only |
| `React render in progress; refusing dispatcher swap` | Replay ran while React was rendering | Rerun when the page is idle |
| `Fiber type is not executable`, `partial-replay` | `fiber.type` is not a function (a host element, or a `forwardRef` or `memo` object) | For `memo`, target its child fiber; otherwise use the fiber-only hook records |
| `Hook cursor drift at slot <n>: expected <primitive> but fiber node is <tag>...` | The replayed hook kind does not match the stored hook; replay stops there | Trust records before slot `n`; align the rest with source hook order and report the gap |
| `Hook cursor exhausted at slot <n> for <primitive>` | Replay called more hooks than the fiber stores | Treat the result as partial; confirm the order in source |
| a `TypeError` naming a dispatcher method | The component calls a hook replay does not implement, such as `use` or React Compiler's `useMemoCache` | Use the records before the failure and the fiber-only summary; run `avalanche-debug-hook` for the call site |

- `inspect-fiber-structure` with `status: 'hook-not-found'` always reports `replayStatus: 'not-run-fiber-only'`; read `warnings` for the real replay error and compare the index with `liveHookCount`
- a remembered fiberId holds the exact fiber object; after the component unmounts it still resolves until the page reloads or the bridge is reinstalled, and replay reads that stale object without a warning; take a fresh fiberId for current state

## Page reloaded and probes disappeared
- expected after full reload/navigation
- if the origin is still enabled, Chippy should reappear automatically after reload completes

## Production page
- neither React <=18 `_debugSource` nor React 19 `_debugStack` source evidence is available
- the `_debugOwner` chain is absent; owner results fall back to the `fiber.return` parent chain and are labeled `ownerStackKind: "parents"`
- when the page serves source maps, Chippy recovers authored component names and adds `minifiedName` and `definition` (the authored definition file and line); see [Production component names](command-output-formats.md#production-component-names)
- without source maps, component names stay minified, and a minifier may drop them entirely; rely on names that survived, props, test IDs, parent chains, notes, and cross-source hints
- Avalanche report `sourceId`s use recovered names, but unmount samples and per-commit `rendered` names keep the name known when the commit was captured; match them by `sourceId`
- Avalanche commit capture still works when the DevTools hook was installed before React evaluated, so performance profiling remains available
- production React records no update owners, so Avalanche finds sources by comparing hook state with the previous commit; the first commit after Avalanche starts shows renders with `sources: 0`, so repeat the interaction before ranking sources
- be explicit with the user that source precision is weaker; if minified names block the investigation, suggest keeping `displayName`s or function names in the build (for example esbuild `keepNames`, Terser `keep_fnames`)

## React 19 source stays on a served-module URL
- `_debugStack` produced a project frame, but the page could not fetch the module or its source map
- the served URL and generated line remain as a bounded fallback; do not present them as a mapped repository position
- check that the page can fetch its own module URL and that the dev server emits an inline or external Source Map v3 payload

## React <=18 source line is offset from the file
- `_debugSource` records the line the JSX transform saw; a transform that ran earlier and added lines shifts it
- Chippy corrects the line when it can fetch the module the page loaded for that file and the module's source map maps the recorded literal back into the same file
- if the line still looks offset, check that the page loaded the module from its own origin and that the dev server emits a source map

## Multiple pages on same URL
- use `clientId`, title, `latestSnapshotAt`, and `lastMessageAt` to identify the right page
- usually prefer the most recently updated page when one candidate is clearly newer than the rest
- if the time gap is narrow, treat the target as ambiguous and ask rather than guessing
- after choosing a likely page, request a fresh snapshot to confirm it is the intended one
- on Storybook, a `pages` entry with `integration.kind: extension` is Storybook's own manager UI, and the addon panels show a warning while it is connected; select the `storybook` page and update the extension
