// Measures how much of a root element's on-screen area each component or test
// id covers, how much is still a loading placeholder, and how much shows real
// content (text, media, and form controls).
//
// The walk is DOM-first: every element under the root is visited once, and the
// fiber path between an element and its parent element supplies component
// membership and Suspense-fallback state. Areas are unions of on-screen boxes,
// clipped to the root, the viewport, and any overflow-clipping ancestor, and
// counted on a coverage grid (see area-grid.ts) so overlaps count once.

import { getFiber, type Fiber } from '../../layout-lab/fiber-walk';
import { readComponentName } from '../component-origin';
import { createAreaGrid, cellSizeFor, intersectRect, rectArea, type AreaGrid, type Rect } from './area-grid';

const SUSPENSE_TAG = 13;
const OFFSCREEN_TAGS = new Set([22, 23]);
const COMPOSITE_TAGS = new Set([0, 1, 2, 11, 14, 15]);
const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'PICTURE', 'OBJECT', 'EMBED']);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);
const DEFAULT_AUTO_TARGETS = 15;
const DEFAULT_MIN_SHARE = 0.01;

export interface AreaOptions {
  /** Root element, or a CSS selector / data-testid naming it. Default: the viewport. */
  root?: Element | string | null;
  /** Component display names to measure. */
  components?: string[];
  /** data-testid values to measure. */
  testIds?: string[];
  /** Components whose names match this pattern also count as placeholders. */
  placeholderNames?: string | RegExp | null;
  /** When no targets are named, report this many of the largest test ids. */
  autoTargets?: number;
  /** Auto targets smaller than this share of the root are left out. */
  minShare?: number;
}

export interface AreaGeometry {
  viewport(): Rect;
  rect(el: Element): Rect;
  textRects(node: Text): Rect[];
  style(el: Element): { display: string; visibility: string; opacity: string; overflowX: string; overflowY: string };
}

export interface AreaTargetReport {
  label: string;
  kind: 'component' | 'testid';
  name: string;
  elements: number;
  area: number;
  share: number;
  contentArea: number;
  contentShare: number;
  placeholderArea: number;
}

export interface AreaReport {
  ok: true;
  at: number;
  root: { label: string; rect: Rect; area: number };
  cellSize: number;
  placeholder: { area: number; share: number };
  content: { area: number; share: number };
  targets: AreaTargetReport[];
  stats: { elements: number; textRects: number; ms: number };
}

export interface AreaFailure {
  ok: false;
  reason: 'root-not-found' | 'root-offscreen' | 'no-document';
  root: string | null;
  at: number;
}

interface Target {
  label: string;
  kind: 'component' | 'testid';
  name: string;
  box: AreaGrid;
  content: AreaGrid;
  placeholder: AreaGrid;
  elements: number;
}

interface Membership {
  groups: number[];
  placeholder: boolean;
}

export const domGeometry: AreaGeometry = {
  viewport() {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  },
  rect(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  },
  textRects(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    return Array.from(range.getClientRects(), (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
  },
  style(el) {
    return getComputedStyle(el);
  },
};

export function resolveAreaRoot(root: AreaOptions['root'], doc: Document = document): Element | null {
  if (root && typeof root === 'object') return root;
  if (!root) return doc.documentElement;
  const value = String(root).trim();
  const byTestId = doc.querySelector('[data-testid="' + value.replace(/["\\]/g, '\\$&') + '"]');
  if (byTestId) return byTestId;
  try {
    return doc.querySelector(value);
  } catch (_) {
    return null;
  }
}

function rootLabel(root: AreaOptions['root'], el: Element): string {
  if (typeof root === 'string' && root) return root;
  const testId = el.getAttribute('data-testid');
  return testId ? 'testid:' + testId : el === el.ownerDocument.documentElement ? 'viewport' : el.tagName.toLowerCase();
}

function fiberName(fiber: Fiber): string | null {
  return readComponentName(fiber.type) || readComponentName(fiber.elementType);
}

function fiberTag(fiber: Fiber): number {
  return (fiber as { tag?: number }).tag ?? -1;
}

function isFallbackEdge(child: Fiber, parent: Fiber): boolean {
  // A suspended boundary keeps its primary children under an Offscreen fiber
  // and renders the fallback as a sibling. Fallback DOM only exists while the
  // boundary shows it, so a live element below a non-Offscreen child of a
  // suspended boundary is placeholder content.
  if (fiberTag(parent) !== SUSPENSE_TAG || OFFSCREEN_TAGS.has(fiberTag(child))) return false;
  const alternate = (parent as { alternate?: Fiber | null }).alternate;
  return parent.memoizedState != null || !!(alternate && alternate.memoizedState != null);
}

export function measureComponentArea(
  options: AreaOptions = {},
  geometry: AreaGeometry = domGeometry,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): AreaReport | AreaFailure {
  const startedAt = performance.now();
  const rootName = typeof options.root === 'string' ? options.root : null;
  if (!doc) return { ok: false, reason: 'no-document', root: rootName, at: startedAt };
  const rootEl = resolveAreaRoot(options.root, doc);
  if (!rootEl) return { ok: false, reason: 'root-not-found', root: rootName, at: startedAt };

  const viewport = geometry.viewport();
  const isViewport = rootEl === doc.documentElement;
  const rootRect = isViewport ? viewport : geometry.rect(rootEl);
  const clip = intersectRect(rootRect, viewport);
  if (!clip) return { ok: false, reason: 'root-offscreen', root: rootName, at: startedAt };

  const cell = cellSizeFor(clip);
  const placeholder = createAreaGrid(clip, cell);
  const content = createAreaGrid(clip, cell);
  const placeholderPattern = options.placeholderNames
    ? (options.placeholderNames instanceof RegExp ? options.placeholderNames : new RegExp(options.placeholderNames))
    : null;

  const targets: Target[] = [];
  const componentIndex = new Map<string, number>();
  const testIdIndex = new Map<string, number>();
  function addTarget(kind: Target['kind'], name: string): void {
    const index = kind === 'component' ? componentIndex : testIdIndex;
    if (index.has(name)) return;
    index.set(name, targets.length);
    targets.push({
      label: kind + ':' + name, kind, name, elements: 0,
      box: createAreaGrid(clip, cell), content: createAreaGrid(clip, cell), placeholder: createAreaGrid(clip, cell),
    });
  }
  for (const name of options.components || []) if (name) addTarget('component', name);
  for (const id of options.testIds || []) if (id) addTarget('testid', id);
  if (targets.length === 0) {
    for (const id of largestTestIds(rootEl, clip, geometry, options)) addTarget('testid', id);
  }

  let elements = 0;
  let textRects = 0;

  function membershipFor(el: Element, parentFiber: Fiber | null, parent: Membership): { m: Membership; fiber: Fiber | null } {
    const fiber = getFiber(el);
    let groups = parent.groups;
    let isPlaceholder = parent.placeholder;
    const add = (index: number | undefined) => {
      if (index === undefined || groups.includes(index)) return;
      groups = groups === parent.groups ? groups.slice() : groups;
      groups.push(index);
    };
    if (fiber) {
      const parentAlternate = parentFiber ? (parentFiber as { alternate?: Fiber | null }).alternate : null;
      let child: Fiber = fiber;
      let node = fiber.return || null;
      while (node && node !== parentFiber && node !== parentAlternate) {
        if (!isPlaceholder && isFallbackEdge(child, node)) isPlaceholder = true;
        if (COMPOSITE_TAGS.has(fiberTag(node)) && (componentIndex.size > 0 || placeholderPattern)) {
          const name = fiberName(node);
          if (name) {
            add(componentIndex.get(name));
            if (!isPlaceholder && placeholderPattern && placeholderPattern.test(name)) isPlaceholder = true;
          }
        }
        child = node;
        node = node.return || null;
      }
    }
    const testId = testIdIndex.size > 0 ? el.getAttribute('data-testid') : null;
    if (testId) add(testIdIndex.get(testId));
    return { m: { groups, placeholder: isPlaceholder }, fiber };
  }

  function visit(el: Element, parentFiber: Fiber | null, parent: Membership, area: Rect, isRoot: boolean): void {
    if (SKIPPED.has(el.tagName.toUpperCase())) return;
    elements++;
    const { m, fiber } = membershipFor(el, parentFiber, parent);
    const style = geometry.style(el);
    if (style.display === 'none') return;
    const rect = isRoot && isViewport ? viewport : geometry.rect(el);
    const sized = rectArea(rect) > 0;
    const visible = sized && style.visibility !== 'hidden' && style.opacity !== '0';
    const box = visible ? intersectRect(rect, area) : null;
    const tag = el.tagName.toUpperCase();

    if (box) {
      if (m.placeholder && (!parent.placeholder || isRoot)) placeholder.add(box);
      for (const index of m.groups) {
        const target = targets[index];
        if (isRoot || !parent.groups.includes(index)) {
          target.box.add(box);
          target.elements++;
        }
        if (m.placeholder) target.placeholder.add(box);
      }
      if (REPLACED.has(tag)) addContent(box, m);
    }
    if (REPLACED.has(tag)) return;

    let childArea = area;
    if (!isRoot && sized && (clips(style.overflowX) || clips(style.overflowY))) {
      const clipped = intersectRect(area, rect);
      if (!clipped) return;
      childArea = clipped;
    }

    if (style.visibility !== 'hidden' && style.opacity !== '0') {
      for (let node = el.firstChild; node; node = node.nextSibling) {
        if (node.nodeType !== 3 || !(node as Text).data.trim()) continue;
        for (const r of geometry.textRects(node as Text)) {
          const inside = intersectRect(r, childArea);
          if (inside) { textRects++; addContent(inside, m); }
        }
      }
    }
    if (style.opacity === '0') return;
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
      visit(child, fiber || parentFiber, m, childArea, false);
    }
  }

  function addContent(rect: Rect, m: Membership): void {
    if (m.placeholder) return;
    content.add(rect);
    for (const index of m.groups) targets[index].content.add(rect);
  }

  // The root's own membership comes from its full fiber ancestry, so a root
  // inside a fallback or a named component is classified correctly.
  visit(rootEl, null, { groups: [], placeholder: false }, clip, true);

  const rootArea = rectArea(clip);
  const share = (n: number) => (rootArea > 0 ? round(n / rootArea, 4) : 0);
  return {
    ok: true,
    at: round(startedAt, 1),
    root: { label: rootLabel(options.root ?? null, rootEl), rect: roundRect(clip), area: Math.round(rootArea) },
    cellSize: cell,
    placeholder: { area: Math.round(placeholder.area()), share: share(placeholder.area()) },
    content: { area: Math.round(content.area()), share: share(content.area()) },
    targets: targets.map((t) => ({
      label: t.label, kind: t.kind, name: t.name, elements: t.elements,
      area: Math.round(t.box.area()), share: share(t.box.area()),
      contentArea: Math.round(t.content.area()), contentShare: share(t.content.area()),
      placeholderArea: Math.round(t.placeholder.area()),
    })),
    stats: { elements, textRects, ms: round(performance.now() - startedAt, 1) },
  };
}

function largestTestIds(rootEl: Element, clip: Rect, geometry: AreaGeometry, options: AreaOptions): string[] {
  const limit = options.autoTargets ?? DEFAULT_AUTO_TARGETS;
  if (limit <= 0) return [];
  const minArea = rectArea(clip) * (options.minShare ?? DEFAULT_MIN_SHARE);
  const best = new Map<string, number>();
  for (const el of Array.from(rootEl.querySelectorAll('[data-testid]'))) {
    const id = el.getAttribute('data-testid');
    if (!id) continue;
    const box = intersectRect(geometry.rect(el), clip);
    const area = box ? rectArea(box) : 0;
    if (area >= minArea && area > (best.get(id) || 0)) best.set(id, area);
  }
  return Array.from(best.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

function clips(overflow: string): boolean {
  return overflow === 'hidden' || overflow === 'auto' || overflow === 'scroll' || overflow === 'clip';
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function roundRect(r: Rect): Rect {
  return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
}
