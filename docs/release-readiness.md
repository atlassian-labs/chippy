# Chippy public release readiness

Working document for the open-source release. Remove it once the release ships.
Audit date: 2026-11-01, against `main` at `15f1033`.

Decisions already made:

- Audience: open source (public GitHub repository, Chrome Web Store, npm).
- Jira and ATL support become plugins, so a Jira-flavoured build can add them back.
  ATL instrumentation is being proposed to the React team and will be renamed.
- Installation: one `npx` command.
- The skill's operating model (Cynefin/OODA, proof packet, router, procedures,
  recipes) stays as it is. This audit asks only whether the skill describes what
  Chippy can do.

## Blockers

These must be resolved before the repository or packages go public.

### B1. The helper accepted page-code execution from any origin — fixed

Before the fix, the helper bound `0.0.0.0`, sent `Access-Control-Allow-Origin: *`,
and had no authentication, so any website or LAN host could call
`POST /__chippy/api/pages/:clientId/eval-script`.

The fix is in `scripts/helper-access.js` and its callers:

- The default bind is `127.0.0.1`; a wider bind is opt-in through
  `chippy.sh start --host <address>` or `CHIPPY_HELPER_HOST`.
- Command routes require `X-Chippy-Token`. The helper writes a random token to
  `~/.chippy/helper-<port>.token` (mode `0600`) after it starts listening. CORS
  does not allow the header, so websites cannot send it.
- On loopback, a `Host` check blocks DNS rebinding on HTTP and WebSocket upgrades.
- Page assets, health, and the page WebSocket stay public. The published
  extension's two routes (`GET /api/pages`, `POST /api/avalanche-arm`) accept
  extension origins without a token, so no extension release is needed.
- `chippy.sh`, the MCP adapter, and the Playwright probes send the token.
- `src/chippy-helper-access.test.ts` covers rejection, preflight, the extension
  exemption, the Host check, the token file, and `chippy.sh` forwarding.

Follow-ups, not blocking:

- The page WebSocket is unauthenticated. A website can register as a fake page
  and feed text to an agent (a prompt-injection vector). Fixing it needs a
  handshake the extension and the injected bundle can both perform.
- ~~`chippy.sh` passes the token as a `curl` argument.~~ It now uses a private
  header file with `curl -H @file`.

### B2. The npm name `chippy` is taken — done

The package is `@atlassian/chippy`. `packages/chippy/package.json`, the
`@atlassian/chippy/*` import paths in the READMEs and the library test, the
installer usage, and the Storybook connection fallback use it. The fallback and
the skill references now point at `npx @atlassian/chippy install` instead of the
internal skills registry.

### B3. Committed build artifacts — done

`chippy-skill.zip` and `chippy-extension.zip` stay in git, because they make the
extension easy to install without a build.

`dist/` is no longer tracked; it is a build intermediate of `avalanche:sync`.

The shipped bundles (`extension/avalanche.*.js`, `scripts/chippy-mcp.cjs`,
`scripts/avalanche-analyze.cjs`) stay, because the skill installs without a build
step. Both builds are deterministic. CI rebuilds them and fails on a diff, and
`src/chippy-shipped-artifacts.test.ts` fails when a zip differs from the tracked
files. That test found `chippy-skill.zip` predated B1 and lacked
`helper-access.js`; the zip is rebuilt.

### B4. Git history contains an internal host — resolved by the move

The public repository starts without history, so the internal URL in old commits
does not ship. The project owner confirmed that the name and assets carry no
brand restriction. `SECURITY.md` → "Reporting" points at GitHub private
vulnerability reporting on `atlassian-labs/chippy`.

## Goal 1: Chippy knows what it can do — done

The description, opening, and route table now name explore, debug, compare, and
investigate; `SKILL.md` step 1 lists the CLI-only commands. The audit below is kept
for reference.

The capabilities exist. The entry points under-describe them.

| Capability | CLI | MCP tool | In the `SKILL.md` route table |
|---|---|---|---|
| Explore: find components by name, text, test ID, file, or prop | `find-fibers` | `chippy_find_fibers` | **No.** Listed only in the command surface |
| Explore: what is inside a component | `explain-component`, `describe-component` | `chippy_inspect_fiber` | Yes |
| Debug: where does this element or value come from | `probe-*` | `chippy_probe` | Yes |
| Debug: boundaries | `probe-boundaries`, `page-boundaries` | `chippy_probe view=boundaries` (no page-wide view) | Yes |
| Compare: two states or pages | `fiber-state-capture` / `-compare` | **None** | Yes |
| Investigate: slow interaction | `avalanche-arm` → status | `chippy_avalanche` (no arm/disarm) | Yes |
| Investigate: slow initial load | `reload-with-avalanche` | **None** | Yes |
| Recipes lookup | `recipes` | **None** | Yes |

Gaps:

1. **The skill description does not advertise any capability.** The frontmatter is
   `description: agent-facing side of the Chippy extension`. Hosts use this line
   to decide when to load the skill, so a request like "why does this React page
   re-render" or "compare these two pages" will not match. It should name React,
   the running page, and the four verbs: explore, debug, compare, investigate.
2. **MCP is the preferred route but lacks compare, page-wide boundaries,
   load profiling, arm/disarm, and recipes.** `SKILL.md` step 1 says to prefer MCP,
   so an MCP-first agent cannot do half of what the skill promises. Either add the
   tools or say in `SKILL.md` which capabilities require the CLI.
3. **"Explore" has no row in the route table.** Add one for `find-fibers`.

Not a gap: the operating model itself. It is long (SKILL.md ~4,000 words; the
references ~49,000) but every route ends in a completion signal. The question for
release is only whether a first-time reader can find the four capabilities in the
first screen, and today they cannot.

## Goal 2: free of hard-to-explain cruft

| Item | Why it is hard to explain | Suggested action |
|---|---|---|
| Repository and root package named `storybook` | Clone URL and `package.json` describe the lab, not the product | Done: the root package is `chippy` (private); the public repository is `atlassian-labs/chippy` |
| Tracked `dist/` | See B3 | Delete and ignore (zips stay) |
| Jira/ATL in core | See "Plugin seams" below | Extracted to `src/plugins/` and off by default; live Jira/ATL check pending |
| `.agents/skills/playwright-cli/` vendored | Third-party skill checked into the tree | Done: `playwright-local` drives the lab through it; CONTRIBUTING lists it as vendored upstream |
| `chippy:install:zip` script | Second install path with `rm -rf ~/.agents/skills/chippy` inline | Done: removed; the `npx` installer replaces it |
| `FIXME(mine)` / `FIXME(reef)` markers (7) | Private tags; meaning unclear to contributors | Done: all converted to `TODO` |
| `maintainer: akorzunov` in the registry procedure | Internal registry procedure in a public tree | Done: procedure removed from the public tree |

## Goal 3: tested, easy to scale and maintain

Done since the audit:

- CI (`.github/workflows/ci.yml`): unit tests, typecheck (reported, not yet
  blocking), shipped-bundle staleness, and the browser project.
- `yarn typecheck` reports 0 errors and blocks CI.
- The `reload-with-avalanche` expectation is fixed: the lab runs stock React, so
  `integrationMode` is `devtools`. The `chippy-capabilities` failure no longer
  reproduces.
- `avalanche-save` and `avalanche-offline` were broken: they expected a
  `commits[]` array the export no longer has, so every save failed. The offline
  analyzer is now `src/avalanche/offline.ts`, runs the live dispatcher over the
  saved report, and is tested end to end through `chippy.sh`.

Audit state:

- Unit project: 59 files, 596 passed, 1 skipped (`yarn test --project unit`, 31 s).
- Browser project: 7 files, 43 passed, **3 failed**, 3 todo (70 s). The failures
  are in `chippy-capabilities.test.ts:434`, which expects the `import` integration
  but gets `storybook`, and `reload-with-avalanche.test.ts:365`, which expects
  `integrationMode: 'atl'` on stock React and gets `devtools`. Both look like stale
  expectations, not runtime crashes. The second one matches the ATL-first default
  at `reporter.tsx:951`. Both need triage before CI can go green.
- No CI. Nothing runs these suites on a pull request.
- `tsc --noEmit` reports 73 errors with `strict: false`; there is no typecheck
  script, so they accumulate unnoticed. 33 are in tests.
- The largest hand-written files have no type checking: `chippy-page-bridge.js`
  (1,825 lines), `chippy-helper-server.js` (1,686), `layout-lab.js` (1,432),
  `chippy.sh` (1,186 lines of shell).
- Shell/HTTP/bridge parity is tested (`shell-command-parity.test.ts`,
  `wire-forwarding.test.ts`), which is the right pattern for adding commands.

Before release:

1. ~~Add CI (GitHub Actions): install, typecheck, unit project, browser project,
   build-staleness check (B3), package dry-run.~~ Done. The `package` job packs the
   tarball and runs its installer through `npx`; it caught a silent no-op when the
   bin was started through a symlink.
2. ~~Add `yarn typecheck` and fix the 73 errors.~~ Done; the CI step is blocking.
3. ~~Add `// @ts-check` with JSDoc types to the helper and page bridge, or record
   that as a known follow-up.~~ Recorded as a follow-up after release. A full
   TypeScript port is not required to release.

## Goal 4: documented

What exists is accurate and well cross-linked: README, CONTRIBUTING, SECURITY,
`docs/react-compatibility.md`, `docs/releasing.md`, the skill and its references,
and `src/README.md`.

Missing for an open-source release:

- ~~`CHANGELOG.md` with a version policy, `CODE_OF_CONDUCT.md`, issue and PR
  templates.~~ Added. The issue template config links to
  `atlassian-labs/chippy` advisories; the code of conduct sends reports to any
  maintainer until a dedicated address exists.
- ~~README order.~~ The README now opens with what you can ask and installation;
  library usage follows, and the install section leads with the `npx` installer.
- ~~Documentation for the plugin API.~~ [Plugins](plugins.md) covers both seams
  and how to add a plugin to the bundle.

## Goal 5: simple to install

Done. `packages/chippy/bin/chippy.mjs` is a second
bin in the library package:

```sh
npx @atlassian/chippy install [--dir <path>] [--force]
```

It copies the bundled skill (`dist/mcp-skill/`) to `~/.agents/skills/chippy` or
`--dir`, replaces an earlier Chippy install, and refuses any other existing
directory unless `--force` is given. It prints the load-unpacked extension path, the
console-import fallback, the MCP configuration with the resolved path, and
whether the helper answers `/__chippy/health`. The usage text reads the package
name from `package.json`.
`src/chippy-npx-install.test.ts` covers it.

Not done: writing MCP configuration for known hosts (`--host <name>`). The
`chippy:install:zip` script is removed.

## Plugin seams for Jira and ATL

The generic part is already well separated. `src/layout-lab/fiber-boundaries.ts`
detects Error and Suspense boundaries without product knowledge. Most Jira-named
code is generic code with a Jira name. ATL is the bigger cut, because it runs
through the detector, the report schema, the serializer, and early bootstrap.

### Seam A: marker context providers (Jira) — done

`src/layout-lab/marker-context.ts` owns boundary collection
(`collectContextFibers`), the generic Error/Suspense context, and a provider
registry, `__AVALANCHE__.layoutLab.registerContextProvider(provider)`. A provider
adds boundary kinds, error-boundary enrichment, and display titles and fields;
a throwing provider is ignored.

The Jira provider is `src/plugins/jira/context-provider.ts`: OwnerMark parsing,
`JSErrorBoundary` enrichment, the `ErrorComponent` flag, and the `owner`
boundary kind. `src/plugins/index.ts` registers it from the bundle's
composition root. The marker card is `context-card.jsx`.

Renamed, with aliases kept for one release:

| New | Alias |
| --- | --- |
| `markers[id].context` | `markers[id].jiraContext` |
| `layoutLab.describeContext` | `layoutLab.describeJiraContext` |
| `context-ui` / `set-context-ui` / `contextUiEnabled` | `jira-ui` / `set-jira-ui` / `jiraUiEnabled` |

### Seam B: commit metrics adapter (ATL) — done

`src/avalanche/commit-metrics-adapter.ts` defines `CommitMetricsAdapter`
(`id`, `frameFilters?`, `prePage?`, `prepare?`, `isAvailable`, `snapshot`,
`measure`, `attach`, `isAttached`, `reattach`, `detach`) and a one-slot
registry (`registerCommitMetricsAdapter`, `getCommitMetricsAdapter`,
`runPrePageHooks`). The detector resolves the adapter on `install()`;
`metricsAdapter: null` opts out.

The core keeps DevTools capture, `commit-surface-ownership.ts`
(`observeATL` is now `observeAdapter`), `handleCommit`, the restarts slot, and
the capabilities block. The `?? 'atl'` default in the reporter is gone; a
report without an adapter callback reads `devtools` or `none`.

The ATL plugin is `src/plugins/atl/`:

- `commit-metrics-adapter.ts`: the adapter (`calculateATLDelta`, restart and
  total accounting, the attach/re-seed path, and the `atlDispatcherHook` frame
  filter).
- `metrics-slot.ts`: the `__ATL_REACT_METRICS` seed, lock check, and the
  configurable accessor that used to be inline in `early-bootstrap.js`. The slot
  name is an adapter option, so a renamed React-team slot needs no core change.
- `atl-react.tsx` and `external-store-restart.tsx`, moved unchanged.
- The `hook-metrics*.js` and `hook-tracker.js` snippets stay in `snippets/`
  and are documented as ATL plugin snippets.

`early-bootstrap.js` now calls `__AVALANCHE__.runPrePageHooks(cfg)`;
`avalanche.iife.js` loads before it, so the registry is populated. The extension
is 0.4.24. The helper routes `GET /api/pages` and `POST /api/avalanche-arm`
are unchanged. The library build no longer uses ATL by default; it exports
`atlCommitMetricsAdapter` and `registerCommitMetricsAdapter` for hosts that
want it.

Renamed, with aliases kept for one release:

| New | Alias |
| --- | --- |
| `integrationMode: 'adapter:<id>'`, plus `meta.metricsAdapter` and `status().metricsAdapter` | `'atl'` (accepted by readers of older captures) |
| `metricsByCommit` and `dataAvailability.metricsByCommit` | `atlByCommit` (same object) |
| `commit-peek` include `metrics` | `atl` (returns the slice under `atl`) |
| `CommitMetricsDeltaDTO` | `ATLCommitDeltaDTO` |

Not verified on a live Jira or ATL page. The unit tests cover the adapter,
the slot accessor, and both callback orders against a simulated slot; the
browser project covers stock React only.

### Other Atlassian assumptions in the tree

- ~~The connection-fallback UI tells users to run the internal skills-registry
  command.~~ It now shows `npx @atlassian/chippy install`.
- ~~The internal skills-registry procedure in `.agents/references/`, `AGENTS.md`,
  and `docs/releasing.md`.~~ Removed; it lives in the internal repository.
- `'Atlassian Sans'` font stacks in the popup and panel. They fall back to
  `system-ui`, so this is cosmetic.
- `@atlassian/perf-linting` eslint-disable comments in `detector.tsx`. Harmless,
  but unexplained to outside readers.
- Jira used only as an example of a large app in several references. This is fine
  to keep.

### Docs overlay

The Jira-flavoured skill overlays `references/jira-taxonomy.md`, `bdd-router.md`
§3.6 (R-50–R-53), `procedures.md:240,476`, `SKILL.md:41,312`, and
`recipes.txt:42,110`. Core keeps a generic "production or minified page" route
and one sentence saying that context providers can add boundary kinds.

## Suggested order

1. ~~B1 security fix, with a wire test.~~ Done.
2. ~~B2 rename to `@atlassian/chippy`; B3 `dist/` cleanup; browser failures; CI; the 73 type errors.~~ Done; typecheck is blocking in CI.
3. ~~Plugin seams for Jira and ATL.~~ Done; both are opt-in (panel settings or
   `enablePlugins()`). Verify on a live Jira/ATL page.
4. ~~`npx` installer.~~ Done.
5. ~~Skill description, route-table row for explore, documented MCP gap.~~ Done.
6. ~~Docs: quick start, changelog, code of conduct, plugin API.~~ Done.
7. ~~Publication checklist: brand rights, security-reporting destination, code-of-conduct contact, `OWNER/REPO` in the issue template config.~~ Done. When the repository is created, enable private vulnerability reporting in its settings.

## Feature gaps found during review

Not release blockers; candidates for the first public roadmap.

- **Avalanche focus.** Capture always walks the whole tree, and live analysis
  ranks across all of it. `DetectorOptions.ignore` takes component references and
  is not reachable from the CLI or MCP. Exports carry no source file paths. A
  team-scoped view needs `source.fileName` on rendered evidence and sources, then
  a report-time filter (name, file glob, or subtree root) on `hot-sources`,
  `commit-list`, and `commit-peek`. Record everything and tag entries in scope,
  because the trigger often sits outside the team's subtree.
- **Why did X update.** Avalanche separates triggers (`isSelfSource`, changed
  hooks) from collateral (`causedBySourceId`) and diffs props. It does not capture
  the setState call stack, does not attribute context changes to consumers, and
  cannot answer for one component. A `why-rendered <name|sourceId>` query over
  `renderedByCommit` would cover the last point with existing data.
