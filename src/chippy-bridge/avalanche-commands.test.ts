import { describe, it, expect, vi } from 'vitest';
import {
  readAvalancheStatus,
  evalAvalanche,
  tupleToStats,
  getReport,
  UPSTREAM_COMMIT_STAT_KEYS,
  type AvalancheApi,
  type AvalancheApiStatus,
} from './avalanche-commands';

const okStatus: AvalancheApiStatus = {
  installed: true,
  hasMetricsGlobal: false,
  commitCount: 7,
  integrationMode: 'devtools',
};

function makeApi(overrides: Partial<AvalancheApi> = {}): AvalancheApi {
  return {
    status: () => okStatus,
    install: vi.fn(() => ({ ok: true, detectionLevel: 'devtools' })),
    uninstall: vi.fn(() => ({ ok: true })),
    reset: vi.fn(() => ({ ok: true })),
    exportLast: vi.fn(() => ({ commits: 3 })),
    report: vi.fn(() => ({
      sources: [
        { sourceId: 'a', depth: 1, causedUpdates: 1, collateralUpdates: 5, maxCollateralUpdates: 5, maxPenetrationDepth: 1, restartWaste: 0 },
        { sourceId: 'b', depth: 2, causedUpdates: 2, collateralUpdates: 12, maxCollateralUpdates: 8, maxPenetrationDepth: 3, restartWaste: 1 },
        { sourceId: 'c', depth: 0, causedUpdates: 0, collateralUpdates: 1, maxCollateralUpdates: 1, maxPenetrationDepth: 1, restartWaste: 0 },
      ],
      commitStats: {
        '0': [10, 1, 0, 5, 2, 0, 1, 3, 4, 2],
        '1': [4, 2, 1, 3, 0, 0, 0, 0, 1, 1],
      },
      sourcesByCommit: {
        '0': [{ sourceId: 'a', collateral: 5, rank: 0 }, { sourceId: 'b', collateral: 12, rank: 1 }],
        '1': [{ sourceId: 'c', collateral: 1, rank: 0 }],
      },
      commitTimings: { '0': { duration: 12.5 } },
      interactionsByCommit: {
        '0': [{
          id: 0,
          lastCommitId: 0,
          deltaTime: 5,
          action: 'click',
          location: {
            dom: { tag: 'button', text: 'Save', nearestTestId: 'save' },
            targetFiber: {
              name: 'Button',
              key: null,
              source: { fileName: 'Button.jsx', lineNumber: 3, columnNumber: null },
              ownerStackKind: 'owners',
              ownerStack: [{
                name: 'Toolbar',
                key: null,
                props: ['onSave'],
                hookCount: 2,
                hookCountTruncated: false,
                hookCountMax: 500,
                source: { fileName: 'Toolbar.jsx', lineNumber: 1, columnNumber: null },
              }],
            },
          },
        }],
      },
      renderedByCommit: {
        '0': [{
          sourceId: 'child',
          name: 'Child',
          depth: 2,
          parentSourceId: 'parent',
          ownerSourceId: 'parent',
          isSelfSource: false,
          propChanges: [{
            name: 'onSave',
            kind: 'ref-changed',
            prev: { type: 'function', isArray: false, isFunction: true, isNull: false },
            current: { type: 'function', isArray: false, isFunction: true, isNull: false },
          }],
          hasPropChanges: true,
          trasherCounts: { effects: 0, callbacks: 1, memos: 0 },
        }],
      },
      metricsByCommit: { '0': { atlEvents: 2 } },
    })),
    debugHook: vi.fn(() => ({ hookIndex: 3, primitive: 'State' })),
    ...overrides,
  };
}

// ─── tupleToStats ─────────────────────────────────────────────────────────

describe('tupleToStats', () => {
  it('maps 10-tuple to named stats including unmount metrics', () => {
    expect(tupleToStats([10, 1, 0, 5, 2, 0, 1, 3, 4, 2])).toEqual({
      collateral: 10,
      sources: 1,
      restarts: 0,
      performedWork: 5,
      effects: 2,
      memos: 0,
      callbacks: 1,
      contextUpdates: 3,
      unmountedComponents: 4,
      unmountedSubtrees: 2,
    });
  });
  it('coerces missing slots to 0', () => {
    expect(tupleToStats([1, 2])).toMatchObject({ collateral: 1, sources: 2, restarts: 0 });
  });
  it('returns null for non-array', () => {
    expect(tupleToStats(null)).toBeNull();
    expect(tupleToStats({})).toBeNull();
  });
  it('exposes the upstream key list including unmount metrics', () => {
    expect(UPSTREAM_COMMIT_STAT_KEYS).toContain('collateral');
    expect(UPSTREAM_COMMIT_STAT_KEYS).toContain('contextUpdates');
    expect(UPSTREAM_COMMIT_STAT_KEYS).toContain('unmountedComponents');
    expect(UPSTREAM_COMMIT_STAT_KEYS).toContain('unmountedSubtrees');
    expect(UPSTREAM_COMMIT_STAT_KEYS.length).toBe(10);
  });
});

// ─── getReport ────────────────────────────────────────────────────────────

describe('getReport', () => {
  it('returns null when api is missing', () => {
    expect(getReport(null)).toBeNull();
    expect(getReport(undefined)).toBeNull();
  });
  it('returns null when api.report is not a function', () => {
    expect(getReport({} as AvalancheApi)).toBeNull();
  });
  it('uses toSerializable when present', () => {
    const api = makeApi({ report: () => ({ toSerializable: () => ({ x: 1 }) }) });
    const r = getReport(api);
    expect(r).not.toBeNull();
    if (!r || 'error' in r) throw new Error('expected a serialized report');
    expect(r.serial).toEqual({ x: 1 });
  });
  it('returns raw report when toSerializable absent', () => {
    const api = makeApi({ report: () => ({ x: 2 }) });
    const r = getReport(api);
    if (!r || 'error' in r) throw new Error('expected a serialized report');
    expect(r.serial).toEqual({ x: 2 });
  });
  it('captures errors from api.report', () => {
    const api = makeApi({ report: () => { throw new Error('boom'); } });
    expect(getReport(api)).toEqual({ error: 'boom' });
  });
});

// ─── readAvalancheStatus ──────────────────────────────────────────────────

describe('readAvalancheStatus', () => {
  it('returns ok+status from api.status()', () => {
    const r = readAvalancheStatus(makeApi(), null);
    expect(r).toEqual({ ok: true, available: true, status: okStatus });
  });
  it('returns ok=false when api missing, lists module keys', () => {
    const r = readAvalancheStatus(null, { foo: 1, bar: 2 });
    expect(r.ok).toBe(false);
    expect((r as { available: boolean }).available).toBe(true);
    expect((r as { moduleKeys: string[] }).moduleKeys).toEqual(['foo', 'bar']);
  });
  it('returns moduleKeys=null when no module', () => {
    const r = readAvalancheStatus(null, null);
    expect((r as { moduleKeys: null }).moduleKeys).toBeNull();
  });
  it('captures errors from api.status', () => {
    const api = makeApi({ status: () => { throw new Error('s-fail'); } });
    const r = readAvalancheStatus(api, null);
    expect(r).toMatchObject({ ok: false, available: true, error: 's-fail' });
  });
});

// ─── evalAvalanche ────────────────────────────────────────────────────────

describe('evalAvalanche', () => {
  it('returns api-not-available when api missing', () => {
    const r = evalAvalanche({ action: 'install' }, null, null);
    expect(r).toEqual({
      ok: false, available: false, action: 'install', error: '__AVALANCHE__ not available',
    });
  });

  it('defaults action to "status" when missing', () => {
    const r = evalAvalanche({}, makeApi(), null);
    expect(r.action).toBe('status');
    expect(r.ok).toBe(true);
    expect(r.status).toEqual(okStatus);
  });

  it('install: forwards options, returns status snapshot', () => {
    const api = makeApi();
    const r = evalAvalanche({ action: 'install', options: { detectionLevel: 'devtools' } }, api, null);
    expect((api.install as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ detectionLevel: 'devtools' });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('install');
    expect(r.status).toEqual(okStatus);
  });

  it('uninstall: invokes api.uninstall and returns status', () => {
    const api = makeApi();
    const r = evalAvalanche({ action: 'uninstall' }, api, null);
    expect((api.uninstall as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, available: true, action: 'uninstall', status: okStatus });
  });

  it('reset and clear both call api.reset', () => {
    const apiA = makeApi();
    evalAvalanche({ action: 'reset' }, apiA, null);
    expect((apiA.reset as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    const apiB = makeApi();
    const r = evalAvalanche({ action: 'clear' }, apiB, null);
    expect((apiB.reset as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(r.action).toBe('clear');
  });

  it('export: returns serial payload', () => {
    const r = evalAvalanche({ action: 'export' }, makeApi(), null);
    expect(r.ok).toBe(true);
    expect(r.action).toBe('export');
    expect(r.payload).toBeDefined();
    expect((r.payload as { sources: unknown[] }).sources).toBeInstanceOf(Array);
  });

  it('export: error path when report unavailable', () => {
    const r = evalAvalanche({ action: 'export' }, { status: () => okStatus } as AvalancheApi, null);
    expect(r).toMatchObject({ ok: false, action: 'export', error: 'report() unavailable' });
  });

  it('export-last: floors count, defaults to 1', () => {
    const api = makeApi();
    evalAvalanche({ action: 'export-last', count: 3.7 }, api, null);
    expect((api.exportLast as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(3);

    const api2 = makeApi();
    const r = evalAvalanche({ action: 'export-last' }, api2, null);
    expect((api2.exportLast as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(1);
    expect(r.count).toBe(1);
  });

  it('export-last: unwraps toSerializable on result', () => {
    const api = makeApi({ exportLast: () => ({ toSerializable: () => ({ slim: true }) }) });
    const r = evalAvalanche({ action: 'export-last', count: 2 }, api, null);
    expect(r.payload).toEqual({ slim: true });
  });

  it('debug-hook: requires sourceId and numeric hookIndex', () => {
    const r1 = evalAvalanche({ action: 'debug-hook' }, makeApi(), null);
    expect(r1).toMatchObject({ ok: false, error: expect.stringMatching(/sourceId/) });
    const r2 = evalAvalanche({ action: 'debug-hook', sourceId: 'x' }, makeApi(), null);
    expect(r2.ok).toBe(false);
  });

  it('debug-hook: errors when api lacks debugHook', () => {
    const api = { status: () => okStatus } as AvalancheApi;
    const r = evalAvalanche({ action: 'debug-hook', sourceId: 'x', hookIndex: 1 }, api, null);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/debugHook/) });
  });

  it('debug-hook: forwards floored hookIndex and clamped window', () => {
    const api = makeApi();
    evalAvalanche({ action: 'debug-hook', sourceId: 'x', hookIndex: 4.7, window: -2 }, api, null);
    expect((api.debugHook as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('x', 4, 0);
  });

  it('hot-sources: sorts by collateralUpdates desc and limits', () => {
    const r = evalAvalanche({ action: 'hot-sources', limit: 2 }, makeApi(), null);
    const items = (r.payload as { items: Array<{ sourceId: string }> }).items;
    expect(items.length).toBe(2);
    expect(items[0].sourceId).toBe('b'); // 12 collateral
    expect(items[1].sourceId).toBe('a'); // 5 collateral
    expect(r.total).toBe(3);
  });

  it('commit-peek: requires numeric commitId', () => {
    const r = evalAvalanche({ action: 'commit-peek' }, makeApi(), null);
    expect(r.ok).toBe(false);
  });

  it('commit-peek: rejects unknown include keys', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0, include: ['stats', 'bogus'] }, makeApi(), null);
    expect(r).toMatchObject({ ok: false, validInclude: ['stats', 'sources', 'timing', 'metrics', 'atl', 'unmounts', 'actions', 'rendered'] });
  });

  it('commit-peek: returns full payload for known commit', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0 }, makeApi(), null);
    expect(r.ok).toBe(true);
    const out = r.payload as Record<string, unknown>;
    expect(out.commitId).toBe(0);
    expect(out.found).toBe(true);
    expect(out.stats).toMatchObject({ collateral: 10 });
    expect((out.sources as unknown[]).length).toBe(2);
    expect(out.timing).toEqual({ duration: 12.5 });
    expect(out.metrics).toEqual({ atlEvents: 2 });
    expect(out.atl).toBeUndefined();
    expect(out.actions).toBeUndefined();
  });

  it('commit-peek: accepts the deprecated atl include token as an alias of metrics', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0, include: ['atl'] }, makeApi(), null);
    const out = r.payload as Record<string, unknown>;
    expect(out.atl).toEqual({ atlEvents: 2 });
    expect(out.metrics).toBeUndefined();
  });

  it('commit-peek: reads atlByCommit from bundles that predate metricsByCommit', () => {
    const { metricsByCommit, ...rest } = makeApi().report() as Record<string, unknown>;
    const api = makeApi({ report: () => ({ ...rest, atlByCommit: metricsByCommit }) as any });
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0, include: ['metrics'] }, api, null);
    expect((r.payload as Record<string, unknown>).metrics).toEqual({ atlEvents: 2 });
  });

  it('commit-peek: returns rendered component evidence only when requested', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0, include: ['rendered'] }, makeApi(), null);
    expect(r.ok).toBe(true);
    const out = r.payload as Record<string, unknown>;
    expect(out.renderedTotal).toBe(1);
    expect(out.rendered).toEqual([{
      sourceId: 'child',
      name: 'Child',
      depth: 2,
      parentSourceId: 'parent',
      ownerSourceId: 'parent',
      isSelfSource: false,
      propChanges: [{
        name: 'onSave',
        kind: 'ref-changed',
        prev: { type: 'function', isArray: false, isFunction: true, isNull: false },
        current: { type: 'function', isArray: false, isFunction: true, isNull: false },
      }],
      hasPropChanges: true,
      trasherCounts: { effects: 0, callbacks: 1, memos: 0 },
    }]);
  });

  it('commit-peek: returns compact actions only when requested', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 0, include: ['actions'] }, makeApi(), null);
    expect(r.ok).toBe(true);
    const out = r.payload as Record<string, unknown>;
    expect(out.actionsTotal).toBe(1);
    expect(out.actions).toEqual([
      {
        id: 0,
        lastCommitId: 0,
        deltaTime: 5,
        action: 'click',
        location: {
          dom: { tag: 'button', text: 'Save', nearestTestId: 'save' },
          targetFiber: {
            name: 'Button',
            key: null,
            source: { fileName: 'Button.jsx', lineNumber: 3, columnNumber: null },
            ownerStackKind: 'owners',
            ownerStack: [{
              name: 'Toolbar',
              key: null,
              props: ['onSave'],
              hookCount: 2,
              hookCountTruncated: false,
              hookCountMax: 500,
              source: { fileName: 'Toolbar.jsx', lineNumber: 1, columnNumber: null },
            }],
          },
        },
      },
    ]);
  });

  it('commit-peek: returns unmount samples from raw report only when requested', () => {
    const rawReport = {
      commitStats: { '7': [0, 0, 0, 0, 0, 0, 0, 0, 6, 2] },
      sources: [],
      sourcesByCommit: {},
      commitTimings: {},
      metricsByCommit: {},
      unmountsByCommit: {
        '7': [
          { name: 'OldBranch', key: 'old', depth: 4, count: 6, source: { fileName: 'OldBranch.jsx', lineNumber: 12 } },
          { name: 'OldLeaf', key: null, depth: 5, count: 1, source: null },
        ],
      },
      toSerializable: () => ({
        commitStats: { '7': [0, 0, 0, 0, 0, 0, 0, 0, 6, 2] },
        sources: [],
        sourcesByCommit: {},
        commitTimings: {},
        metricsByCommit: {},
      }),
    };
    const api = makeApi({ report: () => rawReport as any });

    const withoutInclude = evalAvalanche({ action: 'commit-peek', commitId: 7 }, api, null);
    expect((withoutInclude.payload as Record<string, unknown>).unmounts).toBeUndefined();

    const withInclude = evalAvalanche({ action: 'commit-peek', commitId: 7, include: ['stats', 'unmounts'], maxItems: 1 }, api, null);
    expect(withInclude.ok).toBe(true);
    const out = withInclude.payload as Record<string, unknown>;
    expect(out.stats).toMatchObject({ unmountedComponents: 6, unmountedSubtrees: 2 });
    expect(out.unmountsTotal).toBe(2);
    expect(out.unmounts).toEqual([
      { name: 'OldBranch', key: 'old', depth: 4, count: 6, source: { fileName: 'OldBranch.jsx', lineNumber: 12 } },
    ]);
  });

  it('commit-peek: found=false when commit missing', () => {
    const r = evalAvalanche({ action: 'commit-peek', commitId: 99 }, makeApi(), null);
    expect(r).toMatchObject({ ok: true, commitId: 99, found: false });
  });

  it('commit-list: rejects unknown sort key', () => {
    const r = evalAvalanche({ action: 'commit-list', by: 'bogus' }, makeApi(), null);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sort key/) });
    expect(r.validBy).toContain('collateral');
    expect(r.validBy).toContain('sources');
  });

  it('commit-list: sorts by collateral desc by default', () => {
    const r = evalAvalanche({ action: 'commit-list' }, makeApi(), null);
    expect(r.ok).toBe(true);
    const rows = r.rows as Array<{ commitId: number; stat: { collateral: number }; latestAction: any }>;
    expect(rows[0].commitId).toBe(0); // collateral 10
    expect(rows[0].latestAction).toMatchObject({
      action: 'click',
      dom: { tag: 'button', text: 'Save', nearestTestId: 'save' },
      targetFiber: {
        name: 'Button',
        ownerStackKind: 'owners',
        ownerNames: ['Toolbar'],
        ownerCount: 1,
      },
    });
    expect(rows[1].commitId).toBe(1); // collateral 4
  });

  it('describe-action: returns full stored action by id', () => {
    const r = evalAvalanche({ action: 'describe-action', actionId: 0 }, makeApi(), null) as any;
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({
      actionId: 0,
      commitId: 0,
      found: true,
      action: {
        id: 0,
        lastCommitId: 0,
        deltaTime: 5,
        action: 'click',
        location: {
          dom: { tag: 'button', text: 'Save', nearestTestId: 'save' },
          targetFiber: {
            name: 'Button',
            key: null,
            source: { fileName: 'Button.jsx', lineNumber: 3, columnNumber: null },
            ownerStackKind: 'owners',
            ownerStack: [{
              name: 'Toolbar',
              key: null,
              props: ['onSave'],
              hookCount: 2,
              hookCountTruncated: false,
              hookCountMax: 500,
              source: { fileName: 'Toolbar.jsx', lineNumber: 1, columnNumber: null },
            }],
          },
        },
      },
    });
  });

  it('commit-list: sorts by source count when by=sources', () => {
    const r = evalAvalanche({ action: 'commit-list', by: 'sources' }, makeApi(), null);
    const rows = r.rows as Array<{ commitId: number; sourceCount: number }>;
    expect(rows[0].sourceCount).toBe(2); // commit 0 has 2 sources
  });

  it('commit-list: reports ticks per commit and sorts by them, unknown counts last', () => {
    const report = makeApi().report() as any;
    report.commitTimings = { '0': { ticks: 1 }, '1': { ticks: 7 } };
    const api = makeApi({ report: () => report });
    const rows = evalAvalanche({ action: 'commit-list', by: 'ticks' }, api, null).rows as Array<{ commitId: number; ticks: number | null }>;
    expect(rows.map((row) => [row.commitId, row.ticks])).toEqual([[1, 7], [0, 1]]);
    report.commitTimings = { '1': { ticks: null } };
    const unknown = evalAvalanche({ action: 'commit-list', by: 'ticks' }, api, null).rows as Array<{ commitId: number; ticks: number | null }>;
    expect(unknown.map((row) => row.ticks)).toEqual([null, null]);
  });

  it('unknown action returns explicit error', () => {
    const r = evalAvalanche({ action: 'fly-to-the-moon' }, makeApi(), null);
    expect(r).toMatchObject({ ok: false, available: true, action: 'fly-to-the-moon', error: expect.stringMatching(/Unknown/) });
  });

  it('catches thrown errors from api methods', () => {
    const api = makeApi({ install: () => { throw new Error('fail'); } });
    const r = evalAvalanche({ action: 'install' }, api, null);
    expect(r).toMatchObject({ ok: false, available: true, action: 'install', error: 'fail' });
  });
});
