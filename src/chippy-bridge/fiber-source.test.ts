import { describe, expect, it } from 'vitest';
import {
  createCallSiteResolver,
  getFiberSource,
  getFiberSourceCandidate,
  getFiberStackFrames,
  isVendorPath,
  parseStackFrames,
  resolveFiberSource,
} from './fiber-source';

const REACT_STACK = [
  'Error: react-stack-top-frame',
  '    at exports.jsxDEV (http://localhost:5199/.vite/deps/react_jsx-dev-runtime.js?v=abc:244:30)',
  '    at Badge (http://localhost:5199/src/probe.jsx:23:26)',
  '    at Object.react_stack_bottom_frame (http://localhost:5199/.vite/deps/react-dom_client.js?v=abc:18761:20)',
].join('\n');

const VITE_MAP = {
  version: 3,
  sources: ['probe.jsx'],
  mappings:
    'AAIS;AAHT,SAAS,gBAAgB;AAElB,gBAAS,MAAM,EAAE,MAAM,GAAG;AAC/B,SAAO,uBAAC,UAAK,WAAU,SAAS,mBAAzB;AAAA;AAAA;AAAA;AAAA,SAA+B;AACxC;AAEO,gBAAS,KAAK,EAAE,MAAM,GAAG;AAC9B,SACE,uBAAC,QAAG,WAAU,QACX,gBAAM,IAAI,CAAC,SACV,uBAAC,QAAe,kBAAP,MAAT;AAAA;AAAA;AAAA;AAAA,SAAqB,CACtB,KAHH;AAAA;AAAA;AAAA;AAAA,SAIA;AAEJ;AAEO,gBAAS,MAAM;AACpB,QAAM,CAAC,CAAC,IAAI,SAAS,CAAC;AACtB,SACE,uBAAC,aAAQ,IAAG,gBACV;AAAA,2BAAC,SAAM,OAAO,KAAK,CAAC,MAApB;AAAA;AAAA;AAAA;AAAA,WAAwB;AAAA,IACxB,uBAAC,QAAK,OAAO,CAAC,KAAK,GAAG,KAAtB;AAAA;AAAA;AAAA;AAAA,WAAyB;AAAA,OAF3B;AAAA;AAAA;AAAA;AAAA,SAGA;AAEJ;',
};

function inlineModule(map: unknown): string {
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  return `export function Badge() {}\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
}

describe('React fiber source resolution', () => {
  it('preserves React <=18 _debugSource without fetching', async () => {
    const fiber = { _debugSource: { fileName: '/src/Legacy.tsx', lineNumber: 7, columnNumber: 3 } };
    const resolver = createCallSiteResolver(async () => {
      throw new Error('must not fetch');
    });
    expect(getFiberSource(fiber)).toEqual({ fileName: '/src/Legacy.tsx', lineNumber: 7, columnNumber: 3 });
    expect(await resolveFiberSource(fiber, resolver)).toEqual({ fileName: '/src/Legacy.tsx', lineNumber: 7, columnNumber: 3 });
    expect(resolver.stats.modules).toBe(0);
  });

  it('reads the first project frame from React 19 _debugStack immediately', () => {
    const fiber = { _debugStack: { stack: REACT_STACK } };
    expect(getFiberStackFrames(fiber)).toEqual([
      { url: 'http://localhost:5199/src/probe.jsx', line: 23, column: 26, function: 'Badge' },
    ]);
    expect(getFiberSource(fiber)).toEqual({
      fileName: 'http://localhost:5199/src/probe.jsx',
      lineNumber: 23,
      columnNumber: 26,
    });
  });

  it('maps the React 19 browser frame back to authored source', async () => {
    const url = 'http://localhost:5199/src/probe.jsx';
    const asked: string[] = [];
    const resolver = createCallSiteResolver(async (requested) => {
      asked.push(requested);
      return requested === url ? inlineModule(VITE_MAP) : null;
    });
    const fiber = { _debugStack: { stack: REACT_STACK } };

    expect(await resolveFiberSource(fiber, resolver)).toEqual({
      fileName: 'src/probe.jsx',
      lineNumber: 21,
      columnNumber: 5,
    });
    expect(getFiberSource(fiber)?.lineNumber).toBe(21);
    expect(getFiberSourceCandidate(fiber)?.lineNumber).toBe(23);
    expect(asked).toEqual([url]);
  });

  it('deduplicates module fetches across fibers and call sites', async () => {
    const url = 'http://localhost:5199/src/probe.jsx';
    const asked: string[] = [];
    const resolver = createCallSiteResolver(async (requested) => {
      asked.push(requested);
      return requested === url ? inlineModule(VITE_MAP) : null;
    });
    const one = { _debugStack: { stack: REACT_STACK } };
    const two = { _debugStack: { stack: REACT_STACK.replace(':23:26)', ':24:21)') } };

    await Promise.all([resolveFiberSource(one, resolver), resolveFiberSource(two, resolver)]);
    expect(asked).toEqual([url]);
    expect(resolver.stats.sites).toBe(2);
  });

  it('resolves external-map sources against the map URL', async () => {
    const resolver = createCallSiteResolver(async (url) => ({
      'http://host/assets/js/out.js': 'x\n//# sourceMappingURL=/maps/out.js.map',
      'http://host/maps/out.js.map': JSON.stringify({
        version: 3,
        sources: ['../src/App.tsx'],
        mappings: 'AAAA',
      }),
    })[url] ?? null);

    expect(await resolver.locate([{ url: 'http://host/assets/js/out.js', line: 1, column: 1 }])).toEqual({
      fileName: 'src/App.tsx',
      lineNumber: 1,
      columnNumber: 1,
    });
  });

  it('preserves a root sourceRoot when resolving an external map', async () => {
    const resolver = createCallSiteResolver(async (url) => ({
      'http://host/assets/js/out.js': 'x\n//# sourceMappingURL=/maps/out.js.map',
      'http://host/maps/out.js.map': JSON.stringify({
        version: 3,
        sourceRoot: '/',
        sources: ['src/App.tsx'],
        mappings: 'AAAA',
      }),
    })[url] ?? null);

    expect(await resolver.locate([{ url: 'http://host/assets/js/out.js', line: 1, column: 1 }]))
      .toMatchObject({ fileName: 'src/App.tsx' });
  });

  it('preserves an absolute filesystem source path from a map', async () => {
    const resolver = createCallSiteResolver(async (url) => url === 'http://host/src/App.js'
      ? inlineModule({ version: 3, sources: ['/Users/me/project/src/App.tsx'], mappings: 'AAAA' })
      : null);

    expect(await resolver.locate([{ url: 'http://host/src/App.js', line: 1, column: 1 }]))
      .toMatchObject({ fileName: '/Users/me/project/src/App.tsx' });
  });

  it('recognizes dependency frames without naming particular JSX runtimes', () => {
    expect(isVendorPath('/app/node_modules/@emotion/react/jsx-runtime.js')).toBe(true);
    expect(isVendorPath('http://host/.vite/deps/react_jsx-dev-runtime.js')).toBe(true);
    expect(isVendorPath('/app/src/Button.tsx')).toBe(false);
    expect(isVendorPath('webpack-internal:///(app)/./src/Button.tsx')).toBe(false);
  });

  it('parses V8, SpiderMonkey, and filesystem frames', () => {
    expect(parseStackFrames('App@http://host/src/App.tsx:4:9')[0]).toMatchObject({ line: 4, column: 9 });
    expect(parseStackFrames('    at App (/Users/me/src/App.tsx:4:9)')[0]?.url).toBe('/Users/me/src/App.tsx');
  });
});
