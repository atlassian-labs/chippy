import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installSkill, mcpConfig } from '../../packages/chippy/bin/chippy.mjs';

const BIN = resolve(__dirname, '../../packages/chippy/bin/chippy.mjs');
const BUILT_SKILL = resolve(__dirname, '../../packages/chippy/dist/mcp-skill');
const directories: string[] = [];

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-install-'));
  directories.push(directory);
  return directory;
}

function fakeSkill(directory: string, marker: string) {
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: chippy\n---\n${marker}\n`);
  writeFileSync(join(directory, 'scripts', 'chippy-mcp.cjs'), '');
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('npx chippy install', () => {
  it('copies the skill and replaces an earlier Chippy install', () => {
    const root = scratch();
    const target = join(root, 'skills', 'chippy');
    expect(installSkill({ source: fakeSkill(join(root, 'v1'), 'v1'), target })).toBe(target);
    writeFileSync(join(target, 'stale.txt'), '');
    installSkill({ source: fakeSkill(join(root, 'v2'), 'v2'), target });
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('v2');
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });

  it('refuses to replace a directory that is not a Chippy skill unless forced', () => {
    const root = scratch();
    const source = fakeSkill(join(root, 'source'), 'new');
    const target = join(root, 'other');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'mine');
    expect(() => installSkill({ source, target })).toThrow(/--force/);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine');
    installSkill({ source, target, force: true });
    expect(existsSync(join(target, 'keep.txt'))).toBe(false);
  });

  it('refuses the home directory and a source that is not a skill', () => {
    const root = scratch();
    expect(() => installSkill({ source: fakeSkill(join(root, 's'), ''), target: process.env.HOME, force: true })).toThrow(/dedicated/);
    expect(() => installSkill({ source: root, target: join(root, 't') })).toThrow(/Bundled skill not found/);
  });

  it('runs when started through a symlink, as npx starts it', () => {
    const link = join(scratch(), 'chippy');
    symlinkSync(BIN, link);
    expect(execFileSync(process.execPath, [link, '--help'], { encoding: 'utf8' })).toContain('Usage: npx');
  });

  it('prints an MCP config that points at the installed server', () => {
    expect(mcpConfig('/x/chippy')).toEqual({ mcpServers: { chippy: { command: 'node', args: ['/x/chippy/scripts/chippy-mcp.cjs'] } } });
  });

  it.skipIf(!existsSync(join(BUILT_SKILL, 'SKILL.md')))('installs the built skill from the command line', () => {
    const target = join(scratch(), 'chippy');
    const output = execFileSync(process.execPath, [BIN, 'install', '--dir', target], { encoding: 'utf8' });
    expect(output).toContain(`Installed the Chippy skill to ${target}`);
    expect(output).toContain(join(target, 'extension'));
    expect(existsSync(join(target, 'extension', 'manifest.json'))).toBe(true);
    expect(existsSync(join(target, 'scripts', 'chippy-mcp.cjs'))).toBe(true);
    expect(existsSync(join(target, 'scripts', 'chippy.sh'))).toBe(true);
  });
});
