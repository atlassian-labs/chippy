// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  combineOccurrences,
  createComponentOriginResolver,
  MAX_OCCURRENCES,
  type ComponentOriginResolver,
} from './component-origin';
import { createModuleMapCache } from './module-maps';
import { nameFromAncestors, resolveFiberComponentOrigin, warmComponentNames, type ContextFiber } from './fiber-origin';
import { buildMinifiedBundle, DUPLICATE_TEXT_SOURCE, type MinifiedBundle } from '../test/minified-component-fixture';

const DUP_URL = 'https://app.example.test/assets/dup.js';

type TreeFiber = ContextFiber & { child?: TreeFiber | null; sibling?: TreeFiber | null };

/** A parent chain `types[0] > types[1] > …`; returns the innermost fiber. */
function chain(...types: unknown[]): TreeFiber {
  let parent: TreeFiber | null = null;
  for (const type of types) {
    const node: TreeFiber = { type, return: parent };
    if (parent) parent.child = node;
    parent = node;
  }
  return parent!;
}

function rootOf(fiber: TreeFiber): TreeFiber {
  let node = fiber;
  while (node.return) node = node.return as TreeFiber;
  return node;
}

function walkTrees(...leaves: TreeFiber[]) {
  return (visit: (fiber: ContextFiber) => void) => {
    for (const leaf of leaves) {
      for (let node: TreeFiber | null | undefined = rootOf(leaf); node; node = node.child) visit(node);
    }
  };
}

describe('naming ambiguous components from fiber context', () => {
  let dup: MinifiedBundle;
  let exports: Record<string, unknown>;
  let resolver: ComponentOriginResolver;

  beforeAll(async () => {
    dup = await buildMinifiedBundle('linked', 'dup.js', DUPLICATE_TEXT_SOURCE);
    exports = dup.exports;
  });

  function fresh() {
    const served: Record<string, string> = { [DUP_URL]: dup.code, [`${DUP_URL}.map`]: dup.map };
    resolver = createComponentOriginResolver({
      listScripts: () => [{ key: DUP_URL, url: DUP_URL, text: null }],
      modules: createModuleMapCache(async (url) => served[url] ?? null),
    });
    return resolver;
  }

  it('keeps the icons identical and ambiguous by text alone', async () => {
    expect(String(exports.StarIcon)).toBe(String(exports.HeartIcon));
    expect((await fresh().resolve(exports.StarIcon)).status).toBe('ambiguous');
  });

  it('reads the names an ancestor component references', async () => {
    const references = await fresh().references(exports.Toolbar);
    expect(references?.has('StarIcon')).toBe(true);
    expect(references?.has('HeartIcon')).toBe(false);
    expect(await resolver.references(exports.StarIcon)).toBeNull();
  });

  it('names the component from the nearest ancestor that references one candidate', async () => {
    const star = chain(null, exports.Toolbar, 'nav', exports.StarIcon);
    const origin = await resolveFiberComponentOrigin(star, fresh());
    expect(origin).toMatchObject({
      status: 'resolved',
      name: 'StarIcon',
      nameEvidence: 'ancestor-reference',
      definition: { fileName: 'assets/src/app.jsx', lineNumber: 2 },
      context: { name: 'Toolbar', distance: 1 },
    });
    expect(resolver.peek(exports.StarIcon)?.name).toBe('StarIcon');
  });

  it('walks past ancestors that only pass children through', async () => {
    const heart = chain(null, exports.Favorites, 'section', exports.Wrapper, 'div', exports.HeartIcon);
    const origin = await resolveFiberComponentOrigin(heart, fresh());
    expect(origin).toMatchObject({
      name: 'HeartIcon',
      definition: { lineNumber: 3 },
      context: { name: 'Favorites', distance: 2 },
    });
  });

  it('stays ambiguous when the nearest referencing ancestor references several candidates', async () => {
    const star = chain(null, exports.Toolbar, exports.Both, 'p', exports.StarIcon);
    const origin = await resolveFiberComponentOrigin(star, fresh());
    expect(origin).toMatchObject({ status: 'ambiguous', name: null });
  });

  it('stays ambiguous without a referencing ancestor', async () => {
    const r = fresh();
    const origin = await r.resolve(exports.StarIcon);
    expect(await nameFromAncestors(chain(null, 'div', exports.StarIcon), origin, r)).toBeNull();
  });

  it('refuses to infer from a truncated candidate list', async () => {
    const r = fresh();
    const origin = await r.resolve(exports.StarIcon);
    const truncated = { ...origin, truncated: true as const };
    expect(await nameFromAncestors(chain(null, exports.Toolbar, exports.StarIcon), truncated, r)).toBeNull();
  });

  it('names ambiguous types from sample fibers during a warm pass', async () => {
    const star = chain(null, exports.Toolbar, 'nav', exports.StarIcon);
    const heart = chain(null, exports.Favorites, exports.Wrapper, exports.HeartIcon);
    const stats = await warmComponentNames(walkTrees(star, heart), 3000, fresh());
    expect(stats).toMatchObject({ byContext: 2 });
    expect(resolver.peek(exports.StarIcon)?.name).toBe('StarIcon');
    expect(resolver.peek(exports.HeartIcon)?.name).toBe('HeartIcon');
  });
});

describe('truncated occurrence search', () => {
  const at = (name: string, line: number) => ({
    status: 'resolved' as const, name, nameEvidence: 'map-name' as const, script: 'a.js',
    definition: { fileName: 'src/a.jsx', lineNumber: line, columnNumber: 1 }, generated: { line: 1, column: line },
  });

  it('marks ambiguous results that hit the occurrence cap', () => {
    expect(combineOccurrences([at('A', 1), at('B', 2)], { generatedName: 'a' }, 2).truncated).toBeUndefined();
    expect(combineOccurrences([at('A', 1), at('B', 2)], { generatedName: 'a' }, MAX_OCCURRENCES).truncated).toBe(true);
  });
});
