// This suite serves stock React directly, without helper or Storybook.
// Host-provided ATL callback compatibility is covered by detector unit tests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { startReactCompatibilityFixture } from './test/react-compatibility-fixture';

const extension = '.agents/skills/chippy/extension';
let fixture: Awaited<ReturnType<typeof startReactCompatibilityFixture>>;
let browser: Browser;

beforeAll(async () => {
  fixture = await startReactCompatibilityFixture();
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  await browser?.close();
  await fixture?.stop();
});

async function openPage(kind = 'stock'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  // Preload hook + Avalanche before navigation; debugHook checks real captured hooks.
  await page.addInitScript({ content: readFileSync(`${extension}/devtools-hook-shim.js`, 'utf8') });
  await page.addInitScript({ content: readFileSync(`${extension}/avalanche.iife.js`, 'utf8') });
  await page.goto(`${fixture.url}/${kind}`);
  await page.locator('#counter').waitFor();
  return page;
}

describe('Chippy React compatibility', () => {
  it.each(['stock'])('captures each %s React commit once and debugs a captured hook', async (kind) => {
    const page = await openPage(kind);
    try {
      for (let n = 0; n < 3; n++) {
        await page.locator('#counter').click();
        await expect.poll(() => page.locator('#counter').textContent()).toBe(`Count: ${n + 1}`);
      }
      const result = await page.evaluate(() => {
        const av = (window as any).__AVALANCHE__;
        const report = av.report(100, 'effect');
        const source = report.sources.find((item: any) => item.sourceId.startsWith('StockCounter#'));
        return {
          status: av.status(), commits: report.meta.commits,
          atlCommits: (window as any).__ATL_REACT_METRICS.totalCommitCount,
          source: source || null,
          hook: source ? av.debugHook(source.sourceId, 0) : null,
        };
      });
      expect(result.status.integrationMode).toBe('devtools');
      expect(result.commits).toBe(4);
      expect(result.atlCommits).toBe(0);
      expect(result.source).not.toBeNull();
      expect(result.hook).toMatchObject({ ok: true, primitive: 'State' });
    } finally { await page.close(); }
  }, 30000);

  it.each(['stock'])('resolves source, owners, hooks, and scheduling on %s React', async (kind) => {
    const page = await openPage(kind);
    try {
      const before = await page.evaluate(() => (window as any).renderCount);
      const inspection = await page.evaluate(() => {
        const av = (window as any).__AVALANCHE__;
        const layout = av.layoutLab;
        const target = document.querySelector('#counter');
        const fiber = layout.getNearestComponent(target);
        const component = layout.describeComponent(fiber);
        const replay = av.replay.replayComponentHooks(fiber);
        const schedule = av.bridge.evalFiberScheduleUpdate('fixture-counter', 0, {
          normalizeRememberedFiberId: (id: unknown) => String(id),
          getRememberedFiber: () => fiber,
        });
        return { component: { ...component, props: { prefix: component.props.prefix } },
          replay: { status: replay.replayStatus, records: replay.records }, schedule };
      });
      expect(inspection.component).toMatchObject({
        name: 'StockCounter', props: { prefix: 'Count' }, hookCount: 2,
        source: { fileName: '/fixture/StockCounter.jsx', lineNumber: 1 },
      });
      expect(inspection.component.owners.map((owner: any) => owner.name)).toContain('FixtureApp');
      expect(inspection.replay.status).toBe('complete');
      expect(inspection.replay.records.map((hook: any) => hook.primitive)).toContain('State');
      expect(inspection.schedule).toMatchObject({ ok: true, scheduled: true });
      // Replay itself executes the component once; the scheduled update executes it again.
      await expect.poll(() => page.evaluate(() => (window as any).renderCount)).toBe(before + 2);
      expect(await page.locator('#counter').textContent()).toBe('Count: 0');
    } finally { await page.close(); }
  }, 30000);

  it('renders the logo in the launcher and panel without disturbing the inspected UI', async () => {
    const page = await openPage();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => {
        (window as any).__CHIPPY = { config: { ui: 'panel', integration: { kind: 'extension' } }, connState: 'connected' };
      });
      for (const name of ['panel-dom.js', 'inspect-react.js', 'layout-lab.js']) {
        await page.addScriptTag({ content: readFileSync(`${extension}/${name}`, 'utf8') });
      }
      await page.evaluate(() => (window as any).__CHIPPY.layoutLab.exposeDefaultMarkers());
      expect(await page.locator('[aria-label="Open Chippy"] [data-chippy-logo]').count()).toBe(1);
      await page.locator('[aria-label="Open Chippy"]').click();
      expect(await page.locator('[data-layout-lab-panel] [data-chippy-logo]').count()).toBe(1);
      expect(await page.locator('.chippy-trace-cut').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      expect(await page.locator('#counter').textContent()).toBe('Count: 0');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const motion = await page.locator('.chippy-trace-cut').evaluate(async node => {
        const animation = node.getAnimations()[0];
        const timing = animation?.effect?.getTiming();
        if (animation) await animation.finished;
        return { duration: timing?.duration, iterations: timing?.iterations, state: animation?.playState };
      });
      expect(motion).toEqual({ duration: 650, iterations: 1, state: 'finished' });
      await page.screenshot({ path: '/tmp/chippy-panel-preview.png' });
      await page.setContent(readFileSync(`${extension}/popup.html`, 'utf8').replace('src="logo.svg"', `src="data:image/svg+xml;base64,${Buffer.from(readFileSync(`${extension}/logo.svg`, 'utf8')).toString('base64')}"`));
      await page.locator('header').screenshot({ path: '/tmp/chippy-brand-preview.png' });
    } finally { await page.close(); }
  }, 30000);
});
