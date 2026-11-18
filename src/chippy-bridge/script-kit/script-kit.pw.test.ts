// Page scripts against real React 18 and 19 pages, through the page bridge's
// eval-script entry. The scripts are the kind an agent writes for a one-off
// question: "if Feed suspended instead of rendering its loading state, what
// area would go blank?"
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

const extension = '.agents/skills/chippy/extension';
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
const h = React.createElement;
let commentsReady = false; let resolveComments;
const commentsPending = new Promise((resolve) => { resolveComments = () => { commentsReady = true; resolve(); }; });
window.resolveComments = () => resolveComments();
function useQuery(key) { const [state] = React.useState({ loading: true, key }); return state; }
function useFeedQuery() { return useQuery('feed'); }
function Header() { return h('header', { 'data-testid': 'header', style: { height: 50 } }, 'Title'); }
function Profile() { const q = useQuery('profile'); return h('div', { 'data-testid': 'profile', style: { height: 60 } }, q.key); }
function Feed() { const q = useFeedQuery(); return h('div', { 'data-testid': 'feed', style: { height: 120 } }, q.loading ? 'Loading feed' : 'Feed'); }
function Comments({ version }) {
  if (version > 0 && !commentsReady) throw commentsPending;
  return h('div', { 'data-testid': 'comments', style: { height: 80 } }, 'Comments');
}
function CommentsSkeleton() { return h('div', { 'data-testid': 'comments-skeleton', style: { height: 80 } }); }
function PageSkeleton() { return h('div', { 'data-testid': 'page-skeleton', style: { height: 260 } }); }
function Main() {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => { window.suspendComments = () => setVersion(1); }, []);
  return h('main', { 'data-testid': 'main', style: { width: 600 } },
    h(Profile), h(Feed),
    h(React.Suspense, { fallback: h(CommentsSkeleton) }, h(Comments, { version })));
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? h('p', null, 'Failed') : this.props.children; }
}
function Layout() {
  return h('div', { 'data-testid': 'layout', style: { position: 'absolute', left: 0, top: 0, width: 800 } },
    h(Header),
    h(React.Suspense, { fallback: h(PageSkeleton) }, h(Main)));
}
createRoot(document.getElementById('root')).render(h(ErrorBoundary, null, h(Layout)));
`;

// The suspense-impact investigation, written against the chippy toolkit.
const impactScript = `
const target = chippy.first({ name: ctx.args.component });
if (!target) return { found: false };
const suspense = chippy.nearest(target, 'suspense');
const errorBoundary = chippy.nearest(target, 'error');
const ladder = chippy.parents(target, { until: suspense, inclusive: true })
  .map((ref) => ({ name: ref.name, kind: ref.kind, area: chippy.area(ref).area }));
const collateral = chippy.components(suspense)
  .filter((ref) => ref !== target && !chippy.isAncestor(ref, target))
  .map((ref) => ref.name);
const painted = chippy.overlay.paint([
  { items: [errorBoundary] },
  { items: [suspense], label: 'goes blank' },
  { items: [target], label: 'today' },
], { id: 'impact' });
return {
  target,
  before: chippy.area(target).area,
  after: chippy.area(suspense).area,
  suspenseStatus: suspense.status,
  errorBoundary: { name: errorBoundary.name, area: chippy.area(errorBoundary).area },
  ladder,
  collateral,
  painted,
};
`;

let server: Server;
let url = '';
let browser: Browser;
const scripts: Record<string, string> = {};

beforeAll(async () => {
  for (const [kind, alias] of [['stock', {}], ['react-19', { react: 'react-19', 'react-dom': 'react-dom-19' }]] as const) {
    const result = await build({
      stdin: { contents: app, resolveDir: process.cwd(), sourcefile: 'script-kit-fixture.jsx' },
      alias, bundle: true, write: false, platform: 'browser', format: 'iife', keepNames: true,
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    });
    scripts[kind] = result.outputFiles[0].text;
  }
  server = createServer((request, response) => {
    const kind = (request.url || '/').slice(1);
    if (kind.endsWith('.js') && scripts[kind.slice(0, -3)]) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(scripts[kind.slice(0, -3)]);
    } else if (scripts[kind]) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body style="margin:0;font:16px system-ui"><div id="root"></div><script src="/' + kind + '.js"></script></body></html>');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function openPage(kind: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.addInitScript({ content: readFileSync(extension + '/devtools-hook-shim.js', 'utf8') });
  await page.addInitScript({ content: readFileSync(extension + '/avalanche.iife.js', 'utf8') });
  await page.goto(url + '/' + kind);
  await page.locator('[data-testid="comments"]').waitFor();
  // An unreachable helper keeps the bridge offline; only eval-script is under test.
  await page.evaluate(() => { (window as any).__CHIPPY = { config: { helperBaseUrl: 'http://127.0.0.1:9' } }; });
  await page.addScriptTag({ content: readFileSync(extension + '/chippy-page-bridge.js', 'utf8') });
  return page;
}

function run(page: Page, source: string, options: { args?: Record<string, unknown>; allow?: string[]; timeoutMs?: number } = {}) {
  return page.evaluate((command) => (window as any).__CHIPPY.pageBridge.__debug.evalScript(command), { source, ...options });
}

describe('page scripts on real React', () => {
  it.each(['stock', 'react-19'])('measures what goes blank if Feed suspends on %s React', async (kind) => {
    const page = await openPage(kind);
    try {
      const envelope = await run(page, impactScript, { args: { component: 'Feed' } });
      expect(envelope).toMatchObject({ ok: true, limits: [], allowed: [] });
      const result = envelope.result;
      expect(result.target).toMatchObject({ name: 'Feed', kind: 'component' });
      expect(result.target.fiberId).toMatch(/^fiber:\d+$/);
      expect(result.before).toBe(600 * 120);
      // The nearest Suspense wraps Main: Profile, Feed, and the comments slot.
      expect(result.after).toBe(600 * 260);
      expect(result.suspenseStatus).toBe('showing-content');
      expect(result.errorBoundary).toEqual({ name: 'ErrorBoundary', area: 800 * 310 });
      expect(result.ladder).toEqual([
        { name: 'Main', kind: 'component', area: 600 * 260 },
        { name: 'Suspense', kind: 'suspense', area: 600 * 260 },
      ]);
      expect(result.collateral).toEqual(['Profile', 'Comments']);
      expect(result.painted).toEqual({ ok: true, id: 'impact', boxes: 3, skipped: 0 });
      // The overlay lives in Chippy's own layer, so the page saw no mutation and no commit.
      expect(envelope.sideEffects).toMatchObject({ domMutations: 0, rootsCommitted: 0 });
      expect(await page.evaluate(() => document.querySelector('[data-chippy-overlay]')?.shadowRoot?.querySelectorAll('.b').length)).toBe(3);

      const cleared = await run(page, 'return chippy.overlay.clear()');
      expect(cleared.ok).toBe(true);
      expect(await page.evaluate(() => document.querySelector('[data-chippy-overlay]')?.shadowRoot?.querySelectorAll('.b').length ?? 0)).toBe(0);
    } finally { await page.close(); }
  }, 30000);

  it.each(['stock', 'react-19'])('reports hidden content behind a re-suspended boundary on %s React', async (kind) => {
    const page = await openPage(kind);
    try {
      await page.evaluate(() => (window as any).suspendComments());
      await page.locator('[data-testid="comments-skeleton"]').waitFor();
      const envelope = await run(page, `
        const comments = chippy.first({ name: 'Comments' });
        const boundary = chippy.nearest(comments, 'suspense');
        return {
          hidden: comments.hidden,
          area: chippy.area(comments).area,
          status: boundary.status,
          boundaryArea: chippy.area(boundary).area,
          hiddenUnderBoundary: chippy.components(boundary).filter((ref) => ref.hidden).map((ref) => ref.name),
        };
      `);
      expect(envelope.ok).toBe(true);
      expect(envelope.result).toEqual({
        hidden: true,
        area: 0,
        status: 'showing-fallback',
        boundaryArea: 600 * 80,
        hiddenUnderBoundary: ['Comments'],
      });
    } finally { await page.close(); }
  }, 30000);

  it.each(['stock', 'react-19'])('names useQuery callers only after --allow replay on %s React', async (kind) => {
    const page = await openPage(kind);
    try {
      const source = `
        const feed = chippy.first({ name: 'Feed' });
        return {
          fiberOnly: chippy.hooks(feed).hooks.map((hook) => hook.primitive),
          callers: chippy.hooks.callers('useQuery').map((ref) => ref.name),
          feedHooks: chippy.hooks(feed, { replay: true }).customHooks,
        };
      `;
      const refused = await run(page, source);
      expect(refused).toMatchObject({ ok: false, gate: 'replay' });
      expect(refused.error).toContain('--allow replay');
      expect(refused.limits).toEqual([expect.objectContaining({ kind: 'gap' })]);

      const allowed = await run(page, source, { allow: ['replay'] });
      expect(allowed).toMatchObject({ ok: true, allowed: ['replay'], limits: [] });
      expect(allowed.result).toEqual({
        fiberOnly: ['State'],
        callers: ['Profile', 'Feed'],
        feedHooks: ['useFeedQuery', 'useQuery'],
      });
      expect(allowed.sideEffects).toMatchObject({ domMutations: 0, rootsCommitted: 0 });
    } finally { await page.close(); }
  }, 30000);
});
