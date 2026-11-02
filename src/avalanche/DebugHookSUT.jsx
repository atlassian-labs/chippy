import React from 'react';

function makeStore(intervalMs = 50) {
  let value = 0;
  const listeners = new Set();
  let timerId = null;

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const tick = () => {
    value += 1;
    notify();
  };

  if (Number.isFinite(intervalMs) && intervalMs > 0) {
    timerId = setInterval(tick, intervalMs);
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => value,
    tick,
    dispose: () => {
      if (timerId != null) clearInterval(timerId);
      timerId = null;
    },
  };
}

function useLocalStore(intervalMs) {
  const store = React.useMemo(() => makeStore(intervalMs), [intervalMs]);
  React.useEffect(() => () => store.dispose(), [store]);
  return store;
}

function useIssueApprovalsSnapshot(store) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
}

function useIssueApprovalsStore(store) {
  return useIssueApprovalsSnapshot(store);
}

function useApprovalFormatter(approvalCount) {
  return React.useMemo(() => ({
    format: (value) => `${value} approvals`,
    sample: approvalCount % 3,
  }), [approvalCount % 3]);
}

function useApprovalMetadata(approvalCount) {
  return React.useMemo(() => ({
    bucket: approvalCount % 5,
    title: `Bucket ${approvalCount % 5}`,
  }), [approvalCount % 5]);
}

function useApprovalAuditTrail(approvalCount) {
  return React.useMemo(() => {
    const marker = {
      parity: approvalCount % 2,
      seenAt: approvalCount,
    };

    return {
      marker,
      summary: `${marker.parity}:${marker.seenAt}`,
    };
  }, [approvalCount % 2]);
}

function useStableApprovalActions() {
  const [clicks, setClicks] = React.useState(0);
  const bump = React.useCallback(() => setClicks((count) => count + 1), []);
  return [clicks, bump];
}

function useApprovalSummary(approvalCount, clicks) {
  return React.useMemo(() => ({
    label: `${approvalCount}:${clicks}`,
    total: approvalCount + clicks,
  }), [{ approvalCount, clicks }]);
}

export function StoreReader({ storeIntervalMs = 75 }) {
  const store = useLocalStore(storeIntervalMs);
  const approvalCount = useIssueApprovalsStore(store);
  const formatter = useApprovalFormatter(approvalCount);
  const metadata = useApprovalMetadata(approvalCount);
  const auditTrail = useApprovalAuditTrail(approvalCount);
  const [clicks, bump] = useStableApprovalActions();
  const summary = useApprovalSummary(approvalCount, clicks);
  const tickStore = React.useCallback(() => store.tick(), [store]);

  return (
    <section data-testid="debug-hook-lab" style={{ border: '1px solid #ccc', padding: 12 }}>
      <h3>Debug hook lab</h3>
      <p data-testid="debug-hook-value">{formatter.format(summary.total)}</p>
      <p data-testid="debug-hook-meta">{metadata.title}</p>
      <output hidden data-testid="debug-hook-audit">{auditTrail.summary}</output>
      <button type="button" onClick={bump}>Bump approvals local state</button>
      <button type="button" onClick={tickStore}>Tick approvals store</button>
    </section>
  );
}
