// Builds the Avalanche runtime from src/ and copies the bundles into the extension.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

await build({ configFile: 'vite.avalanche.config.ts', logLevel: 'warn' });
for (const bundle of ['avalanche.iife.js', 'avalanche.es.js']) {
  for (const file of [bundle, `${bundle}.map`]) {
    copyFileSync(join('dist', file), join('.agents/skills/chippy/extension', file));
  }
}
console.log('Synced Avalanche bundles');
