# Layout lab: read-only DOM-to-fiber evidence

Layout lab connects a visible DOM target to React component evidence without
changing page state. It is the product-neutral foundation for probes,
interaction breadcrumbs, component descriptions, and declarative boundary
inspection.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `fiber-walk.ts` | Finds React fibers attached to DOM nodes and describes components, sources, owners, rendered parents, hooks, and DOM anchors. |
| `fiber-boundaries.ts` | Detects Error and Suspense boundaries from fiber-native signals and measures their distance from a target. |
| `marker-context.ts` | Composes the marker context: generic Error/Suspense boundaries plus whatever registered context providers contribute (extra boundary kinds, error-boundary enrichment, display hints). |
| `probe-intent.ts` | Defines and normalizes the product-neutral intent/comment DTO carried by a probe. |

## Relationship boundaries

`fiber.return` describes rendered containment, while `_debugOwner` describes
who created an element in development builds. They answer different questions
and must not be substituted for each other. A production page may have no
debug source or owner chain; preserve that confidence boundary rather than
inventing a source path.

Generic Error/Suspense detection belongs in `fiber-boundaries.ts` because it
applies to every React page. Product conventions such as ownership-marker
components belong in a context provider plugin (see `src/plugins/`), registered
through `registerContextProvider`. A provider may add boundary kinds, merge
fields onto the generic error boundary, and choose display titles and fields;
it never becomes a prerequisite for inspection, and a throwing provider is
ignored.

## Validation

Use the fiber-walk and fiber-boundary tests for deterministic tree semantics.
Validate a full probe route through the Chippy helper whenever a change affects
the page bridge or the shape of live probe output.
