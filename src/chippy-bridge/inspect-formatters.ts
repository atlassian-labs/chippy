/**
 * Pure data transforms for hook inspection and component tree formatting.
 *
 * These functions are extracted from chippy-page-bridge.js and are testable
 * without DOM or side effects. They format hook metadata into ASCII trees and
 * compact summaries for the Chippy extension.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export type HookRaw = {
  index: number;
  tag?: string;
  value?: unknown;
  hasCleanup?: boolean;
};

export type HookSummary = {
  name: string | null;
  fiberId?: string | null;
  hookCount: number;
  truncated: boolean;
  maxHooks?: number | null;
  counts: Record<string, number>;
  cleanupEffectCount: number;
  cleanupEffects: number[];
  runs: Array<{ start: number; end: number; tag: string; count: number }>;
  valueHints: Array<{ index: number; tag: string; value: unknown }>;
};

/** Returned by summarizeHookList when the raw hook list is missing or carries an error. */
export type HookListError = { error: string };

/** The subset of a hook summary that renderCompactComponentText reads. */
export type CompactHookSummary = Pick<HookSummary, 'hookCount' | 'counts' | 'cleanupEffectCount'> &
  Partial<Pick<HookSummary, 'truncated' | 'cleanupEffects'>> & {
    /** Hooks recovered by replay; differs from hookCount when only committed fiber slots were read. */
    replayedHookCount?: number;
  };

export type PathSegment = {
  name: string;
  loc?: string | null;
};

export type TreeGroup = {
  path: PathSegment[];
  hooks: Array<{
    hookId: number | null;
    primitive: string;
    debugLabel?: string | null;
  }>;
};

export type Source = {
  fileName?: string | null;
  lineNumber?: number | null;
};

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * summarizeHookList
 *
 * Transform a raw hook list into counts, runs, cleanup effects, and value hints.
 * Pure data-in-data-out; no side effects.
 */
export function summarizeHookList(raw: any): HookSummary | HookListError {
  if (!raw || raw.error) return raw || { error: 'No hook data available' };

  const hooks = Array.isArray(raw.hooks) ? (raw.hooks as HookRaw[]) : [];
  const counts: Record<string, number> = {};
  const cleanupEffects: number[] = [];
  const valueHints: Array<{ index: number; tag: string; value: unknown }> = [];
  const runs: Array<{ start: number; end: number; tag: string; count: number }> = [];
  let runStart = 0;

  hooks.forEach((hook, index) => {
    const tag = hook?.tag || 'Unknown';
    counts[tag] = (counts[tag] || 0) + 1;
    if (tag === 'Effect' && hook.hasCleanup) cleanupEffects.push(index);
    if (hook && Object.prototype.hasOwnProperty.call(hook, 'value') && hook.value !== undefined && hook.value !== null) {
      valueHints.push({ index, tag, value: hook.value });
    }
  });

  for (let i = 1; i <= hooks.length; i++) {
    const prevTag = hooks[runStart]?.tag || 'Unknown';
    const tag = hooks[i]?.tag || 'Unknown';
    if (i === hooks.length || tag !== prevTag) {
      runs.push({ start: runStart, end: i - 1, tag: prevTag, count: i - runStart });
      runStart = i;
    }
  }

  return {
    name: raw.name || null,
    fiberId: raw.fiberId || null,
    hookCount: raw.hookCount ?? hooks.length,
    truncated: !!raw.truncated,
    maxHooks: raw.maxHooks ?? null,
    counts,
    cleanupEffectCount: cleanupEffects.length,
    cleanupEffects,
    runs,
    valueHints,
  };
}

/**
 * formatCounts
 *
 * Format a counts object (tag → count) into a comma-separated string.
 * Used by renderCompactComponentText and other formatters.
 */
export function formatCounts(counts: Record<string, number> | null | undefined): string {
  return Object.keys(counts || {})
    .sort()
    .map((k) => k + '=' + counts![k])
    .join(', ');
}

function formatPath(path: PathSegment[] | null | undefined): string {
  return (path || []).map((seg) => seg.name + (seg.loc ? ' @ ' + seg.loc : '')).join(' > ');
}

function renderComplexityText(summary: CompactHookSummary, records: any[]): string[] {
  const out = ['complexity:', '  total hook slots: ' + summary.hookCount + (summary.truncated ? '+' : '')];
  const counts = formatCounts(summary.counts);
  if (counts) out.push('  primitive counts: ' + counts);
  if (summary.cleanupEffectCount) {
    const cleanupIndexes = (summary.cleanupEffects || []).join(', ');
    out.push('  cleanup effects: ' + summary.cleanupEffectCount + (cleanupIndexes ? ' @ hooks ' + cleanupIndexes : ''));
  }

  const familyCounts = new Map<string, number>();
  for (const record of records || []) {
    if (record?.index == null) continue;
    const path = (record.path || []) as PathSegment[];
    const key = path.length ? path[0].name + (path[0].loc ? ' @ ' + path[0].loc : '') : '(component body)';
    familyCounts.set(key, (familyCounts.get(key) || 0) + 1);
  }
  const topFamilies = Array.from(familyCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  if (topFamilies.length) {
    out.push('  top hook families:');
    topFamilies.forEach(([family, count]) => out.push('    ' + family + ': ' + count));
  }

  const debugLandmarks = (records || [])
    .filter((record) => record?.debugLabel)
    .slice(0, 8)
    .map((record) => {
      const path = formatPath(record.path || []);
      const hook = 'hook ' + (record.index == null ? '·' : record.index) + ' ' + record.primitive;
      return '    ' + (path ? path + ' > ' : '') + hook + ' — ' + record.debugLabel;
    });
  if (debugLandmarks.length) {
    out.push('  debug landmarks:');
    out.push(...debugLandmarks);
  }
  return out;
}

/**
 * renderTreeText
 *
 * Render a component tree with custom-hook ancestry as ASCII.
 * Groups are ordered as they appear, with path depth driving indent.
 */
export function renderTreeText(componentName: string, source: Source | null | undefined, groups: TreeGroup[]): string {
  type HookEntry = { kind: 'hooks'; hooks: TreeGroup['hooks'] };
  type FolderEntry = { kind: 'folder'; node: FolderNode };
  type FolderNode = {
    segment: PathSegment | null;
    locs: Set<string>;
    childrenByKey: Map<string, FolderNode>;
    entries: Array<HookEntry | FolderEntry>;
  };

  const out: string[] = [];
  const head = source?.fileName
    ? componentName + ' @ ' + source.fileName + (source.lineNumber ? ':' + source.lineNumber : '')
    : componentName;
  out.push(head);

  const root: FolderNode = { segment: null, locs: new Set(), childrenByKey: new Map(), entries: [] };
  // Folder identity is custom hook name + stable invocation location. The loc is
  // produced by replay as the parent callsite that invoked this hook, not the
  // hook's internal primitive-call line, so repeated primitive frames inside one
  // hook invocation collapse while distinct same-name invocations stay separate.
  const segmentKey = (seg: PathSegment) => seg.name + '\u0000' + (seg.loc || '');

  for (const group of groups || []) {
    let node = root;
    for (const seg of group.path || []) {
      const key = segmentKey(seg);
      let child = node.childrenByKey.get(key);
      if (!child) {
        child = { segment: seg, locs: new Set(), childrenByKey: new Map(), entries: [] };
        node.childrenByKey.set(key, child);
        node.entries.push({ kind: 'folder', node: child });
      }
      if (seg.loc) child.locs.add(seg.loc);
      node = child;
    }
    if (group.hooks && group.hooks.length) {
      node.entries.push({ kind: 'hooks', hooks: group.hooks });
    }
  }

  const renderEntries = (entries: Array<HookEntry | FolderEntry>, prefix: string) => {
    entries.forEach((entry, entryIndex) => {
      const isLastEntry = entryIndex === entries.length - 1;
      const connector = isLastEntry ? '└─' : '├─';
      if (entry.kind === 'folder') {
        const seg = entry.node.segment!;
        out.push(prefix + connector + ' ' + seg.name + (seg.loc ? ' @ ' + seg.loc : ''));
        renderEntries(entry.node.entries, prefix + (isLastEntry ? '   ' : '│  '));
        return;
      }

      entry.hooks.forEach((hook, hookIndex) => {
        const isLastHook = hookIndex === entry.hooks.length - 1;
        const hookConnector = isLastEntry && isLastHook ? '└─' : '├─';
        const hid = hook.hookId == null ? '·' : hook.hookId;
        const debugLabel = hook.debugLabel ? ' — ' + hook.debugLabel : '';
        out.push(prefix + hookConnector + ' hook ' + hid + ' ' + hook.primitive + debugLabel);
      });
    });
  };

  renderEntries(root.entries, '');
  return out.join('\n');
}

/**
 * renderCompactComponentText
 *
 * Render a compact summary of a component's hooks and custom-hook structure.
 * Used by evalExplainComponent.
 */
export function renderCompactComponentText(
  componentName: string,
  source: Source | null | undefined,
  summary: CompactHookSummary,
  records: any[],
  warnings: string[],
): string {
  const out: string[] = [];
  const head = source?.fileName
    ? componentName + ' @ ' + source.fileName + (source.lineNumber ? ':' + source.lineNumber : '')
    : componentName;
  out.push(head);
  out.push('hooks: ' + summary.hookCount + (summary.truncated ? '+' : '') + ' (' + formatCounts(summary.counts) + ')');
  if (summary.cleanupEffectCount) out.push('effects with cleanup: ' + summary.cleanupEffectCount);
  out.push(...renderComplexityText(summary, records || []));

  const treeGroups: TreeGroup[] = (records || [])
    .filter((r) => r.index !== null || r.primitive === 'DebugValue')
    .map((r) => ({
      path: r.path || [],
      hooks: [{ hookId: r.index, primitive: r.primitive, debugLabel: r.debugLabel }],
    }));
  if (treeGroups.length) {
    out.push('structure:');
    const treeText = renderTreeText(componentName, null, treeGroups).split('\n').slice(1);
    out.push(...treeText.map((line) => '  ' + line));
  } else {
    out.push('structure: unavailable from replay; using live hook list only');
  }
  if (summary.replayedHookCount != null && summary.replayedHookCount !== summary.hookCount) {
    out.push('fiber-only: 0 hooks replayed; ' + summary.hookCount + ' committed hook slots read');
  }
  if (warnings && warnings.length) out.push('warnings: ' + warnings.join('; '));
  return out.join('\n');
}
