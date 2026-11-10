// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { getComponentName } from '../avalanche/internals';
import { describeComponent, getDisplayName, isUserComponent, resolveFiberSource } from '../layout-lab/fiber-walk';
import { buildMinifiedBundle, DUPLICATE_TEXT_SOURCE, type MinifiedBundle } from '../test/minified-component-fixture';
import { listPageScripts, needsComponentOrigin, readComponentName } from './component-origin';
import { evalFindFibers, resolveFindFiberSources, warmFindFiberNames, type Fiber } from './eval-helpers';
import { captureFiberState } from './fiber-state';
import { evalAvalancheWithNames, sourceIdsIn } from './avalanche-commands';
import { humanSourceId } from '../avalanche/reporter';

type TestFiber = Fiber & {
  tag: number;
  key: string | null;
  memoizedProps: Record<string, unknown>;
  return: TestFiber | null;
  child: TestFiber | null;
  sibling: TestFiber | null;
};

const PAGE_URL = 'https://app.example.test/projects';

function fiber(type: unknown, parent: TestFiber | null = null, extra: Partial<TestFiber> = {}): TestFiber {
  const node: TestFiber = {
    tag: 0, key: null, type, elementType: type, memoizedProps: {}, return: parent, child: null, sibling: null, ...extra,
  };
  if (parent) {
    if (!parent.child) parent.child = node;
    else {
      let last = parent.child;
      while (last.sibling) last = last.sibling;
      last.sibling = node;
    }
  }
  return node;
}

function walkFrom(root: TestFiber) {
  return (visit: (node: Fiber) => void) => {
    const stack: TestFiber[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      visit(node);
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
  };
}

describe('production names through the page realm', () => {
  let bundle: MinifiedBundle;
  let dup: MinifiedBundle;
  let root: TestFiber;
  let list: TestFiber;
  let row: TestFiber;

  beforeAll(async () => {
    bundle = await buildMinifiedBundle('inline');
    dup = await buildMinifiedBundle('inline', 'dup.js', DUPLICATE_TEXT_SOURCE);
    // The page holds the minified bundles as inline scripts with inline maps.
    Object.assign(globalThis, {
      location: { href: PAGE_URL },
      document: { scripts: [{ src: '', text: bundle.code }, { src: '', text: dup.code }] },
      Element: globalThis.Element ?? class Element {},
    });
    root = fiber(null, null, { tag: 3 });
    list = fiber(bundle.exports.ProjectList, root);
    row = fiber(bundle.exports.ProjectRow, list, { key: 'a', memoizedProps: { label: 'a' } });
    fiber('li', row, { tag: 5 });
  });

  it('lists inline page scripts', () => {
    expect(listPageScripts()).toEqual([
      { key: 'inline:0', url: PAGE_URL, text: bundle.code },
      { key: 'inline:1', url: PAGE_URL, text: dup.code },
    ]);
  });

  it('shows minified names until the fiber is resolved, then the authored name and definition', async () => {
    const minified = (bundle.exports.ProjectList as { name: string }).name;
    expect(needsComponentOrigin(list)).toBe(true);
    expect(getDisplayName(list.type)).toBe(minified);

    await resolveFiberSource(list);

    expect(getDisplayName(list.type)).toBe('ProjectList');
    expect(getComponentName(list as never)).toBe('ProjectList');
    expect(describeComponent(list as never)).toMatchObject({
      name: 'ProjectList',
      minifiedName: minified,
      definition: { fileName: 'src/app.jsx', lineNumber: 3 },
    });
  });

  it('warms names before a find-fibers name filter and patches item origins', async () => {
    const walkAll = (visit: (node: Fiber) => void) => walkFrom(root)(visit);
    const stats = await warmFindFiberNames({ name: 'ProjectRow' }, { walkAll });
    // ProjectList was resolved by the previous test.
    expect(stats).toMatchObject({ types: 2, cached: 1, named: 1, skipped: 0 });

    const fibers = new Map<string, Fiber>();
    const result = evalFindFibers({ name: '^ProjectRow$' }, {
      walkAll,
      fiberInfo: (node) => {
        const name = readComponentName(node.type);
        return typeof node.type === 'string' || !name ? null : { name };
      },
    }, (node) => {
      const id = `fiber:${fibers.size + 1}`;
      fibers.set(id, node);
      return id;
    });
    expect(result.count).toBe(1);
    await resolveFindFiberSources(result.items, (id) => fibers.get(id), async () => null);
    expect(result.items[0]).toMatchObject({
      name: 'ProjectRow',
      minifiedName: (bundle.exports.ProjectRow as { name: string }).name,
      definition: { fileName: 'src/app.jsx', lineNumber: 7 },
    });
  });

  it('warms only fibers that pass the other find-fibers filters', async () => {
    const stats = await warmFindFiberNames({ name: 'Row', prop: 'label' }, { walkAll: walkFrom(root) });
    expect(stats).toMatchObject({ types: 1 });
    expect(await warmFindFiberNames({ name: 'Row', prop: 'missing' }, { walkAll: walkFrom(root) })).toBeNull();
  });

  it('skips warming without a name filter', async () => {
    expect(await warmFindFiberNames({ text: 'a' }, { walkAll: walkFrom(root) })).toBeNull();
  });

  it('keeps fiber-state ids on runtime names so captures compare across recovery', () => {
    const capture = captureFiberState({}, {
      getRootFibers: () => [root as never],
      getDisplayName: (node) => readComponentName(node.type),
    });
    const entry = capture.fibers.find((item) => item.name === 'ProjectRow')!;
    expect(entry.token).toContain(`|${(bundle.exports.ProjectRow as { name: string }).name}|`);
  });

  it('recovers names only for the components an Avalanche result names', async () => {
    const { Boundary: boundary, Fancy: fancy, MemoCard: card } = bundle.exports;
    expect(getComponentName({ type: boundary } as never)).not.toBe('Boundary');
    let sources: unknown[] = [boundary];
    const recorded = [boundary, fancy, card];
    const idOf = (type: unknown) => humanSourceId('x#1@2', type as never, 2);
    const api = {
      report: () => ({ sources: sources.map((type) => ({ sourceId: idOf(type), depth: 2 })) }),
      componentTypesFor: (ids: Iterable<string>) => {
        const wanted = new Set(ids);
        return recorded.filter((type) => wanted.has(idOf(type)));
      },
    };
    // Only Boundary is a source; Fancy and MemoCard were recorded but stay minified.
    const result = await evalAvalancheWithNames({ action: 'hot-sources' }, api as never, null);
    expect(result.nameRecovery).toMatchObject({ types: 1, named: 1 });
    expect(sourceIdsIn(result)).toEqual(['Boundary#1@2']);
    expect(getComponentName({ type: fancy } as never)).toBe('Anonymous');

    const again = await evalAvalancheWithNames({ action: 'hot-sources' }, api as never, null);
    expect(again.nameRecovery).toMatchObject({ types: 1, cached: 1, named: 0 });

    // Fancy and MemoCard share the minified id `Anonymous#1@2`, so both resolve.
    sources = [fancy];
    const shared = await evalAvalancheWithNames({ action: 'hot-sources' }, api as never, null);
    expect(shared.nameRecovery).toMatchObject({ types: 2, named: 2 });
    expect(sourceIdsIn(shared)).toEqual(['Fancy#1@2']);

    const reset = await evalAvalancheWithNames({ action: 'reset' }, { ...api, reset: () => {} } as never, null);
    expect(reset.nameRecovery).toBeUndefined();
  });

  it('collects report source ids from keys and values', () => {
    expect(sourceIdsIn({ a: ['cp#1@3', 'not an id'], 'eu#2@-1': { nested: 'x#1@0' } }).sort())
      .toEqual(['cp#1@3', 'eu#2@-1', 'x#1@0']);
    expect(sourceIdsIn(['a#1@1', 'b#1@1', 'c#1@1'], 2)).toHaveLength(2);
  });

  it('describes a component named from its ancestor with nameInferredFrom', async () => {
    const toolbar = fiber(dup.exports.Toolbar, root);
    const nav = fiber('nav', toolbar, { tag: 5 });
    const star = fiber(dup.exports.StarIcon, nav);
    await resolveFiberSource(star);
    expect(describeComponent(star as never)).toMatchObject({
      name: 'StarIcon',
      definition: { fileName: 'src/app.jsx', lineNumber: 2 },
      nameInferredFrom: { name: 'Toolbar', distance: 1, definition: { lineNumber: 11 } },
    });
  });

  it('treats nameless production components as user components', () => {
    const nameless = (() => () => null)();
    expect(nameless.name).toBe('');
    expect(isUserComponent({ type: nameless } as never)).toBe(true);
    expect(isUserComponent({ type: nameless, _debugStack: new Error('stack') } as never)).toBe(false);
    expect(isUserComponent({ type: 'div' } as never)).toBe(false);
  });

  it('leaves development fibers alone', () => {
    const named = function Named() { return null; };
    expect(needsComponentOrigin({ type: named, _debugStack: new Error('stack') })).toBe(false);
    expect(needsComponentOrigin({ type: Object.assign(() => null, { displayName: 'Shown' }) })).toBe(false);
    expect(needsComponentOrigin({ type: 'div' })).toBe(false);
  });
});
