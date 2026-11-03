# Releasing Chippy

Chippy has a self-contained agent skill, a Chrome extension, and an npm library.
The development repository is their source. A runtime rebuild
updates local assets; publication is a separate step.

## Build and validate

1. Run relevant unit and wire tests, then browser suites sequentially.
   For MCP changes, run `yarn chippy:mcp:build` before tests and skill packaging;
   the library build also regenerates that executable automatically.
2. Run `yarn avalanche:sync` to build the TypeScript runtime and copy both browser
   bundles into the extension. Never edit generated bundles directly.
3. For visual changes, regenerate brand assets and inspect the popup, page panel,
   and Storybook header.
4. Bump `extension/manifest.json` for every extension release. Chrome Web Store
   rejects a previously published version.
5. When changing early bootstrap or the ATL metrics accessor, verify against a
   real ATL-enabled host; jsdom cannot establish host compatibility. The local
   agent-driven procedure is [manual extension verification](chippy-manual-verification.md).
6. With the `zip` utility installed, build the archives with `yarn chippy:zip` and
   `yarn chippy:extension:zip`. They are written to the repository root, ignored by
   git, and attached to the GitHub release.
7. For the npm library, run `yarn chippy:library:build`, verify the packed-consumer
   suite, then run `npm pack` in `packages/chippy/`. Its build requires the
   current generated extension assets from step 2. The library has its own version
   in `packages/chippy/package.json`.

The skill archive contains `SKILL.md`, references, scripts, browser support,
snippets, and extension assets. Keep external project links, credentials, local
logs, and test captures out of distributed artifacts.

## Publish

There is no public Chrome Web Store listing yet; users load the skill's
`extension` folder unpacked. When a listing exists, link it from the README and
the installer, and upload the extension archive through its owner. Store
publication is independent of bundle generation.

The npm package is published to npmjs through Atlassian's Artifactory
`npm-public` forwarder by the [Publish npm package](../.github/workflows/publish.yml)
workflow:

1. Bump the version in `packages/chippy/package.json` and merge it to `main`.
   A version that is already published is rejected.
2. Run the workflow from the Actions tab on `main`. Without the `publish` input
   it only builds the tarball and installs the skill from it. With `publish`, it
   exchanges the job's GitHub OIDC token for a temporary Artifactory token through
   `atlassian-labs/artifact-publish-token` and publishes that tarball.
   A prerelease version goes out under the dist-tag named after its identifier,
   for example `next`; other versions go out as `latest`.

Artifactory issues the token only to workflows on a branch, so publishing from a
tag or release event fails. The package must be on the `npm-public` allowlist
(`@atlassian/chippy/**` and `.npm/@atlassian/chippy/**`), requested through a
BENGHELP ticket; without it the publish is rejected.

## Public repository readiness

Chippy uses the [Apache 2.0 License](../LICENSE). Both archives include the license.
Chippy does not distribute React patches; optional ATL instrumentation belongs
to the application being inspected.
The public repository is `atlassian-labs/chippy`. Issues go to its GitHub issue
tracker and vulnerabilities to its GitHub private vulnerability reporting, which
the repository owner enables in the repository settings. Chippy is an open-source
project; its name and assets carry no brand restriction. Keep package dependencies resolvable from public
registries and validate a clean checkout without corporate credentials.

These are publication decisions; they do not alter the runtime installation
contract or require applications to patch React.
