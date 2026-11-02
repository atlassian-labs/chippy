import { describe, expect, it } from 'vitest';
import { createCommitSurfaceOwnership } from './commit-surface-ownership';

describe('commit surface ownership', () => {
  it('keeps DevTools capture active until an ATL callback arrives', () => {
    const ownership = createCommitSurfaceOwnership<number>();
    const root = { current: {} };
    ownership.recordDevtools(root, 1);
    expect(ownership.adapterObserved).toBe(false);
    expect(ownership.observeAdapter(root)).toBe(1);
    expect(ownership.adapterObserved).toBe(true);
  });
  it('allows ATL to capture when its callback arrives first', () => {
    const ownership = createCommitSurfaceOwnership<number>();
    expect(ownership.observeAdapter({ current: {} })).toBeNull();
    expect(ownership.adapterObserved).toBe(true);
  });
  it('does not reuse evidence when the root has committed a different fiber', () => {
    const ownership = createCommitSurfaceOwnership<number>();
    const root = { current: {} };
    ownership.recordDevtools(root, 1);
    root.current = {};
    expect(ownership.observeAdapter(root)).toBeNull();
  });
  it('matches roots independently and consumes each pending capture once', () => {
    const ownership = createCommitSurfaceOwnership<number>();
    const a = { current: {} }; const b = { current: {} };
    ownership.recordDevtools(a, 1); ownership.recordDevtools(b, 2);
    expect(ownership.observeAdapter(a)).toBe(1);
    expect(ownership.observeAdapter(b)).toBe(2);
    ownership.recordDevtools(b, 3);
    expect(ownership.observeAdapter(b)).toBe(3);
    expect(ownership.observeAdapter(b)).toBeNull();
  });
  it('resets capture ownership and forgets the previous installation', () => {
    const ownership = createCommitSurfaceOwnership<number>();
    const root = { current: {} };
    ownership.recordDevtools(root, 1);
    ownership.observeAdapter(root);
    ownership.reset();
    expect(ownership.adapterObserved).toBe(false);
    expect(ownership.observeAdapter(root)).toBeNull();
  });
});
