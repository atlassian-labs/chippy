import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The committed zips let users install without a build. This test fails when
// they drift from the tracked sources; run `yarn chippy:zip` and
// `yarn chippy:extension:zip` to refresh them.
const ROOT = resolve(__dirname, '../..');
const SKIPPED = new Set(['.DS_Store', '.gaps', '.provenance']);

function trackedFiles(directory: string) {
  return execFileSync('git', ['ls-files', directory], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !SKIPPED.has(path.split('/').at(-1)!));
}

function zipEntries(archive: string) {
  return execFileSync('unzip', ['-Z1', archive], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry && !entry.endsWith('/'));
}

function zipEntry(archive: string, entry: string) {
  return execFileSync('unzip', ['-p', archive, entry], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

const ARCHIVES = [
  { archive: 'chippy-skill.zip', source: '.agents/skills/chippy', prefix: 'chippy/' },
  { archive: 'chippy-extension.zip', source: '.agents/skills/chippy/extension', prefix: '' },
];

describe.each(ARCHIVES)('$archive', ({ archive, source, prefix }) => {
  const files = trackedFiles(source);
  const expected = files.map((path) => prefix + path.slice(source.length + 1));

  it('contains exactly the tracked files plus LICENSE', () => {
    const withLicense = new Set([...expected, `${prefix}LICENSE`]);
    expect(zipEntries(archive).sort()).toEqual([...withLicense].sort());
  });

  it('matches the tracked file contents', () => {
    // The packager writes the root LICENSE over any copy in the source directory.
    const stale = files.filter((path, index) => !path.endsWith('/LICENSE') && !zipEntry(archive, expected[index]).equals(readFileSync(resolve(ROOT, path))));
    expect(stale).toEqual([]);
  });
});
