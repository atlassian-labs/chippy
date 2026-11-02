import { describe, expect, it } from 'vitest';
import { getCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { getContextProviders } from '../layout-lab/marker-context';
import { registerBuiltinPlugins } from './index';

describe('registerBuiltinPlugins', () => {
  it('registers the Jira context provider and the ATL metrics adapter, and unregisters both', () => {
    const unregister = registerBuiltinPlugins();
    expect(getContextProviders().map((p) => p.id)).toContain('jira');
    expect(getCommitMetricsAdapter()?.id).toBe('atl');
    unregister();
    expect(getContextProviders().map((p) => p.id)).not.toContain('jira');
    expect(getCommitMetricsAdapter()).toBeNull();
  });
});
