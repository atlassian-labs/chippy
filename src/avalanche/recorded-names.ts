/**
 * Renames component names that Avalanche stored as text.
 *
 * DOM change anchors (`at`), Suspense locations, screen region labels, perf
 * entry owners, unmount samples, and interaction targets hold a component's
 * name as a string, written when the commit or entry was recorded. On a
 * production build that is the minified name. The ledger remembers which component types each written
 * name came from, so that after the run, once names are recovered from source
 * maps, a written name is replaced only when every type recorded under it was
 * renamed to the same authored name. Minified names repeat across bundles, so
 * a name whose types map to different authored names stays as written.
 *
 * Recording is one map lookup per written name; nothing is resolved during a
 * commit.
 */

import type { ComponentRename } from './rendered-names';

export interface NameLedgerDeps<Fiber, Type> {
  /** The name to write for a fiber; the detector's own naming. */
  componentName(fiber: Fiber): string;
  typeOf(fiber: Fiber): Type;
  /** The current name of a component type. */
  nameOf(type: Type): string;
  /** The runtime name a recovered name replaced for `type`, or null. */
  minifiedNameOf(type: Type): string | null;
}

export function createNameLedger<Fiber, Type>(deps: NameLedgerDeps<Fiber, Type>) {
  let written = new Map<string, Set<Type>>();
  // Written name -> authored name, once every type behind it was renamed alike.
  let renamed = new Map<string, string>();

  /** Record that `name` was written for `type`. */
  function note(name: string, type: Type): void {
    let types = written.get(name);
    if (!types) {
      types = new Set();
      written.set(name, types);
    }
    types.add(type);
  }

  /** The name to write for `fiber`, recorded in the ledger. */
  function nameOf(fiber: Fiber): string {
    const name = deps.componentName(fiber);
    note(name, deps.typeOf(fiber));
    return name;
  }

  /** Types written under any of `names`, or under every name when `names` is omitted. */
  function types(names?: Iterable<string>): Type[] {
    const out = new Set<Type>();
    const add = (set: Set<Type> | undefined) => set?.forEach((type) => out.add(type));
    if (names === undefined) written.forEach(add);
    else for (const name of names) add(written.get(name));
    return Array.from(out);
  }

  /**
   * Written names that can be replaced now, mapped to their authored names.
   * Returns only names added since the last call: text written after a type
   * was renamed already carries the authored name, so each written name needs
   * replacing once.
   */
  function update(): Map<string, string> {
    const fresh = new Map<string, string>();
    for (const [name, types] of written) {
      if (renamed.has(name)) continue;
      let authored: string | null = null;
      for (const type of types) {
        const candidate = deps.minifiedNameOf(type) === name ? deps.nameOf(type) : null;
        if (candidate === null || (authored !== null && candidate !== authored)) {
          authored = null;
          break;
        }
        authored = candidate;
      }
      if (authored !== null && authored !== name) {
        fresh.set(name, authored);
        renamed.set(name, authored);
      }
    }
    return fresh;
  }

  /**
   * Every recovered name behind a written one, including names left as
   * written because their types map to different authored names.
   */
  function renames(): ComponentRename[] {
    const out = new Map<string, ComponentRename>();
    for (const [minifiedName, types] of written) {
      for (const type of types) {
        if (deps.minifiedNameOf(type) !== minifiedName) continue;
        const name = deps.nameOf(type);
        out.set(`${minifiedName}\u0000${name}`, { name, minifiedName });
      }
    }
    return Array.from(out.values());
  }

  function reset(): void {
    written = new Map();
    renamed = new Map();
  }

  return { note, nameOf, types, update, renames, reset };
}

// ─── Applying renames to stored text ─────────────────────────────────────────

const ANCHOR_SEPARATOR = ' › ';

type Named = { name?: unknown };
type Owned = { component?: unknown } | null | undefined;

/** Where the detector stores names as text; every field is optional. */
export interface RecordedNameTargets {
  domByCommit?: Record<number, { changes: Array<{ at: string }> }>;
  suspenseByCommit?: Record<number, Array<{ location?: { fallback?: string; chain: Named[] } }>>;
  screenByCommit?: Record<number, { regions: Array<{ label: string }> }>;
  perfEntries?: Array<{ sources?: Owned[]; target?: Owned; element?: Owned }>;
  unmountSamples?: Iterable<Named[] | null | undefined>;
  /** Interaction locations; each is renamed once, even when several actions share it. */
  interactionLocations?: Iterable<{ targetFiber?: { name?: unknown; ownerStack?: Named[] } | null } | null | undefined>;
}

/** Replace written names in place. Returns how many strings changed. */
export function applyRecordedRenames(targets: RecordedNameTargets, table: ReadonlyMap<string, string>): number {
  if (table.size === 0) return 0;
  let changed = 0;
  const rename = (name: string): string => {
    const authored = table.get(name);
    if (authored === undefined) return name;
    changed += 1;
    return authored;
  };
  const renameNamed = (item: Named | null | undefined) => {
    if (item && typeof item.name === 'string') item.name = rename(item.name);
  };
  const renameOwner = (owner: Owned) => {
    if (owner && typeof owner.component === 'string') owner.component = rename(owner.component);
  };

  for (const diff of Object.values(targets.domByCommit ?? {})) {
    for (const change of diff.changes) {
      if (!change.at.includes(ANCHOR_SEPARATOR) && !table.has(change.at)) continue;
      change.at = change.at.split(ANCHOR_SEPARATOR).map(rename).join(ANCHOR_SEPARATOR);
    }
  }
  for (const events of Object.values(targets.suspenseByCommit ?? {})) {
    for (const event of events) {
      const location = event.location;
      if (!location) continue;
      if (location.fallback) location.fallback = rename(location.fallback);
      location.chain.forEach(renameNamed);
    }
  }
  for (const screen of Object.values(targets.screenByCommit ?? {})) {
    for (const region of screen.regions) region.label = rename(region.label);
  }
  for (const entry of targets.perfEntries ?? []) {
    entry.sources?.forEach(renameOwner);
    renameOwner(entry.target);
    renameOwner(entry.element);
  }
  for (const samples of targets.unmountSamples ?? []) samples?.forEach(renameNamed);
  const seenLocations = new Set<object>();
  for (const location of targets.interactionLocations ?? []) {
    if (!location || seenLocations.has(location)) continue;
    seenLocations.add(location);
    renameNamed(location.targetFiber);
    location.targetFiber?.ownerStack?.forEach(renameNamed);
  }
  return changed;
}
