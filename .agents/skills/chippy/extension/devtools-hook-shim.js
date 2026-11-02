/* eslint-disable */
/**
 * DevTools-hook shim.
 *
 * Must be installed BEFORE react-dom evaluates. React-DOM checks for
 *   window.__REACT_DEVTOOLS_GLOBAL_HOOK__
 * at module evaluation time. If a hook with `inject(internals)` is present,
 * react-dom registers itself into hook.renderers, which exposes the
 * `currentDispatcherRef` that Avalanche debug-render needs to capture hook
 * call stacks.
 *
 * Without this shim in place at evaluation time, hook.renderers stays empty,
 * debug-render cannot patch the dispatcher, and `debugHook()` collapses to
 * a flat fallback (no custom-hook ancestry, no folders).
 *
 * Idempotent: never overwrites an existing real hook (e.g. real React DevTools
 * extension). Only installs an empty shim when nothing is there yet.
 *
 * Browser extension content-script and the local Playwright path both load
 * this script BEFORE the page bootstraps React.
 */
(function chippyDevtoolsHookShim(global) {
  try {
    if (global.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;

    var renderers = new Map();
    var hook = {
      __chippyShim: true,
      supportsFiber: true,
      renderers: renderers,
      inject: function inject(renderer) {
        var id = (renderers.size || 0) + 1;
        renderers.set(id, renderer);
        return id;
      },
      onScheduleFiberRoot: function () {},
      onCommitFiberRoot: function () {},
      onCommitFiberUnmount: function () {},
      onPostCommitFiberRoot: function () {},
    };

    Object.defineProperty(global, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      enumerable: true,
      get: function () { return hook; },
      set: function (next) {
        // Real DevTools may try to install later. Accept it but preserve any
        // renderers we already collected so debug-render can still find them.
        if (next && typeof next === 'object') {
          if (!next.renderers || (next.renderers.size === 0 && renderers.size > 0)) {
            try { next.renderers = renderers; } catch (_) {}
          }
          hook = next;
        }
      },
    });

    // Cross-iframe note: if running in a top-frame, mirror so child iframes
    // (Storybook iframe.html) can rely on it too. Safe no-op otherwise.
    try {
      if (global.top && global.top !== global && !global.top.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        global.top.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
      }
    } catch (_) {}
  } catch (_) {
    // Never throw at page boot. A failed shim must degrade silently.
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
