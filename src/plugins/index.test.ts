import { afterEach, describe, expect, it } from 'vitest';
import { getCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { getContextProviders, type ContextProvider } from '../layout-lab/marker-context';
import {
  enableDefaultPlugins,
  enablePlugins,
  listPlugins,
  registerPlugin,
  resetPlugins,
  selectPlugins,
} from './index';
import { createSlotCommitMetricsAdapter } from '../avalanche/test-support/slot-commit-metrics-adapter';

afterEach(resetPlugins);

const providerIds = () => getContextProviders().map((p) => p.id);
const gate: ContextProvider = { id: 'gate', describe: () => null };
const registerExamplePlugins = () => {
  registerPlugin({ id: 'gate', label: 'Feature gates', contextProvider: gate });
  registerPlugin({ id: 'host', label: 'Host metrics', commitMetricsAdapter: createSlotCommitMetricsAdapter() });
};

describe('plugin registry', () => {
  it('ships no plugins and enables nothing by default', () => {
    expect(listPlugins()).toEqual([]);
    registerExamplePlugins();
    expect(enablePlugins(undefined)).toEqual([]);
    expect(providerIds()).not.toContain('gate');
    expect(getCommitMetricsAdapter()).toBeNull();
    expect(listPlugins()).toEqual([
      { id: 'gate', label: 'Feature gates', enabled: false },
      { id: 'host', label: 'Host metrics', enabled: false },
    ]);
  });

  it('enables the named plugins and ignores non-string ids', () => {
    registerExamplePlugins();
    expect(enablePlugins(['gate', 'unknown', 1])).toEqual(['gate']);
    expect(providerIds()).toContain('gate');
    expect(getCommitMetricsAdapter()).toBeNull();
    expect(enablePlugins(['host', 'gate'])).toEqual(['gate', 'host']);
    expect(getCommitMetricsAdapter()?.id).toBe('test-host');
  });

  it('starts a plugin that registers after its id was enabled', () => {
    enablePlugins(['gate']);
    expect(providerIds()).not.toContain('gate');
    const unregister = registerPlugin({ id: 'gate', contextProvider: gate });
    expect(providerIds()).toContain('gate');
    unregister();
    expect(providerIds()).not.toContain('gate');
    expect(listPlugins()).toEqual([]);
  });

  it('replaces a plugin registered again under the same id', () => {
    enablePlugins(['gate']);
    const first = registerPlugin({ id: 'gate', contextProvider: gate });
    registerPlugin({ id: 'gate', label: 'Gate v2', contextProvider: { ...gate, id: 'gate-v2' } });
    expect(providerIds()).toEqual(expect.arrayContaining(['gate-v2']));
    expect(providerIds()).not.toContain('gate');
    first();
    expect(providerIds()).toContain('gate-v2');
  });

  it('applies build defaults only when the page made no selection', () => {
    registerExamplePlugins();
    expect(enableDefaultPlugins(['gate'])).toEqual(['gate']);
    resetPlugins();
    registerExamplePlugins();
    selectPlugins([]);
    expect(enableDefaultPlugins(['gate'])).toEqual([]);
    expect(providerIds()).not.toContain('gate');
  });

  it('rejects a plugin without an id', () => {
    expect(() => registerPlugin({ id: '' })).toThrow(TypeError);
  });
});
