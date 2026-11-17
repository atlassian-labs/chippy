import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ANALYZER = '.agents/skills/chippy/scripts/avalanche-analyze.cjs';
const response = JSON.stringify({
  ok: true,
  payload: {
    meta: { version: 8, commits: 2 },
    sources: [],
    commitStats: { 1: [3, 1], 2: [5, 1] },
    renderedByCommit: { 2: [{ sourceId: 'T1#1@1', name: 'Card' }] },
  },
});

function analyze(args: string[], input?: string): string {
  return execFileSync('node', [ANALYZER, ...args], { input, encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: '/dev/null' } });
}

describe('avalanche-analyze save', () => {
  it('writes gzip for a .gz file and reads it back offline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chippy-save-'));
    const plain = join(dir, 'capture.json');
    const packed = join(dir, 'capture.json.gz');
    const plainResult = JSON.parse(analyze(['save', '0', plain], response));
    const packedResult = JSON.parse(analyze(['save', '0', packed], response));

    expect(readFileSync(packed).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(packedResult).toMatchObject({ ok: true, commits: 2, jsonBytes: plainResult.bytes });
    expect(plainResult.jsonBytes).toBeUndefined();

    const peek = (file: string) => JSON.parse(analyze([file, 'commit-peek', '2', 'stats,rendered']));
    expect(peek(packed)).toEqual(peek(plain));
    expect(peek(packed).payload.renderedTotal).toBe(1);
  });
});
