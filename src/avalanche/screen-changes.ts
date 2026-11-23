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
 * An inserted node whose own box is empty (portal and layer wrappers whose
 * children are fixed or absolutely positioned) is measured through its
 * nearest non-empty descendants instead.
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

/**
 * How a host node changed in a commit. `moved` is a node that kept its fiber
 * but still carries the Placement flag; `hidden` and `shown` are Suspense
 * visibility toggles.
 */
export type HostChangeKind = 'inserted' | 'moved' | 'updated' | 'removed' | 'shown' | 'hidden';

export interface Found {
  node: Node;
  fiber: Fiber;
  /** True when the node left the screen (removed or hidden). */
  removed: boolean;
  kind: HostChangeKind;
  /** For removed nodes: the fiber whose `deletions` listed the subtree. React detaches a deleted subtree from its parent, so this is the way back up. */
  parent?: Fiber;
}

export interface FindChangedHostsOptions {
  /** Maximum nodes to return. */
  limit?: number;
  /**
   * Keep walking below an updated element, so nested updates are returned too.
   * Off for area measurement, where the element's box already covers them.
   */
  descendUpdated?: boolean;
  /**
   * Report keyed children React moved. React clears a moved fiber's Placement
   * flag while it moves the node, so the move is found the way React decides
   * it: a child whose previous index is lower than that of a child placed
   * before it.
   */
  detectMoves?: boolean;
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

/**
 * Calls `visit(key, before, after)` for each host prop change that can change
 * what is drawn: class, attributes, text children, and each changed style key
 * (`style.<key>`). Event handlers, refs, keys, and element children are
 * skipped; element children are their own fibers. `visit` returns true to
 * stop. Returns true when any change was visited.
 */
export function forEachVisiblePropChange(
  prev: unknown,
  next: unknown,
  visit: (key: string, before: unknown, after: unknown) => boolean | void,
): boolean {
  if (prev === next) return false;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') {
    visit('props', prev, next);
    return true;
  }
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  let any = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'ref' || key === 'key') continue;
    const x = a[key];
    const y = b[key];
    if (Object.is(x, y)) continue;
    if (typeof x === 'function' || typeof y === 'function') continue;
    if (key === 'children') {
      // Element children are their own fibers; only text children are drawn here.
      const textual = (v: unknown) => typeof v === 'string' || typeof v === 'number';
      if (!textual(x) && !textual(y)) continue;
      any = true;
      if (visit(key, textual(x) ? x : undefined, textual(y) ? y : undefined)) return true;
      continue;
    }
    if (key === 'style') {
      const sx = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const sy = (y && typeof y === 'object' ? y : {}) as Record<string, unknown>;
      for (const styleKey of new Set([...Object.keys(sx), ...Object.keys(sy)])) {
        if (Object.is(sx[styleKey], sy[styleKey])) continue;
        any = true;
        if (visit('style.' + styleKey, sx[styleKey], sy[styleKey])) return true;
      }
      continue;
    }
    if (key === 'dangerouslySetInnerHTML') {
      const hx = (x as { __html?: unknown } | null | undefined)?.__html;
      const hy = (y as { __html?: unknown } | null | undefined)?.__html;
      if (Object.is(hx, hy)) continue;
      any = true;
      if (visit(key, hx, hy)) return true;
      continue;
    }
    any = true;
    if (visit(key, x, y)) return true;
  }
  return any;
}

/** True when a host element's props differ in a way that can change what is drawn. */
export function visiblePropsChanged(prev: unknown, next: unknown): boolean {
  return forEachVisiblePropChange(prev, next, () => true);
}

/**
 * Finds the DOM nodes a commit changed, topmost first. Stops at `limit` nodes.
 * Exported for tests; `createScreenCapture` is the runtime entry.
 */
export function findChangedHosts(
  root: Fiber,
  options: number | FindChangedHostsOptions = {},
): { found: Found[]; truncated: boolean } {
  const { limit = MAX_NODES_PER_COMMIT, descendUpdated = false, detectMoves = false } = typeof options === 'number' ? { limit: options } : options;
  const found: Found[] = [];
  let truncated = false;

  const push = (fiber: Fiber, kind: HostChangeKind, parent?: Fiber) => {
    if (found.length >= limit) { truncated = true; return; }
    const node = (fiber as HostFiber).stateNode;
    if (!isNode(node)) return;
    const removed = kind === 'removed' || kind === 'hidden';
    found.push(parent ? { node, fiber, removed, kind, parent } : { node, fiber, removed, kind });
  };

  // Topmost host nodes below a fiber (the fiber itself when it is a host), in tree order.
  const collectTop = (start: Fiber, kind: HostChangeKind, parent?: Fiber) => {
    const stack: Fiber[] = [start];
    while (stack.length) {
      const fiber = stack.pop()!;
      if (isHost(fiber.tag)) { push(fiber, kind, parent); continue; }
      const children: Fiber[] = [];
      for (let child = fiber.child; child; child = child.sibling) children.push(child);
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  };

  // React's move rule (reconcileChildrenArray): walking the new order, a
  // reused child whose old index is below the highest old index placed so
  // far is moved. Inserted children (no alternate) are found by the walk.
  const collectMoves = (first: Fiber) => {
    if (!first.sibling) return;
    let lastPlaced = 0;
    for (let child: Fiber | null = first; child; child = child.sibling) {
      const old = child.alternate?.index;
      if (typeof old !== 'number') continue;
      // eslint-disable-next-line no-bitwise
      if (old < lastPlaced && (child.flags & Placement) === 0) collectTop(child, 'moved');
      else lastPlaced = Math.max(lastPlaced, old);
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
      if (!hiddenMount) collectTop(fiber, 'inserted');
      continue;
    }
    // eslint-disable-next-line no-bitwise -- React fiber flags are bitmasks
    if (((fiber.flags | fiber.subtreeFlags) & MUTATION_MASK) === 0) continue;

    // eslint-disable-next-line no-bitwise
    if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions) {
      for (const deleted of fiber.deletions) collectTop(deleted, 'removed', fiber);
    }
    // eslint-disable-next-line no-bitwise
    if ((fiber.flags & Placement) !== 0) {
      collectTop(fiber, 'moved');
      continue;
    }
    // eslint-disable-next-line no-bitwise
    if (fiber.tag === OFFSCREEN && (fiber.flags & Visibility) !== 0) {
      const hidden = !!(fiber.memoizedState as unknown);
      for (let child = fiber.child; child; child = child.sibling) collectTop(child, hidden ? 'hidden' : 'shown');
      continue;
    }
    // eslint-disable-next-line no-bitwise
    if (isHost(fiber.tag) && (fiber.flags & Update) !== 0 && fiber.alternate) {
      const changed = fiber.tag === HOST_TEXT
        ? fiber.memoizedProps !== fiber.alternate.memoizedProps
        : visiblePropsChanged(fiber.alternate.memoizedProps, fiber.memoizedProps);
      if (changed) {
        push(fiber, 'updated');
        // The element's box covers its children; nothing below adds area.
        if (!descendUpdated) continue;
      }
    }
    if (fiber.child) {
      if (detectMoves) collectMoves(fiber.child);
      stack.push(fiber.child);
    }
  }
  return { found, truncated };
}

function regionLabel(node: Node, fiber: Fiber, nameOf: (fiber: Fiber) => string): string {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const testId = element?.closest?.('[data-testid]')?.getAttribute('data-testid');
  if (testId) return testId;
  for (let f: Fiber | null = fiber.return; f; f = f.return) {
    if (isComponentFiber(f.tag)) return nameOf(f);
  }
  return element?.tagName?.toLowerCase() || 'unknown';
}

const round = (n: number) => Math.round(n);

const MAX_DESCENT = 32;

function isEmptyBox(box: Rect | null): boolean {
  return !box || box.right - box.left <= 0 || box.bottom - box.top <= 0;
}

function unionRect(boxes: Rect[]): Rect {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/**
 * Boxes that show a node's content. Usually the node's own box. Portal and
 * layer wrappers are often empty (0 x 0, or full width and 0 high) while
 * their fixed or absolute children cover the screen, so an empty box is
 * replaced by the nearest non-empty descendant boxes, up to `MAX_DESCENT`
 * elements.
 */
export function measureVisible(node: Node, geometry: ScreenGeometry): Array<{ node: Node; box: Rect }> {
  const own = geometry.rect(node);
  if (!isEmptyBox(own)) return [{ node, box: own! }];
  const out: Array<{ node: Node; box: Rect }> = [];
  const queue: Element[] = node.nodeType === 1 ? Array.from((node as Element).children) : [];
  let visited = 0;
  while (queue.length && visited < MAX_DESCENT) {
    const element = queue.shift()!;
    visited++;
    const box = geometry.rect(element);
    if (!isEmptyBox(box)) out.push({ node: element, box: box! });
    else queue.push(...Array.from(element.children));
  }
  return out;
}

/** `nameOf` names a region by its component; the detector records them for renaming. */
export function createScreenCapture(
  options: ScreenCaptureOptions = {},
  geometry: ScreenGeometry = domScreenGeometry,
  nameOf: (fiber: Fiber) => string = getComponentName,
) {
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
      let boxes: Array<{ node: Node; box: Rect }>;
      if (isRemoved) {
        const last = lastRects.get(node);
        boxes = last ? [{ node, box: last }] : [];
      } else {
        boxes = measureVisible(node, geometry);
        // Remember the union, so a later removal of this node covers it all.
        if (boxes.length) lastRects.set(node, unionRect(boxes.map((b) => b.box)));
      }
      for (const { node: measured, box } of boxes) {
        const clipped = intersectRect(box, viewport);
        if (!clipped) continue;
        const area = rectArea(clipped);
        (isRemoved ? removed : changed).add(clipped);
        rects.push({ rect: clipped, area });
        const label = regionLabel(measured, fiber, nameOf);
        regions.set(label, (regions.get(label) || 0) + area);
      }
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
