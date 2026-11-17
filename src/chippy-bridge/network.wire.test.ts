import { describe, it, expect } from 'vitest';
import { buildAvalancheCommand } from '../../.agents/skills/chippy/scripts/build-avalanche-command';
import { evalAvalanche, type AvalancheApi } from './avalanche-commands';

/**
 * Network signals wire-level test (Rule 7): HTTP body → buildAvalancheCommand
 * → bridge, for `avalanche-network`, `commit-peek include=network`, and the
 * `commit-list` network counts.
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

const request = (id: number, url: string, startTime: number, endTime: number, initiatorType = 'fetch') => ({
  id, url, initiatorType, startTime, endTime, duration: endTime - startTime,
  status: 200, cached: false, startedBeforeCapture: false,
});

const report = {
  meta: { network: { supported: true, enabled: true, windowStart: 0, requests: 3, dropped: 0, ignoredOwn: 0 } },
  commitStats: { 1: [1], 2: [1] },
  commitTimings: {
    1: { startTime: 110, endTime: 115, render: { renderStart: 100 } },
    2: { startTime: 420, endTime: 425, render: { renderStart: 400 } },
  },
  networkRequests: [
    request(1, 'https://app.test/api/items', 130, 380),
    request(2, 'https://app.test/api/user', 135, 390),
    request(3, 'https://cdn.test/logo.png', 140, 145, 'img'),
  ],
};

const run = (body: Record<string, unknown>) => evalAvalanche(
  buildAvalancheCommand(body, 'rq') as Parameters<typeof evalAvalanche>[0],
  makeApiWithReport(report),
  null,
);

describe('avalanche-network — wire end-to-end', () => {
  it('forwards top, by, match, initiators, and window to the network view', () => {
    const command = buildAvalancheCommand({
      action: 'network', top: 1, by: 'duration', match: 'api/', initiators: ['fetch'], window: 30,
    }, 'rq');
    expect(command).toMatchObject({ action: 'network', top: 1, by: 'duration', match: 'api/', initiators: ['fetch'], window: 30 });

    const result = run({ action: 'network', top: 1, by: 'duration', match: 'api/', initiators: ['fetch'], window: 30 });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      available: true,
      windowMs: 30,
      by: 'duration',
      total: 2,
      summary: { byInitiator: { fetch: 2 }, landedBeforeCommit: 2, startedAfterCommit: 2 },
      rows: [{ id: 2, startedAfter: { commitId: 1, gapMs: 20 }, landedBefore: { commitId: 2, gapMs: 10 } }],
    });
  });

  it('returns the valid sort keys for an unknown by', () => {
    const result = run({ action: 'network', by: 'size' });
    expect(result).toMatchObject({ ok: false, error: 'unsupported network sort key: size', validBy: ['start', 'end', 'duration'] });
  });

  it('commit-peek include=network lists linked requests for one commit', () => {
    const result = run({ action: 'commit-peek', commitId: 2, include: ['network'], maxItems: 1 });
    expect(result.ok).toBe(true);
    expect((result.payload as Record<string, unknown>).network).toMatchObject({
      landedBefore: [{ id: 1 }],
      landedBeforeTotal: 2,
      startedAfterTotal: 0,
      startedDuringRenderTotal: 0,
      inFlight: 0,
    });
  });

  it('commit-list counts network links per commit and sorts by them', () => {
    const result = run({ action: 'commit-list', top: 5, by: 'network' }) as unknown as {
      ok: boolean; rows: Array<{ commitId: number; network: Record<string, number> }>;
    };
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => [row.commitId, row.network])).toEqual([
      [2, { landedBefore: 2, startedAfter: 0, startedDuringRender: 0 }],
      [1, { landedBefore: 0, startedAfter: 3, startedDuringRender: 0 }],
    ]);
  });
});
