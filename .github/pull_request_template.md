## What this changes

## How it was verified

- [ ] `yarn test --project unit`
- [ ] `yarn test --project browser` (runtime, bridge, or extension changes)
- [ ] `yarn avalanche:sync` and `yarn chippy:mcp:build` rerun, and the rebuilt bundles committed (source under `src/` changed)
- [ ] `yarn chippy:zip` / `yarn chippy:extension:zip` rerun (skill or extension files changed)
- [ ] Docs updated: `SKILL.md`, references, or `CHANGELOG.md`

See [CONTRIBUTING.md](../CONTRIBUTING.md).
