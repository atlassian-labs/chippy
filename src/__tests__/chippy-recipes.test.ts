import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const CORPUS = resolve(SKILL, 'references/recipes.txt');
const SEARCH = resolve(SKILL, 'scripts/search-recipes.js');
const REQUIRED_FIELDS = ['id', 'q', 'tags', 'a', 'done', 'guard', 'refs'];

function records() {
  return readFileSync(CORPUS, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('id='));
}

function fields(record: string) {
  return Object.fromEntries(record.split(' | ').map((part) => {
    const equals = part.indexOf('=');
    return [part.slice(0, equals), part.slice(equals + 1)];
  }));
}

function headingSlug(heading: string) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function runRecipes(args: string[]) {
  return execFileSync('bash', [SHELL, 'recipes', ...args], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
}

describe('Chippy recipe search', () => {
  it('keeps every recipe self-contained on one grep-friendly line', () => {
    const corpusRecords = records();

    expect(corpusRecords.length).toBeGreaterThanOrEqual(90);
    const ids = new Set<string>();
    for (const record of corpusRecords) {
      const parsed = fields(record);
      expect(Object.keys(parsed)).toEqual(REQUIRED_FIELDS);
      for (const field of REQUIRED_FIELDS) expect(parsed[field].trim()).not.toBe('');
      expect(ids.has(parsed.id)).toBe(false);
      ids.add(parsed.id);
    }
  });

  it('resolves every recipe reference and Markdown anchor', () => {
    for (const record of records()) {
      for (const reference of fields(record).refs.split(',')) {
        const [relativePath, anchor] = reference.split('#');
        const target = resolve(SKILL, relativePath);
        expect(existsSync(target), `${reference} from ${fields(record).id}`).toBe(true);
        if (!anchor) continue;
        const slugs = readFileSync(target, 'utf8')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) => headingSlug(line.replace(/^#{1,6} /, '')));
        expect(slugs, `${reference} from ${fields(record).id}`).toContain(anchor);
      }
    }
  });

  it('advertises the local-only command and its limit option', () => {
    const help = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' });
    expect(help).toContain('recipes <query...> [--limit N]');
    expect(help).toContain('recipes searches the local task corpus and does not contact the helper');
  });

  it('streams the corpus and retains only ranked candidates', () => {
    const source = readFileSync(SEARCH, 'utf8');
    expect(source).toContain('createReadStream(file');
    expect(source).toContain('await forEachRecipe(file');
    expect(source).toContain('if (results.length > limit) results.length = limit');
    expect(source).not.toContain('readFileSync');
  });

  it('searches locally without touching the helper transport', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chippy-recipes-'));
    const fakeCurl = join(directory, 'curl');
    writeFileSync(fakeCurl, '#!/bin/sh\nexit 97\n');
    chmodSync(fakeCurl, 0o755);
    try {
      const output = execFileSync('bash', [SHELL, 'recipes', 'helper health', '--limit', '1'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH || ''}` },
      });
      expect(output).toMatch(/^recipe: check-health\n/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ranks the whole-page declarative-boundary recipe first', () => {
    const output = runRecipes(['whole page big blocks error suspense', '--limit', '1']);
    expect(output).toMatch(/^recipe: page-boundary-forest\n/);
    expect(output).toContain('answer: Run `chippy.sh page-boundaries');
  });

  it('tolerates a one-edit typo in a useful query term', () => {
    const output = runRecipes(['whole page boundry blocks', '--limit', '1']);
    expect(output).toMatch(/^recipe: page-boundary-forest\n/);
  });

  it('returns only the requested number of complete records', () => {
    const output = runRecipes(['slow interaction render performance', '--limit', '2']);
    expect(output.match(/^recipe:/gm)).toHaveLength(2);
    expect(output.match(/^question:/gm)).toHaveLength(2);
    expect(output.match(/^answer:/gm)).toHaveLength(2);
    expect(output.match(/^guard:/gm)).toHaveLength(2);
  });

  it('rejects an empty query and unsafe result limits', () => {
    const empty = spawnSync('bash', [SHELL, 'recipes'], { encoding: 'utf8' });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('recipes requires a search query');

    const tooLarge = spawnSync('bash', [SHELL, 'recipes', 'boundary', '--limit', '21'], { encoding: 'utf8' });
    expect(tooLarge.status).toBe(1);
    expect(tooLarge.stderr).toContain('--limit must be between 1 and 20');

    const noMatch = spawnSync('bash', [SHELL, 'recipes', 'zzzxqvplm'], { encoding: 'utf8' });
    expect(noMatch.status).toBe(1);
    expect(noMatch.stderr).toContain('No Chippy recipe matched: zzzxqvplm');
  });
});
