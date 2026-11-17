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
- **Post-install capture tests** — for end-to-end Avalanche behavior on an injected page, pair a CONTROL test (trigger after install; it must capture) with a GAP test (trigger before install; it documents the boot-time limitation) for each fixture.
- **Failure signature** — when the bridge module is missing, every shim returns its declared fallback shape, e.g. `{ count: 0, items: [], error: 'bridge module not loaded' }`. If a test sees this string, the cause is missing `avalanche.iife.js` injection, not a logic bug.
- **Bundle source of truth** — never duplicate a function body in `chippy-page-bridge.js`. If a function needs to live in the bridge, write a one-line shim and put the implementation in `src/chippy-bridge/*` or `src/debug-render/*`. Run `yarn avalanche:sync` to rebuild + copy `dist/avalanche.iife.js` into the extension.

## Measuring Chippy's own cost

The `Avalanche/StressLab` story renders about 7,000 component fibers per full
re-render. `bench/avalanche-stress.mjs` drives it in headless Chromium and
reports click time with and without Avalanche, detector overhead per commit,
page export size, and the time of `avalanche-export`, `avalanche-save`,
`avalanche-commit-list`, and `avalanche-timeline`. It needs Storybook on 6007
and the helper on 7823; set `PROFILE=1` for the top self-time functions
(native frames are shown with their caller).

Click time is reported to the commit and to the next frame. Avalanche measures
changed boxes inside the commit hook, which runs layout the browser would
otherwise run before paint, so compare Avalanche with React alone on `frame`.
`screenMeasureMs` is the part of detector overhead spent measuring boxes.

```bash
OPENSSL_CONF=/dev/null node bench/avalanche-stress.mjs 15
```
