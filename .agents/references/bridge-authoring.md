# Bridge and snippet authoring

Repository paths in this reference are relative to the repository root.

### Snippet / bridge authoring guidance
- One-off probe with no expected reuse → snippet, not a bridge command.
- Reused across multiple procedures, or part of a documented reference → snippet with a documented contract; promote to a bridge command only if the round-trip cost matters.
- Stimulus for a procedure that needs reproducibility → snippet, always. Bridge commands are for capabilities; snippets are for procedures composed on top of them.
- Active-stimulus snippets must document an anchor contract: name what they touch, name what becomes opaque, and name what the caller must guarantee.

### Capability vs procedure — the `stability-nudge` split (worked example)

`stability-nudge` is the reference example of separating a **capability** (core, bundled, version-coupled) from a **procedure** (disposable, snippet-served, iterable without a publish):

- **Capability** — `src/chippy-bridge/fiber-schedule-update.ts`, exposed as the `fiber-schedule-update` bridge command. It forces one re-render on any fiber via the React DevTools renderer's `scheduleUpdate(fiber)` — the exact internal DevTools uses for "force re-render". Works on any component (function, hookless, memo, forwardRef, class) and mutates **no** hook or prop. The earlier `useState`-dispatch / class-`forceUpdate` approach is gone: it returned `no-state-hook` for hookless/props-only components, which is most leaf components.
- **Procedure** — `snippets/stability-nudge.js`. It keeps probe/testId resolution + owner walk (DOM context the bridge does not have) and delegates the actual re-render to `bridge.evalFiberScheduleUpdate`. Changing the nudge procedure is now **snippet-only, zero publish**.
- **Anchor contract (revised):** the nudge no longer pollutes a hook. It schedules one extra synchronous render on the target fiber; the extra commit *is* the stimulus, and any render-time side effects in that subtree will run. Target must be a current (mounted) composite fiber. No orphan/unconsumed `useState` is required — `StabilityChain.jsx` had its anchor hook removed.
- **Renderer discovery is shared:** `src/chippy-bridge/react-renderer.ts` (`getReactRenderers` / `getDispatcherRef` / `getScheduleUpdate`). `debug-render/core.ts` and `debug-render/replay.ts` delegate to it — one renderer-walk in the codebase, not three. `scheduleUpdate` is dev-build only (prod react-dom strips it → `no-scheduleUpdate`), matching Chippy's development-only source metadata (`_debugSource` on React <=18, `_debugStack` on React 19).
- **Lesson:** pay one publish to land a React-internals *capability* behind a tested bridge command; after that, every *procedure* built on it iterates snippet-only. Do not trap a core, version-coupled React-internals call inside a dynamic eval to dodge a publish.
