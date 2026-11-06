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

## No connected pages
- extension may not be installed
- origin may not be enabled
- page may not have been reloaded after enabling
- the extension could not inject into the tab (restricted pages such as `chrome://` and the Chrome Web Store cannot be scripted)
- proxy route: open the page on `http://127.0.0.1:7823<path>`, not on the dev server's port; `proxy-state` must show a non-null `injectTarget` whose `pathname` (and `search`, when set) matches the opened address; otherwise restart with `proxy-start <targetPort> <originalUrl>`
- do not search Chippy's own source code to answer live questions like "where is p1?"
- instead, explain that there is no live probe state yet and help the user connect or reload the target page

## Bundle failed to load
- extension: the extension injects its packaged scripts, not `inject.js`; check the page console for `[chippy-ext]` injection errors, check the helper URL configured in the extension, then reload the page
- script tag, console import, or Playwright bootstrap: check the page network tab for `/__chippy/inject.js`, `/__chippy/inject.mjs`, or `avalanche.iife.js`, and check the page's CSP
- `import()` rejects with `Chippy runtime already owned by ...`: another integration (for example the Storybook addon) already owns the page; use its client from `pages`

## Page reloaded and probes disappeared
- expected after full reload/navigation
- if the origin is still enabled, Chippy should reappear automatically after reload completes

## Production page
- neither React <=18 `_debugSource` nor React 19 `_debugStack` source evidence is available
- the `_debugOwner` chain is absent; owner results fall back to the `fiber.return` parent chain and are labeled `ownerStackKind: "parents"`
- component names may be minified; rely on names that survived, props, test IDs, parent chains, notes, and cross-source hints
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
