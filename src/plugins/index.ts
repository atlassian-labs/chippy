/**
 * Built-in plugins shipped with the Chippy bundle. The core runtime has no
 * product knowledge; the composition root (src/iife.ts) registers these so
 * the shipped extension keeps recognizing Jira ownership markers and ATL
 * commit metrics.
 */

import { registerCommitMetricsAdapter } from '../avalanche/commit-metrics-adapter';
import { registerContextProvider } from '../layout-lab/marker-context';
import { atlCommitMetricsAdapter } from './atl/commit-metrics-adapter';
import { jiraContextProvider } from './jira/context-provider';

export function registerBuiltinPlugins(): () => void {
  const unregister = [
    registerContextProvider(jiraContextProvider),
    registerCommitMetricsAdapter(atlCommitMetricsAdapter),
  ];
  return () => {
    for (const fn of unregister.reverse()) fn();
  };
}
