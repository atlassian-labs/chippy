/**
 * External Store Restart Attribution (dev-mode only)
 *
 * Wires into `__ATL_REACT_METRICS.onExternalStoreRestart` to walk the
 * finished fiber tree and identify which components had inconsistent stores.
 *
 * Usage:
 *   import { installExternalStoreRestartHandler } from './external-store-restart';
 *   installExternalStoreRestartHandler();
 *
 *   // After a restart occurs:
 *   const details = getExternalStoreRestartDetails();
 */
import { type Fiber, getComponentName, isComponentFiber } from '../../avalanche/internals';

// React reports the finished tree after a consistency restart. That tree is
// the useful attribution point: the abandoned concurrent pass is gone, while
// each useSyncExternalStore check still records the snapshot it rendered.

export interface ExternalStoreRestartDetail {
  componentName: string;
  /** The snapshot value rendered during the concurrent pass (identifies the store shape) */
  snapshotValue: unknown;
}

/**
 * Walk the fiber tree and collect components whose store snapshots are stale.
 */
function collectInconsistentStores(finishedWork: Fiber): ExternalStoreRestartDetail[] {
  const details: ExternalStoreRestartDetail[] = [];

  // Walk the fiber tree (same traversal as React's isRenderConsistentWithExternalStores)
  let node = finishedWork;

  while (node !== null) {
    const stores = node.updateQueue?.stores;
    if (stores) {
      for (let i = 0; i < stores.length; i++) {
        const check = stores[i];
        try {
          if (!Object.is(check.getSnapshot(), check.value)) {
            details.push({
              componentName: isComponentFiber(node.tag) ? getComponentName(node) : 'Anonymous',
              snapshotValue: check.value,
            });
          }
        } catch {
          details.push({
            componentName: isComponentFiber(node.tag) ? getComponentName(node) : 'Anonymous',
            snapshotValue: check.value,
          });
        }
      }
    }

    // Depth-first traversal
    if (node.child !== null) {
      node = node.child;
      continue;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        node = null;
        break;
      }
      node = node.return;
    }

    if (node !== null) {
      node = node.sibling;
    }
  }

  return details;
}

/**
 * Install the useSES restart handler on `__ATL_REACT_METRICS`.
 */
export function installExternalStoreRestartHandler(): ExternalStoreRestartDetail[] {
  const metrics = globalThis.__ATL_REACT_METRICS;
  if (!metrics) return [];

  const restartDetails: ExternalStoreRestartDetail[] = [];

  metrics.onExternalStoreRestart = (finishedWork: Fiber) => {
    const details = collectInconsistentStores(finishedWork);
    restartDetails.push(...details);
  };

  return restartDetails;
}
