---
name: chippy
description: Debug a running React page with live runtime evidence. Use to explore components (find by name, text, test id, file, or prop; explain structure and hooks), debug where an element, value, prop, or loading/error boundary comes from, compare two rendered states or pages, and investigate slow interactions, re-renders, and initial load with Avalanche commit capture. Connects a local helper to the page through the browser extension, an agent-driven Playwright browser, the helper's local proxy, the Storybook addon, or a console/module import; not for static code review without a running page.
allowed-tools: Bash(chippy.sh:*)
---

# Chippy

Chippy is a React debugger and a friendly one: it reads the running page so you
can explore, debug, compare, and investigate with evidence instead of guesses,
then helps the user understand what happened, find the cause, and fix it.

| Verb | Ask it | Start with |
|---|---|---|
| Explore | What renders here, what is inside it, and where does a value live? | `find-fibers` (`--grep` for values), `explain-component` |
| Debug | Where does this element, value, or boundary come from? | `probe-owners`, `probe-props`, `probe-boundaries` |
| Compare | What changed between two states or pages? | `fiber-state-capture` → `fiber-state-compare` |
| Investigate | Why is this slow or re-rendering? | `avalanche-arm`, `reload-with-avalanche` |

Use the running page as evidence. Connect visible React behavior to exact source, explain what the evidence proves, and verify any edit against the same signal.

## Start every task

1. If neither Chippy MCP tools nor this skill's scripts are installed, have the user run `npx skills add atlassian-labs/chippy --skill chippy -g`. Otherwise, resolve the absolute path of the directory that contains this `SKILL.md`, resolving symlinks. It may be a user-level or project-local install; do not assume a home-folder path or a copy in the current repository. Every path you run or give the user starts from that directory: `scripts/chippy.sh`, `scripts/chippy-mcp.cjs`, and the `extension` folder for **Load unpacked**. Prefer available Chippy MCP tools when permitted by the host; otherwise run this skill's `scripts/chippy.sh`.
2. With MCP available, use `chippy_status` → `chippy_pages` → `chippy_snapshot` (refresh, then read). MCP starts/reuses the helper automatically; follow [MCP setup and tools](references/mcp.md). MCP covers probe and fiber inspection, `find-fibers`, Avalanche capture and analysis, interaction, and annotation waits. Everything else is CLI-only, so use `scripts/chippy.sh` for it: compare (`fiber-state-*`), `page-boundaries`, `get-computed-style`, `probe-owner`, snippets (`eval-page`, including `perf-entries` and the hook-metrics snippets), `avalanche-arm`, `avalanche-recapture`, `reload-with-avalanche`, `avalanche-save` / `avalanche-offline`, `page-reload`, probe and status UI control, `recent-pages`, the proxy, `handoff-to-playwright`, and `recipes`. Otherwise run `health` → `pages` → `request-snapshot <clientId>`; helper-contacting shell commands must run outside the agent sandbox. The agent owns helper startup and command execution.
3. Select the page by URL, title, integration identity, and recency. When no page is connected, choose a route in [Connection and bootstrap](#connection-and-bootstrap); the extension is one route, not a prerequisite. Resolve a fresh `clientId` every turn; a reload or navigation can replace it. When two pages match closely, ask which page is in scope.
4. Use the first read-only signal to leave ❓ Disorder and name the Cynefin domain. Then iterate with OODA inside that domain: observe one fact, orient it to the invariant and proof gap, decide one permitted move, act, and observe again.
5. Choose the narrowest route below. Do not edit until the proof packet names the fix layer and a repeatable verification command.

`health`, `pages`, `request-snapshot`, and reads of existing probe state are orientation. Active stimuli, diagnosis, and source edits are not.

When a page connected in the user's own browser already has the target state, work there first. Use Playwright only when automation or replay is required, the user asks for it, or the connected page cannot provide the evidence.

## Route by question

Before `explain-component`, `describe-component`, or `inspect-fiber-structure`, run the [debug replay preflight](references/active-stimulus.md#debug-replay-preflight): name the exact target, disclose that replay can execute component and hook bodies, and use fiber-only summaries/props/owners instead when render-time execution is unsafe or cannot be accepted.

| Question or symptom | First route | Completion signal |
|---|---|---|
| What is Chippy's recipe for a task, symptom, command, or recovery path? | `recipes <query...> [--limit N]`; load only the returned canonical references when more detail is needed | The top record gives an executable answer, completion signal, guardrail, and deeper reference without loading the full recipe corpus. |
| Which components match a name, text, test id, source file, or prop? | `find-fibers <clientId> --name … / --text … / --testid … / --file … / --prop …` → `explain-component` or `inspect-fiber-props` on a returned `fiberId` | Matching fibers are listed with `fiberId`, component name, source, and owner. If `count` equals `--max`, narrow the filter or raise `--max` before treating the list as complete. |
| Which components hold a value, prop, state, or `useDebugValue` label that looks like X? | `find-fibers <clientId> --grep <regex> [--in props,state,debug]`, narrowed with `--name` / `--file`; add `debug` only after the [debug replay preflight](references/active-stimulus.md#debug-replay-preflight) | Each returned fiber lists `hits` with scope, path, and matched preview. `grep.note` reports `useDebugValue` callers left unsearched; `truncated: false` proves the walk finished. |
| Where does this visible element or value come from? | `probe-dom` → `probe-owners` → `probe-props` / `probe-prop-value` → open the reported file and line | Component, file, line/render block, and forwarding hops are named. |
| Walk the React fiber path from a probe or fiber | `probe-parents <clientId> <probeId>` for the `fiber.return` parent chain; use `explain-component <probeId>` → `inspect-fiber-parents <fiberId>` when starting from a remembered fiber | Parent/return-chain entries are named with hook counts, prop names, source/test-id context, or the exact runtime gap. `probe-owners` reads debug-build `_debugOwner`; on production builds it falls back to component parents labeled `ownerStackKind: "parents"`. |
| Which loading/error boundaries contain this target or partition the whole page? | `probe-boundaries <clientId> <probeId>` for the complete inner→outer chain; `page-boundaries <clientId>` for the page-wide boundary-only forest; `inspect-fiber-boundaries` for a remembered fiber | Every Error/Suspense boundary is reported with nesting distance, source, DOM block, `fiberId`, and current Suspense content/fallback state; `truncated: false` proves the requested view was complete. |
| What computed CSS does this element, an ancestor, or a descendant have? | `get-computed-style <clientId> <probeId> [parentLevel] [selector]`; matched rules travel in the probe snapshot's `matchedStyles` | The resolved `getComputedStyle` values are read for the exact probed node, its Nth DOM ancestor, or a `selector` match inside it. |
| What is inside this component? | `explain-component`; use `describe-component` for the detailed hook tree | The component's structure is described, with replay status and warnings disclosed. |
| What changed between two rendered states or pages? | `fiber-state-capture` before and after → `fiber-state-compare` | The bounded diff names matched fibers and added, removed, or changed props without returning either full capture. |
| Why is an interaction slow or re-rendering? | `avalanche-arm` → reproduce the interaction → `avalanche-status` → hot sources / commit list / commit peek | Trigger, hotspot, collateral, and fix layer are distinguished. |
| Why is initial load slow? | Confirm the page's route records the initial load ([Connection and bootstrap](#connection-and-bootstrap)) → `reload-with-avalanche` → status / hot sources / commit analysis | The measured load window is bounded and repeatable. |
| Does the user want render evidence in tests or scripts, with no agent at run time? | Point to the standalone Avalanche detector in the [npm package documentation](https://github.com/atlassian-labs/chippy/blob/main/docs/npm-package.md#standalone-avalanche) | The test installs the detector before React DOM loads and reads `detector.report()`. |
| Is this subtree stable? | Load [stability-render](references/stability-render.md) and run one controlled nudge | The capture yields clean, leak, leak+cascade, or trasher evidence. |
| Which hook is suspicious? | Use `avalanche-debug-hook` only after a capture identifies `sourceId + hookIndex` | Primitive/custom-hook ownership and next remediation branch are named. |
| Are state dispatches or memo/effect recomputations driving the cost? | Load [hook-metrics](references/hook-metrics.md) | A before/after counter or tracker result is joined to the same interaction. |
| Is a Context driving re-renders, or does the page use legacy context? | Follow [P-08](references/procedures.md): `eval-page <clientId> find-context-providers` → `eval-page <clientId> count-context-consumers --name <regex>`; `eval-page <clientId> find-legacy-context` for legacy context | Provider identity and consumer blast radius are measured, or legacy producer/consumer pairs are listed. |
| Does the task require browser automation? | If the user already placed P1/P2 on a connected page, run `handoff-to-playwright <clientId>` ([playwright-probes](references/playwright-probes.md)); otherwise load [playwright-cli-setup](references/playwright-cli-setup.md) for ad-hoc work or [test-mode-playbook](references/test-mode-playbook.md) for scripted/CI loops | The same interaction and structured evidence can be replayed. |
| Is the page production/minified? | Run `probe-owners`; it returns the component parent chain labeled `ownerStackKind: "parents"`. Entries with `minifiedName` and `definition` carry authored names that Chippy recovered from the page's source maps ([production component names](references/command-output-formats.md#production-component-names)). Then use `nearestTestId` and the component stack; on a Jira page, load [jira-taxonomy](references/jira-taxonomy.md) after those facts are exhausted | The result is bounded by the available production evidence; without source maps, names stay minified. |
| Is connection, injection, or capture broken? | Load [troubleshooting](references/troubleshooting.md) | The failing layer and one recovery action are explicit. |
| Should the current task wait for a newly attached browser intent? | `wait <clientId> [timeoutSeconds] [afterSequence]`; after handling one annotation, `ack` it, then wait again with the returned `cursor` while the user-requested loop remains active; stop after two consecutive empty timeouts | One annotation event is returned with its probe subject, intent, and comment, or the bounded wait times out. |

Use [bdd-router](references/bdd-router.md) when the situation needs the complete situation-to-procedure matrix. Use [procedures](references/procedures.md) only after the router selects a procedure.

## Evidence and edit gates

### Treat runtime facts as facts

- A probe identifies one exact DOM element rendered by one bundle. Its source location, fiber, owner chain, and marker coordinates are facts for that snapshot.
- Open `source.fileName` at `lineNumber` directly once it is an authored path. On React 19, an initial `http(s)` module URL is the generated fallback; read the following `*-source-resolved` snapshot or run `describe-component` before treating its line as a repository position. Do not grep for a file the probe already identified. Search is the last resort after the runtime-to-source chain is exhausted.
- Development source metadata is version-dependent: React <=18 supplies `_debugSource`; React 19 supplies `_debugStack`. Chippy filters dependency frames, fetches the served module in the page realm, decodes its inline or external source map, and republishes the authored file/line. It also corrects `_debugSource` lines that a dev-server transform shifted before JSX compilation, such as Vite's Fast Refresh header. `find-fibers`, `describe-component`, and `explain-component` return the mapped position. Absence of `_debugSource` alone is not production evidence.
- Read every returned field. Props, owner indices, keys, test IDs, hook counts, and source locations can each change the next move.
- Static source proves what code can do. Runtime evidence proves what happened in this run. Never promote code shape, a global's presence, or a hot component into a runtime cause.
- Screenshots confirm appearance; they do not replace probe, fiber, action, or commit evidence.

### Keep the proof loop bounded

Every case follows **Mise en Place → Observe → Define → Prove → Maybe Apply → Verify**:

- **Mise en Place:** stage the exact page and state, confirm helper connection, and select the first read-only signal.
- **Observe:** name the live page, probe, fiber, interaction, load window, or measured signal.
- **Define:** state the case, invariant, domain, scope, and missing fact.
- **Prove:** repeat bounded OODA moves until runtime, structure, source, and signal evidence agree or the exact gap is known.
- **Apply:** edit source only when user intent permits it and the proof packet identifies the fix layer, expected change, and repeatable verification.
- **Verify:** reproduce the same signal after HMR or reload. Automated work compares structured outputs, not one screenshot.

OODA **Act** is an evidence move; it is not Chippy **Apply**. Load [operating-model](references/operating-model.md) for the proof-packet and per-domain confidence contracts, and [cynefin](references/cynefin.md) for domain-specific moves.

### Ask before crossing these boundaries

- Before source edits, state in plain language what the probe resolved to, which layer the edit affects, and how the same signal will verify it.
- Before `page-click`, `fiber-invoke`, `fiber-schedule-update`, or `stability-nudge`, state the anchor contract: exact target, exact stimulus, and what becomes polluted or ambiguous afterward.
- Before `fiber-invoke`, prove the callback contract with `fiber-prop-contract` and source inspection. Never infer callback arguments from a prop name.
- When `confidence` is low or a probe resolves to `null`, request a fresh snapshot or refresh. Do not guess.

### Never substitute an easier-looking signal

- Do not mutate the running page instead of editing source.
- Do not create temporary globals or monkeypatch product behavior to answer an inspection question. Use documented commands or report the capability gap.
- Do not use ad-hoc Python, Node, jq reducers, or new snippets over Chippy output to answer inspection questions that existing commands cover. Use `probe-parents` / `inspect-fiber-parents` for `fiber.return` walking, `probe-owners` / `inspect-fiber-owners` for `_debugOwner`, and prepared command views first. Extracting one transport field for an automation harness is fine. If those commands prove a reusable evidence reduction is absent, add a first-class command or report the gap.
- Do not call a performance hotspot a trigger without causal evidence. Separate **trigger**, **hotspot**, and **collateral**.
- Do not clear probes, captures, or instrumentation while they remain the evidence anchor for an open investigation.

## React compatibility

Chippy requires no React or React DOM package patch. Avalanche uses DevTools
commit callbacks until a callback from an optional commit metrics adapter (the
built-in one is ATL) proves that host instrumentation is live; a seeded metrics
object alone does not establish support. Both callback orders produce one
capture per commit, with adapter counters preserved when supplied. Patch-specific
render/restart counters and dispatch/recompute metrics remain optional evidence.
The built-in Jira and ATL plugins are off by default. The user enables them in
the Chippy panel's settings, after which the page must reload; on a page already loaded,
`__AVALANCHE__.enablePlugins(['jira', 'atl'])` enables Jira for later probes and
ATL for the next Avalanche install, without initial-load metrics. `status().metricsAdapter` names the active adapter; `listPlugins()` lists the registered plugins and which ones run.
React must see the DevTools hook when its renderer evaluates for commit capture
and dispatcher-backed replay; importing Chippy afterward cannot retroactively
register a renderer. Use fiber-only reads when that integration is unavailable.

## Connection and bootstrap

Chippy has a local helper and one page-side integration. `chippy_pages` or
`chippy.sh pages` is connection truth. The optional stdio MCP adapter manages
helper startup without a shell command; it needs host access to the browser's
network environment. Closing an MCP session preserves the shared helper.

Each route below loads the same page runtime. The extension is one delivery route; choose by who owns the browser and whether the task needs initial-load capture.

| Route | Who sets it up | Reload behavior | Initial-load capture |
|---|---|---|---|
| Browser extension | User, once per browser and origin | Re-injects automatically for enabled origins. | Yes, with `reload-with-avalanche`: the armed reload runs the early scripts at `document_start`. |
| Agent-driven Playwright browser | Agent; no extension | Init scripts load again on every navigation; the ad-hoc import must be repeated. | Only with the [pre-page start-up](references/mode-a-injection.md#pre-page-start-up) variant, which installs the detector before React on every document. The packaged loader and the ad-hoc import start the detector after connection. |
| Local proxy (`proxy-start <targetPort> [originalUrl]`) | Agent; the user or Playwright opens the page on the helper port | The proxy adds Chippy to every load of the `originalUrl` path, so pass `originalUrl`. | Yes, with `reload-with-avalanche`: the shim and Avalanche run before page scripts. Targets on this machine only. |
| Storybook addon (`addons: ['@atlassian/chippy/storybook']`, Storybook 10.3+) | User, in the Storybook configuration | `page-reload` uses Storybook `FORCE_REMOUNT` to remount the SUT without reloading the preview iframe. | The story's mount, through the remount. |
| Console/module import, including `connectChippy()` from `@atlassian/chippy/browser` | User or page code, in the current document | Full reload/navigation removes Chippy; run the import again. | No: use mid-page capture. |

The extension toolbar popup shows the Chippy mark and name with Enable and Disable for the current origin. The in-page UI starts as one small bottom-corner Chippy button. Expand it to reveal compact `P1 — drag to source` and `P2 — drag to source` rows; each row is the probe's dock and expands into its details once placed. Dragging a probe out keeps the panel expanded, and a placed probe is document-anchored so it moves with its target during page scroll. The gear contains the helper URL and the Jira and ATL plugin switches. Active probes: Choosing Explain or Investigate sends the annotation; Change stays a draft until Enter is pressed in the comment, and Enter also sends any edited comment; Shift+Enter inserts a newline. The probe then shows it as queued for the agent until the agent acknowledges it. Storybook intentionally keeps its probe dock in the preview because its details panel lives in the manager frame.

Each connected page reports `integration.kind`, `who`, `source`, `reinjectsOnReload`, and `reloadAction`. Use those fields instead of inferring how Chippy arrived.

### Iframes

Each frame that loads Chippy, same-origin or cross-origin, connects as its own page with its own `clientId`. Every command targets one frame: to read or click inside an iframe, use the iframe's client, not its parent's. `page.frame` in `pages` places a client in the frame tree: `isTop`, `path` (frame indexes from the top window), `parentClientId`, `topClientId`, and `childClientIds`. A link appears only when Chippy runs in both frames and both confirm it. Select a frame client by its `page.url` and its `page.frame` link; never assume the top page's client covers iframe content.

- Extension: enabling an origin enables Chippy in every frame of that origin, including an iframe inside a page whose origin is not enabled. Chippy is not injected into that parent page.
- Playwright: pre-page init scripts run in every frame. For the ad-hoc import, evaluate the import in each `page.frames()` entry you need.
- Console import: run it in the iframe's context (DevTools console context selector).
- Proxy: only the document whose path matches `originalUrl` gets Chippy.

An iframe connects without showing the Chippy panel, so the user sees one panel, on the top page. When the user asks for Chippy in an iframe, run `activate <clientId>` on that frame's client. The frame remembers the choice under its address and shows the panel again when it loads; `page.frame.panelRemembered` reports it. `deactivate <clientId>` hides the panel and forgets the choice. `ensure-probes` shows probes in a frame without remembering.

An explicitly user-driven integration, such as the Storybook addon or a console import, takes precedence over the extension, which stands down while that owner is live. On a Storybook page, `pages` reports the `storybook` integration, not `extension`; read `integration.kind` instead of inferring the owner.

For a user-controlled page without the extension, run this in the browser console:

```js
import('http://127.0.0.1:7823/__chippy/inject.mjs')
```

The single `import(...)` is all that is needed: the ESM bootstrap installs Chippy, loads the Avalanche bridge runtime (so fiber-backed reads and captures work immediately — no second asset), and activates probes for the current document. It renders no in-page control panel/overlay. When the user wants to place probes without the extension, import `http://127.0.0.1:7823/__chippy/inject.mjs?ui=panel` instead; it adds the same P1/P2 launcher and panel, without the settings gear. After reload or navigation, import again. A strict Content Security Policy blocks the import; on a local dev server, use the proxy instead, which removes the page's CSP headers.

For pages where reload destroys Chippy (console import or `connectChippy()`), **do not use `reload-with-avalanche`**. The correct workflow is mid-page capture: import Chippy once, install/arm Avalanche on the live page (`avalanche-install` or `avalanche-arm`), then trigger a controlled render stimulus such as `fiber-schedule-update` / the stability nudge. `reload-with-avalanche` is for routes that load Chippy before page scripts on the reloaded document: the extension, the local proxy, and the Storybook addon. On Storybook, its reload step is a `FORCE_REMOUNT` of the current SUT, not an iframe navigation. A Playwright page with the pre-page start-up variant installs the detector on every document itself, so a plain `page.reload()` captures the load.

The helper serves matching source maps alongside its Avalanche bundles; browser
developer tools can resolve the runtime frames without missing-map requests.

For an agent-driven Playwright browser, follow [mode-a-injection](references/mode-a-injection.md) for the loader variants and their capture limits, and [playwright-cli-setup](references/playwright-cli-setup.md) for ad-hoc `playwright-cli` sessions. The classic fallback requires `inject.js` followed by `avalanche.iife.js`; `bridge module not loaded` means the second asset is missing.

### Explicit wait mode

`wait <clientId> [timeoutSeconds] [afterSequence]` performs one cancellable long poll inside the current agent turn. It returns the oldest `marker-annotation-change` event after the cursor, or waits for the next one. Reading does not remove events, so always pass the previous result's `cursor` when you wait again; an event that arrived between waits then comes back immediately. A timeout is an ordinary empty result, not a failure. `missed: true` means events were evicted before you read them; tell the user. When the user explicitly requests a loop, handle the returned annotation, run `ack <clientId> <sequence>` so the page clears that note and shows it done, and invoke `wait` again with the cursor. Stop when the task is interrupted, the user ends loop mode, or two consecutive waits time out with no annotation and no user message. Then tell the user the loop stopped and give the last cursor; annotations sent later stay in the log, so the next wait from that cursor still returns them. Do not keep re-arming an idle loop. Acknowledge only after you finish the annotation.

Chippy owns only its browser integration, helper queue, and explicit commands. It must not discover, install, edit, merge, or depend on Codex, Cursor, Claude, or other host lifecycle hooks. If an environment cannot keep an ordinary tool call open, report that capability gap instead of taking over host configuration.

### Runtime globals

Only these globals are public Chippy state:

| Global | Meaning |
|---|---|
| `window.__CHIPPY` | Chippy core is loaded. |
| `window.__AVALANCHE__` | Avalanche and bridge-backed capabilities are loaded. |

Global presence proves loading, not behavior. Verify callbacks and integrations through page summaries, command output, probe output, commit count, or another observed state transition. Do not use lowercase variants or `window.__chippyPageBridge` as a top-level success signal.

## Command surface

Run commands from the skill directory as `./scripts/chippy.sh <command> [args]`. Every command that contacts the helper must run outside the sandbox. Do not ask the user to run it. Do not append `&` to `start`; the wrapper manages background startup.

The public shell contract is:

```text
start | stop | health | inject-url
recipes <query...> [--limit N]
pages [slice] | recent-pages | page <clientId> [slice]
snapshot <clientId> [slice] | request-snapshot <clientId>
wait <clientId> [timeoutSeconds] [afterSequence] | ack <clientId> <sequence>
activate <clientId> | deactivate <clientId>
context-ui <clientId> <on|off>
ensure-probes <clientId> | clear-probes <clientId>
show-status <clientId> <text> | hide-status <clientId>
command <type> [clientId]

get-computed-style <clientId> <probeId> [parentLevel] [selector]
probe-dom <clientId> <probeId> [parentLevel]
probe-parents <clientId> <probeId> [max]
probe-boundaries <clientId> <probeId> [max]
probe-owners <clientId> <probeId>
probe-owner <clientId> <probeId> <ownerIndex>
probe-props <clientId> <probeId> [ownerIndex]
probe-prop-value <clientId> <probeId> <propName> [ownerIndex]
probe-hooks <clientId> <probeId>
probe-hooks-summary <clientId> <probeId>

page-click <clientId> <selector|probeId|fiberId>
fiber-prop-contract <clientId> <fiberId> <propName>
fiber-invoke <clientId> <fiberId> <propName> [--args JSON]
fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]
find-fibers <clientId> [--name regex] [--file regex] [--prop name] [--testid regex] [--text regex] [--grep regex [--in props,state,debug|all] [--depth N]] [--max N]
fiber-state-capture <clientId> [label] [maxFibers]
fiber-state-list
fiber-state-compare <beforeCaptureId> <afterCaptureId> [maxChanges]
page-boundaries <clientId> [max]
inspect-fiber-hooks <clientId> <fiberId>
inspect-fiber-hooks-summary <clientId> <fiberId>
inspect-fiber-props <clientId> <fiberId>
inspect-fiber-owners <clientId> <fiberId>
inspect-fiber-parents <clientId> <fiberId> [max]
inspect-fiber-boundaries <clientId> <fiberId> [max]
inspect-fiber-structure <clientId> <fiberId> <hookIndex> [windowSize]
explain-component <clientId> <probeId|fiberId|name> [--text|--json|--complexity]
describe-component <clientId> <fiberIdOrName> [--text|--json]

avalanche-clear <clientId>
avalanche-status <clientId>
avalanche-export <clientId> [lastN]
avalanche-hot-sources <clientId> [limit]
avalanche-commit-list <clientId> [top] [by]
avalanche-commit-peek <clientId> <commitId> [include] [depth] [maxItems]
avalanche-describe-action <clientId> <actionId>
avalanche-install <clientId> [detectionMode]
avalanche-recapture <clientId> [detectionMode]
avalanche-debug-hook <clientId> <sourceId> <hookIndex> [window]
avalanche-save <clientId> <file> [count]
avalanche-offline <file> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search> [args...]
avalanche-arm <clientId> <origin> [maxCommits] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]
avalanche-disarm <clientId> <origin>
reload-with-avalanche <clientId> <origin> [maxCommits] [timeoutMs] [settleMs] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]

eval-page <clientId> <snippet-file-or-name> [--key value ...]
eval-snippets
page-reload <clientId>
page-wait-reload <clientId> [timeoutMs]
handoff-to-playwright <clientId> [url] [probeIdsCsv] [browserName] [headless]
proxy-state | proxy-start <targetPort> [originalUrl] | proxy-stop
```

`recipes` is a local, dependency-free search over `references/recipes.txt`; it does not contact the helper or page. The corpus keeps one complete recipe per line for direct `rg`/`grep` lookup. The command streams the corpus twice to compute a BM25-style rank with prefix and one-edit typo matching, retains only the requested top results, defaults to five, and accepts limits from 1 through 20.

For before/after investigation, run `fiber-state-capture` in each state, including on different connected pages, then compare the returned `state:*` ids. Captures fingerprint every named fiber's props and stay inside helper memory; commands return only capture summaries and a bounded structural diff. Matching first uses structural ancestry and then a unique component/source/key token when wrappers differ. Function props compare by name and arity, not closure identity. Captures are read-only, survive page navigation or disconnect while the helper remains running, and are evicted oldest-first after 20 entries.

Use [command-surface](references/command-surface.md) to select a command and understand important modes. Use [command-output-formats](references/command-output-formats.md) when exact JSON or response semantics matter. The shell wrapper's `help` output is the mechanical signature check.

## Probe and fiber interpretation

- Normalize `1`, `P1`, and `p1` to probe 1; likewise for probe 2.
- P1 and P2 are user-placed DOM markers. P3 is computed only when both are placed and represents their nearest shared DOM-backed fiber.
- Every marker snapshot carries `intent: "explain" | "investigate" | "change" | null` and `comment: string`. Read these before routing the question: the developer attached them to the exact probed subject. Preserve the comment's wording, but treat it as request context rather than runtime evidence. An attached `change` intent does not independently authorize work beyond the current task.
- Probe annotations travel with snapshots and are also logged when the page publishes `marker-annotation-change`. They do not wake an idle task; `wait` works by keeping an explicitly requested tool call open inside the current turn.
- `nearestTestId` is the nearest `data-testid` ancestor, including the element itself. It may be `null`.
- Read a resolved marker in this order: `nearestTestId` → confidence/note → DOM source → component source/name/key → props/prop names → hook count → owners → parents/component stack → matched styles.
- `ownerIndex` is positional: `0` is the immediate owner, `1` its owner, and so on. Do not address owners by a possibly repeated display name.
- If a probe lands on a wrapper, overlay, icon, or container, walk deterministically. Use `probe-dom [parentLevel]` for DOM ancestors, `probe-parents` for the React `fiber.return` chain, and `probe-owners` for `_debugOwner` ownership (check `ownerStackKind`; `parents` means no owner data exists). Do not replace coordinate truth with guessed intent.
- When `markers[id].context` is non-null, read its `boundaries` after the generic component/source evidence: `{ error, suspense, ... }`, each with a `distance` (fiber hops from the probe). `error` and `suspense` are fiber-native React primitives and appear on any React page. Registered context providers can add boundary kinds; the built-in Jira provider, when enabled, adds `owner`, the Jira semantic/team owner (not the React render owner). Each block is clickable and reports an `inspect-boundary` signal to the backend (surfaced as `lastInspectedBoundary`). Both the in-page panel and the Storybook addon render the same three boundaries.
- Snapshot boundary cards remain a compact nearest-boundary view. Use `probe-boundaries` when the full rendered parent chain matters, and `page-boundaries` when the question is page partitioning rather than one leaf. These commands are read-only and do not use debug replay.

For a value trace, use this chain once:

```text
probe-dom → probe-owners → probe-props / probe-prop-value → exact source file:line
```

When the value is known but not where it renders, or it never reaches the DOM, start with `find-fibers <clientId> --grep <regex>` instead of placing a probe. Each hit names the fiber and the path (`props.…`, `hook[N:Family]…`, `state.…`, `debug(<customHook>)`); continue with `inspect-fiber-props`, `inspect-fiber-owners`, or `explain-component` on the returned `fiberId`.

`useDebugValue` labels are the most reliable way to make custom-hook state findable: a label names the hook's meaning, while raw state is anonymous. When a custom hook's state is hard to identify, or the same question will be asked again, recommend that the user add `useDebugValue(label)` (or `useDebugValue(value, format)`) to that hook. Chippy then finds it with `--grep <label> --in debug` after the [debug replay preflight](references/active-stimulus.md#debug-replay-preflight). Labels exist only in development builds. This is a suggestion for the user's code, not a page mutation; do not add it without the user's consent.

When `hookCount > 50`, `parents > 50`, or `matchedStyles > 20`, map structure before drilling in. Use `explain-component` for the compact view and `describe-component` for the detailed hook listing. Both may attempt dispatcher-based debug replay, which executes component and hook bodies without scheduling an application update; check `replayStatus` and `warnings`. When replay is unavailable, the commands degrade to fiber-only evidence. Collapse repeated hook families unless the user asks for every hook.

## Performance evidence

Choose capture mode from the symptom:

| Symptom | Capture | Important boundary |
|---|---|---|
| Slow click, typing, scroll, route interaction, or live re-render | `avalanche-arm`, then reproduce, then read | Do not reload; capture the real interaction. |
| First paint, cold start, or initial-load settling | `reload-with-avalanche` | It reloads and may lose early commits; tune the settle window before blaming injection timing. |
| Layout shift, long frame, slow interaction (INP), or late LCP | Either capture above, then `eval-page <clientId> perf-entries` | Entries are matched to commits by time: proximity, not cause. Only interactions of 104 ms or more are buffered. |

Read broad to narrow: `avalanche-status` → `avalanche-hot-sources` → `avalanche-commit-list` → one `avalanche-commit-peek`. Do not open the full export first. Expand a `latestAction` id with `avalanche-describe-action`. When a capture is large or will be read more than once, run `avalanche-save <clientId> <file>` once, then read it with `avalanche-offline <file> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search>`.

Arm before the user or harness performs the slow interaction. Probes drill into the captured wave afterward; do not make probe placement a prerequisite for starting the recorder.

Each commit records `ticks`, the render slices React ran for it: `1` is a render finished in one task, more means a time-sliced or repeated render, and `null` means the page exposes no signal (see `meta.renderTicks.reason`). Rank them with `avalanche-commit-list <clientId> 20 ticks`. Commit timings (`commit-peek ... timing`) are absolute `performance.now()` values on the page clock, shared with `PerformanceObserver` entries and DevTools traces. The `perf-entries` snippet reads the browser's buffered layout shifts, long animation frames, slow interactions, LCP, FCP, and TTFB, names the component behind each shift source, interaction target, and LCP element, and lists the commits near each entry. Use it when the symptom is a browser metric, then read the listed commits with `commit-peek`.

`latestAction` is a clue, not causality. A confirmed root cause needs a source-to-collateral chain or source code that proves the update origin. Unmount and Suspense fields are branch signals; report DOM regions before wrapper names when the question is about DOM teardown.

Every mode records which components rendered and their prop changes (`commit-peek include=rendered`). `stats` leaves `isSelfSource` false, and only `full` or `amplifiers` fill `trasherCounts`. When amplifier evidence is required and triage began in the default `sources` mode, run `avalanche-recapture <clientId> full`, reproduce the identical interaction, and only then read `trasherCounts`. Load [avalanche-detector](references/avalanche-detector.md) for exact schemas and [fixing-performance](references/fixing-performance.md) for fix-layer selection.

## Snippets and active stimuli

`eval-page` executes a version-controlled snippet from `snippets/` in the page realm and returns a circular-safe JSON envelope. It uses helper HTTP/WebSocket transport; Playwright is not required.

- Prefer a snippet for one-off probes, reproducible procedures, or composed stimuli.
- Promote a reusable, round-trip-sensitive capability to the bridge and keep its procedure in a snippet.
- Read-only snippets may inspect fibers and page state. Stateful or active snippets must document their ownership and anchor contract.
- `stability-nudge` schedules one extra render via the first-class `fiber-schedule-update` capability. It does not mutate a hook or prop, but the extra commit and any effects it runs are the stimulus.
- `hook-tracker` owns the host `onHookUpdate` callback until uninstall and persists state on `window.__CHIPPY_HOOK_TRACKER`.

Use [snippets/README.md](snippets/README.md) for the snippet contract and catalog.

## Report and stop

Every finding uses this shape:

```text
📏 probe resolved to: <ComponentName> @ <file>:<line>
   value source: <prop/hook/selector/fragment> from <OwnerName> @ <file>:<line>
   domain: ✅ clear | 🔍 complicated | 🌀 complex | 🔥 chaotic
   confidence: confirmed | likely | partial
   next gap: <exact missing fact, or "none">
```

`confirmed` belongs to Clear or Complicated evidence. Complex evidence is `likely` only when the same safe-to-fail experiment is repeatable; `partial` never passes the Apply gate. Chaotic and Disorder cases cannot pass the gate.

Chippy is terse, factual, and warm. Use the house emojis only when they add signal: 📏 measuring, ✂️ editing, 🤓 following a rule, 📋 checking permission, 🙈 clean integration, 🚫 declining out-of-scope work, 👷 flagging risky work. Plain language goes to the user; fibers and hook slots stay in the internal evidence trail unless the user is developing Chippy itself.

Stop when the requested answer is proven, the requested edit is verified against the same signal, or the exact unavailable capability is reported. Do not offer an investigation menu after the evidence already selects the next move.

## Reference map

Open only the reference selected by the current condition. [The reference index](references/README.md) is the maintainer-facing map.

| Condition | Reference |
|---|---|
| Configure MCP, understand automatic startup, or select a typed tool | [MCP](references/mcp.md) |
| Position the work and choose evidence moves | [cynefin](references/cynefin.md), [operating-model](references/operating-model.md) |
| Select a procedure | [bdd-router](references/bdd-router.md), then [procedures](references/procedures.md) |
| Use an active stimulus | [active-stimulus](references/active-stimulus.md) |
| Capture or interpret React commits | [avalanche-detector](references/avalanche-detector.md) |
| Choose the performance fix layer | [fixing-performance](references/fixing-performance.md) |
| Grade a subtree with a controlled nudge | [stability-render](references/stability-render.md) |
| Inspect a captured hook or hook metrics | [debug-hook](references/debug-hook.md), [hooks-inspection](references/hooks-inspection.md), [hook-metrics](references/hook-metrics.md) |
| Automate the page | [playwright-cli-setup](references/playwright-cli-setup.md), [playwright-probes](references/playwright-probes.md), [test-mode-playbook](references/test-mode-playbook.md), [mode-a-injection](references/mode-a-injection.md) |
| Look up shell signatures or response shapes | [command-surface](references/command-surface.md), [command-output-formats](references/command-output-formats.md) |
| Find a task recipe without loading broad references | `chippy.sh recipes <query...>`, backed by [recipes.txt](references/recipes.txt) |
| Inspect browser/runtime APIs | [browser-runtime-api](references/browser-runtime-api.md) |
| Read Jira wrapper and ownership names (Jira pages only) | [jira-taxonomy](references/jira-taxonomy.md) |
| Recover a failed runtime | [troubleshooting](references/troubleshooting.md) |
