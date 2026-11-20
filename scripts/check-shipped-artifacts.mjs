// Rebuilds the shipped bundles from src/ and, where they are committed (on
// `main` and release branches), fails when the result differs from HEAD. The
// rebuilt files stay in the working tree.
import { execFileSync } from 'node:child_process';
import { buildShippedArtifacts, SHIPPED_ARTIFACTS } from './shipped-artifacts.mjs';

buildShippedArtifacts();
const tracked = execFileSync('git', ['ls-files', '--', ...SHIPPED_ARTIFACTS], { encoding: 'utf8' }).trim();
if (!tracked) {
  console.log('Shipped bundles build; this branch does not commit them');
  process.exit(0);
}
try {
  execFileSync('git', ['diff', '--exit-code', '--stat', 'HEAD', '--', ...SHIPPED_ARTIFACTS], { stdio: 'inherit' });
} catch {
  console.error('Committed bundles are stale. Commit the rebuilt files above.');
  process.exit(1);
}
console.log('Committed bundles match the sources');
