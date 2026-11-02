# Runtime validation

Repository paths in this reference are relative to the repository root.

## Avalanche debug-render — local validation note

`debugHook(sourceId, hookIndex)` inspects one component's hook structure without scheduling an app update. In Playwright validation, preload Avalanche before navigation and validate `debugHook` directly against a captured `sourceId`; late `addScriptTag` checks only late-injection behavior and are not valid debug-render validation.

Keep implementation details in Avalanche source, not workspace memory.

## Bridge ↔ bundle dependency

The extension shell `chippy-page-bridge.js` carries shim functions that delegate to TypeScript modules bundled into `avalanche.iife.js` (entry: `src/iife.ts`). The shim layer is intentionally thin: shims hold no real implementation, only a `getBridge()` lookup against `window.__AVALANCHE__.bridge` plus minimal-degradation fallbacks.

Implications for any environment that uses the bridge:

- **Browser extension path** — the extension injects `avalanche.iife.js` via `chrome.scripting.MAIN` (see `background.js LATE_BUNDLE_SCRIPTS`) **before** `chippy-page-bridge.js`. Bridge shims always resolve.
- **Playwright tests** — `inject.js` (helper bundle) does **not** include `avalanche.iife.js`. The helper-served bundle is intentionally split so callers control Avalanche injection. Tests that exercise bridge commands (`find-fibers`, `describe-component`, `evalAvalanche`, `safeJson`, etc.) MUST also `addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' })` after `inject.js`. See `openInjectedPage` in `src/__tests__/chippy-headless.test.ts` and `src/__tests__/chippy-capabilities.test.ts` for the pattern.
- **DevTools-hook shim** — install via `addInitScript({ content: DEVTOOLS_HOOK_SHIM })` **before** `page.goto(...)`. React-DOM checks `__REACT_DEVTOOLS_GLOBAL_HOOK__` at module evaluation time; installing after navigation = no `currentDispatcherRef` = `replayComponentHooks` collapses to fiber-only fallback. The shim file is at `.agents/skills/chippy/extension/devtools-hook-shim.js` and the helper serves it at `/__chippy/devtools-hook-shim.js`.
- **Failure signature** — when the bridge module is missing, every shim returns its declared fallback shape, e.g. `{ count: 0, items: [], error: 'bridge module not loaded' }`. If a test sees this string, the cause is missing `avalanche.iife.js` injection, not a logic bug.
- **Bundle source of truth** — never duplicate a function body in `chippy-page-bridge.js`. If a function needs to live in the bridge, write a one-line shim and put the implementation in `src/chippy-bridge/*` or `src/debug-render/*`. Run `yarn avalanche:sync` to rebuild + copy `dist/avalanche.iife.js` into the extension.
