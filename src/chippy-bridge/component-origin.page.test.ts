// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { getComponentName } from '../avalanche/internals';
import { describeComponent, getDisplayName, isUserComponent, resolveFiberSource } from '../layout-lab/fiber-walk';
import { buildMinifiedBundle, type MinifiedBundle } from '../test/minified-component-fixture';
import { listPageScripts, needsComponentOrigin, readComponentName } from './component-origin';
import { evalFindFibers, resolveFindFiberSources, warmFindFiberNames, type Fiber } from './eval-helpers';
import { captureFiberState } from './fiber-state';
import { warmAvalancheNames } from './avalanche-commands';

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
  let root: TestFiber;
  let list: TestFiber;
  let row: TestFiber;

  beforeAll(async () => {
    bundle = await buildMinifiedBundle('inline');
    // The page holds the minified bundle as an inline script with an inline map.
    Object.assign(globalThis, {
      location: { href: PAGE_URL },
      document: { scripts: [{ src: '', text: bundle.code }] },
      Element: globalThis.Element ?? class Element {},
    });
    root = fiber(null, null, { tag: 3 });
    list = fiber(bundle.exports.ProjectList, root);
    row = fiber(bundle.exports.ProjectRow, list, { key: 'a', memoizedProps: { label: 'a' } });
    fiber('li', row, { tag: 5 });
  });

  it('lists inline page scripts', () => {
    expect(listPageScripts()).toEqual([{ key: 'inline:0', url: PAGE_URL, text: bundle.code }]);
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
    expect(stats).toMatchObject({ types: 2, named: 2, skipped: 0 });

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

  it('recovers names for the component types Avalanche recorded', async () => {
    const fancy = bundle.exports.Fancy;
    expect(getComponentName({ type: fancy } as never)).not.toBe('Fancy');
    const stats = await warmAvalancheNames({ componentTypes: () => [fancy, 'div'] });
    expect(stats).toMatchObject({ types: 1, named: 1 });
    expect(getComponentName({ type: fancy } as never)).toBe('Fancy');
    expect(await warmAvalancheNames({})).toBeNull();
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
