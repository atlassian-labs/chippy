# Chippy with `playwright-cli`

Use this when there is no Chippy browser extension on the page (`playwright-cli` opens a vanilla Chromium).

## What is Chippy on the page

Chippy assets are served by the local Chippy helper:

- `http://127.0.0.1:7823/__chippy/inject.mjs` — **preferred ESM bootstrap**. Import side-effect installs `window.__CHIPPY`, registers the page with the helper, auto-loads `window.__AVALANCHE__` from the ESM-safe `avalanche.es.js` asset, activates probes immediately, and installs a small in-page control panel. The module default export is `window.__CHIPPY`; named export `ready` resolves to `{ chippy, avalanche, connState, integration, activated, probesActive }` immediately after bootstrap.
- `http://127.0.0.1:7823/__chippy/inject.js` — **classic-script bootstrap**. Installs `window.__CHIPPY` only.
- `http://127.0.0.1:7823/__chippy/avalanche.iife.js` — **Chippy runtime for bridge / Avalanche-backed commands**. Installs `window.__AVALANCHE__` when the classic bootstrap is used.

Both paths are Chippy. `playwright-cli` is only the transport that loads them into the page.

The same ESM bootstrap is also valid for a real user-controlled browser tab when the page allows helper-served module import:

```js
import('http://127.0.0.1:7823/__chippy/inject.mjs')
```

In that mode the import is intended to be extension-equivalent for the current page: it activates probes immediately and installs the in-page Chippy controls.

The equivalence lasts only for the current document. A full reload or navigation removes the imported runtime because no extension or Storybook host remains to inject it. The in-page import controls display this warning. The user—or Playwright—must run the import command again after every reload/navigation.

## Steps

1. Start the helper:

   ```bash
   ./scripts/chippy.sh start
   ./scripts/chippy.sh health
   ```

2. Open or reuse one `playwright-cli` Chromium session on the target URL.

3. Prefer the ESM bootstrap when module loading is available:

   ```bash
   yarn exec playwright-cli -s=<session> run-code "async page => {
     await page.addScriptTag({
       content: `
         const script = document.createElement('script');
         script.type = 'module';
         script.textContent = \"import 'http://127.0.0.1:7823/__chippy/inject.mjs';\";
         document.head.appendChild(script);
       `,
     });
     await page.waitForTimeout(700);
     return await page.evaluate(() => ({
       hasChippy: !!window.__CHIPPY,
       hasAvalanche: !!window.__AVALANCHE__,
       href: location.href,
     }));
   }"
   ```

   Fallback: classic script injection when ESM import is not available:

   ```bash
   yarn exec playwright-cli -s=<session> run-code "async page => {
     await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
     await page.waitForTimeout(500);
     await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
     await page.waitForTimeout(200);
     return await page.evaluate(() => ({
       hasChippy: !!window.__CHIPPY,
       hasAvalanche: !!window.__AVALANCHE__,
       href: location.href,
     }));
   }"
   ```

4. Confirm the page is connected:

   ```bash
   ./scripts/chippy.sh pages
   ```

   The connected page is the one whose URL matches the opened tab.

5. Before the first Avalanche capture or analysis command, install the detector explicitly:

   ```bash
   ./scripts/chippy.sh avalanche-install <clientId>
   ```

   Both bootstraps load the Avalanche runtime; neither auto-installs its detector in this extension-free mode. Probe, fiber, and describe commands need only the loaded runtime and connection. Avalanche commands additionally need this install step.

## Re-injection after reload

A full reload wipes both globals and the `import` integration does not return by itself. Re-run steps 3–5 with the same bootstrap path (`inject.mjs` preferred; `inject.js` + `avalanche.iife.js` fallback). In a user-controlled tab, ask the user to run the console import again, then install Avalanche through Chippy. Verify connection with `chippy.sh pages`, not by checking `window.__chippyPageBridge`.

## Common bridge failure

If a bridge / Avalanche command returns:

```text
bridge module not loaded
```

The cause is missing `avalanche.iife.js`. Inject it (step 3 second `addScriptTag`) and retry.

## Dispatcher replay ancestry (only when explicitly needed)

Dispatcher-based component-structure paths (`explain-component`, `describe-component`, and `inspect-fiber-structure`) need the devtools-hook shim installed **before React evaluates**. With `playwright-cli` that means `addInitScript` before navigation, using the helper-served shim at `http://127.0.0.1:7823/__chippy/devtools-hook-shim.js`. Run the debug replay preflight before those commands. `avalanche-debug-hook` is different: it reads hook events passively captured during real renders and does not execute component bodies. Ordinary bridge work does not need dispatcher replay.
