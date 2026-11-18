import { describe, expect, it } from 'vitest';
import { anchorOf, countElements, createDomDiffCapture, diffCommit, formatValue, markup } from './dom-diff';
import { buildDomDiffView } from './dom-diff-view';
import { ChildDeletion, Update, type Fiber } from './internals';

type F = Fiber & { stateNode?: unknown };

const MOUNTED = { memoizedProps: {} } as F;

function fiber(tag: number, props: Partial<F> = {}): F {
  return { tag, type: tag === 5 ? 'div' : null, alternate: MOUNTED, return: null, child: null, sibling: null, flags: 0, subtreeFlags: 0, lanes: 0, memoizedState: null, updateQueue: null, ...props } as F;
}

function component(name: string, props: Partial<F> = {}): F {
  return fiber(0, { type: Object.assign(() => null, { displayName: name }) as never, ...props });
}

function tree(parent: F, children: F[]): F {
  parent.child = children[0] || null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] || null;
    // eslint-disable-next-line no-bitwise
    parent.subtreeFlags |= child.flags | child.subtreeFlags;
  });
  return parent;
}

function updated(before: Record<string, unknown>, after: Record<string, unknown>): F {
  const el = document.createElement('div');
  return fiber(5, { stateNode: el, flags: Update, memoizedProps: after, alternate: fiber(5, { memoizedProps: before }) });
}

describe('formatValue and markup', () => {
  it('quotes strings, clips long values, and marks absent values as null', () => {
    expect(formatValue('a')).toBe('"a"');
    expect(formatValue(3)).toBe('3');
    expect(formatValue(undefined)).toBeNull();
    expect(formatValue('x'.repeat(200))).toHaveLength(80);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatValue(circular)).toBe('[object]');
  });

  it('renders the opening tag and the start of the text, and counts elements up to a cap', () => {
    const el = document.createElement('ul');
    el.setAttribute('data-testid', 'list');
    for (let i = 0; i < 5; i++) el.appendChild(document.createElement('li')).textContent = `row ${i}`;
    expect(markup(el)).toBe('<ul data-testid="list">row 0row 1row 2row 3row 4</ul>');
    expect(countElements(el)).toBe(6);
    expect(countElements(el, 3)).toBe(3);
    expect(markup(document.createElement('img'))).toBe('<img>');
  });
});

describe('diffCommit', () => {
  it('keeps walking below an updated element, so nested updates are recorded too', () => {
    const outer = updated({ className: 'a' }, { className: 'b' });
    const inner = updated({ title: 'x' }, { title: 'y' });
    tree(outer, [inner]);
    const root = tree(fiber(3), [tree(component('Card'), [outer])]);
    const { changes } = diffCommit(root);
    expect(changes).toEqual([
      { op: '~', node: 'div', at: 'Card', props: [['class', '"a"', '"b"']] },
      { op: '~', node: 'div', at: 'Card', props: [['title', '"x"', '"y"']] },
    ]);
  });

  it('names a removed node by the components above the fiber that listed the deletion', () => {
    const removedEl = document.createElement('p');
    removedEl.textContent = 'gone';
    // React detaches the deleted subtree: its root has no return.
    const deleted = tree(component('Row'), [fiber(5, { type: 'p' as never, stateNode: removedEl })]);
    deleted.return = null;
    const list = fiber(5, { stateNode: document.createElement('ul'), flags: ChildDeletion, deletions: [deleted] });
    const root = tree(fiber(3), [tree(component('List'), [list])]);
    expect(diffCommit(root).changes).toEqual([{ op: '-', node: 'p', at: 'List › Row', html: '<p>gone</p>', elements: 1 }]);
    expect(anchorOf(fiber(5))).toBe('(root)');
  });

  it('stops at the change limit and says so', () => {
    const root = tree(fiber(3), Array.from({ length: 5 }, (_, i) => updated({ title: String(i) }, { title: 'x' })));
    const { changes, truncated } = diffCommit(root, 3);
    expect(changes).toHaveLength(3);
    expect(truncated).toBe(true);
  });
});

describe('createDomDiffCapture', () => {
  it('records commits that changed the DOM and drops the oldest past the budget', () => {
    const capture = createDomDiffCapture({ maxDomChanges: 2 }, () => 0);
    const commit = () => tree(fiber(3), [updated({ title: 'a' }, { title: 'b' })]);
    capture.record(1, commit());
    capture.record(2, tree(fiber(3), [fiber(5, { stateNode: document.createElement('div') })]));
    capture.record(3, commit());
    capture.record(4, commit());
    expect(Object.keys(capture.byCommit)).toEqual(['3', '4']);
    expect(capture.status().evicted).toEqual({ commits: 1, entries: 1, throughCommit: 1 });
    capture.reset();
    expect(capture.byCommit).toEqual({});
  });

  it('can be switched off', () => {
    const capture = createDomDiffCapture({ domDiff: false });
    capture.record(1, tree(fiber(3), [updated({ title: 'a' }, { title: 'b' })]));
    expect(capture.enabled).toBe(false);
    expect(capture.byCommit).toEqual({});
  });
});

describe('buildDomDiffView', () => {
  const change = (op: '+' | '-' | '~', node: string, at: string) =>
    op === '~' ? { op, node, at, props: [['text', '"1"', '"2"']] as Array<[string, string | null, string | null]> } : { op, node, at, html: `<${node}></${node}>`, elements: 1 };
  const report = {
    domByCommit: {
      '7': { changes: [change('~', 'span', 'Header'), change('+', 'li', 'List › Row'), change('-', 'p', 'List › Row')], ms: 0.1 },
      '3': { changes: [change('+', 'main', 'App')], ms: 0.1 },
      '9': { changes: [change('~', 'span', 'Header')], ms: 0.1, truncated: true as const },
    },
    commitTimings: { '3': { startTime: 100 }, '7': { startTime: 142.04 }, '9': { startTime: 150 } },
  };

  it('lists commits in order and groups each commit by component, as one change set', () => {
    const view = buildDomDiffView(report);
    if ('error' in view) throw new Error(view.error);
    expect(view.commits.map((c) => [c.commitId, c.t])).toEqual([[3, 0], [7, 42], [9, 50]]);
    expect(view.text.split('\n')).toEqual([
      'Each commit is one change set: its changes reached the DOM together and have no order. Order is between commits.',
      '#3  +0ms · 1 change',
      '  App',
      '    + main  <main></main>',
      '#7  +42ms · 3 changes',
      '  Header',
      '    ~ span  text "1" → "2"',
      '  List › Row',
      '    + li  <li></li>',
      '    - p  <p></p>',
      '#9  +50ms · 1 change (commit truncated)',
      '  Header',
      '    ~ span  text "1" → "2"',
    ]);
  });

  it('filters by match and window, and caps commits and changes', () => {
    const matched = buildDomDiffView(report, { match: 'header' });
    if ('error' in matched) throw new Error(matched.error);
    expect(matched.commits.map((c) => c.commitId)).toEqual([7, 9]);
    expect(matched.commits[0].changes).toHaveLength(1);

    const windowed = buildDomDiffView(report, { fromCommit: 4, toCommit: 8, maxItems: 2 });
    if ('error' in windowed) throw new Error(windowed.error);
    expect(windowed.commits).toHaveLength(1);
    expect(windowed.commits[0]).toMatchObject({ commitId: 7, total: 3, t: 0 });
    expect(windowed.commits[0].changes).toHaveLength(2);
    expect(windowed.text).toContain('#7  +0ms · 2 of 3 changes');

    const capped = buildDomDiffView(report, { top: 1 });
    if ('error' in capped) throw new Error(capped.error);
    expect(capped.commitsTotal).toBe(3);
    expect(capped.text).toContain('… 2 more commits');

    expect(buildDomDiffView(report, { match: '(' })).toMatchObject({ error: expect.stringContaining('invalid match regex') });
  });

  it('reports commits the budget dropped and an empty capture', () => {
    const view = buildDomDiffView({ meta: { domDiff: { maxEntries: 1, entries: 0, commits: 0, evicted: { commits: 2, entries: 4, throughCommit: 5 } } } });
    if ('error' in view) throw new Error(view.error);
    expect(view.evicted).toEqual({ commits: 2, entries: 4, throughCommit: 5 });
    expect(view.text).toContain('Commits up to #5 may have lost their DOM changes');
    expect(view.text).toContain('No DOM changes recorded.');
  });
});
