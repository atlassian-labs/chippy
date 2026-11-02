# Chippy manual verification

Use this questionnaire when the browser-extension path must be proven against a real, user-controlled Chrome page. The agent owns infrastructure, commands, and evidence; the user receives one visible browser action at a time.

Automated tests can shorten this procedure, but they cannot establish that the Web Store extension connected to the user's page. Complete only the checks required by the changed behavior, then report the measured pass/fail result for each one.

## Operating contract

- **Agent owns infrastructure.** Start Storybook, start/stop Chippy helper, run `health`, `pages`, `request-snapshot`, `find-fibers`, `fiber-*`, and `avalanche-*` commands.
- **User owns the browser.** Ask the user only to open a URL, enable the extension origin, reload, click a visible button, or say `done`.
- **One question at a time.** Do not paste a full checklist. Ask for one action, wait for `done`, verify, then continue.
- **Verify before advancing.** Every user `done` must be followed by an agent-side command that proves the expected state transition.
- **State pass/fail per step.** If verification fails, stop the questionnaire and report the exact failing signal and next recovery action.
- **Never claim manual verification from automated tests.** Automated tests can make the questionnaire shorter, but the extension path is only verified by a connected browser page.
- **Re-resolve fibers after commits.** A `fiber:*` registry token may remain present, but React can replace the current alternate after a state update. Every step that needs a `fiberId` must call `find-fibers --testid <id> --max 5` immediately before `fiber-prop-contract`/`fiber-invoke`; never reuse a token across a state-changing invoke, HMR, navigation, or reload.
- **Verify state, not just return value.** A passing `fiber-invoke` return value does not prove React updated. For function components, pair each state-mutating invoke with `inspect-fiber-hooks-summary` or `probe-hooks-summary` before/after. For class components, re-resolve before each invoke and verify the class's visible state from a fresh snapshot after each call.

**Command notation:** in the questionnaire below, every bare subcommand means `.agents/skills/chippy/scripts/chippy.sh <subcommand>`. The shortened form keeps the repeated wrapper out of the evidence checklist; execute all of them through that public shell wrapper.

## Prepare the fixture

1. Start Storybook in the background from workspace root:

   ```bash
   yarn storybook &
   ```

   Wait until the target URL responds.

   This command starts the dedicated manual-fixture server on port 6006, as defined by the workspace `storybook` script. It is separate from the layout-lab manager on port 6007.

2. Start Chippy helper from the skill directory:

   ```bash
   .agents/skills/chippy/scripts/chippy.sh stop
   .agents/skills/chippy/scripts/chippy.sh start
   .agents/skills/chippy/scripts/chippy.sh health
   ```

3. Prepare the target story URL. For the manual fixture story:

   ```text
   http://127.0.0.1:6006/iframe.html?id=avalanche-manualextensionverification--default&viewMode=story
   ```

4. Ask the user:

   ```text
   Open this page in Chrome, enable the Chippy extension for 127.0.0.1, hard-reload (Cmd+Shift+R) the page, then reply "done". If a later command returns `bridge module not loaded`, the Avalanche bundle is absent: confirm the extension remains enabled, hard-reload once, and verify the page connection again.
   <URL>
   ```

5. On `done`, verify connection:

   ```bash
   .agents/skills/chippy/scripts/chippy.sh pages
   .agents/skills/chippy/scripts/chippy.sh request-snapshot <clientId>
   .agents/skills/chippy/scripts/chippy.sh page <clientId>
   ```

   Pass criteria: connected page URL matches the story; snapshot is fresh. If no page appears, ask the user to check the extension popup and reload; do not continue.

## Run one question at a time

For each manual check:

1. Agent asks one concrete browser action.
2. User performs it and says `done`.
3. Agent runs Chippy commands to verify.
4. Agent records `PASS` / `FAIL` and only then asks the next action.

Use this phrasing style:

```text
Step N — <capability>
Please <one browser action>. Reply "done" when complete.
```

Then agent verifies:

```bash
# one or more Chippy commands
```

Then agent reports:

```text
PASS — <measured signal>. Next: <next question>.
```

or:

```text
FAIL — expected <signal>, got <actual>. Recovery: <single next action>.
```

## Fiber-invoke and rendered-evidence questionnaire

Use with story `Avalanche/ManualExtensionVerification`.

### Step 1 — connection

Ask user to open the story, enable extension, reload, say `done`. Verify with `pages` + `request-snapshot`.

### Step 2 — fiber-invoke happy path

Agent finds the happy button:

```bash
find-fibers <clientId> --testid manual-on-happy --max 5
inspect-fiber-hooks-summary <clientId> <fiberId>   # baseline
fiber-prop-contract <clientId> <fiberId> onClick
fiber-invoke <clientId> <fiberId> onClick --args '[]'
request-snapshot <clientId>
page <clientId> full
find-fibers <clientId> --testid manual-on-happy --max 5
inspect-fiber-hooks-summary <clientId> <postFiberId>
```

Pass criteria:
- contract has `ok: true`, `isFunction: true`
- invoke has `ok: true`, `invoked: true`, `returnValue: "happy-ok"`
- pre/post hook summaries show `happyCount` increased by one and `lastAction` became `"happy"`
- refreshed snapshot / page text shows `happy=1` and `last=happy`

### Step 3 — fiber-invoke throwing callback

Agent invokes the throw button:

```bash
find-fibers <clientId> --testid manual-on-throw --max 5
fiber-prop-contract <clientId> <fiberId> onClick
fiber-invoke <clientId> <fiberId> onClick --args '[]'
```

Pass criteria:
- command returns promptly
- result has `ok: false`, `threw: true`, `error: "manual-fixture-boom"`, `stack`
- no hanging request

### Step 4 — fiber-invoke async callback

Agent invokes the async button:

```bash
find-fibers <clientId> --testid manual-on-async --max 5
inspect-fiber-hooks-summary <clientId> <fiberId>   # baseline
fiber-prop-contract <clientId> <fiberId> onClick
fiber-invoke <clientId> <fiberId> onClick --args '[]'
request-snapshot <clientId>
page <clientId> full
find-fibers <clientId> --testid manual-on-async --max 5
inspect-fiber-hooks-summary <clientId> <postFiberId>
```

Pass criteria:
- result has `ok: true`, `async: true`, `returnValue.asyncOk: true`
- pre/post hook summaries show `asyncCount` increased by one and `lastAction` became `"async"`
- refreshed page text shows `async=1` and `last=async`

### Step 5 — class component `this` binding

Agent invokes the class button twice:

```bash
find-fibers <clientId> --testid manual-on-class --max 5
fiber-prop-contract <clientId> <firstFiberId> onClick
fiber-invoke <clientId> <firstFiberId> onClick --args '[3]'
request-snapshot <clientId>
page <clientId> full
find-fibers <clientId> --testid manual-on-class --max 5
fiber-prop-contract <clientId> <secondFiberId> onClick
fiber-invoke <clientId> <secondFiberId> onClick --args '[3]'
request-snapshot <clientId>
page <clientId> full
```

Pass criteria:
- first return value is `3`
- first refreshed page state shows `classCount=3`
- second return value is `6`
- refreshed page text shows `classCount=6`

### Step 6 — non-callable guard

Agent proves a string prop cannot be invoked:

```bash
find-fibers <clientId> --testid manual-on-happy --max 5
fiber-prop-contract <clientId> <fiberId> data-manual-label
fiber-invoke <clientId> <fiberId> data-manual-label --args '[]'
```

Pass criteria:
- contract has `isFunction: false`
- invoke has `ok: false`, `error` containing `not a function`, `propType: "string"`

### Step 7 — renderedByCommit / trasher evidence

Agent arms full-mode Avalanche:

```bash
avalanche-install <clientId> full
avalanche-status <clientId>
```

Ask user:

```text
Click "trigger trasher" once, then reply "done".
```

On `done`, verify:

```bash
avalanche-status <clientId>
avalanche-commit-list <clientId> 20 sources
avalanche-commit-peek <clientId> <commitId> stats,sources,rendered 3 50
```

Pass criteria:
- commit count increased
- `commit-peek` accepts `rendered`
- `renderedTotal > 0`
- rendered entries include `sourceId`, `name`, `parentId`, `isSelfSource`, `propChanges`, `trasherCounts`
- for the fixture's `TrasherChild`, `propChanges` shows `ref-changed` for `payload` and/or `onReport`
- at least one relevant entry has non-zero `trasherCounts.effects` or `trasherCounts.memos`

If `rendered` is empty, stop and recover in this order: reload, reconnect and resolve the current `clientId`, run `avalanche-install <currentClientId> full`, run `avalanche-clear <currentClientId>`, then repeat the trigger. Reload discards the prior detector instance. Do not mark the step passed with empty rendered evidence.

### Step 8 — probes

Ask user:

```text
Drag Probe 1 in the Chippy extension onto the "happy callback" button on the page. Reply "done" when placed.
```

On `done`, verify:

```bash
request-snapshot <clientId>
probe-dom <clientId> 1 0
probe-owners <clientId> 1
probe-props <clientId> 1 0
```

Pass criteria:
- `probe-dom` returns the `button` with matching `data-testid` and `innerText`.
- `probe-owners` returns the owning component (e.g. `FunctionInvokePanel`) with non-zero `hookCount`.
- `probe-props` returns the owner-chain prop snapshot without error.

If `probe-dom` returns `"No probe data for 1"`, the probe was not placed — ask the user to re-drag and reply `done` again. Do not continue.

### Step 9 — fiber-invoke causes real React state update

Agent runs, no browser action needed:

```bash
find-fibers <clientId> --testid manual-on-happy --max 5
probe-hooks-summary <clientId> 1          # baseline live state
fiber-prop-contract <clientId> <fiberId> onClick
fiber-invoke <clientId> <fiberId> onClick --args '[]'
request-snapshot <clientId>
probe-hooks-summary <clientId> 1          # post-invoke live state
```

Pass criteria:
- `returnValue: "happy-ok"`.
- Baseline `valueHints[0].value` (happyCount) is N; post-invoke is N+1.
- Baseline `valueHints[2].value` (lastAction) differs from post-invoke value (post must be `"happy"`).

Fail criteria:
- Return value correct but live state unchanged → invoke did not reach React state setter; investigate `this` binding, args, or fiber identity.

### Step 10 — agent-stimulated re-render via `page-click`

Agent runs, no browser action needed:

```bash
avalanche-recapture <clientId> full
page-click <clientId> "[data-testid=manual-trasher-tick]"
sleep 2
avalanche-status <clientId>
avalanche-commit-list <clientId> 10 sources
```

Pass criteria:
- `page-click` returns `ok: true`, target tag `button`, testId `manual-trasher-tick`.
- `commitCount > 0` after the click.
- Latest commit `latestAction.action: "click"`, `latestAction.dom.nearestTestId: "manual-trasher-tick"`, `targetFiber.name: "TrasherPanel"`.

Then:

```bash
avalanche-describe-action <clientId> <actionId>
```

Pass criteria:
- `action.action: "click"`, full `targetFiber.source` with `fileName` + `lineNumber`, `ownerStack` includes `ManualExtensionVerification`.

### Step 11 — agent-stimulated re-render via `stability-nudge` (optional)

`stability-nudge` resolves a test-id or probe DOM target and walks to the nearest composite fiber. The component may be hookless; the capability schedules one render and mutates no hook or prop.

Agent runs:

```bash
eval-page <clientId> stability-nudge --testId rendered-by-commit-panel --label manual-stability-nudge
sleep 1
avalanche-status <clientId>
```

Pass criteria:
- Nudge result has `ok: true`, the expected `fiberName`, `source`, `ownerIndex`, and `label: "manual-stability-nudge"`.
- `commitCount` increased by at least 1 versus the pre-nudge baseline. Follow-up effects may create additional commits.

Treat `testid-not-found` or `no-composite-fiber-for-testid` as targeting failures. Treat `no-scheduleUpdate` as a development-runtime or boot-order failure; recover the shim/injection path before retrying.

### Step 12 — WDYR: toggle callback (`useCallback` with flipping dep)

Agent runs, no browser action needed (use existing armed full-mode session, or `avalanche-recapture <clientId> full` first):

```bash
page-click <clientId> "[data-testid=manual-toggle-tick]"
sleep 1
avalanche-commit-list <clientId> 5 sources
avalanche-commit-peek <clientId> <commitId> rendered 3 50
```

Pass criteria — rendered entry for `Target`:
- `isSelfSource: false`
- `propChanges` contains `{ name: "isEnabled", kind: "scalar-changed", prev.type: "boolean", current.type: "boolean" }`
- `propChanges` contains `{ name: "toggle", kind: "ref-changed", prev.type: "function", current.type: "function" }`

Reading: callback identity churn caused by `useCallback(fn, [isEnabled])`. Fix layer is *above source* — caller must stabilize via functional updater (`setEnabled((v) => !v)` removes the dep) or hoist.

### Step 13 — WDYR: array literal as prop (avoidable update)

```bash
page-click <clientId> "[data-testid=manual-array-tick]"
sleep 1
avalanche-commit-list <clientId> 5 sources
avalanche-commit-peek <clientId> <commitId> rendered 3 50
```

Pass criteria — rendered entry for `Child` (`React.memo`'d):
- `isSelfSource: false`
- `propChanges` contains `{ name: "items", kind: "ref-changed", prev.type: "object", current.type: "object" }`
- `trasherCounts.effects/callbacks/memos: 0` — there is no hook churn; this is pure caller-side identity leak.

Reading: `items = [1, 2, 3]` literal is recreated every parent render. `React.memo` shallow-compare cannot see equal contents. Fix layer is *above source* — hoist literal to module scope, `useMemo(() => [1, 2, 3], [])`, or pass a stable reference.

### Step 14 — WDYR: JSX children pass-through (unavoidable without caller fix)

```bash
page-click <clientId> "[data-testid=manual-children-tick]"
sleep 1
avalanche-commit-list <clientId> 5 sources
avalanche-commit-peek <clientId> <commitId> rendered 3 50
```

Pass criteria — rendered entry for `MemoizedParent`:
- `isSelfSource: false`
- `propChanges` contains `{ name: "children", kind: "ref-changed", prev.type: "object", current.type: "object" }`

Reading: JSX in caller creates a fresh `ReactElement` (array) for `children` every render. `React.memo` on the parent cannot help. This is the canonical "unavoidable in the parent" case — only fix is in the caller: hoist `<ChildA/><ChildB/>` into a stable variable or pass a memoized children array. Document this case as **caller-only fix layer** in the proof packet.

## Report the result

At the end, report a compact table:

| Step | Result | Evidence |
|---|---|---|
| connection | PASS/FAIL | clientId + URL + snapshot time + hard-reload confirmed |
| happy invoke (return) | PASS/FAIL | returnValue |
| throwing invoke | PASS/FAIL | threw/error/stack, returned promptly |
| async invoke | PASS/FAIL | async return + resolved value |
| class this | PASS/FAIL | fnName bound + return values across 2 invokes |
| non-callable | PASS/FAIL | propType + error |
| rendered evidence | PASS/FAIL | commitId + renderedTotal + trasherCounts + ref-changed propChanges |
| probes | PASS/FAIL | probe-dom + probe-owners owner chain |
| state update after invoke | PASS/FAIL | probe-hooks-summary before/after diff on the live fiber |
| agent-stimulated click | PASS/FAIL | page-click + commitCount increment + describe-action |
| agent-stimulated nudge | PASS/FAIL/SKIPPED | stability-nudge ok + commitCount increment (or SKIPPED — targeting) |
| WDYR toggle callback | PASS/FAIL | propChanges: isEnabled scalar-changed + toggle ref-changed |
| WDYR array literal | PASS/FAIL | propChanges: items ref-changed (object → object, equal contents) |
| WDYR JSX children | PASS/FAIL | propChanges: children ref-changed on MemoizedParent |

Only after all required rows pass may the agent say the extension path is manually verified.
