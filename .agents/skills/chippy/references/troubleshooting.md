# Troubleshooting

## Helper is down
- `/__chippy/health` fails
- no pages in `/__chippy/api/pages`
- the Storybook Chippy and Avalanche panels conditionally offer `npx skills add atlassian-labs/chippy --skill chippy -g` while their connection state is `failed` or `reconnecting`
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

## No connected pages
- extension may not be installed
- origin may not be enabled
- page may not have been reloaded after enabling
- page may have failed to load `/__chippy/inject.js`
- do not search Chippy's own source code to answer live questions like "where is p1?"
- instead, explain that there is no live probe state yet and help the user connect or reload the target page

## Bundle failed to load
- page exists but helper status or page status shows `load-error`
- check the helper URL configured in the extension
- check the page network tab for `inject.js`

## Page reloaded and probes disappeared
- expected after full reload/navigation
- if the origin is still enabled, Chippy should reappear automatically after reload completes

## Production page
- neither React <=18 `_debugSource` nor React 19 `_debugStack` source evidence is available
- rely on component names, stacks, notes, and cross-source hints
- be explicit with the user that source precision is weaker

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
