# Cynefin positioning and OODA iteration for Chippy

Cynefin (Snowden) positions a situation by the relationship between cause and effect. OODA drives the evidence iterations after that position is known. Chippy uses them together:

> **Position with Cynefin; iterate with OODA; Apply only through the proof gate.**

Every task starts unpositioned in ❓ Disorder. Mise en Place may run the read-only orientation needed to obtain the first concrete signal: `health`, `pages`, `request-snapshot`, and reads of existing probe state. Use that signal to name the initial domain before investigative stimuli, diagnosis, or source edits. Position once for the current evidence state; reposition only when evidence changes the cause/effect posture or the runtime becomes unstable.

This is not theory. It is a guard against the two recurring Chippy failure modes:

1. Treating a 🌀 Complex situation as ✅ Clear — confidently applying a one-line fix to an emergent cascade.
2. Reading data from a 🔥 Chaotic surface — trusting a stale snapshot, a disconnected helper, or a mid-reload page.

## The five domains

### ✅ Clear (Obvious)

- **Cause/effect:** known, repeatable, visible to everyone.
- **Disposition:** sense → categorize → respond. Apply best practice. No deliberation.
- **Chippy signature:** `probe-dom` resolves to one fiber with `source.fileName` + `lineNumber`. `probe-prop-value` returns a scalar that matches the user's words. The owner chain has one obvious carrier.
- **Verb:** open file, read line, answer.
- **Failure mode:** over-deliberating a Clear case — describing the component, arming Avalanche, spinning subagents when the answer is one `probe-dom` away.

### 🔍 Complicated

- **Cause/effect:** knowable, but requires expertise and analysis. Multiple defensible answers may exist.
- **Disposition:** sense → analyze → respond. Apply good practice.
- **Chippy signature:** prop forwarding crosses several hops. A hook tree has 50+ hooks. A commit list shows a clear hot source but the upstream trigger needs walking. The probe data is real and stable; the question is *which* documented chain to follow.
- **Verb:** investigate with documented commands — `probe-owners`, `describe-component`, `avalanche-commit-list` + `commit-peek`, `find-fibers`, source open at exact lines.
- **Failure mode:** treating Complicated as Complex — running speculative experiments when a careful read of existing data would answer the question.

### 🌀 Complex

- **Cause/effect:** emergent. No right answer up front. The answer is only visible *after* the system has been perturbed.
- **Disposition:** probe → sense → respond. Run **safe-to-fail experiments** and watch what emerges.
- **Chippy signature:** re-render cascades, avalanche storms, store-wave propagation, hook-order surprises, timing-dependent stability, "this only happens after the third click." The system has too many interacting parts to predict from static reading.
- **Verb:** create the **observable SUT**. Build the smallest tapped white-box test or `eval-page` snippet that exposes the internals. Arm Avalanche, perform the stimulus under an anchor contract, read the emergent signal.
- **Tap contract, one step at a time.** For no-rush Complex/Complicated work, tap one stable contract seam, observe whether the target signal moves there, then choose the next step. Each step should move, reproduce, or falsify the observed failure before a permanent fix is chosen.
- **Safe-to-fail criteria:** the experiment is bounded (timeout, commit cap), reversible (no source mutation, or HMR-reverted), and instrumented (you can read the result without re-running). Active-stimulus commands (`page-click`, `fiber-invoke`, `stability-nudge`) declare an anchor contract — what they touch, what becomes opaque, what the caller must guarantee.
- **Confidence:** emergent systems usually return `likely` or `partial`. If certainty is required, run another bounded experiment and compare the same signal.

### 🔥 Chaotic

- **Cause/effect:** none discernible. The surface is moving.
- **Disposition:** act → sense → respond. Stabilize first, analyze later.
- **Chippy signature:** helper disconnected, `clientId` stale, page mid-reload, avalanche unbounded and still capturing, snapshot older than the last interaction, HMR in flight.
- **Verb:** stabilize the runtime — reload, reconnect, `health` → `pages` → `request-snapshot`, get a clean baseline. **Only then** read a signal.
- **Failure mode:** reading any signal from a chaotic surface. Stale data from chaos is worse than no data — it produces confident-sounding but wrong conclusions.

### ❓ Disorder / Confusion

- **Cause/effect:** not yet known. The domain itself is unclassified.
- **Disposition:** **orient read-only, then classify before investigating or mutating.** Every Chippy task starts here.
- **Chippy signature:** the user just said a thing. No probe yet. No snapshot. No domain.
- **Verb:** **Mise en Place** — stage the page, run the runtime ceremony (`health` → `pages` → `request-snapshot`), look at the first concrete signal, then declare which of the four real domains this task lives in.
- **Failure mode:** diagnosing, stimulating, or editing from Disorder. Read-only orientation is permitted; treating an unpositioned signal as proof is not.

## OODA inside the named domain

Cynefin chooses the class of move. OODA chooses and evaluates the next concrete move:

| OODA step | Chippy contract |
|---|---|
| **Observe** | Read the smallest current runtime, structure, source, or signal fact. |
| **Orient** | Compare it with the named domain, case invariant, existing evidence, and exact proof gap. |
| **Decide** | Choose one move allowed by the domain: recognize, analyze with a sensor, run a bounded experiment, or stabilize. |
| **Act** | Execute exactly that move, record what changed or was falsified, then observe again. |

OODA **Act** is not Chippy **Apply**. An OODA action may be a read-only probe, source read, analysis command, bounded active stimulus, or runtime stabilizer. It grants no independent permission to mutate the page or edit source. Active stimuli still require an anchor contract; source edits still require the [operating-model](operating-model.md) Apply gate and user intent.

Use one OODA cycle for a Clear answer and as many bounded cycles as the proof gap requires for Complicated or Complex work. In Chaotic work, the domain's act-first stabilizer runs before the normal evidence loop. Reposition when a cycle proves that the current domain no longer fits; do not relabel the task after every command.

## Mapping to Chippy primitives

| Chippy concept | Position or iteration role |
|---|---|
| Mise en Place | Read-only orientation that exits ❓ Disorder. |
| OODA | Repeat the next evidence move inside the named domain. |
| `probe-dom`, `probe-owners`, `probe-props` (read-only) | **Sensors** for ✅/🔍. |
| `describe-component`, `find-fibers`, `inspect-fiber-structure` | **Analysis tools** for 🔍. |
| `avalanche-arm`, `avalanche-commit-list`, `eval-page` snippets, tapped white-box tests | **Experiments** for 🌀. |
| `page-click`, `fiber-invoke`, `stability-nudge` | **Active-stimulus experiments** for 🌀 — require anchor contract. |
| `reload-with-avalanche`, `health` after disconnect | **Stabilizers** for 🔥. |
| Proof packet `confidence` field | Confidence reports the domain implicitly: `confirmed` = ✅/🔍, `likely`/`partial` = 🌀, missing = ❓. |
| Apply gate | Separates source editing from OODA Act. |

## Cross-domain anti-patterns

- **Clear-in-Complex:** confident one-line edit against an emergent cascade. Symptom: "this is probably the cause" without an experiment.
- **Complicated-in-Chaotic:** carefully analyzing a snapshot that is already stale. Symptom: reading a `clientId` from a prior turn instead of re-snapshotting.
- **Complex-in-Complicated:** spinning up experiments and avalanche captures when a documented `probe-owners` chain would resolve the question. Symptom: token-budget burn with no new signal.
- **Investigating-from-Disorder:** diagnosing, stimulating, or editing before read-only orientation establishes a domain. Symptom: treating the first unpositioned signal as proof.

## Cross-references

- [operating-model](operating-model.md) — phase contracts. Observe exits Disorder, Prove contains the OODA evidence loop, and Apply remains independently gated.
- [stability-render](stability-render.md) — canonical observable-SUT play for Complex stability questions.
- [bdd-router](bdd-router.md) — selects the procedure once the domain is named.
- [active-stimulus](active-stimulus.md) — anchor-contract rules for safe-to-fail experiments.
