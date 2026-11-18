/**
 * Reads `domByCommit` from a serialized report as an ordered diff: commits in
 * order, each commit one change set. Changes inside a commit reached the DOM
 * together, so they are grouped by the components above them, not ordered.
 */

import { MAX_ELEMENT_COUNT, type DomChange, type DomCommitDiff } from './dom-diff';
import type { RenderedEvidenceStatus } from './rendered-evidence-store';

export const DEFAULT_DOM_DIFF_COMMITS = 100;
export const DEFAULT_DOM_DIFF_CHANGES = 50;

export interface DomDiffViewOptions {
  fromCommit?: number;
  toCommit?: number;
  /** Case-insensitive regex over each change's op, node, `at`, markup, and props. */
  match?: string;
  /** Most commits listed. Default 100. */
  top?: number;
  /** Most changes listed per commit. Default 50. */
  maxItems?: number;
}

export interface DomDiffCommitView {
  commitId: number;
  /** ms since the first listed commit's hook, or null without commit timings. */
  t: number | null;
  /** performance.now() when the commit hook ran, or null without commit timings. */
  startTime: number | null;
  /** Changes in this commit, after `match`. */
  total: number;
  changes: DomChange[];
  truncated?: true;
}

export interface DomDiffViewPayload {
  commits: DomDiffCommitView[];
  /** Commits in range with a matching change; more than `commits.length` when `top` cut the list. */
  commitsTotal: number;
  /** Set when the budget dropped older commits' DOM changes. */
  evicted?: RenderedEvidenceStatus['evicted'];
  text: string;
}

type SerialLike = {
  domByCommit?: Record<string, DomCommitDiff>;
  commitTimings?: Record<string, { startTime?: number } | undefined>;
  meta?: { domDiff?: RenderedEvidenceStatus };
};

const ORDER_NOTE = 'Each commit is one change set: its changes reached the DOM together and have no order. Order is between commits.';

function searchable(change: DomChange): string {
  const props = (change.props || []).map(([name, before, after]) => `${name} ${before ?? ''} ${after ?? ''}`).join(' ');
  return `${change.op} ${change.node} ${change.at} ${change.html ?? ''} ${props}`;
}

function formatProps(props: DomChange['props']): string {
  return (props || []).map(([name, before, after]) => `${name} ${before ?? '∅'} → ${after ?? '∅'}`).join('; ');
}

export function formatDomChange(change: DomChange): string {
  if (change.op === '~') return `~ ${change.node}  ${formatProps(change.props)}`;
  const size = change.elements && change.elements > 1 ? ` (${change.elements}${change.elements >= MAX_ELEMENT_COUNT ? '+' : ''} el)` : '';
  return `${change.op} ${change.node}${size}  ${change.html ?? ''}`;
}

function renderCommit(view: DomDiffCommitView): string[] {
  const when = view.t === null ? '' : `  +${view.t}ms`;
  const shown = view.changes.length < view.total ? `${view.changes.length} of ${view.total}` : String(view.total);
  const lines = [`#${view.commitId}${when} · ${shown} change${view.total === 1 ? '' : 's'}${view.truncated ? ' (commit truncated)' : ''}`];
  const groups = new Map<string, DomChange[]>();
  for (const change of view.changes) {
    const list = groups.get(change.at);
    if (list) list.push(change);
    else groups.set(change.at, [change]);
  }
  for (const [at, changes] of groups) {
    lines.push(`  ${at}`);
    for (const change of changes) lines.push(`    ${formatDomChange(change)}`);
  }
  return lines;
}

export function buildDomDiffView(report: SerialLike, options: DomDiffViewOptions = {}): DomDiffViewPayload | { error: string } {
  let pattern: RegExp | null = null;
  if (options.match) {
    try {
      pattern = new RegExp(options.match, 'i');
    } catch (error) {
      return { error: 'invalid match regex: ' + ((error as Error).message || String(error)) };
    }
  }
  const from = Number.isFinite(Number(options.fromCommit)) && options.fromCommit != null ? Number(options.fromCommit) : -Infinity;
  const to = Number.isFinite(Number(options.toCommit)) && options.toCommit != null ? Number(options.toCommit) : Infinity;
  const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_DOM_DIFF_COMMITS));
  const maxItems = Math.max(1, Math.floor(Number(options.maxItems) || DEFAULT_DOM_DIFF_CHANGES));

  const byCommit = report.domByCommit || {};
  const ids = Object.keys(byCommit).map(Number).filter((id) => Number.isFinite(id) && id >= from && id <= to).sort((a, b) => a - b);
  const matched: Array<{ commitId: number; diff: DomCommitDiff; changes: DomChange[] }> = [];
  for (const commitId of ids) {
    const diff = byCommit[String(commitId)];
    const changes = pattern ? diff.changes.filter((change) => pattern!.test(searchable(change))) : diff.changes;
    if (changes.length) matched.push({ commitId, diff, changes });
  }

  const listed = matched.slice(0, top);
  const startOf = (id: number) => {
    const start = report.commitTimings?.[String(id)]?.startTime;
    return typeof start === 'number' && Number.isFinite(start) ? start : null;
  };
  const origin = listed.length ? startOf(listed[0].commitId) : null;
  const commits: DomDiffCommitView[] = listed.map(({ commitId, diff, changes }) => {
    const startTime = startOf(commitId);
    return {
      commitId,
      t: startTime === null || origin === null ? null : Math.round((startTime - origin) * 10) / 10,
      startTime,
      total: changes.length,
      changes: changes.slice(0, maxItems),
      ...(diff.truncated && { truncated: true as const }),
    };
  });

  const evicted = report.meta?.domDiff?.evicted ?? null;
  const lines = [ORDER_NOTE];
  if (evicted) lines.push(`Commits up to #${evicted.throughCommit} may have lost their DOM changes to the capture budget.`);
  if (!commits.length) lines.push(pattern ? 'No DOM change matched.' : 'No DOM changes recorded.');
  for (const view of commits) lines.push(...renderCommit(view));
  if (matched.length > commits.length) lines.push(`… ${matched.length - commits.length} more commits; narrow with fromCommit/toCommit or raise top.`);

  return {
    commits,
    commitsTotal: matched.length,
    ...(evicted && { evicted }),
    text: lines.join('\n'),
  };
}
