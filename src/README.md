# Chippy runtime source map

`src/` is the page-side implementation behind Chippy. It turns React runtime
state into bounded evidence for the extension, Storybook addon, helper, and
agent workflow; it does not own browser transport, user-facing investigation
instructions, or product-source edits.

The shipped browser bundle starts at [`iife.ts`](iife.ts). It publishes
`window.__AVALANCHE__`, composes the domain modules below, and is copied into
the extension by `yarn avalanche:sync`. The extension's page bridge is a thin
shell over that public surface, so implementation belongs here rather than in
`extension/chippy-page-bridge.js`.

## Domains

| Area | Owns | Does not own |
| --- | --- | --- |
| [avalanche/](avalanche/README.md) | Commit capture, performance evidence, report projection, optional Atlassian metrics integration | Browser commands or product fixes |
| [chippy-bridge/](chippy-bridge/README.md) | Transport-safe bridge capabilities and command-shaped output | WebSocket transport or extension UI |
| [debug-render/](debug-render/README.md) | Dispatcher capture and structural hook replay | React scheduling or causal performance attribution |
| [layout-lab/](layout-lab/README.md) | Read-only DOM-to-fiber resolution, generic boundaries, optional Jira enrichment | Probe UI and page transport |
| `stability/`, `components/`, `layout/` | Storybook fixtures used to demonstrate or validate capabilities | The reusable runtime capabilities themselves |

## Runtime flow

```text
React page
  → layout-lab resolves DOM/fiber evidence
  → Avalanche observes commits and projects reports
  → debug-render adds hook structure when replay is safe enough to attempt
  → chippy-bridge shapes capability results for the page bridge
  → iife.ts publishes __AVALANCHE__ for extension/import/Storybook integration
```

The evidence stays deliberately partitioned: a source location, a captured
commit, and an interaction breadcrumb answer different questions. The bridge
may join them into one response, but no layer should silently promote one into
proof of another.

## Working here

- Keep the React-internals logic in its owning domain and export it through
  `iife.ts`; do not duplicate a capability in the extension bridge shell.
- Treat React fibers and DevTools renderer fields as version-coupled evidence.
  All exposed paths must degrade to structured results when a production build
  or missing early hook shim makes an internal unavailable.
- Keep the detector's commit traversal local to its hot path. Extract setup,
  serialization, and adapters around it instead of adding per-fiber overhead.

Run focused tests with the local Vitest binary, for example:

```bash
./node_modules/.bin/vitest run src/avalanche/detector.rtl.test.tsx
```

For bundle or extension changes, follow the additional validation and publish
requirements in the workspace instructions before updating the generated
extension assets.
