# Changelog

Chippy ships three artifacts from this repository. Each has its own version:

| Artifact | Version source | Policy |
|---|---|---|
| Agent skill | This changelog | Follows the repository release tag. |
| Chrome extension | `.agents/skills/chippy/extension/manifest.json` | Bumped for every store upload; the store rejects a reused version. |
| npm package | `packages/chippy/package.json` | Semantic versioning. Before 1.0, minor versions may contain breaking changes. |

The helper HTTP API is internal to the skill and the extension. Changes to the
routes the published extension calls (`GET /api/pages`, `POST /api/avalanche-arm`)
must stay compatible with the extension version in the store.

## Unreleased

### Added

- Command routes on the local helper require a per-run token. The helper binds
  to loopback by default; `chippy.sh start --host <address>` or
  `CHIPPY_HELPER_HOST` opts into a wider bind.
- Local MCP server with automatic helper startup.
- Offline Avalanche analysis runs the live command code over a saved export.
  `source-search --name` finds components by name.
- `npx @atlassian/chippy install` installs the skill and prints the extension and MCP setup.
- CI for unit and browser tests, type checking, and staleness of committed bundles.

### Fixed

- `avalanche-save` and `avalanche-offline` work with the current export format.
- The skill archive includes every file the helper needs.
- `chippy.sh` no longer passes the helper token on the curl command line.
