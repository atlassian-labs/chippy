import { build } from 'esbuild';
import { createServer } from 'node:http';

const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
window.renderCount = 0;
function useCounterValue() { return React.useState(0); }
function CounterLabel({ label }) { return React.createElement('span', null, label); }
function StockCounter({ prefix }) {
  window.renderCount++;
  const [count, setCount] = useCounterValue();
  const label = React.useMemo(() => prefix + ': ' + count, [prefix, count]);
  return React.createElement('button', { id: 'counter', onClick: () => setCount(c => c + 1) }, React.createElement(CounterLabel, { label }));
}
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? React.createElement('p', null, 'Failed') : this.props.children; }
}
function FixtureApp() {
  return React.createElement(ErrorBoundary, null,
    React.createElement(React.Suspense, { fallback: React.createElement('p', null, 'Loading') },
      React.createElement(StockCounter, { prefix: 'Count', __source: { fileName: '/fixture/StockCounter.jsx', lineNumber: 1, columnNumber: 1 } })));
}
window.__AVALANCHE__.install({ detectionMode: 'full', captureFibers: true });
createRoot(document.getElementById('root')).render(React.createElement(FixtureApp));
`;

export async function startReactCompatibilityFixture() {
  const scripts: Record<string, string> = {};
  // `stock` is the workspace React 18; `react-19` aliases the React 19 dev packages.
  const variants: Array<[string, Record<string, string>]> = [
    ['stock', {}],
    ['react-19', { react: 'react-19', 'react-dom': 'react-dom-19' }],
  ];
  for (const [kind, alias] of variants) {
    const result = await build({
      stdin: { contents: app, resolveDir: process.cwd(), sourcefile: 'react-compatibility-fixture.jsx' },
      alias, bundle: true, write: false, platform: 'browser', format: 'iife', keepNames: true,
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    });
    scripts[`/app-${kind}.js`] = result.outputFiles[0].text;
  }
  const server = createServer((request, response) => {
    const path = request.url || '/';
    if (scripts[`/app-${path.slice(1)}.js`]) {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><body style="margin:0;background:#F8F8F8;font:16px system-ui;padding:32px"><h1>React inspection</h1><div id="root"></div><script src="/app-${path.slice(1)}.js"></script></body></html>`);
    } else if (scripts[path]) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(scripts[path]);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    stop: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
