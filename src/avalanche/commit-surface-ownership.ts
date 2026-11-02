export interface CommitRoot {
  current: object;
}

// A seeded metrics slot cannot select the capture owner. The first actual
// adapter callback can arrive before or after DevTools for the same committed
// fiber.
export function createCommitSurfaceOwnership<T>() {
  let adapterObserved = false;
  let devtoolsCaptures = new WeakMap<CommitRoot, { current: object; capture: T }>();
  return {
    get adapterObserved() { return adapterObserved; },
    recordDevtools(root: CommitRoot, capture: T) {
      devtoolsCaptures.set(root, { current: root.current, capture });
    },
    observeAdapter(root: CommitRoot): T | null {
      const previous = devtoolsCaptures.get(root);
      adapterObserved = true;
      devtoolsCaptures.delete(root);
      return previous?.current === root.current ? previous.capture : null;
    },
    reset() {
      adapterObserved = false;
      devtoolsCaptures = new WeakMap();
    },
  };
}
