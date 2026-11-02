import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const FORMATTER = resolve('.agents/skills/chippy/scripts/format-probe-result.js');

function runFormatter(mode: string, payload: unknown) {
  return spawnSync(process.execPath, [FORMATTER, mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

describe('format-probe-result CLI presentation', () => {
  const payload = {
    ok: true,
    result: {
      ok: true,
      text: [
        'MyComponent @ Component.tsx:1',
        'hooks: 6 (DebugValue=1, Effect=2, Memo=1, State=2)',
        'complexity:',
        '  total hook slots: 6',
        '  debug landmarks:',
        '    useSweetState > hook · DebugValue — RSS: Store',
        'structure:',
        '  └─ useSweetState',
        '     └─ hook · DebugValue — RSS: Store',
      ].join('\n'),
    },
  };

  it('prints semantic text directly by default mode', () => {
    const result = runFormatter('text', payload);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('complexity:\n  total hook slots: 6');
    expect(result.stdout).toContain('structure:\n  └─ useSweetState');
    expect(result.stdout).not.toContain('"text"');
  });

  it('prints only the complete complexity section at semantic boundaries', () => {
    const result = runFormatter('complexity', payload);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe([
      'complexity:',
      '  total hook slots: 6',
      '  debug landmarks:',
      '    useSweetState > hook · DebugValue — RSS: Store',
    ].join('\n'));
  });

  it('preserves the full JSON payload on request', () => {
    const result = runFormatter('json', payload);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('falls back to JSON for unsuccessful probe results', () => {
    const errorPayload = { ok: false, error: 'no page' };
    const result = runFormatter('text', errorPayload);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(errorPayload);
  });
});
