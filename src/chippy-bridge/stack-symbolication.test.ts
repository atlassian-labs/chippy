// @vitest-environment node
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createStackSymbolicator, symbolicateDebugHookPayload, type FetchText } from './stack-symbolication';

const APP = `import { useMemo } from 'react';
function useThing(seed) {
  return useMemo(() => seed + 1, [seed]);
}
export function Widget(props) {
  const value = useThing(props.seed);
  return value;
}
`;

const REACT = `export function renderWithHooks(Component, props) {
  return Component(props);
}
`;

function bundle(source: string, sourcefile: string, mapName: string) {
  const out = transformSync(source, { minify: true, sourcemap: 'external', sourcefile, loader: 'ts', format: 'esm' });
  return { code: `${out.code}//# sourceMappingURL=${mapName}\n`, map: out.map };
}

const app = bundle(APP, 'src/app.tsx', 'app.js.map');
const react = bundle(REACT, 'node_modules/react-dom/cjs/react-dom.production.js', 'react.js.map');
const forked = bundle(REACT, 'node_modules/react-dom-fork/cjs/react-dom.profiling.min.js', 'forked.js.map');

const files: Record<string, string> = {
  'https://cdn.test/app.js': app.code,
  'https://cdn.test/app.js.map': app.map,
  'https://cdn.test/react.js': react.code,
  'https://cdn.test/react.js.map': react.map,
  'https://cdn.test/forked.js': forked.code,
  'https://cdn.test/forked.js.map': forked.map,
};

function fakeFetch(): FetchText & { calls: string[] } {
  const calls: string[] = [];
  const fetchText = (async (url, { tail }) => {
    calls.push(url);
    const text = files[url];
    if (text === undefined) return null;
    return tail ? text.slice(-tail) : text;
  }) as FetchText & { calls: string[] };
  fetchText.calls = calls;
  return fetchText;
}

/** `line:column` (1-based) of `needle` in single-line minified code. */
function locOf(code: string, needle: string): string {
  const index = code.indexOf(needle);
  if (index < 0) throw new Error(`missing ${needle}`);
  return `1:${index + 1}`;
}

const hookFrame = { name: 't', loc: locOf(app.code, 'n(()'), url: 'https://cdn.test/app.js' };
const componentFrame = { name: 'r', loc: locOf(app.code, 't(e.seed'), url: 'https://cdn.test/app.js' };
// The call `Component(props)` right after `return` in the minified React stand-in.
const reactFrame = { name: 'a', loc: `1:${react.code.indexOf('return') + 8}`, url: 'https://cdn.test/react.js' };

describe('stack symbolication', () => {
  it('maps production frames to authored lines, call sites, and function names', async () => {
    const { symbolicate } = createStackSymbolicator(fakeFetch());
    // Production stacks start inside React's hook export, then reach app code.
    const { lists, status } = await symbolicate([[reactFrame, hookFrame, componentFrame, reactFrame]]);

    expect(lists[0]).toEqual([
      { name: 't', loc: hookFrame.loc, source: 'src/app.tsx:3:10', code: 'return useMemo(() => seed + 1, [seed]);', calls: 'useMemo', fn: 'useThing' },
      { name: 'r', loc: componentFrame.loc, source: 'src/app.tsx:6:17', code: 'const value = useThing(props.seed);', calls: 'useThing' },
    ]);
    expect(status).toMatchObject({ status: 'mapped', mapped: 2, unmapped: 0, internalFrames: 2 });
  });

  it('treats an aliased copy of React as React', async () => {
    const { symbolicate } = createStackSymbolicator(fakeFetch());
    const forkedFrame = { ...reactFrame, url: 'https://cdn.test/forked.js' };
    const { lists, status } = await symbolicate([[forkedFrame, componentFrame, forkedFrame]]);
    expect(lists[0]!.map((frame) => frame.source)).toEqual(['src/app.tsx:6:17']);
    expect(status.internalFrames).toBe(2);
  });

  it('fetches only the tail of each script and caches maps across calls', async () => {
    const fetchText = fakeFetch();
    const { symbolicate } = createStackSymbolicator(fetchText);
    await symbolicate([[hookFrame, componentFrame]]);
    await symbolicate([[componentFrame]]);
    expect(fetchText.calls).toEqual(['https://cdn.test/app.js', 'https://cdn.test/app.js.map']);
  });

  it('keeps unmapped frames with their script URL and says why', async () => {
    const { symbolicate } = createStackSymbolicator(fakeFetch());
    const missing = { name: 'x', loc: '1:1', url: 'https://cdn.test/missing.js' };
    const { lists, status } = await symbolicate([[missing, componentFrame]]);
    expect(lists[0]![0]).toEqual(missing);
    expect(status).toMatchObject({ status: 'partial', mapped: 1, unmapped: 1, failures: { 'https://cdn.test/missing.js': 'script fetch failed' } });
  });

  it('returns within the budget and leaves the fetch warming the cache', async () => {
    vi.useFakeTimers();
    try {
      let release: (text: string) => void = () => {};
      const slow: FetchText = (url) => (url.endsWith('.map')
        ? new Promise((resolve) => { release = resolve; })
        : Promise.resolve(files[url]!.slice(-4096)));
      const { symbolicate } = createStackSymbolicator(slow);
      const pending = symbolicate([[componentFrame]], { budgetMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      const first = await pending;
      expect(first.status).toMatchObject({ status: 'none', failures: { 'https://cdn.test/app.js': 'timed out; still loading, retry' } });

      release(files['https://cdn.test/app.js.map']!);
      const second = await symbolicate([[componentFrame]], { budgetMs: 100 });
      expect(second.status.status).toBe('mapped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rewrites a debug-hook payload in place and leaves frameless payloads alone', async () => {
    const symbolicator = createStackSymbolicator(fakeFetch());
    const payload = {
      ok: true,
      parents: [hookFrame, componentFrame, reactFrame],
      neighborhood: [{ parents: [componentFrame, reactFrame] }],
    } as Parameters<typeof symbolicateDebugHookPayload>[0] & Record<string, unknown>;
    await symbolicateDebugHookPayload(payload, symbolicator);
    expect(payload!.parents!.map((frame) => (frame as { source?: string }).source)).toEqual(['src/app.tsx:3:10', 'src/app.tsx:6:17']);
    expect(payload!.neighborhood![0]!.parents).toHaveLength(1);
    expect(payload!.sourceMaps).toMatchObject({ status: 'mapped', internalFrames: 2 });

    const dev = { ok: true, parents: [{ name: 'useThing', loc: '3:10' }] };
    await symbolicateDebugHookPayload(dev, symbolicator);
    expect(dev).not.toHaveProperty('sourceMaps');
  });
});
