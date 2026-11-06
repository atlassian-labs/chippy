/**
 * Pure fiber-walk helpers extracted from layout-lab.js.
 * No DOM writes, no side effects — read-only introspection of React fiber trees.
 */

import {
  getFiberSource as readFiberSource,
  resolveFiberSource as resolveSourceLocation,
} from '../chippy-bridge/fiber-source';
import { collectOwnerFibers, type OwnerChain, type OwnerStackKind } from '../chippy-bridge/owner-chain';

/**
 * Minimal duck-typed Fiber shape.
 * Only fields used by these helpers are typed; rest may exist but are not read.
 */
export type Fiber = {
  type?: unknown;
  elementType?: unknown;
  key?: string | null;
  memoizedState?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  stateNode?: Element | null;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  _debugOwner?: Fiber | null;
  _debugSource?: SourceLocation | null;
  _debugStack?: unknown;
};

export type SourceLocation = {
  fileName?: string | null;
  lineNumber?: number | null;
  columnNumber?: number | null;
};

export type DescribedSource = {
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
};

export type HookSummary = {
  hookCount: number;
  hookCountTruncated: boolean;
  hookCountMax: number;
};

export type OwnerEntry = {
  name: string | null;
  key: string | null;
  props: string[];
} & HookSummary & {
  source: DescribedSource | null;
};

export type FiberTarget = {
  domTag: string | null;
  domText: string;
  fiberType: string | null;
  source: DescribedSource | null;
};

export type ComponentDescription = {
  name: string | null;
  key: string | null;
  props: Record<string, unknown>;
  source: DescribedSource | null;
  stateNode: string | null;
  /** Which chain `owners` holds: React's debug owners, or the parent fallback. */
  ownerStackKind: OwnerStackKind;
  owners: OwnerEntry[];
  parents: OwnerEntry[];
} & HookSummary;

/**
 * Find the React fiber key in a DOM node's own properties.
 * Returns the property name (e.g. '__reactFiber$abc123') or null.
 */
export function getFiberKey(node: Node | Element | null | undefined): string | null {
  if (!node) return null;
  const keys = Object.getOwnPropertyNames(node as object);
  const key = keys.find((k) => k.startsWith('__reactFiber$'));
  return key || null;
}

/**
 * Get the React fiber attached to a DOM node, or null if not a React host node.
 */
export function getFiber(node: Node | Element | null | undefined): Fiber | null {
  if (!node) return null;
  const key = getFiberKey(node);
  // React stores the fiber as an expando property on the host node.
  return key ? ((node as unknown as Record<string, unknown>)[key] as Fiber | null) : null;
}

/**
 * Extract display name from a React type (class, function, or string).
 * Returns displayName > name > null for functions; 'string' for primitives.
 */
export function getDisplayName(type: unknown): string | null {
  if (!type) return null;
  if (typeof type === 'string') return type;
  const obj = type as { displayName?: unknown; name?: unknown };
  return (obj.displayName as string) || (obj.name as string) || null;
}

/**
 * True if fiber is a user-defined component (not a DOM string, not a hook-internal wrapper).
 */
export function isUserComponent(fiber: Fiber | null | undefined): boolean {
  if (!fiber) return false;
  const name = getDisplayName(fiber.type);
  if (!name || typeof fiber.type === 'string') return false;
  if (['hookified', 'unboundStoryFn', 'Anonymous'].includes(name)) return false;
  return true;
}

/**
 * Walk DOM parents to find the nearest fiber-attached element.
 */
export function getNearestFiber(domNode: Node | Element | null | undefined): Fiber | null {
  let current = domNode as Element | null;
  while (current) {
    const fiber = getFiber(current);
    if (fiber) return fiber;
    current = (current as Element).parentElement;
  }
  return null;
}

/**
 * Walk DOM parents, then walk fiber return chain, to find the nearest user component.
 */
export function getNearestComponent(domNode: Node | Element | null | undefined): Fiber | null {
  let fiber = getNearestFiber(domNode);
  while (fiber) {
    if (isUserComponent(fiber)) return fiber;
    fiber = fiber.return || null;
  }
  return null;
}

/**
 * Count hooks in fiber.memoizedState linked list; detect cycle.
 */
export function getHookSummary(fiber: Fiber | null | undefined): HookSummary {
  const MAX_HOOKS = 500;
  const seen = new Set<unknown>();
  let hookNode = fiber?.memoizedState || null;
  let hookCount = 0;
  let hookCountTruncated = false;

  while (hookNode) {
    if (seen.has(hookNode)) break;
    if (hookCount >= MAX_HOOKS) {
      hookCountTruncated = true;
      break;
    }
    seen.add(hookNode);
    hookCount += 1;
    hookNode = (hookNode as { next?: unknown }).next || null;
  }

  return { hookCount, hookCountTruncated, hookCountMax: MAX_HOOKS };
}

function describeOwnerEntry(fiber: Fiber): OwnerEntry {
  return {
    name: getDisplayName(fiber.type),
    key: fiber.key || null,
    props: fiber.memoizedProps ? Object.keys(fiber.memoizedProps) : [],
    ...getHookSummary(fiber),
    source: describeFiberSource(fiber),
  };
}

/**
 * Best available owner fibers: the `_debugOwner` chain in development, or the
 * user-component parent chain when the build records no owners. See
 * `collectOwnerFibers` for the selection rule.
 */
export function getOwnerChainFibers(fiber: Fiber | null | undefined): OwnerChain<Fiber> {
  return collectOwnerFibers(fiber, isUserComponent);
}

/**
 * Best available owner chain with metadata; check `getOwnerChainFibers` or
 * `describeComponent().ownerStackKind` for which chain it came from.
 */
export function getOwnerChain(fiber: Fiber | null | undefined): OwnerEntry[] {
  return getOwnerChainFibers(fiber).fibers.map(describeOwnerEntry);
}

/**
 * Best available owner chain as raw fiber nodes (for navigation).
 */
export function getOwnerFibers(fiber: Fiber | null | undefined): Fiber[] {
  return getOwnerChainFibers(fiber).fibers;
}

/**
 * Recursively walk fiber.child/sibling to find the first host DOM element rendered by this subtree.
 */
export function getFiberDomNode(fiber: Fiber | null | undefined): Element | null {
  if (!fiber) return null;
  // Host fiber — stateNode is a DOM element
  if (fiber.stateNode instanceof Element) return fiber.stateNode;
  // Walk children
  let child = fiber.child || null;
  while (child) {
    const found = getFiberDomNode(child);
    if (found) return found;
    child = child.sibling || null;
  }
  return null;
}

/**
 * Walk fiber.return chain; collect all user component parents with metadata.
 */
export function getReturnComponentChain(fiber: Fiber | null | undefined): OwnerEntry[] {
  const chain: OwnerEntry[] = [];
  let current = fiber?.return || null;
  while (current) {
    if (isUserComponent(current)) chain.push(describeOwnerEntry(current));
    current = current.return || null;
  }
  return chain;
}

/**
 * Walk fiber.return chain; return raw fiber nodes (for navigation).
 */
export function getReturnComponentFibers(fiber: Fiber | null | undefined): Fiber[] {
  const fibers: Fiber[] = [];
  let current = fiber?.return || null;
  while (current) {
    if (isUserComponent(current)) fibers.push(current);
    current = current.return || null;
  }
  return fibers;
}

/**
 * Normalize source location object to canonical shape.
 */
export function describeSource(source: SourceLocation | null | undefined): DescribedSource | null {
  if (!source) return null;
  return {
    fileName: source.fileName || null,
    lineNumber: source.lineNumber || null,
    columnNumber: source.columnNumber || null,
  };
}

/**
 * Read a fiber source across React versions.
 *
 * React <=18 exposes `_debugSource`. React 19 exposes `_debugStack`; its first
 * non-vendor frame is returned synchronously and may later be upgraded from the
 * bundle position to the original source position by `resolveFiberSource`.
 */
export function describeFiberSource(fiber: Fiber | null | undefined): DescribedSource | null {
  return describeSource(readFiberSource(fiber));
}

export async function resolveFiberSource(fiber: Fiber | null | undefined): Promise<DescribedSource | null> {
  return describeSource(await resolveSourceLocation(fiber));
}

/**
 * Describe a fiber + DOM node pair; used for inspection UI.
 */
export function describeFiberTarget(fiber: Fiber | null | undefined, domNode: Element | null | undefined): FiberTarget | null {
  if (!fiber && !domNode) return null;
  return {
    domTag: domNode?.tagName?.toLowerCase() || null,
    domText: domNode?.textContent?.trim().slice(0, 60) || '',
    fiberType: getDisplayName(fiber?.type) || getDisplayName(fiber?.elementType) || null,
    source: describeFiberSource(fiber),
  };
}

/**
 * Full component description: name, props, hook summary, source, owners, parents.
 */
export function describeComponent(fiber: Fiber | null | undefined): ComponentDescription | null {
  if (!fiber) return null;
  const ownerChain = getOwnerChainFibers(fiber);
  return {
    name: getDisplayName(fiber.type),
    key: fiber.key || null,
    props: fiber.memoizedProps || {},
    ...getHookSummary(fiber),
    source: describeFiberSource(fiber),
    stateNode: fiber.stateNode instanceof Element ? fiber.stateNode.tagName.toLowerCase() : null,
    ownerStackKind: ownerChain.ownerStackKind,
    owners: ownerChain.fibers.map(describeOwnerEntry),
    parents: getReturnComponentChain(fiber),
  };
}
