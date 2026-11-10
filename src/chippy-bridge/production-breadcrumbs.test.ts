// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createComponentOriginResolver, type ComponentOriginResolver } from './component-origin';
import { createModuleMapCache } from './module-maps';
import { resolveFiberComponentOrigin, type ContextFiber } from './fiber-origin';
import { limitsOf, productionBreadcrumbs, whereToLookFor } from './production-breadcrumbs';
import { buildMinifiedBundle, DUPLICATE_TEXT_SOURCE, type MinifiedBundle } from '../test/minified-component-fixture';

const DUP_URL = 'https://app.example.test/assets/dup.js';

/** A parent chain `types[0] > types[1] > …`; returns the innermost fiber. */
function chain(...types: unknown[]): ContextFiber {
  let parent: ContextFiber | null = null;
  for (const type of types) parent = { type, return: parent };
  return parent!;
}

describe('production breadcrumbs', () => {
  let dup: MinifiedBundle;
  let exports: Record<string, unknown>;

  beforeAll(async () => {
    dup = await buildMinifiedBundle('linked', 'dup.js', DUPLICATE_TEXT_SOURCE);
    exports = dup.exports;
  });

  function resolverServing(served: Record<string, string>): ComponentOriginResolver {
    return createComponentOriginResolver({
      listScripts: () => [{ key: DUP_URL, url: DUP_URL, text: null }],
      modules: createModuleMapCache(async (url) => served[url] ?? null),
    });
  }

  const withMap = () => resolverServing({ [DUP_URL]: dup.code, [`${DUP_URL}.map`]: dup.map });

  async function crumbs(fiber: ContextFiber, resolver: ComponentOriginResolver) {
    await resolveFiberComponentOrigin(fiber, resolver);
    return productionBreadcrumbs(fiber as never, resolver)!;
  }

  it('reports an exact definition and the strings in the component code', async () => {
    const result = await crumbs(chain(null, exports.Toolbar), withMap());
    expect(result.whereToLook).toEqual([
      expect.objectContaining({ file: 'assets/src/app.jsx', line: 11, name: 'Toolbar', confidence: 'exact', why: 'definition' }),
    ]);
    expect(result.grep).toContain('data-testid="toolbar"');
    expect(result.script).toMatchObject({ url: DUP_URL });
    expect(result.limits).toEqual([]);
  });

  it('ranks the inferred definition first, then the other identical code, then the ancestor', async () => {
    const result = await crumbs(chain(null, exports.Toolbar, 'nav', exports.StarIcon), withMap());
    expect(result.whereToLook).toEqual([
      expect.objectContaining({ line: 2, name: 'StarIcon', confidence: 'inferred', why: "Toolbar's code references StarIcon" }),
      expect.objectContaining({ line: 3, name: 'HeartIcon', confidence: 'possible', why: 'identical minified code' }),
      expect.objectContaining({ line: 11, name: 'Toolbar', confidence: 'inferred' }),
    ]);
    expect(result.limits[0]).toMatch(/name inferred from Toolbar's code; identical code maps to 2 components/);
  });

  it('lists every candidate as possible when no ancestor settles the name', async () => {
    const result = await crumbs(chain(null, exports.Both, 'p', exports.HeartIcon), withMap());
    expect(result.whereToLook.map((lead) => [lead.name, lead.line, lead.confidence])).toEqual([
      ['StarIcon', 2, 'possible'],
      ['HeartIcon', 3, 'possible'],
    ]);
    expect(result.limits[0]).toMatch(/identical minified code maps to 2 components/);
  });

  it('lists each definition that shares a name and code', async () => {
    const result = await crumbs(chain(null, exports.Badge), withMap());
    expect(result.whereToLook.map((lead) => [lead.line, lead.confidence])).toEqual([[4, 'possible'], [5, 'possible']]);
    expect(result.limits[0]).toMatch(/2 definitions share this name and code/);
  });

  it('states the limit and keeps the strings when the page serves no source map', async () => {
    const result = await crumbs(chain(null, exports.Wrapper), resolverServing({ [DUP_URL]: dup.code }));
    expect(result.whereToLook).toEqual([]);
    expect(result.grep).toEqual(['wrap']);
    expect(result.script).toMatchObject({ url: DUP_URL, line: expect.any(Number) });
    expect(result.limits).toEqual([`no source map for ${DUP_URL}: file unknown; search for the grep strings`]);
  });

  it('names the nearest error boundary above the component', async () => {
    class Guard { static getDerivedStateFromError() { return {}; } }
    const fiber = chain(null, Guard, 'div', exports.Wrapper);
    const result = await crumbs(fiber, withMap());
    expect(result.errorBoundary).toEqual({ name: 'Guard', distance: 2 });
  });

  it('says when the origin was never resolved, and skips development fibers', () => {
    const resolver = withMap();
    expect(productionBreadcrumbs(chain(null, exports.Wrapper) as never, resolver)!.limits[0]).toMatch(/not resolved/);
    expect(productionBreadcrumbs({ type: exports.Wrapper, _debugSource: {} } as never, resolver)).toBeNull();
    expect(productionBreadcrumbs({ type: 'div' } as never, resolver)).toBeNull();
  });

  it('warns that a truncated candidate list may miss the definition', () => {
    expect(limitsOf({
      status: 'ambiguous', name: null, nameEvidence: null, generatedName: null, definition: null,
      script: DUP_URL, generated: null, occurrences: 4096, candidates: [], truncated: true,
    }, 0)).toEqual([
      'identical minified code maps to 0 components; name and file are one of the possible locations',
      expect.stringMatching(/may be missing/),
    ]);
    expect(whereToLookFor(null)).toEqual([]);
  });
});
