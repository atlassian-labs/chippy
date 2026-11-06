import { build } from 'esbuild';
import { cpSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
// Rebuild the shipped bundles so the package never depends on committed output.
for (const script of ['scripts/sync-avalanche.mjs', 'scripts/build-chippy-mcp.mjs']) {
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
const output = resolve('lib');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
await build({
  entryPoints: {
    avalanche: 'src/package/avalanche.ts',
    browser: 'src/package/browser.ts',
    plugin: 'src/package/plugin.ts',
    bootstrap: '.agents/skills/chippy/extension/devtools-hook-shim.js',
  },
  outdir: output, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  sourcemap: true, external: ['react'],
});
execFileSync(join(root, 'node_modules/.bin/tsc'), [
  'src/package/avalanche.ts', 'src/package/browser.ts', 'src/package/plugin.ts',
  '--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck', '--rootDir', 'src',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
  '--jsx', 'react-jsx', '--esModuleInterop', '--outDir', join(output, 'types'),
], { stdio: 'inherit' });
// NodeNext consumers need explicit extensions on relative declaration imports.
function fixDeclarations(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) fixDeclarations(path);
    else if (path.endsWith('.d.ts')) {
      writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
        (_, prefix, target, suffix) => `${prefix}${target.endsWith('.js') ? target : `${target}.js`}${suffix}`));
    }
  }
}
fixDeclarations(join(output, 'types'));
writeFileSync(join(output, 'bootstrap.d.ts'), 'export {};\n');
cpSync('.storybook/chippy-addon', join(output, 'storybook'), { recursive: true });
await build({
  entryPoints: ['src/layout-lab/probe-intent.ts'],
  outfile: join(output, 'storybook/probe-intent.js'), bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022',
});
const editor = join(output, 'storybook/probe-annotation-editor.jsx');
writeFileSync(editor, readFileSync(editor, 'utf8').replace('../../src/layout-lab/probe-intent.ts', './probe-intent.js'));
const preview = join(output, 'storybook/preview.js');
writeFileSync(preview, readFileSync(preview, 'utf8').replaceAll('../../.agents/skills/chippy/extension/', '../extension/'));
mkdirSync(join(output, 'extension'), { recursive: true });
for (const asset of [
  'inspect-react.js', 'panel-dom.js', 'layout-lab.js', 'resolve-probes.js',
  'avalanche.es.js', 'avalanche.es.js.map', 'chippy-page-bridge.js',
]) copyFileSync(join('.agents/skills/chippy/extension', asset), join(output, 'extension', asset));
cpSync('.agents/skills/chippy', join(output, 'mcp-skill'), { recursive: true,
  filter: path => !['.DS_Store', '.gaps', '.provenance'].includes(path.split('/').at(-1)),
});
writeFileSync(join(output, 'mcp-skill/package.json'), '{"type":"commonjs"}\n');
// The repository root is CommonJS; the library output is ESM. Bundlers read
// sideEffects from the nearest package.json, so declaring it here covers only the
// published bundles; on the root it would also tree-shake the repository's sources.
writeFileSync(join(output, 'package.json'), `${JSON.stringify({
  type: 'module',
  sideEffects: ['./bootstrap.js', './storybook/**', './extension/**'],
})}\n`);
console.log('Built lib');
