# Chippy development

This repository contains Chippy's reusable agent skill, browser extension,
runtime sources, and Storybook validation lab.

Write clear, professional prose in documentation and contributor-facing messages.

Read `.agents/skills/chippy/SKILL.md` before working in this repository.
Keep portable Chippy usage instructions in the skill; keep repository-specific
development and validation procedures in `.agents/references/` or the local
validation skill.

## Local responsibilities

- The Storybook lab validates Chippy against running React pages.
- Agents developing Chippy own local test infrastructure, including Storybook startup when required. The portable Chippy tool does not manage application servers.
- Local runtime setup, local URLs, and any repo-specific browser targets belong here, not in the skill.
- Linked external projects and symlink management belong here, not in the skill.

## Code organization

- Prefer small isolated modules with clear responsibility over adding more logic to large files.
- Before growing a long file, extract cohesive functionality into a named module with a narrow public API and focused tests.
- Keep hot-path code local only when measured/performance-sensitive; refactor setup, lifecycle, serialization, and helper logic around it.

## Chippy usage rules

- In normal work, trust Chippy runtime data. Probe results, source locations, owner chains, and bridge output are the source of truth.
- Exception: this workspace is also used to develop Chippy itself. When the task is improving Chippy, a runtime failure can be a real bug in Chippy rather than user error; validate and debug the tool honestly.
- When using Chippy, probe data overrides repo exploration order. Probe chain first, code second, grep last.
- For performance tracing, do not infer causality from hot components alone. Separate triggers from collateral.

## Investigation discipline

- There are known unknowns and unknown unknowns. There are no "known boundaries" unless proven by code, runtime evidence, tests, and documentation.
- Do not explain a replay/debug failure as a boundary from intuition. First connect the exact source, hook call sequence, stored fiber slots, and runtime trace.

## Chippy boundary

- Chippy is the tool, not the product under inspection.
- Do not put workspace/product-specific findings into shareable Chippy skill docs or references.
- Do not suggest fixing product code when the task is to improve Chippy itself.
- Keep app-specific findings ephemeral in chat unless the user explicitly asks to persist them project-locally.

## Chippy skill maintenance boundary

- The Chippy skill is an end-consumer instruction document. It helps agents use Chippy successfully and should expose only the runtime/usage details required for that goal.
- `playwright-local` is a workspace-local development/validation skill. It helps develop, validate, and iterate on Chippy in this workspace. Keep Storybook/local URLs, local browser/session routines, injection choreography for maintainer workflows, and other workspace-specific development mechanics there.
- Do not copy guidance from `playwright-local` into Chippy just because it was useful during local development. Promote only user-facing operational invariants that are necessary for normal Chippy usage across workspaces.
- If a rule exists to help maintain or validate Chippy itself, keep it in `.agents/references/` or `playwright-local`, not in the consumer Chippy skill.

## Task-specific references

Load a reference when its trigger applies; these workflows are not required for
every change.

| When | Read |
| --- | --- |
| Starting local servers or accessing a linked application's source | [Local environment](.agents/references/local-environment.md) |
| Automating the local Storybook lab | [Local browser skill](.agents/skills/playwright-local/SKILL.md) |
| Validating debug replay, bridge injection, or renderer registration | [Runtime validation](.agents/references/runtime-validation.md) |
| Adding or changing a bridge capability or snippet | [Bridge and snippet authoring](.agents/references/bridge-authoring.md) |
| Writing, changing, or reviewing code | [Code quality checks](.agents/references/code-quality.md) |
| Changing extension files or preparing a Chrome Web Store release | [Extension release](.agents/references/extension-release.md) |
| Publishing or syncing Chippy to the Atlassian skills registry | [Registry release](.agents/references/skills-registry-release.md) |
| Proving runtime or extension behavior through manual browser actions | [Manual verification](docs/chippy-manual-verification.md) |

Do not include `links/*` in repository-wide scans. Linked applications are local
workspace inputs and are not shipped with Chippy.
