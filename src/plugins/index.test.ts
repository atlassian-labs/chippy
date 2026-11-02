import { afterEach, describe, expect, it } from 'vitest';
import { getCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { getContextProviders } from '../layout-lab/marker-context';
import { disableBuiltinPlugins, enableBuiltinPlugins } from './index';

afterEach(disableBuiltinPlugins);

describe('enableBuiltinPlugins', () => {
  it('enables nothing by default', () => {
    expect(enableBuiltinPlugins(undefined)).toEqual([]);
    expect(getContextProviders().map((p) => p.id)).not.toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
  });

  it('enables the named plugins and ignores unknown ids', () => {
    expect(enableBuiltinPlugins(['jira', 'unknown', 'toString', 1])).toEqual(['jira']);
    expect(getContextProviders().map((p) => p.id)).toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
    expect(enableBuiltinPlugins(['atl', 'jira'])).toEqual(['jira', 'atl']);
    expect(getCommitMetricsAdapter()?.id).toBe('atl');
  });

  it('disables every enabled plugin', () => {
    enableBuiltinPlugins(['jira', 'atl']);
    disableBuiltinPlugins();
    expect(getContextProviders().map((p) => p.id)).not.toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
  });
});
