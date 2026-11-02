/**
 * Product-neutral marker context: the declarative boundaries around a probed
 * fiber, plus whatever registered context providers add on top.
 *
 * The core detects Error and Suspense boundaries from fiber-native signals
 * (./fiber-boundaries). A context provider is a plugin that recognizes
 * app-specific conventions (for example an ownership marker component) and
 * contributes named boundary kinds, error-boundary enrichment, and display
 * hints. Providers never become a prerequisite for inspection: with none
 * registered, a context still reports Error and Suspense boundaries.
 */

import type { Fiber } from './fiber-walk';
import {
  type BoundaryRef,
  type ErrorBoundaryInfo,
  type SuspenseBoundaryInfo,
  collectFiberBoundaries,
  describeErrorBoundary,
  describeSuspenseBoundary,
} from './fiber-boundaries';

// Some apps nest very deep: the nearest declarative Suspense boundary can sit
// ~170+ return-hops above a leaf. The cap bounds malformed/cyclic trees, not
// ordinary depth; a small "reasonable" limit would silently turn a real
// boundary absence into a false negative.
const MAX_CONTEXT_FIBERS = 400;

/** A boundary kind a provider adds next to the core `error` and `suspense`. */
export type ContextBoundaryKind = {
  kind: string;
  /** Short lozenge label shown in the probe UI, e.g. `owner`. */
  label: string;
  /** CSS color for the lozenge; UIs fall back to a neutral color. */
  accent?: string;
};

export type ContextField = { label: string; value: string };

/** What one provider found for one probed fiber. Every part is optional. */
export type ContextContribution = {
  /** Boundaries of this provider's declared kinds; `null` records "looked, not found". */
  boundaries?: Record<string, BoundaryRef<Record<string, unknown>> | null>;
  /** Fields merged onto the generic error boundary when one was found. */
  errorEnrichment?: Record<string, unknown> | null;
  /** Display title per boundary kind (core or provider kind). */
  titles?: Record<string, string>;
  /** Display fields per boundary kind (core or provider kind). */
  fields?: Record<string, ContextField[]>;
  /** Show the error row even when no error boundary fiber was found. */
  showError?: boolean;
  /** Extra top-level fields on the context, kept for provider-specific consumers. */
  extra?: Record<string, unknown>;
};

export type ContextProvider = {
  id: string;
  kinds?: ContextBoundaryKind[];
  /** Inspect the probed fiber's ancestry (nearest first). */
  describe(fibers: Fiber[]): ContextContribution | null;
  /** Return the provider kind this fiber is a boundary of, or null. Used for DOM highlighting. */
  matchBoundary?(fiber: Fiber): string | null;
};

export type ContextDisplay = {
  /** Provider kinds that have a boundary on this context, in registration order. */
  kinds: ContextBoundaryKind[];
  titles: Record<string, string>;
  fields: Record<string, ContextField[]>;
  showError: boolean;
};

export type MarkerContext = {
  boundaries: {
    error: BoundaryRef<ErrorBoundaryInfo & Record<string, unknown>> | null;
    suspense: BoundaryRef<SuspenseBoundaryInfo> | null;
    [kind: string]: BoundaryRef<Record<string, unknown>> | null;
  };
  display: ContextDisplay;
  /** Ids of the providers that contributed to this context. */
  providers: string[];
  [extra: string]: unknown;
};

const CORE_KINDS = new Set(['error', 'suspense']);
const providers: ContextProvider[] = [];

/**
 * Register a context provider. Registering an id again replaces the earlier
 * provider, so a re-injected bundle cannot double-count. Returns an unregister
 * function.
 */
export function registerContextProvider(provider: ContextProvider): () => void {
  if (!provider || typeof provider.id !== 'string' || typeof provider.describe !== 'function') {
    throw new TypeError('registerContextProvider expects { id: string, describe(fibers) }');
  }
  for (const kind of provider.kinds || []) {
    if (CORE_KINDS.has(kind.kind)) throw new TypeError(`context provider ${provider.id} cannot redefine core kind ${kind.kind}`);
  }
  const existing = providers.findIndex((entry) => entry.id === provider.id);
  if (existing >= 0) providers.splice(existing, 1, provider);
  else providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

export function getContextProviders(): Array<{ id: string; kinds: ContextBoundaryKind[] }> {
  return providers.map((provider) => ({ id: provider.id, kinds: [...(provider.kinds || [])] }));
}

function collectChain(start: Fiber | null | undefined, next: (fiber: Fiber) => Fiber | null | undefined, into: Fiber[], seen: Set<Fiber>) {
  let current = start || null;
  const walked = new Set<Fiber>();
  while (current && into.length < MAX_CONTEXT_FIBERS) {
    if (walked.has(current)) break;
    walked.add(current);
    if (!seen.has(current)) {
      seen.add(current);
      into.push(current);
    }
    current = next(current) || null;
  }
}

/**
 * Collect the selected fiber first, then its rendered parent path, then its
 * debug-owner path. Production builds often lack `_debugOwner`, while
 * development builds benefit from both signals.
 */
export function collectContextFibers(fiber: Fiber | null | undefined): Fiber[] {
  if (!fiber) return [];
  const fibers: Fiber[] = [];
  const seen = new Set<Fiber>();
  collectChain(fiber, (entry) => entry.return, fibers, seen);
  collectChain(fiber._debugOwner, (entry) => entry._debugOwner, fibers, seen);
  return fibers;
}

function runProvider(provider: ContextProvider, fibers: Fiber[]): ContextContribution | null {
  try {
    return provider.describe(fibers) || null;
  } catch {
    // A broken plugin must not take down the generic boundary evidence.
    return null;
  }
}

/**
 * Describe the boundaries around a probed fiber. Returns null when neither the
 * core nor any provider found anything, so non-matching trees pay only one
 * bounded ancestry walk.
 */
export function describeContext(fiber: Fiber | null | undefined): MarkerContext | null {
  const fibers = collectContextFibers(fiber);
  if (fibers.length === 0) return null;

  const generic = collectFiberBoundaries(fibers);
  const boundaries: MarkerContext['boundaries'] = { error: generic.error, suspense: generic.suspense };
  const display: ContextDisplay = { kinds: [], titles: {}, fields: {}, showError: !!generic.error };
  const contributors: string[] = [];
  const extra: Record<string, unknown> = {};

  for (const provider of providers) {
    const contribution = runProvider(provider, fibers);
    if (!contribution) continue;
    contributors.push(provider.id);
    const declared = new Set((provider.kinds || []).map((kind) => kind.kind));
    for (const [kind, ref] of Object.entries(contribution.boundaries || {})) {
      if (!declared.has(kind) || boundaries[kind]) continue;
      boundaries[kind] = ref || null;
    }
    for (const kind of provider.kinds || []) {
      if (boundaries[kind.kind] && !display.kinds.some((entry) => entry.kind === kind.kind)) display.kinds.push(kind);
    }
    if (contribution.errorEnrichment && boundaries.error) {
      boundaries.error = { ...boundaries.error, ...contribution.errorEnrichment, distance: boundaries.error.distance };
    }
    Object.assign(display.titles, contribution.titles || {});
    for (const [kind, fields] of Object.entries(contribution.fields || {})) {
      display.fields[kind] = [...(display.fields[kind] || []), ...fields.filter((field) => field.value != null && field.value !== '')];
    }
    if (contribution.showError) display.showError = true;
    for (const [key, value] of Object.entries(contribution.extra || {})) {
      if (key !== 'boundaries' && key !== 'display' && key !== 'providers') extra[key] = value;
    }
  }

  const found = Object.values(boundaries).some(Boolean) || display.showError;
  if (!found) return null;
  return { ...extra, boundaries, display, providers: contributors };
}

/**
 * Locate the actual boundary FIBERS (not serialized descriptors) for every
 * known kind around a probed fiber. Used in-page to resolve a boundary's DOM
 * node for highlighting; it is not part of the serialized snapshot.
 */
export function findBoundaryFibers(fiber: Fiber | null | undefined): Record<string, Fiber | null> {
  const result: Record<string, Fiber | null> = { error: null, suspense: null };
  const matchers = providers.filter((provider) => typeof provider.matchBoundary === 'function');
  for (const provider of matchers) for (const kind of provider.kinds || []) result[kind.kind] = null;
  const wanted = Object.keys(result).length;
  let located = 0;
  for (const entry of collectContextFibers(fiber)) {
    if (!result.error && describeErrorBoundary(entry)) { result.error = entry; located += 1; }
    if (!result.suspense && describeSuspenseBoundary(entry)) { result.suspense = entry; located += 1; }
    for (const provider of matchers) {
      let kind: string | null = null;
      try { kind = provider.matchBoundary!(entry); } catch { kind = null; }
      if (kind && kind in result && !result[kind]) { result[kind] = entry; located += 1; }
    }
    if (located >= wanted) break;
  }
  return result;
}
