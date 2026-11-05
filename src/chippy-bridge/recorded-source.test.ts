import { describe, expect, it } from 'vitest';
import { recordedLiteralPosition, servedModuleUrls } from './recorded-source';

const source = { fileName: '/repo/src/App.jsx', lineNumber: 29, columnNumber: 9 };

describe('recordedLiteralPosition', () => {
  it('finds the single debug literal for the recorded position', () => {
    const code = [
      'jsxDEV("span", {}, void 0, false, {',
      '  fileName: "/repo/src/App.jsx",',
      '  lineNumber: 29,',
      '  columnNumber: 9',
      '}, this)',
    ].join('\n');
    expect(recordedLiteralPosition(code, source)).toEqual({ line: 3, column: 3 });
  });

  it('matches a classic-runtime __source literal on one line', () => {
    const code = 'x(A, { __source: { fileName: _f, lineNumber: 29, columnNumber: 9 } });';
    expect(recordedLiteralPosition(code, source)).toEqual({ line: 1, column: 34 });
  });

  it('rejects a missing, longer, or repeated literal', () => {
    expect(recordedLiteralPosition('lineNumber: 290, columnNumber: 9', source)).toBeNull();
    expect(recordedLiteralPosition('lineNumber: 29, columnNumber: 91', source)).toBeNull();
    const twice = 'lineNumber: 29, columnNumber: 9\nlineNumber: 29, columnNumber: 9';
    expect(recordedLiteralPosition(twice, source)).toBeNull();
  });

  it('matches the line alone when no column was recorded', () => {
    expect(recordedLiteralPosition('a\n lineNumber: 29 }', { ...source, columnNumber: null })).toEqual({ line: 2, column: 2 });
  });
});

describe('servedModuleUrls', () => {
  const origin = 'http://localhost:5173';

  it('ranks loaded same-origin modules by how much of the path they match', () => {
    const urls = servedModuleUrls('/repo/src/App.jsx', {
      origin,
      vite: false,
      resourceUrls: [
        `${origin}/App.jsx`,
        `${origin}/src/App.jsx`,
        'http://cdn.example/src/App.jsx',
        `${origin}/src/Other.jsx`,
        `${origin}/rc/App.jsx`,
      ],
    });
    expect(urls).toEqual([`${origin}/src/App.jsx`, `${origin}/App.jsx`]);
  });

  it('prefers the newest load of a module and adds the Vite /@fs URL last', () => {
    const urls = servedModuleUrls('/repo/src/App.jsx', {
      origin,
      vite: true,
      resourceUrls: [`${origin}/src/App.jsx`, `${origin}/src/App.jsx?t=2`, `${origin}/@fs/repo/src/App.jsx`],
    });
    expect(urls).toEqual([`${origin}/@fs/repo/src/App.jsx`, `${origin}/src/App.jsx?t=2`]);
  });

  it('builds the Vite /@fs URL when the module is not in the resource list', () => {
    expect(servedModuleUrls('/repo/src/App.jsx', { origin, vite: true, resourceUrls: [] }))
      .toEqual([`${origin}/@fs/repo/src/App.jsx`]);
    expect(servedModuleUrls('C:\\repo\\src\\App.jsx', { origin, vite: true, resourceUrls: [] }))
      .toEqual([`${origin}/@fs/C:/repo/src/App.jsx`]);
  });

  it('guesses no URL outside Vite', () => {
    expect(servedModuleUrls('/repo/src/App.jsx', { origin, vite: false, resourceUrls: [`${origin}/main.js`] })).toEqual([]);
  });
});
