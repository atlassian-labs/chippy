import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
let server: Server;
let browser: Browser;
let url: string;

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-chippy-library.mjs']);
  directory = mkdtempSync(join(tmpdir(), 'chippy-library-consumer-'));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--cache', join(directory, 'npm-cache'), '--pack-destination', directory], {
    cwd: resolve('packages/chippy'), encoding: 'utf8',
  }));
  writeFileSync(join(directory, 'package.json'), '{"type":"module","private":true}');
  execFileSync('npm', ['install', '--cache', join(directory, 'npm-cache'), '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', join(directory, packed[0].filename)], { cwd: directory });
  writeFileSync(join(directory, 'consumer.mts'), `
import { createAvalancheDetector, type DetectorOptions, type Report } from '@atlassian/chippy/avalanche';
import { connectChippy, type BrowserConnection } from '@atlassian/chippy/browser';
import '@atlassian/chippy/bootstrap';
const options: DetectorOptions = { detectionMode: 'full', historySize: 5 };
const detector = createAvalancheDetector(options);
const report: Report = detector.report();
const connection: Promise<BrowserConnection> = connectChippy();
void report; void connection;
`);
  execFileSync(resolve('node_modules/.bin/tsc'), ['consumer.mts', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext'], { cwd: directory, stdio: 'pipe' });
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createAvalancheDetector, DETECTION_LEVEL } from '@atlassian/chippy/avalanche';
    assert.equal(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__, undefined);
    assert.equal(globalThis.__CHIPPY, undefined);
    assert.equal(globalThis.__AVALANCHE__, undefined);
    assert.equal(globalThis.__ATL_REACT_METRICS, undefined);
    assert.equal(typeof createAvalancheDetector, 'function');
    assert.equal(typeof DETECTION_LEVEL, 'object');
  `], { cwd: directory });
  const preset = await import(join(directory, 'node_modules/@atlassian/chippy/dist/storybook/preset.js'));
  for (const path of [...preset.managerEntries(), ...preset.previewAnnotations()]) expect(readFileSync(path, 'utf8')).toBeTruthy();
  // Supply the consuming application's peers and Storybook framework separately.
  for (const dependency of ['react', 'react-dom', 'storybook', '@storybook']) {
    symlinkSync(resolve('node_modules', dependency), join(directory, 'node_modules', dependency));
  }
  writeFileSync(join(directory, 'main.cjs'), `module.exports = {
    core: { disableTelemetry: true },
    stories: [${JSON.stringify(resolve('src/**/*.stories.@(js|jsx|mjs|ts|tsx)'))}],
    addons: [${JSON.stringify(join(directory, 'node_modules/@atlassian/chippy/dist/storybook/preset.js'))}],
    framework: { name: '@storybook/react-vite', options: {} },
    viteFinal(config) { config.root = ${JSON.stringify(directory)}; config.build = { ...config.build, target: 'es2022' }; return config; }
  };`);
  execFileSync(resolve('node_modules/.bin/storybook'), ['build', '--config-dir', directory, '--output-dir', join(directory, 'storybook-out')], {
    cwd: directory, env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' }, stdio: 'inherit',
  });
  const result = await build({
    stdin: { resolveDir: directory, contents: `
import '@atlassian/chippy/bootstrap';
import { createAvalancheDetector } from '@atlassian/chippy/avalanche';
import { connectChippy } from '@atlassian/chippy/browser';
window.libraryLoaded = { chippy: !!window.__CHIPPY, avalanche: !!window.__AVALANCHE__, metrics: !!window.__ATL_REACT_METRICS };
window.connectChippy = connectChippy;
const detector = createAvalancheDetector({ detectionMode: 'sources', captureFibers: false, historySize: 5 });
window.detector = detector;
detector.install();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
function Counter() {
  const [count, setCount] = React.useState(0);
  return React.createElement('button', { id: 'counter', onClick: () => setCount(count + 1) }, String(count));
}
createRoot(document.getElementById('root')).render(React.createElement(Counter));
` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    nodePaths: [resolve('node_modules')], define: { 'process.env.NODE_ENV': '"development"' },
  });
  const script = result.outputFiles[0].text;
  server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
    else if (request.url === '/__chippy/inject.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('export const ready = Promise.resolve({chippy:{}, avalanche:{}, connState:"connected", integration:{kind:"test"}, activated:true, probesActive:true});');
    } else response.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it('captures real stock React commits through the installed npm package and cleans up', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.locator('#counter').waitFor();
    expect(await page.evaluate(() => (window as any).libraryLoaded)).toEqual({ chippy: false, avalanche: false, metrics: false });
    await page.locator('#counter').click();
    await expect.poll(() => page.locator('#counter').textContent()).toBe('1');
    const report = await page.evaluate(() => (window as any).detector.report());
    expect(report.meta.commits).toBe(2);
    await page.evaluate(() => { (window as any).detector.reset(); (window as any).detector.uninstall(); });
    await page.locator('#counter').click();
    expect(await page.evaluate(() => (window as any).detector.report().meta.commits)).toBe(0);
  } finally { await page.close(); }
});

it('connects through the browser export and rejects unsupported helper protocols', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.locator('#counter').waitFor();
    expect(await page.evaluate(base => (window as any).connectChippy(base), url)).toMatchObject({ connState: 'connected', activated: true, probesActive: true });
    const message = await page.evaluate(async () => {
      try { await (window as any).connectChippy('file:///tmp/helper'); } catch (error) { return String(error); }
    });
    expect(message).toContain('HTTP or HTTPS');
  } finally { await page.close(); }
});

it('runs the packed MCP executable against a real connected React page', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { createServer } = await import('node:net');
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as any).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const client = new Client({ name: 'packed-browser-test', version: '1' });
  let helperPid: number | null = null;
  const page = await browser.newPage();
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(directory, 'node_modules/@atlassian/chippy/dist/mcp-skill/scripts/chippy-mcp.cjs')],
      env: { CHIPPY_HELPER_PORT: String(port) }, stderr: 'pipe' }));
    const status = await client.callTool({ name: 'chippy_status', arguments: {} });
    helperPid = (status.structuredContent as any).startedPid;
    expect(helperPid).toBeTypeOf('number');
    await page.goto(url);
    await page.locator('#counter').waitFor();
    const base = `http://127.0.0.1:${port}/__chippy`;
    await page.evaluate(`import(${JSON.stringify(`${base}/inject.mjs`)}).then(() => true)`);
    let clientId = '';
    await expect.poll(async () => {
      const result = await client.callTool({ name: 'chippy_pages', arguments: {} });
      clientId = (result.structuredContent as any).pages.find((item: any) => item.page?.url === `${url}/` || item.url === `${url}/`)?.clientId || '';
      return clientId;
    }).not.toBe('');
    const found = await client.callTool({ name: 'chippy_find_fibers', arguments: { clientId, filters: { name: 'Counter', max: 5 } } });
    expect(found.isError).toBe(false);
    expect(JSON.stringify(found.structuredContent)).toContain('Counter');
    const clicked = await client.callTool({ name: 'chippy_interact', arguments: { clientId, action: 'click', target: '#counter' } });
    expect(clicked.isError, JSON.stringify(clicked)).toBe(false);
    await expect.poll(() => page.locator('#counter').textContent()).toBe('1');
  } finally {
    await page.close();
    await client.close();
    if (helperPid) { try { process.kill(helperPid); } catch {} }
  }
}, 20000);
