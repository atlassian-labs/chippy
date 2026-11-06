# Test mode playbook

Chippy can work without a human driving the browser. In test mode, Playwright performs the interaction while Chippy reads live page state, traces source, and verifies the result. Playwright is a contract here: open/navigate, inject scripts, interact, wait/poll, and evaluate page state.

Use this mode when:
- you already know the page URL
- probes can be placed by coordinates or replaced with snippets / eval-page
- you need repeatable before/after verification
- you want to save avalanche captures and analyze offline

If the user already placed P1/P2 on an extension-connected page, run `handoff-to-playwright <clientId>` ([handoff](playwright-probes.md#handoff-from-extension-to-playwright)): it captures their descriptors, opens a helper-controlled browser, and returns `targetClientId` plus the descriptors to resolve there.

## Job in test mode

The job is the same as interactive mode:
1. understand what the page rendered
2. find where it comes from
3. change source if needed
4. verify the result

The difference is orchestration. A test harness performs the clicks, typing, reloads, and waits.

## Two automation shapes

### 1. Sidecar mode
Use a real browser page plus Chippy helper sidecar.

Best when:
- extension is already installed
- page is a real app page
- you want the same runtime as a human user

Flow:
1. open page with Playwright or manually
2. ensure origin is enabled in extension
3. wait for page to appear in `chippy.sh pages`
4. use `chippy.sh` commands to read state, arm reload, or run snippets

### 2. Playwright-controlled mode
Inject the Chippy bundle directly into a Playwright-controlled page.

Best when:
- running against a disposable local page or Playwright-controlled target
- you want a fully scripted loop
- you do not need extension popup/origin enable flows

Follow the complete [Mode A injection contract](mode-a-injection.md): DevTools hook shim before navigation, one supported runtime loader, wait for a new page client, then explicit `avalanche-install <clientId>` and `avalanche-clear <clientId>` before the post-install trigger. Mode A does not auto-install the detector and cannot recover boot commits that occurred before installation.

## Stable loop

Use this loop for repeatable automation:

1. **Prepare the runtime path**
   - sidecar mode: no harness bootstrap is required
   - direct injection mode: before navigation, install the DevTools hook shim and register the packaged init loader; for the ad-hoc variant, install the shim now and defer the two post-navigation runtime loads

2. **Open page**
   - navigate to the target page URL
   - wait for `document.readyState === "complete"`

3. **Connect runtime**
   - sidecar mode: wait until `chippy.sh pages` lists the page
   - direct injection mode: load the ad-hoc runtimes now if using that variant, select the new client from `pages`, run `avalanche-install`, then `avalanche-clear`

4. **Drive interaction**
   - click, type, drag, or reload
   - sidecar/extension load capture: use `reload-with-avalanche`
   - Mode A: trigger only after explicit install; after any reload, reacquire the new client and repeat install because pre-install boot commits are unobservable

5. **Poll for stable state**
   - after interaction, do not read once and assume done
   - poll until one of these holds:
     - snapshot timestamp changes and then stops changing
     - expected marker becomes non-null with acceptable confidence
     - expected count / text / prop value appears
     - avalanche commit count stops increasing for the settle window

6. **Read structured output**
   - probes: `pages`, `page`, `probe-dom`, `probe-owners`, `probe-props`, `probe-prop-value`
   - performance: `avalanche-status`, `avalanche-hot-sources`, `avalanche-commit-list`, `avalanche-commit-peek`
   - special cases: `eval-page` snippets
   - for unknown data flow, start at an always-used seam; log the full shape first, then narrow after the signal is observed

7. **Change code**
   - proceed only when user intent permits the change and the P-15/P-16 Apply gate passes
   - edit the proven failing layer, not the most convenient visible layer
   - treat harnesses, serializers, navigation/parameter transport, fixtures, mocks, and page objects as foundation until observation shows that foundation is the failing layer
   - edit source in workspace
   - let HMR or reload apply the change

8. **Verify again**
   - same action, same timing window
   - compare visible result and structured output

## Polling contract

Polling beats guessing.

Recommended defaults:
- interval: `100ms` to `250ms`
- short UI wait budget: `5s`
- heavy reload wait budget: `15s`
- extra settle after reload avalanche: `3s` to `5s`

Treat state as ready only when the thing you need is present and stable.

Examples:
- probe target ready when `resolved` is non-null and confidence is acceptable
- owner chain ready when `probe-owners` returns the expected source file/name
- performance capture ready when `commitCount` stops increasing and hot sources are non-empty

## What to use when

### Use probes when:
- a specific visible element matters
- you need exact owner or prop origin
- you need to trace source for one render path

### Use snippets / `eval-page` when:
- the question is cross-cutting
- you need to count providers/consumers
- you need to search many fibers for one condition
- a built-in command would be too narrow

### Use avalanche when:
- problem is re-render spread, lag, churn, or restart-heavy commits
- you need commit-level ranking
- you need before/after performance verification

## Minimal examples

### Sidecar avalanche loop
```bash
./scripts/chippy.sh pages
# Select the page whose URL, title, integration identity, and recency match the target.
CLIENT_ID=<confirmed-clientId>
ORIGIN=<that page's origin>
./scripts/chippy.sh reload-with-avalanche "$CLIENT_ID" "$ORIGIN" 0 15000 5000
./scripts/chippy.sh avalanche-status "$CLIENT_ID"
./scripts/chippy.sh avalanche-hot-sources "$CLIENT_ID" 10
./scripts/chippy.sh avalanche-commit-list "$CLIENT_ID" 10 collateral
```

### Mode A post-install loop

Complete the bootstrap in [Mode A injection](mode-a-injection.md), then:

```bash
./scripts/chippy.sh pages
CLIENT_ID=<confirmed-new-clientId>
./scripts/chippy.sh avalanche-install "$CLIENT_ID" full
./scripts/chippy.sh avalanche-clear "$CLIENT_ID"
# Use Playwright to trigger the measured behavior now, after installation.
./scripts/chippy.sh avalanche-status "$CLIENT_ID"
./scripts/chippy.sh avalanche-commit-list "$CLIENT_ID" 10 collateral
```

For another navigation or reload, repeat client selection, install, clear, and the post-install trigger. Do not use `reload-with-avalanche` to claim Mode A boot coverage.

### Snippet loop
```bash
./scripts/chippy.sh eval-snippets
./scripts/chippy.sh eval-page "$CLIENT_ID" find-context-providers --name Jira
```

### Save once, analyze many times
```bash
./scripts/chippy.sh avalanche-save "$CLIENT_ID" .chippy-captures/run.json
./scripts/chippy.sh avalanche-offline .chippy-captures/run.json summary
./scripts/chippy.sh avalanche-offline .chippy-captures/run.json commit-peek 8 stats,sources,metrics 20
```

Offline `commit-peek` takes `<commitId> [include] [maxItems]`; it has no `depth` slot.

## Failure handling

If automation fails:
- page missing from `pages` → reconnect or reload page
- marker unresolved → re-place probe or wait longer
- `__AVALANCHE__` present but no data → confirm live API shape and startup path
- `report()` unavailable → you may be reading module namespace, not installed instance
- duplicate install warning → same bundle loaded twice; fix startup order before trusting output

## What to save as artifacts

Prefer structured artifacts over screenshots:
- snapshot JSON
- probe output JSON
- avalanche export JSON
- commit list / commit peek slices

Screenshots help verify appearance. They do not replace runtime data.

## Read next

- Chippy skill: [../SKILL.md](../SKILL.md)
- Avalanche reference: [./avalanche-detector.md](./avalanche-detector.md)
- Performance reasoning: [./fixing-performance.md](./fixing-performance.md)
