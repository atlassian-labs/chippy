import { describe, expect, it, vi } from 'vitest';
import type { Fiber } from '../layout-lab/fiber-walk';
import {
  inspectDeclarativeBoundaryChain,
  inspectPageDeclarativeBoundaries,
} from './declarative-boundaries';

class OuterErrorBoundary {
  static getDerivedStateFromError() {
    return {};
  }
}

class InnerErrorBoundary {
  componentDidCatch() {}
}

function rememberByName(fiber: Fiber) {
  const type = fiber.type as { name?: string } | null | undefined;
  return `fiber:${type?.name || (fiber as { tag?: number }).tag || 'unknown'}`;
}

const noDom = () => null;

describe('declarative boundary inspection', () => {
  it('reports every boundary from a target all the way to the root', () => {
    const outer = { tag: 1, type: OuterErrorBoundary, return: null } as unknown as Fiber;
    const suspense = { tag: 13, memoizedState: null, return: outer } as unknown as Fiber;
    const inner = { tag: 1, type: InnerErrorBoundary, return: suspense } as unknown as Fiber;
    const leaf = { type: { name: 'Leaf' }, return: inner } as Fiber;

    const result = inspectDeclarativeBoundaryChain(leaf, undefined, {
      rememberFiber: rememberByName,
      getFiberDomNode: noDom,
    });

    expect(result).toMatchObject({ ok: true, count: 3, scannedFibers: 4, truncated: false });
    if (result.ok === false) throw new Error(result.error);
    expect(result.items.map((item) => ({
      kind: item.kind,
      name: item.componentName,
      distance: item.distance,
      status: item.status,
    }))).toEqual([
      { kind: 'error', name: 'InnerErrorBoundary', distance: 1, status: 'unknown' },
      { kind: 'suspense', name: 'Suspense', distance: 2, status: 'showing-content' },
      { kind: 'error', name: 'OuterErrorBoundary', distance: 3, status: 'unknown' },
    ]);
  });

  it('reports current Suspense fallback state without executing the component', () => {
    const suspense = { tag: 13, memoizedState: { dehydrated: null } } as unknown as Fiber;
    const result = inspectDeclarativeBoundaryChain(suspense, 10, {
      rememberFiber: rememberByName,
      getFiberDomNode: noDom,
    });
    if (result.ok === false) throw new Error(result.error);
    expect(result.items[0]).toMatchObject({
      kind: 'suspense',
      detectedBy: 'fiber-tag',
      status: 'showing-fallback',
      distance: 0,
    });
  });

  it('prunes a whole React page to a nested boundary-only forest', () => {
    const siblingBoundary = { tag: 13, memoizedState: {}, sibling: null } as unknown as Fiber;
    const deepBoundary = { tag: 1, type: InnerErrorBoundary, sibling: null } as unknown as Fiber;
    const middle = { type: { name: 'Middle' }, child: deepBoundary, sibling: siblingBoundary } as Fiber;
    const outer = { tag: 1, type: OuterErrorBoundary, child: middle, sibling: null } as unknown as Fiber;
    const root = { type: { name: 'Root' }, child: outer, sibling: null } as Fiber;

    const result = inspectPageDeclarativeBoundaries(undefined, {
      rememberFiber: rememberByName,
      getFiberDomNode: noDom,
      getRootFibers: () => [root],
    });

    expect(result).toMatchObject({
      ok: true,
      count: 3,
      rootCount: 1,
      rootsWithBoundaries: 1,
      truncated: false,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'error',
      componentName: 'OuterErrorBoundary',
      fiberDepth: 1,
      distanceFromParent: null,
    });
    expect(result.items[0].children.map((item) => ({
      kind: item.kind,
      name: item.componentName,
      distanceFromParent: item.distanceFromParent,
    }))).toEqual([
      { kind: 'error', name: 'InnerErrorBoundary', distanceFromParent: 2 },
      { kind: 'suspense', name: 'Suspense', distanceFromParent: 1 },
    ]);
  });

  it('deduplicates current/alternate roots that describe the same rendered tree', () => {
    const current = { tag: 13, sibling: null } as unknown as Fiber & { alternate?: Fiber };
    const alternate = { tag: 13, sibling: null, alternate: current } as unknown as Fiber;
    current.alternate = alternate;
    const rememberFiber = vi.fn(rememberByName);

    const result = inspectPageDeclarativeBoundaries(10, {
      rememberFiber,
      getFiberDomNode: noDom,
      getRootFibers: () => [current, alternate],
    });

    expect(result.count).toBe(1);
    expect(result.rootsWithBoundaries).toBe(1);
    expect(result.truncated).toBe(false);
    expect(rememberFiber).toHaveBeenCalledTimes(1);
  });

  it('marks a boundary cap as truncated', () => {
    const second = { tag: 13, sibling: null } as unknown as Fiber;
    const first = { tag: 13, child: second, sibling: null } as unknown as Fiber;
    const result = inspectPageDeclarativeBoundaries(1, {
      rememberFiber: rememberByName,
      getFiberDomNode: noDom,
      getRootFibers: () => [first],
    });
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(true);
  });
});
