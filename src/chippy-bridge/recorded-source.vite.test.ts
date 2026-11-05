// @vitest-environment node
// React <=18 `_debugSource` against Vite's real dev transform. With Fast
// Refresh on, @vitejs/plugin-react adds a header before esbuild compiles JSX,
// so every recorded line is shifted; the resolver must map it back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createCallSiteResolver } from './fiber-source';

const APP = `import { useState } from 'react';

export function App() {
  const [n, setN] = useState(0);
  return (
    <div className="x">
      <Inner
        a={n}
      >
        <span onClick={() => setN(n + 1)}>hi</span>
      </Inner>
    </div>
  );
}

function Inner({ children }) {
  return <b>{children}</b>;
}
`;

// Authored line and column of each JSX element in APP.
const AUTHORED = [[6, 5], [7, 7], [10, 9], [17, 10]];

let root: string;
let server: ViteDevServer;
let served: string;

beforeAll(async () => {
  // Outside node_modules, where plugin-react skips its transform.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'chippy-vite-debug-source-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/App.jsx'), APP);
  symlinkSync(resolve(__dirname, '../../node_modules'), join(root, 'node_modules'));
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const result = await server.transformRequest('/src/App.jsx');
  if (!result?.map) throw new Error('Vite returned no module map');
  const encoded = Buffer.from(JSON.stringify(result.map)).toString('base64');
  served = `${result.code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('React <=18 _debugSource under Vite', () => {
  it('maps each shifted recorded position to the authored JSX element', async () => {
    const recorded = [...served.matchAll(/lineNumber: (\d+),\s*columnNumber: (\d+)/g)]
      .map((match) => ({ lineNumber: Number(match[1]), columnNumber: Number(match[2]) }));
    expect(recorded).toHaveLength(AUTHORED.length);
    // The defect being corrected: Vite's header shifts every recorded line.
    const byLine = (a: number[], b: number[]) => a[0] - b[0];
    expect(recorded.map((entry) => [entry.lineNumber, entry.columnNumber]).sort(byLine)).not.toEqual(AUTHORED);

    const fileName = join(root, 'src/App.jsx');
    const moduleUrl = 'http://localhost:5173/src/App.jsx';
    const resolver = createCallSiteResolver(
      async (url) => (url === moduleUrl ? served : null),
      (file) => (file === fileName ? [moduleUrl] : []),
    );
    const located = await Promise.all(recorded.map((entry) => resolver.locateRecorded({ fileName, ...entry })));
    expect(located.map((entry) => [entry.lineNumber, entry.columnNumber]).sort(byLine)).toEqual(AUTHORED);
    expect(located.every((entry) => entry.fileName === fileName)).toBe(true);
    expect(resolver.stats.modules).toBe(1);
  });

  it('keeps the recorded position when no served module contains it', async () => {
    const source = { fileName: join(root, 'src/App.jsx'), lineNumber: 999, columnNumber: 1 };
    const resolver = createCallSiteResolver(async () => served, () => ['http://localhost:5173/src/App.jsx']);
    expect(await resolver.locateRecorded(source)).toEqual(source);
  });
});
