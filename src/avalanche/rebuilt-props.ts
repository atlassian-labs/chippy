/**
 * Groups one commit's `ref-changed` object and array props by what changed,
 * for the summary: one row per prop that reached many components, so a
 * commit's top line can say "`appState` was rebuilt with the same values and
 * rendered 40 components" without reading every rendered entry.
 *
 * Reads the key diff the detector records on rendered entries (see
 * `prop-key-diff.ts`). Props without one (callbacks, elements, `stats` mode)
 * are not counted.
 */

export type RebuiltPropGroup = {
  prop: string;
  /** The first component, in render order, that received this change. */
  component: unknown;
  sourceId: unknown;
  /** How many rendered components received the same change. */
  components: number;
  /** Present, and true, when only the identity changed. */
  sameShallow?: true;
  /** Names of the first changed keys. */
  changedKeys?: string[];
  changedKeyCount?: number;
  /** Key count of a value too large to compare. */
  keysNotCompared?: number;
};

export type RebuiltPropsSummary = {
  /** Prop changes, across rendered components, where only the identity changed. */
  sameShallow: number;
  /** Prop changes where at least one key changed value. */
  keysChanged: number;
  /** Prop changes on values too large to compare. */
  notCompared: number;
  /** Groups by components received, then identity-only first. */
  groups: RebuiltPropGroup[];
  /** Groups not listed. */
  omittedGroups: number;
};

type Change = {
  name?: unknown;
  kind?: unknown;
  current?: unknown;
  sameShallow?: unknown;
  changedKeys?: Array<{ key?: unknown }>;
  changedKeyCount?: unknown;
  keysNotCompared?: unknown;
};

/** Null when no rendered entry carries a key diff. */
export function summarizeRebuiltProps(rendered: unknown, maxItems: number): RebuiltPropsSummary | null {
  if (!Array.isArray(rendered)) return null;
  const groups = new Map<string, RebuiltPropGroup>();
  let sameShallow = 0;
  let keysChanged = 0;
  let notCompared = 0;

  for (const entry of rendered) {
    const e = entry as { name?: unknown; sourceId?: unknown; propChanges?: unknown } | null;
    if (!e || !Array.isArray(e.propChanges)) continue;
    for (const raw of e.propChanges) {
      const change = raw as Change | null;
      if (!change || change.kind !== 'ref-changed') continue;
      const prop = String(change.name);
      let row: Omit<RebuiltPropGroup, 'prop' | 'component' | 'sourceId' | 'components'>;
      if (change.sameShallow === true) {
        sameShallow++;
        row = { sameShallow: true };
      } else if (Array.isArray(change.changedKeys)) {
        keysChanged++;
        row = { changedKeys: change.changedKeys.map((k) => String(k?.key)), changedKeyCount: Number(change.changedKeyCount) || change.changedKeys.length };
      } else if (typeof change.keysNotCompared === 'number') {
        notCompared++;
        row = { keysNotCompared: change.keysNotCompared };
      } else {
        continue;
      }
      const key = `${prop}\u0000${String(change.current)}\u0000${JSON.stringify(row)}`;
      const group = groups.get(key);
      if (group) group.components++;
      else groups.set(key, { prop, component: e.name ?? null, sourceId: e.sourceId ?? null, components: 1, ...row });
    }
  }

  if (!groups.size) return null;
  const sorted = [...groups.values()].sort((a, b) => b.components - a.components || Number(!!b.sameShallow) - Number(!!a.sameShallow));
  return {
    sameShallow,
    keysChanged,
    notCompared,
    groups: sorted.slice(0, maxItems),
    omittedGroups: Math.max(0, sorted.length - maxItems),
  };
}
