# Chippy bridge: page-runtime capabilities at the transport boundary

This domain converts page-side React evidence into command-shaped, serializable
results for the JavaScript page bridge. It owns reusable capabilities that need
to travel through the generated IIFE bundle; it does not own WebSocket
transport, browser extension UI, or generic helper-server routing.

The extension shell must remain a shim over these exports. Moving a capability
back into `chippy-page-bridge.js` creates two implementations that can drift
between extension, import, and Storybook integration paths.

## Responsibilities

| Module group | Responsibility |
| --- | --- |
| `avalanche-commands.ts` | Selects compact Avalanche status, report, commit, and action views. |
| `eval-helpers.ts`, `fiber-introspect.ts` | Read-only fiber/DOM/property inspection and safe transport serialization. |
| `fiber-state.ts` | Captures compact prop fingerprints and compares two fiber trees without returning full state payloads. |
| `fiber-source.ts`, `source-map.ts` | Resolves React <=18 `_debugSource` or React 19 `_debugStack` to authored source, with cached page-realm module fetches and Source Map v3 decoding. |
| `describe-component.ts`, `inspect-formatters.ts` | Compose hook evidence into structured and text descriptions without owning capture. |
| `fiber-invoke.ts`, `fiber-schedule-update.ts` | Explicitly active capabilities. Invocation validates callable props; scheduling uses the development DevTools renderer API. |
| `declarative-boundaries.ts` | Reduces a full fiber tree to Error/Suspense evidence while preserving containment. |
| `react-renderer.ts` | The sole renderer-discovery seam shared by replay and scheduled updates. |

## Capability versus procedure

Put version-coupled, round-trip-sensitive React internals here when several
procedures need them. Keep disposable task choreography—such as resolving a
probe and choosing a target—in a version-controlled snippet. `stability-nudge`
is the model: it composes a procedure over `fiber-schedule-update`, rather than
embedding an unversioned React-internals call in page eval.

Read paths must never execute product callbacks or mutate fibers. Active paths
must return structured failures for stale fiber IDs, production builds, missing
early DevTools setup, thrown callbacks, and async timeouts; callers need an
explicit capability gap rather than an exception escaping into the page bridge.

## Validation

Every public bridge command needs direct tests and a wire-level test proving
the shell wrapper, helper command builder, and page bridge preserve its input
and output shape.
