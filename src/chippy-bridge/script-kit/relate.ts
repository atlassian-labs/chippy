/**
 * Relations between fibers: the rendered parent path (`fiber.return`), the
 * boundaries that catch a fiber's throws, its descendant components, and its
 * debug-build owners. Every relation excludes the fiber itself.
 */

import { getOwnerChainFibers, type Fiber } from '../../layout-lab/fiber-walk';
import { MAX_BOUNDARY_FIBERS } from '../../layout-lab/fiber-boundaries';
import type { FiberKind, FiberRef, LiveFiber, RefRegistry } from './fiber-ref';
import type { Ledger } from './ledger';
import type { FindQuery } from './select';

export type Until = FiberRef | null | undefined | ((ref: FiberRef) => boolean);

export interface ParentsOptions {
  /** Stop at this fiber (excluded unless `inclusive`), or when the predicate holds. */
  until?: Until;
  inclusive?: boolean;
  /** Default true: only components and boundaries. False returns every fiber. */
  components?: boolean;
  max?: number;
}

export interface BoundariesOptions {
  kinds?: Array<'suspense' | 'error'>;
}

const SHOWN_IN_PARENTS = new Set<FiberKind>(['component', 'error', 'suspense']);

export function createRelate(deps: {
  registry: RefRegistry;
  ledger: Ledger;
  find: (query: FindQuery) => FiberRef[];
}) {
  const { registry, ledger } = deps;

  function stopsAt(until: Until, ref: FiberRef): boolean {
    if (!until) return false;
    return typeof until === 'function' ? !!until(ref) : until === ref;
  }

  function parents(ref: FiberRef, options: ParentsOptions = {}): FiberRef[] {
    const onlyComponents = options.components !== false;
    const max = Math.max(1, Math.floor(options.max ?? MAX_BOUNDARY_FIBERS));
    const out: FiberRef[] = [];
    let node: LiveFiber | null = registry.fiberOf(ref).return || null;
    let steps = 0;
    while (node) {
      if (++steps > MAX_BOUNDARY_FIBERS * 5) {
        ledger.add('parents', 'truncated', 'parent walk stopped at the climb ceiling');
        break;
      }
      const parent = registry.ref(node);
      const stop = stopsAt(options.until, parent);
      if (stop && !options.inclusive) break;
      if (!onlyComponents || SHOWN_IN_PARENTS.has(parent.kind)) {
        out.push(parent);
        if (out.length >= max && !stop) {
          ledger.add('parents', 'truncated', `stopped at max ${max} parents`);
          break;
        }
      }
      if (stop) break;
      node = node.return || null;
    }
    if (options.until && typeof options.until !== 'function' && !node) {
      ledger.add('parents', 'gap', 'the until fiber is not an ancestor; the walk reached the root');
    }
    return out;
  }

  /** Boundaries that contain the fiber, nearest first. */
  function boundaries(ref: FiberRef, options: BoundariesOptions = {}): FiberRef[] {
    const kinds = options.kinds || ['suspense', 'error'];
    return parents(ref, { components: true, max: MAX_BOUNDARY_FIBERS * 5 })
      .filter((parent) => (kinds as string[]).includes(parent.kind));
  }

  function nearest(ref: FiberRef, kind: 'suspense' | 'error'): FiberRef | null {
    return boundaries(ref, { kinds: [kind] })[0] || null;
  }

  /** Descendant components (error boundaries included), outermost first. */
  function components(ref: FiberRef, query: Omit<FindQuery, 'within'> = {}): FiberRef[] {
    return deps.find({ kind: 'component', ...query, within: ref });
  }

  /** Fiber hops from `from` up to its ancestor `to`, or null when `to` is not an ancestor. */
  function distance(from: FiberRef, to: FiberRef): number | null {
    if (from === to) return 0;
    let node: LiveFiber | null = registry.fiberOf(from).return || null;
    let hops = 1;
    while (node && hops < MAX_BOUNDARY_FIBERS * 5) {
      if (registry.ref(node) === to) return hops;
      node = node.return || null;
      hops += 1;
    }
    return null;
  }

  function isAncestor(ancestor: FiberRef, of: FiberRef): boolean {
    return ancestor !== of && distance(of, ancestor) !== null;
  }

  /** Debug-build `_debugOwner` chain; production builds fall back to component parents. */
  function owners(ref: FiberRef): FiberRef[] {
    const chain = getOwnerChainFibers(registry.fiberOf(ref) as Fiber);
    if (chain.ownerStackKind === 'parents') ledger.add('owners', 'confidence', 'no _debugOwner on this build; owners are component parents');
    return chain.fibers.map((fiber) => registry.ref(fiber as LiveFiber));
  }

  return { parents, boundaries, nearest, components, distance, isAncestor, owners };
}
