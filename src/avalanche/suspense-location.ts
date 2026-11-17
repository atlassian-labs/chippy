/**
 * Where a Suspense boundary sits in the app, recorded when it locks or unlocks.
 *
 * A boundary's fiber depth says nothing a reader can use. This module walks up
 * from the boundary twice: five component parents (the rendered `return`
 * chain) and five owners (`_debugOwner`, the components that created the
 * elements; development builds only). Both lists are kept in that order; a
 * component that appears in both is listed once with `via: 'both'`.
 *
 * Each entry carries the component name, its source location when React
 * exposes one, and string props whose names usually identify a feature, team,
 * package, or region (name, team, package, testId, ...Name, ...Id, and so on).
 * Apps often render every boundary through one shared wrapper, so the first
 * entry is frequently the same for all of them; `distinguishingLabel` picks
 * the first entry that differs between the boundaries being compared.
 *
 * Runs only on commits where a boundary changes state, not on every commit.
 */

import { getFiberSourceCandidate } from '../chippy-bridge/fiber-source';
import { getComponentName, isComponentFiber, type Fiber } from './internals';

export const LOCATION_PARENTS = 5;
export const LOCATION_OWNERS = 5;
const MAX_PROPS = 8;
const MAX_VALUE = 80;

// Prop names that tend to name the feature behind a component.
const EXACT_PROP_NAMES = new Set([
  'name', 'id', 'testid', 'data-testid', 'datatestid', 'team', 'owner', 'package', 'pkg',
  'module', 'entrypoint', 'component', 'feature', 'featureflag', 'experience', 'metric', 'metrickey',
  'interaction', 'area', 'section', 'region', 'slot', 'location', 'placement', 'view', 'page',
  'route', 'screen', 'product', 'app', 'source', 'context', 'scope', 'label', 'title', 'type',
  'kind', 'variant', 'mode', 'boundary', 'fallback', 'loader', 'chunk', 'query', 'operation',
  'resource', 'segment', 'attribution', 'actionsubject', 'actionsubjectid', 'analyticsid',
]);
const PROP_NAME_SUFFIX = /(name|id|key|team|package|module|feature|experience|segment|source|location|area|slot|region|boundary|entrypoint)$/i;
const IGNORED_PROPS = new Set(['children', 'className', 'style', 'ref', 'key']);

export interface LocationEntry {
  via: 'parent' | 'owner' | 'both';
  name: string;
  source?: { fileName: string; lineNumber: number };
  props?: Record<string, string>;
}

export interface SuspenseLocation {
  /** React 19 `<Suspense name>` or the boundary's key, when set. */
  name?: string;
  /** Component name of the fallback element, when it is a component. */
  fallback?: string;
  /** Parents first, then owners not already listed; nearest first in each. */
  chain: LocationEntry[];
}

type AnyFiber = Fiber & { key?: unknown; _debugOwner?: unknown };

export function isLocationProp(name: string): boolean {
  if (IGNORED_PROPS.has(name)) return false;
  return EXACT_PROP_NAMES.has(name.toLowerCase()) || PROP_NAME_SUFFIX.test(name);
}

export function pickLocationProps(props: unknown): Record<string, string> | undefined {
  if (!props || typeof props !== 'object') return undefined;
  const picked: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (count >= MAX_PROPS) break;
    if ((typeof value !== 'string' && typeof value !== 'number') || value === '' || !isLocationProp(key)) continue;
    picked[key] = String(value).slice(0, MAX_VALUE);
    count++;
  }
  return count ? picked : undefined;
}

function nameOfType(type: unknown): string | null {
  if (typeof type === 'function') return (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name || null;
  if (type && typeof type === 'object') {
    const t = type as { displayName?: string; render?: unknown; type?: unknown };
    return t.displayName || nameOfType(t.render) || nameOfType(t.type);
  }
  return null;
}

function entryFor(owner: unknown, via: LocationEntry['via']): LocationEntry | null {
  if (!owner || typeof owner !== 'object') return null;
  const fiber = owner as AnyFiber;
  if (typeof fiber.tag === 'number') {
    const source = getFiberSourceCandidate(fiber);
    const props = pickLocationProps(fiber.memoizedProps);
    return {
      via,
      name: getComponentName(fiber),
      ...(source && { source: { fileName: source.fileName, lineNumber: source.lineNumber } }),
      ...(props && { props }),
    };
  }
  // React 19 server component info: { name, props, owner }.
  const info = owner as { name?: unknown; props?: unknown };
  if (typeof info.name !== 'string') return null;
  const props = pickLocationProps(info.props);
  return { via, name: info.name, ...(props && { props }) };
}

function nextOwner(owner: unknown): unknown {
  if (!owner || typeof owner !== 'object') return null;
  const value = owner as { _debugOwner?: unknown; owner?: unknown; tag?: unknown };
  return typeof value.tag === 'number' ? value._debugOwner ?? null : value.owner ?? null;
}

export function describeSuspenseLocation(
  boundary: Fiber,
  parents = LOCATION_PARENTS,
  owners = LOCATION_OWNERS,
): SuspenseLocation {
  const fiber = boundary as AnyFiber;
  const chain: LocationEntry[] = [];
  const listed = new Map<unknown, LocationEntry>();
  const remember = (f: unknown, entry: LocationEntry) => {
    listed.set(f, entry);
    const alternate = (f as Fiber).alternate;
    if (alternate) listed.set(alternate, entry);
  };

  for (let f = fiber.return, n = 0; f && n < parents; f = f.return) {
    if (!isComponentFiber(f.tag)) continue;
    const entry = entryFor(f, 'parent');
    if (!entry) continue;
    chain.push(entry);
    remember(f, entry);
    n++;
  }
  for (let o = fiber._debugOwner, n = 0; o && n < owners; o = nextOwner(o)) {
    const seen = listed.get(o);
    if (seen) { seen.via = 'both'; n++; continue; }
    const entry = entryFor(o, 'owner');
    if (!entry) continue;
    chain.push(entry);
    remember(o, entry);
    n++;
  }

  const props = (fiber.memoizedProps || {}) as { name?: unknown; fallback?: unknown };
  const name = typeof props.name === 'string' ? props.name : typeof fiber.key === 'string' ? fiber.key : undefined;
  const fallback = props.fallback && typeof props.fallback === 'object' ? nameOfType((props.fallback as { type?: unknown }).type) : null;
  return { ...(name && { name }), ...(fallback && { fallback }), chain };
}

function entryKey(entry: LocationEntry): string {
  return entry.name + (entry.props ? JSON.stringify(entry.props) : '') + (entry.source ? `@${entry.source.fileName}:${entry.source.lineNumber}` : '');
}

export function entryLabel(entry: LocationEntry): string {
  const props = entry.props ? Object.entries(entry.props).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  return props ? `${entry.name} ${props}` : entry.name;
}

/**
 * A short label for each boundary: its own name when set, else the first chain
 * entry that the other boundaries do not share, preferring entries with
 * identifying props. With one boundary, the first entry with props, else the
 * first entry.
 */
export function distinguishingLabels(locations: Array<SuspenseLocation | null | undefined>): Array<string | null> {
  const counts = new Map<string, number>();
  for (const location of locations) {
    if (!location) continue;
    for (const key of new Set(location.chain.map(entryKey))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = locations.filter(Boolean).length;
  return locations.map((location) => {
    if (!location) return null;
    if (location.name) return location.name;
    const chain = location.chain;
    if (chain.length === 0) return location.fallback ? `fallback ${location.fallback}` : null;
    const unique = total > 1 ? chain.filter((e) => (counts.get(entryKey(e)) || 0) < total) : chain;
    const pick = unique.find((e) => e.props) || unique[0] || chain.find((e) => e.props) || chain[0];
    return entryLabel(pick);
  });
}
