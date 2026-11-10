// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  combineOccurrences,
  componentFunctionOf,
  createComponentOriginResolver,
  type ComponentOriginResolver,
  type ScriptRef,
} from './component-origin';
import { createModuleMapCache } from './module-maps';
import { buildMinifiedBundle, DUPLICATE_TEXT_SOURCE, type MinifiedBundle } from '../test/minified-component-fixture';

const BUNDLE_URL = 'https://app.example.test/assets/index-3f9a.js';
const MAP_URL = `${BUNDLE_URL}.map`;

describe('production component origin recovery', () => {
  let bundle: MinifiedBundle;
  let resolver: ComponentOriginResolver;
  let fetched: string[];

  beforeAll(async () => {
    bundle = await buildMinifiedBundle();
  });

  function freshResolver(scripts?: ScriptRef[], files: Record<string, string> = {}) {
    fetched = [];
    const served: Record<string, string> = { [BUNDLE_URL]: bundle.code, [MAP_URL]: bundle.map, ...files };
    const modules = createModuleMapCache(async (url) => {
      fetched.push(url);
      return served[url] ?? null;
    });
    return createComponentOriginResolver({
      listScripts: () => scripts ?? [{ key: BUNDLE_URL, url: BUNDLE_URL, text: null }],
      modules,
    });
  }

  it('minifies names away in the fixture', () => {
    const list = bundle.exports.ProjectList as { name: string };
    expect(list.name).not.toBe('ProjectList');
  });

  it.each([
    ['ProjectList', 'ProjectList', 'map-name', 3],
    ['ProjectRow', 'ProjectRow', 'binding-map-name', 7],
    ['MemoCard', 'Card', 'source-text', 8],
    ['Fancy', 'Fancy', 'binding-map-name', 9],
    ['Boundary', 'Boundary', 'source-text', 10],
    ['AnonymousMemo', 'AnonymousMemo', 'binding-map-name', 11],
  ])('recovers %s as %s from %s', async (exported, name, evidence, line) => {
    resolver = freshResolver();
    const origin = await resolver.resolve(bundle.exports[exported]);
    expect(origin).toMatchObject({
      status: 'resolved',
      name,
      script: BUNDLE_URL,
      definition: { fileName: 'assets/src/app.jsx', lineNumber: line },
    });
    expect(origin.nameEvidence).toBe(evidence);
    expect(origin.generated?.line).toBe(1);
  });

  it('caches per component function and exposes results synchronously', async () => {
    resolver = freshResolver();
    expect(resolver.peek(bundle.exports.ProjectList)).toBeNull();
    const first = resolver.resolve(bundle.exports.ProjectList);
    expect(resolver.resolve(bundle.exports.ProjectList)).toBe(first);
    await first;
    expect(resolver.peek(bundle.exports.ProjectList)?.name).toBe('ProjectList');
    await resolver.resolve(bundle.exports.ProjectRow);
    expect(fetched).toEqual([BUNDLE_URL, MAP_URL]);
    expect(resolver.stats).toMatchObject({ functions: 2, resolved: 2 });
  });

  it('reports no-source-map when the bundle has no map', async () => {
    resolver = freshResolver(undefined, { [MAP_URL]: undefined as unknown as string });
    const origin = await resolver.resolve(bundle.exports.ProjectList);
    expect(origin).toMatchObject({ status: 'no-source-map', name: null, script: BUNDLE_URL, definition: null });
  });

  it('reports not-found when no loaded script holds the function', async () => {
    resolver = freshResolver([{ key: 'inline:0', url: 'https://app.example.test/', text: 'console.log(1)' }]);
    const origin = await resolver.resolve(bundle.exports.ProjectList);
    expect(origin.status).toBe('not-found');
  });

  it('counts every occurrence of repeated function text', async () => {
    const text = 'function a(){return "same component body"}\nfunction a(){return "same component body"}';
    const fn = new Function(`return ${text.split('\n')[0]}`)();
    resolver = freshResolver([{ key: 'inline:0', url: 'https://app.example.test/', text }]);
    expect(await resolver.resolve(fn)).toMatchObject({ status: 'no-source-map', occurrences: 2 });
  });

  it('reads inline scripts without fetching', async () => {
    resolver = freshResolver([{ key: 'inline:0', url: 'https://app.example.test/assets/', text: bundle.code.replace(/\/\/# sourceMappingURL=.*$/m, '') }]);
    const origin = await resolver.resolve(bundle.exports.ProjectList);
    expect(origin).toMatchObject({ status: 'no-source-map', script: 'inline:0' });
    expect(fetched).toEqual([]);
  });

  it('rejects host strings, native functions, and unknown objects', async () => {
    resolver = freshResolver();
    expect((await resolver.resolve('div')).status).toBe('unsupported');
    expect((await resolver.resolve(Math.max)).status).toBe('unsupported');
    expect((await resolver.resolve({})).status).toBe('unsupported');
  });
});

describe('componentFunctionOf', () => {
  it('unwraps memo, forwardRef, and nested wrappers', () => {
    const render = () => null;
    expect(componentFunctionOf(render)).toBe(render);
    expect(componentFunctionOf({ render })).toBe(render);
    expect(componentFunctionOf({ type: { render } })).toBe(render);
    expect(componentFunctionOf({ type: render })).toBe(render);
    expect(componentFunctionOf('div')).toBeNull();
  });
});

describe('identical function text from separately mangled scopes', () => {
  const DUP_URL = 'https://app.example.test/assets/dup.js';
  let dup: MinifiedBundle;
  let resolver: ComponentOriginResolver;

  beforeAll(async () => {
    dup = await buildMinifiedBundle('linked', 'dup.js', DUPLICATE_TEXT_SOURCE);
  });

  function dupResolver() {
    const served: Record<string, string> = { [DUP_URL]: dup.code, [`${DUP_URL}.map`]: dup.map };
    return createComponentOriginResolver({
      listScripts: () => [{ key: DUP_URL, url: DUP_URL, text: null }],
      modules: createModuleMapCache(async (url) => served[url] ?? null),
    });
  }

  it('minifies the components to identical text', () => {
    expect(String(dup.exports.StarIcon)).toBe(String(dup.exports.HeartIcon));
    expect(String(dup.exports.Badge)).toBe(String(dup.exports.StarIcon).replace('"i"', '"b"'));
  });

  it('reports ambiguous with candidates when occurrences map to different names', async () => {
    resolver = dupResolver();
    const origin = await resolver.resolve(dup.exports.StarIcon);
    expect(origin).toMatchObject({ status: 'ambiguous', name: null, definition: null, occurrences: 2 });
    expect(origin.candidates?.map((item) => [item.name, item.definition?.lineNumber])).toEqual([
      ['StarIcon', 2],
      ['HeartIcon', 3],
    ]);
  });

  it('keeps the name when every occurrence maps to it, without picking a definition', async () => {
    resolver = dupResolver();
    const origin = await resolver.resolve(dup.exports.Badge);
    expect(origin).toMatchObject({ status: 'resolved', name: 'Badge', definition: null, occurrences: 2 });
    expect(origin.candidates?.map((item) => item.definition?.lineNumber)).toEqual([4, 5]);
  });
});

describe('combineOccurrences', () => {
  const at = (name: string | null, line: number, status: 'resolved' | 'no-source-map' = 'resolved') => ({
    status, name, nameEvidence: name ? ('map-name' as const) : null, script: 'a.js',
    definition: status === 'resolved' ? { fileName: 'src/a.jsx', lineNumber: line, columnNumber: 1 } : null,
    generated: { line: 1, column: line },
  });

  it('treats one authored definition emitted twice as resolved', () => {
    expect(combineOccurrences([at('Row', 3), at('Row', 3)], { generatedName: 'a' }, 2)).toMatchObject({
      status: 'resolved', name: 'Row', definition: { lineNumber: 3 }, occurrences: 2,
    });
  });

  it('keeps no-source-map when no occurrence has a map', () => {
    const origin = combineOccurrences([at(null, 1, 'no-source-map'), at(null, 2, 'no-source-map')], { generatedName: 'a' }, 2);
    expect(origin).toMatchObject({ status: 'no-source-map', occurrences: 2 });
    expect(origin.candidates).toBeUndefined();
  });
});
