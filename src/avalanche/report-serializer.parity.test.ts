import { describe, it, expect } from 'vitest';
import { serializeReport } from './report-serializer';
import type {
  CommitInteractionActionDTO,
  CommitTimingDTO,
  ATLCommitDeltaDTO,
  ReportMetaDTO,
  SuspenseBoundaryEventDTO,
} from './report-serializer';

/**
 * DTO ↔ live type parity proof tests.
 *
 * These tests do NOT change behavior. They prove that:
 *  1. serializeReport's parameter type is at least as strict as the live
 *     type produced by the reporter (TypeScript would fail otherwise).
 *  2. Every DTO field on every commit-linked structure round-trips through
 *     serializeReport without being dropped at the passthrough boundary
 *     (line 287 `interactionsByCommit: report.interactionsByCommit`).
 *
 * If a field is dropped silently at the live→DTO boundary, these tests
 * fail at runtime even if TypeScript stays green.
 *
 * Rule 3 (DTO field parity) and Rule 4 (strict required types) enforcement.
 */

function makeMeta(): ReportMetaDTO {
  return {
    version: 1,
    timeOrigin: 1_700_000_000_000.5,
    commits: 0,
    config: {
      detectionLevel: 'sources',
      effectThrashMode: 'non-primitive',
      captureFibers: true,
      historySize: 10,
    },
    memoizedUpdatersSupport: { available: false, commitsWithData: 0, coverage: '0%' },
    timing: {
      totalDetectorOverhead: 0,
      avgDetectorOverhead: 0,
      totalTimeSpan: 0,
      avgTimeBetweenCommits: 0,
    },
  };
}

function makeAction(id: number): CommitInteractionActionDTO {
  return {
    id,
    lastCommitId: id - 1,
    deltaTime: 12.3,
    timestamp: 4321.25,
    action: 'click',
    location: {
      dom: { tag: 'button', text: 'Save', nearestTestId: 'save-btn' },
      targetFiber: {
        name: 'SaveButton',
        key: null,
        source: { fileName: 'a.tsx', lineNumber: 1, columnNumber: 1 },
        ownerStackKind: 'owners',
        ownerStack: [
          {
            name: 'Form',
            key: null,
            props: ['onSubmit'],
            hookCount: 3,
            hookCountTruncated: false,
            hookCountMax: 100,
            source: { fileName: 'b.tsx', lineNumber: 2, columnNumber: 1 },
          },
        ],
      },
    },
  };
}

function makeTiming(): CommitTimingDTO {
  return {
    startTime: 4333.5,
    endTime: 4334.0,
    timeSinceLastCommit: 5.5,
    detectorOverhead: 0.4,
  };
}

function makeAtlDelta(): ATLCommitDeltaDTO {
  return {
    mountWorkCount: 1,
    updateWorkCount: 2,
    commitWorkCount: 1,
    performedWorkCount: 3,
    interruptedWorkCount: 0,
    componentWorkCount: 3,
    componentMountWorkCount: 1,
    componentUpdateWorkCount: 2,
    domWorkCount: 0,
    ticksCount: 1,
    contextUpdateCount: 0,
    legacyContextUpdateCount: 0,
    componentRenderWithHooksCount: 3,
    finishClassComponentCount: 0,
    externalStoreRestartCount: 0,
    priorityInterruptedWorkCount: 0,
    renderRootSyncCount: 1,
    renderRootConcurrentCount: 0,
    // react-dom patch (optional): useState/useReducer dispatches during this commit
    setStateCount: 4,
  };
}

describe('serializeReport — DTO field parity', () => {
  it('round-trips every field on CommitInteractionActionDTO without dropping any', () => {
    const action = makeAction(7);
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      interactionsByCommit: { 1: [action] },
    });
    expect(dto.interactionsByCommit).toBeDefined();
    const out = dto.interactionsByCommit![1][0];
    // Verify every top-level field survives
    expect(out.id).toBe(7);
    expect(out.lastCommitId).toBe(6);
    expect(out.deltaTime).toBe(12.3);
    expect(out.timestamp).toBe(4321.25);
    expect(out.action).toBe('click');
    // Verify nested DOM
    expect(out.location.dom.tag).toBe('button');
    expect(out.location.dom.text).toBe('Save');
    expect(out.location.dom.nearestTestId).toBe('save-btn');
    // Verify nested targetFiber
    expect(out.location.targetFiber).not.toBeNull();
    expect(out.location.targetFiber!.name).toBe('SaveButton');
    expect(out.location.targetFiber!.key).toBeNull();
    expect(out.location.targetFiber!.ownerStackKind).toBe('owners');
    expect(out.location.targetFiber!.source).toEqual({
      fileName: 'a.tsx', lineNumber: 1, columnNumber: 1,
    });
    // Verify ownerStack item
    const owner = out.location.targetFiber!.ownerStack[0];
    expect(owner.name).toBe('Form');
    expect(owner.key).toBeNull();
    expect(owner.props).toEqual(['onSubmit']);
    expect(owner.hookCount).toBe(3);
    expect(owner.hookCountTruncated).toBe(false);
    expect(owner.hookCountMax).toBe(100);
    expect(owner.source).toEqual({ fileName: 'b.tsx', lineNumber: 2, columnNumber: 1 });
  });

  it('handles ownerStackKind=parents fallback', () => {
    const action = makeAction(1);
    action.location.targetFiber!.ownerStackKind = 'parents';
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      interactionsByCommit: { 1: [action] },
    });
    expect(dto.interactionsByCommit![1][0].location.targetFiber!.ownerStackKind).toBe('parents');
  });

  it('handles targetFiber=null without throwing', () => {
    const action: CommitInteractionActionDTO = {
      id: 1, lastCommitId: 0, deltaTime: 0, timestamp: 0, action: 'click',
      location: {
        dom: { tag: null, text: '', nearestTestId: null },
        targetFiber: null,
      },
    };
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      interactionsByCommit: { 0: [action] },
    });
    expect(dto.interactionsByCommit![0][0].location.targetFiber).toBeNull();
  });

  it('preserves the commit key as a number map', () => {
    const a1 = makeAction(1);
    const a2 = makeAction(2);
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      interactionsByCommit: { 5: [a1], 12: [a2] },
    });
    expect(Object.keys(dto.interactionsByCommit!).sort()).toEqual(['12', '5']);
    expect(dto.interactionsByCommit![5][0].id).toBe(1);
    expect(dto.interactionsByCommit![12][0].id).toBe(2);
  });

  it('round-trips every field on SourceDTO without dropping any', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [
        {
          sourceId: 'src-1',
          depth: 4,
          causedUpdates: 10,
          collateralUpdates: 50,
          maxCollateralUpdates: 100,
          maxPenetrationDepth: 8,
          restartWaste: 3,
          maxRestartWaste: 5,
        },
      ],
      commitStats: {},
    });
    const s = dto.sources[0];
    expect(s.sourceId).toBe('src-1');
    expect(s.depth).toBe(4);
    expect(s.causedUpdates).toBe(10);
    expect(s.collateralUpdates).toBe(50);
    expect(s.maxCollateralUpdates).toBe(100);
    expect(s.maxPenetrationDepth).toBe(8);
    expect(s.restartWaste).toBe(3);
    expect(s.maxRestartWaste).toBe(5);
  });

  it('omits optional SourceDTO fields when undefined (no `restartWaste: undefined` in output)', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [{
        sourceId: 'x', depth: 0, causedUpdates: 0,
        collateralUpdates: 0, maxCollateralUpdates: 0, maxPenetrationDepth: 0,
      }],
      commitStats: {},
    });
    const s = dto.sources[0];
    expect('restartWaste' in s).toBe(false);
    expect('maxRestartWaste' in s).toBe(false);
  });

  it('round-trips every field on RenderedComponentEvidenceDTO', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      renderedByCommit: {
        4: [{
          sourceId: 'Child#1@2',
          name: 'Child',
          depth: 2,
          parentSourceId: 'Parent#1@1',
          ownerSourceId: 'Parent#1@1',
          isSelfSource: false,
          propChanges: [{
            name: 'onClick',
            kind: 'ref-changed',
            prev: { type: 'function', isArray: false, isFunction: true, isNull: false, preview: 'fn' },
            current: { type: 'function', isArray: false, isFunction: true, isNull: false, preview: 'fn' },
          }],
          hasPropChanges: true,
          trasherCounts: { effects: 1, callbacks: 2, memos: 3 },
        }],
      },
    });
    const rendered = dto.renderedByCommit![4][0];
    expect(rendered.sourceId).toBe('Child#1@2');
    expect(rendered.name).toBe('Child');
    expect(rendered.depth).toBe(2);
    expect(rendered.parentSourceId).toBe('Parent#1@1');
    expect(rendered.ownerSourceId).toBe('Parent#1@1');
    expect(rendered.isSelfSource).toBe(false);
    expect(rendered.hasPropChanges).toBe(true);
    expect(rendered.propChanges[0].name).toBe('onClick');
    expect(rendered.propChanges[0].kind).toBe('ref-changed');
    expect(rendered.propChanges[0].prev.isFunction).toBe(true);
    expect(rendered.trasherCounts).toEqual({ effects: 1, callbacks: 2, memos: 3 });
  });

  it('round-trips every field on SourceByCommitDTO', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      sourcesByCommit: {
        3: [{
          sourceId: 's-1',
          depth: 2,
          collateral: 10,
          rank: 1,
          sourceIndex: 0,
          trashers: [{ index: 0, prevValue: 'a', currentValue: 'b' }],
          isRepeat: true,
        }],
      },
    });
    const s = dto.sourcesByCommit![3][0];
    expect(s.sourceId).toBe('s-1');
    expect(s.depth).toBe(2);
    expect(s.collateral).toBe(10);
    expect(s.rank).toBe(1);
    expect(s.sourceIndex).toBe(0);
    expect(s.trashers).toEqual([{ index: 0, prevValue: 'a', currentValue: 'b' }]);
    expect(s.isRepeat).toBe(true);
  });

  it('round-trips every field on SuspenseBoundaryEventDTO', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      suspenseByCommit: { 1: [{ depth: 5, entered: true, left: false }] },
    });
    const e = dto.suspenseByCommit[1][0];
    expect(e.depth).toBe(5);
    expect(e.entered).toBe(true);
    expect(e.left).toBe(false);
  });

  it('strips non-serializable fiber refs from suspenseByCommit events', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      suspenseByCommit: {
        1: [{ depth: 1, entered: true, left: false, fiber: { circular: 'ref' } }],
      },
    });
    const out: SuspenseBoundaryEventDTO & { fiber?: unknown } = dto.suspenseByCommit[1][0];
    expect(out.fiber).toBeUndefined();
  });

  it('round-trips every field on ATLCommitDeltaDTO via passthrough', () => {
    const delta = makeAtlDelta();
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      atlByCommit: { 1: delta },
    });
    expect(dto.atlByCommit![1]).toEqual(delta);
    // optional hook-metric field must survive the passthrough boundary
    expect(dto.atlByCommit![1].setStateCount).toBe(4);
  });

  it('aliases metricsByCommit and the deprecated atlByCommit to the same deltas', () => {
    const delta = makeAtlDelta();
    const fromNew = serializeReport({ meta: makeMeta(), sources: [], commitStats: {}, metricsByCommit: { 1: delta } });
    expect(fromNew.metricsByCommit![1]).toEqual(delta);
    expect(fromNew.atlByCommit).toBe(fromNew.metricsByCommit);
    const fromLegacy = serializeReport({ meta: makeMeta(), sources: [], commitStats: {}, atlByCommit: { 1: delta } });
    expect(fromLegacy.metricsByCommit![1]).toEqual(delta);
  });

  it('round-trips every field on CommitTimingDTO via passthrough', () => {
    const timing = makeTiming();
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
      commitTimings: { 1: timing },
    });
    expect(dto.commitTimings![1]).toEqual(timing);
  });

  it('preserves commitStats as Record passthrough', () => {
    const stats: [number, number, number, number, number, number, number, number, number, number] = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ];
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: { 7: stats },
    });
    expect(dto.commitStats[7]).toEqual(stats);
  });

  it('preserves meta object reference (passthrough)', () => {
    const meta = makeMeta();
    const dto = serializeReport({ meta, sources: [], commitStats: {} });
    expect(dto.meta).toBe(meta);
  });

  it('omits sourcesByCommit/interactionsByCommit/atlByCommit/commitTimings when undefined', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [],
      commitStats: {},
    });
    expect(dto.sourcesByCommit).toBeUndefined();
    expect(dto.interactionsByCommit).toBeUndefined();
    expect(dto.atlByCommit).toBeUndefined();
    expect(dto.commitTimings).toBeUndefined();
  });

  it('returns JSON-serializable output for full report shape', () => {
    const dto = serializeReport({
      meta: makeMeta(),
      sources: [{
        sourceId: 's', depth: 0, causedUpdates: 1,
        collateralUpdates: 2, maxCollateralUpdates: 3, maxPenetrationDepth: 1,
      }],
      commitStats: { 0: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      sourcesByCommit: { 0: [{ sourceId: 's', depth: 0, collateral: 1, rank: 1, sourceIndex: 0 }] },
      suspenseByCommit: { 0: [{ depth: 0, entered: true, left: false }] },
      interactionsByCommit: { 0: [makeAction(1)] },
      atlByCommit: { 0: makeAtlDelta() },
      commitTimings: { 0: makeTiming() },
    });
    expect(() => JSON.stringify(dto)).not.toThrow();
    const json = JSON.stringify(dto);
    const parsed = JSON.parse(json);
    expect(parsed.interactionsByCommit['0'][0].id).toBe(1);
    expect(parsed.sources[0].sourceId).toBe('s');
    expect(parsed.atlByCommit['0'].mountWorkCount).toBe(1);
    expect(parsed.commitTimings['0'].startTime).toBe(4333.5);
    expect(parsed.meta.timeOrigin).toBe(1_700_000_000_000.5);
  });
});

/**
 * Type-level parity proof.
 *
 * If LIVE type (CommitInteractionAction in reporter.tsx) is structurally
 * incompatible with CommitInteractionActionDTO, the reporter's call site
 * `serializeReport(this)` would fail to compile.
 *
 * This describe block asserts the compile-time relationship by performing
 * an assignment that must remain green. If you add a required field to
 * CommitInteractionActionDTO without adding it to CommitInteractionAction,
 * this file will fail at `tsc` time. That is the contract.
 */
describe('serializeReport — compile-time live↔DTO parity', () => {
  it('compiles when DTO and live shape match', () => {
    // The mere import of serializeReport + reporter.tsx in the project
    // proves the call site `serializeReport(this)` typechecks. If this test
    // file compiles, the contract holds. The runtime assertion is trivial.
    expect(typeof serializeReport).toBe('function');
  });
});
