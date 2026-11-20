/**
 * Keeps the names in `renderedByCommit` current.
 *
 * Avalanche names each rendered component when it commits. On a production
 * build, a component written as an arrow function inside `forwardRef` or
 * `memo` has no runtime name, so it is recorded as `Anonymous`. Its authored
 * name is recovered from the bundle's source map later, before a read (see
 * `warmComponentTypes`). This module remembers the entries recorded without a
 * name, lists their component types for that recovery, and renames the
 * entries once a name exists.
 */

export const UNNAMED_COMPONENT = 'Anonymous';

export interface RenderedNameEntry {
  sourceId: string;
  name: string;
}

export interface RenderedNamesDeps<Type> {
  /** The component type behind an internal source id, or null when unknown. */
  typeOf(sourceId: string): Type | null;
  /** The current name of a component type, `UNNAMED_COMPONENT` when it has none. */
  nameOf(type: Type): string;
}

export function createRenderedNames<Type>(deps: RenderedNamesDeps<Type>) {
  // Source ids recorded without a name; renamed ids leave the set.
  let unnamed = new Set<string>();

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

  /**
   * Rename the held entries whose component has a name now. Returns how many
   * entries changed. Walks the entries only when at least one id gained a name.
   */
  function refresh(byCommit: Record<number, RenderedNameEntry[]>): number {
    if (unnamed.size === 0) return 0;
    const renamed = new Map<string, string>();
    for (const sourceId of unnamed) {
      const type = deps.typeOf(sourceId);
      if (type === null) continue;
      const name = deps.nameOf(type);
      if (name !== UNNAMED_COMPONENT) renamed.set(sourceId, name);
    }
    if (renamed.size === 0) return 0;
    let changed = 0;
    for (const entries of Object.values(byCommit)) {
      for (const entry of entries) {
        const name = renamed.get(entry.sourceId);
        if (name !== undefined && entry.name === UNNAMED_COMPONENT) {
          entry.name = name;
          changed += 1;
        }
      }
    }
    for (const sourceId of renamed.keys()) unnamed.delete(sourceId);
    return changed;
  }

  function reset(): void {
    unnamed = new Set();
  }

  return { note, unnamedTypes, refresh, reset };
}
