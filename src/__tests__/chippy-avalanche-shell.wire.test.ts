// Wire-level tests for chippy.sh Avalanche commands: shell wrapper → HTTP body
// → buildAvalancheCommand → bridge command. A fake curl records the body the
// wrapper posts and answers with a prepared helper response.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evalAvalanche, type AvalancheApi } from '../chippy-bridge/avalanche-commands';
import { buildReport, type ProfilerState } from '../avalanche/reporter';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildAvalancheCommand } = require('../../.agents/skills/chippy/scripts/build-avalanche-command.js');

const CHIPPY = resolve(__dirname, '../../.agents/skills/chippy/scripts/chippy.sh');
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeHelper(response: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-avalanche-shell-'));
  directories.push(directory);
  writeFileSync(join(directory, 'response.json'), JSON.stringify(response));
  const fakeCurl = join(directory, 'curl');
  writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    -d) printf '%s\\n' "$2" >> "${directory}/bodies.jsonl"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$output_file" ]; then cp "${directory}/response.json" "$output_file"; printf '200'; else cat "${directory}/response.json"; fi
`);
  chmodSync(fakeCurl, 0o755);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_HELPER_TOKEN: 'test' };
  return {
    directory,
    run: (...args: string[]) => execFileSync('bash', [CHIPPY, ...args], { env, encoding: 'utf8' }),
    bodies: () => readFileSync(join(directory, 'bodies.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
  };
}

// Hundreds of sources whose changed hooks hold circular DOM refs.
function largeCapture(): AvalancheApi {
  const sources: ProfilerState['sources'] = new Map();
  const commitStats: ProfilerState['commitStats'] = {};
  for (let commit = 1; commit <= 100; commit++) commitStats[commit] = [5, 1, 0, 3000, 0, 0, 0, 0, 0, 0] as never;
  for (let i = 0; i < 300; i++) {
    const node: Record<string, unknown> = { nodeType: 1, nodeName: 'DIV' };
    node.fiber = { tag: 5, stateNode: node, return: null, memoizedProps: {} };
    const updateHistory: Record<number, unknown> = {};
    const collateralByCommit: Record<number, number> = {};
    for (let commit = 1 + (i % 3); commit <= 100; commit += 3) {
      updateHistory[commit] = { 0: { prevValue: { current: null }, currentValue: { current: node } } };
      collateralByCommit[commit] = 1 + (i % 7);
    }
    sources.set(`T${i}#1@${i}`, {
      type: function Cell() { return null; }, depth: i, renderCount: 1, causedUpdates: 1,
      collateralUpdates: 300 - i, maxCollateralUpdates: 300 - i, maxPenetrationDepth: i,
      updateHistory, collateralByCommit,
    } as never);
  }
  const state = {
    commits: 100, sources, amplifiers: new Map(), amplifierSources: new Map(), thrashCounts: null,
    memoizedUpdatersAvailable: false, commitsWithMemoizedUpdaters: 0, commitStats,
    metricsByCommit: {}, lastMetricsSnapshot: null, commitTimings: {}, lastCommitEndTime: 0,
    suspenseByCommit: {}, unmountsByCommit: {}, interactionActions: [], interactionsByCommit: {},
    networkRequests: [], renderedByCommit: {},
  } as ProfilerState;
  return { report: (topN = 10) => buildReport(state, false, topN, 'effect') as never };
}

describe('chippy.sh avalanche-uninstall', () => {
  it('posts the uninstall action, which reaches the bridge and stops capture', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true, action: 'uninstall' } });
    expect(JSON.parse(helper.run('avalanche-uninstall', 'client-1'))).toMatchObject({ ok: true });
    const [body] = helper.bodies();
    expect(body).toEqual({ action: 'uninstall' });
    const command = buildAvalancheCommand(body, 'rq-1');
    expect(command).toMatchObject({ type: 'eval-avalanche', action: 'uninstall' });
    const uninstall = vi.fn();
    const result = evalAvalanche(command, { uninstall, status: () => ({ installed: false }) as never }, null);
    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, action: 'uninstall', status: { installed: false } });
  });

  it('requires a client id', () => {
    const helper = fakeHelper({ ok: true });
    expect(() => helper.run('avalanche-uninstall')).toThrow(/requires <clientId>/);
  });

  it('is listed in the usage text', () => {
    expect(execFileSync('bash', [CHIPPY, 'help'], { encoding: 'utf8' })).toContain('avalanche-uninstall <clientId>');
  });
});

describe('chippy.sh avalanche-save on a large capture', () => {
  it('asks the helper to wait for a large export and saves a JSON-safe report', () => {
    const exported = evalAvalanche(buildAvalancheCommand({ action: 'export' }, 'rq'), largeCapture(), null);
    expect(exported.ok).toBe(true);
    const helper = fakeHelper({ ok: true, result: exported });
    const file = join(helper.directory, 'capture.json');
    expect(JSON.parse(helper.run('avalanche-save', 'client-1', file))).toMatchObject({ ok: true, commits: 100 });
    const [body] = helper.bodies();
    expect(body).toEqual({ action: 'export', timeoutMs: 60000 });
    expect(buildAvalancheCommand(body, 'rq')).toMatchObject({ action: 'export' });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.sources).toHaveLength(300);
    const peek = JSON.parse(helper.run('avalanche-offline', file, 'commit-peek', '1', 'sources', '4'));
    expect(peek.payload.sources).toHaveLength(4);
    expect(peek.payload.sources.some((row: { missing?: boolean }) => row.missing)).toBe(false);
    expect(peek.payload.sources[0].trashers[0].currentValue).toEqual({ current: '[Object div]' });
  });

  it('keeps the longer wait when saving the last N commits', () => {
    const exported = evalAvalanche({ action: 'export' }, largeCapture(), null);
    const helper = fakeHelper({ ok: true, result: exported });
    helper.run('avalanche-save', 'client-1', join(helper.directory, 'last.json'), '5');
    expect(helper.bodies()[0]).toEqual({ action: 'export-last', count: 5, timeoutMs: 60000 });
  });
});

describe('chippy.sh avalanche-dom-diff', () => {
  function captureWithDomChanges(): AvalancheApi {
    const state = {
      commits: 3, sources: new Map(), amplifiers: new Map(), amplifierSources: new Map(), thrashCounts: null,
      memoizedUpdatersAvailable: false, commitsWithMemoizedUpdaters: 0, commitStats: {},
      metricsByCommit: {}, lastMetricsSnapshot: null, commitTimings: { 2: { startTime: 10 }, 3: { startTime: 25 } }, lastCommitEndTime: 0,
      suspenseByCommit: {}, unmountsByCommit: {}, interactionActions: [], interactionsByCommit: {},
      networkRequests: [], renderedByCommit: {},
      domByCommit: {
        2: { changes: [{ op: '+', node: 'li[data-testid=item-a]', at: 'List › Item', html: '<li>a</li>', elements: 1 }], ms: 0.1 },
        3: {
          changes: [
            { op: '~', node: 'span', at: 'Header', props: [['text', '"1"', '"2"']] },
            { op: '-', node: 'li[data-testid=item-b]', at: 'List › Item', html: '<li>b</li>', elements: 1 },
          ],
          ms: 0.1,
        },
      },
    } as unknown as ProfilerState;
    return { report: (topN = 10) => buildReport(state, false, topN, 'effect') as never };
  }

  it('posts every position, which reaches the bridge and filters the diff', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-dom-diff', 'client-1', '2', '9', 'item', '5', '10');
    const [body] = helper.bodies();
    expect(body).toEqual({ action: 'dom-diff', fromCommit: 2, toCommit: 9, match: 'item', maxItems: 5, top: 10 });
    const command = buildAvalancheCommand(body, 'rq-1');
    expect(command).toMatchObject({ type: 'eval-avalanche', action: 'dom-diff', fromCommit: 2, toCommit: 9, match: 'item', maxItems: 5, top: 10 });
    const result = evalAvalanche(command, captureWithDomChanges(), null) as any;
    expect(result.ok).toBe(true);
    expect(result.payload.commits.map((c: any) => [c.commitId, c.t, c.changes.map((x: any) => x.op)])).toEqual([[2, 0, ['+']], [3, 15, ['-']]]);
  });

  it('skips empty positions', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-dom-diff', 'client-1', '', '', 'a"b');
    expect(helper.bodies()).toEqual([{ action: 'dom-diff', match: 'a"b' }]);
  });

  it('requires a client id', () => {
    const helper = fakeHelper({ ok: true });
    expect(() => helper.run('avalanche-dom-diff')).toThrow(/requires <clientId>/);
  });

  it('is listed in the usage text', () => {
    expect(execFileSync('bash', [CHIPPY, 'help'], { encoding: 'utf8' })).toContain('avalanche-dom-diff <clientId>');
  });
});

describe('chippy.sh avalanche-summary', () => {
  it('posts top and maxItems, which reach the bridge digest', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-summary', 'client-1', '3', '2');
    const [body] = helper.bodies();
    expect(body).toEqual({ action: 'summary', top: 3, maxItems: 2 });
    const command = buildAvalancheCommand(body, 'rq-1');
    expect(command).toMatchObject({ type: 'eval-avalanche', action: 'summary', top: 3, maxItems: 2 });
    const result = evalAvalanche(command, largeCapture(), null) as any;
    expect(result).toMatchObject({ ok: true, action: 'summary', payload: { commits: 100 } });
    expect(result.payload.topCommits).toHaveLength(3);
    for (const commit of result.payload.topCommits) expect(commit.sources.length).toBeLessThanOrEqual(2);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('skips empty positions', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-summary', 'client-1', '', '4');
    expect(helper.bodies()).toEqual([{ action: 'summary', maxItems: 4 }]);
  });

  it('requires a client id', () => {
    const helper = fakeHelper({ ok: true });
    expect(() => helper.run('avalanche-summary')).toThrow(/requires <clientId>/);
  });

  it('is listed in the usage text', () => {
    expect(execFileSync('bash', [CHIPPY, 'help'], { encoding: 'utf8' })).toContain('avalanche-summary <clientId>');
  });
});

describe('chippy.sh avalanche-perf', () => {
  it('posts types, top, match, and the commit range, which reach the bridge', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-perf', 'client-1', 'mark,long-animation-frame', '5', '^ufo', '3', '9');
    const [body] = helper.bodies();
    expect(body).toEqual({ action: 'perf', types: 'mark,long-animation-frame', top: 5, match: '^ufo', fromCommit: 3, toCommit: 9 });
    expect(buildAvalancheCommand(body, 'rq-1')).toMatchObject({ type: 'eval-avalanche', action: 'perf', types: 'mark,long-animation-frame', top: 5, match: '^ufo', fromCommit: 3, toCommit: 9 });
  });

  it('skips empty positions', () => {
    const helper = fakeHelper({ ok: true, result: { ok: true } });
    helper.run('avalanche-perf', 'client-1', '', '', 'board');
    expect(helper.bodies()).toEqual([{ action: 'perf', match: 'board' }]);
  });

  it('requires a client id', () => {
    const helper = fakeHelper({ ok: true });
    expect(() => helper.run('avalanche-perf')).toThrow(/requires <clientId>/);
  });

  it('is listed in the usage text', () => {
    expect(execFileSync('bash', [CHIPPY, 'help'], { encoding: 'utf8' })).toContain('avalanche-perf <clientId>');
  });
});
