import { STORYBOOK_ORIGIN, STORYBOOK_PORT, assertChippyLabIdentity } from './test/chippy-lab-target';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CHIPPY_CLI = '.agents/skills/chippy/scripts/chippy.sh';
const DEVTOOLS_HOOK_SHIM = readFileSync('.agents/skills/chippy/extension/devtools-hook-shim.js', 'utf8');
const HELPER_URL = 'http://127.0.0.1:7823/__chippy/health';
const STORYBOOK_URL = `${STORYBOOK_ORIGIN}/`;
const STORY_IDS = {
  churnDefault: 'avalanche-churnlab--default',
  debugHookLab: 'avalanche-churnlab--debug-hook-lab',
  unstableProvider: 'avalanche-churnlab--unstable-provider',
  effectAvalanche: 'avalanche-churnlab--effect-avalanche',
  mixedStability: 'avalanche-churnlab--mixed-stability',
  stabilityChain: 'stability-stabilitychain--default',
  stabilityChainFixed: 'stability-stabilitychainfixed--default',
} as const;

type StoryId = (typeof STORY_IDS)[keyof typeof STORY_IDS];

type IntegrationIdentity = {
  kind: 'extension' | 'import' | 'storybook';
  who: string;
  source: string;
  reinjectsOnReload: boolean;
  reloadAction: string;
};

type ConnectedPage = { clientId: string; page: { url: string }; integration: IntegrationIdentity | null };

let storybook: ChildProcess | null = null;
let browser: Browser | null = null;
let startedStorybook = false;
let startedHelper = false;

async function isUp(url: string) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, timeoutMs = 15000, label = url) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function start(command: string, args: string[], label: string) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  child.on('exit', (code) => {
    if (code && code !== 0 && !stderr.includes('EADDRINUSE')) {
      console.error(`[${label}] exited with code ${code}\n${stderr}`);
    }
  });

  return child;
}

async function cliJson(args: string[]) {
  const { stdout } = await execFileAsync(CHIPPY_CLI, args);
  return JSON.parse(stdout);
}

async function getPages() {
  return cliJson(['pages']) as Promise<{ pages: ConnectedPage[] }>;
}

async function openInjectedPage(storyId: StoryId): Promise<Page> {
  if (!browser) throw new Error('browser not started');
  const page = await browser.newPage();
  await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
  await page.goto(`${STORYBOOK_ORIGIN}/iframe.html?id=${storyId}&viewMode=story`, { waitUntil: 'load' });
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  // The bridge command surface (find-fibers, describe-component, evalAvalanche,
  // safeJson, etc.) lives in the avalanche.iife.js bundle — see
  // src/chippy-bridge/*. The browser-extension path injects it via
  // chrome.scripting.MAIN; in Playwright we inject it explicitly here so the
  // bridge shims in chippy-page-bridge.js can resolve __AVALANCHE__.bridge.*.
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
  await page.waitForFunction(() => (window as any).__CHIPPY?.connState === 'connected', null, { timeout: 10_000 });
  await page.waitForTimeout(250);
  return page;
}

async function waitForConnectedPage(storyId: StoryId, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await getPages();
    const match = state.pages.find((page) => String(page.page?.url || '').includes(`iframe.html?id=${storyId}`));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for connected Chippy page for ${storyId}`);
}

beforeAll(async () => {
  if (await isUp(STORYBOOK_URL)) await assertChippyLabIdentity(STORYBOOK_ORIGIN);
  if (!(await isUp(STORYBOOK_URL))) {
    storybook = start('yarn', ['storybook', '--ci', '-p', STORYBOOK_PORT], 'storybook');
    startedStorybook = true;
  }

  await waitFor(STORYBOOK_URL, 30000, 'storybook');
  await assertChippyLabIdentity(STORYBOOK_ORIGIN);

  if (!(await isUp(HELPER_URL))) {
    await execFileAsync(CHIPPY_CLI, ['start']);
    startedHelper = true;
  }

  await waitFor(HELPER_URL, 30000, 'chippy-helper');
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (startedHelper) {
    await execFileAsync(CHIPPY_CLI, ['stop']).catch(() => undefined);
  }
  if (startedStorybook) storybook?.kill('SIGTERM');
});

describe('Chippy browser capabilities from scenario matrix', () => {
  it('G1: injects Chippy and exposes runtime globals', async () => {
    const page = await openInjectedPage(STORY_IDS.churnDefault);
    const state = await page.evaluate(() => ({
      hasCHIPPY: !!(window as any).__CHIPPY,
      hasInspectReact: !!(window as any).__CHIPPY?.inspectReact,
      hasLayoutLab: !!(window as any).__CHIPPY?.layoutLab,
      integration: (window as any).__CHIPPY?.pageBridge?.getState?.().integration,
    }));
    expect(state).toMatchObject({
      hasCHIPPY: true,
      hasInspectReact: true,
      hasLayoutLab: true,
      integration: {
        kind: 'import',
        who: 'Chippy helper module import',
        source: '.agents/skills/chippy/scripts/chippy-helper-server.js',
        reinjectsOnReload: false,
      },
    });
    expect(state.integration.reloadAction).toContain('again after every full page reload');
    await page.close();
  }, 30000);

  it('G1: serves helper ESM entry that auto-loads Avalanche and supports transport options', async () => {
    const response = await fetch('http://127.0.0.1:7823/__chippy/inject.mjs?ui=none&activated=false&ownerType=storybook-addon&ownerId=sb-1&mode=avalanche');
    expect(response.ok).toBe(true);
    const source = await response.text();
    expect(source).toContain('window.__CHIPPY');
    expect(source).toContain('"activated":false');
    expect(source).toContain('"ui":"none"');
    expect(source).toContain('"ownerType":"storybook-addon"');
    expect(source).toContain('"ownerId":"sb-1"');
    expect(source).toContain('"mode":"avalanche"');
    expect(source).toContain('"kind":"import"');
    expect(source).toContain('"who":"Chippy helper module import"');
    expect(source).toContain('"source":".agents/skills/chippy/scripts/chippy-helper-server.js"');
    expect(source).toContain('"reinjectsOnReload":false');
    expect(source).not.toContain('__chippy-import-reload-notice');
    expect(source).not.toContain('Reload removes this imported Chippy');
    expect(source).toContain('__chippyAcquireOwner');
    expect(source).toContain('owned-by-other-chippy');
    expect(source).toContain("await import(");
    expect(source).toContain('/__chippy/avalanche.es.js');
    expect(source).not.toContain('__installChippyImportUi');
    expect(source).not.toContain('__chippy-import-panel');
    expect(source).toContain('if (__chippyBootConfig.activated)');
    expect(source).toContain('export { __chippyReady as ready };');
    expect(source).toContain('export default globalThis.__CHIPPY;');
  }, 30000);

  it('G1: import.mjs can boot headless for a Storybook panel owner and exposes owner state', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
    await page.goto('http://127.0.0.1:7823/__chippy');
    const state = await page.evaluate(async () => {
      const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
      const mod = await importModule('http://127.0.0.1:7823/__chippy/inject.mjs?ui=none&activated=false&ownerType=storybook-addon&ownerId=sb-panel-test&mode=avalanche');
      const ready = await mod.ready;
      const bridgeState = (window as any).__CHIPPY?.pageBridge?.getState?.();
      return {
        hasDefault: !!mod.default,
        hasReadyChippy: !!ready.chippy,
        hasAvalanche: !!ready.avalanche,
        readyIntegration: ready.integration,
        importPanel: !!document.getElementById('__chippy-import-panel'),
        owner: (window as any).__CHIPPY_OWNER__,
        bridgeOwner: bridgeState?.owner,
        integration: bridgeState?.integration,
        activated: bridgeState?.activated,
        connState: bridgeState?.connState,
      };
    });
    expect(state.hasDefault).toBe(true);
    expect(state.hasReadyChippy).toBe(true);
    // The import transport loads Chippy headlessly for a host panel. Avalanche
    // display can be wired separately; panel boot must not depend on a global
    // __AVALANCHE__ being published by the ES bundle.
    expect(state.importPanel).toBe(false);
    expect(state.owner?.ownerType).toBe('storybook-addon');
    expect(state.owner?.ownerId).toBe('sb-panel-test');
    expect(state.owner?.mode).toBe('avalanche');
    expect(state.bridgeOwner?.ownerId).toBe('sb-panel-test');
    expect(state.integration).toMatchObject({
      kind: 'import',
      who: 'Chippy helper module import',
      source: '.agents/skills/chippy/scripts/chippy-helper-server.js',
      reinjectsOnReload: false,
    });
    expect(state.readyIntegration).toEqual(state.integration);
    expect(state.integration.reloadAction).toContain('again after every full page reload');
    expect(state.activated).toBe(false);
    expect(state.connState).toBeTruthy();
    await page.close();
  }, 30000);


  it('G1: import.mjs blocks a second active owner before booting another runtime', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:7823/__chippy');
    const result = await page.evaluate(async () => {
      const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
      await importModule('http://127.0.0.1:7823/__chippy/inject.mjs?ui=none&activated=false&ownerType=storybook-addon&ownerId=owner-a');
      try {
        await importModule('http://127.0.0.1:7823/__chippy/inject.mjs?ui=none&activated=false&ownerType=storybook-addon&ownerId=owner-b');
        return { blocked: false, owner: (window as any).__CHIPPY_OWNER__, blockedState: (window as any).__CHIPPY_BLOCKED__ || null };
      } catch (error) {
        return {
          blocked: true,
          message: String((error as Error).message || error),
          owner: (window as any).__CHIPPY_OWNER__,
          blockedState: (window as any).__CHIPPY_BLOCKED__ || null,
        };
      }
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('already owned');
    expect(result.owner?.ownerId).toBe('owner-a');
    expect(result.blockedState?.reason).toBe('owned-by-other-chippy');
    expect(result.blockedState?.owner?.ownerId).toBe('owner-a');
    await page.close();
  }, 30000);

  it('G1: Storybook manager exposes the Chippy addon panel', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
    await page.goto(`${STORYBOOK_ORIGIN}/?path=/story/${STORY_IDS.churnDefault}`, { waitUntil: 'load' });
    const tab = page.getByRole('tab', { name: /^Chippy$/ });
    await tab.waitFor({ timeout: 10_000 });
    await tab.click();
    await page.getByRole('button', { name: 'Show probes' }).waitFor({ timeout: 10_000 });
    const chippyPanel = page.getByRole('tabpanel', { name: 'Chippy' });
    expect(await chippyPanel.getByText('P1', { exact: true }).count()).toBe(0);
    const frame = page.frameLocator('#storybook-preview-iframe');
    await expect.poll(
      () => frame.locator('body').evaluate(() => (window as any).__CHIPPY?.pageBridge?.getState?.().integration),
      { timeout: 10_000 },
    ).toMatchObject({
      kind: 'storybook',
      who: 'Chippy Storybook addon',
      source: '.storybook/chippy-addon/setup.js',
      reinjectsOnReload: true,
    });
    expect(await frame.locator('[data-layout-lab-marker="1"]').count()).toBe(0);
    await page.getByRole('button', { name: 'Show probes' }).click();
    await frame.locator('[data-layout-lab-marker="1"]').waitFor({ timeout: 10_000 });
    expect(await frame.locator('[data-layout-lab-dock]').isVisible()).toBe(true);
    const markerPosition = await frame.locator('[data-layout-lab-marker="1"]').evaluate((node) => getComputedStyle(node).position);
    expect(markerPosition).toBe('fixed');
    expect(await page.getByText('active:', { exact: false }).count()).toBe(0);
    expect(await page.getByText('visible:', { exact: false }).count()).toBe(0);
    expect(await page.getByText('markers:', { exact: false }).count()).toBe(0);
    expect(await page.getByText('While dragging:', { exact: false }).count()).toBe(1);

    const marker = frame.locator('[data-layout-lab-marker="1"]');
    await marker.hover();
    await page.mouse.down();
    await frame.getByTestId('churn-lab').hover({ position: { x: 40, y: 40 } });
    expect(await marker.evaluate((node) => node.ownerDocument.activeElement === node)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    expect(await marker.evaluate((node: any) => node.__levelOffset)).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(await marker.evaluate((node: any) => node.__levelOffset)).toBe(0);
    await page.keyboard.press('ArrowUp');
    expect(await marker.evaluate((node: any) => node.__fiberOffset)).toBe(1);
    await page.keyboard.press('ArrowDown');
    expect(await marker.evaluate((node: any) => node.__fiberOffset)).toBe(0);
    await page.mouse.up();

    const annotation = {
      intent: 'change',
      comment: 'Move this card below the summary.',
    };
    await frame.locator('body').evaluate(() => {
      const runtime = window as any;
      runtime.__CHIPPY_PROBE_ANNOTATION_RESULT__ = null;
      runtime.__STORYBOOK_ADDONS_CHANNEL__?.on('local/chippy/result', (result: unknown) => {
        runtime.__CHIPPY_PROBE_ANNOTATION_RESULT__ = result;
      });
    });
    await chippyPanel.getByLabel('P1 comment').fill(annotation.comment);
    await chippyPanel.getByLabel('P1 intent').selectOption(annotation.intent);
    expect(await chippyPanel.getByRole('button', { name: 'Attach to P1' }).count()).toBe(0);
    await expect.poll(
      () => frame.locator('body').evaluate(() => (window as any).__CHIPPY_PROBE_ANNOTATION_RESULT__),
      { timeout: 10_000 },
    ).toMatchObject({
      command: { type: 'set-probe-annotation', markerId: '1', ...annotation },
      result: { ok: true, markerId: '1', annotation: { id: '1', ...annotation } },
    });

    await page.getByRole('tab', { name: /^Avalanche$/ }).click();
    await page.getByRole('heading', { name: 'Commit patterns' }).waitFor({ timeout: 10_000 });
    expect(await page.getByRole('button', { name: 'Hot sources' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Commit list' }).count()).toBe(0);
    expect(await page.getByText('installed:', { exact: false }).count()).toBe(0);
    expect(await page.getByText('mode:', { exact: false }).count()).toBe(0);
    const patternSection = page.getByRole('heading', { name: 'Commit patterns' }).locator('..');
    await expect.poll(
      () => patternSection.locator('tbody tr').count(),
      { timeout: 10_000 },
    ).toBeGreaterThan(0);

    await page.getByRole('tab', { name: /^Chippy$/ }).click();
    await expect.poll(
      () => frame.locator('body').evaluate(() => (window as any).__CHIPPY_OWNER__?.mode),
      { timeout: 10_000 },
    ).toBe('chippy');
    await page.getByRole('button', { name: 'Show probes' }).waitFor({ timeout: 10_000 });
    await page.close();
  }, 60000);

  it('G1: page-reload remounts a Storybook SUT without navigating its preview iframe', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.goto(`${STORYBOOK_ORIGIN}/?path=/story/${STORY_IDS.churnDefault}`, { waitUntil: 'load' });
    const frame = page.frameLocator('#storybook-preview-iframe');
    await expect.poll(
      () => frame.locator('body').evaluate(() => (window as any).__CHIPPY?.pageBridge?.getState?.().integration?.kind),
      { timeout: 10_000 },
    ).toBe('storybook');
    const clientId = await frame.locator('body').evaluate(() => (window as any).__CHIPPY?.pageBridge?.getState?.().clientId);
    expect(clientId).toEqual(expect.any(String));
    await expect.poll(
      async () => (await getPages()).pages.some((connected) => connected.clientId === clientId && connected.integration?.kind === 'storybook'),
      { timeout: 10_000 },
    ).toBe(true);
    const before = await frame.locator('body').evaluate(() => ({
      href: location.href,
      navigationCount: performance.getEntriesByType('navigation').length,
      channelAvailable: !!(window as any).__STORYBOOK_ADDONS_CHANNEL__?.on,
    }));
    expect(before.channelAvailable).toBe(true);

    const result = await cliJson(['page-reload', clientId]);
    expect(result).toMatchObject({
      ok: true,
      result: { ok: true, ack: true, action: 'storybook-force-remount' },
    });
    const waitResult = await cliJson(['page-wait-reload', clientId]);
    expect(waitResult).toMatchObject({ ok: true, reloaded: true, remounted: true, action: 'storybook-force-remount' });

    await expect.poll(
      () => frame.locator('[data-testid="churn-lab"]').count(),
      { timeout: 10_000 },
    ).toBe(1);
    const after = await frame.locator('body').evaluate(() => ({
      href: location.href,
      navigationCount: performance.getEntriesByType('navigation').length,
    }));
    expect(after).toEqual({ href: before.href, navigationCount: before.navigationCount });
    await page.close();
  }, 30000);

  it('G1: Storybook manager offers the Chippy install command when its local helper is unreachable', async () => {
    if (!browser) throw new Error('browser not started');
    const page = await browser.newPage();
    await page.routeWebSocket(/\/__chippy\/ws$/, async (webSocket) => {
      await webSocket.close({ code: 1013, reason: 'helper unavailable in fallback test' });
    });
    await page.goto(`${STORYBOOK_ORIGIN}/?path=/story/${STORY_IDS.churnDefault}`, { waitUntil: 'load' });

    await page.getByRole('tab', { name: /^Chippy$/ }).click();
    const chippyHint = page.getByRole('tabpanel', { name: 'Chippy' }).getByTestId('chippy-install-hint');
    await chippyHint.waitFor({ timeout: 10_000 });
    expect((await chippyHint.locator('code').textContent())?.trim()).toBe(
      'npx @atlassian/chippy install',
    );

    await page.getByRole('tab', { name: /^Avalanche$/ }).click();
    const avalancheHint = page.getByRole('tabpanel', { name: 'Avalanche' }).getByTestId('chippy-install-hint');
    await avalancheHint.waitFor({ timeout: 10_000 });
    expect((await avalancheHint.locator('code').textContent())?.trim()).toBe(
      'npx @atlassian/chippy install',
    );
    await page.close();
  }, 30000);

  it('G1/G2: loads shipped avalanche adapter and connects helper-side page', async () => {
    const page = await openInjectedPage(STORY_IDS.churnDefault);
    await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
    const state = await page.evaluate(() => ({
      hasAvalanche: !!(window as any).__AVALANCHE__,
      hasInstall: typeof (window as any).__AVALANCHE__?.install === 'function',
      hasStatus: typeof (window as any).__AVALANCHE__?.status === 'function',
    }));
    expect(state).toEqual({ hasAvalanche: true, hasInstall: true, hasStatus: true });
    const connected = await waitForConnectedPage(STORY_IDS.churnDefault);
    expect(connected.clientId).toBeTruthy();
    expect(connected.integration).toMatchObject({
      kind: 'import',
      who: 'Chippy helper module import',
      reinjectsOnReload: false,
    });
    await page.close();
  }, 30000);

  it('A1/A5/E2/E3/F2: DebugHookLab story renders the expected debug-render fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.debugHookLab);
    const root = page.locator('[data-testid="debug-hook-lab"]');
    expect(await root.count()).toBe(1);
    const text = await root.textContent();
    expect(text).toContain('Debug hook lab');
    expect(text).toContain('approvals');
    await page.close();
  }, 30000);

  it('B1/B4: UnstableProvider story renders provider-driven churn fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.unstableProvider);
    const root = page.locator('[data-testid="unstable-provider-lab"]');
    const list = page.locator('[data-testid="unstable-list"]');
    expect(await root.count()).toBe(1);
    expect(await root.textContent()).toContain('Unstable provider reference');
    expect(await list.textContent()).toContain('unstable consumer #0');
    await page.close();
  }, 30000);

  it('B2/F3: EffectAvalanche story renders effect-driven avalanche fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.effectAvalanche);
    const root = page.locator('[data-testid="effect-avalanche-lab"]');
    const list = page.locator('[data-testid="effect-list"]');
    expect(await root.count()).toBe(1);
    expect(await root.textContent()).toContain('Effect-driven context update');
    expect(await list.textContent()).toContain('effect consumer #0');
    await page.close();
  }, 30000);

  it('B3: MixedStability story renders mixed-stability context fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.mixedStability);
    const root = page.locator('[data-testid="mixed-stability-lab"]');
    expect(await root.count()).toBe(1);
    const text = await root.textContent();
    expect(text).toContain('Mixed-stability context');
    expect(text).toContain('stable reader #0');
    await page.close();
  }, 30000);

  it('C1: StabilityChain story renders broken cascade fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.stabilityChain);
    const text = await page.textContent('body');
    expect(text).toContain('StabilityChain — broken memo → callback → effect chain');
    await page.close();
  }, 30000);

  it('C2: StabilityChainFixed story renders fixed cascade fixture', async () => {
    const page = await openInjectedPage(STORY_IDS.stabilityChainFixed);
    const text = await page.textContent('body');
    expect(text).toContain('StabilityChain (fixed) — clean memo → callback → effect chain');
    await page.close();
  }, 30000);

  it('finds StoreReader fibers and describes the component with shim preload', async () => {
    const page = await openInjectedPage(STORY_IDS.debugHookLab);
    const connected = await waitForConnectedPage(STORY_IDS.debugHookLab);
    const fibers = await cliJson(['find-fibers', connected.clientId, '--name', 'StoreReader', '--max', '5']);
    expect(fibers.ok).toBe(true);
    expect(fibers.result?.count ?? 0).toBeGreaterThan(0);

    const fiberId = fibers.result.items[0].fiberId;
    const description = await cliJson(['describe-component', connected.clientId, fiberId, '--json']);
    expect(description.ok).toBe(true);
    expect(description.result?.ok).toBe(true);
    expect(String(description.result?.componentName || '')).toContain('StoreReader');
    await page.close();
  }, 30000);

  it('captures and structurally compares fiber props across an interaction and a different page', async () => {
    const firstPage = await openInjectedPage(STORY_IDS.debugHookLab);
    const firstConnected = await waitForConnectedPage(STORY_IDS.debugHookLab);
    const before = await cliJson(['fiber-state-capture', firstConnected.clientId, 'before click']);
    expect(before).toMatchObject({ ok: true, capture: { label: 'before click', truncated: false } });

    const value = firstPage.getByTestId('debug-hook-value');
    const beforeText = (await value.textContent()) || '';
    const beforeCount = Number(beforeText.match(/^(\d+) approvals$/)?.[1]);
    await firstPage.getByRole('button', { name: 'Bump approvals local state' }).click();
    await expect.poll(() => value.textContent()).toBe(`${beforeCount + 1} approvals`);

    const after = await cliJson(['fiber-state-capture', firstConnected.clientId, 'after click']);
    const interactionDiff = await cliJson([
      'fiber-state-compare',
      before.capture.captureId,
      after.capture.captureId,
      '50',
    ]);
    expect(interactionDiff.ok).toBe(true);
    expect(interactionDiff.diff?.summary?.propChanges ?? 0).toBeGreaterThan(0);
    expect(interactionDiff.diff?.summary?.captureTruncated).toBe(false);
    expect(interactionDiff.diff?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'props-changed',
        fiber: expect.objectContaining({
          after: expect.objectContaining({ name: 'p', source: expect.objectContaining({ lineNumber: 103 }) }),
        }),
        props: expect.objectContaining({ changed: expect.arrayContaining([expect.objectContaining({ name: 'children' })]) }),
      }),
    ]));

    const secondPage = await openInjectedPage(STORY_IDS.stabilityChainFixed);
    const secondConnected = await waitForConnectedPage(STORY_IDS.stabilityChainFixed);
    const otherPage = await cliJson(['fiber-state-capture', secondConnected.clientId, 'other page']);
    const crossPageDiff = await cliJson([
      'fiber-state-compare',
      after.capture.captureId,
      otherPage.capture.captureId,
      '25',
    ]);
    expect(crossPageDiff.ok).toBe(true);
    expect(crossPageDiff.diff.before.url).toContain(`id=${STORY_IDS.debugHookLab}`);
    expect(crossPageDiff.diff.after.url).toContain(`id=${STORY_IDS.stabilityChainFixed}`);
    expect(
      (crossPageDiff.diff.summary.addedFibers || 0) + (crossPageDiff.diff.summary.removedFibers || 0),
    ).toBeGreaterThan(0);

    const captures = await cliJson(['fiber-state-list']);
    expect(captures.count).toBeGreaterThanOrEqual(3);
    expect(captures.captures).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'before click' }),
      expect.objectContaining({ label: 'after click' }),
      expect.objectContaining({ label: 'other page' }),
    ]));
    await secondPage.close();
    await firstPage.close();
  }, 45000);

  it('captures debug-render hook details for a StoreReader-targeted store tick', async () => {
    const page = await openInjectedPage(STORY_IDS.debugHookLab);
    const connected = await waitForConnectedPage(STORY_IDS.debugHookLab);
    await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });

    const install = await cliJson(['avalanche-install', connected.clientId]);
    expect(install.ok).toBe(true);

    const button = page.getByRole('button', { name: 'Tick approvals store' });
    expect(await button.count()).toBe(1);
    await button.click();
    await page.waitForTimeout(300);

    const hotSources = await cliJson(['avalanche-hot-sources', connected.clientId, '10']);
    expect(hotSources.ok).toBe(true);
    const sourceItems = hotSources.result?.payload?.items || [];
    expect(sourceItems.length).toBeGreaterThan(0);

    const storeReaderFiberSearch = await cliJson(['find-fibers', connected.clientId, '--name', 'StoreReader', '--max', '5']);
    expect(storeReaderFiberSearch.ok).toBe(true);
    expect(storeReaderFiberSearch.result?.count ?? 0).toBeGreaterThan(0);

    const debugHook = await cliJson(['avalanche-debug-hook', connected.clientId, sourceItems[0].sourceId, '0', '2']);
    expect(debugHook.ok).toBe(true);
    expect(debugHook.result?.ok).toBe(true);
    expect(debugHook.result?.payload?.ok).toBe(true);
    expect(String(debugHook.result?.payload?.requestedSourceId || '')).toBe(String(sourceItems[0].sourceId));
    expect(String(debugHook.result?.payload?.primitive || '')).not.toBe('');
    await page.close();
  }, 45000);

  it('inspects a function prop contract before invoking it through Chippy', async () => {
    const page = await openInjectedPage(STORY_IDS.debugHookLab);
    const connected = await waitForConnectedPage(STORY_IDS.debugHookLab);

    const beforeText = (await page.getByTestId('debug-hook-value').textContent()) || '';
    const before = Number(beforeText.match(/^(\d+) approvals$/)?.[1]);
    expect(Number.isFinite(before)).toBe(true);

    const buttonFibers = await cliJson([
      'find-fibers',
      connected.clientId,
      '--text',
      'Bump approvals local state',
      '--prop',
      'onClick',
      '--max',
      '10',
    ]);
    expect(buttonFibers.ok).toBe(true);
    expect(buttonFibers.result?.items?.length ?? 0).toBeGreaterThan(0);
    const buttonFiber = buttonFibers.result.items[0];
    expect(buttonFiber?.fiberId).toBeTruthy();

    const contractResponse = await cliJson(['fiber-prop-contract', connected.clientId, String(buttonFiber.fiberId), 'onClick']);
    const contract = contractResponse.result || contractResponse.payload || contractResponse;
    expect(contractResponse.ok).toBe(true);
    expect(contract.isFunction).toBe(true);
    expect(contract.propType).toBe('function');
    expect(contract.fnLength).toBe(0);
    expect(String(contract.nextStep || '')).toContain('before fiber-invoke');

    const invokeResponse = await cliJson(['fiber-invoke', connected.clientId, String(buttonFiber.fiberId), 'onClick', '--args', '[]']);
    const invoke = invokeResponse.result || invokeResponse;
    expect(invokeResponse.ok).toBe(true);
    expect(invoke.invoked).toBe(true);
    expect(invoke.fnLength).toBe(0);

    await page.waitForFunction(
      (expected) => document.querySelector('[data-testid="debug-hook-value"]')?.textContent === expected,
      `${before + 1} approvals`
    );
    await page.close();
  }, 30000);
});
