import { afterEach, describe, expect, it } from 'vitest';
import { measureComponentArea, type AreaGeometry, type AreaReport } from './measure';
import type { Rect } from './area-grid';

// Geometry comes from data attributes so the tests control layout exactly:
//   data-rect="left,top,right,bottom"   element box
//   data-text="left,top,right,bottom"   box of the element's direct text
//   data-style="display:none" etc.      computed style overrides
function parseRect(value: string | null): Rect {
  const [left, top, right, bottom] = (value || '0,0,0,0').split(',').map(Number);
  return { left, top, right, bottom };
}

const geometry: AreaGeometry = {
  viewport: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
  rect: (el) => parseRect(el.getAttribute('data-rect')),
  textRects: (node) => {
    const value = node.parentElement?.getAttribute('data-text');
    return value ? [parseRect(value)] : [];
  },
  style: (el) => {
    const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
    for (const part of (el.getAttribute('data-style') || '').split(';')) {
      const [k, v] = part.split(':');
      if (k && v) (style as Record<string, string>)[k.trim()] = v.trim();
    }
    return style;
  },
};

type FakeFiber = { tag: number; type?: unknown; return: FakeFiber | null; memoizedState?: unknown; alternate?: FakeFiber | null };

function attach(el: Element, fiber: FakeFiber): void {
  (el as unknown as Record<string, unknown>)['__reactFiber$test'] = fiber;
}

function host(parent: FakeFiber | null): FakeFiber {
  return { tag: 5, type: 'div', return: parent };
}

function component(name: string, parent: FakeFiber | null): FakeFiber {
  const type = function () {};
  Object.defineProperty(type, 'name', { value: name });
  return { tag: 0, type, return: parent };
}

function render(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector('[data-testid="modal"]')!;
}

function measured(options: Parameters<typeof measureComponentArea>[0]): AreaReport {
  const report = measureComponentArea(options, geometry, document);
  if (!report.ok) throw new Error((report as { reason: string }).reason);
  return report;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('measureComponentArea', () => {
  it('reports test id areas, content, and shares inside the root', () => {
    render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div data-testid="header" data-rect="0,0,400,50" data-text="10,10,110,30">Title</div>
        <div data-testid="body" data-rect="0,50,400,300"><img data-rect="0,50,200,150"></div>
      </div>`);
    const report = measured({ root: 'modal', testIds: ['header', 'body'] });
    expect(report.root.area).toBe(120000);
    expect(report.targets.map((t) => [t.name, t.area, t.contentArea])).toEqual([
      ['header', 20000, 2000],
      ['body', 100000, 20000],
    ]);
    expect(report.content.area).toBe(22000);
    expect(report.content.share).toBeCloseTo(22000 / 120000, 3);
    expect(report.placeholder.area).toBe(0);
  });

  it('treats elements below a suspended boundary fallback as placeholder, not content', () => {
    const modal = render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div id="skeleton" data-rect="0,0,400,200" data-text="0,0,100,20">Loading</div>
      </div>`);
    const root = host(null);
    const suspense: FakeFiber = { tag: 13, return: root, memoizedState: { dehydrated: null } };
    const fallbackFragment: FakeFiber = { tag: 7, return: suspense };
    attach(modal, root);
    attach(document.getElementById('skeleton')!, host(fallbackFragment));
    const report = measured({ root: 'modal', autoTargets: 0 });
    expect(report.placeholder.area).toBe(80000);
    expect(report.content.area).toBe(0);
  });

  it('does not treat primary content under a resolved boundary as placeholder', () => {
    const modal = render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div id="content" data-rect="0,0,400,200" data-text="0,0,100,20">Ready</div>
      </div>`);
    const root = host(null);
    const suspense: FakeFiber = { tag: 13, return: root, memoizedState: null };
    const offscreen: FakeFiber = { tag: 22, return: suspense };
    attach(modal, root);
    attach(document.getElementById('content')!, host(offscreen));
    const report = measured({ root: 'modal', autoTargets: 0 });
    expect(report.placeholder.area).toBe(0);
    expect(report.content.area).toBe(2000);
  });

  it('measures components by display name through the fiber path', () => {
    const modal = render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div id="a" data-rect="0,0,200,100"></div>
        <div id="b" data-rect="100,0,300,100"></div>
        <div id="c" data-rect="0,200,400,300"></div>
      </div>`);
    const root = host(null);
    attach(modal, root);
    const description = component('Description', root);
    attach(document.getElementById('a')!, host(description));
    attach(document.getElementById('b')!, host(description));
    attach(document.getElementById('c')!, host(component('Comments', root)));
    const report = measured({ root: 'modal', components: ['Description', 'Comments', 'Missing'] });
    expect(report.targets.map((t) => [t.name, t.elements, t.area])).toEqual([
      ['Description', 2, 30000],
      ['Comments', 1, 40000],
      ['Missing', 0, 0],
    ]);
  });

  it('clips to overflow containers and skips hidden subtrees', () => {
    render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div data-rect="0,0,400,100" data-style="overflowY:auto">
          <div data-testid="scrolled" data-rect="0,50,400,250"></div>
        </div>
        <div data-testid="gone" data-style="display:none" data-rect="0,0,400,300"></div>
        <div data-testid="invisible" data-style="visibility:hidden" data-rect="0,0,400,300"></div>
      </div>`);
    const report = measured({ root: 'modal', testIds: ['scrolled', 'gone', 'invisible'] });
    expect(report.targets.map((t) => [t.name, t.area])).toEqual([
      ['scrolled', 20000],
      ['gone', 0],
      ['invisible', 0],
    ]);
  });

  it('picks the largest test ids when no targets are named', () => {
    render(`
      <div data-testid="modal" data-rect="0,0,400,300">
        <div data-testid="small" data-rect="0,0,10,10"></div>
        <div data-testid="big" data-rect="0,0,400,200"></div>
        <div data-testid="mid" data-rect="0,200,200,300"></div>
      </div>`);
    const report = measured({ root: 'modal', autoTargets: 2 });
    expect(report.targets.map((t) => t.name)).toEqual(['big', 'mid']);
  });

  it('fails clearly when the root is missing', () => {
    render('<div></div>');
    expect(measureComponentArea({ root: 'nope' }, geometry, document)).toMatchObject({ ok: false, reason: 'root-not-found' });
  });
});
