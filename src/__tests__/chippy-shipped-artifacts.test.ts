import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageChippy } from '../../scripts/package-chippy.mjs';

// Release archives are built, not committed. This test packages them into a
// temporary directory and checks they hold exactly the tracked files, so an
// untracked local file cannot leak into a release.
const ROOT = resolve(__dirname, '../..');
const OUT = mkdtempSync(join(tmpdir(), 'chippy-shipped-'));
const SKIPPED = new Set(['.DS_Store', '.gaps', '.provenance']);

afterAll(() => rmSync(OUT, { recursive: true, force: true }));

function trackedFiles(directory: string) {
  return execFileSync('git', ['ls-files', directory], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !SKIPPED.has(path.split('/').at(-1)!));
}

function zipEntries(archive: string) {
  return execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry && !entry.endsWith('/'));
}

const ARCHIVES = [
  { kind: 'skill', source: '.agents/skills/chippy', prefix: 'chippy/' },
  { kind: 'extension', source: '.agents/skills/chippy/extension', prefix: '' },
];

describe.each(ARCHIVES)('chippy-$kind.zip', ({ kind, source, prefix }) => {
  it('contains exactly the tracked files plus LICENSE', () => {
    const archive = packageChippy(kind, ROOT, OUT);
    const expected = trackedFiles(source).map((path) => prefix + path.slice(source.length + 1));
    expect(zipEntries(archive).sort()).toEqual([...new Set([...expected, `${prefix}LICENSE`])].sort());
    expect(execFileSync('unzip', ['-p', archive, `${prefix}LICENSE`], { encoding: 'utf8' })).toBe(readFileSync(resolve(ROOT, 'LICENSE'), 'utf8'));
  });
});
