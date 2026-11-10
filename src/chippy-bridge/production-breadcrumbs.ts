/**
 * Where to look for a production component in the authored repository.
 *
 * A production build cannot say for certain which source a component came
 * from. This module collects every lead the page provides and labels how far
 * each one can be trusted:
 *
 * - Always: strings from the component's code to search for, the script that
 *   holds it, the nearest test id in the DOM, and the nearest error boundary.
 * - When the page serves a source map: authored files and lines, ranked
 *   `exact`, `inferred`, or `possible`.
 * - `limits` states what the page could not provide, in the result itself.
 */

import { getFiberDomNode, type Fiber } from '../layout-lab/fiber-walk';
import { describeErrorBoundary } from '../layout-lab/fiber-boundaries';
import { componentStrings } from './component-strings';
import {
  MAX_CANDIDATES,
  MAX_OCCURRENCES,
  needsComponentOrigin,
  pageComponentOrigins,
  type ComponentOrigin,
  type ComponentOriginResolver,
} from './component-origin';

export type LeadConfidence = 'exact' | 'inferred' | 'possible';

export type WhereToLook = {
  file: string;
  line: number;
  column: number | null;
  /** Authored component name at this location, when known. */
  name: string | null;
  why: string;
  confidence: LeadConfidence;
};

export type Breadcrumbs = {
  /** Authored locations, most likely first. Empty without a source map. */
  whereToLook: WhereToLook[];
  /** Locations left out of `whereToLook`. */
  whereToLookOmitted?: number;
  /** Strings from the component's code, to search the repository for. */
  grep: string[];
  grepOmitted?: number;
  /** The script that holds the component, and its generated position. */
  script: { url: string; line: number; column: number } | null;
  /** `data-testid` on or above the component's first DOM element. */
  nearestTestId: string | null;
  /** The nearest error boundary above the component, and how many fibers up. */
  errorBoundary: { name: string; distance: number } | null;
  /** What the page could not provide. */
  limits: string[];
};

/** Locations listed per component. */
export const MAX_WHERE_TO_LOOK = 8;
const MAX_BOUNDARY_DISTANCE = 400;

function lead(
  definition: { fileName: string; lineNumber: number; columnNumber: number | null },
  name: string | null,
  why: string,
  confidence: LeadConfidence,
): WhereToLook {
  return { file: definition.fileName, line: definition.lineNumber, column: definition.columnNumber, name, why, confidence };
}

function sameLocation(a: WhereToLook, b: WhereToLook): boolean {
  return a.file === b.file && a.line === b.line && a.column === b.column;
}

/** Ranked authored locations for an origin, most likely first. */
export function whereToLookFor(origin: ComponentOrigin | null): WhereToLook[] {
  if (!origin) return [];
  const out: WhereToLook[] = [];
  const add = (entry: WhereToLook) => {
    if (!out.some((existing) => sameLocation(existing, entry))) out.push(entry);
  };
  const candidates = origin.candidates ?? [];
  const inferred = origin.nameEvidence === 'ancestor-reference' && origin.context;

  if (origin.status === 'resolved' && origin.definition) {
    add(lead(
      origin.definition,
      origin.name,
      inferred ? `${origin.context!.name || 'an ancestor'}'s code references ${origin.name}` : 'definition',
      inferred ? 'inferred' : 'exact',
    ));
  }
  for (const candidate of candidates) {
    if (!candidate.definition) continue;
    const sameName = origin.status === 'resolved' && candidate.name === origin.name;
    const why = sameName && !inferred
      ? `one of ${candidates.length} definitions named ${origin.name} with identical code`
      : sameName
        ? `${origin.context!.name || 'an ancestor'}'s code references ${origin.name}`
        : 'identical minified code';
    add(lead(candidate.definition, candidate.name, why, sameName && inferred ? 'inferred' : 'possible'));
  }
  if (inferred && origin.context!.definition) {
    add(lead(origin.context!.definition, origin.context!.name || null, 'nearest ancestor whose code references it', 'inferred'));
  }
  return out;
}

/** Statements of what the origin could not establish. */
export function limitsOf(origin: ComponentOrigin | null, grepCount: number): string[] {
  const grep = grepCount > 0 ? 'search for the grep strings' : 'the component code has no distinctive strings';
  if (!origin) return [`component origin not resolved: file unknown; ${grep}`];
  const limits: string[] = [];
  const count = origin.candidates?.length ?? 0;
  switch (origin.status) {
    case 'resolved':
      if (origin.nameEvidence === 'ancestor-reference') {
        limits.push(`name inferred from ${origin.context?.name || 'an ancestor'}'s code; identical code maps to ${count} components`);
      } else if (!origin.definition && count > 1) {
        limits.push(`${count} definitions share this name and code; each is listed as possible`);
      }
      break;
    case 'ambiguous':
      limits.push(`identical minified code maps to ${count} components; name and file are one of the possible locations`);
      break;
    case 'no-source-map':
      limits.push(`no source map for ${origin.script}: file unknown; ${grep}`);
      break;
    case 'unmapped':
      limits.push(`the source map has no mapping for this component: file unknown; ${grep}`);
      break;
    case 'not-found':
      limits.push(`component code not found in the page's scripts: file unknown; ${grep}`);
      break;
    case 'unsupported':
      limits.push(`component code is not readable: file unknown`);
      break;
  }
  if (origin.truncated) {
    limits.push(`search stopped at ${MAX_OCCURRENCES} occurrences or ${MAX_CANDIDATES} candidates; the real definition may be missing`);
  }
  return limits;
}

function nearestTestId(fiber: Fiber): string | null {
  if (typeof Element === 'undefined') return null;
  try {
    return getFiberDomNode(fiber)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
  } catch {
    return null;
  }
}

function nearestErrorBoundary(fiber: Fiber): Breadcrumbs['errorBoundary'] {
  let distance = 0;
  for (let node = fiber.return ?? null; node && distance < MAX_BOUNDARY_DISTANCE; node = node.return ?? null) {
    distance += 1;
    const boundary = describeErrorBoundary(node);
    if (boundary) return { name: boundary.componentName, distance };
  }
  return null;
}

/**
 * Breadcrumbs for a fiber without development metadata, from the origin its
 * type already resolved to. Returns null for fibers that carry development
 * metadata; their source locations are exact.
 */
export function productionBreadcrumbs(
  fiber: Fiber | null | undefined,
  resolver: ComponentOriginResolver = pageComponentOrigins(),
): Breadcrumbs | null {
  if (!fiber || !needsComponentOrigin(fiber)) return null;
  const origin = resolver.peek(fiber.type);
  const all = whereToLookFor(origin);
  const { strings, omitted } = componentStrings(fiber.type);
  return {
    whereToLook: all.slice(0, MAX_WHERE_TO_LOOK),
    ...(all.length > MAX_WHERE_TO_LOOK ? { whereToLookOmitted: all.length - MAX_WHERE_TO_LOOK } : {}),
    grep: strings,
    ...(omitted ? { grepOmitted: omitted } : {}),
    script: origin?.script && origin.generated ? { url: origin.script, ...origin.generated } : null,
    nearestTestId: nearestTestId(fiber),
    errorBoundary: nearestErrorBoundary(fiber),
    limits: limitsOf(origin, strings.length),
  };
}

/** Attach `breadcrumbs` to a described entry for a production fiber. */
export function applyProductionBreadcrumbs(entry: Record<string, unknown> | null | undefined, fiber: Fiber | null | undefined): void {
  if (!entry) return;
  const breadcrumbs = productionBreadcrumbs(fiber);
  if (breadcrumbs) entry.breadcrumbs = breadcrumbs;
}
