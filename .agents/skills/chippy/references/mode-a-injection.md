# Mode A injection contract — Playwright-controlled browser without the extension

Mode A is the Chippy/Avalanche injection path used when there is **no browser extension** — Playwright opens a browser, navigates a page, and the test runner is responsible for everything the extension would normally do in Mode B. Skipping a step silently degrades capture quality — usually shows up as `commitCount: 0`, `integrationMode: "none"`, or empty `commitStats`.

## When this applies

- Headless verification under Vitest/Playwright/CI
- Agent-side automation that opens its own Chromium
- Any environment where the Chippy extension is **not** installed in the browser

If the user is using their own browser with the extension, this contract does NOT apply — the extension's `webNavigation.onCommitted` + `chrome.scripting.executeScript` path handles everything below.

## Required bootstrap and install order

Mode A has two runtime-loading variants that end with the same explicit detector install. To record the initial load, use [pre-page start-up](#pre-page-start-up) instead; it installs the detector before React on every document.

1. **Install the DevTools hook shim before navigation.** Use `page.addInitScript({ content: DEVTOOLS_HOOK_SHIM })` before `page.goto(...)`.
   React-DOM checks `__REACT_DEVTOOLS_GLOBAL_HOOK__` at module-evaluation time. Installing the shim after navigation = no `currentDispatcherRef` = `replayComponentHooks` collapses to fiber-only fallback. The shim file is shipped with the Chippy skill at `extension/devtools-hook-shim.js`; the helper serves it at `/__chippy/devtools-hook-shim.js` (load that contents into the init script).
2. **Load the Chippy and Avalanche runtimes using one variant:**
   - **Packaged session loader:** call `installHelpers(page, { init: true })` before `page.goto(...)`. It registers the shipped helper scripts as init scripts, so they return on every navigation.
   - **Ad-hoc / playwright-cli:** navigate first, then import `http://127.0.0.1:7823/__chippy/inject.mjs` (preferred), or add `inject.js` followed by `avalanche.iife.js`. The classic `inject.js` is intentionally split; bridge commands return `bridge module not loaded` until the IIFE is present.
3. **Wait for the page client in `chippy.sh pages`.** A loaded global is not connection proof.
4. **Run `chippy.sh avalanche-install <clientId>`.** Loading either runtime does not auto-install the detector in Mode A.
   Auto-install is gated on `__CHIPPY_STARTUP_CONFIG.avalanche.autoStart`, which is written by the extension's MAIN-world script in Mode B. Neither loader above writes that startup configuration, so both must trigger install explicitly.

## Pre-page start-up

Use this variant when the agent must record the initial page load without the extension. It writes the startup configuration that the extension writes in Mode B, then adds the early scripts and the page bridge as init scripts. Every document, including each reload, installs Avalanche before React DOM evaluates.

Register the init scripts before `page.goto(...)`, in this order. The files ship in this skill's `extension/` folder:

```js
const read = (file) => fs.readFileSync(path.join(skillDir, 'extension', file), 'utf8');

await page.addInitScript(() => {
  globalThis.__CHIPPY_STARTUP_CONFIG = {
    enabled: true,
    helperBaseUrl: 'http://127.0.0.1:7823',
    avalanche: { autoStart: true },
  };
});
await page.addInitScript({ content: read('devtools-hook-shim.js') });
await page.addInitScript({ content: read('avalanche.iife.js') });
await page.addInitScript({ content: read('early-bootstrap.js') });
await page.addInitScript({
  content: ['inspect-react.js', 'panel-dom.js', 'layout-lab.js', 'resolve-probes.js', 'chippy-page-bridge.js']
    .map(read)
    .join('\n'),
});
await page.goto(url);
```

- Skip the explicit `avalanche-install`; the detector is already installed and recording. `avalanche.options` accepts `detectionMode` and `captureFibers`, and `avalanche.max` sets the history size.
- To capture a load, call `page.reload()` and let the page settle. Do not call `avalanche-reset` between the reload and the read; it clears the boot commits.
- Read the capture with `chippy.sh avalanche-status <clientId>` and `avalanche-export` once the reloaded page appears in `chippy.sh pages`. If the client has not reconnected yet, read `window.__AVALANCHE__.exportLast()` in the page (see [`window.__AVALANCHE__`](browser-runtime-api.md#window__avalanche__)).

## On reload (`page.reload(...)`)

- Init scripts survive reload. The packaged loader restores its runtimes automatically; the ad-hoc variant must load them again.
- The client id is kept in the tab's `sessionStorage`, so the reloaded page normally reconnects under the same id (`page-wait-reload` reports `reloaded: true`). The connection and the detector are new: repeat the explicit install.
- If the runtimes are not loaded again, the page never reconnects: `page-wait-reload` reports `reloaded: false`, and `reload-with-avalanche` exits with an error instead of reading status from a client that no longer exists.

## Boot-time commit loss in the packaged and ad-hoc variants

This limit does not apply to [pre-page start-up](#pre-page-start-up). The ad-hoc `addScriptTag` variant loads the runtimes after page code. The packaged init-script variant loads them before page code, but its detector still remains uninstalled until the helper observes the new client and sends the explicit install.

Any React commit that fires between page mount and your `avalanche-install` call is **invisible to Avalanche**. This includes:
- initial mount
- `useEffect` cleanup teardowns
- Suspense fallback → content swaps
- route transitions on first paint

**Workaround:** use [pre-page start-up](#pre-page-start-up), or trigger the transition from the page after `avalanche-install`.

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
- To tell the boot-time gap from a wiring fault, repeat the interaction after install. If that capture is also empty, the injection is broken; if only the pre-install interaction is missing, use [pre-page start-up](#pre-page-start-up).

## Mode B reference (for contrast)

In Mode B, the extension does the following automatically and silently for every navigation:
1. `webNavigation.onCommitted` fires
2. Background fetches `armedAvalanche` config from helper
3. `chrome.scripting.executeScript({ injectImmediately: true, world: 'MAIN' })` runs the early scripts (`devtools-hook-shim.js`, `avalanche.iife.js`, `early-bootstrap.js`). Because steps 2–3 wait on network lookups, a fast page can evaluate React first.
4. iife.ts reads `__CHIPPY_STARTUP_CONFIG.avalanche.autoStart` and self-installs
5. `chrome.tabs.onUpdated` (`status === 'complete'`) injects late bundle scripts (bridge + probes)

For a helper reload of an armed page (`page-reload` after `avalanche-arm`, as in `reload-with-avalanche`), the page bridge first stores the arm in `sessionStorage` and the extension registers the early scripts plus `startup-handoff.js` as a MAIN-world `document_start` content script for that one navigation. The next document installs Avalanche before any page script runs, so boot commits are captured. The reload ack's `earlyStartup` is `registered` when this path was prepared.

The packaged and ad-hoc Mode A loaders do not provide the extension's pre-page `autoStart` configuration. They install only after client connection; that post-connection detector start is the structural reason for their boot-time gap. Pre-page start-up writes the configuration itself and has no such gap.
