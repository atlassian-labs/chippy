// Measures Chippy's own cost on the StressLab story (about 7,000 component
// fibers per full re-render): the commit hook on the page, the export, the
// transfer from page to helper, and from helper to agent.
//
// Needs Storybook on 127.0.0.1:6007 and the helper on 127.0.0.1:7823.
//   OPENSSL_CONF=/dev/null node bench/avalanche-stress.mjs [renders=15]
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const RENDERS = Number(process.argv[2] || 15);
const STORY = 'http://127.0.0.1:6007/iframe.html?id=avalanche-stresslab--default&viewMode=story';
const HELPER = 'http://127.0.0.1:7823/__chippy';
const CLI = '.agents/skills/chippy/scripts/chippy.sh';
const SHIM = readFileSync('.agents/skills/chippy/extension/devtools-hook-shim.js', 'utf8');

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, p50: +at(0.5).toFixed(1), p90: +at(0.9).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

async function cli(...args) {
  const t = performance.now();
  const { stdout } = await run('bash', [CLI, ...args], { maxBuffer: 1 << 30 });
  return { ms: Math.round(performance.now() - t), stdout };
}

// Time one click two ways. `commit`: to a macrotask after the click, which
// runs after React's synchronous render and commit (and Avalanche's hook when
// installed). `frame`: to a macrotask after the next frame, which includes
// style and layout. Avalanche reads layout inside the commit hook, moving
// work the browser would do before paint anyway; only `frame` compares that
// fairly with React alone.
async function clickTimes(page, selector, count) {
  return page.evaluate(async ({ selector, count }) => {
    const macrotask = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = r; ch.port2.postMessage(0); });
    const commit = [];
    const frame = [];
    for (let i = 0; i < count; i++) {
      const button = document.querySelector(selector);
      const t = performance.now();
      button.click();
      const framed = new Promise((r) => requestAnimationFrame(() => macrotask().then(r)));
      await macrotask();
      commit.push(performance.now() - t);
      await framed;
      frame.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 30));
    }
    return { commit, frame };
  }, { selector, count });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript({ content: SHIM });
await page.goto(STORY, { waitUntil: 'load' });
await page.waitForSelector('[data-stress-card]', { timeout: 60000 });
const fibers = await page.evaluate(() => document.querySelectorAll('[data-stress-card]').length);

// The lab's Storybook addon connects Chippy to the helper; install the
// detector as an agent would.
let clientId = null;
for (let i = 0; i < 50 && !clientId; i++) {
  const pages = JSON.parse((await cli('pages')).stdout).pages || [];
  clientId = pages.find((p) => String(p.page?.url).includes('avalanche-stresslab') && p.connected !== false)?.clientId || null;
  if (!clientId) await new Promise((r) => setTimeout(r, 200));
}
if (!clientId) throw new Error('StressLab page did not connect to the helper');
// Baseline: React alone. The lab's addon starts Avalanche on load; stop it in
// this headless page only, then install it again as an agent would.
const installedAtStart = await page.evaluate(() => {
  const api = window.__AVALANCHE__;
  const installed = !!api?.status?.().installed;
  if (installed) api.uninstall();
  return installed;
});
await clickTimes(page, '[data-stress-rerender]', 3);
const baselineRaw = await clickTimes(page, '[data-stress-rerender]', RENDERS);
const baseline = { commit: stats(baselineRaw.commit), frame: stats(baselineRaw.frame) };
await cli('avalanche-install', clientId, 'sources');

await clickTimes(page, '[data-stress-rerender]', 2);
let profileTop = null;
if (process.env.PROFILE) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await clickTimes(page, '[data-stress-rerender]', 5);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parentOf = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parentOf.set(c, n);
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of counts) {
    const frame = (node) => `${node.callFrame.functionName || '(anon)'} ${node.callFrame.url.split('/').pop().split('?')[0]}:${node.callFrame.lineNumber + 1}`;
    const node = byId.get(id);
    // Native frames (no url) are named with their caller, so the cost has an owner.
    const parent = !node.callFrame.url && parentOf.get(id);
    const key = parent ? `${frame(node)} <- ${frame(parent)}` : frame(node);
    self.set(key, (self.get(key) || 0) + us / 1000);
  }
  profileTop = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => `${ms.toFixed(1).padStart(7)} ms  ${k}`);
}
const withRaw = await clickTimes(page, '[data-stress-rerender]', RENDERS);
const withAvalanche = { commit: stats(withRaw.commit), frame: stats(withRaw.frame) };
await clickTimes(page, '[data-stress-toggle]', 2);

const capture = await page.evaluate(async () => {
  const api = window.__AVALANCHE__;
  const t0 = performance.now();
  // As the bridge's `export` does: report(all sources), then toSerializable().
  const raw = api.report(Number.MAX_SAFE_INTEGER);
  const report = typeof raw.toSerializable === 'function' ? raw.toSerializable() : raw;
  const t1 = performance.now();
  const text = JSON.stringify(report);
  const t2 = performance.now();
  const overhead = Object.values(report.commitTimings).map((c) => c.detectorOverhead);
  return {
    commits: Object.keys(report.commitStats).length,
    exportMs: Math.round(t1 - t0),
    stringifyMs: Math.round(t2 - t1),
    mb: +(text.length / 1e6).toFixed(1),
    renderedMb: +(JSON.stringify(report.renderedByCommit).length / 1e6).toFixed(1),
    overhead,
    screenMs: Object.values(report.screenByCommit || {}).map((c) => c.ms),
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
});

const dir = mkdtempSync(join(tmpdir(), 'chippy-bench-'));
const exportCall = await cli('avalanche-export', clientId);
const saveFile = join(dir, 'save.json');
const saveCall = await cli('avalanche-save', clientId, saveFile);
const listCall = await cli('avalanche-commit-list', clientId, '10');
const timelineCall = await cli('avalanche-timeline', clientId);

await browser.close();

if (profileTop) console.log(profileTop.join('\n'));
console.log(JSON.stringify({
  fibersPerCard: 'about 12', cards: fibers, renders: RENDERS,
  clickMs: { installedAtStart, reactOnly: baseline, withAvalanche },
  detectorOverheadMs: stats(capture.overhead),
  // Part of the detector overhead: measuring changed boxes, which forces layout early.
  screenMeasureMs: capture.screenMs.length ? stats(capture.screenMs) : null,
  page: { commits: capture.commits, exportMs: capture.exportMs, stringifyMs: capture.stringifyMs, exportMb: capture.mb, renderedByCommitMb: capture.renderedMb, heapMb: capture.heapMb },
  helperToAgent: {
    exportMs: exportCall.ms, exportBytesMb: +(exportCall.stdout.length / 1e6).toFixed(1),
    saveMs: saveCall.ms, savedMb: +(statSync(saveFile).size / 1e6).toFixed(1),
    commitListMs: listCall.ms, timelineMs: timelineCall.ms,
  },
}, null, 2));
