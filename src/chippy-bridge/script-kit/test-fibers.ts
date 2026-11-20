/**
 * Fake committed fiber trees for script-kit unit tests. Host fibers own real
 * jsdom elements, appended to their nearest host ancestor, and carry their
 * layout box in `data-rect="left,top,right,bottom"` for `fakeGeometry`.
 */

import type { AreaGeometry } from '../component-area/measure';
import type { Rect } from '../component-area/area-grid';
import type { LiveFiber } from './fiber-ref';

export interface Spec {
  tag: number;
  type?: unknown;
  key?: string;
  props?: Record<string, unknown>;
  state?: unknown;
  rect?: [number, number, number, number];
  testId?: string;
  text?: string;
  children?: Spec[];
}

export function comp(name: string, children: Spec[] = [], extra: Partial<Spec> = {}): Spec {
  const type = { [name]: function () { return null; } }[name];
  return { tag: 0, type, children, ...extra };
}

export function cls(type: unknown, children: Spec[] = []): Spec {
  return { tag: 1, type, children };
}

export function div(rect: [number, number, number, number] | null, children: Spec[] = [], extra: Partial<Spec> = {}): Spec {
  return { tag: 5, type: 'div', rect: rect || undefined, children, ...extra };
}

export function suspense(children: Spec[], showingFallback = false): Spec {
  return { tag: 13, type: Symbol.for('react.suspense'), state: showingFallback ? { dehydrated: null } : null, children };
}

export function offscreen(hidden: boolean, children: Spec[]): Spec {
  return { tag: 22, state: hidden ? { cachePool: null } : null, children };
}

export interface FakeRoot {
  hostRoot: LiveFiber;
  fiberRoot: { current: LiveFiber };
  container: HTMLElement;
  /** Fiber whose `type` (or host type plus test id) matches. */
  byName(name: string): LiveFiber;
}

export function buildRoot(children: Spec[], doc: Document = document): FakeRoot {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const hostRoot: LiveFiber = { tag: 3, type: null, return: null, child: null, sibling: null } as LiveFiber;
  const fiberRoot = { current: hostRoot, containerInfo: container };
  // A HostRoot's stateNode is its FiberRoot, not a DOM element.
  (hostRoot as { stateNode?: unknown }).stateNode = fiberRoot;
  const all: LiveFiber[] = [];

  function make(spec: Spec, parent: LiveFiber, parentEl: Element): LiveFiber {
    const fiber: LiveFiber = {
      tag: spec.tag,
      type: spec.type,
      elementType: spec.type,
      key: spec.key ?? null,
      memoizedProps: spec.props || {},
      memoizedState: spec.state ?? null,
      return: parent,
      child: null,
      sibling: null,
      alternate: null,
    } as LiveFiber;
    all.push(fiber);
    let el = parentEl;
    if (spec.tag === 5) {
      const node = doc.createElement(String(spec.type));
      if (spec.rect) node.setAttribute('data-rect', spec.rect.join(','));
      if (spec.testId) node.setAttribute('data-testid', spec.testId);
      if (spec.text) node.textContent = spec.text;
      parentEl.appendChild(node);
      fiber.stateNode = node;
      (node as unknown as Record<string, unknown>).__reactFiber$test = fiber;
      el = node;
    }
    let prev: LiveFiber | null = null;
    for (const childSpec of spec.children || []) {
      const child = make(childSpec, fiber, el);
      if (prev) prev.sibling = child;
      else fiber.child = child;
      prev = child;
    }
    return fiber;
  }

  let prev: LiveFiber | null = null;
  for (const spec of children) {
    const child = make(spec, hostRoot, container);
    if (prev) prev.sibling = child;
    else hostRoot.child = child;
    prev = child;
  }

  return {
    hostRoot,
    fiberRoot,
    container,
    byName(name) {
      const found = all.find((f) => {
        const t = f.type as { name?: string } | string | undefined;
        if (typeof t === 'function' || (t && typeof t === 'object')) return (t as { name?: string }).name === name;
        return (f.stateNode as Element | undefined)?.getAttribute?.('data-testid') === name;
      });
      if (!found) throw new Error('no fake fiber named ' + name);
      return found;
    },
  };
}

/** Give a fiber an alternate that mirrors its links, as after a re-render. */
export function withAlternate(fiber: LiveFiber): LiveFiber {
  const alternate = { ...fiber, alternate: fiber } as LiveFiber;
  fiber.alternate = alternate;
  return alternate;
}

export function fakeGeometry(viewport: Rect = { left: 0, top: 0, right: 1000, bottom: 800 }): AreaGeometry {
  return {
    viewport: () => viewport,
    rect(el) {
      const raw = el.getAttribute('data-rect');
      if (!raw) return { left: 0, top: 0, right: 0, bottom: 0 };
      const [left, top, right, bottom] = raw.split(',').map(Number);
      return { left, top, right, bottom };
    },
    textRects: () => [],
    style: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' }),
  };
}
