# Mode A injection contract — Playwright-controlled browser without the extension

Mode A is the Chippy/Avalanche injection path used when there is **no browser extension** — Playwright opens a browser, navigates a page, and the test runner is responsible for everything the extension would normally do in Mode B. Skipping a step silently degrades capture quality — usually shows up as `commitCount: 0`, `integrationMode: "none"`, or empty `commitStats`.

## When this applies

- Headless verification under Vitest/Playwright/CI
- Agent-side automation that opens its own Chromium
- Any environment where the Chippy extension is **not** installed in the browser

If the user is using their own browser with the extension, this contract does NOT apply — the extension's `webNavigation.onCommitted` + `chrome.scripting.executeScript` path handles everything below.

## Required bootstrap and install order

Mode A has two supported runtime-loading variants. Both end with the same explicit detector install.

1. **Install the DevTools hook shim before navigation.** Use `page.addInitScript({ content: DEVTOOLS_HOOK_SHIM })` before `page.goto(...)`.
   React-DOM checks `__REACT_DEVTOOLS_GLOBAL_HOOK__` at module-evaluation time. Installing the shim after navigation = no `currentDispatcherRef` = `replayComponentHooks` collapses to fiber-only fallback. The shim file is shipped with the Chippy skill at `extension/devtools-hook-shim.js`; the helper serves it at `/__chippy/devtools-hook-shim.js` (load that contents into the init script).
2. **Load the Chippy and Avalanche runtimes using one variant:**
   - **Packaged session loader:** call `installHelpers(page, { init: true })` before `page.goto(...)`. It registers the shipped helper scripts as init scripts, so they return on every navigation.
   - **Ad-hoc / playwright-cli:** navigate first, then import `http://127.0.0.1:7823/__chippy/inject.mjs` (preferred), or add `inject.js` followed by `avalanche.iife.js`. The classic `inject.js` is intentionally split; bridge commands return `bridge module not loaded` until the IIFE is present.
3. **Wait for the page client in `chippy.sh pages`.** A loaded global is not connection proof.
4. **Run `chippy.sh avalanche-install <clientId>`.** Loading either runtime does not auto-install the detector in Mode A.
   Auto-install is gated on `__CHIPPY_STARTUP_CONFIG.avalanche.autoStart`, which is written by the extension's MAIN-world script in Mode B. Neither Mode A loader writes that startup configuration, so both must trigger install explicitly.

## On reload (`page.reload(...)`)

- Init scripts survive reload. The packaged loader restores its runtimes automatically; the ad-hoc variant must load them again.
- Both variants receive a new client and detector instance. Re-resolve the client, then repeat the explicit install.

## Boot-time commit loss — known limitation

The ad-hoc `addScriptTag` variant loads the runtimes after page code. The packaged init-script variant loads them before page code, but its detector still remains uninstalled until the helper observes the new client and sends the explicit install.

Any React commit that fires between page mount and your `avalanche-install` call is **invisible to Avalanche**. This includes:
- initial mount
- `useEffect` cleanup teardowns
- Suspense fallback → content swaps
- route transitions on first paint

**Workaround:** stories under test must expose a manual trigger (e.g. `window.__triggerSwap()`) that you call AFTER `avalanche-install`. Document this trigger in the test fixture so the test reads end-to-end.

## Failure signatures

| Symptom | Likely cause |
|---|---|
| `commitCount: 0`, `integrationMode: "none"` | explicit detector install was skipped, or no commit occurred afterward |
| `commitCount > 0` but `unmountedComponents: 0` despite expected unmounts | unmounts happened before detector install; trigger them post-install |
| `bridge module not loaded` from `find-fibers` / `describe-component` | classic bootstrap omitted `avalanche.iife.js` |
| `replayComponentHooks` returns flat fiber-only data, no custom-hook folders | DevTools hook shim was skipped or installed after navigation |
| `coverage > 100%` in `meta.memoizedUpdatersSupport` | early commits missed (this is the boot-time gap, not a wiring bug) |

## Verifying that capture worked

- `chippy.sh avalanche-status <clientId>` → expect `installed: true`, `commitCount > 0`, and `integrationMode` matching the host (`adapter:atl` for a patched Atlassian host, `devtools` otherwise; earlier releases report `atl`), never `none` after a captured commit.
- In `avalanche-export`, compare `meta.commits` vs `meta.memoizedUpdatersSupport.commitsWithData` — they should match. If `commitsWithData > meta.commits`, early commits were missed.
- For end-to-end behavior, build a CONTROL test (trigger after install — must capture) AND a GAP test (trigger before install — documents the limitation) per fixture.

## Mode B reference (for contrast)

In Mode B, the extension does the following automatically and silently for every navigation:
1. `webNavigation.onCommitted` fires
2. Background fetches `armedAvalanche` config from helper
3. `chrome.scripting.executeScript({ injectImmediately: true, world: 'MAIN' })` runs the early scripts (`devtools-hook-shim.js`, `avalanche.iife.js`, `early-bootstrap.js`) before any page script evaluates
4. iife.ts reads `__CHIPPY_STARTUP_CONFIG.avalanche.autoStart` and self-installs
5. `chrome.tabs.onUpdated` (`status === 'complete'`) injects late bundle scripts (bridge + probes)

The supported Mode A loaders do not provide the extension's pre-page `autoStart` configuration. They install only after client connection; that post-connection detector start is the structural reason for the boot-time gap.
