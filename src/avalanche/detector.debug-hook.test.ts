import { describe, expect, it } from 'vitest';
import { atlCommitMetricsAdapter } from '../plugins/atl/commit-metrics-adapter';
import { createAvalancheDetector } from './detector';

describe('createAvalancheDetector.debugHook', () => {
  it('does not treat unrelated leading events as hook index zero for a source', () => {
    const detector = createAvalancheDetector({ metricsAdapter: atlCommitMetricsAdapter });
    const detectorAny = detector as any;

    detectorAny._debugSetSourceForTest('source-a', { type: { name: 'StoreReader' }, debugHookIndices: [1] });
    detectorAny._debugInjectHookEventsForTest('StoreReader', [
      {
        primitive: 'state',
        frames: [
          { name: 'atlDispatcherHook', loc: '1:1' },
          { name: 'useOtherThing', loc: '20:2' },
        ],
        stack: 'stack-b',
        componentName: 'StoreReader',
        args: [],
      },
      {
        primitive: 'memo',
        frames: [
          { name: 'atlDispatcherHook', loc: '1:1' },
          { name: 'useApprovalFormatter', loc: '10:2' },
        ],
        stack: 'stack-a',
        componentName: 'StoreReader',
        args: [],
      },
    ]);

    const result = detectorAny.debugHook('source-a', 0, 1);
    expect(result.ok).toBe(true);
    expect(result.primitive).toBe('memo');
    expect(result.parents).toEqual([{ name: 'useApprovalFormatter', loc: '10:2' }]);
    expect(result.hookIndex).toBe(0);
  });
});
