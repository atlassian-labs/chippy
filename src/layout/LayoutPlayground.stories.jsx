import React, { useEffect } from 'react';
import { LayoutPlayground } from './LayoutPlayground';
import { defaultLayoutItems } from './defaultLayout';

// ─── ATL metrics simulation ──────────────────────────────────────────────────
// Simulates what Jira (and similar apps) do:
//   1. On mount  — reset __ATL_REACT_METRICS to a zeroed object (app blank-init).
//   2. After 1 s — reset __ATL_REACT_METRICS to undefined (hydration done, wipe).
//
// Use this to test whether the Chippy avalanche stub survives both resets.
const ATL_COUNTER_KEYS = [
  'mountWorkCount', 'updateWorkCount', 'commitWorkCount',
  'interruptedWorkCount', 'priorityInterruptedWorkCount',
  'externalStoreRestartCount',
  'renderRootSyncCount', 'renderRootConcurrentCount',
  'componentWorkCount', 'componentMountWorkCount', 'componentUpdateWorkCount',
  'componentRenderWithHooksCount', 'finishClassComponentCount',
  'domWorkCount', 'totalTickCount', 'totalCommitCount',
  'contextUpdateCount', 'legacyContextUpdateCount',
  'totalRestarts', 'totalPerformedWork',
];

function makeZeroedMetrics() {
  const obj = { onCommitFiberRoot: null };
  for (const k of ATL_COUNTER_KEYS) obj[k] = 0;
  return obj;
}

function SimulateAtlMetricsReset({ children }) {
  // Run synchronously on first render (before paint) to simulate app blank-init.
  // We use a ref so this only fires once even in StrictMode double-render.
  const didReset = React.useRef(false);
  if (!didReset.current) {
    didReset.current = true;
    console.log('[ATL-sim] mount: resetting __ATL_REACT_METRICS to zeroed object');
    window.__ATL_REACT_METRICS = makeZeroedMetrics();
    console.log('[ATL-sim] after zero-reset, value:', window.__ATL_REACT_METRICS);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      console.log('[ATL-sim] +1 s: resetting __ATL_REACT_METRICS to undefined (hydration done)');
      window.__ATL_REACT_METRICS = undefined;
      console.log('[ATL-sim] after undefined-reset, value:', window.__ATL_REACT_METRICS);
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  return children;
}

export default {
  title: 'Labs/LayoutPlayground',
  component: LayoutPlayground,
  decorators: [
    (Story) => (
      <SimulateAtlMetricsReset>
        <Story />
      </SimulateAtlMetricsReset>
    ),
  ],
};

export const Default = {
  args: {
    items: defaultLayoutItems,
    columns: 2,
  },
  render: (args) => <LayoutPlayground {...args} />,
};
