// The skill installs without a build, so the committed bundles must match a fresh
// build of src/. Rebuilds them and fails when the result differs from HEAD; the
// rebuilt files stay in the working tree, ready to commit.
import { execFileSync } from 'node:child_process';

for (const script of ['scripts/sync-avalanche.mjs', 'scripts/build-chippy-mcp.mjs']) {
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
try {
  execFileSync('git', ['diff', '--exit-code', '--stat', 'HEAD', '--', '.agents/skills/chippy'], { stdio: 'inherit' });
} catch {
  console.error('Committed bundles are stale. Commit the rebuilt files above.');
  process.exit(1);
}
console.log('Committed bundles match the sources');
