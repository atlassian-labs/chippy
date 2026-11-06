// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, SKILL_INSTALL_COMMAND } from '../../bin/chippy.mjs';

const BIN = resolve(__dirname, '../../bin/chippy.mjs');
const directories: string[] = [];

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-cli-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('chippy CLI', () => {
  it('answers --help and --version and rejects unknown options', () => {
    expect(parseArgs(['pack', '--help'])).toMatchObject({ command: 'pack', help: true });
    expect(parseArgs(['pack', '--version'])).toMatchObject({ version: true });
    expect(parseArgs(['--version'])).toMatchObject({ command: undefined, version: true });
    expect(() => parseArgs(['pack', '--force'])).toThrow('Unknown option for pack: --force');
    expect(() => parseArgs(['pack', '--config'])).toThrow('--config needs a value');
    const version = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version;
    expect(execFileSync(process.execPath, [BIN, 'pack', '--version'], { encoding: 'utf8' }).trim()).toBe(version);
    const help = execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
    expect(help).toContain('pack [--config <file>]');
    expect(help).toContain(SKILL_INSTALL_COMMAND);
    expect(help).not.toMatch(/^\s*install\b/m);
  });

  it('points install at the skills CLI and installs nothing', () => {
    const cwd = scratch();
    const result = spawnSync(process.execPath, [BIN, 'install', '--dir', join(cwd, 'skill')], { cwd, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no longer installs the Chippy skill');
    expect(result.stderr).toContain(SKILL_INSTALL_COMMAND);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('names the published skill in the install command', () => {
    expect(SKILL_INSTALL_COMMAND).toBe('npx skills add atlassian-labs/chippy --skill chippy -g');
    const skill = readFileSync(resolve(__dirname, '../../.agents/skills/chippy/SKILL.md'), 'utf8');
    expect(skill).toMatch(/^name:\s*chippy\s*$/m);
  });

  it('runs when started through a symlink, as npx starts it', () => {
    const link = join(scratch(), 'chippy');
    symlinkSync(BIN, link);
    expect(execFileSync(process.execPath, [link, '--help'], { encoding: 'utf8' })).toContain('Usage: npx');
  });
});
