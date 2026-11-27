# React Compiler: when it is the answer

React Compiler (1.0) memoizes components and hooks at build time. It removes
render waste caused by **identity**: new objects, arrays, callbacks and JSX
created in render that reach a child or hook with equal content. It does not
change what React does with a real change, with an Effect, with the network or
with time.

Answer "would the compiler fix this?" from the triage line
([perf-triage.md](perf-triage.md)), not from the component's code style.

## It is the full answer when all of these hold

- The cost is identity-driven render waste: collateral `rendered[]` rows whose
  `propChanges[]` are `sameShallow: true` or functions rebuilt every render, and
  triggers with `changedHooks[].sameContent: true` only when the new value is
  created in compiled render code ([RW-1](patterns-render.md#rw-1-unstable-identity-reaching-a-memo-child)).
  The compiler does not change what a setter receives in an event handler or an
  Effect, or what a library selector returns
  ([RW-7](patterns-render.md#rw-7-store-selector-returns-a-new-object),
  [EF-2](patterns-effects.md#ef-2-derived-state-via-effect),
  [EF-3](patterns-effects.md#ef-3-effect-chains)).
- The affected components and hooks are in code the build compiles: not in
  `node_modules`, not excluded by the compiler's include or exclude settings, not
  skipped by a bailout.
- No Effect chain, network wait, timer or real value change is part of the cost.
- The app runs React 19, or React 17/18 with the compiler `target` option set and
  `react-compiler-runtime` installed.

Then enable the compiler for the affected code (incremental adoption is
supported) and lint with `eslint-plugin-react-hooks` 7.x, which carries the
compiler rules. Keep existing `useMemo` and `useCallback`: React's guidance is to
keep them, or test carefully before removing them, because they can be Effect
dependencies. Existing `memo` wrappers can stay; removing them is optional
cleanup after measurement, not a fix.

## It is a partial answer

- **Library hooks.** Code from a non-compiled library can return new objects every
  render, and some libraries rely on interior mutability (a form `watch` API, table
  or virtualizer instances). The compiler cannot see through them; the lint rule
  `incompatible-library` names known cases. Fix at the library boundary (a
  selector, a stable subscription) or opt the component out.
- **Context.** A compiled provider component keeps its value stable when the inputs
  are equal, which stops identity-only fan-out. A real value change still renders
  every consumer, including consumers in `memo`. Split the context or use a store
  with selectors ([RW-3](patterns-render.md#rw-3-context-fan-out)).
- **Effects.** Compiled code memoizes values used as dependencies, so
  identity-driven re-runs may stop. Dependency comparison is unchanged, and the
  compiler can memoize differently from a hand-written dependency, so an Effect can
  run more or less often than before. Re-count Effect runs after adoption
  ([EF-1](patterns-effects.md#ef-1-effect-re-fires-from-identity)).

## It is irrelevant

Network waits, late starts, waterfalls and stale responses; debounce and throttle
edges; apply vs persist; long tasks from non-React scripts; real input changes to
an expensive component; index or random keys and remounts; list virtualization;
derived state and Effect chains. See [patterns-latency.md](patterns-latency.md),
[patterns-effects.md](patterns-effects.md) and
[RM-1](patterns-render.md#rm-1-key-induced-remount).

## Is this component compiled?

Do not assume coverage: an include pattern that matches nothing compiles zero
components and the build still succeeds.

1. **Runtime.** `describe-component <clientId> <fiberIdOrName>` lists a `MemoCache`
   primitive in its hook tree when the component is compiled for React 19 (the
   compiler runtime's cache call). On React 17/18 the runtime polyfill uses a
   `useMemo` in the first hook slot instead. In React 19 the cache lives on the
   fiber at `updateQueue.memoCache`. Chippy has no "compiled" flag yet.
2. **Source.** Compiled output imports the compiler runtime (`react/compiler-runtime`
   or `react-compiler-runtime`) and calls its cache function, usually named `_c`.
3. **DevTools.** The "Memo ✨" badge is supporting evidence only.

## Did the compiler bail out?

A component you expected to be compiled shows no memo cache. Bailouts are silent
by default. Check the compiler's logger output or a stricter `panicThreshold` in a
local build, and the `eslint-plugin-react-hooks` diagnostics for that file; Rules
of React violations (mutating props, reading refs during render) are the usual
causes.

## Does it help here?

Measure it as an A/B on the same page ([ab-testing.md](ab-testing.md)):

- Arm A: the component compiled. Arm B: the same build with `'use no memo'` at the
  top of the suspect component (or the parent whose identity churn matters).
- Capture each arm with `ab-capture`, interleaved, at least 3 samples per arm, and
  run `ab-compare`. Read `renderMs` and the component rows; behavior should be
  `equivalent`.
- If the waste persists in the compiled arm, the cause is not identity: return to
  triage.

`'use no memo'` is an escape hatch for debugging and incompatible code; remove it
after the experiment.

## The compiler is already on and it is still slow

The remaining cost is a real input change, an expensive render, a non-compiled
dependency, a bailout, or a wait outside render. Continue the triage; do not add
manual memoization by reflex.

Published before and after numbers from pre-1.0 compiler builds are dated and
vary widely by app. Treat them as illustrations, not expectations.

## Sources

- React: [React Compiler introduction](https://react.dev/learn/react-compiler/introduction),
  [Incremental adoption](https://react.dev/learn/react-compiler/incremental-adoption),
  [`'use no memo'`](https://react.dev/reference/react-compiler/directives/use-no-memo),
  [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1),
  [useMemo: should you add it everywhere?](https://react.dev/reference/react/useMemo#should-you-add-usememo-everywhere).
