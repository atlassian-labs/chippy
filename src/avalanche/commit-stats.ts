/**
 * Commit stat tuples and compact interaction rows shared by the Avalanche
 * readers (`commit-list`, `commit-peek`, `summary`, and the offline analyzer).
 */

export const UPSTREAM_COMMIT_STAT_KEYS = [
  'collateral',
  'sources',
  'restarts',
  'performedWork',
  'effects',
  'memos',
  'callbacks',
  'contextUpdates',
  'unmountedComponents',
  'unmountedSubtrees',
] as const;

export function tupleToStats(tuple: unknown): Record<string, number> | null {
  if (!Array.isArray(tuple)) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < UPSTREAM_COMMIT_STAT_KEYS.length; i++) {
    out[UPSTREAM_COMMIT_STAT_KEYS[i]] = Number(tuple[i] || 0);
  }
  return out;
}

export function compactLatestAction(action: any): unknown {
  if (!action || typeof action !== 'object') return action ?? null;
  const location = action.location && typeof action.location === 'object' ? action.location : {};
  const dom = location.dom && typeof location.dom === 'object' ? location.dom : {};
  const targetFiber = location.targetFiber && typeof location.targetFiber === 'object' ? location.targetFiber : null;
  const ownerStack = Array.isArray(targetFiber?.ownerStack) ? targetFiber.ownerStack : [];
  return {
    lastCommitId: Number(action.lastCommitId ?? 0),
    deltaTime: Number(action.deltaTime ?? 0),
    action: typeof action.action === 'string' ? action.action : null,
    dom: {
      tag: typeof dom.tag === 'string' ? dom.tag : null,
      text: typeof dom.text === 'string' ? dom.text : '',
      nearestTestId: typeof dom.nearestTestId === 'string' ? dom.nearestTestId : null,
    },
    targetFiber: targetFiber ? {
      name: typeof targetFiber.name === 'string' ? targetFiber.name : null,
      key: targetFiber.key ?? null,
      ownerStackKind: targetFiber.ownerStackKind === 'parents' ? 'parents' : 'owners',
      ownerNames: ownerStack
        .map((entry: any) => (entry && typeof entry.name === 'string' ? entry.name : null))
        .filter(Boolean)
        .slice(0, 10),
      ownerCount: ownerStack.length,
    } : null,
  };
}
