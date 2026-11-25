import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJsonFile } from './files';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const ANALYZER = resolve(SKILL, 'scripts/avalanche-analyze.cjs');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const BRIDGE = resolve(SKILL, 'extension/chippy-page-bridge.js');
const ENV = { ...process.env, OPENSSL_CONF: '/dev/null' };
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chippy-ab-'));
  directories.push(dir);
  return dir;
}

function fiberResponse(label: string) {
  return {
    ok: true,
    result: {
      version: 1, identity: 'portable', capturedAt: '2026-11-25T00:00:00.000Z',
      page: { url: 'http://lab.test/story', title: 'Story' }, fiberCount: 1, truncated: false,
      fibers: [{ id: 'root/a:0', token: 'App', name: 'App', key: null, tag: 0, source: null, props: { label: { kind: 'string', hash: label, preview: `"${label}"`, truncated: false } } }],
    },
  };
}

function exportResponse(renders: number) {
  const rendered = Array.from({ length: renders }, (_, i) => ({ sourceId: `Row#${i}@1`, name: 'Row', depth: 1 }));
  return { ok: true, payload: { meta: { version: 10 }, sources: [], commitStats: { 1: [renders, 1] }, renderedByCommit: { 1: rendered } } };
}

function analyze(args: string[], input?: string) {
  return JSON.parse(execFileSync('node', [ANALYZER, ...args], { input, encoding: 'utf8', env: ENV }));
}

function save(dir: string, renders: number, label = 'x', name = 'flag') {
  const fiberFile = join(dir, '.pending.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(fiberFile, JSON.stringify(fiberResponse(label)));
  return analyze(['ab-save', dir, fiberFile, name], JSON.stringify(exportResponse(renders)));
}

describe('A/B analyzer commands', () => {
  it('saves numbered samples and compares arms given as directories or file lists', () => {
    const root = scratch();
    const off = join(root, 'compiler-off');
    const on = join(root, 'compiler-on');
    expect(save(off, 9)).toMatchObject({ ok: true, arm: 'compiler-off', sample: 1, label: 'flag', commits: 1, fibers: 1 });
    expect(existsSync(join(off, '.pending.json'))).toBe(false);
    save(off, 6);
    save(off, 6);
    save(on, 2);
    save(on, 2);
    expect(readdirSync(off).sort()).toEqual(['sample-1.json.gz', 'sample-2.json.gz', 'sample-3.json.gz']);

    const arm = analyze(['ab-arm', off]);
    expect(arm).toMatchObject({ ok: true, arm: 'compiler-off', samples: 3, settled: true, settledFrom: 2 });

    const compare = analyze(['ab-compare', off, on, '--skip', '1']);
    expect(compare).toMatchObject({ verdict: 'inconclusive', arms: { a: { samples: 2, skipped: 1 }, b: { samples: 1, skipped: 1 } } });
    const listed = analyze(['ab-compare', `${join(off, 'sample-2.json.gz')},${join(off, 'sample-3.json.gz')}`, on]);
    expect(listed.verdict).toBe('equivalent');
    expect(listed.performance.totals.find((row: { key: string }) => row.key === 'renders')).toMatchObject({ a: { median: 6 }, b: { median: 2 }, change: 'better' });
  });

  it('flags a behavior difference and records a failed fiber capture', () => {
    const root = scratch();
    save(join(root, 'a'), 3, 'one');
    save(join(root, 'a'), 3, 'one');
    save(join(root, 'b'), 3, 'two');
    save(join(root, 'b'), 3, 'two');
    expect(analyze(['ab-compare', join(root, 'a'), join(root, 'b')]).verdict).toBe('behavior-changed');

    const fiberFile = join(root, 'failed.json');
    writeFileSync(fiberFile, JSON.stringify({ ok: false, error: 'fiber state capture request failed' }));
    expect(analyze(['ab-save', join(root, 'c'), fiberFile], JSON.stringify(exportResponse(1)))).toMatchObject({ fibers: null, fiberStateError: 'fiber state capture request failed' });
  });

  it('fails clearly on an empty arm or a skip that leaves nothing', () => {
    const root = scratch();
    save(join(root, 'a'), 1);
    const run = (args: string[]) => {
      try { execFileSync('node', [ANALYZER, ...args], { encoding: 'utf8', env: ENV, stdio: 'pipe' }); return ''; } catch (error) { return String((error as { stderr: string }).stderr); }
    };
    expect(run(['ab-arm', join(root, 'missing-dir-or-file.json')])).toContain('ENOENT');
    expect(run(['ab-arm', join(root, 'a'), '--skip', '1'])).toContain('--skip 1 leaves no sample');
  });
});

describe('ab-capture wire chain', () => {
  it('sends a portable fiber capture, then the export, and saves the sample', () => {
    const dir = scratch();
    const log = join(dir, 'requests.log');
    const fiber = join(dir, 'fiber.json');
    const exported = join(dir, 'export.json');
    writeFileSync(fiber, JSON.stringify(fiberResponse('x')));
    writeFileSync(exported, JSON.stringify(exportResponse(4)));
    const fakeCurl = join(dir, 'curl');
    writeFileSync(fakeCurl, `#!/bin/sh
out=""; body=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\t%s\\n' "$url" "$body" >> "$CHIPPY_LOG"
case "$url" in
  */eval-probe) cat "$CHIPPY_FIBER" > "$out" ;;
  */avalanche) cat "$CHIPPY_EXPORT" > "$out" ;;
  *) printf '{"ok":true}' > "$out" ;;
esac
printf '200'
`);
    chmodSync(fakeCurl, 0o755);
    const arm = join(dir, 'gate-on');
    const out = execFileSync('bash', [SHELL, 'ab-capture', 'client-1', arm, 'gate on', '500'], {
      encoding: 'utf8',
      env: { ...ENV, PATH: `${dir}:${process.env.PATH || ''}`, CHIPPY_LOG: log, CHIPPY_FIBER: fiber, CHIPPY_EXPORT: exported },
    });
    expect(JSON.parse(out)).toMatchObject({ ok: true, arm: 'gate-on', sample: 1, label: 'gate on', commits: 1, fibers: 1 });

    const requests = readFileSync(log, 'utf8').trim().split('\n').map((line) => {
      const [url, body] = line.split('\t');
      return { path: url.replace(/^https?:\/\/[^/]+/, ''), body: JSON.parse(body) };
    }).filter((r) => /eval-probe|avalanche/.test(r.path));
    expect(requests).toEqual([
      { path: '/__chippy/api/pages/client-1/eval-probe', body: { command: 'capture-fiber-state', options: { maxFibers: 500, portable: true }, timeoutMs: 30000 } },
      { path: '/__chippy/api/pages/client-1/avalanche', body: { action: 'export', timeoutMs: 60000 } },
    ]);

    const sample = readJsonFile(join(arm, 'sample-1.json.gz')) as { kind: string; label: string; fiberState: { identity: string }; report: { commitStats: object } };
    expect(sample).toMatchObject({ kind: 'chippy-ab-sample', label: 'gate on', fiberState: { identity: 'portable' }, report: { commitStats: { 1: [4, 1] } } });
    expect(existsSync(join(arm, '.fiber-state.pending.json'))).toBe(false);
  });

  it('forwards the capture options from the helper to the page capture', () => {
    const helper = readFileSync(HELPER, 'utf8');
    const bridge = readFileSync(BRIDGE, 'utf8');
    expect(helper).toMatch(/FIBER_COMMANDS = new Set\(\[[^\]]*'capture-fiber-state'/);
    expect(helper).toContain('if (body.options != null) wsCommand.options = body.options;');
    expect(bridge).toContain('evalCaptureFiberState(command.options || {})');
    expect(bridge).toMatch(/b\.captureFiberState\(\{\s*\.\.\.options,/);
  });

  it('lists the A/B commands in the shell usage', () => {
    const usage = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8', env: ENV });
    expect(usage).toContain('ab-capture <clientId> <armDir> [label] [maxFibers]');
    expect(usage).toContain('ab-arm <arm> [--skip N] [--top N]');
    expect(usage).toContain('ab-compare <armA> <armB> [--skip N] [--top N]');
  });
});
