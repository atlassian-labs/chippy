import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'chippy-distribution-test-'));
  roots.push(root);
  mkdirSync(join(root, '.agents/skills/chippy/extension'), { recursive: true });
  writeFileSync(join(root, 'LICENSE'), readFileSync('LICENSE'));
  writeFileSync(join(root, '.agents/skills/chippy/SKILL.md'), 'fixture skill');
  writeFileSync(join(root, '.agents/skills/chippy/.provenance'), 'local metadata');
  writeFileSync(join(root, '.agents/skills/chippy/extension/manifest.json'), '{"version":"1.0.0"}');
  writeFileSync(join(root, '.agents/skills/chippy/extension/.DS_Store'), 'local metadata');
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Chippy distribution entry points', () => {
  it.each(['skill', 'extension'])('builds the %s archive with the license and without local metadata', (kind) => {
    const root = fixture();
    const script = resolve('scripts/package-chippy.mjs');
    execFileSync(process.execPath, [script, kind], { cwd: root });
    const archive = join(root, `chippy-${kind}.zip`);
    const prefix = kind === 'skill' ? 'chippy/' : '';
    const files = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    expect(files).not.toContain('.provenance');
    expect(files).not.toContain('.DS_Store');
    expect(files).not.toContain('THIRD_PARTY_NOTICES.md');
    expect(files).not.toContain('.patch');
    expect(execFileSync('unzip', ['-p', archive, `${prefix}LICENSE`], { encoding: 'utf8' })).toBe(readFileSync('LICENSE', 'utf8'));
    const manifest = kind === 'skill' ? 'chippy/extension/manifest.json' : 'manifest.json';
    expect(JSON.parse(execFileSync('unzip', ['-p', archive, manifest], { encoding: 'utf8' })).version).toBe('1.0.0');
  });

  it('leaves an existing archive intact when packaging cannot complete', () => {
    const root = fixture();
    const archive = join(root, 'chippy-skill.zip');
    writeFileSync(archive, 'previous artifact');
    rmSync(join(root, 'LICENSE'));
    expect(() => execFileSync(process.execPath, [resolve('scripts/package-chippy.mjs'), 'skill'], { cwd: root, stdio: 'pipe' })).toThrow();
    expect(readFileSync(archive, 'utf8')).toBe('previous artifact');
  });
});
