import { describe, expect, it } from 'vitest';
import { createZeroMetrics, installMetricsAccessor, isSlotHostLocked, seedMetricsSlot } from './metrics-slot';

describe('ATL metrics slot', () => {
  it('installs a configurable accessor that ignores empty and all-zero writes', () => {
    const target: Record<string, any> = {};
    expect(installMetricsAccessor(target)).toBe(true);
    const descriptor = Object.getOwnPropertyDescriptor(target, '__ATL_REACT_METRICS')!;
    expect(descriptor.configurable).toBe(true);
    expect(descriptor.get).toBeTypeOf('function');

    const live = target.__ATL_REACT_METRICS;
    target.__ATL_REACT_METRICS = null;
    target.__ATL_REACT_METRICS = createZeroMetrics();
    expect(target.__ATL_REACT_METRICS).toBe(live);

    const next = { ...createZeroMetrics(), totalCommitCount: 3 };
    target.__ATL_REACT_METRICS = next;
    expect(target.__ATL_REACT_METRICS).toBe(next);

    // The host can still delete the slot.
    expect(delete target.__ATL_REACT_METRICS).toBe(true);
    expect(target.__ATL_REACT_METRICS).toBeUndefined();
  });

  it('keeps an existing slot value and skips a non-configurable slot', () => {
    const existing = { totalCommitCount: 2 };
    const target: Record<string, any> = { __ATL_REACT_METRICS: existing };
    installMetricsAccessor(target);
    expect(target.__ATL_REACT_METRICS).toBe(existing);

    const locked: Record<string, any> = {};
    Object.defineProperty(locked, '__ATL_REACT_METRICS', { value: existing, configurable: false });
    expect(installMetricsAccessor(locked)).toBe(false);
    expect(isSlotHostLocked(locked)).toBe(true);
  });

  it('treats an accessor as host-owned and seeds a plain slot', () => {
    const target: Record<string, any> = {};
    installMetricsAccessor(target);
    expect(isSlotHostLocked(target)).toBe(true);

    const plain: Record<string, any> = {};
    expect(isSlotHostLocked(plain)).toBe(false);
    const seeded = seedMetricsSlot(plain, '__CUSTOM');
    expect(plain.__CUSTOM).toBe(seeded);
    expect(seeded.setStateCount).toBe(0);
  });
});
