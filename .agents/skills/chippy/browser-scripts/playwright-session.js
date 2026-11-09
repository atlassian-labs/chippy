const fs = require('node:fs');
const path = require('node:path');

const PLAYWRIGHT_UNAVAILABLE_CODE = 'CHIPPY_PLAYWRIGHT_UNAVAILABLE';
let playwrightLoadResult = null;

function isMissingPlaywrightError(error) {
  return error && error.code === 'MODULE_NOT_FOUND' && /(?:^|')playwright(?:'|$)/.test(String(error.message || ''));
}

function createPlaywrightUnavailableError(cause) {
  /** @type {Error & { code?: string }} */
  const error = new Error('Playwright is not installed. Chippy helper is running, but Playwright-only automation is unavailable. Install the playwright package to use this command.');
  error.code = PLAYWRIGHT_UNAVAILABLE_CODE;
  error.cause = cause;
  return error;
}

function loadPlaywright() {
  if (playwrightLoadResult) return playwrightLoadResult;
  try {
    playwrightLoadResult = { ok: true, module: require('playwright') };
  } catch (error) {
    if (!isMissingPlaywrightError(error)) throw error;
    playwrightLoadResult = { ok: false, error: createPlaywrightUnavailableError(error) };
  }
  return playwrightLoadResult;
}

function getPlaywrightAvailability() {
  const result = loadPlaywright();
  return result.ok
    ? { ok: true }
    : { ok: false, code: PLAYWRIGHT_UNAVAILABLE_CODE, error: result.error.message };
}

const SKILL_ROOT = path.resolve(__dirname, '..');
const HELPER_SCRIPTS = [
  // MUST be first. Installs an empty React DevTools hook shim BEFORE any page
  // script (including react-dom) evaluates. react-dom registers its renderer
  // into hook.renderers at evaluation time; without the shim being present
  // first, hook.renderers stays empty and debug-render cannot find the
  // ReactCurrentDispatcher ref it needs to capture hook call stacks. Result
  // would be debugHook() collapsing to a flat fallback (no custom-hook
  // folders, no callerLoc).
  'extension/devtools-hook-shim.js',
  'extension/inspect-react.js',
  'extension/layout-lab.js',
  'extension/resolve-probes.js',
  'extension/probe-descriptor.js',
  'extension/avalanche.iife.js',
  'extension/frame-link.js',
  'extension/chippy-page-bridge.js',
];

function readScript(relativePath) {
  const scriptPath = path.join(SKILL_ROOT, relativePath);
  return fs.readFileSync(scriptPath, 'utf8');
}

async function injectScript(page, relativePath) {
  await page.addScriptTag({ content: readScript(relativePath) });
}

async function addInitScript(page, relativePath) {
  await page.addInitScript({ content: readScript(relativePath) });
}

async function installHelpers(page, options = {}) {
  const installer = options.init ? addInitScript : injectScript;
  for (const script of HELPER_SCRIPTS) {
    await installer(page, script);
  }
}

async function resolveDescriptor(page, descriptor) {
  return page.evaluate((value) => globalThis.__CHIPPY.resolveProbeDescriptor(value), descriptor);
}

async function captureDescriptor(page, selector) {
  return page.evaluate((value) => {
    const node = document.querySelector(value);
    return globalThis.__CHIPPY.captureProbeDescriptor(node);
  }, selector);
}

/**
 * @param {{ browserName?: string, url?: string, descriptor?: unknown, headless?: boolean }} [options]
 */
async function launchSession({ browserName = 'chromium', url, descriptor, headless = true } = {}) {
  const playwright = loadPlaywright();
  if (!playwright.ok) throw playwright.error;
  const { chromium, webkit } = playwright.module;
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const browser = await browserType.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await installHelpers(page, { init: true });
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  const resolution = descriptor ? await resolveDescriptor(page, descriptor) : null;
  return { browser, context, page, resolution };
}

module.exports = {
  PLAYWRIGHT_UNAVAILABLE_CODE,
  HELPER_SCRIPTS,
  readScript,
  injectScript,
  addInitScript,
  installHelpers,
  captureDescriptor,
  resolveDescriptor,
  getPlaywrightAvailability,
  launchSession,
};
