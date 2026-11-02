# Debug-render: hook structure without scheduling an application update

Debug-render answers structural questions about one committed component: which
hook slots exist, their primitive kinds, and—when replay succeeds—the
custom-hook ancestry around them. It deliberately does not find performance
triggers or establish causal attribution; Avalanche owns that page-wide work.

## Two complementary paths

| Path | Owner | Result |
| --- | --- | --- |
| Live dispatcher capture | `core.ts` | Raw hook-call events from real render phases, retained losslessly for later projection. |
| Structural replay | `replay.ts` | Re-executes a function component against committed hook state to recover custom-hook ancestry; falls back to fiber-only records when it cannot safely proceed. |

`context-replay.ts` supplies best-effort context values and disposable
scaffolding so ordinary context reads do not prematurely stop structural
discovery. Those values are never presented as product state.

## Important boundary

React registers the renderer only when a DevTools hook exists before react-dom
evaluates. The extension and Playwright bootstrap paths establish that timing;
this domain consumes the registered renderer through
`chippy-bridge/react-renderer.ts`. A late hook installation must degrade to
fiber-only evidence instead of claiming custom-hook ancestry.

Replay does not schedule a React update, but it does execute component and
hook bodies. Treat it as an active inspection step: callers must disclose the
target and use the fiber-only path when render-time execution is not acceptable.

## Validation

Use the replay and core tests for classification, dispatcher restoration, and
fallback behavior. Use the Storybook/Playwright validation route when checking
the bootstrap timing contract against a real renderer.
