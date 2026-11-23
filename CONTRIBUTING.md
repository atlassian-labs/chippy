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
yarn shipped:build
yarn exec playwright install chromium
yarn storybook --ci -p 6007
```

`yarn shipped:build` builds the extension's Avalanche bundles and the skill's MCP
and offline-analyzer executables from `src/`. `dev` does not commit them, and the
extension, helper, and tests need them, so rebuild after pulling or changing
`src/`. If you used the old pre-push hook, run `git config --unset core.hooksPath`.

Storybook runs at `http://127.0.0.1:6007/`. Start the helper separately with
`.agents/skills/chippy/scripts/chippy.sh start`; it listens on port 7823.
The lab disables Storybook usage telemetry, targets ES2022 browsers, and uses
standard React DOM.

## Branches

Branch from `dev` and open pull requests against `dev`. `main` is what users
install with `npx skills add`, so it also carries the generated bundles; it moves
only when a maintainer runs the Release workflow and merges its pull request. A
pull request opened against `main` is moved to `dev` automatically. See
[Releasing](docs/releasing.md#branches).

## Find the change owner

| Path | Owns |
| --- | --- |
| `src/avalanche/` | Commit capture, report projection, and the commit metrics adapter seam |
| `src/debug-render/` | Hook capture and structural replay |
| `src/layout-lab/` | DOM/fiber resolution and boundary inspection |
| `src/chippy-bridge/` | Command capabilities and transport-safe results |
| `.agents/skills/chippy/extension/` | Browser integration, panel, and shipped runtime assets |
| `.agents/skills/chippy/scripts/` | Local helper and public CLI |
| `.agents/skills/chippy/references/` | Consumer procedures and contracts |
| `.storybook/chippy-addon/`, Storybook fixtures in `src/` | Local validation integration and scenarios |
| `src/plugins/` | Plugin registry and JSON packs behind the [plugin seams](docs/plugins.md); no product plugins |
| `.agents/skills/playwright-local/` | Lab automation skill for contributors' agents |
| `.agents/skills/playwright-cli/` | Upstream `@playwright/cli` skill, vendored because `playwright-local` drives the lab through it |

Users install Chippy with `npx skills add atlassian-labs/chippy --skill chippy`,
which discovers every skill under `.agents/skills/`. Keep `metadata.internal: true`
in the frontmatter of `playwright-local` and `playwright-cli`, including after
updating the vendored copy, so the skills CLI offers only `chippy`. The CI
`package` job fails if it lists either one.

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

The repository root is the npm package: `src/package/` holds its entry points,
`bin/` its commands, and `yarn chippy:library:build` writes the bundles to `lib/`
and the packaged skill to `skills/chippy/`.
Run `yarn chippy:library:build`,
then `yarn test --project browser src/__tests__/chippy-library.pw.test.ts` to verify a
packed artifact installed in a clean consumer. The build reuses runtime sources,
the existing bootstrap shim, and Storybook addon; do not fork their implementation.

Document command signatures and evidence limits in the packaged skill and its
references. Keep local URLs, fixtures, and product-specific investigation findings
out of consumer procedures.
Use [brand guidance](docs/brand/README.md) when changing visual assets.

Extension changes require a version bump and a regenerated runtime. Users pick
them up by running `npx skills update chippy` and reloading the unpacked extension; see
the [release guide](docs/releasing.md).

The commit metrics adapter seam is covered by detector unit tests that use the
neutral adapter in `src/avalanche/test-support/`, with both callback orders.

## Product plugins

Chippy ships no product plugins. Do not add rules, adapters, or names that belong
to one product to `src/`. Ship them as a [pack](docs/plugins.md#packs) or a
[`chippy pack`](docs/plugins.md#packing-a-custom-build) build that lives with the
product. When a generic seam needs to grow:

1. Change the seam in `src/plugins/` or `src/avalanche/commit-metrics-adapter.ts`
   with focused unit tests that use neutral fixtures.
2. Rebuild the shipped bundles with `yarn avalanche:sync`.
3. If the change alters what agents see, such as a new boundary kind, document it
   in the skill's references.

## Contributor License Agreement

Atlassian requires contributors to sign a Contributor License Agreement, known as a CLA. This serves as a record stating that the contributor is entitled to contribute the code/documentation/translation to the project and is willing to have it used in distributions and derivative works (or is willing to transfer ownership).

Prior to accepting your contributions we ask that you please follow the appropriate link below to digitally sign the CLA. The Corporate CLA is for those who are contributing as a member of an organization and the individual CLA is for those contributing as an individual.

* [CLA for corporate contributors](https://opensource.atlassian.com/corporate)
* [CLA for individuals](https://opensource.atlassian.com/individual)
