/**
 * Names the React component that rendered a DOM node: the nearest component
 * fiber above the node's host fiber, plus the nearest `data-testid`. Used for
 * nodes that browser performance entries point at (layout-shift sources, the
 * LCP element, an event target), which can leave the DOM soon after.
 */

import { getComponentName, isComponentFiber, type Fiber } from './internals';

export interface NodeOwner {
  /** Tag name, with `#id` when the element has one. */
  element: string | null;
  /** Nearest `data-testid` on the element or an ancestor. */
  testId: string | null;
  /** Display name of the nearest component that rendered the element. */
  component: string | null;
}

const MAX_ANCESTORS = 200;

function elementOf(node: unknown): Element | null {
  if (typeof Element === 'undefined' || !node) return null;
  if (node instanceof Element) return node;
  const parent = (node as { parentElement?: unknown }).parentElement;
  return parent instanceof Element ? parent : null;
}

function hostFiberOf(element: Element): Fiber | null {
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_ANCESTORS; depth += 1) {
    const key = Object.getOwnPropertyNames(current).find((name) => name.startsWith('__reactFiber$'));
    if (key) return (current as unknown as Record<string, Fiber | undefined>)[key] ?? null;
    current = current.parentElement;
  }
  return null;
}

export function describeNodeOwner(node: unknown, nameOf: (fiber: Fiber) => string = getComponentName): NodeOwner | null {
  const element = elementOf(node);
  if (!element) return null;
  let fiber = hostFiberOf(element);
  for (let depth = 0; fiber && !isComponentFiber(fiber.tag) && depth < MAX_ANCESTORS; depth += 1) fiber = fiber.return ?? null;
  let component: string | null = null;
  try {
    component = fiber && isComponentFiber(fiber.tag) ? nameOf(fiber) : null;
  } catch {
    component = null;
  }
  return {
    element: element.tagName ? element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') : null,
    testId: element.closest?.('[data-testid]')?.getAttribute('data-testid') ?? null,
    component,
  };
}
