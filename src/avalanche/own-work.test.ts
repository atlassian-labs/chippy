import { afterEach, describe, expect, it } from 'vitest';
import { clearOwnWork, isOwnFrame, noteOwnWork, ownWorkSince } from './own-work';

const span = [{ start: 100, end: 400, label: 'eval-avalanche' }];
const page = (duration: number) => ({ duration, chippy: undefined });

describe('own work', () => {
  afterEach(clearOwnWork);

  it('records valid spans in a bounded ring and reads them by end time', () => {
    noteOwnWork(10, 20.04, 'snapshot');
    noteOwnWork(30, 25, 'backwards');
    noteOwnWork('x', 40);
    for (let i = 0; i < 250; i += 1) noteOwnWork(100 + i, 101 + i, 'command');
    const spans = ownWorkSince();
    expect(spans).toHaveLength(200);
    expect(spans[0]).toEqual({ start: 150, end: 151, label: 'command' });
    expect(ownWorkSince(349)).toHaveLength(2);
  });

  it("counts a frame as Chippy's when it overlaps Chippy's work and page scripts cover less than half", () => {
    expect(isOwnFrame({ startTime: 200, duration: 100, scripts: [] }, span)).toBe(true);
    expect(isOwnFrame({ startTime: 200, duration: 100, scripts: [page(30)] }, span)).toBe(true);
  });

  it('keeps page frames that ran during a Chippy span or outside every span', () => {
    // The page's own scripts dominate: a page frame during a Chippy wait.
    expect(isOwnFrame({ startTime: 200, duration: 100, scripts: [page(80)] }, span)).toBe(false);
    expect(isOwnFrame({ startTime: 500, duration: 100, scripts: [] }, span)).toBe(false);
    expect(isOwnFrame({ startTime: 500, duration: 100, scripts: [] }, undefined)).toBe(false);
  });

  it('trusts scripts the browser attributed to Chippy without a span', () => {
    expect(isOwnFrame({ startTime: 500, duration: 100, scripts: [{ duration: 90, chippy: true }] }, undefined)).toBe(true);
  });
});
