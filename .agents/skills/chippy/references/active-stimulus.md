# Active Stimulus — Page Click, Fiber Invoke, Stability Nudge

Active-stimulus commands deliberately change the running page so Chippy can observe the result. They are for reproduction, verification, and observability — never for patching behavior in place instead of editing source.

## Debug replay preflight

`explain-component`, `describe-component`, and `inspect-fiber-structure` are read-oriented commands, but their dispatcher-based debug replay may execute component and hook bodies. Replay does not schedule an application update; render-time side effects can still run.

Before any of these commands:

1. Name the exact component/fiber target.
2. Disclose the render-time execution boundary.
3. If that execution is unsafe or cannot be accepted, use `probe-hooks-summary` / `inspect-fiber-hooks-summary`, props, and owners instead; report that custom-hook ancestry was not replayed.
4. After replay, read `replayStatus` and `warnings`; when replay is unavailable, treat the result as fiber-only evidence.

## Commands

- `page-click <clientId> <selector|probeId|fiberId>` — click exactly one DOM target.
- `fiber-prop-contract <clientId> <fiberId> <propName>` — inspect a prop's callable shape without invoking it.
- `fiber-invoke <clientId> <fiberId> <propName> [--args JSON]` — invoke exactly one already-understood function prop from `memoizedProps`.
- `fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]` — force exactly one re-render on a fiber via the DevTools renderer's `scheduleUpdate`. Works on any component (function, hookless, memo, forwardRef, class) and mutates no hook/prop. The capability behind `stability-nudge`.
- `eval-page <clientId> stability-nudge ...` — synthetic single-fiber stimulus (the procedure that composes `fiber-schedule-update` with probe/testId resolution).

## Anchor contract

Before running an active stimulus, state all three:

1. **Exact target** — the one DOM node, one probe target, one fiber, or one hook anchor you intend to stimulate.
2. **Exact stimulus** — what Chippy will do (`click`, invoke `onClick`, schedule one render on a target fiber, etc.).
3. **Pollution boundary** — what state may become changed, ambiguous, or no longer representative afterward.

If any of the three are missing, do not stimulate yet.

## `page-click`

Use when the target behavior is best represented by a browser click on the rendered DOM.

Rules:
- selector must resolve to **exactly one** element; ambiguous selectors refuse
- probe target uses the resolved probe DOM node
- fiber target uses the first DOM-backed node reachable from that remembered fiber
- no multi-click mode

Pollution:
- all page state reachable from the click handler may change
- focus, selection, open/closed UI state, and network activity may change
- subsequent probe reads are about the post-click page, not the pre-click page

## `fiber-invoke`

Use when the final application boundary matters more than browser mechanics — for example invoking `onClick`, `onChange`, or a callback prop directly to tap the product system without reproducing browser ceremony.

Rules:
- target fiber is explicit (`fiberId` only)
- run `fiber-prop-contract` first to inspect `fn.length`, function name/source preview, prop names, and source hints
- read the component/owner source to determine the real callback contract
- prop must exist on `memoizedProps`
- prop must be a function
- arguments are explicit JSON only; do not infer them from prop names

Pollution:
- component/app state may change without matching browser focus, pointer, or default-event semantics
- side effects triggered by the callback still run
- this proves application behavior, not browser behavior

## Choosing between them

Prefer `page-click` when:
- browser semantics matter
- the handler depends on actual DOM click wiring
- you want the closest equivalent to a user click

Prefer `fiber-invoke` when:
- the browser ceremony is irrelevant noise
- the real question is whether the app callback changes state correctly
- you want a small white-box repro that taps directly into the final system

## Never

- never use active stimulus before finishing Observe/Define
- never hide that the page was mutated
- never treat post-stimulus state as if it were pristine baseline state
- never use `fiber-invoke` to claim browser behavior was proven
- never invoke a function prop before understanding its contract from `fiber-prop-contract` and source inspection
- never synthesize callback arguments from prop names alone
