import { describe, expect, it } from 'vitest';
import {
  inlineSourceMapOf,
  originalPositionFor,
  parseSourceMap,
  sourceMappingUrlOf,
} from './source-map';

const VITE_MAP = JSON.stringify({
  version: 3,
  sources: ['probe.jsx'],
  mappings:
    'AAIS;AAHT,SAAS,gBAAgB;AAElB,gBAAS,MAAM,EAAE,MAAM,GAAG;AAC/B,SAAO,uBAAC,UAAK,WAAU,SAAS,mBAAzB;AAAA;AAAA;AAAA;AAAA,SAA+B;AACxC;AAEO,gBAAS,KAAK,EAAE,MAAM,GAAG;AAC9B,SACE,uBAAC,QAAG,WAAU,QACX,gBAAM,IAAI,CAAC,SACV,uBAAC,QAAe,kBAAP,MAAT;AAAA;AAAA;AAAA;AAAA,SAAqB,CACtB,KAHH;AAAA;AAAA;AAAA;AAAA,SAIA;AAEJ;AAEO,gBAAS,MAAM;AACpB,QAAM,CAAC,CAAC,IAAI,SAAS,CAAC;AACtB,SACE,uBAAC,aAAQ,IAAG,gBACV;AAAA,2BAAC,SAAM,OAAO,KAAK,CAAC,MAApB;AAAA;AAAA;AAAA;AAAA,WAAwB;AAAA,IACxB,uBAAC,QAAK,OAAO,CAAC,KAAK,GAAG,KAAtB;AAAA;AAAA;AAAA;AAAA,WAAyB;AAAA,OAF3B;AAAA;AAAA;AAAA;AAAA,SAGA;AAEJ;',
});

describe('React 19 source-map decoding', () => {
  it.each([
    [23, 26, 21, 5],
    [24, 21, 22, 7],
    [4, 26, 5, 10],
  ])('maps generated %i:%i to authored %i:%i', (line, column, sourceLine, sourceColumn) => {
    expect(originalPositionFor(parseSourceMap(VITE_MAP), line, column)).toEqual({
      source: 'probe.jsx',
      line: sourceLine,
      column: sourceColumn,
    });
  });

  it('supports ordinary and indexed Source Map v3 payloads', () => {
    const indexed = JSON.stringify({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: 'AAAA' } },
        { offset: { line: 10, column: 0 }, map: { version: 3, sources: ['b.ts'], mappings: 'AAAA' } },
      ],
    });
    const map = parseSourceMap(indexed);
    expect(originalPositionFor(map, 1, 1)?.source).toBe('a.ts');
    expect(originalPositionFor(map, 11, 1)?.source).toBe('b.ts');
  });

  it('does not invent a mapping before the first segment or after an unmapped segment', () => {
    const startsAtColumnFive = parseSourceMap(JSON.stringify({
      version: 3,
      sources: ['a.ts'],
      mappings: 'KAAA',
    }));
    expect(originalPositionFor(startsAtColumnFive, 1, 1)).toBeNull();
    expect(originalPositionFor(startsAtColumnFive, 1, 6)?.source).toBe('a.ts');

    const becomesUnmapped = parseSourceMap(JSON.stringify({
      version: 3,
      sources: ['a.ts'],
      mappings: 'AAAA,K',
    }));
    expect(originalPositionFor(becomesUnmapped, 1, 5)?.source).toBe('a.ts');
    expect(originalPositionFor(becomesUnmapped, 1, 6)).toBeNull();
  });

  it('selects indexed sections only after their exact line and column offset', () => {
    const map = parseSourceMap(JSON.stringify({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: 'AAAA' } },
        { offset: { line: 0, column: 10 }, map: { version: 3, sources: ['b.ts'], mappings: 'AAAA' } },
      ],
    }));
    expect(originalPositionFor(map, 1, 1)?.source).toBe('a.ts');
    expect(originalPositionFor(map, 1, 11)?.source).toBe('b.ts');
  });

  it('refuses malformed or unsupported maps', () => {
    expect(parseSourceMap('<!doctype html>')).toEqual([]);
    expect(parseSourceMap(JSON.stringify({ sources: ['a.ts'], mappings: 'AAAA' }))).toEqual([]);
    expect(parseSourceMap(JSON.stringify({ version: 4, sources: [], mappings: '' }))).toEqual([]);
    expect(parseSourceMap(JSON.stringify({ version: 3, sources: ['a.ts'] }))).toEqual([]);
  });

  it('finds the final sourceMappingURL annotation', () => {
    const code = 'const decoy = "sourceMappingURL=nope.map";\n//# sourceMappingURL=real.map';
    expect(sourceMappingUrlOf(code)).toBe('real.map');
  });

  it('decodes base64 and percent-encoded inline maps', () => {
    const json = JSON.stringify({ version: 3, sources: ['café.ts'], mappings: 'AAAA' });
    expect(inlineSourceMapOf(`data:application/json;base64,${Buffer.from(json).toString('base64')}`)).toBe(json);
    expect(inlineSourceMapOf(`data:application/json,${encodeURIComponent(json)}`)).toBe(json);
  });
});
