import { describe, expect, it } from 'vitest';
import { captureFiberState, compareFiberStates, fingerprintFiberProp } from './fiber-state';

type TestFiber = {
  tag: number;
  key?: string | null;
  type: string | { displayName?: string; name?: string; _debugSource?: unknown };
  memoizedProps?: Record<string, unknown>;
  child?: TestFiber | null;
  sibling?: TestFiber | null;
  _debugSource?: unknown;
};

function name(fiber: TestFiber): string | null {
  if (typeof fiber.type === 'string') return fiber.type;
  return fiber.type.displayName || fiber.type.name || null;
}

function capture(root: TestFiber, page = 'http://example.test/a') {
  return captureFiberState({ page: { url: page, title: 'Fixture' } }, {
    getRootFibers: () => [root],
    getDisplayName: (fiber) => name(fiber as TestFiber),
  });
}

describe('fiber state capture', () => {
  it('captures every named fiber with stable path identity and prop fingerprints', () => {
    const sibling: TestFiber = { tag: 5, type: 'button', memoizedProps: { disabled: false } };
    const child: TestFiber = { tag: 0, type: { name: 'Feature' }, key: 'feature', memoizedProps: { gate: 'on' }, sibling };
    const root: TestFiber = { tag: 3, type: { name: 'App' }, memoizedProps: { version: 1 }, child };
    const state = capture(root);

    expect(state.fiberCount).toBe(3);
    expect(state.fibers.map((fiber) => fiber.name)).toEqual(['App', 'Feature', 'button']);
    expect(state.fibers[1].key).toBe('feature');
    expect(state.fibers[1].props.gate).toMatchObject({ kind: 'string', preview: '"on"', truncated: false });
    expect(state.fibers[1].id).toContain(state.fibers[0].id);
  });

  it('bounds capture count and marks truncation', () => {
    const root: TestFiber = { tag: 0, type: { name: 'A' }, child: { tag: 0, type: { name: 'B' } } };
    const state = captureFiberState({ maxFibers: 1 }, {
      getRootFibers: () => [root],
      getDisplayName: (fiber) => name(fiber as TestFiber),
    });
    expect(state).toMatchObject({ fiberCount: 1, truncated: true });
  });

  it('normalizes FiberRoot.current and does not capture its alternate twice', () => {
    const alternate: TestFiber = { tag: 0, type: { name: 'App' }, memoizedProps: { value: 'stale' } };
    const current = { tag: 0, type: { name: 'App' }, memoizedProps: { value: 'current' }, alternate } as TestFiber & { alternate: TestFiber };
    (alternate as TestFiber & { alternate?: TestFiber }).alternate = current;
    const state = captureFiberState({}, {
      getRootFibers: () => [{ current } as never, alternate as never],
      getDisplayName: (fiber) => name(fiber as TestFiber),
    });
    expect(state.fiberCount).toBe(1);
    expect(state.fibers[0].props.value.preview).toBe('"current"');
  });

  it('uses informative shallow previews while treating DOM nodes as stable opaque props', () => {
    const dom = { nodeType: 1, nodeName: 'DIV', id: 'canvas', getAttribute: () => 'story-root', mutable: 1 };
    expect(fingerprintFiberProp(['approvals: ', 2]).preview).toBe('["approvals: ", 2]');
    const before = fingerprintFiberProp(dom);
    dom.mutable = 2;
    expect(fingerprintFiberProp(dom).hash).toBe(before.hash);
  });

  it('fingerprints object structure deterministically and handles cycles', () => {
    const left: Record<string, unknown> = { b: 2, a: 1 };
    left.self = left;
    const right: Record<string, unknown> = { a: 1, b: 2 };
    right.self = right;
    expect(fingerprintFiberProp(left).hash).toBe(fingerprintFiberProp(right).hash);
    expect(fingerprintFiberProp({ a: 2 }).hash).not.toBe(fingerprintFiberProp({ a: 1 }).hash);
  });
});

describe('fiber state comparison', () => {
  it('reports prop-to-prop changes and added fibers without returning full states', () => {
    const before = capture({
      tag: 0,
      type: { name: 'App' },
      memoizedProps: { gate: false, stable: 'yes', removed: 1 },
    }, 'http://example.test/off');
    const after = capture({
      tag: 0,
      type: { name: 'App' },
      memoizedProps: { gate: true, stable: 'yes', added: 2 },
      child: { tag: 0, type: { name: 'GateContent' }, memoizedProps: { label: 'new' } },
    }, 'http://example.test/on');

    const diff = compareFiberStates(before, after);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.summary).toMatchObject({ changedFibers: 1, addedFibers: 1, removedFibers: 0, propChanges: 3 });
    expect(diff.changes[0]).toMatchObject({
      kind: 'props-changed',
      props: {
        added: [{ name: 'added' }],
        removed: [{ name: 'removed' }],
        changed: [{ name: 'gate' }],
      },
    });
    expect(JSON.stringify(diff)).not.toContain('"fibers"');
  });

  it('matches a unique fiber across different parent structure', () => {
    const before = capture({ tag: 0, type: { name: 'App' }, child: { tag: 0, type: { name: 'Leaf' }, memoizedProps: { value: 1 } } });
    const after = capture({
      tag: 0,
      type: { name: 'App' },
      child: { tag: 0, type: { name: 'Wrapper' }, child: { tag: 0, type: { name: 'Leaf' }, memoizedProps: { value: 2 } } },
    });
    const diff = compareFiberStates(before, after);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    const leaf = diff.changes.find((change) => change.kind === 'props-changed');
    expect(leaf).toMatchObject({ match: 'unique-token' });
  });

  it('keeps several changed props on one fiber in one untruncated record', () => {
    const before = capture({ tag: 0, type: { name: 'App' }, memoizedProps: { a: 1, b: 2, c: 3 } });
    const after = capture({ tag: 0, type: { name: 'App' }, memoizedProps: { a: 2, b: 3, c: 4 } });
    const diff = compareFiberStates(before, after, { maxChanges: 1 });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.summary).toMatchObject({ propChanges: 3, returnedChanges: 1, captureTruncated: false, changesTruncated: false, truncated: false });
    expect(diff.changes).toHaveLength(1);
  });

  it('caps diff records while preserving totals and explicit truncation signals', () => {
    const before = capture({
      tag: 0,
      type: { name: 'App' },
      memoizedProps: { value: 1 },
      child: { tag: 0, type: { name: 'Leaf' }, memoizedProps: { value: 'before' } },
    });
    const after = capture({
      tag: 0,
      type: { name: 'App' },
      memoizedProps: { value: 2 },
      child: { tag: 0, type: { name: 'Leaf' }, memoizedProps: { value: 'after' } },
    });
    const diff = compareFiberStates(before, after, { maxChanges: 1 });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.summary).toMatchObject({
      changedFibers: 2,
      propChanges: 2,
      returnedChanges: 1,
      captureTruncated: false,
      changesTruncated: true,
      truncated: true,
    });
    expect(diff.changes).toHaveLength(1);
  });

  it('rejects malformed captures instead of guessing their shape', () => {
    expect(compareFiberStates({} as never, {} as never)).toEqual({
      ok: false,
      error: 'Two valid fiber state captures are required',
    });
  });
});
