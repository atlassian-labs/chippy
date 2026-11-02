import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evalAvalanche } from '../chippy-bridge/avalanche-commands';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';
import { analyzeSavedReport, keepLastCommits, unwrapSavedReport } from './offline';

const SCRIPTS = resolve(__dirname, '../../.agents/skills/chippy/scripts');
const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
});

// Drives the detector through the DevTools hook and returns the live API plus
// the JSON export a user would save.
function capture(commits: number) {
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot() {} };
  detector = createAvalancheDetector({ detectionMode: 'full' });
  detector.install();
  const fiber = {
    tag: 0, type: function OfflineCounter() {}, flags: PerformedWork,
    subtreeFlags: 0, child: null, sibling: null, return: null,
    memoizedState: null, memoizedProps: {}, alternate: null,
  } as unknown as Fiber;
  const root = { current: fiber };
  for (let n = 0; n < commits; n++) {
    root.current = { ...root.current };
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
  }
  const api = { report: () => detector!.report() as any };
  const exported = evalAvalanche({ action: 'export' }, api, null);
  return { api, saved: JSON.parse(JSON.stringify(exported.payload)) };
}

describe('offline Avalanche analysis', () => {
  it('reads the current export format in every wrapper the helper produces', () => {
    const { saved } = capture(2);
    expect(unwrapSavedReport(saved)).toBe(saved);
    expect(unwrapSavedReport({ payload: saved })).toBe(saved);
    expect(unwrapSavedReport({ ok: true, result: { payload: saved } })).toBe(saved);
    expect(unwrapSavedReport({ commits: [] })).toBeNull();
  });

  it('returns the same commit-list and commit-peek as the live page', () => {
    const { api, saved } = capture(3);
    const report = unwrapSavedReport(saved)!;
    const { available: _a, ...liveList } = evalAvalanche({ action: 'commit-list', top: 5, by: 'collateral' }, api, null) as any;
    expect(analyzeSavedReport(report, 'commit-list', { _: ['5', 'collateral'] })).toEqual(liveList);
    const { available: _b, ...livePeek } = evalAvalanche({ action: 'commit-peek', commitId: 2, include: ['stats', 'rendered'] }, api, null) as any;
    expect(analyzeSavedReport(report, 'commit-peek', { _: ['2', 'stats,rendered'] })).toEqual(livePeek);
  });

  it('summarizes commits and keeps the last N', () => {
    const { saved } = capture(4);
    const report = unwrapSavedReport(saved)!;
    expect(analyzeSavedReport(report, 'summary', { _: [] })).toMatchObject({ ok: true, commits: 4 });
    const trimmed = keepLastCommits(report, 2);
    expect(analyzeSavedReport(trimmed, 'summary', { _: [] })).toMatchObject({ commits: 2, firstCommitId: 3, lastCommitId: 4 });
  });

  it('finds rendered components by name', () => {
    const { saved } = capture(2);
    const result = analyzeSavedReport(unwrapSavedReport(saved)!, 'source-search', { _: [], name: 'offlinecounter' }) as any;
    expect(result.renderedAvailable).toBe(true);
    const renders = Object.values(saved.renderedByCommit as Record<string, any[]>).flat().length;
    expect(renders).toBeGreaterThan(0);
    expect(result.rendered.every((row: any) => row.name === 'OfflineCounter')).toBe(true);
    expect(result.rendered.reduce((sum: number, row: any) => sum + row.renders, 0)).toBe(renders);
    expect(analyzeSavedReport(unwrapSavedReport(saved)!, 'source-search', { _: [] })).toMatchObject({ ok: false });
  });
});

describe('chippy.sh avalanche-save and avalanche-offline', () => {
  it('saves the current export and analyzes it offline', () => {
    const { saved } = capture(3);
    const directory = mkdtempSync(join(tmpdir(), 'chippy-offline-'));
    try {
      writeFileSync(join(directory, 'response.json'), JSON.stringify({ ok: true, result: { payload: saved } }));
      const fakeCurl = join(directory, 'curl');
      writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output_file="$2"; shift 2 ;; *) shift ;; esac
done
if [ -n "$output_file" ]; then cp "${directory}/response.json" "$output_file"; printf '200'; else cat "${directory}/response.json"; fi
`);
      chmodSync(fakeCurl, 0o755);
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_HELPER_TOKEN: 'test' };
      const file = join(directory, 'capture.json');
      const chippy = join(SCRIPTS, 'chippy.sh');
      const out = JSON.parse(execFileSync('bash', [chippy, 'avalanche-save', 'client-1', file, '2'], { env, encoding: 'utf8' }));
      expect(out).toMatchObject({ ok: true, commits: 2 });
      expect(JSON.parse(readFileSync(file, 'utf8')).meta).toBeTruthy();
      const list = JSON.parse(execFileSync('bash', [chippy, 'avalanche-offline', file, 'commit-list', '10'], { env, encoding: 'utf8' }));
      expect(list).toMatchObject({ ok: true, action: 'commit-list', total: 2 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
