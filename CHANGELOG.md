# Changelog

Chippy ships three artifacts from this repository. Each has its own version:

| Artifact | Version source | Policy |
|---|---|---|
| Agent skill | This changelog | Follows the repository release tag. |
| Chrome extension | `.agents/skills/chippy/extension/manifest.json` | Bumped for every store upload; the store rejects a reused version. |
| npm package | `package.json` | Semantic versioning. Before 1.0, minor versions may contain breaking changes. |

The helper HTTP API is internal to the skill and the extension. Changes to the
routes the published extension calls (`GET /api/pages`, `POST /api/avalanche-arm`)
must stay compatible with the extension version in the store.

## Unreleased

### Added

- `find-fibers --grep <regex>` searches the whole fiber tree for matching prop
  keys and values, hook state, and class state, and with `--in debug`,
  `useDebugValue` labels. Each hit carries its scope and path. Only components
  that call `useDebugValue` are replayed.
- Command routes on the local helper require a per-run token. The helper binds
  to loopback by default; `chippy.sh start --host <address>` or
  `CHIPPY_HELPER_HOST` opts into a wider bind.
- Local MCP server with automatic helper startup.
- Offline Avalanche analysis runs the live command code over a saved export.
  `source-search --name` finds components by name.
- The skill installs with the [skills CLI](https://github.com/vercel-labs/skills):
  `npx skills add atlassian-labs/chippy --skill chippy -g`. The npm package does
  not install the skill; `npx @atlassian/chippy install` prints that command.
  The repository's maintainer skills are marked internal, so the skills CLI
  offers only `chippy`.
- CI for unit and browser tests, type checking, and staleness of committed bundles.
- Avalanche exports carry absolute timestamps on the page's performance clock:
  `meta.timeOrigin`, `commitTimings[N].startTime` and `endTime`, and a
  `timestamp` on each linked action. Commits can be aligned with
  `PerformanceObserver` entries and DevTools traces. Report version is 7.
- The `perf-entries` snippet (`eval-page <clientId> perf-entries`) reads the
  browser's buffered layout shifts, long animation frames, slow interactions,
  LCP, FCP, and TTFB. It names the component behind each layout-shift source,
  interaction target, and LCP element, and lists the Avalanche commits near
  each entry.
- Jira and ATL support are plugins, off by default. Enable them in the Chippy
  panel's settings or with `__AVALANCHE__.enablePlugins()`. Extension 0.4.24.
- `npx @atlassian/chippy pack` builds a custom skill and extension with extra
  plugins, default plugin selections, its own extension identity, and extra skill
  documentation. `@atlassian/chippy/plugin` exports the plugin types and helpers;
  the runtime adds `registerPlugin()` and `listPlugins()`.

### Fixed

- `avalanche-commit-peek ... timing` and Avalanche exports return per-commit
  timing. The serializer previously dropped `commitTimings`, so the slice was
  always `null`.
- The helper binds each page WebSocket to its handshake `Origin`. A page on
  another origin can no longer report a foreign page URL or reuse another page's
  client id to take over its entry and receive its commands.
- `GET /api/avalanche-arm` no longer lists armed origins and client ids to
  websites; pages may read only their own origin's arm state. The unused
  `/proxy/go` redirect is removed.
- Debug replay of custom hooks and the capture engine work on React 19, which
  keeps the hooks dispatcher in `ReactSharedInternals.H`.
- Proxy mode reaches dev servers that listen on `::1` (Vite on macOS) as well as
  `127.0.0.1`, refuses targets off this machine, and loads the DevTools hook shim
  and the Avalanche runtime before page code, so fiber queries work on proxied pages.
- A page that lacks the Avalanche runtime answers fiber queries with HTTP 503 and
  a hint instead of `ok: true, count: 0`. `chippy.sh` prints the helper's error
  and hint when a request fails, instead of only the HTTP status.
- `reload-with-avalanche` captures boot commits with the extension and in proxy
  mode. Before an armed reload the page stores the arm in `sessionStorage`, and
  the next document installs Avalanche synchronously at `document_start`: the
  extension registers its startup scripts for that one navigation, and the proxy
  document loads the handoff reader before the runtime. Previously the extension
  injected only after several asynchronous lookups, so a fast page committed
  before capture started and the reload reported 0 commits. The reload ack
  reports `earlyStartup`. Extension 0.4.25.
- Evaluating `avalanche.iife.js` a second time on a page keeps the published
  `__AVALANCHE__` runtime. Previously each evaluation replaced it with a new,
  uninstalled runtime, so status and capture read from that runtime while the
  first one kept recording.
- The Storybook addon builds with Vite's default browser targets. Its arm lookup
  no longer uses top-level await; a global loader holds the first story render
  until the arm is applied, so an armed preview still captures the first mount.
- On a Storybook page, `page-reload` and `reload-with-avalanche` remount the
  selected story. The addon sent `FORCE_REMOUNT` without a story id, which
  Storybook ignores, so the reload reported success and captured 0 commits. An
  armed remount installs Avalanche first. A remount that matches no rendered
  story fails with HTTP 409 and the page's error.
- The Chippy extension stands down in the Storybook manager when the addon is
  present, so `pages` lists the preview's `storybook` client and not Storybook's
  own UI. Same-origin frames keep separate client ids; the manager and the
  preview shared one through `sessionStorage`. The addon panel warns when an
  extension bridge is still connected from the manager.
- Tree walks follow the live React root after commits. The DevTools-hook shim
  tracks committed roots (`getFiberRoots`), so boundaries, fiber-state capture,
  and compare no longer read the tree as it was at first render.
- `find-fibers` reports authored source lines. On React 19 it returned the
  served module URL and generated line; it now awaits the same source-map
  resolution as `explain-component`. On React 18, `_debugSource` lines were
  offset by the lines a dev-server transform added before JSX compilation (19
  lines for Vite's Fast Refresh header); Chippy now maps the recorded position
  through the module the page loaded for that file.
- `avalanche-install`, `avalanche-recapture`, and `avalanche-arm` reject an
  unknown detection mode. The CLI exits 1, and the helper answers HTTP 400
  instead of installing with the default mode.
- `reload-with-avalanche` exits 1 with an explanation when the page does not
  reconnect after the reload, for example when Chippy was injected without init
  scripts. Previously it failed with curl's raw 404.
- `handoff-to-playwright` prints the helper's error and hint instead of curl's
  HTTP 503.
- `npx @atlassian/chippy` accepts `--help` and `--version` with any command and
  rejects unknown options. `pack` rejects unknown configuration keys at every
  level instead of ignoring them.
- `install --force` moves a directory that is not a Chippy skill aside to
  `<dir>.replaced-<timestamp>` instead of deleting its contents. `pack` refuses
  to replace an output skill directory that is not a Chippy skill.
- The README links to absolute repository URLs, so they resolve from the npm
  package page.
- The skill documentation states that every detection mode records rendered
  components and prop changes, and that a page normally keeps its client id
  across a reload.
- `avalanche-save` and `avalanche-offline` work with the current export format.
- The skill archive includes every file the helper needs.
- `chippy.sh` no longer passes the helper token on the curl command line.
- `npx @atlassian/chippy` no longer exits without running when npx starts it
  through a symlink.
