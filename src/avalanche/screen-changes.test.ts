import { describe, expect, it } from 'vitest';
import type { Rect } from '../chippy-bridge/component-area/area-grid';
import { createScreenCapture, findChangedHosts, visiblePropsChanged, Visibility, type ScreenGeometry } from './screen-changes';
import { ChildDeletion, Placement, Update, type Fiber } from './internals';

type F = Fiber & { stateNode?: unknown };

// Fibers are "already mounted" (they have an alternate) unless a test says otherwise.
const MOUNTED = { memoizedProps: {} } as F;

function fiber(tag: number, props: Partial<F> = {}): F {
  return { tag, type: tag === 5 ? 'div' : null, alternate: MOUNTED, return: null, child: null, sibling: null, flags: 0, subtreeFlags: 0, lanes: 0, memoizedState: null, updateQueue: null, ...props } as F;
}

// Links children and propagates subtreeFlags upward, as React does.
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

function element(testId?: string): HTMLElement {
  const el = document.createElement('div');
  if (testId) el.setAttribute('data-testid', testId);
  document.body.appendChild(el);
  return el;
}

function geometry(rects: Map<Node, Rect>): ScreenGeometry {
  return { viewport: () => ({ left: 0, top: 0, right: 1000, bottom: 500 }), rect: (node) => rects.get(node) ?? null, now: () => 0 };
}

describe('visiblePropsChanged', () => {
  it('ignores handlers, refs, and element children; sees class, style, and text', () => {
    const onClick = () => {};
    expect(visiblePropsChanged({ className: 'a', onClick, children: [{}] }, { className: 'a', onClick: () => {}, children: [{}] })).toBe(false);
    expect(visiblePropsChanged({ style: { color: 'red' } }, { style: { color: 'red' } })).toBe(false);
    expect(visiblePropsChanged({ style: { color: 'red' } }, { style: { color: 'blue' } })).toBe(true);
    expect(visiblePropsChanged({ className: 'a' }, { className: 'b' })).toBe(true);
    expect(visiblePropsChanged({ children: 'one' }, { children: 'two' })).toBe(true);
    expect(visiblePropsChanged({ title: 'x' }, {})).toBe(true);
  });
});

describe('findChangedHosts', () => {
  it('takes the topmost node of a placed subtree and skips subtrees without mutations', () => {
    const placedEl = element();
    const inner = fiber(5, { stateNode: element() });
    const placed = tree(fiber(5, { stateNode: placedEl, flags: Placement }), [inner]);
    const quiet = fiber(5, { stateNode: element() });
    const component = tree(fiber(0, { flags: Placement }), [placed]);
    const root = tree(fiber(3), [tree(fiber(5, { stateNode: element() }), [component, quiet])]);
    const { found } = findChangedHosts(root);
    expect(found.map((f) => f.node)).toEqual([placedEl]);
  });

  it('takes a fresh mount whose Placement flag React already cleared', () => {
    const mountedEl = element();
    const fresh = tree(fiber(0, { alternate: null }), [fiber(5, { stateNode: mountedEl, alternate: null })]);
    const hiddenPrimary = tree(fiber(22, { alternate: null, memoizedState: { hidden: true } as never }), [fiber(5, { stateNode: element(), alternate: null })]);
    // The parent keeps the bubbled Placement bit in its subtree flags.
    const parent = fiber(5, { stateNode: element() });
    parent.child = fresh; fresh.return = parent; fresh.sibling = hiddenPrimary; hiddenPrimary.return = parent;
    parent.subtreeFlags = Placement;
    const root = tree(fiber(3), [parent]);
    expect(findChangedHosts(root).found.map((f) => f.node)).toEqual([mountedEl]);
  });

  it('counts a host update only when visible props changed', () => {
    const changedEl = element();
    const same = fiber(5, { stateNode: element(), flags: Update, memoizedProps: { onClick: () => {} }, alternate: fiber(5, { memoizedProps: { onClick: () => {} } }) });
    const changed = fiber(5, { stateNode: changedEl, flags: Update, memoizedProps: { className: 'b' }, alternate: fiber(5, { memoizedProps: { className: 'a' } }) });
    const root = tree(fiber(3), [same, changed]);
    expect(findChangedHosts(root).found.map((f) => f.node)).toEqual([changedEl]);
  });

  it('marks deleted subtrees and hidden Offscreen content as removed', () => {
    const goneEl = element();
    const hiddenEl = element();
    const parent = fiber(5, { stateNode: element(), flags: ChildDeletion, deletions: [fiber(5, { stateNode: goneEl })] });
    const offscreen = tree(fiber(22, { flags: Visibility, memoizedState: { hidden: true } as never }), [fiber(5, { stateNode: hiddenEl })]);
    const root = tree(fiber(3), [parent, offscreen]);
    const found = findChangedHosts(root).found;
    expect(found.map((f) => [f.node, f.removed])).toEqual(expect.arrayContaining([[goneEl, true], [hiddenEl, true]]));
  });

  it('stops at the node limit', () => {
    const children = Array.from({ length: 5 }, () => fiber(5, { stateNode: element(), flags: Placement }));
    const result = findChangedHosts(tree(fiber(3), children), 3);
    expect(result.found).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe('createScreenCapture', () => {
  it('records changed area, regions, and removals from the last measured box', () => {
    const body = element('body');
    const rects = new Map<Node, Rect>([[body, { left: 0, top: 100, right: 500, bottom: 300 }]]);
    const capture = createScreenCapture({}, geometry(rects));

    const placed = fiber(5, { stateNode: body, flags: Placement });
    capture.record(1, tree(fiber(3), [placed]));
    expect(capture.byCommit[1]).toMatchObject({ viewport: [1000, 500], removedArea: 0, nodes: 1, rects: [[0, 100, 500, 300]], regions: [{ label: 'body' }] });
    expect(capture.byCommit[1].area).toBeGreaterThan(95_000);
    expect(capture.byCommit[1].share).toBeCloseTo(0.2, 1);

    rects.delete(body);
    const parent = fiber(5, { stateNode: element(), flags: ChildDeletion, deletions: [fiber(5, { stateNode: body })] });
    capture.record(2, tree(fiber(3), [parent]));
    expect(capture.byCommit[2].area).toBe(0);
    expect(capture.byCommit[2].removedArea).toBeGreaterThan(95_000);
  });

  it('records nothing for commits that changed no box', () => {
    const capture = createScreenCapture({}, geometry(new Map()));
    capture.record(1, tree(fiber(3), [fiber(0, { flags: 1 })]));
    expect(capture.byCommit).toEqual({});
  });

  it('can be switched off', () => {
    const capture = createScreenCapture({ screenCapture: false }, geometry(new Map()));
    expect(capture.enabled).toBe(false);
  });
});
