// Approximate union area of screen rectangles inside one clip rectangle.
//
// Overlapping boxes must be counted once, and a page can contribute thousands
// of rectangles per measurement. A coverage bitmap over the clip area keeps the
// cost proportional to covered cells instead of quadratic in the rectangle
// count. The cell size grows with the clip area so a grid never exceeds
// MAX_CELLS; areas are therefore accurate to about one cell along each edge.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const MAX_CELLS = 250_000;

export interface AreaGrid {
  readonly clip: Rect;
  readonly cell: number;
  add(rect: Rect): void;
  /** Covered area in square CSS pixels. */
  area(): number;
}

export function rectArea(rect: Rect): number {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function cellSizeFor(clip: Rect): number {
  const area = rectArea(clip);
  return Math.max(1, Math.ceil(Math.sqrt(area / MAX_CELLS)));
}

export function createAreaGrid(clip: Rect, cell: number = cellSizeFor(clip)): AreaGrid {
  const cols = Math.max(0, Math.ceil((clip.right - clip.left) / cell));
  const rows = Math.max(0, Math.ceil((clip.bottom - clip.top) / cell));
  const bits = new Uint8Array(cols * rows);
  let covered = 0;

  function add(rect: Rect): void {
    const r = intersectRect(rect, clip);
    if (!r) return;
    // A cell counts when the rectangle covers its centre.
    const c0 = Math.max(0, Math.round((r.left - clip.left) / cell));
    const c1 = Math.min(cols, Math.round((r.right - clip.left) / cell));
    const r0 = Math.max(0, Math.round((r.top - clip.top) / cell));
    const r1 = Math.min(rows, Math.round((r.bottom - clip.top) / cell));
    for (let y = r0; y < r1; y++) {
      const row = y * cols;
      for (let x = c0; x < c1; x++) {
        if (bits[row + x] === 0) { bits[row + x] = 1; covered++; }
      }
    }
  }

  function area(): number {
    const full = rectArea(clip);
    return Math.min(full, covered * cell * cell);
  }

  return { clip, cell, add, area };
}
