import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildAvalancheCommand } = require('../../.agents/skills/chippy/scripts/build-avalanche-command.js');

/**
 * Shell command parity enumeration test (Rule 7).
 *
 * Each row in SHELL_COMMANDS represents an actual shell invocation in
 * `.agents/skills/chippy/scripts/chippy.sh`. The HTTP body it sends is
 * captured verbatim. The test asserts that `buildAvalancheCommand` forwards
 * every field that the bridge consumer expects.
 *
 * If a new shell command is added without a row here, that is a Rule 7
 * violation. If the shell command is changed (a field added, removed, or
 * renamed), this test catches the silent-drop pattern.
 *
 * Source of truth for the shell bodies:
 *   .agents/skills/chippy/scripts/chippy.sh (post_avalanche call sites,
 *   line numbers as of 2026-05-16):
 *     557, 565, 576/578, 597/599, 612, 637, 646, 655, 665/667/668,
 *     680, 692, 781, 783
 */

interface ShellCommandCase {
  name: string;             // shell command label
  shellLine: number;        // chippy.sh line for traceability
  body: Record<string, unknown>; // exact HTTP body
  requiredFields: string[]; // fields the bridge MUST receive
  forbiddenFields?: string[]; // fields that must NOT be coerced/added
}

const SHELL_COMMANDS: ShellCommandCase[] = [
  {
    name: 'avalanche-clear',
    shellLine: 557,
    body: { action: 'clear' },
    requiredFields: ['type', 'requestId', 'action'],
  },
  {
    name: 'avalanche-status',
    shellLine: 565,
    body: { action: 'status' },
    requiredFields: ['type', 'requestId', 'action'],
  },
  {
    name: 'avalanche-export-last (with count)',
    shellLine: 576,
    body: { action: 'export-last', count: 50 },
    requiredFields: ['type', 'requestId', 'action', 'count'],
  },
  {
    name: 'avalanche-export',
    shellLine: 578,
    body: { action: 'export' },
    requiredFields: ['type', 'requestId', 'action'],
  },
  {
    name: 'avalanche-hot-sources (with limit)',
    shellLine: 597,
    body: { action: 'hot-sources', limit: 10 },
    requiredFields: ['type', 'requestId', 'action', 'limit'],
  },
  {
    name: 'avalanche-hot-sources (no limit)',
    shellLine: 599,
    body: { action: 'hot-sources' },
    requiredFields: ['type', 'requestId', 'action'],
  },
  {
    name: 'avalanche-commit-list',
    shellLine: 612,
    body: { action: 'commit-list', top: 20, by: 'collateral' },
    requiredFields: ['type', 'requestId', 'action', 'top', 'by'],
  },
  {
    name: 'avalanche-commit-peek',
    shellLine: 637,
    body: {
      action: 'commit-peek',
      commitId: 42,
      include: ['stats', 'sources', 'timing', 'metrics', 'actions'],
      depth: 3,
      maxItems: 50,
    },
    requiredFields: ['type', 'requestId', 'action', 'commitId', 'include', 'depth', 'maxItems'],
  },
  {
    name: 'avalanche-describe-action',
    shellLine: 646,
    body: { action: 'describe-action', actionId: 7 },
    requiredFields: ['type', 'requestId', 'action', 'actionId'],
  },
  {
    name: 'avalanche-install',
    shellLine: 655,
    body: {
      action: 'install',
      options: { captureFibers: true, detectionMode: 'sources', historySize: 1000 },
    },
    requiredFields: ['type', 'requestId', 'action', 'options'],
  },
  {
    name: 'avalanche-recapture install',
    shellLine: 665,
    body: {
      action: 'install',
      options: { captureFibers: true, detectionMode: 'sources', historySize: 1000 },
    },
    requiredFields: ['type', 'requestId', 'action', 'options'],
  },
  {
    name: 'avalanche-debug-hook',
    shellLine: 680,
    body: { action: 'debug-hook', sourceId: 'src-1', hookIndex: 4, window: 3 },
    requiredFields: ['type', 'requestId', 'action', 'sourceId', 'hookIndex', 'window'],
  },
  {
    name: 'avalanche-save (with count)',
    shellLine: 692,
    body: { action: 'export-last', count: 200 },
    requiredFields: ['type', 'requestId', 'action', 'count'],
  },
  {
    name: 'reload-with-avalanche reset',
    shellLine: 781,
    body: { action: 'reset' },
    requiredFields: ['type', 'requestId', 'action'],
  },
  {
    name: 'reload-with-avalanche install',
    shellLine: 783,
    body: {
      action: 'install',
      options: { captureFibers: true, detectionMode: 'sources' },
    },
    requiredFields: ['type', 'requestId', 'action', 'options'],
  },
];

describe('Shell command parity — every chippy.sh body must survive buildAvalancheCommand', () => {
  for (const c of SHELL_COMMANDS) {
    it(`forwards all required fields for ${c.name} (chippy.sh:${c.shellLine})`, () => {
      const cmd = buildAvalancheCommand(c.body, 'rq-1');
      for (const field of c.requiredFields) {
        expect(cmd).toHaveProperty(field);
        expect(cmd[field]).not.toBeUndefined();
      }
    });
  }

  it('coerces commitId to a number, not a string', () => {
    const cmd = buildAvalancheCommand({ action: 'commit-peek', commitId: '7' }, 'rq');
    expect(cmd.commitId).toBe(7);
    expect(typeof cmd.commitId).toBe('number');
  });

  it('preserves include[] as an array of strings', () => {
    const cmd = buildAvalancheCommand({
      action: 'commit-peek', commitId: 1, include: ['stats', 'sources'],
    }, 'rq');
    expect(Array.isArray(cmd.include)).toBe(true);
    expect(cmd.include).toEqual(['stats', 'sources']);
  });

  it('does not lose options nested fields (install scenario)', () => {
    const cmd = buildAvalancheCommand({
      action: 'install',
      options: { captureFibers: true, detectionMode: 'sources', historySize: 1000 },
    }, 'rq');
    expect(cmd.options).toEqual({
      captureFibers: true, detectionMode: 'sources', historySize: 1000,
    });
  });

  it('coerces sourceId to string for debug-hook', () => {
    const cmd = buildAvalancheCommand({
      action: 'debug-hook', sourceId: 42, hookIndex: 1, window: 3,
    }, 'rq');
    expect(typeof cmd.sourceId).toBe('string');
    expect(cmd.sourceId).toBe('42');
  });

  it('coerces hookIndex and window to numbers for debug-hook', () => {
    const cmd = buildAvalancheCommand({
      action: 'debug-hook', sourceId: 's', hookIndex: '4', window: '3',
    }, 'rq');
    expect(cmd.hookIndex).toBe(4);
    expect(cmd.window).toBe(3);
  });

  it('coerces by to string for commit-list', () => {
    const cmd = buildAvalancheCommand({ action: 'commit-list', top: 5, by: 'sources' }, 'rq');
    expect(cmd.by).toBe('sources');
    expect(typeof cmd.by).toBe('string');
  });

  it('rejects malformed include (non-array) silently — does not break the call', () => {
    const cmd = buildAvalancheCommand({
      action: 'commit-peek', commitId: 1, include: 'stats',
    }, 'rq');
    expect(cmd.include).toBeUndefined();
  });

  it('still produces a valid command when body is empty', () => {
    const cmd = buildAvalancheCommand({}, 'rq');
    expect(cmd.type).toBe('eval-avalanche');
    expect(cmd.action).toBe('status');
    expect(cmd.requestId).toBe('rq');
  });

  it('defaults action to "status" when omitted', () => {
    const cmd = buildAvalancheCommand({}, 'rq');
    expect(cmd.action).toBe('status');
  });
});
