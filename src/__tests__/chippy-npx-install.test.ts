import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installSkill, mcpConfig, parseArgs } from '../../bin/chippy.mjs';

const BIN = resolve(__dirname, '../../bin/chippy.mjs');
const BUILT_SKILL = resolve(__dirname, '../../lib/mcp-skill');
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

  it('refuses a directory that is not a Chippy skill and, when forced, moves it aside', () => {
    const root = scratch();
    const source = fakeSkill(join(root, 'source'), 'new');
    const target = join(root, 'other');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'mine');
    expect(() => installSkill({ source, target })).toThrow(/--force/);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine');
    const moved: string[] = [];
    installSkill({ source, target, force: true, onMovedAside: (backup: string) => moved.push(backup) });
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('new');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/other\.replaced-\d+$/);
    expect(readFileSync(join(moved[0], 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('installs into an empty directory without --force', () => {
    const root = scratch();
    const target = join(root, 'empty');
    mkdirSync(target);
    installSkill({ source: fakeSkill(join(root, 'source'), 'new'), target });
    expect(readdirSync(root).filter((name) => name.includes('replaced'))).toEqual([]);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('new');
  });

  it('answers --help and --version for every command and rejects options of another command', () => {
    expect(parseArgs(['pack', '--help'])).toMatchObject({ command: 'pack', help: true });
    expect(parseArgs(['install', '--version'])).toMatchObject({ version: true });
    expect(parseArgs(['--version'])).toMatchObject({ command: undefined, version: true });
    expect(() => parseArgs(['pack', '--force'])).toThrow('Unknown option for pack: --force');
    expect(() => parseArgs(['install', '--dir'])).toThrow('--dir needs a value');
    const version = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version;
    expect(execFileSync(process.execPath, [BIN, 'pack', '--version'], { encoding: 'utf8' }).trim()).toBe(version);
    expect(execFileSync(process.execPath, [BIN, 'pack', '--help'], { encoding: 'utf8' })).toContain('pack [--config <file>]');
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
