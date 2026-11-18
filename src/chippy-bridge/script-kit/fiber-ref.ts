/**
 * Fiber references for page scripts.
 *
 * A script never holds a raw fiber. It holds a `FiberRef`: one canonical object
 * per current/alternate pair, so `===` compares components, and every read goes
 * through the current side of the pair. A ref serializes itself to
 * `{ fiberId, name, kind, source }`, and its `fiberId` is a remembered id that
 * the normal commands accept (`explain-component <fiberId>`).
 */

import { describeErrorBoundary, describeSuspenseBoundary } from '../../layout-lab/fiber-boundaries';
import { describeFiberSource, resolveFiberSource, type DescribedSource, type Fiber } from '../../layout-lab/fiber-walk';
import { readComponentName } from '../component-origin';
import type { Ledger } from './ledger';

export type FiberKind = 'suspense' | 'error' | 'component' | 'host' | 'text' | 'portal' | 'other';
export type BoundaryStatus = 'showing-content' | 'showing-fallback' | 'unknown';

export type LiveFiber = Fiber & {
  tag?: number;
  alternate?: LiveFiber | null;
  return?: LiveFiber | null;
  child?: LiveFiber | null;
  sibling?: LiveFiber | null;
  stateNode?: unknown;
};

export const TAG = {
  hostRoot: 3,
  hostPortal: 4,
  hostComponent: 5,
  hostText: 6,
  suspense: 13,
  offscreen: 22,
  legacyHidden: 23,
  hostHoistable: 26,
  hostSingleton: 27,
} as const;

const COMPOSITE_TAGS = new Set([0, 1, 2, 11, 14, 15]);
const HOST_TAGS = new Set<number>([TAG.hostComponent, TAG.hostHoistable, TAG.hostSingleton]);
const HIDDEN_TAGS = new Set<number>([TAG.offscreen, TAG.legacyHidden]);
const MAX_CLIMB = 2000;

export function fiberTag(fiber: LiveFiber | null | undefined): number {
  return typeof fiber?.tag === 'number' ? fiber.tag : -1;
}

export function isHostFiber(fiber: LiveFiber): boolean {
  return HOST_TAGS.has(fiberTag(fiber));
}

export function classifyFiber(fiber: LiveFiber): FiberKind {
  const tag = fiberTag(fiber);
  if (tag === TAG.suspense || describeSuspenseBoundary(fiber)) return 'suspense';
  if (COMPOSITE_TAGS.has(tag) || tag === -1) {
    if (describeErrorBoundary(fiber)) return 'error';
    if (tag !== -1) return 'component';
  }
  if (HOST_TAGS.has(tag)) return 'host';
  if (tag === TAG.hostText) return 'text';
  if (tag === TAG.hostPortal) return 'portal';
  return 'other';
}

export function fiberName(fiber: LiveFiber): string | null {
  const tag = fiberTag(fiber);
  if (HOST_TAGS.has(tag)) return typeof fiber.type === 'string' ? fiber.type : null;
  if (tag === TAG.suspense) return readComponentName(fiber.type) || 'Suspense';
  return readComponentName(fiber.type) || readComponentName(fiber.elementType);
}

/**
 * Pick the current side of a current/alternate pair. A fiber reached through a
 * DOM node or a `return` pointer can be the stale alternate; the side whose
 * HostRoot is its FiberRoot's `current` is the committed one.
 */
export function currentOf(fiber: LiveFiber): LiveFiber {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;
  let node: LiveFiber | null | undefined = fiber;
  let steps = 0;
  while (node && node.return && steps++ < MAX_CLIMB) node = node.return;
  if (node && fiberTag(node) === TAG.hostRoot) {
    const root = node.stateNode as { current?: LiveFiber } | null;
    if (root && root.current) return root.current === node ? fiber : alternate;
  }
  return fiber;
}

export interface FiberRefJson {
  fiberId: string;
  name: string | null;
  kind: FiberKind;
  source: DescribedSource | null;
}

export interface FiberRef {
  readonly id: string;
  readonly name: string | null;
  readonly kind: FiberKind;
  readonly tag: number;
  readonly key: string | null;
  readonly source: DescribedSource | null;
  /** Suspense content/fallback state; `unknown` for error boundaries; null otherwise. */
  readonly status: BoundaryStatus | null;
  /** True when an ancestor Offscreen is hidden, e.g. content behind a shown Suspense fallback. */
  readonly hidden: boolean;
  /** The current fiber. Reading it marks the run's result `raw`. */
  readonly raw: LiveFiber;
  resolveSource(): Promise<DescribedSource | null>;
  toJSON(): FiberRefJson;
  toString(): string;
}

export interface RefRegistry {
  ref(fiber: LiveFiber): FiberRef;
  refOrNull(fiber: LiveFiber | null | undefined): FiberRef | null;
  isRef(value: unknown): value is FiberRef;
  /** The current fiber behind a ref, without marking the run raw. */
  fiberOf(ref: FiberRef): LiveFiber;
}

/** Remembered ids survive across runs so a fiber keeps one id per page session. */
const rememberedIds = new WeakMap<object, string>();

export function createRefRegistry(deps: { rememberFiber: (fiber: Fiber) => string | number; ledger: Ledger }): RefRegistry {
  const refs = new WeakMap<object, FiberRef>();
  const fibers = new WeakMap<FiberRef, LiveFiber>();

  function rememberedId(fiber: LiveFiber): string {
    const known = rememberedIds.get(fiber) || (fiber.alternate ? rememberedIds.get(fiber.alternate) : undefined);
    if (known) return known;
    const id = String(deps.rememberFiber(fiber));
    rememberedIds.set(fiber, id);
    if (fiber.alternate) rememberedIds.set(fiber.alternate, id);
    return id;
  }

  function live(ref: FiberRef): LiveFiber {
    return currentOf(fibers.get(ref)!);
  }

  function ref(fiber: LiveFiber): FiberRef {
    const existing = refs.get(fiber) || (fiber.alternate ? refs.get(fiber.alternate) : undefined);
    if (existing) return existing;
    let kind: FiberKind | null = null;
    const made: FiberRef = {
      get id() { return rememberedId(live(made)); },
      get name() { return fiberName(live(made)); },
      get kind() { return kind || (kind = classifyFiber(live(made))); },
      get tag() { return fiberTag(live(made)); },
      get key() { const k = live(made).key; return k == null ? null : String(k); },
      get source() { return describeFiberSource(live(made)); },
      get status() {
        const k = made.kind;
        if (k === 'suspense') return live(made).memoizedState == null ? 'showing-content' : 'showing-fallback';
        return k === 'error' ? 'unknown' : null;
      },
      get hidden() { return isHidden(live(made)); },
      get raw() {
        deps.ledger.add('ref.raw', 'raw', 'the script read a raw fiber; results built from it bypass the kit guarantees');
        return live(made);
      },
      resolveSource() { return resolveFiberSource(live(made)); },
      toJSON() { return { fiberId: made.id, name: made.name, kind: made.kind, source: made.source }; },
      toString() { return `${made.name || made.kind} (${made.id})`; },
    };
    fibers.set(made, fiber);
    refs.set(fiber, made);
    if (fiber.alternate) refs.set(fiber.alternate, made);
    return made;
  }

  return {
    ref,
    refOrNull(fiber) { return fiber ? ref(fiber) : null; },
    isRef(value): value is FiberRef { return !!value && typeof value === 'object' && fibers.has(value as FiberRef); },
    fiberOf: live,
  };
}

function isHidden(fiber: LiveFiber): boolean {
  let node = fiber.return || null;
  let steps = 0;
  while (node && steps++ < MAX_CLIMB) {
    if (HIDDEN_TAGS.has(fiberTag(node))) {
      const current = currentOf(node);
      if (current.memoizedState != null) return true;
    }
    node = node.return || null;
  }
  return false;
}
