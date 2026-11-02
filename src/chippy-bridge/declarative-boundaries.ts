/**
 * Converts React's complete fiber trees into boundary-only evidence for the
 * bridge. Ordinary components are omitted from the page-wide view, but their
 * containment is retained by attaching each boundary to the nearest surviving
 * boundary ancestor. This keeps the output useful for partitioning a page
 * without making agents walk thousands of unrelated fibers themselves.
 */

import {
  MAX_BOUNDARY_FIBERS,
  describeErrorBoundary,
  describeSuspenseBoundary,
} from '../layout-lab/fiber-boundaries';
import { describeFiberSource, type Fiber } from '../layout-lab/fiber-walk';

export type DeclarativeBoundaryKind = 'error' | 'suspense';

export type DeclarativeBoundaryStatus =
  | 'showing-content'
  | 'showing-fallback'
  | 'unknown';

export type DeclarativeBoundarySource = {
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
};

export type DeclarativeBoundaryDom = {
  tag: string | null;
  testId: string | null;
  text: string | null;
};

export type DeclarativeBoundarySummary = {
  fiberId: string;
  kind: DeclarativeBoundaryKind;
  componentName: string;
  detectedBy: 'lifecycle' | 'name' | 'fiber-tag' | 'display-name';
  status: DeclarativeBoundaryStatus;
  source: DeclarativeBoundarySource | null;
  dom: DeclarativeBoundaryDom | null;
};

export type DeclarativeBoundaryChainItem = DeclarativeBoundarySummary & {
  /** Fiber hops from the inspected fiber; zero means the target is a boundary. */
  distance: number;
};

export type DeclarativeBoundaryTreeNode = DeclarativeBoundarySummary & {
  /** Fiber depth from the discovered React root. */
  fiberDepth: number;
  /** Fiber hops from the containing declarative boundary, or null at the forest root. */
  distanceFromParent: number | null;
  children: DeclarativeBoundaryTreeNode[];
};

export type DeclarativeBoundaryDeps = {
  rememberFiber: (fiber: Fiber) => string | number;
  getFiberDomNode: (fiber: Fiber) => Element | null;
  getRootFibers: () => Fiber[];
};

type FiberWithCurrent = Fiber & {
  current?: Fiber | null;
  alternate?: Fiber | null;
  tag?: number;
};

function alreadyVisited(fiber: Fiber, seen: Set<Fiber>): boolean {
  // React keeps current and work-in-progress alternates as separate objects.
  // Treating them as different roots would duplicate boundaries and inflate
  // scanned counts when both sides are reachable during a transition.
  const alternate = (fiber as FiberWithCurrent).alternate || null;
  return seen.has(fiber) || !!(alternate && seen.has(alternate));
}

function markVisited(fiber: Fiber, seen: Set<Fiber>): void {
  seen.add(fiber);
  const alternate = (fiber as FiberWithCurrent).alternate || null;
  if (alternate) seen.add(alternate);
}

function normalizeSource(fiber: Fiber): DeclarativeBoundarySource | null {
  return describeFiberSource(fiber);
}

function summarizeDom(element: Element | null): DeclarativeBoundaryDom | null {
  if (!element) return null;
  return {
    tag: element.tagName?.toLowerCase() || null,
    testId: element.getAttribute?.('data-testid') || null,
    text: element.textContent ? String(element.textContent).trim().slice(0, 120) : null,
  };
}

function suspenseDetectedBy(fiber: Fiber): 'fiber-tag' | 'display-name' {
  return (fiber as FiberWithCurrent).tag === 13 ? 'fiber-tag' : 'display-name';
}

function describeBoundary(
  fiber: Fiber,
  deps: Pick<DeclarativeBoundaryDeps, 'rememberFiber' | 'getFiberDomNode'>,
): DeclarativeBoundarySummary | null {
  const error = describeErrorBoundary(fiber);
  if (error) {
    return {
      fiberId: String(deps.rememberFiber(fiber)),
      kind: 'error',
      componentName: error.componentName,
      detectedBy: error.detectedBy,
      status: 'unknown',
      source: normalizeSource(fiber),
      dom: summarizeDom(deps.getFiberDomNode(fiber)),
    };
  }

  const suspense = describeSuspenseBoundary(fiber);
  if (!suspense) return null;
  return {
    fiberId: String(deps.rememberFiber(fiber)),
    kind: 'suspense',
    componentName: suspense.componentName,
    detectedBy: suspenseDetectedBy(fiber),
    status: fiber.memoizedState == null ? 'showing-content' : 'showing-fallback',
    source: normalizeSource(fiber),
    dom: summarizeDom(deps.getFiberDomNode(fiber)),
  };
}

function normalizeLimit(value: number | string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5000, Math.floor(parsed))) : fallback;
}

/**
 * Return every declarative boundary on the rendered parent path, not only the
 * nearest error + Suspense pair. Items are ordered from the target outward.
 */
export function inspectDeclarativeBoundaryChain(
  fiber: Fiber | null | undefined,
  max: number | string | null | undefined,
  deps: Pick<DeclarativeBoundaryDeps, 'rememberFiber' | 'getFiberDomNode'>,
): {
  ok: true;
  count: number;
  scannedFibers: number;
  truncated: boolean;
  items: DeclarativeBoundaryChainItem[];
} | { ok: false; error: string } {
  if (!fiber) return { ok: false, error: 'No fiber available' };

  const limit = normalizeLimit(max, 100);
  const items: DeclarativeBoundaryChainItem[] = [];
  const seen = new Set<Fiber>();
  let current: Fiber | null = fiber;
  let distance = 0;
  let omitted = false;

  while (current && distance < MAX_BOUNDARY_FIBERS && !seen.has(current)) {
    seen.add(current);
    const boundary = describeBoundary(current, deps);
    if (boundary) {
      if (items.length < limit) items.push({ ...boundary, distance });
      else omitted = true;
    }
    current = current.return || null;
    distance += 1;
  }

  return {
    ok: true,
    count: items.length,
    scannedFibers: seen.size,
    truncated: omitted || !!current,
    items,
  };
}

/**
 * Traverse all current React roots and prune the component tree down to only
 * declarative boundaries. Nesting between surviving nodes preserves rendered
 * containment even when many ordinary components were removed in between.
 */
export function inspectPageDeclarativeBoundaries(
  max: number | string | null | undefined,
  deps: DeclarativeBoundaryDeps,
): {
  ok: true;
  count: number;
  scannedFibers: number;
  rootCount: number;
  rootsWithBoundaries: number;
  truncated: boolean;
  items: DeclarativeBoundaryTreeNode[];
} {
  const limit = normalizeLimit(max, 1000);
  const rawRoots = deps.getRootFibers();
  const items: DeclarativeBoundaryTreeNode[] = [];
  const seen = new Set<Fiber>();
  let count = 0;
  let scannedFibers = 0;
  let rootsWithBoundaries = 0;
  let truncated = false;

  // Walk roots independently: multi-root pages (portals, Storybook manager +
  // preview, or embedded widgets) must not let one root's limit or ancestry
  // hide boundaries belonging to another root.
  for (const rawRoot of rawRoots) {
    if (count >= limit) {
      truncated = true;
      break;
    }
    const root = (rawRoot as FiberWithCurrent)?.current || rawRoot;
    if (!root || alreadyVisited(root, seen)) continue;

    const rootItems: DeclarativeBoundaryTreeNode[] = [];
    const stack: Array<{
      fiber: Fiber;
      fiberDepth: number;
      parentBoundary: DeclarativeBoundaryTreeNode | null;
    }> = [{ fiber: root, fiberDepth: 0, parentBoundary: null }];

    while (stack.length > 0) {
      if (count >= limit) {
        truncated = true;
        break;
      }
      const frame = stack.pop()!;
      const current = frame.fiber;
      if (alreadyVisited(current, seen)) continue;
      markVisited(current, seen);
      scannedFibers += 1;

      let nextParentBoundary = frame.parentBoundary;
      const summary = describeBoundary(current, deps);
      if (summary) {
        const node: DeclarativeBoundaryTreeNode = {
          ...summary,
          fiberDepth: frame.fiberDepth,
          distanceFromParent: frame.parentBoundary
            ? frame.fiberDepth - frame.parentBoundary.fiberDepth
            : null,
          children: [],
        };
        if (frame.parentBoundary) frame.parentBoundary.children.push(node);
        else rootItems.push(node);
        nextParentBoundary = node;
        count += 1;
      }

      if (current.sibling) {
        stack.push({
          fiber: current.sibling,
          fiberDepth: frame.fiberDepth,
          parentBoundary: frame.parentBoundary,
        });
      }
      if (current.child) {
        stack.push({
          fiber: current.child,
          fiberDepth: frame.fiberDepth + 1,
          parentBoundary: nextParentBoundary,
        });
      }
    }

    if (rootItems.length > 0) {
      rootsWithBoundaries += 1;
      items.push(...rootItems);
    }
  }

  return {
    ok: true,
    count,
    scannedFibers,
    rootCount: rawRoots.length,
    rootsWithBoundaries,
    truncated,
    items,
  };
}
