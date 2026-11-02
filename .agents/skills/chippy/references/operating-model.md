# Chippy Operating Model

Chippy works in four separated phases: **Observe → Define → Prove → Apply**. This is the enforcement layer for evidence-first work. Do not collapse these phases.

Cynefin positions the work; OODA drives repeated evidence steps inside Prove. See [cynefin](cynefin.md) for the full positioning and iteration rules.

| Phase | Position or iteration role |
|---|---|
| Observe | Use read-only orientation to exit ❓ Disorder and name the domain. If it is 🔥, stabilize before further analysis. |
| Define | Frame the case in the language of the named domain — sensor question for 🔍, experiment hypothesis for 🌀. |
| Prove | Repeat OODA inside the named domain. Run sensors in 🔍; run safe-to-fail experiments through an observable SUT in 🌀. Never demand 🔍 certainty from a 🌀 system. |
| Apply | Separate from OODA Act. Allowed only when the proof packet meets the per-domain confidence rule, identifies a fix layer, and supplies repeatable verification. |

| Phase | Purpose | Question | Output | May edit? |
|---|---|---|---|---|
| **Observe** | Anchor the symptom in runtime or source reality | What is actually there? | Observation anchor: page/client, probe/fiber/testId/interaction/load window, first signal | No |
| **Define** | Name the observed thing and the invariant under test | What case did observation reveal? | Case definition: target, scope, invariant, suspected dimensions | No |
| **Prove** | Gather evidence until the case is confirmed, falsified, or bounded | What does runtime/source evidence prove? | Proof packet: runtime + structure + source + signal facts, confidence, next gap | No |
| **Apply** | Change source only after proof identifies a fix layer | What is the smallest source change that preserves the invariant? | Edit + same-signal verification | Yes, only after explicit proof |

## OODA inside Prove

The Prove phase repeats a bounded loop:

1. **Observe** the smallest current signal.
2. **Orient** it against the domain, invariant, accumulated facts, and next gap.
3. **Decide** the next move permitted by the domain and documented command surface.
4. **Act** by executing that evidence move, then update the proof packet.

OODA Act can be read-only. It can also be a bounded stimulus or stabilizer when the domain permits one. It is never implicit authorization to edit source: only the Apply phase can do that. If new evidence changes the cause/effect posture, return to Observe, reposition, and continue with the new domain.

## Observation contract

Before defining the case, anchor it in observed data:

```text
Observation: <probe/fiber/interaction/load window/page state> shows <first concrete signal>.
```

Examples:

```text
Observation: probe 1 resolves to a status label with text "Done" under IssueHeader.
```

```text
Observation: after arming Avalanche and clicking Save, commit 42 has high collateral under the Save panel.
```

## Case definition contract

After observation, define the case in one sentence:

```text
Case: <visible/runtime symptom> violates <expected invariant> at <scope>.
Need to prove: <prop | hook | provider | store | boundary | source | load/runtime wave>.
```

Examples:

```text
Case: clicking Save causes the whole panel to lag; invariant is one bounded update under the Save branch.
Need to prove: whether the trigger is local state, context propagation, store restart, or missing memo boundary.
```

```text
Case: this status label says Done; invariant is that displayed text comes from issue status data, not presentation fallback.
Need to prove: which owner passes the label prop and where the value is derived.
```

## Proof packet contract

A claim is not ready for Apply until it has a proof packet.

```text
Definition:
  target: <probe/fiber/story/page/interaction>
  invariant: <what should stay true>
  scope: <component/subtree/page/load/interaction>

Evidence:
  runtime: <probe-dom/pages/snapshot/avalanche status/logged transition>
  structure: <owners/parents/fiber/hook tree>
  source: <file:line and render block>
  signal: <prop value/hook primitive/context wave/commit stats>
  fact split: <source fact | runtime fact | unknown bridge>

Decision:
  role: <source | boundary | collateral | provider | store | mount | unknown>
  confidence: confirmed | likely | partial
  next gap: <none or exact missing fact>
```

## Apply gate

Apply is allowed when the proof packet answers four questions:

1. **Case + evidence** — what invariant is in scope, and which runtime/source facts support it?
2. **Signal movement** — for no-rush or emergent work, did the last tapped contract or safe-to-fail experiment move, reproduce, or falsify the observed failure?
3. **Fix layer** — is the change above source, at a boundary, or below source?
4. **Verification** — can the same measurement be repeated after edit, with confidence appropriate to the domain?

If any gate fails, Chippy continues proving or reports the gap. Chippy does not patch while still discovering the essence.

### Per-domain confidence rule

Confidence is not a free-floating field. It is bounded by the Cynefin domain Observe declared. See [cynefin](cynefin.md).

| Domain | Minimum confidence to Apply | Why |
|---|---|---|
| ✅ Clear | `confirmed` | Sense → categorize → respond. The answer is deterministic; anything less than `confirmed` means the situation was misclassified. Reposition first. |
| 🔍 Complicated | `confirmed` | Sense → analyze → respond. The chain is knowable; `likely`/`partial` means analysis is incomplete — keep proving, do not apply. |
| 🌀 Complex | `likely` is sufficient **iff** the experiment is repeatable | Probe → sense → respond. Emergent systems rarely produce `confirmed`. Apply is allowed when (a) the same safe-to-fail experiment yields the same outcome on rerun, and (b) the verification command in gate 4 *is* that repeatable experiment. Never apply on `partial` in 🌀. |
| 🔥 Chaotic | — | Apply is forbidden. Stabilize first, then re-classify. |
| ❓ Disorder | — | Apply is forbidden. Use read-only orientation to position first. |

Rule of thumb: if the proof packet reports `confidence: partial`, Apply is never allowed. If it reports `confidence: likely` in 🌀, the verification command must be the *same* experiment that produced the `likely` reading.

## Fixing is a separate capability

Fixing is not a natural continuation of tracing. It is invoked only after Observe, Define, and Prove.

```text
Understand path: Observe → Define → Prove → Report essence
Fix path:       Observe → Define → Prove → Apply → Verify
```

A user may ask for understanding only. In that case, stop after Prove and report the proof packet. Do not apply.
