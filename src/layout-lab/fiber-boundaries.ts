/**
 * Fiber-native declarative boundaries.
 *
 * Error boundaries and Suspense are React primitives — they exist on every
 * React page. This module detects them generically from the fiber tree,
 * independent of any product. App-specific enrichment (ownership markers,
 * error-boundary props) is layered on top by context providers registered
 * with ./marker-context.
 *
 * "Distance" is the signal: how many fiber hops above the probed fiber the
 * boundary sits. Together, the nearest error + suspense boundaries define the
 * collateral scope around a probe.
 */
import { type Fiber, getDisplayName } from './fiber-walk';

export type ErrorBoundaryInfo = {
  componentName: string;
  /** How the boundary was identified — lifecycle proof vs. name heuristic. */
  detectedBy: 'lifecycle' | 'name';
};

export type SuspenseBoundaryInfo = {
  componentName: string;
};

/** A boundary plus its fiber-hop distance from the probed fiber. */
export type BoundaryRef<T> = T & { distance: number };

export type FiberBoundaries = {
  error: BoundaryRef<ErrorBoundaryInfo> | null;
  suspense: BoundaryRef<SuspenseBoundaryInfo> | null;
};

// Ancestry walks in Jira can be deep: the nearest Suspense boundary may sit
// ~170+ return-hops above a leaf. Callers early-exit once all wanted boundaries
// are found, so this ceiling only bounds pathological / cyclic trees.
export const MAX_BOUNDARY_FIBERS = 400;

// React SuspenseComponent fiber tag.
const SUSPENSE_TAG = 13;
// React ClassComponent fiber tag (error boundaries are class components).
const CLASS_COMPONENT_TAG = 1;

function fiberTag(fiber: Fiber): number | undefined {
  return (fiber as { tag?: number }).tag;
}

/**
 * Generic error-boundary detection. An error boundary is a class component that
 * implements getDerivedStateFromError and/or componentDidCatch. That lifecycle
 * check is the React-native definition and works on any React app. As a
 * fallback for minified/edge builds where the constructor is not introspectable,
 * a display name ending in "ErrorBoundary" is accepted.
 */
export function describeErrorBoundary(fiber: Fiber): ErrorBoundaryInfo | null {
  const componentName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
  const type = fiber.type as
    | { getDerivedStateFromError?: unknown; prototype?: { componentDidCatch?: unknown } }
    | null
    | undefined;

  const hasLifecycle =
    !!type &&
    (typeof type.getDerivedStateFromError === 'function' ||
      typeof type.prototype?.componentDidCatch === 'function');

  if (hasLifecycle && (fiberTag(fiber) === CLASS_COMPONENT_TAG || fiberTag(fiber) === undefined)) {
    return { componentName: componentName || 'ErrorBoundary', detectedBy: 'lifecycle' };
  }

  // Name heuristic fallback (covers builds where the type is not introspectable).
  if (componentName && /ErrorBoundary$/.test(componentName)) {
    return { componentName, detectedBy: 'name' };
  }

  return null;
}

/**
 * Generic Suspense detection. React marks a Suspense fiber with tag 13; we also
 * accept a display name resolving to Suspense/SuspenseList for builds where the
 * tag is unavailable.
 */
export function describeSuspenseBoundary(fiber: Fiber): SuspenseBoundaryInfo | null {
  const displayName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
  const isSuspense =
    fiberTag(fiber) === SUSPENSE_TAG ||
    displayName === 'Suspense' ||
    displayName === 'SuspenseComponent' ||
    displayName === 'SuspenseList';
  if (!isSuspense) return null;
  return { componentName: displayName || 'Suspense' };
}

/**
 * Walk an ordered ancestry list and return the nearest error + suspense
 * boundaries with their distances. The list is expected to be ordered from the
 * probed fiber outward, so the index is the fiber-hop distance.
 */
export function collectFiberBoundaries(fibers: Fiber[]): FiberBoundaries {
  const boundaries: FiberBoundaries = { error: null, suspense: null };
  for (let distance = 0; distance < fibers.length; distance += 1) {
    const entry = fibers[distance];
    if (!boundaries.error) {
      const error = describeErrorBoundary(entry);
      if (error) boundaries.error = { ...error, distance };
    }
    if (!boundaries.suspense) {
      const suspense = describeSuspenseBoundary(entry);
      if (suspense) boundaries.suspense = { ...suspense, distance };
    }
    if (boundaries.error && boundaries.suspense) break;
  }
  return boundaries;
}
