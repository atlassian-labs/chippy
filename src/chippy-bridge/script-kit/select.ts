/**
 * Selection: find fibers across every React root, or inside one subtree.
 *
 * The walk follows the committed tree from each root's `current` HostRoot and
 * visits each current/alternate pair once. When it stops early, because it hit
 * `max` matches or the scan ceiling, the run ledger records it.
 */

import type { Fiber } from '../../layout-lab/fiber-walk';
import { getFiber } from '../../layout-lab/fiber-walk';
import { currentOf, isHostFiber, type FiberKind, type FiberRef, type LiveFiber, type RefRegistry } from './fiber-ref';
import type { Ledger } from './ledger';

export type Matcher = string | RegExp;
export type KindFilter = FiberKind | 'boundary' | 'any';

export interface FindQuery {
  /** Exact component name, or a pattern. Production builds match recovered names. */
  name?: Matcher;
  /** Substring of, or pattern for, the source file name. */
  file?: Matcher;
  /** `data-testid` of the fiber's first DOM element. */
  testId?: Matcher;
  /** Text of the fiber's first DOM element (substring or pattern). */
  text?: Matcher;
  /** Default `component`, which includes error boundaries. */
  kind?: KindFilter | KindFilter[];
  /** Search only below this fiber (the fiber itself excluded). */
  within?: FiberRef;
  /** Skip fibers inside hidden Offscreen trees, such as content behind a shown fallback. */
  visibleOnly?: boolean;
  where?: (ref: FiberRef) => boolean;
  /** Stop after this many matches (default 5000). */
  max?: number;
}

export const SCAN_CEILING = 300_000;
const DEFAULT_MAX = 5000;

export interface SelectDeps {
  getRootFibers: () => Fiber[];
  registry: RefRegistry;
  ledger: Ledger;
}

function matches(matcher: Matcher | undefined, value: string | null | undefined, exact: boolean): boolean {
  if (matcher === undefined) return true;
  if (value == null) return false;
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(value);
  }
  return exact ? value === matcher : value.includes(matcher);
}

function kindMatches(filter: KindFilter[], kind: FiberKind): boolean {
  for (const f of filter) {
    if (f === 'any' || f === kind) return true;
    if (f === 'boundary' && (kind === 'suspense' || kind === 'error')) return true;
    if (f === 'component' && kind === 'error') return true;
  }
  return false;
}

export function firstElement(fiber: LiveFiber): Element | null {
  const stack: LiveFiber[] = [fiber];
  while (stack.length) {
    const node = stack.pop()!;
    if (isHostFiber(node) && (node.stateNode as Node | null)?.nodeType === 1) return node.stateNode as Element;
    if (node.sibling && node !== fiber) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  return null;
}

export function createSelect(deps: SelectDeps) {
  const { registry, ledger } = deps;

  function roots(): FiberRef[] {
    return deps.getRootFibers().map((root) => registry.ref(currentOf(root as LiveFiber)));
  }

  function find(query: FindQuery = {}, options: { quiet?: boolean } = {}): FiberRef[] {
    const kinds = Array.isArray(query.kind) ? query.kind : [query.kind || 'component'];
    const max = Math.max(1, Math.floor(query.max ?? DEFAULT_MAX));
    const out: FiberRef[] = [];
    const seen = new Set<object>();
    let scanned = 0;
    let fileOnUrl = false;
    const within = query.within ? registry.fiberOf(query.within) : null;
    const starts: LiveFiber[] = within ? [within] : deps.getRootFibers().map((root) => currentOf(root as LiveFiber));

    for (const start of starts) {
      const stack: LiveFiber[] = [start];
      while (stack.length) {
        const fiber = stack.pop()!;
        if (seen.has(fiber) || (fiber.alternate && seen.has(fiber.alternate))) continue;
        seen.add(fiber);
        if (++scanned > SCAN_CEILING) {
          ledger.add('find', 'truncated', `scan stopped after ${SCAN_CEILING} fibers`);
          return out;
        }
        const ref = registry.ref(fiber);
        if (fiber !== within && kindMatches(kinds, ref.kind) && !(query.visibleOnly && ref.hidden)) {
          let ok = matches(query.name, ref.name, true);
          if (ok && query.file !== undefined) {
            const file = ref.source?.fileName || null;
            if (file && /^https?:/.test(file)) fileOnUrl = true;
            ok = matches(query.file, file, false);
          }
          if (ok && (query.testId !== undefined || query.text !== undefined)) {
            const el = firstElement(fiber);
            ok = matches(query.testId, el?.getAttribute('data-testid'), true)
              && matches(query.text, el?.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : null, false);
          }
          if (ok && query.where) ok = !!query.where(ref);
          if (ok) {
            // Truncation is reported only when a match past max exists.
            if (out.length >= max) {
              if (!options.quiet) ledger.add('find', 'truncated', `more than ${max} matches; raise max or narrow the query`);
              return out;
            }
            out.push(ref);
          }
        }
        if (fiber.sibling && fiber !== start) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
    }
    if (fileOnUrl) ledger.add('find', 'confidence', 'file was matched against generated module URLs (React 19 before source resolution)');
    return out;
  }

  /** The first match in tree order, or null. Never reports truncation. */
  function first(query: FindQuery = {}): FiberRef | null {
    return find({ ...query, max: 1 }, { quiet: true })[0] || null;
  }

  /** The nearest fiber that rendered an element, or null. */
  function fromElement(target: Element | string | null | undefined): FiberRef | null {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    const fiber = getFiber(el) as LiveFiber | null;
    return fiber ? registry.ref(currentOf(fiber)) : null;
  }

  return { roots, find: (query?: FindQuery) => find(query), first, fromElement };
}
