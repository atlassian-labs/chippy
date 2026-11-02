import { STORYBOOK_ORIGIN, STORYBOOK_PORT, assertChippyLabIdentity } from '../test/chippy-lab-target';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const STORY_URL = `${STORYBOOK_ORIGIN}/iframe.html?id=avalanche-churnlab--default&viewMode=story`;
const HELPER_URL = 'http://127.0.0.1:7823/__chippy/health';
const STORYBOOK_URL = `${STORYBOOK_ORIGIN}/`;
const CHIPPY_CLI = '.agents/skills/chippy/scripts/chippy.sh';

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

import { readFileSync } from 'node:fs';
const DEVTOOLS_HOOK_SHIM = readFileSync('.agents/skills/chippy/extension/devtools-hook-shim.js', 'utf8');

async function openInjectedPage(): Promise<Page> {
  if (!browser) throw new Error('browser not started');
  const page = await browser.newPage();
  await page.addInitScript({ content: DEVTOOLS_HOOK_SHIM });
  await page.goto(STORY_URL, { waitUntil: 'load' });
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/inject.js' });
  // The bridge command surface (find-fibers, describe-component, evalAvalanche,
  // safeJson, etc.) lives in the avalanche.iife.js bundle — see
  // src/chippy-bridge/*. The browser-extension path injects it via
  // chrome.scripting.MAIN; in Playwright we inject it explicitly here so the
  // bridge shims in chippy-page-bridge.js can resolve __AVALANCHE__.bridge.*.
  await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
  await page.waitForTimeout(1000);
  return page;
}

async function getPages() {
  const { stdout } = await execFileAsync(CHIPPY_CLI, ['pages']);
  return JSON.parse(stdout) as { pages: Array<{ clientId: string; page: { url: string } }> };
}

async function waitForConnectedPage(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await getPages();
    const match = state.pages.find((page) => page.page.url.includes('iframe.html?id=avalanche-churnlab--default'));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for connected Chippy page');
}

async function cliJson(args: string[]) {
  const { stdout } = await execFileAsync(CHIPPY_CLI, args);
  return JSON.parse(stdout);
}

describe('Chippy headless Playwright smoke', () => {
  it('injects Chippy into the Storybook story', async () => {
    const page = await openInjectedPage();
    const state = await page.evaluate(() => ({
      hasCHIPPY: !!(window as any).__CHIPPY,
      hasInspectReact: !!(window as any).__CHIPPY?.inspectReact,
      hasLayoutLab: !!(window as any).__CHIPPY?.layoutLab,
    }));
    expect(state).toEqual({
      hasCHIPPY: true,
      hasInspectReact: true,
      hasLayoutLab: true,
    });
    await page.close();
  }, 30000);

  it('loads the shipped avalanche adapter and exposes __AVALANCHE__', async () => {
    const page = await openInjectedPage();
    await page.addScriptTag({ url: 'http://127.0.0.1:7823/__chippy/avalanche.iife.js' });
    const state = await page.evaluate(() => ({
      hasAvalanche: !!(window as any).__AVALANCHE__,
      hasInstall: typeof (window as any).__AVALANCHE__?.install === 'function',
      hasStatus: typeof (window as any).__AVALANCHE__?.status === 'function',
    }));
    expect(state).toEqual({
      hasAvalanche: true,
      hasInstall: true,
      hasStatus: true,
    });
    await page.close();
  }, 30000);

  it('appears on the helper side as a connected page after injection', async () => {
    const page = await openInjectedPage();
    const connected = await waitForConnectedPage();
    expect(connected.page.url).toContain('iframe.html?id=avalanche-churnlab--default');
    expect(connected.clientId).toBeTruthy();
    await page.close();
  }, 30000);

  it('describe-component works on the connected StoreReader story', async () => {
    const page = await openInjectedPage();
    const connected = await waitForConnectedPage();
    const fibers = await cliJson(['find-fibers', connected.clientId, '--name', 'StoreReader', '--max', '5']);
    console.log('find-fibers payload', JSON.stringify(fibers));
    expect(Array.isArray(fibers.result?.items)).toBe(true);
    expect(fibers.result?.items?.length).toBeGreaterThan(0);

    const fiberId = fibers.result.items[0].fiberId;
    const description = await cliJson(['describe-component', connected.clientId, String(fiberId), '--json']);
    expect(description.ok).toBe(true);
    expect(description.result?.componentName || description.result?.name).toBeTruthy();
    await page.close();
  }, 30000);
});
