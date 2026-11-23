/**
 * Records what each commit changed in the DOM, as a diff.
 *
 * Changes are read from the committed fibers in the commit hook, after React
 * has applied the commit's DOM changes and layout effects. Nothing observes or
 * patches the DOM; a host fiber's previous props (`alternate.memoizedProps`)
 * give the value before the commit.
 *
 * A commit is one change set. React applies all of a commit's DOM changes
 * before the browser can paint, so two changes in one commit, in sibling
 * branches or nested, happened together and have no order between them.
 * Order exists only between commits. Changes are kept in tree order so the
 * output is stable, and each names the components above it (`at`).
 *
 * Operations:
 * - `+` inserted: the topmost node of a new subtree.
 * - `-` removed: the topmost node of a deleted subtree.
 * - `~` updated: each prop that can change what is drawn, before and after
 *   (class, attributes, text, each style key). Handlers and refs are ignored.
 * - `move`: a keyed node React moved among its siblings.
 * - `show` / `hide`: Suspense revealed or hid content that stays mounted.
 *
 * Not seen: DOM writes outside React, and attributes React does not own.
 */

import { findChangedHosts, forEachVisiblePropChange, type Found, type HostChangeKind } from './screen-changes';
import { createCommitBudgetStore, type RenderedEvidenceStatus } from './rendered-evidence-store';
import { getComponentName, isComponentFiber, type Fiber } from './internals';

export const MAX_DOM_CHANGES_PER_COMMIT = 200;
export const DEFAULT_MAX_DOM_CHANGES = 50_000;
const MAX_PROPS_PER_CHANGE = 12;
const MAX_VALUE = 80;
const MAX_ATTR_VALUE = 40;
const MAX_TEXT_HINT = 60;
const MAX_MARKUP = 200;
export const MAX_ELEMENT_COUNT = 1000;
const ANCHOR_DEPTH = 3;

export type DomOp = '+' | '-' | '~' | 'move' | 'show' | 'hide';

/** `[name, before, after]`; null means the prop was absent. */
export type DomPropChange = [name: string, before: string | null, after: string | null];

export interface DomChange {
  op: DomOp;
  /** The changed node: `tag`, `tag[data-testid=…]`, `tag#id`, or `<parent> #text`. */
  node: string;
  /** Nearest components above the node, outermost first, joined by ` › `. */
  at: string;
  /** `~` only: the props that changed. */
  props?: DomPropChange[];
  /** Every op except `~`: the node's opening tag and the start of its text. */
  html?: string;
  /** Every op except `~`: elements in the subtree, the node included; at most MAX_ELEMENT_COUNT. */
  elements?: number;
}

export interface DomCommitDiff {
  /** One change set, in tree order. Changes within a commit have no order. */
  changes: DomChange[];
  /** True when the commit changed more than MAX_DOM_CHANGES_PER_COMMIT nodes; the rest were skipped. */
  truncated?: true;
  /** Time spent recording this commit, in ms. */
  ms: number;
}

export interface DomDiffOptions {
  /** Record each commit's DOM changes. Default true in a browser. */
  domDiff?: boolean;
  /** Changes kept across the capture; the oldest commits are dropped first. Default 50,000. */
  maxDomChanges?: number;
}

const OPS: Record<HostChangeKind, DomOp> = {
  inserted: '+',
  removed: '-',
  updated: '~',
  moved: 'move',
  shown: 'show',
  hidden: 'hide',
};

const PROP_NAMES: Record<string, string> = {
  children: 'text',
  className: 'class',
  htmlFor: 'for',
  dangerouslySetInnerHTML: 'innerHTML',
};

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** A prop value as a short string; null when absent. */
export function formatValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return clip(JSON.stringify(value), MAX_VALUE);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return clip(JSON.stringify(value) ?? String(value), MAX_VALUE);
  } catch {
    return '[object]';
  }
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** `tag[data-testid=x]`, `tag#id`, `tag[role=x]`, or `tag`. */
export function describeNode(node: Node): string {
  if (!isElement(node)) {
    const parent = node.parentElement;
    return parent ? describeNode(parent) + ' #text' : '#text';
  }
  const tag = node.tagName.toLowerCase();
  const testId = node.getAttribute('data-testid');
  if (testId) return `${tag}[data-testid=${clip(testId, MAX_ATTR_VALUE)}]`;
  if (node.id) return `${tag}#${clip(node.id, MAX_ATTR_VALUE)}`;
  const role = node.getAttribute('role');
  return role ? `${tag}[role=${role}]` : tag;
}

function textHint(node: Node): string {
  if (!isElement(node)) return (node.nodeValue || '').replace(/\s+/g, ' ').trim();
  const doc = node.ownerDocument;
  if (!doc?.createTreeWalker) return '';
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  let out = '';
  while (out.length <= MAX_TEXT_HINT && walker.nextNode()) {
    const text = (walker.currentNode.nodeValue || '').replace(/\s+/g, ' ');
    if (text.trim()) out += text;
  }
  return clip(out.replace(/\s+/g, ' ').trim(), MAX_TEXT_HINT);
}

/** Elements in the subtree, the node included, counted up to `cap`. */
export function countElements(node: Node, cap = MAX_ELEMENT_COUNT): number {
  if (!isElement(node)) return 0;
  const doc = node.ownerDocument;
  if (!doc?.createTreeWalker) return 1;
  const walker = doc.createTreeWalker(node, 1 /* NodeFilter.SHOW_ELEMENT */);
  let count = 1;
  while (count < cap && walker.nextNode()) count++;
  return count;
}

/** The node's opening tag, the start of its text, and its closing tag. */
export function markup(node: Node): string {
  if (!isElement(node)) return clip(JSON.stringify(textHint(node)), MAX_MARKUP);
  const tag = node.tagName.toLowerCase();
  let open = '<' + tag;
  for (const attr of Array.from(node.attributes)) {
    open += ` ${attr.name}="${clip(attr.value, MAX_ATTR_VALUE)}"`;
  }
  open += '>';
  if (VOID_TAGS.has(tag)) return clip(open, MAX_MARKUP);
  return clip(open + textHint(node), MAX_MARKUP - tag.length - 3) + `</${tag}>`;
}

/**
 * Nearest component names above a fiber, outermost first. A deleted subtree
 * is detached from its parent, so the walk continues from `parent`, the fiber
 * that listed the deletion.
 */
export function anchorOf(fiber: Fiber, parent?: Fiber, nameOf: (fiber: Fiber) => string = getComponentName): string {
  const names: string[] = [];
  let f: Fiber | null = fiber.return;
  let resumed = false;
  while (names.length < ANCHOR_DEPTH) {
    if (!f) {
      if (resumed || !parent) break;
      f = parent;
      resumed = true;
      continue;
    }
    if (isComponentFiber(f.tag)) names.push(nameOf(f));
    f = f.return;
  }
  return names.length ? names.reverse().join(' › ') : '(root)';
}

function propChanges(found: Found): DomPropChange[] {
  const { fiber } = found;
  const before = fiber.alternate?.memoizedProps;
  const after = fiber.memoizedProps;
  if (found.node.nodeType === 3) return [['text', formatValue(before), formatValue(after)]];
  const out: DomPropChange[] = [];
  forEachVisiblePropChange(before, after, (key, x, y) => {
    out.push([PROP_NAMES[key] || key, formatValue(x), formatValue(y)]);
    return out.length >= MAX_PROPS_PER_CHANGE;
  });
  return out;
}

export function toDomChange(found: Found, nameOf: (fiber: Fiber) => string = getComponentName): DomChange {
  const op = OPS[found.kind];
  const base = { op, node: describeNode(found.node), at: anchorOf(found.fiber, found.parent, nameOf) };
  if (op === '~') return { ...base, props: propChanges(found) };
  return { ...base, html: markup(found.node), elements: countElements(found.node) };
}

/** Changes one commit made, in tree order. Exported for tests. */
export function diffCommit(
  root: Fiber,
  limit = MAX_DOM_CHANGES_PER_COMMIT,
  nameOf: (fiber: Fiber) => string = getComponentName,
): { changes: DomChange[]; truncated: boolean } {
  const { found, truncated } = findChangedHosts(root, { limit, descendUpdated: true, detectMoves: true });
  return { changes: found.map((item) => toDomChange(item, nameOf)), truncated };
}

/** `nameOf` names the components in each change's `at`; the detector records them for renaming. */
export function createDomDiffCapture(
  options: DomDiffOptions = {},
  now: () => number = () => performance.now(),
  nameOf: (fiber: Fiber) => string = getComponentName,
) {
  const enabled = options.domDiff !== false && typeof document !== 'undefined';
  const byCommit: Record<number, DomCommitDiff> = {};
  const store = createCommitBudgetStore(byCommit, options.maxDomChanges ?? DEFAULT_MAX_DOM_CHANGES, (diff) => diff.changes.length, DEFAULT_MAX_DOM_CHANGES);

  function record(commitId: number, root: Fiber): void {
    if (!enabled) return;
    const started = now();
    const { changes, truncated } = diffCommit(root, MAX_DOM_CHANGES_PER_COMMIT, nameOf);
    if (changes.length === 0) return;
    store.add(commitId, {
      changes,
      ...(truncated && { truncated: true as const }),
      ms: Math.round((now() - started) * 100) / 100,
    });
  }

  return {
    enabled,
    byCommit,
    record,
    reset: store.reset,
    status: (): RenderedEvidenceStatus => store.status(),
  };
}
