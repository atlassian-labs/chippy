import { describe, expect, it } from 'vitest';
import { cellSizeFor, createAreaGrid, MAX_CELLS } from './area-grid';

const clip = { left: 0, top: 0, right: 400, bottom: 300 };

describe('area grid', () => {
  it('counts overlapping rectangles once', () => {
    const grid = createAreaGrid(clip);
    grid.add({ left: 0, top: 0, right: 100, bottom: 100 });
    grid.add({ left: 50, top: 50, right: 150, bottom: 150 });
    expect(grid.area()).toBe(17500);
  });

  it('clips rectangles to the clip area', () => {
    const grid = createAreaGrid(clip);
    grid.add({ left: -100, top: 250, right: 100, bottom: 400 });
    expect(grid.area()).toBe(100 * 50);
  });

  it('grows the cell size to stay under the cell budget', () => {
    const big = { left: 0, top: 0, right: 4000, bottom: 3000 };
    const cell = cellSizeFor(big);
    expect((4000 / cell) * (3000 / cell)).toBeLessThanOrEqual(MAX_CELLS);
    const grid = createAreaGrid(big);
    grid.add({ left: 0, top: 0, right: 2000, bottom: 3000 });
    expect(Math.abs(grid.area() - 6_000_000) / 6_000_000).toBeLessThan(0.01);
  });
});
