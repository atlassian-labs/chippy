# React compatibility

Chippy runs against standard React and React DOM. No package patch is required
for DOM probes, fiber inspection, owner/parent traversal, commit capture, or
hook replay when the renderer exposes the required internals.

## Capture starts with the renderer

React registers its renderer with the DevTools hook when React DOM evaluates.
The extension installs a compatible hook early. A module import into an already loaded page can inspect
DOM-attached fibers, but it cannot retroactively register a renderer that started
without any DevTools hook.

Avalanche captures commits through DevTools until an ATL commit callback actually
fires. An empty `__ATL_REACT_METRICS` object is not proof of a patched renderer.
Chippy does not ship or install that instrumentation or a React patch.
When an ATL-enabled host sends callbacks, Avalanche uses that additional evidence
and records each commit once regardless of whether ATL or DevTools calls first.

## Available evidence

| Evidence | Standard development React | Additional requirement |
| --- | --- | --- |
| Element, props, parents, Error/Suspense boundaries | DOM-attached fibers | A mounted React target |
| Component source | React 18 `_debugSource`; React 19 `_debugStack` | Development metadata and served source maps for React 19 |
| Commits, rendered components, prop changes, lifecycle events | DevTools callbacks | Hook installed before React evaluates |
| Custom-hook structure and replay | Renderer dispatcher reference | Development internals; replay can execute render bodies |
| Force a component re-render | Renderer `scheduleUpdate` | Development renderer; production builds may omit it |
| ATL render counters, restart math, state-dispatch/recompute metrics | Not supplied by stock React | Optional host-provided ATL instrumentation |

Source maps and React internals vary by build and version. Production inspection
can retain DOM, props, parent paths, and boundary evidence while losing authored
source, owner metadata, replay, or scheduling capabilities. Read result status
and warnings rather than inferring support from a global's presence.

For safe replay and recovery, use the packaged [active-stimulus guide](../.agents/skills/chippy/references/active-stimulus.md)
and [troubleshooting guide](../.agents/skills/chippy/references/troubleshooting.md).
