# Chrome Web Store release

Repository paths in this reference are relative to the repository root.

## Extension publish checklist — Chrome Web Store

The extension is published to the Chrome Web Store. Any change to extension files requires a store publish cycle. This is not the same as `yarn avalanche:sync`.

**Files that require a store publish when changed:**
- `.agents/skills/chippy/extension/avalanche.iife.js` (generated — do not edit directly; run `yarn avalanche:sync` first)
- `.agents/skills/chippy/extension/early-bootstrap.js`
- `.agents/skills/chippy/extension/background.js`
- `.agents/skills/chippy/extension/armed-reload-startup.js`
- `.agents/skills/chippy/extension/startup-handoff.js`
- `.agents/skills/chippy/extension/content-script.js`
- `.agents/skills/chippy/extension/chippy-page-bridge.js`
- `.agents/skills/chippy/extension/frame-link.js`
- `.agents/skills/chippy/extension/manifest.json`
- `.agents/skills/chippy/extension/popup.*`

**Additional publish requirements:**
- All code quality rules above must pass.
- `yarn avalanche:sync` must be run; verify the bundle reflects the change.
- Bump `manifest.json` version — the store rejects duplicate versions.
