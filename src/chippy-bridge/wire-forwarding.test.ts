import { describe, it, expect } from 'vitest';
import { buildAvalancheCommand } from '../../.agents/skills/chippy/scripts/build-avalanche-command';

/**
 * Wire-forwarding contract.
 *
 * Every field that any shell wrapper sends in the POST body MUST be forwarded
 * by buildAvalancheCommand into the bridge command object.
 *
 * If you add a new field to a shell wrapper, add a test here.
 * If you add a new field to buildAvalancheCommand, add a test here.
 *
 * This is the layer that silently dropped `actionId` in the past — that bug
 * shipped because no test covered the wire shape.
 */

describe('buildAvalancheCommand — wire forwarding contract', () => {
  it('always sets envelope fields', () => {
    const cmd = buildAvalancheCommand({}, 'req-1');
    expect(cmd.type).toBe('eval-avalanche');
    expect(cmd.requestId).toBe('req-1');
    expect(cmd.action).toBe('status'); // default
  });

  it('forwards action', () => {
    const cmd = buildAvalancheCommand({ action: 'commit-peek' }, 'r');
    expect(cmd.action).toBe('commit-peek');
  });

  it('forwards options object', () => {
    const cmd = buildAvalancheCommand({ options: { detectionMode: 'devtools' } }, 'r');
    expect(cmd.options).toEqual({ detectionMode: 'devtools' });
  });

  it('does not forward non-object options', () => {
    const cmd = buildAvalancheCommand({ options: 'not-an-object' as never }, 'r');
    expect(cmd.options).toBeUndefined();
  });

  // Numeric / string forwarded fields. One test per field — explicit, no loops,
  // so the test name is the regression record.

  it('forwards max', () => {
    expect(buildAvalancheCommand({ max: 100 }, 'r').max).toBe(100);
  });

  it('forwards count', () => {
    expect(buildAvalancheCommand({ count: 5 }, 'r').count).toBe(5);
  });

  it('forwards limit', () => {
    expect(buildAvalancheCommand({ limit: 20 }, 'r').limit).toBe(20);
  });

  it('forwards commitId', () => {
    expect(buildAvalancheCommand({ commitId: 42 }, 'r').commitId).toBe(42);
  });

  it('forwards top', () => {
    expect(buildAvalancheCommand({ top: 10 }, 'r').top).toBe(10);
  });

  it('forwards by', () => {
    expect(buildAvalancheCommand({ by: 'collateral' }, 'r').by).toBe('collateral');
  });

  it('forwards depth', () => {
    expect(buildAvalancheCommand({ depth: 3 }, 'r').depth).toBe(3);
  });

  it('forwards maxItems', () => {
    expect(buildAvalancheCommand({ maxItems: 50 }, 'r').maxItems).toBe(50);
  });

  it('forwards sourceId', () => {
    expect(buildAvalancheCommand({ sourceId: 'src-7' }, 'r').sourceId).toBe('src-7');
  });

  it('forwards hookIndex', () => {
    expect(buildAvalancheCommand({ hookIndex: 8 }, 'r').hookIndex).toBe(8);
  });

  it('forwards window', () => {
    expect(buildAvalancheCommand({ window: 2 }, 'r').window).toBe(2);
  });

  // REGRESSION: actionId was silently dropped before. Never let it happen again.
  it('forwards actionId (regression: was silently dropped)', () => {
    expect(buildAvalancheCommand({ actionId: 5 }, 'r').actionId).toBe(5);
  });

  it('forwards include array', () => {
    const cmd = buildAvalancheCommand({ include: ['stats', 'actions'] }, 'r');
    expect(cmd.include).toEqual(['stats', 'actions']);
  });

  it('forwards rendered include for commit-peek structural evidence', () => {
    const cmd = buildAvalancheCommand({ action: 'commit-peek', commitId: 42, include: ['stats', 'rendered'] }, 'r');
    expect(cmd).toMatchObject({
      action: 'commit-peek',
      commitId: 42,
      include: ['stats', 'rendered'],
    });
  });

  it('does not forward non-array include', () => {
    const cmd = buildAvalancheCommand({ include: 'stats' as never }, 'r');
    expect(cmd.include).toBeUndefined();
  });

  it('coerces numeric strings to numbers', () => {
    const cmd = buildAvalancheCommand({ actionId: '7' as never, commitId: '12' as never }, 'r');
    expect(cmd.actionId).toBe(7);
    expect(cmd.commitId).toBe(12);
  });

  it('drops unknown body fields (no field pollution)', () => {
    const cmd = buildAvalancheCommand({ bogusField: 'should-not-leak' as never }, 'r');
    expect((cmd as Record<string, unknown>).bogusField).toBeUndefined();
  });

  it('drops null/undefined fields', () => {
    const cmd = buildAvalancheCommand(
      { actionId: null as never, commitId: undefined as never },
      'r',
    );
    expect(cmd.actionId).toBeUndefined();
    expect(cmd.commitId).toBeUndefined();
  });
});
