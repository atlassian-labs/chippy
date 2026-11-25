# A/B testing: same page, two conditions

Use this when one page runs under two conditions, such as a feature flag, a build, the React Compiler, or a library version. The question has two parts: did anything the user can see change, and what did React do differently? Chippy compares a group of runs of condition A against a group of runs of condition B, on fiber state and Avalanche evidence, as visual regression compares screenshots.

Chippy does not switch the condition. The user, the page, or the harness sets the flag or serves the build. Chippy records each run and compares the runs.

## Samples and arms

- A **sample** is one run: load or reset the page, perform the stimulus, then `ab-capture`. It saves the Avalanche export and a fiber-state capture together as `<armDir>/sample-<n>.json.gz`.
- An **arm** is every sample of one condition: a directory written by `ab-capture`, or a comma-separated list of sample files. Arms may have different sizes, and an arm may combine runs (A/B/C/D against E/F/G).
- Variation inside an arm is the noise baseline. A value that differs between two runs of the same condition cannot show a difference between conditions.

Take at least 2 samples per arm, and 3 when timings matter. The first runs after a cold start often do extra work (module evaluation, caches, lazy chunks). Read `ab-arm` to see where an arm settled, then drop warm-up samples with `--skip N`.

## Workflow

1. Set condition A. For each sample, reset to the same starting state. A reload needs the user's permission, or the page can be returned to that state by other means; then run `avalanche-clear <clientId>` or `reload-with-avalanche`.
2. Perform the same stimulus each time: the same interaction, or the load alone.
3. Run `ab-capture <clientId> <armDirA> [label]`.
4. Repeat steps 1–3 for 2 or 3 samples, then read `ab-arm <armDirA>`: `settled`, `settledFrom`, and the keys in `behavior.varyingTop`.
5. Set condition B and repeat into `<armDirB>`.
6. Run `ab-compare <armDirA> <armDirB> [--skip N]`.

Use the same stimulus, page, viewport, and data in both arms. The comparison cannot tell a changed condition from a changed setup.

## What is compared

**Behavior**, the gate. Each of these is a key with a value per sample:

| Layer | Key | Source |
|---|---|---|
| fibers | each fiber present, and a hash of each of its props | `fiber-state` capture at the end of the run |
| dom | each DOM change: op, node, components above it, changed props or markup, and how often it happened | Avalanche `dom-diff` |
| console | each console error and warning message, and how often | Avalanche console capture, without Chippy's own messages |
| network | each request by initiator and URL, and how often | Avalanche network capture, without requests that started before capture |

A key is a **difference** when it has one value in every sample of A, one value in every sample of B, and the two differ. A key whose value changes inside an arm, such as a timestamp, random id, or polling request, is **unjudged** and is listed apart. A layer that some sample lacks is not judged in either arm.

Differences are reported at their root. An added or removed fiber hides its props and descendants, and a `children` prop that changed only because something below it changed is folded into that change. `collapsed` counts what was hidden.

**Performance** is reported, not gated. It covers commits, renders, collateral and the other commit stats; renders and identity churn per component; trashers; long frames; and layout shifts. A count is `better` or `worse` when the two arms' ranges do not overlap, `same` when every sample agrees, and `noise` otherwise. Lower is better. Timings (render work, total blocking time, worst interaction, CLS) are judged only with at least 3 samples per arm; below that they are listed as `not-judged`. A timing that only climbs or only falls across an arm's samples is `drifting`: a warm-up, a JIT, or a cache filling shows as a timing gap when one arm is captured entirely before the other. Capture the arms interleaved (a, b, a, b) when timings matter.

## Verdicts

| Verdict | Meaning |
|---|---|
| `equivalent` | No behavior key differs between the arms. Read `performance` for what changed in React's work. |
| `behavior-changed` | At least one difference is stable inside each arm. `behavior.items` lists them. |
| `inconclusive` | An arm has fewer than 2 samples, or no behavior key could be judged. `reasons` says which. |

A sample with no React commit means the page did not render or Avalanche was not recording; when the other arm has commits, the verdict is `inconclusive`, because an empty capture is not less work. An arm that has not settled produces a warning, not a different verdict. Before you report a performance gain, settle both arms or skip their warm-up samples.

`equivalent` covers only what was captured: the final fiber tree and props, what changed in the DOM during the run, console errors and warnings, and requests. It does not cover pixels, CSS animations, DOM writes outside React, or states the stimulus did not reach. Report it as "no difference found in the captured layers", not as a proof that nothing changed.

## Matching across builds

`ab-capture` captures fiber state with portable identity. Fibers are matched by structure, component name, and key, without source locations. Function props are compared by arity, without names. A build that moves JSX (such as the React Compiler) or renames hoisted callbacks (`t1`) therefore still matches. `fiber-state-capture` keeps source-based identity, and the two kinds do not compare.

Limits:

- Per-component counts are keyed by component name. Two components with the same name are counted together.
- Minified production builds can give the same component different names in two builds. Compare development builds, or builds with source maps.
- DOM changes are compared as counts per change, not by order between commits. Use `avalanche-dom-diff` on one sample of each arm when order matters.
- Prop values are compared by hash. `behavior.items` shows previews; open the samples with `avalanche-offline <sample> …` for the full evidence of one run.

## Reading one arm

`ab-arm` answers whether an observation repeats, before any comparison: how many samples, from which sample the core counts (commits, renders, collateral) agree, which behavior keys vary between samples, and the spread of every count and timing. Use it for a single condition as well: "is this interaction stable after three reloads?"

Exact shapes are in [command output formats](command-output-formats.md#ab-capture-clientid-armdir-label-maxfibers).
