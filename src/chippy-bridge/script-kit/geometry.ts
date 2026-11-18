/**
 * Geometry for fibers: the DOM a fiber renders and the screen area it covers.
 *
 * A fiber's footprint is the union of its outermost DOM nodes' boxes, the same
 * rule `component-area` uses. Portal children count, because their DOM belongs
 * to the component even though it is mounted elsewhere. Descendants positioned
 * outside their parent's box are not included.
 */

import { createAreaGrid, intersectRect, rectArea, type Rect } from '../component-area/area-grid';
import { domGeometry, type AreaGeometry } from '../component-area/measure';
import { TAG, fiberTag, isHostFiber, type FiberRef, type LiveFiber, type RefRegistry } from './fiber-ref';

export interface AreaResult {
  /** Union of the boxes, in square CSS pixels, including what is scrolled out of view. */
  area: number;
  /** The part of `area` inside the viewport. */
  visibleArea: number;
  /** Bounding box of all boxes, in viewport coordinates, or null when nothing is laid out. */
  box: Rect | null;
  /** Outermost DOM nodes measured. */
  nodes: number;
  /** Grid cell edge in CSS pixels; areas are exact to about one cell. */
  cellSize: number;
}

export type AreaTarget = FiberRef | null | undefined | Array<FiberRef | null | undefined>;

export function createGeometry(deps: { registry: RefRegistry; geometry?: AreaGeometry }) {
  const { registry } = deps;
  const geometry = deps.geometry || domGeometry;

  /** Outermost DOM elements and text nodes rendered by the fiber. */
  function hostNodes(ref: FiberRef): Node[] {
    const root = registry.fiberOf(ref);
    const out: Node[] = [];
    const stack: LiveFiber[] = [root];
    while (stack.length) {
      const fiber = stack.pop()!;
      // Push the sibling before the child so nodes come out in document order.
      if (fiber !== root && fiber.sibling) stack.push(fiber.sibling);
      const node = fiber.stateNode as Node | null;
      if ((isHostFiber(fiber) || fiberTag(fiber) === TAG.hostText) && node && typeof node.nodeType === 'number') {
        out.push(node);
      } else if (fiber.child) {
        stack.push(fiber.child);
      }
    }
    return out;
  }

  function nodeRects(node: Node): Rect[] {
    const rects = node.nodeType === 3 ? geometry.textRects(node as Text) : [geometry.rect(node as Element)];
    return rects.filter((r) => rectArea(r) > 0);
  }

  /** Viewport-relative boxes of the fiber's outermost DOM nodes; empty when hidden or not laid out. */
  function rects(ref: FiberRef): Rect[] {
    return hostNodes(ref).flatMap(nodeRects).map(roundRect);
  }

  /** Bounding box of the fiber's laid-out DOM in viewport coordinates, or null. */
  function bounds(target: AreaTarget): Rect | null {
    const refs = (Array.isArray(target) ? target : [target]).filter((r): r is FiberRef => !!r);
    const boxes = refs.flatMap((ref) => hostNodes(ref).flatMap(nodeRects));
    return boxes.length ? roundRect(unionBox(boxes)) : null;
  }

  function area(target: AreaTarget): AreaResult {
    const refs = (Array.isArray(target) ? target : [target]).filter((r): r is FiberRef => !!r);
    const boxes: Rect[] = [];
    let nodes = 0;
    for (const ref of refs) {
      for (const node of hostNodes(ref)) {
        nodes += 1;
        boxes.push(...nodeRects(node));
      }
    }
    if (boxes.length === 0) return { area: 0, visibleArea: 0, box: null, nodes, cellSize: 1 };
    const box = unionBox(boxes);
    const whole = createAreaGrid(box);
    for (const r of boxes) whole.add(r);
    const viewport = intersectRect(box, geometry.viewport());
    let visibleArea = 0;
    if (viewport) {
      const visible = createAreaGrid(viewport);
      for (const r of boxes) visible.add(r);
      visibleArea = visible.area();
    }
    return {
      area: Math.round(whole.area()),
      visibleArea: Math.round(visibleArea),
      box: roundRect(box),
      nodes,
      cellSize: whole.cell,
    };
  }

  return { hostNodes, rects, bounds, area };
}

function unionBox(boxes: Rect[]): Rect {
  return boxes.reduce((acc, r) => ({
    left: Math.min(acc.left, r.left), top: Math.min(acc.top, r.top),
    right: Math.max(acc.right, r.right), bottom: Math.max(acc.bottom, r.bottom),
  }));
}

function roundRect(r: Rect): Rect {
  return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
}
