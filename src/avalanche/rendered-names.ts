/**
 * Keeps the names in `renderedByCommit` current.
 *
 * Avalanche names each rendered component when it commits, with whatever name
 * is known then. On a production build that is the minified function name
 * (`Qr`), or `Anonymous` for an arrow function inside `forwardRef` or `memo`.
 * The authored name is recovered from the bundle's source map later, before a
 * read (see `warmComponentTypes`), never during a commit. This module renames
 * the held entries once a name exists: each entry whose type was renamed from
 * a minified name takes the authored `name` and keeps the runtime name as
 * `minifiedName`.
 */

export const UNNAMED_COMPONENT = 'Anonymous';

export interface RenderedNameEntry {
  sourceId: string;
  name: string;
  /** The runtime name the authored `name` replaced, on production builds. */
  minifiedName?: string;
}

/** An authored name recovered for a type that runs under a minified name. */
export interface ComponentRename {
  name: string;
  minifiedName: string;
}

export interface RenderedNamesDeps<Type> {
  /** The component type behind an internal source id, or null when unknown. */
  typeOf(sourceId: string): Type | null;
  /** Every component type the capture gave a source id. */
  types(): Iterable<Type>;
  /** The current name of a component type, `UNNAMED_COMPONENT` when it has none. */
  nameOf(type: Type): string;
  /** The runtime name a recovered name replaced for `type`, or null. */
  minifiedNameOf(type: Type): string | null;
}

export function createRenderedNames<Type>(deps: RenderedNamesDeps<Type>) {
  // Source ids recorded without a name; renamed ids leave the set.
  let unnamed = new Set<string>();
  // Types renamed from a minified name. Entries recorded after the rename
  // already carry the authored name; they still need `minifiedName`.
  let renamed = new Map<Type, ComponentRename>();
  // Highest commit id whose entries were walked for `renamed`.
  let walkedThrough = -Infinity;

  /** Called for each rendered entry as it is recorded. */
  function note(entry: RenderedNameEntry): void {
    if (entry.name === UNNAMED_COMPONENT) unnamed.add(entry.sourceId);
  }

  /** Distinct component types of the entries that still have no name. */
  function unnamedTypes(): Type[] {
    const types = new Set<Type>();
    for (const sourceId of unnamed) {
      const type = deps.typeOf(sourceId);
      if (type !== null) types.add(type);
    }
    return Array.from(types);
  }

  /** Names for entries recorded as `Anonymous` whose type has a name now. */
  function namedSinceRecorded(): Map<string, string> {
    const named = new Map<string, string>();
    for (const sourceId of unnamed) {
      const type = deps.typeOf(sourceId);
      if (type === null) continue;
      const name = deps.nameOf(type);
      if (name !== UNNAMED_COMPONENT) named.set(sourceId, name);
    }
    return named;
  }

  /** Types whose recovered name replaced a minified one since the last refresh. */
  function newlyRenamed(): Map<Type, ComponentRename> {
    const fresh = new Map<Type, ComponentRename>();
    for (const type of deps.types()) {
      if (renamed.has(type)) continue;
      const minifiedName = deps.minifiedNameOf(type);
      if (!minifiedName) continue;
      const rename = { name: deps.nameOf(type), minifiedName };
      fresh.set(type, rename);
      renamed.set(type, rename);
    }
    return fresh;
  }

  /**
   * Rename the held entries whose component has a name now. Returns how many
   * entries changed. Walks every entry only when a type gained a name; other
   * calls walk only the commits recorded since the last call.
   */
  function refresh(byCommit: Record<number, RenderedNameEntry[]>): number {
    const anonymous = unnamed.size > 0 ? namedSinceRecorded() : new Map<string, string>();
    const fresh = newlyRenamed();
    if (anonymous.size === 0 && fresh.size === 0 && renamed.size === 0) return 0;
    let changed = 0;
    let latest = walkedThrough;
    for (const [key, entries] of Object.entries(byCommit)) {
      const commitId = Number(key);
      if (commitId > latest) latest = commitId;
      const recent = commitId > walkedThrough;
      const table = recent ? renamed : fresh;
      if (anonymous.size === 0 && table.size === 0) continue;
      for (const entry of entries) {
        const name = anonymous.get(entry.sourceId);
        if (name !== undefined && entry.name === UNNAMED_COMPONENT) {
          entry.name = name;
          changed += 1;
        }
        if (table.size === 0) continue;
        const type = deps.typeOf(entry.sourceId);
        const rename = type === null ? undefined : table.get(type);
        if (rename && entry.minifiedName !== rename.minifiedName) {
          entry.name = rename.name;
          entry.minifiedName = rename.minifiedName;
          changed += 1;
        }
      }
    }
    walkedThrough = latest;
    for (const sourceId of anonymous.keys()) unnamed.delete(sourceId);
    return changed;
  }

  /** Every rename applied so far. */
  function renames(): ComponentRename[] {
    return Array.from(renamed.values());
  }

  function reset(): void {
    unnamed = new Set();
    renamed = new Map();
    walkedThrough = -Infinity;
  }

  return { note, unnamedTypes, refresh, renames, reset };
}
