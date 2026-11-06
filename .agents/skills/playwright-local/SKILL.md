---
name: playwright-local
description: Browser automation for the Storybook layout lab. Use for opening, inspecting, and interacting with the running Storybook app.
allowed-tools: Bash(playwright-cli:*)
metadata:
  internal: true
---

# Playwright — Storybook Layout Lab

## Two modes of operation

### Mode A — Chippy-controlled browser (Playwright)
Chippy opens and drives a Playwright browser directly. Used for agent-side automation, verification, and headless testing. The user does NOT see this browser.

### Mode B — User's real browser (Chippy sidecar)
The user opens Storybook in their own browser with the Chippy extension installed. Chippy communicates via the sidecar helper server. No Playwright window is shown to the user.

**For RDE / forwarded-port environments, prefer Mode B.** The user's browser is already there — no need to expose a Playwright window.

---

## Prerequisites

### Storybook
```bash
yarn storybook --ci -p 6007 &
curl -sf http://127.0.0.1:6007/ >/dev/null && echo up || echo down
```

### Chippy helper sidecar (required for Mode B, optional but useful for Mode A)
Use the Chippy skill to manage helper lifecycle and helper-side commands. Do not duplicate the Chippy wrapper commands in this skill.

The sidecar serves the inject bundle, tracks connected browser tabs, and relays commands.

---

## Mode B — Sidecar workflow (preferred for real-browser use)

The user loads the Chippy extension (unpacked from `extension/`) in their browser.  
The extension connects silently to `http://127.0.0.1:7823` and injects the probe bundle when activated.

### Check what pages are connected
Use the Chippy skill for sidecar page inspection and helper commands.

Returns:
- `count` — number of connected tabs
- `pages[]` — each with `clientId`, `page.url`, `buildMode`, `activated`, `probesActive`, `latestSnapshot`
- `duplicatePageWarnings` — if two tabs are on the same URL

### Read probe state (what the user's probes are pointing at)
Use the Chippy skill for probe-state reads from the sidecar.

The `latestSnapshot.markers` field has the resolved component for each probe:
- `markers['1'].resolved.component.name` — component name
- `markers['1'].resolved.component.key` — React key
- `markers['1'].resolved.component.source` — file/line/col (dev builds only)
- `markers['1'].resolved.confidence` — `"dev"` | `"production"` | `"unknown"`
- `markers['1'].resolved.note` — plain-language warning if source is unavailable

### Request a fresh snapshot from a specific page
Use the Chippy skill for snapshot refreshes and sidecar page commands.

### Send a command to all connected pages
Use the Chippy skill for helper-side page commands.

### Send a command to one specific page
Use the Chippy skill for targeted helper-side page commands.

### Available commands
| type | effect |
|---|---|
| `activate` | Enable probes on that tab |
| `deactivate` | Disable probes on that tab |
| `ensure-probes` | Show markers if not already visible |
| `clear-probes` | Remove markers |
| `request-snapshot` | Ask page to publish latest probe state now |
| `show-status` | Show a status message in the page overlay (`text` field) |
| `hide-status` | Remove the status overlay |

### Duplicate page warning
If two tabs are open on the same URL, the helper warns in `/api/pages` and pushes a `show-status` message to both tabs. Surface this to the user:
> "Chippy sees 2 tabs on this page. Is that intentional?"

### Build mode
- `"dev"` — `_debugSource` present. Source file/line/col are reliable.
- `"production"` — no `_debugSource`. Component names only (may be minified). `note` field explains.
- `"unknown"` — page not yet activated or no React detected.

### Cross-source hints
When probes span a dev and a production page, `window.__CHIPPY.resolveProbesCompact` returns a `__crossSourceHints` array that tries to match component names across both sources.

---

## Mode A — Playwright-controlled browser

### Before any inject step

The Chippy helper must be running before *any* `addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/...' })` will succeed and before any `chippy.sh ...` command can produce useful output.

1. Start the helper via the Chippy skill (`chippy.sh start`) and confirm `chippy.sh health` returns ok.
2. Confirm Storybook is reachable at the expected URL (default `http://127.0.0.1:6007`).
3. Only then proceed with browser open + bundle injection below.

If `addScriptTag` for `http://127.0.0.1:7823/__chippy/inject.js` fails with a connection error, the helper is not running. Stop and start it; do not attempt fallbacks.


Use this for agent-side verification, headless testing, or when the user cannot install the extension.

### Open a visible browser
```bash
yarn exec playwright-cli -s=lab open "http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default&viewMode=story" --browser=chromium --persistent --headed
```

**Critical flags:**
- `--headed` → makes the browser VISIBLE
- `--persistent` → keeps session alive
- `-s=lab` → session name, reuse everywhere
- `--browser=chromium` → avoids hijacking system Chrome

**Direct story URL** — always use `/iframe.html?id=STORY_ID&viewMode=story`.

### Inject the full bundle (includes bridge)
```bash
yarn exec playwright-cli -s=lab run-code "async page => {
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  await page.waitForTimeout(1500);
  return await page.evaluate(() => ({
    hasCHIPPY: !!window.__CHIPPY,
    hasInspectReact: !!(window.__CHIPPY && window.__CHIPPY.inspectReact),
    hasLayoutLab: !!(window.__CHIPPY && window.__CHIPPY.layoutLab),
    href: location.href,
  }));
}"
```

**Do not require `window.__chippyPageBridge` as the injection success signal.** In local Playwright verification, the reliable success check is `window.__CHIPPY` plus a connected page appearing in `chippy.sh pages` for the current story URL. Treat helper-side connection as source of truth.

After injection, verify the connection with:

```bash
./.agents/skills/chippy/scripts/chippy.sh pages
```

Pick the page whose URL matches the opened story and whose `buildMode` is `dev`.

### Inject Avalanche manually when the story does not ship `__AVALANCHE__`

Some local Storybook stories do **not** include Avalanche in the page bundle. That is not a blocker.

If `avalanche-arm` / `avalanche-recapture` says `__AVALANCHE__ not available`, inject the bundle into the already-open page **from the helper**, not from a filesystem path. The helper serves it at `/__chippy/avalanche.iife.js`, so this works regardless of `cwd`:

```bash
yarn exec playwright-cli -s=lab run-code "async page => {
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
  await page.waitForTimeout(500);
  return await page.evaluate(() => ({
    hasAvalanche: !!window.__AVALANCHE__,
    hasInstall: !!(window.__AVALANCHE__ && typeof window.__AVALANCHE__.install === 'function'),
  }));
}"
```

If `hasAvalanche` is `false`, the helper is not running. Start it via the Chippy skill before retrying.

Then normalize the detector state before reproducing the symptom:

```bash
./.agents/skills/chippy/scripts/chippy.sh avalanche-recapture <clientId>
```

Only after that should you replay the trigger and run `avalanche-*` / `avalanche-debug-hook`.

### Re-inject after code changes / reload

A full page reload wipes any previously injected globals. Re-inject Chippy and verify the same way as the initial injection — using `window.__CHIPPY` plus `chippy.sh pages`, not `__chippyPageBridge`:

```bash
yarn exec playwright-cli -s=lab run-code "async page => {
  await page.evaluate(() => {
    delete window.__CHIPPY;
    delete window.__AVALANCHE__;
  });
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  await page.waitForTimeout(1500);
  return await page.evaluate(() => ({
    hasCHIPPY: !!window.__CHIPPY,
    hasAvalanche: !!window.__AVALANCHE__,
    href: location.href,
  }));
}"
```

If Avalanche is needed for the next step and the story bundle does not ship it, follow the manual Avalanche injection block above. Then verify the connection on the helper side:

```bash
./.agents/skills/chippy/scripts/chippy.sh pages
```

### All subsequent commands use `-s=lab`
```bash
yarn exec playwright-cli -s=lab snapshot          # accessibility tree
yarn exec playwright-cli -s=lab screenshot         # visual check
yarn exec playwright-cli -s=lab eval "() => document.title"
yarn exec playwright-cli -s=lab goto "http://..."  # navigate
yarn exec playwright-cli -s=lab reload
yarn exec playwright-cli -s=lab close
```

### Drag markers onto components
```bash
yarn exec playwright-cli -s=lab run-code "async page => {
  const m1 = await page.locator('[data-layout-lab-marker=\"1\"]').boundingBox();
  const target = await page.locator('article').first().boundingBox();
  await page.mouse.move(m1.x + m1.width/2, m1.y + m1.height/2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width/2, target.y + target.height/2, { steps: 20 });
  await page.mouse.up();
}"
```

### Read probe state from within the page
```bash
yarn exec playwright-cli -s=lab run-code "async page => {
  return await page.evaluate(() => window.__CHIPPY.resolveProbesCompact('1', '2', '3'));
}" | node -e "
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  const raw = chunks.join('');
  const match = raw.match(/### Result\n([\s\S]*?)\n### /);
  if (match) {
    try { console.log(JSON.stringify(JSON.parse(match[1]), null, 2)); } catch(e) { console.log(match[1]); }
  }
});
"
```

---

## Probe state — what to read

Each resolved probe has:

```json
{
  "confidence": "dev",
  "dom": { "tag": "div", "text": "Alpha", "fiberType": "DemoCard", "source": null },
  "component": {
    "name": "DemoCard",
    "key": "alpha",
    "props": { "title": "Alpha" },
    "source": { "fileName": "src/layout/LayoutPlayground.jsx", "lineNumber": 42, "columnNumber": 7 },
    "owners": [{ "name": "LayoutPlayground", "key": null, "source": { ... } }],
    "componentStack": null
  },
  "note": null
}
```

If `confidence` is `"production"`:
- `source` fields are `null`
- `componentStack` is populated with a fiber return-chain walk (names may be minified)
- `note` explains the limitation

---

## Sidecar endpoints — quick reference

| method | path | purpose |
|---|---|---|
| GET | `/health` | liveness check |
| GET | `/__chippy/inject.js` | full browser bundle (inspect-react + layout-lab + resolve-probes + bridge) |
| GET | `/api/pages` | all connected tabs |
| GET | `/api/pages/:clientId` | one tab |
| POST | `/api/pages/:clientId/snapshot` | request fresh probe snapshot from one tab |
| POST | `/api/command` | send command to one or all tabs |
| GET | `/api/state` | alias for `/api/pages` with server metadata |

---

## Common mistakes — DO NOT

1. Forget `--headed` in Mode A (browser opens invisibly)
2. Use `yarn playwright-cli` instead of `yarn exec playwright-cli`
3. Open multiple sessions (use ONE session name)
4. Use `open` when session exists (use `goto` instead)
5. Use `require()` inside `run-code` (browser context, not Node)
6. Forget that full page reloads wipe injected globals — re-inject after reload
7. Read probe state before activating — `buildMode` stays `"unknown"` until activated
8. Forget to check `duplicatePageWarnings` when multiple tabs are open
9. Treat `"production"` probe data as reliable for source locations — it isn't
10. Start the script server on `:9999` separately — the sidecar at `:7823` already serves `/__chippy/inject.js`

## Close
```bash
yarn exec playwright-cli -s=lab close
yarn exec playwright-cli list          # check for zombie sessions
yarn exec playwright-cli close-all     # nuclear option
```
