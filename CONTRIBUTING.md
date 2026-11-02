# Contributing to Chippy

Chippy's reusable distribution lives in `.agents/skills/chippy/`. This repository
also contains its TypeScript runtime sources and the Storybook lab used to verify
behavior against real React renderers.

## Set up

Use Node.js 22.12+ for the Vite development toolchain, Yarn 4.8.1 (the
version declared in `package.json`), and Chromium for browser tests.

```sh
nvm use
yarn install --immutable
yarn exec playwright install chromium
yarn storybook --ci -p 6007
```

Storybook runs at `http://127.0.0.1:6007/`. Start the helper separately with
`.agents/skills/chippy/scripts/chippy.sh start`; it listens on port 7823.
The lab disables Storybook usage telemetry, targets ES2022 browsers, and uses
standard React DOM.

## Find the change owner

| Path | Owns |
| --- | --- |
| `src/avalanche/` | Commit capture, report projection, and optional ATL adapter |
| `src/debug-render/` | Hook capture and structural replay |
| `src/layout-lab/` | DOM/fiber resolution and boundary inspection |
| `src/chippy-bridge/` | Command capabilities and transport-safe results |
| `.agents/skills/chippy/extension/` | Browser integration, panel, and shipped runtime assets |
| `.agents/skills/chippy/scripts/` | Local helper and public CLI |
| `.agents/skills/chippy/references/` | Consumer procedures and contracts |
| `.storybook/chippy-addon/`, Storybook fixtures in `src/` | Local validation integration and scenarios |
| `src/plugins/` | Optional Jira and ATL integrations behind the [plugin seams](docs/plugins.md) |
| `.agents/skills/playwright-local/` | Lab automation skill for contributors' agents |
| `.agents/skills/playwright-cli/` | Upstream `@playwright/cli` skill, vendored because `playwright-local` drives the lab through it |

The [source map](src/README.md) routes to each domain's documentation. Keep bridge
shims thin: React internals belong in TypeScript domain modules, exposed by
`src/iife.ts`. Extract cohesive setup, lifecycle, and serialization code before
growing large modules; preserve measured commit hot paths.

## Verify

MCP sources live in `src/mcp/`. Run `yarn chippy:mcp:build` after changing them;
it bundles the official SDK, schema validation, and dependency licenses into the
portable skill executable. Run `yarn test --project browser src/__tests__/chippy-mcp.test.ts`
for stdio/helper wire coverage and the packed library suite for a real React page.

Run the tests relevant to your change, then rebuild shipped assets when the
runtime changes. `yarn test` runs both projects; `yarn test --project unit` and
`yarn test --project browser` select one. Browser files run serially because
they share local server ports. If port 6007 belongs to another app, use
`CHIPPY_STORYBOOK_PORT=6008 yarn test --project browser`; the suites validate
the lab identity before reusing a server:

```sh
yarn test src/avalanche/detector.stock-react.test.ts src/__tests__/chippy-panel.test.ts
yarn avalanche:sync
yarn test src/__tests__/chippy-stock-react.pw.test.ts
yarn test src/avalanche/detector.lifecycle.pw.test.ts
yarn build-storybook
```

Browser suites own helper/Storybook startup when needed. Run suites that share
ports 6007/7823 sequentially so one suite cannot stop another's helper.

Every new command, option, field, and API path needs tests and consumer docs.
Shell commands need a test through shell → HTTP → command builder → bridge;
hand-built bridge inputs alone cannot detect fields dropped in transport.
Keep shell help, live types, DTOs, serialization, and references in parity.

DevTools bootstrap must precede React evaluation in browser tests. Hook-debug
validation also preloads Avalanche before navigation and checks a captured
`sourceId`; late injection proves only late-injection behavior. Local automation
and injection details belong in `.agents/skills/playwright-local/SKILL.md`, rather
than the portable consumer skill.

## Documentation and assets

The npm library lives in `packages/chippy/`. Run `yarn chippy:library:build`,
then `yarn test --project browser src/__tests__/chippy-library.pw.test.ts` to verify a
packed artifact installed in a clean consumer. The build reuses runtime sources,
the existing bootstrap shim, and Storybook addon; do not fork their implementation.

Document command signatures and evidence limits in the packaged skill and its
references. Keep local URLs, fixtures, and product-specific investigation findings
out of consumer procedures.
Use [brand guidance](docs/brand/README.md) when changing visual assets.

Extension changes require a version bump and a regenerated runtime. Users pick
them up by running the installer again and reloading the unpacked extension; see
the [release guide](docs/releasing.md).

The ATL adapter's unit tests cover its callback contract with both callback
orders; changes to it also need a check against a host with instrumented
react-dom.

## Add a built-in plugin

1. Put the plugin in `src/plugins/<name>/` with focused unit tests, following
   `src/plugins/jira/context-provider.test.ts` or
   `src/plugins/atl/commit-metrics-adapter.test.ts`.
2. Add it to `BUILTIN_PLUGINS` in `src/plugins/index.ts`, to the default plugin
   options in `.agents/skills/chippy/extension/panel-settings.js`, and to
   `BUILTIN_PLUGINS` in `packages/chippy/bin/pack.mjs`.
3. Rebuild the shipped bundles with `yarn avalanche:sync` and the skill archive
   with `yarn chippy:zip`.
4. If the plugin changes what agents see, such as a new boundary kind, document it
   in the skill's references.

## Contributor License Agreement

Atlassian requires contributors to sign a Contributor License Agreement, known as a CLA. This serves as a record stating that the contributor is entitled to contribute the code/documentation/translation to the project and is willing to have it used in distributions and derivative works (or is willing to transfer ownership).

Prior to accepting your contributions we ask that you please follow the appropriate link below to digitally sign the CLA. The Corporate CLA is for those who are contributing as a member of an organization and the individual CLA is for those contributing as an individual.

* [CLA for corporate contributors](https://opensource.atlassian.com/corporate)
* [CLA for individuals](https://opensource.atlassian.com/individual)
