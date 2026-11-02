# Playwright probes

How Chippy operates inside a Playwright-driven browser. Same shared runtime as
the extension, different transport. No drag UI. AI-driven targets, not pixels.

## What a probe is

A probe is **a focus descriptor + a resolved target**. It is not a marker.

```
Probe {
  id            string         // "p1", "p2", ...
  intent        string|null    // optional human note
  descriptor    {              // portable identity
    dom: { tag, attrs, text, nearestTestId, siblingIndex }
    component: { name, source, ownerNames }
  }
  resolved      {              // per-session, recomputed
    confidence: "strict"|"high"|"medium"|"low"|"none"
    candidateKind: "fiber"|"dom"
    score: number
    matches: { ...field flags }
    component, dom, alternates[]
    resolvedAt: iso
  } | null
  history[]     // confidence/score timeline
  createdAt     iso
}
```

Identity rules:

- Descriptor is portable across windows, runs, browsers.
- Resolved is per-session and re-derived on demand.
- **Coordinates are never identity.**

## Lifecycle

1. **Acquire** — derive a descriptor (AI, prior browser, selector hint).
2. **Resolve** — fiber-first candidates, DOM fallback, ranked.
3. **Inspect** — DOM, fiber props, hooks, owners, styles.
4. **Measure** — avalanche around an interaction.
5. **Maybe Apply** — when user intent and the P-15/P-16 gate permit, edit source and reload/HMR.
6. **Re-resolve** — confirm the probe still lands; compare.
7. **Handoff** — extension client → Playwright client via helper.

## Operations

All operations live in:

```
./browser-scripts/playwright-probes.js
```

### Session
- `launch({ browser, url, headless })`
- `close(session)`
- `goto(session, url, options?)`
- `reload(session, options?)`

### Probes
- `defineProbe({ id, intent, descriptor })`
- `registerProbe(session, probe)`
- `captureFromNode(session, locator)`
- `captureFromSelector(session, selector)`
- `resolveProbe(session, probe, options?)`
- `refreshProbe(session, probeId, options?)`
- `listProbes(session)`
- `removeProbe(session, probeId)`

### Inspect
- `probeDom(session, probe, parentLevel?)`
- `probeOwners(session, probe)`
- `probeOwner(session, probe, ownerIndex)`
- `probeProps(session, probe, ownerIndex?)`
- `probePropValue(session, probe, propName, ownerIndex?)`
- `probeHooks(session, probe)`
- `getComputedStyle(session, probe, parentLevel?)`

### Measure (avalanche)

The Playwright session connects to the helper as a normal client. All
avalanche calls go through the helper HTTP API; the helper drives
`__AVALANCHE__` on the page over the existing WS bridge. Playwright never
calls `__AVALANCHE__` directly.

Why route through the helper:
- one transport and explicit detector-install path
- one result format across extension and Playwright
- one place to reason about cross-session capture state
- helper is the context manager for everything Chippy does

Read flow (each call):
```
Playwright → helper HTTP /api/pages/:clientId/avalanche
    → WS to client → __CHIPPY.pageBridge.evalAvalanche
    → __AVALANCHE__.<action>
    → result back through WS → helper HTTP body → Playwright
```

How Playwright reads data:
- `clientId` is read once via `__CHIPPY.pageBridge.getState().clientId`
  and cached on the session
- each avalanche call returns `{ ok, status, payload }` from the helper
- `payload` is the standard helper avalanche response (`action`, `available`,
  `status`, `payload`, etc.)
- the actual data lives on the page in `__AVALANCHE__`; we only ever read it
  through the helper

Operations:
- `avalanche(session, action, payload?)` — generic dispatcher
- `avalancheStatus(session)`
- `avalancheHotSources(session, limit?)`
- `avalancheExport(session, lastN?)`
- `reloadWithAvalanche(session, { settleMs?, hotLimit? })`

Supported generic actions are `install`, `uninstall`, `reset`/`clear`, `status`, `export`, `export-last`, `debug-hook`, `hot-sources`, `commit-list`, `commit-peek`, and `describe-action`. The module still exports legacy `avalancheStart`, `avalancheStop`, and `avalancheMetrics` wrappers for compatibility; do not use them in new workflows. `avalancheStart` is only an alias for `install`, while `stop` and `metrics` are not actions on the current bridge contract.

Helper base URL is `http://127.0.0.1:7823/__chippy` by default and can be
overridden with `CHIPPY_HELPER_BASE`.

### reloadWithAvalanche

The packaged `launchSession(...)` path installs the Chippy bridge and Avalanche runtime via `addInitScript`, so both runtimes exist before page scripts on every reload. The detector still starts uninstalled in each new page realm. `reloadWithAvalanche` therefore reloads, waits for the new client, calls the Avalanche `install` action explicitly, then settles and reads evidence. It does not use helper origin-arming.

Commits that occur before that post-reload install are not captured. Use this helper for post-install triggers and settled-state checks, not to claim complete initial-load coverage.

Flow:
1. `page.reload()` via Playwright
2. wait for the reinjected runtime and a fresh `clientId`
3. install the detector through the helper
4. settle for `settleMs` (default 3000)
5. read `status` and `hot-sources` through the helper

Returns:
```js
{
  previousClientId,
  clientId,        // new clientId after reload
  install,         // explicit detector-install response
  status,          // helper avalanche-status response
  hot,             // helper hot-sources response
}
```

Notes:
- requires the session to have been started with `launch(...)`, which uses
  `installHelpers({ init: true })` under the hood
- bump `settleMs` to 5000+ for heavy app loads
- this packaged init-script loader and the ad-hoc `addScriptTag` flow are two Mode A bootstrap variants; both require detector installation and both miss commits before that install

### Compare
- `snapshotProbe(session, probe)`
- `diffProbeSnapshots(a, b)`

## Operating rules

- **Probes are descriptors first.** Resolution is recomputed, not cached identity.
- **Fiber beats DOM** when scoring matches.
- **Strict identity wins** over fuzzy when both available.
- **No coordinates as identity.** Pixels never cross window boundaries.
- **Confidence is reported.** Low-confidence ops must be acknowledged.
- **Re-resolve after** any reload, navigation, code edit, HMR, route change.
- **Avalanche is per-session.** Probes interpret hot sources, not gate them.
- **Browser is Chromium or WebKit.** Never user's Chrome.
- **DRY:** the same shared runtime files power extension and Playwright.

## Handoff from extension to Playwright

Helper command:
```
./scripts/chippy.sh handoff-to-playwright <clientId> [url] [probeIdsCsv] [browserName] [headless]
```

What it does:
1. Captures live probe descriptors from the source extension client.
2. Launches Playwright Chromium and navigates to URL.
3. Injects shared __CHIPPY runtime via `playwright-session.js`.
4. Registers the new page as another helper client.
5. Returns descriptors so Playwright probe code can resolve them.

The Playwright session is then operated like any other helper client.

## When to use Playwright vs extension

Use the **extension**:
- user is exploring
- target is unclear
- live page already has the right state
- user needs to point at things

Use **Playwright**:
- iteration loop is repetitive (reload + interact + measure)
- target is already known via descriptor
- need a clean, controlled environment
- need reproducibility across runs
- user is not in front of the page

Both share:
- inspect-react.js
- layout-lab.js
- resolve-probes.js
- probe-descriptor.js
- avalanche.iife.js
- chippy-page-bridge.js
