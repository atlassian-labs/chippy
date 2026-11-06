/**
 * Owner-chain selection shared by probes, fiber inspection, and Avalanche.
 *
 * React development builds record the component that created each element in
 * `_debugOwner`; production builds omit the field. Chippy uses the best chain
 * available: the debug-owner chain when it yields components, otherwise the
 * rendered parent (`fiber.return`) chain. The returned `ownerStackKind` labels
 * which chain was used, so callers never present parents as owners.
 */

export type OwnerStackKind = 'owners' | 'parents';

export type OwnerChain<F> = {
  ownerStackKind: OwnerStackKind;
  fibers: F[];
};

type LinkedFiber = { _debugOwner?: unknown; return?: unknown };

function walk<F extends object>(
  fiber: F,
  next: (current: F) => F | null,
  include: (candidate: F) => boolean,
  limit: number,
): F[] {
  const fibers: F[] = [];
  let current = next(fiber);
  while (current && fibers.length < limit) {
    if (include(current)) fibers.push(current);
    current = next(current);
  }
  return fibers;
}

const debugOwnerOf = <F extends object>(fiber: F): F | null =>
  ((fiber as LinkedFiber)._debugOwner as F | null | undefined) || null;

const returnOf = <F extends object>(fiber: F): F | null =>
  ((fiber as LinkedFiber).return as F | null | undefined) || null;

/**
 * Collect up to `limit` owner fibers, falling back to parent fibers when the
 * debug-owner chain yields none. `include` receives the chain kind so callers
 * can filter the two chains differently.
 */
export function collectOwnerFibers<F extends object>(
  fiber: F | null | undefined,
  include: (candidate: F, kind: OwnerStackKind) => boolean,
  limit: number = Number.POSITIVE_INFINITY,
): OwnerChain<F> {
  if (!fiber) return { ownerStackKind: 'owners', fibers: [] };
  const owners = walk(fiber, debugOwnerOf, (candidate) => include(candidate, 'owners'), limit);
  if (owners.length > 0) return { ownerStackKind: 'owners', fibers: owners };
  const parents = walk(fiber, returnOf, (candidate) => include(candidate, 'parents'), limit);
  if (parents.length > 0) return { ownerStackKind: 'parents', fibers: parents };
  // Both chains are empty. Development fibers always carry `_debugOwner`
  // (null at the root), so its absence means the build has no owner data.
  return { ownerStackKind: '_debugOwner' in fiber ? 'owners' : 'parents', fibers: [] };
}

/**
 * True for fibers whose type is a component: a function or class, or a
 * memo/forwardRef/lazy wrapper object. Host elements (string types) and
 * text/root fibers are excluded.
 */
export function isComponentFiber(fiber: object): boolean {
  const t = (fiber as { type?: unknown }).type;
  return typeof t === 'function' ||
    (typeof t === 'object' && t !== null && Boolean((t as { $$typeof?: unknown }).$$typeof || (t as { render?: unknown }).render));
}
