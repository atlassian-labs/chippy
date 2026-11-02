import { afterEach, describe, expect, it } from 'vitest';
import { getCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { getContextProviders, type ContextProvider } from '../layout-lab/marker-context';
import {
  enableDefaultPlugins,
  enablePlugins,
  listPlugins,
  registerBuiltinPlugins,
  registerPlugin,
  resetPlugins,
  selectPlugins,
} from './index';

afterEach(resetPlugins);

const providerIds = () => getContextProviders().map((p) => p.id);
const gate: ContextProvider = { id: 'gate', describe: () => null };

describe('plugin registry', () => {
  it('enables nothing by default', () => {
    registerBuiltinPlugins();
    expect(enablePlugins(undefined)).toEqual([]);
    expect(providerIds()).not.toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
    expect(listPlugins()).toEqual([
      { id: 'jira', label: 'Jira ownership markers', enabled: false },
      { id: 'atl', label: 'ATL commit metrics', enabled: false },
    ]);
  });

  it('enables the named plugins and ignores non-string ids', () => {
    registerBuiltinPlugins();
    expect(enablePlugins(['jira', 'unknown', 1])).toEqual(['jira']);
    expect(providerIds()).toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
    expect(enablePlugins(['atl', 'jira'])).toEqual(['jira', 'atl']);
    expect(getCommitMetricsAdapter()?.id).toBe('atl');
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
    registerBuiltinPlugins();
    expect(enableDefaultPlugins(['jira'])).toEqual(['jira']);
    resetPlugins();
    registerBuiltinPlugins();
    selectPlugins([]);
    expect(enableDefaultPlugins(['jira'])).toEqual([]);
    expect(providerIds()).not.toContain('jira');
  });

  it('rejects a plugin without an id', () => {
    expect(() => registerPlugin({ id: '' })).toThrow(TypeError);
  });
});
