// The generated files the skill ships. Users install the skill from `main`
// without building, so `main` carries them; `dev` builds them on demand.
import { execFileSync } from 'node:child_process';

export const SHIPPED_ARTIFACTS = [
  '.agents/skills/chippy/extension/avalanche.iife.js',
  '.agents/skills/chippy/extension/avalanche.iife.js.map',
  '.agents/skills/chippy/extension/avalanche.es.js',
  '.agents/skills/chippy/extension/avalanche.es.js.map',
  '.agents/skills/chippy/scripts/chippy-mcp.cjs',
  '.agents/skills/chippy/scripts/avalanche-analyze.cjs',
];

const BUILD_SCRIPTS = ['scripts/sync-avalanche.mjs', 'scripts/build-chippy-mcp.mjs'];

// Build output goes to stderr so callers can use stdout for results.
export function buildShippedArtifacts() {
  for (const script of BUILD_SCRIPTS) {
    execFileSync(process.execPath, [script], { stdio: ['ignore', 2, 2] });
  }
}
