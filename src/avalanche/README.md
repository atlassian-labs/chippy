# Avalanche: commit-level React evidence

Avalanche records a bounded window of React commits so Chippy can distinguish a
render trigger from the components that merely rendered as collateral. It is a
page-wide profiler: it cannot identify a root cause from one hot component or
isolate a single subtree before capture.

`detector.tsx` owns the commit-time fiber traversal and capture state. Its
inner traversal remains monolithic because it runs on every observed commit;
new setup, lifecycle, interpretation, and serialization work belongs in the
surrounding modules unless measurement proves it belongs in that path.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `detector.tsx` | Installs against React DevTools or the registered commit metrics adapter, captures commits, and keeps bounded profiler state. |
| `commit-metrics-adapter.ts` | Defines the `CommitMetricsAdapter` seam and its one-slot registry. A host-specific integration (for example `src/plugins/atl/`) registers an adapter; the core has no product knowledge. |
| `commit-surface-ownership.ts` | Transfers capture ownership after an adapter callback, matching callbacks to the same committed root/fiber to avoid duplicates. |
| `internals.tsx` | Version-coupled React fiber tags, flags, and comparison helpers used only by the detector. |
| `reporter.tsx` | Turns captured state into ranked sources, commit evidence, and report views. |
| `report-serializer.tsx` | Produces DTOs that survive JSON/helper/offline transport without retaining live fibers or functions. |
| `render-ticks.ts` | Counts render slices (ticks) per commit from React 19's async dispatcher slot or React 18's profiling hooks, composing with React DevTools and giving every slot back on uninstall. |
| `interaction-capture.ts` | Records recent DOM interaction anchors and links them to later commits by time window. Proximity is a clue, not causality. |

## Boundaries and modes

The detector uses the standard React DevTools hook until a commit callback
from the registered metrics adapter proves that the adapter is live; the mode
then reads `adapter:<id>`. A seeded metrics object alone must not disable
DevTools capture. Pass `metricsAdapter: null` to opt out of adapters. The ATL
adapter for Atlassian's patched react-dom lives in `src/plugins/atl/` and is
registered by the bundle's composition root (`src/iife.ts`). Neither path makes
React internals a stable API: callers must report unavailable evidence rather
than infer it.

Capture modes trade overhead for detail. `stats` and `sources` support broad
triage; `full` is needed when a later command requires per-component render
evidence. A report is an observation window, not a permanent application
profile, so reset/recapture before comparing different interactions.

`debug-render` complements Avalanche but does not replace it: Avalanche finds
commit patterns; debug-render interrogates a hook only after evidence provides
a source and hook index.

## Validation

Use unit tests for report projection, serialization, and lifecycle behavior.
Use the Storybook/Playwright paths for detector behavior that depends on a
real React renderer or an adapter-driving host.
