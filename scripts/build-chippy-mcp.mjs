import { build } from 'esbuild';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const output = '.agents/skills/chippy/scripts/chippy-mcp.cjs';
const result = await build({
  entryPoints: ['src/mcp/server.ts'], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  minify: true, legalComments: 'eof', metafile: true, write: false,
  banner: { js: '#!/usr/bin/env node' },
});
// Bundle dependency licenses with the portable executable, without runtime installs.
const licenses = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(input));
  let manifest;
  while (directory !== dirname(directory)) {
    if (existsSync(join(directory, 'package.json'))) {
      manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name) break;
    }
    directory = dirname(directory);
  }
  if (licenses.has(manifest.name)) continue;
  const filename = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].find(name => existsSync(join(directory, name)));
  if (!filename) throw new Error(`Missing bundled license for ${manifest.name}`);
  licenses.set(manifest.name, `${manifest.name}\n${readFileSync(join(directory, filename), 'utf8')}`);
}
writeFileSync(output, `${result.outputFiles[0].text}\n/* Bundled dependency licenses\n${[...licenses.values()].join('\n\n').replaceAll('*/', '* /')}\n*/\n`);
chmodSync(output, 0o755);

// Offline Avalanche analyzer: reuses the live dispatcher; no npm dependencies.
const analyzer = '.agents/skills/chippy/scripts/avalanche-analyze.cjs';
await build({
  entryPoints: ['src/avalanche/offline-cli.ts'], outfile: analyzer,
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  banner: { js: '#!/usr/bin/env node\n// Generated from src/avalanche/offline-cli.ts by `yarn chippy:mcp:build`; do not edit.' },
});
chmodSync(analyzer, 0o755);
