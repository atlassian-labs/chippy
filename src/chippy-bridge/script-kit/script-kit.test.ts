import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Fiber } from '../../layout-lab/fiber-walk';
import type { FiberHooksResult, ReplayResult } from '../../debug-render/replay';
import { scriptResultJson } from '../script-result';
import { createScriptKit } from './index';
import { GateError, createLedger, parseGates } from './ledger';
import { clearOverlay } from './overlay';
import { runChippyScript } from './run-script';
import { buildRoot, cls, comp, div, fakeGeometry, offscreen, suspense, withAlternate, type FakeRoot } from './test-fibers';
import type { LiveFiber } from './fiber-ref';

class PageErrorBoundary {
  static getDerivedStateFromError() { return {}; }
}

function page(): FakeRoot {
  return buildRoot([
    comp('App', [
      cls(PageErrorBoundary, [
        div([0, 0, 1000, 600], [
          comp('Header', [div([0, 0, 1000, 50], [], { testId: 'header', text: 'Title' })]),
          suspense([
            offscreen(false, [
              comp('Feed', [
                div([0, 50, 600, 600], [
                  comp('FeedItem', [div([0, 50, 600, 150])], { key: 'a' }),
                  comp('FeedItem', [div([0, 150, 600, 250])], { key: 'b' }),
                ]),
              ]),
            ]),
          ]),
          suspense([
            offscreen(true, [comp('Sidebar', [div([600, 50, 1000, 600])])]),
            comp('SidebarSkeleton', [div([600, 50, 1000, 300])]),
          ], true),
        ]),
      ]),
    ]),
  ]);
}

function fiberOnlyHooks(fiber: Fiber): FiberHooksResult {
  return { name: 'x', hookCount: 1, truncated: false, maxHooks: 500, hooks: [{ index: 0, tag: 'State', value: (fiber.memoizedProps as { n?: number })?.n ?? 0 }] };
}

function replayHooks(fiber: Fiber): ReplayResult {
  const name = (fiber.type as { name?: string }).name;
  const path = name === 'Feed' ? [{ name: 'useFeed', loc: '' }, { name: 'Object.useQuery', loc: '' }] : [];
  return {
    componentName: name || 'Unknown',
    records: [{ id: 0, index: 0, primitive: 'SyncExternalStore', value: 1, path, source: null, fiberOnly: false }],
    replayAttempted: true,
    replayError: '',
    replayErrorDetails: null,
    replayStatus: 'complete',
  };
}

function kitFor(root: FakeRoot, allowed: Array<'replay'> = []) {
  return kitForGeometry(root, fakeGeometry(), allowed);
}

function kitForGeometry(root: FakeRoot, geometry: ReturnType<typeof fakeGeometry>, allowed: Array<'replay'> = []) {
  let seq = 0;
  const remembered = new Map<string, Fiber>();
  const log: unknown[] = [];
  const kit = createScriptKit({
    rememberFiber(fiber) { const id = 'fiber:' + ++seq; remembered.set(id, fiber); return id; },
    getRememberedFiber: (id) => remembered.get(id) || null,
    getRootFibers: () => [root.fiberRoot.current as Fiber],
    evalFiberHooks: fiberOnlyHooks,
    replayComponentHooks: replayHooks,
    allowed,
    log,
    geometry,
  });
  return { ...kit, log };
}

afterEach(() => {
  clearOverlay();
  document.body.innerHTML = '';
});

describe('fiber refs', () => {
  it('gives a current/alternate pair one ref and serializes it to an id the commands accept', () => {
    const root = page();
    const { chippy } = kitFor(root);
    const feed = root.byName('Feed');
    const alternate = withAlternate(feed);
    const [ref] = chippy.find({ name: 'Feed' });
    expect(chippy.fromElement(root.container.querySelector('[data-testid=header]'))?.name).toBe('div');
    expect(JSON.parse(JSON.stringify(ref))).toMatchObject({ fiberId: 'fiber:1', name: 'Feed', kind: 'component' });
    expect(chippy.byId('fiber:1')).toBe(ref);
    expect(chippy.byId(1)).toBe(ref);
    expect(alternate.alternate).toBe(feed);
  });

  it('records reading the raw fiber as a run limit', () => {
    const { chippy, ledger } = kitFor(page());
    const [ref] = chippy.find({ name: 'Feed' });
    expect(ledger.entries()).toEqual([]);
    expect(ref.raw.tag).toBe(0);
    expect(ledger.entries()).toEqual([expect.objectContaining({ primitive: 'ref.raw', kind: 'raw' })]);
  });

  it('reports a byId miss as a gap', () => {
    const { chippy, ledger } = kitFor(page());
    expect(chippy.byId('fiber:99')).toBeNull();
    expect(ledger.entries()[0]).toMatchObject({ primitive: 'byId', kind: 'gap' });
  });
});

describe('find', () => {
  it('classifies boundaries and their state', () => {
    const { chippy } = kitFor(page());
    const boundaries = chippy.find({ kind: 'boundary' });
    expect(boundaries.map((b) => [b.kind, b.name, b.status])).toEqual([
      ['error', 'PageErrorBoundary', 'unknown'],
      ['suspense', 'Suspense', 'showing-content'],
      ['suspense', 'Suspense', 'showing-fallback'],
    ]);
  });

  it('does not count a function component named *ErrorBoundary as a boundary', () => {
    const root = buildRoot([comp('NavErrorBoundary', [cls(PageErrorBoundary, [comp('Leaf', [div([0, 0, 10, 10])])])])]);
    const { chippy } = kitFor(root);
    expect(chippy.find({ kind: 'error' }).map((r) => r.name)).toEqual(['PageErrorBoundary']);
    expect(chippy.first({ name: 'NavErrorBoundary' })?.kind).toBe('component');
    expect(chippy.nearest(chippy.first({ name: 'Leaf' })!, 'error')?.name).toBe('PageErrorBoundary');
  });

  it('marks content behind a shown fallback hidden and can skip it', () => {
    const { chippy } = kitFor(page());
    expect(chippy.find({ name: 'Sidebar' })[0].hidden).toBe(true);
    expect(chippy.find({ name: 'Sidebar', visibleOnly: true })).toEqual([]);
    expect(chippy.find({ name: 'Feed' })[0].hidden).toBe(false);
  });

  it('searches below a fiber, including all of its children, but not the fiber or its siblings', () => {
    const { chippy } = kitFor(page());
    const [feed] = chippy.find({ name: 'Feed' });
    expect(chippy.find({ within: feed }).map((r) => r.key)).toEqual(['a', 'b']);
    const [header] = chippy.find({ name: 'Header' });
    expect(chippy.find({ within: header })).toEqual([]);
  });

  it('matches test id and text on the first element', () => {
    const { chippy } = kitFor(page());
    expect(chippy.find({ testId: 'header' }).map((r) => r.name)).toEqual(['Header']);
    expect(chippy.find({ text: 'Tit' }).map((r) => r.name)).toContain('Header');
  });

  it('records truncation at max', () => {
    const { chippy, ledger } = kitFor(page());
    expect(chippy.find({ name: 'FeedItem', max: 2 })).toHaveLength(2);
    expect(ledger.entries()).toEqual([]);
    expect(chippy.find({ name: 'FeedItem', max: 1 })).toHaveLength(1);
    expect(ledger.entries()[0]).toMatchObject({ primitive: 'find', kind: 'truncated' });
    expect(chippy.first({ name: 'App' })?.name).toBe('App');
    expect(ledger.entries()[0].count).toBe(1);
  });
});

describe('relations', () => {
  it('walks component parents and boundaries nearest first', () => {
    const { chippy } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    expect(chippy.parents(item).map((r) => r.name)).toEqual(['Feed', 'Suspense', 'PageErrorBoundary', 'App']);
    expect(chippy.boundaries(item).map((r) => r.kind)).toEqual(['suspense', 'error']);
    expect(chippy.nearest(item, 'error')?.name).toBe('PageErrorBoundary');
  });

  it('stops at until, exclusive unless inclusive', () => {
    const { chippy } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    const boundary = chippy.nearest(item, 'suspense')!;
    expect(chippy.parents(item, { until: boundary }).map((r) => r.name)).toEqual(['Feed']);
    expect(chippy.parents(item, { until: boundary, inclusive: true }).map((r) => r.name)).toEqual(['Feed', 'Suspense']);
  });

  it('treats an explicit max as the answer, not a truncation', () => {
    const { chippy, ledger } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    expect(chippy.parents(item, { max: 1 }).map((r) => r.name)).toEqual(['Feed']);
    expect(ledger.entries()).toEqual([]);
  });

  it('reports an until that is not an ancestor', () => {
    const { chippy, ledger } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    const [header] = chippy.find({ name: 'Header' });
    chippy.parents(item, { until: header });
    expect(ledger.entries()).toEqual([expect.objectContaining({ primitive: 'parents', kind: 'gap' })]);
  });

  it('measures fiber distance and ancestry', () => {
    const { chippy } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    const [feed] = chippy.find({ name: 'Feed' });
    const [header] = chippy.find({ name: 'Header' });
    expect(chippy.distance(item, feed)).toBe(2);
    expect(chippy.distance(item, header)).toBeNull();
    expect(chippy.isAncestor(feed, item)).toBe(true);
    expect(chippy.isAncestor(item, feed)).toBe(false);
  });
});

describe('geometry', () => {
  it('returns outermost DOM nodes in document order', () => {
    const { chippy } = kitFor(page());
    const [feed] = chippy.find({ name: 'Feed' });
    const item = chippy.first({ name: 'FeedItem' })!;
    expect(chippy.hostNodes(feed)).toHaveLength(1);
    expect(chippy.rects(item)).toEqual([{ left: 0, top: 50, right: 600, bottom: 150 }]);
    const app = chippy.first({ kind: 'suspense' })!;
    expect(chippy.hostNodes(app).map((n) => (n as Element).getAttribute('data-rect'))).toEqual(['0,50,600,600']);
  });

  it('compares a component area with its nearest Suspense area', () => {
    const { chippy } = kitFor(page());
    const item = chippy.first({ name: 'FeedItem' })!;
    const boundary = chippy.nearest(item, 'suspense')!;
    expect(chippy.area(item)).toMatchObject({ area: 60000, box: { left: 0, top: 50, right: 600, bottom: 150 } });
    expect(chippy.area(boundary).area).toBe(550 * 600);
    expect(chippy.area(chippy.find({ name: 'FeedItem' })).area).toBe(120000);
  });

  it('clips visible area to the viewport', () => {
    const root = buildRoot([comp('Tall', [div([0, 600, 100, 1000])])]);
    const { chippy } = kitFor(root);
    const [tall] = chippy.find({ name: 'Tall' });
    expect(chippy.area(tall)).toMatchObject({ area: 40000, visibleArea: 20000 });
    expect(chippy.bounds(tall)).toEqual({ left: 0, top: 600, right: 100, bottom: 1000 });
  });

  it('never reports more visible area than area when the grids align differently', () => {
    // The box starts 1px above and left of the viewport, so the whole grid and
    // the viewport grid have different cell origins.
    const root = buildRoot([comp('Page', [div([-1, -1, 1706, 601]), div([304, 703, 1706, 1257])])]);
    const { chippy } = kitForGeometry(root, fakeGeometry({ left: 0, top: 0, right: 1706, bottom: 1257 }));
    const result = chippy.area(chippy.first({ name: 'Page' }));
    expect(result.cellSize).toBeGreaterThan(1);
    expect(result.visibleArea).toBeLessThanOrEqual(result.area);
  });
});

describe('hooks', () => {
  it('reads fiber-only hooks without a gate', () => {
    const { chippy } = kitFor(page());
    const [feed] = chippy.find({ name: 'Feed' });
    expect(chippy.hooks(feed)).toMatchObject({ status: 'fiber-only', customHooks: [], hooks: [{ primitive: 'State' }] });
  });

  it('refuses replay without the gate and records the gap', () => {
    const { chippy, ledger } = kitFor(page());
    const [feed] = chippy.find({ name: 'Feed' });
    expect(() => chippy.hooks(feed, { replay: true })).toThrow(GateError);
    expect(() => chippy.hooks.callers('useQuery')).toThrow(/--allow replay/);
    expect(ledger.entries().map((e) => e.kind)).toEqual(['gap', 'gap']);
  });

  it('names custom hooks and finds their callers with the replay gate', () => {
    const { chippy } = kitFor(page(), ['replay']);
    const [feed] = chippy.find({ name: 'Feed' });
    expect(chippy.hooks(feed, { replay: true }).customHooks).toEqual(['useFeed', 'useQuery']);
    expect(chippy.hooks.callers('useQuery').map((r) => r.name)).toEqual(['Feed']);
    expect(chippy.hooks.callers(/^use(Feed|Nothing)$/).map((r) => r.name)).toEqual(['Feed']);
  });
});

describe('overlay', () => {
  it('paints boxes in a Chippy-owned layer and clears them', () => {
    const { chippy } = kitFor(page());
    const result = chippy.overlay.paint({ items: chippy.find({ kind: 'boundary' }) }, { id: 'b' });
    // The hidden-content Suspense still lays out its fallback, so all three paint.
    expect(result).toEqual({ ok: true, id: 'b', boxes: 3, skipped: 0 });
    const host = document.querySelector('[data-chippy-overlay]')!;
    expect(host.getAttribute('data-chippy-ui')).toBe('true');
    expect(host.shadowRoot!.querySelectorAll('.b')).toHaveLength(3);
    expect(host.shadowRoot!.querySelectorAll('.b.d')).toHaveLength(1);
    expect(chippy.overlay.list()).toEqual([{ id: 'b', boxes: 3 }]);
    expect(chippy.overlay.clear('b')).toEqual({ ok: true, cleared: 3 });
    expect(document.querySelector('[data-chippy-overlay]')).toBeNull();
  });

  it('keeps painting boxes from an earlier run when a later run paints', () => {
    const root = page();
    const first = kitFor(root).chippy;
    first.overlay.paint({ items: first.find({ kind: 'suspense' }) }, { id: 'suspense' });
    const second = kitFor(root).chippy;
    expect(second.overlay.paint({ items: second.find({ kind: 'error' }) }, { id: 'error' })).toMatchObject({ boxes: 1 });
    const host = document.querySelector('[data-chippy-overlay]')!;
    expect(host.shadowRoot!.querySelectorAll('.b')).toHaveLength(3);
    expect(second.overlay.list()).toEqual([{ id: 'suspense', boxes: 2 }, { id: 'error', boxes: 1 }]);
  });

  it('resolves a ref kept from an earlier run', () => {
    const root = page();
    const kept = kitFor(root).chippy.first({ name: 'Feed' })!;
    const later = kitFor(root).chippy;
    expect(later.area(kept).area).toBe(550 * 600);
    expect(later.isAncestor(later.first({ name: 'App' })!, kept)).toBe(true);
    expect(() => later.area({ id: 'fiber:1' } as never)).toThrow(/expected a FiberRef/);
  });

  it('skips items without laid-out DOM', () => {
    const root = buildRoot([comp('Empty'), comp('Box', [div([0, 0, 10, 10])])]);
    const { chippy } = kitFor(root);
    expect(chippy.overlay.paint({ items: chippy.find({}) })).toMatchObject({ boxes: 1, skipped: 1 });
  });
});

describe('gates', () => {
  it('reports unknown gates instead of dropping them', () => {
    expect(parseGates('replay, replya,replay')).toEqual({ allowed: ['replay'], unknown: ['replya'] });
    expect(parseGates(undefined)).toEqual({ allowed: [], unknown: [] });
  });

  it('dedupes repeated limits with a count', () => {
    const ledger = createLedger();
    ledger.add('find', 'truncated', 'x');
    ledger.add('find', 'truncated', 'x');
    expect(ledger.entries()).toEqual([{ primitive: 'find', kind: 'truncated', detail: 'x', count: 2 }]);
  });
});

describe('runChippyScript', () => {
  function deps(root: FakeRoot) {
    let seq = 0;
    return {
      buildHelpers: () => ({ getRootFibers: () => [root.fiberRoot.current as Fiber] }),
      rememberFiber: () => 'fiber:' + ++seq,
      evalFiberHooks: fiberOnlyHooks,
      replayComponentHooks: replayHooks,
      scriptResultJson,
    };
  }

  it('runs async scripts with chippy bound and serializes refs', async () => {
    const root = page();
    const out = await runChippyScript({ source: 'await null; return chippy.find({ name: ctx.args.name });', args: { name: 'Feed' } }, deps(root));
    expect(out).toMatchObject({ ok: true, limits: [], allowed: [], result: [{ name: 'Feed', kind: 'component' }] });
    expect((out.result as Array<{ fiberId: string }>)[0].fiberId).toMatch(/^fiber:\d+$/);
  });

  it('returns limits from deep inside the script', async () => {
    const out = await runChippyScript({ source: 'return chippy.find({ max: 1 }).length;' }, deps(page()));
    expect(out).toMatchObject({ ok: true, result: 1, limits: [{ primitive: 'find', kind: 'truncated' }] });
  });

  it('turns a gate refusal into an envelope that names the gate', async () => {
    const out = await runChippyScript({ source: 'return chippy.hooks.callers("useQuery");', allow: 'replya' }, deps(page()));
    expect(out).toMatchObject({ ok: false, gate: 'replay', unknownGates: ['replya'] });
    expect(out.error).toMatch(/--allow replay/);
  });

  it('runs gated blocks when allowed', async () => {
    const out = await runChippyScript({ source: 'return chippy.hooks.callers("useQuery");', allow: ['replay'] }, deps(page()));
    expect(out).toMatchObject({ ok: true, allowed: ['replay'], result: [{ name: 'Feed' }] });
  });

  it('returns the last checkpoint on timeout', async () => {
    const out = await runChippyScript({
      source: 'chippy.checkpoint({ step: 1 }); await new Promise(() => {});',
      timeoutMs: 60,
    }, deps(page()));
    expect(out).toMatchObject({ ok: false, timedOut: true, partial: { step: 1 } });
  });

  it('reports page DOM mutations, commits, and globals but not its own overlay', async () => {
    const root = page();
    const out = await runChippyScript({
      source: [
        'document.body.appendChild(document.createElement("i"));',
        'globalThis.__scriptLeak = 1;',
        'ctx.args.commit();',
        'chippy.overlay.paint({ items: chippy.find({ name: "Header" }) });',
        'chippy.overlay.clear();',
        'return true;',
      ].join('\n'),
      args: { commit: () => { root.fiberRoot.current = withAlternate(root.hostRoot) as LiveFiber; } },
    }, deps(root));
    delete (globalThis as Record<string, unknown>).__scriptLeak;
    expect(out.sideEffects).toEqual({ domMutations: 1, rootsCommitted: 1, globalsAdded: ['__scriptLeak'] });
  });

  it('rejects an empty script', async () => {
    expect(await runChippyScript({ source: '  ' }, deps(page()))).toMatchObject({ ok: false, error: 'empty script source' });
  });
});

describe('page-scripts reference', () => {
  it('documents every member of the chippy toolkit', () => {
    const doc = readFileSync(resolve(__dirname, '../../../.agents/skills/chippy/references/page-scripts.md'), 'utf8');
    const api = doc.slice(doc.indexOf('declare const chippy'));
    const { chippy } = kitFor(page());
    const members = [...Object.keys(chippy), 'hooks.callers', 'overlay.paint', 'overlay.clear', 'overlay.list'];
    const missing = members.filter((name) => !new RegExp(`\\b${name.split('.').pop()}[(:<]`).test(api));
    expect(missing).toEqual([]);
  });
});
