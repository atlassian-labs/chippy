/**
 * Component origins for fibers on production builds.
 *
 * `component-origin.ts` resolves a component type from its function text.
 * When identical text maps to several authored components, the type alone
 * cannot say which one it is. A fiber can: the component that rendered it is
 * one of its ancestors, and that component's code references the authored
 * name. This module reads the nearest such ancestor and settles the type's
 * name once it is known.
 */

import {
  componentFunctionOf,
  needsComponentOrigin,
  pageComponentOrigins,
  warmComponentTypes,
  type ComponentOrigin,
  type ComponentOriginResolver,
  type NameRecoveryStats,
  type OriginFiber,
} from './component-origin';

export type ContextFiber = OriginFiber & { return?: ContextFiber | null };

/** Component ancestors read before giving up. */
export const MAX_CONTEXT_ANCESTORS = 16;
/** Fibers per ambiguous type tried during a warm pass. */
const SAMPLE_FIBERS = 3;

function definitionKey(definition: ComponentOrigin['definition']): string {
  return definition ? `${definition.fileName}:${definition.lineNumber}:${definition.columnNumber}` : '';
}

/**
 * Name an ambiguous origin from the fiber's ancestors. Walks up the parent
 * chain to the nearest component whose code references any candidate name.
 * When it references exactly one, that is the name; when it references
 * several, or no ancestor references any, the origin stays ambiguous and this
 * returns null, as it does when the candidate list was truncated. Ancestors that only pass `children` through reference none,
 * so the walk continues past them to the component that wrote the element.
 */
export async function nameFromAncestors(
  fiber: ContextFiber,
  origin: ComponentOrigin,
  resolver: ComponentOriginResolver,
  maxAncestors = MAX_CONTEXT_ANCESTORS,
): Promise<ComponentOrigin | null> {
  // An incomplete candidate list may miss the real name, so a single hit
  // among the listed names would not prove anything.
  if (origin.status !== 'ambiguous' || origin.truncated) return null;
  const candidates = (origin.candidates ?? []).filter((candidate) => candidate.name);
  const wanted = new Set(candidates.map((candidate) => candidate.name!));
  if (wanted.size === 0) return null;

  let distance = 0;
  for (let node = fiber.return; node && distance < maxAncestors; node = node.return) {
    if (!componentFunctionOf(node.type)) continue;
    distance += 1;
    const references = await resolver.references(node.type);
    if (!references) continue;
    const hits = Array.from(wanted).filter((name) => references.has(name));
    if (hits.length === 0) continue;
    if (hits.length > 1) return null;

    const name = hits[0]!;
    const matching = candidates.filter((candidate) => candidate.name === name);
    const sameDefinition = new Set(matching.map((candidate) => definitionKey(candidate.definition))).size === 1;
    const ancestor = resolver.peek(node.type);
    return {
      ...origin,
      status: 'resolved',
      name,
      nameEvidence: 'ancestor-reference',
      definition: sameDefinition ? matching[0]!.definition : null,
      script: matching[0]!.script,
      context: { name: ancestor?.name ?? '', definition: ancestor?.definition ?? null, distance },
    };
  }
  return null;
}

/**
 * Resolve the fiber's component origin when the build recorded no metadata,
 * naming ambiguous text from the fiber's ancestors.
 */
export async function resolveFiberComponentOrigin(
  fiber: ContextFiber | null | undefined,
  resolver: ComponentOriginResolver = pageComponentOrigins(),
): Promise<ComponentOrigin | null> {
  if (!fiber || !needsComponentOrigin(fiber)) return null;
  try {
    const origin = await resolver.resolve(fiber.type);
    const named = await nameFromAncestors(fiber, origin, resolver);
    if (!named) return origin;
    resolver.settle(fiber.type, named);
    return named;
  } catch {
    return null;
  }
}

/**
 * Resolve origins for every production component type the walk visits, within
 * `budgetMs`, then name ambiguous types from the ancestors of a few of their
 * fibers. Used before name filters so they match authored names.
 */
export async function warmComponentNames(
  walk: (visit: (fiber: ContextFiber) => void) => void,
  budgetMs = 3000,
  resolver: ComponentOriginResolver = pageComponentOrigins(),
): Promise<NameRecoveryStats | null> {
  const deadline = Date.now() + budgetMs;
  const samples = new Map<unknown, ContextFiber[]>();
  walk((fiber) => {
    if (!needsComponentOrigin(fiber)) return;
    const fn = componentFunctionOf(fiber.type);
    const list = samples.get(fn);
    if (!list) samples.set(fn, [fiber]);
    else if (list.length < SAMPLE_FIBERS) list.push(fiber);
  });
  const stats = await warmComponentTypes(samples.keys(), budgetMs, resolver);
  if (!stats) return null;

  for (const [type, fibers] of samples) {
    const origin = resolver.peek(type);
    if (origin?.status !== 'ambiguous') continue;
    for (const fiber of fibers) {
      if (Date.now() > deadline) return stats;
      const named = await nameFromAncestors(fiber, origin, resolver);
      if (!named) continue;
      resolver.settle(type, named);
      stats.byContext += 1;
      stats.named += 1;
      break;
    }
  }
  return stats;
}
