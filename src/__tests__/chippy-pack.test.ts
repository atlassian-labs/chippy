// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizePackConfig, packChippy } from '../../bin/pack.mjs';
import { writePackWorkspace } from '../test/pack-workspace';

const BIN = resolve(__dirname, '../../bin/chippy.mjs');
const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const directories: string[] = [];

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-pack-'));
  directories.push(directory);
  return directory;
}

const config = (directory: string, overrides: Record<string, unknown> = {}) => normalizePackConfig({
  plugins: [{ id: 'gate', label: 'Feature gates', entry: './src/gate.ts' }],
  defaultPlugins: ['gate', 'jira'],
  extension: { name: 'Chippy (Gates)', version: '0.4.24.1', key: 'TESTKEY' },
  skill: { overlay: './overlay' },
  outDir: './out',
  ...overrides,
}, directory);

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('chippy pack', () => {
  it('bundles plugins, build defaults, extension identity, and the overlay', async () => {
    const directory = writePackWorkspace(scratch());
    const result = await packChippy(config(directory), { source: SKILL });
    const skill = result.skillDir;
    const read = (path: string) => readFileSync(join(skill, path), 'utf8');

    const manifest = JSON.parse(read('extension/manifest.json'));
    expect(manifest).toMatchObject({ name: 'Chippy (Gates)', version: '0.4.24.1', key: 'TESTKEY' });
    expect(manifest.action.default_title).toBe('Chippy (Gates)');

    const build = {
      plugins: [
        { id: 'jira', label: 'Jira ownership markers' },
        { id: 'atl', label: 'ATL commit metrics' },
        { id: 'gate', label: 'Feature gates' },
      ],
      defaultPlugins: ['gate', 'jira'],
    };
    for (const file of ['extension/background.js', 'extension/panel-settings.js']) {
      expect(read(file).split('\n')[0]).toBe(`globalThis.__CHIPPY_BUILD = ${JSON.stringify(build)};`);
    }

    for (const file of ['extension/avalanche.iife.js', 'extension/avalanche.es.js']) {
      const bundle = read(file);
      const plugins = bundle.indexOf('/* chippy pack: plugins */');
      expect(plugins).toBeGreaterThan(0);
      expect(bundle.slice(plugins)).toMatch(/enableDefaultPlugins\(\["gate", "jira"\]\)/);
      // The map comment stays last so the core bundle's source map still applies.
      expect(bundle.lastIndexOf('//# sourceMappingURL=')).toBeGreaterThan(plugins);
      const original = readFileSync(join(SKILL, file), 'utf8');
      expect(bundle.slice(0, plugins)).toBe(`${original.slice(0, original.lastIndexOf('\n//# sourceMappingURL='))}\n;`);
    }

    expect(read('references/gates.md')).toBe('# Feature gates\n');
    expect(read('SKILL.md')).toBe(`${readFileSync(join(SKILL, 'SKILL.md'), 'utf8')}\nSee [feature gates](references/gates.md).\n`);

    const listing = (archive: string) => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
    expect(listing(result.skillZip!)).toEqual(expect.arrayContaining(['chippy/SKILL.md', 'chippy/extension/manifest.json', 'chippy/references/gates.md']));
    expect(listing(result.extensionZip!)).toEqual(expect.arrayContaining(['manifest.json', 'avalanche.iife.js', 'LICENSE']));
  });

  it('leaves the source skill untouched', async () => {
    const directory = writePackWorkspace(scratch());
    const before = readFileSync(join(SKILL, 'extension/avalanche.iife.js'), 'utf8');
    await packChippy(config(directory), { source: SKILL, zips: false });
    expect(readFileSync(join(SKILL, 'extension/avalanche.iife.js'), 'utf8')).toBe(before);
  });

  it('rejects configs it cannot build', () => {
    const directory = writePackWorkspace(scratch());
    expect(() => config(directory, { defaultPlugins: ['missing'] })).toThrow('unknown plugin: missing');
    expect(() => config(directory, { plugins: [{ id: 'jira', entry: './src/gate.ts' }] })).toThrow('built in');
    expect(() => config(directory, { plugins: [{ id: 'gate', entry: './src/none.ts' }] })).toThrow('not found');
    expect(() => config(directory, { extension: { version: '0.4.24-atl' } })).toThrow('extension.version');
    expect(() => config(directory, { skill: { overlay: './none' } })).toThrow('overlay not found');
  });

  it('rejects unknown config keys at every level', () => {
    const directory = writePackWorkspace(scratch());
    expect(() => config(directory, { outdir: './x' })).toThrow('unknown config key outdir');
    expect(() => config(directory, { extension: { nmae: 'x' } })).toThrow('unknown config key extension.nmae');
    expect(() => config(directory, { skill: { overlays: './overlay' } })).toThrow('unknown config key skill.overlays');
    expect(() => config(directory, { plugins: [{ id: 'gate', entry: './src/gate.ts', lable: 'x' }] })).toThrow('unknown config key plugins[0].lable');
  });

  it('refuses to replace an output directory that is not a Chippy skill', async () => {
    const directory = writePackWorkspace(scratch());
    mkdirSync(join(directory, 'out/chippy'), { recursive: true });
    writeFileSync(join(directory, 'out/chippy/keep.txt'), 'mine');
    await expect(packChippy(config(directory), { source: SKILL, zips: false })).rejects.toThrow('not a Chippy skill');
    expect(readFileSync(join(directory, 'out/chippy/keep.txt'), 'utf8')).toBe('mine');
  });

  it('fails on an overlay that appends to a missing file', async () => {
    const directory = writePackWorkspace(scratch());
    writeFileSync(join(directory, 'overlay/NOTES.append.md'), 'extra\n');
    await expect(packChippy(config(directory), { source: SKILL, zips: false })).rejects.toThrow('missing file: NOTES.md');
  });

  it('runs from the bin with a config file', () => {
    const directory = writePackWorkspace(scratch());
    writeFileSync(join(directory, 'chippy.config.mjs'), `export default ${JSON.stringify({
      plugins: [{ id: 'gate', entry: './src/gate.ts' }],
      outDir: './out',
    })};\n`);
    // The bin packs dist/mcp-skill, which needs a library build; --help proves the command is wired.
    const help = execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
    expect(help).toContain('pack [--config <file>]');
    expect(() => execFileSync(process.execPath, [BIN, 'pack', '--config', join(directory, 'none.mjs')], { stdio: 'pipe' }))
      .toThrow(/config not found/);
  });
});
