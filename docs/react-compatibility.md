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
| Component source | React 18 `_debugSource`; React 19 `_debugStack` | Development metadata; served source maps for React 19 and for React 18 lines shifted by a dev-server transform |
| Commits, rendered components, prop changes, lifecycle events | DevTools callbacks | Hook installed before React evaluates |
| Custom-hook structure and replay | Renderer dispatcher reference | Development internals; replay can execute render bodies |
| Force a component re-render | Renderer `scheduleUpdate` | Development renderer; production builds may omit it |
| ATL render counters, restart math, state-dispatch/recompute metrics | Not supplied by stock React | Optional host-provided ATL instrumentation |

Source maps and React internals vary by build and version. Production inspection
can retain DOM, props, parent paths, and boundary evidence while losing authored
source, owner metadata, replay, or scheduling capabilities. Read result status
and warnings rather than inferring support from a global's presence.

## Production builds

Chippy can be used on a production build, with limits. It always uses the best
evidence the build provides and labels what it fell back to.

Available in production:

- Elements, props, the parent path, and Error and Suspense boundaries.
- Performance profiling with Avalanche: which commits ran, which components
  rendered, and which prop changes caused them. The DevTools hook must be
  installed before React evaluates, which the browser extension does.
  Production React does not record which fibers scheduled an update, so
  Avalanche detects update sources by comparing hook state with the previous
  commit it saw. The first commit after Avalanche starts has no earlier state,
  so it reports renders but no sources; later commits are attributed normally.

Limited or unavailable in production:

- **Component names** are minified unless the code keeps them or the page
  serves source maps, so a component may appear as `c` or `eu`, or have no
  name at all.
- **Source locations** of JSX call sites are unavailable, because production
  React omits `_debugSource` and `_debugStack`. With source maps, Chippy
  reports where each component is defined instead.
- **Owner chains** are unavailable. Chippy reports the parent chain instead and
  labels it as parents, which shows where a component is rendered but not which
  component created it.
- **Custom-hook structure, hook replay, and forced re-renders** need
  development internals.

### Recovering names from source maps

When the production bundle has a source map, inline or linked through
`sourceMappingURL`, Chippy recovers the authored component names. For each
component, it finds the function's text in the page's loaded scripts, maps that
position through the source map, and reads the authored name from the map's
`names` or `sourcesContent`. Results then show the authored name, plus
`minifiedName` and `definition`, the file and line where the component is
defined. This covers probes, `find-fibers --name`, `describe-component`,
`explain-component`, and Avalanche reports.

Recovery is on demand. Each command resolves only the components it returns or
filters on, and fetches maps only for the scripts that contain them.

A minifier can turn components from separate scopes into identical text.
Chippy maps every occurrence of the text and uses the authored name only when
all occurrences agree on it. When they map to different names, the component
keeps its minified name.

Recovery needs the page to be able to fetch the bundle and its map. It does not
apply when the map is missing or unreachable.

### Keeping names in the build

Without source maps, keeping display names in production code helps the most.
Chippy reads a component's `displayName`, then its function or class name, so
either of these keeps results readable:

- Set `displayName` on the components you want to find, for example
  `ProjectList.displayName = 'ProjectList'`.
- Configure the minifier to keep names, for example esbuild `keepNames` or
  Terser `keep_fnames` and `keep_classnames`.

For safe replay and recovery, use the packaged [active-stimulus guide](../.agents/skills/chippy/references/active-stimulus.md)
and [troubleshooting guide](../.agents/skills/chippy/references/troubleshooting.md).
