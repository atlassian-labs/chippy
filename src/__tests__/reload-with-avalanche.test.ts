import { STORYBOOK_ORIGIN, STORYBOOK_PORT, assertChippyLabIdentity } from '../test/chippy-lab-target';
// Headless verification for chippy.sh reload-with-avalanche.
//
// Goal: prove (or disprove) that the helper-side `reload-with-avalanche` flow
// can capture commits that happen DURING initial mount on a fresh page load.
//
// Story under test: Avalanche/MountUnmountLab
//   - Commit 1: mount <Initial> children.
//   - Commit 2 (after a 50ms effect): swap to <Replacement> children.
//     -> ~6 unmountedComponents, ~1 unmountedSubtree.
//
// In real-browser Mode B, the extension's webNavigation.onCommitted listener
// injects early-bootstrap.js + late bundle scripts on every navigation. In
// Playwright headless Mode A, there is no extension, so we must reproduce the
// same lifecycle manually:
//   1. Open page (clean, no Chippy).
//   2. Inject Chippy + Avalanche bundles.
//   3. Wait for connection on the helper side.
//   4. Run `chippy.sh reload-with-avalanche <clientId> <origin> ...`
//      The helper:
//        a. arms the origin server-side
//        b. tells the page to reload (page receives 'reload' message)
//        c. waits for the page to reconnect (after reload it must reinject Chippy)
//   5. After reload, we must reinject Chippy + Avalanche manually because
//      there is no extension; without that, the helper has nothing to talk to.
//
// This test documents the gap clearly: in Mode A you CANNOT capture the very
// first mount commits with reload-with-avalanche unless something runs before
// React. We measure exactly which commits make it into the capture vs which
// commits the page actually performed (counted via __ATL_REACT_METRICS).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const execFileAsync = promisify(execFile);

const STORY_ID = 'avalanche-mountunmountlab--manual-swap';
const STORY_URL = `${STORYBOOK_ORIGIN}/iframe.html?id=${STORY_ID}&viewMode=story`;
const ORIGIN = `${STORYBOOK_ORIGIN}`;
const HELPER_HEALTH = 'http://127.0.0.1:7823/__chippy/health';
const STORYBOOK_URL = `${STORYBOOK_ORIGIN}/`;
const CHIPPY_CLI = '.agents/skills/chippy/scripts/chippy.sh';

const DEVTOOLS_HOOK_SHIM = readFileSync(
  '.agents/skills/chippy/extension/devtools-hook-shim.js',
  'utf8',
);
const EARLY_BOOTSTRAP = readFileSync(
  '.agents/skills/chippy/extension/early-bootstrap.js',
  'utf8',
);
const AVALANCHE_IIFE = readFileSync(
  '.agents/skills/chippy/extension/avalanche.iife.js',
  'utf8',
);
const CHIPPY_INJECT_BUNDLE = [
  'inspect-react.js',
  'panel-dom.js',
  'layout-lab.js',
  'resolve-probes.js',
  'frame-link.js',
  'chippy-page-bridge.js',
].map((file) => readFileSync(`.agents/skills/chippy/extension/${file}`, 'utf8')).join('\n');

let storybook: ChildProcess | null = null;
let browser: Browser | null = null;
let startedStorybook = false;
let startedHelper = false;

async function isUp(url: string) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, timeoutMs = 15000, label = url) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isUp(url)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function start(command: string, args: string[], label: string) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let stderr = '';
  child.stderr?.on('data', (c) => { stderr += String(c); });
  child.on('exit', (code) => {
    if (code && code !== 0 && !stderr.includes('EADDRINUSE')) {
      console.error(`[${label}] exited ${code}\n${stderr}`);
    }
  });
  return child;
}

beforeAll(async () => {
  if (await isUp(STORYBOOK_URL)) await assertChippyLabIdentity(STORYBOOK_ORIGIN);
  if (!(await isUp(STORYBOOK_URL))) {
    storybook = start('yarn', ['storybook', '--ci', '-p', STORYBOOK_PORT], 'storybook');
    startedStorybook = true;
  }
  await waitFor(STORYBOOK_URL, 30000, 'storybook');
  await assertChippyLabIdentity(STORYBOOK_ORIGIN);

  if (!(await isUp(HELPER_HEALTH))) {
    await execFileAsync(CHIPPY_CLI, ['start']);
    startedHelper = true;
  }
  await waitFor(HELPER_HEALTH, 30000, 'chippy-helper');

  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (startedHelper) await execFileAsync(CHIPPY_CLI, ['stop']).catch(() => undefined);
  if (startedStorybook) storybook?.kill('SIGTERM');
});

async function injectChippyAndAvalanche(page: Page) {
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
  await page.waitForTimeout(800);
}

async function installExtensionLikeInitScripts(page: Page) {
  // Simulate the extension's MAIN-world document-start path on every navigation.
  // This is stronger than Mode A addScriptTag(): init scripts run before the
  // Storybook page's React bundle evaluates, so boot-time commits are capturable.
  await page.addInitScript(`
    globalThis.__CHIPPY_STARTUP_CONFIG = {
      enabled: true,
      helperBaseUrl: 'http://127.0.0.1:7823',
      avalanche: { autoStart: true, max: 0 }
    };
  `);
  await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
  await page.addInitScript({ content: AVALANCHE_IIFE });
  await page.addInitScript({ content: EARLY_BOOTSTRAP });
  await page.addInitScript({ content: CHIPPY_INJECT_BUNDLE });
}

async function injectChippyBridgeOnly(page: Page) {
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  await page.waitForTimeout(800);
}

async function waitForConnectedStory(storyId: string, timeoutMs = 10000): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const data = await getPagesJson();
    const hit = data.pages.find((p) => p.page.url.includes(storyId));
    if (hit) return hit.clientId;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for Chippy page connection for ${storyId}`);
}

async function getPagesJson() {
  const { stdout } = await execFileAsync(CHIPPY_CLI, ['pages']);
  return JSON.parse(stdout) as { pages: Array<{ clientId: string; page: { url: string } }> };
}

async function waitForConnectedClientId(timeoutMs = 10000): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const data = await getPagesJson();
    const hit = data.pages.find((p) => p.page.url.includes(STORY_ID));
    if (hit) return hit.clientId;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for Chippy page connection');
}

async function cliJson(args: string[]) {
  const { stdout, stderr } = await execFileAsync(CHIPPY_CLI, args);
  // chippy.sh writes status logs to stderr; the JSON payload is on stdout.
  // Some commands (reload-with-avalanche) emit multiple JSON blobs separated by stderr labels.
  return { stdout, stderr };
}

async function readAvalancheStatus(clientId: string) {
  const { stdout } = await execFileAsync(CHIPPY_CLI, ['avalanche-status', clientId]);
  return JSON.parse(stdout);
}

async function exportAvalanche(clientId: string) {
  const { stdout } = await execFileAsync(CHIPPY_CLI, ['avalanche-export', clientId], {
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function sumUnmounts(commitStats: Record<string, number[]>) {
  let uc = 0, us = 0;
  for (const arr of Object.values(commitStats)) {
    uc += arr[8] || 0;
    us += arr[9] || 0;
  }
  return { uc, us };
}

describe('reload-with-avalanche capture quality', () => {
  it('CONTROL: captures unmount when triggered AFTER detector install', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[page error]', m.text());
    });
    // Pre-install devtools hook shim BEFORE navigation so React-DOM picks it up
    // at module-evaluation time (otherwise replayComponentHooks collapses).
    await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
    await page.goto(STORY_URL, { waitUntil: 'load' });
    await injectChippyAndAvalanche(page);

    const clientId = await waitForConnectedClientId();

    // === The flow under test ===
    // We split reload-with-avalanche manually so we can:
    //   a) re-inject Chippy on the new page (no extension does it for us)
    //   b) measure detector install timing relative to React commits

    // 1. Arm
    await execFileAsync(CHIPPY_CLI, ['avalanche-arm', clientId, ORIGIN]);

    // 2. Trigger a real navigation reload (preserves clientId via storage)
    //    Use page.reload() to mimic the bundled `page-reload` semantics.
    const reloaded = page.reload({ waitUntil: 'load' });

    // 3. Race: re-inject Chippy + Avalanche AS EARLY AS POSSIBLE on the new page.
    //    In Mode B the extension's onCommitted does this in MAIN world before
    //    page scripts. In Mode A we cannot beat the page bundle; this is the
    //    structural gap the test documents.
    await reloaded;
    await injectChippyAndAvalanche(page);

    // 3b. The bundle alone does NOT auto-install the detector — only the
    //     extension's early-bootstrap does. Mimic that by calling install + reset.
    await execFileAsync(CHIPPY_CLI, ['avalanche-install', clientId]);

    // 3c. Now the detector is in. Trigger the swap explicitly — this is the
    //     unmount event we want captured. If THIS commit is not captured,
    //     the post-reload detector wiring is broken.
    await page.evaluate(() => {
      const fn = (window as any).__mountUnmountLabSwap;
      if (typeof fn === 'function') fn();
    });

    // 4. Settle window — let React schedule + commit the swap.
    await page.waitForTimeout(3500);

    // Diagnostic: dump what's actually in the page
    const pageState = await page.evaluate(() => {
      const w: any = window;
      return {
        href: location.href,
        hasStory: !!document.querySelector('[data-testid="mount-unmount-lab"]'),
        phaseText: document.querySelector('[data-testid="mount-unmount-lab"] p')?.textContent,
        liCount: document.querySelectorAll('[data-testid="mount-unmount-lab"] li').length,
        firstLiKind: document.querySelector('[data-testid="mount-unmount-lab"] li')?.getAttribute('data-kind'),
        hasCHIPPY: !!w.__CHIPPY,
        hasAvalanche: !!w.__AVALANCHE__,
        avalancheStatus: w.__AVALANCHE__?.status?.(),
        hasReactHook: !!w.__REACT_DEVTOOLS_GLOBAL_HOOK__,
        reactHookKeys: w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ? Object.keys(w.__REACT_DEVTOOLS_GLOBAL_HOOK__).slice(0, 20) : null,
        hasMetrics: !!w.__ATL_REACT_METRICS,
        metricsKeys: w.__ATL_REACT_METRICS ? Object.keys(w.__ATL_REACT_METRICS) : null,
        renderersSize: w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size,
      };
    });
    console.log('[page state]', JSON.stringify(pageState, null, 2));

    // 5. Read what the helper captured
    const status = await readAvalancheStatus(clientId);
    const captured = status?.result?.status ?? {};
    console.log('[reload-with-avalanche] status', JSON.stringify(captured));

    const exp = await exportAvalanche(clientId);
    const cs = exp?.result?.payload?.commitStats ?? {};
    const meta = exp?.result?.payload?.meta ?? {};
    const { uc, us } = sumUnmounts(cs);
    const mu = meta?.memoizedUpdatersSupport ?? {};
    console.log(JSON.stringify({
      capturedCommits: Object.keys(cs).length,
      metaCommits: meta.commits,
      memoizedUpdatersCommitsWithData: mu.commitsWithData,
      memoizedUpdatersCoverage: mu.coverage,
      integrationMode: meta.integrationMode,
      unmountedComponents: uc,
      unmountedSubtrees: us,
      perCommit: Object.fromEntries(
        Object.entries(cs).map(([k, v]) => [k, { collateral: v[0], performedWork: v[3], unmountedComponents: v[8], unmountedSubtrees: v[9] }])
      ),
    }, null, 2));

    // ASSERTIONS
    // The mount-unmount swap is deterministic. If reload-with-avalanche works,
    // unmountedComponents should be >= 6 (one per <Initial> child).
    // If it's 0, the early commits were not captured — that proves the gap.
    expect(captured.installed).toBe(true);
    expect(typeof captured.commitCount).toBe('number');

    // We DO expect to see the unmount, since we re-inject before the 50ms swap.
    // If this fails, log a clear message — that's the bug.
    if (uc === 0) {
      throw new Error(
        `EXPECTED unmounts to be captured but got 0. ` +
        `commits=${Object.keys(cs).length} integrationMode=${meta.integrationMode}. ` +
        `This means the detector hooked in AFTER React's swap commit. ` +
        `Coverage=${mu.coverage} (memoizedUpdatersCommitsWithData=${mu.commitsWithData}).`
      );
    }
    expect(uc).toBeGreaterThanOrEqual(6);

    await page.close();
  }, 60000);

  it('PROOF: reload-with-avalanche captures boot-time unmounts when scripts run before React', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await installExtensionLikeInitScripts(page);

    const AUTO_STORY_ID = 'avalanche-mountunmountlab--default';
    const AUTO_STORY_URL = `${STORYBOOK_ORIGIN}/iframe.html?id=${AUTO_STORY_ID}&viewMode=story`;
    await page.goto(AUTO_STORY_URL, { waitUntil: 'load' });

    // Actual reload. The init scripts persist across navigation, so Avalanche is
    // installed before React evaluates on the reloaded document. This mirrors the
    // part of reload-with-avalanche that matters for capture quality: arm before
    // reload, then capture the load window. We read page-side export directly to
    // avoid helper reconnect races in headless Mode A.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const exp = await page.evaluate(() => (window as any).__AVALANCHE__?.exportLast?.());
    const cs = exp?.commitStats ?? {};
    const meta = exp?.meta ?? {};
    const { uc, us } = sumUnmounts(cs);
    const dom = await page.evaluate(() => ({
      firstLiKind: document.querySelector('[data-testid="mount-unmount-lab"] li')?.getAttribute('data-kind'),
      phaseText: document.querySelector('[data-testid="mount-unmount-lab"] p')?.textContent,
      avalancheStatus: (window as any).__AVALANCHE__?.status?.(),
    }));

    console.log(JSON.stringify({
      proof: 'reload-with-avalanche captured boot-time unmounts with extension-like pre-React injection',
      capturedCommits: Object.keys(cs).length,
      metaCommits: meta.commits,
      memoizedUpdatersCoverage: meta?.memoizedUpdatersSupport?.coverage,
      integrationMode: meta.integrationMode,
      unmountedComponents: uc,
      unmountedSubtrees: us,
      dom,
    }, null, 2));

    expect(dom.firstLiKind).toBe('replacement');
    expect(uc).toBeGreaterThanOrEqual(6);
    expect(us).toBeGreaterThanOrEqual(1);
    // The lab runs stock react-dom, which never drives __ATL_REACT_METRICS, so
    // capture stays on the DevTools hook.
    expect(meta.integrationMode).toBe('devtools');

    await page.close();
  }, 60000);

  // GAP test — the auto-swap variant fires its unmount commit at +50ms after
  // mount. In Mode A there is no extension to inject the detector via
  // chrome.scripting.MAIN before page scripts. By the time we addScriptTag()
  // and call avalanche-install, the swap has already happened.
  // This test EXPECTS uc=0 to document the gap. If a future Chippy change
  // closes the gap (e.g. helper-side proxy that injects bundles before page
  // scripts), this test should be updated accordingly.
  it('GAP: misses boot-time unmount when detector installs after page mount (Mode A)', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });

    const AUTO_STORY_ID = 'avalanche-mountunmountlab--default';
    const AUTO_STORY_URL = `${STORYBOOK_ORIGIN}/iframe.html?id=${AUTO_STORY_ID}&viewMode=story`;
    await page.goto(AUTO_STORY_URL, { waitUntil: 'load' });
    await injectChippyAndAvalanche(page);

    // Wait for the connected page entry (poll on AUTO_STORY_ID)
    let clientId: string | null = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const data = await getPagesJson();
      const hit = data.pages.find((p) => p.page.url.includes(AUTO_STORY_ID));
      if (hit) { clientId = hit.clientId; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!clientId) throw new Error('timed out waiting for connected page');

    await execFileAsync(CHIPPY_CLI, ['avalanche-arm', clientId, ORIGIN]);
    await page.reload({ waitUntil: 'load' });
    await injectChippyAndAvalanche(page);
    await execFileAsync(CHIPPY_CLI, ['avalanche-install', clientId]);

    // Settle for the auto-swap effect (50ms) — already happened by the time
    // we got here, so we don't expect to capture anything.
    await page.waitForTimeout(3500);

    const status = await readAvalancheStatus(clientId);
    const captured = status?.result?.status ?? {};
    const exp = await exportAvalanche(clientId);
    const cs = exp?.result?.payload?.commitStats ?? {};
    const meta = exp?.result?.payload?.meta ?? {};
    const { uc, us } = sumUnmounts(cs);
    const mu = meta?.memoizedUpdatersSupport ?? {};

    console.log(JSON.stringify({
      gap: true,
      capturedCommits: Object.keys(cs).length,
      metaCommits: meta.commits,
      memoizedUpdatersCommitsWithData: mu.commitsWithData,
      memoizedUpdatersCoverage: mu.coverage,
      integrationMode: meta.integrationMode,
      unmountedComponents: uc,
      unmountedSubtrees: us,
      installedAfterStatus: captured,
      pageDom: await page.evaluate(() => ({
        liCount: document.querySelectorAll('[data-testid="mount-unmount-lab"] li').length,
        firstLiKind: document.querySelector('[data-testid="mount-unmount-lab"] li')?.getAttribute('data-kind'),
      })),
    }, null, 2));

    // The page DOM should already reflect the post-swap state — proving the
    // commit happened.
    const dom = await page.evaluate(() => ({
      firstLiKind: document.querySelector('[data-testid="mount-unmount-lab"] li')?.getAttribute('data-kind'),
    }));
    expect(dom.firstLiKind).toBe('replacement');

    // The capture is expected to be empty (boot-time commits lost).
    // We assert this as the documented gap.
    expect(uc).toBe(0);

    await page.close();
  }, 60000);
});
