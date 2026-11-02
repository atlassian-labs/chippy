import { describe, expect, it } from 'vitest';
import { atlCommitMetricsAdapter } from '../plugins/atl/commit-metrics-adapter';
import { createAvalancheDetector } from '../avalanche/detector';

describe('createAvalancheDetector.debugHook replay contracts', () => {
  it('preserves supported hook return contracts for callback, sync-external-store, and id', () => {
    const detector = createAvalancheDetector({ metricsAdapter: atlCommitMetricsAdapter });
    const detectorAny = detector as any;

    const callbackFn = () => 'ok';

    detectorAny._debugSetSourceForTest('source-callback', {
      type: { name: 'HookContractsLab' },
      debugHookIndices: [0],
    });
    detectorAny._debugInjectHookEventsForTest('HookContractsLab', [
      {
        primitive: 'callback',
        frames: [
          { name: 'atlDispatcherHook', loc: '1:1' },
          { name: 'useStableAction', loc: '10:2' },
        ],
        stack: 'stack-callback',
        componentName: 'HookContractsLab',
        args: [],
        value: callbackFn,
      },
    ]);

    const callbackResult = detectorAny.debugHook('source-callback', 0, 1);
    expect(callbackResult.ok).toBe(true);
    expect(callbackResult.primitive).toBe('callback');

    detectorAny._debugSetSourceForTest('source-store', {
      type: { name: 'HookContractsStoreLab' },
      debugHookIndices: [0],
    });
    detectorAny._debugInjectHookEventsForTest('HookContractsStoreLab', [
      {
        primitive: 'syncExternalStore',
        frames: [
          { name: 'atlDispatcherHook', loc: '1:1' },
          { name: 'useStoreState', loc: '20:2' },
        ],
        stack: 'stack-store',
        componentName: 'HookContractsStoreLab',
        args: [],
        value: 'snapshot-value',
      },
    ]);

    const storeResult = detectorAny.debugHook('source-store', 0, 1);
    expect(storeResult.ok).toBe(true);
    expect(storeResult.primitive).toBe('syncExternalStore');

    detectorAny._debugSetSourceForTest('source-id', {
      type: { name: 'HookContractsIdLab' },
      debugHookIndices: [0],
    });
    detectorAny._debugInjectHookEventsForTest('HookContractsIdLab', [
      {
        primitive: 'id',
        frames: [
          { name: 'atlDispatcherHook', loc: '1:1' },
          { name: 'useStableId', loc: '30:2' },
        ],
        stack: 'stack-id',
        componentName: 'HookContractsIdLab',
        args: [],
        value: 'generated-id',
      },
    ]);

    const idResult = detectorAny.debugHook('source-id', 0, 1);
    expect(idResult.ok).toBe(true);
    expect(idResult.primitive).toBe('id');
    expect(idResult.parents).toEqual([{ name: 'useStableId', loc: '30:2' }]);
  });
});
