/**
 * Records which part of the screen each commit changed.
 *
 * A commit can render thousands of components and change nothing the user
 * sees, or render a few and replace half the screen. This module measures the
 * second: after each commit it finds the DOM nodes React inserted, changed,
 * showed, or removed, and records their boxes in viewport coordinates.
 *
 * What counts as a change:
 * - inserted: a fiber created in this render (no alternate), or one still
 *   carrying the Placement flag. React clears Placement while it inserts, so
 *   on a live page a moved subtree that keeps its fibers is not seen. The
 *   topmost DOM nodes are measured; the subtree below is new with it.
 * - updated: a host element whose visible props changed (class, style, text
 *   children, attributes; event handlers and refs are ignored), or a text node
 *   whose text changed. React 19 flags every host element whose props object
 *   changed, so the flag alone would count re-renders that change nothing.
 * - shown or hidden: an Offscreen fiber with the Visibility flag, which is how
 *   Suspense hides and reveals already-mounted content.
 * - removed: deleted DOM nodes. A removed node has no box any more; its last
 *   measured box is used when this capture measured it earlier.
 *
 * Boxes are read in the commit hook, after React has applied DOM changes and
 * layout effects; reading them forces the browser's pending layout early,
 * which it would otherwise do before the next paint. The cost is recorded per
 * commit. Changes made outside React (CSS animations, direct DOM writes) are
 * not seen here.
 */

import { createAreaGrid, intersectRect, rectArea, type Rect } from '../chippy-bridge/component-area/area-grid';
import { ChildDeletion, Placement, Update, getComponentName, isComponentFiber, type Fiber } from './internals';

// React fiber flag for Offscreen visibility toggles (React 18 and 19).
export const Visibility = 8192;
const MUTATION_MASK = Placement | Update | ChildDeletion | Visibility;

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;
const HOST_HOISTABLE = 26;
const HOST_SINGLETON = 27;
const OFFSCREEN = 22;

export const MAX_NODES_PER_COMMIT = 400;
export const MAX_RECTS_PER_COMMIT = 48;
const MAX_REGIONS = 5;

export interface ScreenCaptureOptions {
  /** Record the screen area each commit changes. Default true in a browser. */
  screenCapture?: boolean;
}

export interface ScreenRegion {
  /** Nearest data-testid, else the nearest component name. */
  label: string;
  /** Changed area in square CSS pixels, clipped to the viewport. */
  area: number;
}

export interface ScreenChange {
  /** Viewport size when the commit was measured. */
  viewport: [number, number];
  /** Union of inserted, updated, and shown boxes, in square CSS pixels. */
  area: number;
  /** Union of boxes removed or hidden, from their last measured position. */
  removedArea: number;
  /** (area + removedArea) / viewport area, capped at 1. */
  share: number;
  /** Largest changed boxes, [left, top, right, bottom], clipped to the viewport. */
  rects: Array<[number, number, number, number]>;
  /** Largest changed regions by area. */
  regions: ScreenRegion[];
  /** DOM nodes measured. */
  nodes: number;
  /** True when more than MAX_NODES_PER_COMMIT nodes changed; the rest were skipped. */
  truncated?: true;
  /** Time spent measuring this commit, in ms. */
  ms: number;
}

export interface ScreenGeometry {
  viewport(): Rect;
  rect(node: Node): Rect | null;
  now(): number;
}

interface Found {
  node: Node;
  fiber: Fiber;
  removed: boolean;
}

type HostFiber = Fiber & { stateNode?: unknown };

export const domScreenGeometry: ScreenGeometry = {
  viewport: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
  rect: (node) => {
    if (node.nodeType === 1) return (node as Element).getBoundingClientRect();
    if (node.nodeType === 3) {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    }
    return null;
  },
  now: () => performance.now(),
};

function isHost(tag: number): boolean {
  return tag === HOST_COMPONENT || tag === HOST_TEXT || tag === HOST_HOISTABLE || tag === HOST_SINGLETON;
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && typeof (value as Node).nodeType === 'number';
}

/** True when a host element's props differ in a way that can change what is drawn. */
export function visiblePropsChanged(prev: unknown, next: unknown): boolean {
  if (prev === next) return false;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return true;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'ref' || key === 'key') continue;
    const x = a[key];
    const y = b[key];
    if (Object.is(x, y)) continue;
    if (typeof x === 'function' || typeof y === 'function') continue;
    if (key === 'children') {
      // Element children are their own fibers; only text children are drawn here.
      const textual = (v: unknown) => typeof v === 'string' || typeof v === 'number';
      if (textual(x) || textual(y)) return true;
      continue;
    }
    if (key === 'style' || key === 'dangerouslySetInnerHTML') {
      if (shallowDiffers(x, y)) return true;
      continue;
    }
    return true;
  }
  return false;
}

function shallowDiffers(x: unknown, y: unknown): boolean {
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return !Object.is(x, y);
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!Object.is(a[key], b[key])) return true;
  return false;
}

/**
 * Finds the DOM nodes a commit changed, topmost first. Stops at `limit` nodes.
 * Exported for tests; `createScreenCapture` is the runtime entry.
 */
export function findChangedHosts(root: Fiber, limit = MAX_NODES_PER_COMMIT): { found: Found[]; truncated: boolean } {
  const found: Found[] = [];
  let truncated = false;

  const push = (fiber: Fiber, removed: boolean) => {
    if (found.length >= limit) { truncated = true; return; }
    const node = (fiber as HostFiber).stateNode;
    if (isNode(node)) found.push({ node, fiber, removed });
  };

  // Topmost host nodes below a fiber (the fiber itself when it is a host).
  const collectTop = (start: Fiber, removed: boolean) => {
    const stack: Fiber[] = [start];
    while (stack.length) {
      const fiber = stack.pop()!;
      if (isHost(fiber.tag)) { push(fiber, removed); continue; }
      for (let child = fiber.child; child; child = child.sibling) stack.push(child);
    }
  };

  const stack: Fiber[] = root.child ? [root.child] : [];
  while (stack.length && !truncated) {
    const fiber = stack.pop()!;
    if (fiber.sibling) stack.push(fiber.sibling);
    // A fiber with no alternate was created in this render: React clears its
    // Placement flag while inserting it, before the commit hook runs, so this
    // is the signal that survives. The walk reaches it only below a parent
    // whose subtree flags still carry the bubbled Placement bit.
    if (fiber.alternate === null) {
      const hiddenMount = fiber.tag === OFFSCREEN && !!(fiber.memoizedState as unknown);
      if (!hiddenMount) collectTop(fiber, false);
      continue;
    }
    // eslint-disable-next-line no-bitwise -- React fiber flags are bitmasks
    if (((fiber.flags | fiber.subtreeFlags) & MUTATION_MASK) === 0) continue;

    // eslint-disable-next-line no-bitwise
    if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions) {
      for (const deleted of fiber.deletions) collectTop(deleted, true);
    }
    // eslint-disable-next-line no-bitwise
    if ((fiber.flags & Placement) !== 0) {
      collectTop(fiber, false);
      continue;
    }
    // eslint-disable-next-line no-bitwise
    if (fiber.tag === OFFSCREEN && (fiber.flags & Visibility) !== 0) {
      const hidden = !!(fiber.memoizedState as unknown);
      for (let child = fiber.child; child; child = child.sibling) collectTop(child, hidden);
      continue;
    }
    // eslint-disable-next-line no-bitwise
    if (isHost(fiber.tag) && (fiber.flags & Update) !== 0 && fiber.alternate) {
      const changed = fiber.tag === HOST_TEXT
        ? fiber.memoizedProps !== fiber.alternate.memoizedProps
        : visiblePropsChanged(fiber.alternate.memoizedProps, fiber.memoizedProps);
      if (changed) {
        push(fiber, false);
        // The element's box covers its children; nothing below adds area.
        continue;
      }
    }
    if (fiber.child) stack.push(fiber.child);
  }
  return { found, truncated };
}

function regionLabel(node: Node, fiber: Fiber): string {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const testId = element?.closest?.('[data-testid]')?.getAttribute('data-testid');
  if (testId) return testId;
  for (let f: Fiber | null = fiber.return; f; f = f.return) {
    if (isComponentFiber(f.tag)) return getComponentName(f);
  }
  return element?.tagName?.toLowerCase() || 'unknown';
}

const round = (n: number) => Math.round(n);

export function createScreenCapture(options: ScreenCaptureOptions = {}, geometry: ScreenGeometry = domScreenGeometry) {
  const enabled = options.screenCapture !== false && typeof document !== 'undefined' && typeof window !== 'undefined';
  const byCommit: Record<number, ScreenChange> = {};
  // Last box of every node measured during this capture, so a later removal
  // can say where the removed content was.
  let lastRects = new WeakMap<Node, Rect>();

  function record(commitId: number, root: Fiber): void {
    if (!enabled) return;
    const started = geometry.now();
    const { found, truncated } = findChangedHosts(root);
    if (found.length === 0) return;
    const viewport = geometry.viewport();
    const cell = Math.max(4, Math.ceil(Math.sqrt(rectArea(viewport) / 40_000)));
    const changed = createAreaGrid(viewport, cell);
    const removed = createAreaGrid(viewport, cell);
    const rects: Array<{ rect: Rect; area: number }> = [];
    const regions = new Map<string, number>();

    for (const { node, fiber, removed: isRemoved } of found) {
      const box = isRemoved ? lastRects.get(node) ?? null : geometry.rect(node);
      if (!box) continue;
      if (!isRemoved) lastRects.set(node, { left: box.left, top: box.top, right: box.right, bottom: box.bottom });
      const clipped = intersectRect(box, viewport);
      if (!clipped) continue;
      const area = rectArea(clipped);
      (isRemoved ? removed : changed).add(clipped);
      rects.push({ rect: clipped, area });
      const label = regionLabel(node, fiber);
      regions.set(label, (regions.get(label) || 0) + area);
    }
    if (rects.length === 0) return;

    const full = Math.max(1, rectArea(viewport));
    const area = round(changed.area());
    const removedArea = round(removed.area());
    rects.sort((a, b) => b.area - a.area);
    byCommit[commitId] = {
      viewport: [round(viewport.right - viewport.left), round(viewport.bottom - viewport.top)],
      area,
      removedArea,
      share: Math.min(1, Math.round(((area + removedArea) / full) * 1000) / 1000),
      rects: rects.slice(0, MAX_RECTS_PER_COMMIT).map(({ rect }) => [round(rect.left), round(rect.top), round(rect.right), round(rect.bottom)]),
      regions: [...regions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_REGIONS)
        .map(([label, regionArea]) => ({ label, area: round(Math.min(regionArea, full)) })),
      nodes: found.length,
      ...(truncated && { truncated: true as const }),
      ms: Math.round((geometry.now() - started) * 100) / 100,
    };
  }

  function reset(): void {
    for (const key of Object.keys(byCommit)) delete byCommit[Number(key)];
    lastRects = new WeakMap();
  }

  return { enabled, byCommit, record, reset };
}
