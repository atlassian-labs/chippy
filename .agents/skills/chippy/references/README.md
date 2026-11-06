# Chippy reference guide

Choose the Chippy decision in front of you—position evidence, trace the page, investigate performance, automate a browser, parse a contract, or recover a failed path—then load only the owning reference. Each page owns one decision or contract.

## Start with the work

| Need | Read | What it gives you |
|---|---|---|
| Connect through an MCP-capable host | [MCP](mcp.md) | Automatic helper startup, typed tools, lifecycle, and sandbox requirements |
| Position an uncertain case | [Cynefin and OODA](cynefin.md) | The permitted evidence move for Clear, Complicated, Complex, Chaotic, or unpositioned work |
| Define proof and edit gates | [Operating model](operating-model.md) | Observation contract, proof packet, confidence rule, and Apply gate |
| Select an exact workflow | [BDD router](bdd-router.md) | Situation-to-procedure routing with completion checks |
| Execute the selected workflow | [Procedures](procedures.md) | P-01 and later ceremonies, procedures, and plays |
| Use a mutating or synthetic action | [Active stimulus](active-stimulus.md) | Anchor contract, pollution boundary, and recovery rules |

## Trace the page

| Need | Read | What it gives you |
|---|---|---|
| Interpret hook output | [Hooks inspection](hooks-inspection.md) | Hook tree reading, limits, and `useDebugValue` guidance |
| Automate probe handling | [Playwright probes](playwright-probes.md) | Probe lifecycle, measurement operations, and extension handoff |
| Work on minified Jira pages | [Jira taxonomy](jira-taxonomy.md) | Production-name patterns and bounded fallback signals |

## Investigate performance

| Need | Read | What it gives you |
|---|---|---|
| Capture and interpret commits | [Avalanche detector](avalanche-detector.md) | Capture modes, schemas, causality reading, unmounts, Suspense, and large-capture analysis |
| Choose the fix layer | [Fixing performance](fixing-performance.md) | Source/boundary/collateral classification and targeted remediation |
| Grade one subtree | [Stability render](stability-render.md) | Deterministic nudge procedure and clean/leak/cascade/trasher verdicts |
| Identify one captured hook | [Debug-hook](debug-hook.md) | Hook primitive, custom-hook ownership, confidence, and remediation branch |
| Count dispatches or recomputations | [Hook metrics](hook-metrics.md) | `setStateCount`, hook tracker actions, histograms, and Avalanche joins |

These pages are siblings, not substitutes. Start with Avalanche for a real slow interaction or load, use stability-render for a known subtree, and use debug-hook only when a capture already produced `sourceId + hookIndex`.

## Automate a browser

| Need | Read | What it gives you |
|---|---|---|
| Load Chippy into a Playwright-controlled page | [Playwright CLI setup](playwright-cli-setup.md) | The shortest current-document bootstrap and reload recovery recipe |
| Build a repeatable browser loop | [Test mode playbook](test-mode-playbook.md) | Sidecar and Playwright-controlled automation contracts |
| Load Chippy before page scripts, or record the initial load without the extension | [Mode A injection](mode-a-injection.md) | Init-script loader variants, pre-page start-up, boot-time limits, and failure signatures |

Use Playwright CLI setup for ad-hoc inspection. Use the test-mode playbook for scripted or CI workflows. Use Mode A injection when Chippy must stay across reloads or record the initial load in a Playwright browser.

## Look up a contract

| Need | Read | What it gives you |
|---|---|---|
| Find the recipe for a task or symptom | Run `chippy.sh recipes <query...>` against [the grep-friendly corpus](recipes.txt) | Ranked, self-contained answers with completion signals, guardrails, and canonical deeper references |
| Select a shell command | [Command surface](command-surface.md) | Complete public command catalog and important option modes |
| Parse a response | [Command output formats](command-output-formats.md) | Exact envelopes, DTOs, field semantics, and examples |
| Work in the page runtime | [Browser runtime API](browser-runtime-api.md) | Public globals, bridge API, and helper-to-page commands |
| Recover a failed path | [Troubleshooting](troubleshooting.md) | Failure signature, failing layer, and one recovery action |

The shell wrapper's `help` output owns mechanical command signatures. Recipe search owns task-to-answer lookup, command surface explains selection and boundaries, and command output formats owns exact response shapes.
