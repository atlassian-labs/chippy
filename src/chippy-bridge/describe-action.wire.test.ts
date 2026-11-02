import { describe, it, expect } from 'vitest';
import { buildAvalancheCommand } from '../../.agents/skills/chippy/scripts/build-avalanche-command';
import { evalAvalanche, type AvalancheApi } from './avalanche-commands';

/**
 * describe-action wire-level test.
 *
 * REGRESSION GUARD.
 *
 * History:
 * 1. `describe-action` was implemented in the bridge.
 * 2. Unit tests called it with hand-built command objects that already had
 *    `actionId`. They passed.
 * 3. `buildAvalancheCommand` (the HTTP→bridge translator) did NOT forward
 *    `actionId`. The shipped extension always responded with
 *    "describe-action requires numeric actionId" because the bridge never
 *    received the field.
 *
 * Rule 7 (AGENTS.md): every shell command must have a test that exercises
 * the full chain — HTTP body → buildAvalancheCommand → bridge. This is that
 * test for describe-action.
 *
 * Note: the shell wrapper itself (`chippy.sh`) is a `curl` invocation and is
 * tested elsewhere. This test starts at the HTTP body that the helper-server
 * receives, because that is the first programmatically observable boundary.
 */

function makeApiWithReport(report: Record<string, unknown>): AvalancheApi {
  return {
    install: () => {},
    uninstall: () => {},
    report: () => ({
      toSerializable: () => report,
    }) as unknown as ReturnType<AvalancheApi['report']>,
  } as AvalancheApi;
}

describe('describe-action — wire end-to-end', () => {
  it('forwards body.actionId through buildAvalancheCommand to a successful bridge lookup', () => {
    // 1. Helper server receives HTTP body
    const httpBody = { action: 'describe-action', actionId: 5 };

    // 2. buildAvalancheCommand translates body → bridge command
    const command = buildAvalancheCommand(httpBody, 'req-x');
    expect(command.action).toBe('describe-action');
    expect(command.actionId).toBe(5); // <- the bug was: this was undefined

    // 3. Bridge handler consumes command, returns matching action
    const api = makeApiWithReport({
      interactionsByCommit: {
        7: [
          { id: 5, lastCommitId: 6, deltaTime: 12.3, action: 'click', location: {} },
        ],
      },
    });
    const result = evalAvalanche(command as Parameters<typeof evalAvalanche>[0], api, null);

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      actionId: 5,
      commitId: 7,
      found: true,
      action: { id: 5, action: 'click' },
    });
  });

  it('returns a clean "requires numeric actionId" error when body.actionId is missing', () => {
    const httpBody = { action: 'describe-action' };
    const command = buildAvalancheCommand(httpBody, 'r');
    expect(command.actionId).toBeUndefined();

    const api = makeApiWithReport({ interactionsByCommit: {} });
    const result = evalAvalanche(command as Parameters<typeof evalAvalanche>[0], api, null);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('describe-action requires numeric actionId');
  });

  it('returns found:false when actionId is forwarded but not present in any commit', () => {
    const httpBody = { action: 'describe-action', actionId: 999 };
    const command = buildAvalancheCommand(httpBody, 'r');
    expect(command.actionId).toBe(999);

    const api = makeApiWithReport({
      interactionsByCommit: {
        1: [{ id: 1, lastCommitId: 0, deltaTime: 1, action: 'click', location: {} }],
      },
    });
    const result = evalAvalanche(command as Parameters<typeof evalAvalanche>[0], api, null);
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ actionId: 999, found: false });
  });

  it('coerces string actionId through the wire (HTTP query params arrive as strings)', () => {
    const httpBody = { actionId: '3', action: 'describe-action' };
    const command = buildAvalancheCommand(httpBody as Record<string, unknown>, 'r');
    expect(command.actionId).toBe(3);
    expect(typeof command.actionId).toBe('number');
  });
});
