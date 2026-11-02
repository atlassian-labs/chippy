// TODO: This is a deliberately lossy UI signature. Commits that differ
// only in omitted timing, rendered, ATL, or other diagnostic fields collapse
// into one "repeat" count; either expose that scope in the UI or expand the key
// before treating grouped rows as equivalent behavior.
const PATTERN_STAT_KEYS = [
  'collateral',
  'restarts',
  'performedWork',
  'effects',
  'memos',
  'callbacks',
  'contextUpdates',
  'unmountedComponents',
  'unmountedSubtrees',
];

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function actionIdentity(row) {
  const action = row?.latestAction;
  return [
    action?.action || '',
    action?.dom?.nearestTestId || '',
    action?.targetFiber?.name || '',
    action?.dom?.tag || '',
  ];
}

function patternKey(row) {
  return JSON.stringify([
    count(row?.sourceCount),
    ...PATTERN_STAT_KEYS.map((key) => count(row?.stat?.[key])),
    ...actionIdentity(row),
  ]);
}

export function groupCommitRows(rows) {
  const groups = new Map();

  for (const row of rows || []) {
    const key = patternKey(row);
    const commitId = count(row?.commitId);
    const current = groups.get(key);

    if (!current) {
      groups.set(key, {
        key,
        count: 1,
        firstCommitId: commitId,
        lastCommitId: commitId,
        representative: row,
      });
      continue;
    }

    current.count += 1;
    current.firstCommitId = Math.min(current.firstCommitId, commitId);
    current.lastCommitId = Math.max(current.lastCommitId, commitId);
    if (commitId >= count(current.representative?.commitId)) current.representative = row;
  }

  return Array.from(groups.values()).sort((a, b) => b.lastCommitId - a.lastCommitId);
}

export function describeCommitAction(row) {
  const action = row?.latestAction;
  if (!action?.action) return 'render';
  const target = action.dom?.nearestTestId || action.targetFiber?.name || action.dom?.tag;
  return target ? `${action.action} · ${target}` : action.action;
}

export function commitSpan(group) {
  if (!group) return '—';
  if (group.firstCommitId === group.lastCommitId) return `#${group.lastCommitId}`;
  return `#${group.firstCommitId}–#${group.lastCommitId}`;
}
