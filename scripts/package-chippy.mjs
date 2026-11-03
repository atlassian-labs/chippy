import { cpSync, copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function packageChippy(kind, root, outDir = root) {
  if (kind !== 'skill' && kind !== 'extension') throw new Error('Expected skill or extension');
  const skill = join(root, '.agents/skills/chippy');
  const source = kind === 'skill' ? skill : join(skill, 'extension');
  const license = join(root, 'LICENSE');
  if (!existsSync(license)) throw new Error('LICENSE is required for distribution');
  const stage = mkdtempSync(join(tmpdir(), 'chippy-package-'));
  const archive = join(outDir, `chippy-${kind}.zip`);
  try {
    const content = join(stage, 'content');
    const destination = kind === 'skill' ? join(content, 'chippy') : content;
    cpSync(source, destination, {
      recursive: true,
      filter: (path) => !['.DS_Store', '.gaps', '.provenance', '__MACOSX'].includes(path.split('/').at(-1)),
    });
    copyFileSync(license, join(destination, 'LICENSE'));
    const built = join(stage, 'archive.zip');
    execFileSync('zip', ['-qr', built, '.'], { cwd: content });
    // Build first: a failed zip must not erase the previous distributable.
    copyFileSync(built, `${archive}.tmp`);
    renameSync(`${archive}.tmp`, archive);
    return archive;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(packageChippy(process.argv[2], process.cwd()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
