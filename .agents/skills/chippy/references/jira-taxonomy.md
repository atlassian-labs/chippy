# Jira-specific component taxonomy

Signals to keep and use when probing Jira-like production pages.

The `owner` boundary and Jira ownership fields appear only when the built-in Jira plugin is enabled. The wrapper names below apply to Jira pages whether or not it is.

## Probe Jira context

Chippy enriches a selected fiber with three collateral-scope boundaries. The extension/import panel renders them in-page; the Storybook addon renders the same three inside the matching marker card (feature parity — same data, host-specific rendering). It scans a bounded current/return/debug-owner path.

The three boundaries (`markers[id].context.boundaries = { owner, error, suspense }`) each carry a **`distance`** — the number of fiber hops from the probed fiber. Distance is the primary signal: it says how far each collateral boundary is without resolving it in full. Each block is **clickable**; a click reports the selected boundary (`{ markerId, boundaryKind, boundary, distance }`) to the backend as an `inspect-boundary` signal for later investigation (readable as `lastInspectedBoundary` on the client summary).

- **error** and **suspense** are **fiber-native React primitives**, detected generically on *any* React page (not just Jira). Error boundaries are found by React lifecycle (`getDerivedStateFromError` / `componentDidCatch`) with a name-heuristic fallback (`detectedBy: 'lifecycle' | 'name'`); Suspense by fiber tag 13. The error block shows the detailed fields; on Jira it is enriched from `JSErrorBoundary` props (`id`, `packageName`, `teamName`, `fallback`).
- **owner** is the Jira-specific semantic/team owner (`OwnerMark___<type>___<name>___<package>___<variant>`) — *not* the React render owner. It renders as a **short clickable lozenge** (name + distance only); its fields are intentionally not dumped because the OwnerMark commonly wraps the error boundary and would duplicate it.
- The nearest Suspense boundary in deep trees (e.g. Jira) can sit ~170+ fiber-hops above a leaf; the ancestry walk reaches it (ceiling 400) but early-exits once all three are found.
- This is live runtime metadata, not a repository or organizational lookup. Treat it as a production source hint and retain the existing confidence caveat when neither `_debugSource` nor a usable React 19 `_debugStack` source is available.
- Use `context-ui <clientId> off` to hide the boundary cards for the current page, and `context-ui <clientId> on` to show them again. This applies to both in-page and Storybook marker cards; generic probe data remains available in either state.

## `OwnerMark___<type>___<name>___<package>___<variant>`
Declarative boundary marker near error/lazy boundaries. Often the closest thing to a source name in production.

## `Connect(X)`
Redux wrapper. The wrapped name is the real component.

When reading avalanche traces:
- `Connect(X)` is usually transport, not ownership.
- Promote `X` or the nearest Jira-owned child/self-updater before ranking it as a source.
- If the trace only names `Connect(X)`, use its wrapped name as the business component label.

## `ComponentWithCondition[]`
Feature-gate branch marker.

When reading avalanche traces:
- Ignore as a primary source.
- Treat as path metadata only: it explains which gated branch is active.
- Promote the nearest Jira-owned parent or child with concrete `whatChanged` / `hookChanges` evidence.
- Broad collateral under this node does not mean the gate owns the update.

## `WithAnalyticsEvents(X)` / `WithAnalyticsContext(X)` / `WithAnalytics(X)`
Analytics wrappers. Usually structural noise.

## `JiraUFOSegmentWrapper` → `SsrRenderProfiler` → `UFOSegment`
Performance instrumentation seam. Useful as a feature boundary marker.

## `SuspensePlaceholder` → `SuspenseWrapper` → `OwnerMark___placeholder___X`
Lazy-loaded section marker.

When reading avalanche traces:
- `SuspensePlaceholder` is not a real business source.
- It artificially holds or releases child propagation during lazy/suspense transitions.
- Treat as environment/path metadata unless no Jira-owned source exists above or below it.
- Large collateral here usually means the subtree beneath it woke up; inspect the nearest Jira-owned child/self-updater next.

## `Safe(X)`
Crash-safe wrapper.

## `Container(X)`
SweetState/local shared state boundary. Strong hint for data origin.

When reading avalanche traces:
- Higher-value source candidate than wrappers/placeholders.
- If `Container(X)` is a self-updater with concrete field changes, keep it in the suspect list.

## `ConnectedXxxRelayWithSuspense`
Relay/GraphQL data boundary.

When reading avalanche traces:
- Often a real data boundary, not just noise.
- Keep when export shows concrete field/store changes or repeated self-updates.
- If only suspense transport is visible, keep drilling to the Jira-owned child.

## Avalanche ranking rules for Jira
- Filter helper nodes first: feature gates, placeholders, analytics wrappers, profiler seams.
- Do not equate blast radius with ownership. Broad hotspot can still be transport.
- Prefer the nearest Jira-owned self-updater with concrete `whatChanged` / `hookChanges` evidence.
- Repeated commits beat one broad placeholder event when picking real work.
- Parent/child environment still matters: keep helper nodes in notes to justify the branch shape, but not as the fix target.
- Before writing work items, normalize wrapper names to the business component that owns the update.

## Noise to skip
`AnalyticsContext`, `AnalyticsListener`, `GenericAnalyticsListener`, `SsrRenderProfiler`, `ExperienceTrackingProvider`, single-character minified HOCs, and similar non-structural wrappers.
