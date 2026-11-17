/**
 * When did the screen stop changing?
 *
 * Takes the per-commit screen changes from `screen-changes.ts` and paints
 * them onto a coarse grid over the viewport. Each cell keeps the time it last
 * changed. From that grid:
 *
 * - `vc50`, `vc90`, `vc100` (Visually Complete): the first time by which
 *   50%, 90%, and 100% of the viewport had reached its final state. Cells
 *   that never changed count as complete from the origin, so this is the
 *   user's whole-screen view.
 * - `changedVc90`: VC90 counting only cells that changed in the window, so a
 *   small region that keeps moving is not hidden by a static page.
 * - `late`: what kept changing after `changedVc90`, by region.
 * - a settle map: an SVG of the viewport, each cell colored by when it last
 *   changed.
 *
 * The grid works from recorded boxes, not pixels: a box counts as changed
 * when React inserted, updated, showed, or removed it, whether or not every
 * pixel inside it changed.
 */

import type { ScreenChange } from './screen-changes';

export interface ScreenFrame {
  commitId: number;
  /** Time relative to the timeline origin. */
  t: number;
  change: ScreenChange;
}

export interface ScreenStability {
  viewport: [number, number];
  /** Share of the viewport that changed at least once in the window. */
  changedShare: number;
  /** Visually Complete: time 50% of the whole viewport was final. */
  vc50: number;
  /** Visually Complete: time 90% of the whole viewport was final. */
  vc90: number;
  /** Visually Complete: last time any recorded box changed. */
  vc100: number;
  /** VC90 over the changed area only. */
  changedVc90: number | null;
  /** Regions that changed after `changedVc90`, latest first. */
  late: Array<{ label: string; at: number; commitId: number; share: number }>;
  /** Commits that changed at least 1% of the viewport. */
  visibleCommits: number;
}

export const GRID_COLUMNS = 48;

function grid(frames: ScreenFrame[]) {
  const [width, height] = frames[frames.length - 1].change.viewport;
  const cols = GRID_COLUMNS;
  const rows = Math.max(1, Math.round((cols * height) / Math.max(1, width)));
  const cw = width / cols;
  const ch = height / rows;
  const last = new Float64Array(cols * rows).fill(Number.NaN);
  for (const frame of frames) {
    for (const [l, t, r, b] of frame.change.rects) {
      // A cell counts when the box covers its centre.
      const c0 = Math.max(0, Math.round(l / cw));
      const c1 = Math.min(cols, Math.round(r / cw));
      const r0 = Math.max(0, Math.round(t / ch));
      const r1 = Math.min(rows, Math.round(b / ch));
      for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) last[y * cols + x] = frame.t;
    }
  }
  return { width, height, cols, rows, cw, ch, last };
}

function timeAtShare(times: number[], total: number, share: number, floor: number): number | null {
  if (total === 0) return null;
  const sorted = times.slice().sort((a, b) => a - b);
  const needed = Math.ceil(total * share);
  const missing = total - sorted.length; // cells stable from the start
  if (needed <= missing) return floor;
  return sorted[Math.min(sorted.length - 1, needed - missing - 1)];
}

export function screenStability(frames: ScreenFrame[]): ScreenStability | null {
  const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;
  const g = grid(sorted);
  const changedTimes: number[] = [];
  for (const value of g.last) if (!Number.isNaN(value)) changedTimes.push(value);
  const total = g.last.length;
  const vc = (share: number) => timeAtShare(changedTimes, total, share, 0) ?? 0;
  const changedVc90 = timeAtShare(changedTimes, changedTimes.length, 0.9, 0);
  const late = changedVc90 === null ? [] : sorted
    .filter((f) => f.t > changedVc90 && f.change.regions.length)
    .reverse()
    .slice(0, 5)
    .map((f) => ({ label: f.change.regions[0].label, at: f.t, commitId: f.commitId, share: f.change.share }));
  return {
    viewport: [g.width, g.height],
    changedShare: Math.round((changedTimes.length / total) * 1000) / 1000,
    vc50: vc(0.5),
    vc90: vc(0.9),
    vc100: changedTimes.length ? Math.max(...changedTimes) : 0,
    changedVc90,
    late,
    visibleCommits: sorted.filter((f) => f.change.share >= 0.01).length,
  };
}

// Light to dark, so late cells stand out; unchanged cells are neutral grey.
const RAMP = ['#fde9a9', '#fbcf7d', '#f7b35a', '#f0953f', '#e5762e', '#d45726', '#bd3b22', '#9f2420', '#7d121c', '#590616'];
const UNCHANGED = '#e6e6e6';

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Viewport-shaped SVG with each cell colored by when it last changed. */
export function settleMapSvg(frames: ScreenFrame[], title = 'When each part of the screen last changed'): string | null {
  const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;
  const g = grid(sorted);
  const times = Array.from(g.last).filter((v) => !Number.isNaN(v));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const bucket = (t: number) => (max === min ? RAMP.length - 1 : Math.min(RAMP.length - 1, Math.floor(((t - min) / (max - min)) * RAMP.length)));

  const scale = Math.min(1, 640 / g.width);
  const w = Math.round(g.width * scale);
  const h = Math.round(g.height * scale);
  const cw = g.cw * scale;
  const ch = g.ch * scale;
  const legendH = 34;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + legendH}" width="${w}" height="${h + legendH}" font-family="system-ui, sans-serif" font-size="11" shape-rendering="crispEdges">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${UNCHANGED}"/>`,
  ];
  // One rectangle per horizontal run of cells in the same color.
  for (let y = 0; y < g.rows; y++) {
    let x = 0;
    while (x < g.cols) {
      const value = g.last[y * g.cols + x];
      if (Number.isNaN(value)) { x++; continue; }
      const color = bucket(value);
      let end = x + 1;
      while (end < g.cols && !Number.isNaN(g.last[y * g.cols + end]) && bucket(g.last[y * g.cols + end]) === color) end++;
      parts.push(`<rect x="${(x * cw).toFixed(1)}" y="${(y * ch).toFixed(1)}" width="${((end - x) * cw).toFixed(1)}" height="${ch.toFixed(1)}" fill="${RAMP[color]}"/>`);
      x = end;
    }
  }
  // Label the latest changes at their largest box.
  for (const frame of sorted.slice(-3)) {
    const [l, t, r, b] = frame.change.rects[0];
    const label = frame.change.regions[0]?.label;
    if (!label) continue;
    const cx = ((l + r) / 2) * scale;
    const cy = ((t + b) / 2) * scale;
    parts.push(`<text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${escapeXml(`${label} +${frame.t}`)}</text>`);
  }
  // Legend: unchanged, then early to late.
  const sw = Math.max(18, Math.floor((w - 120) / RAMP.length));
  parts.push(`<rect x="0" y="${h + 8}" width="14" height="12" fill="${UNCHANGED}"/><text x="18" y="${h + 18}" fill="#444">unchanged</text>`);
  RAMP.forEach((color, i) => parts.push(`<rect x="${90 + i * sw}" y="${h + 8}" width="${sw}" height="12" fill="${color}"/>`));
  parts.push(`<text x="90" y="${h + 31}" fill="#444">+${min} ms</text>`);
  parts.push(`<text x="${90 + RAMP.length * sw}" y="${h + 31}" text-anchor="end" fill="#444">+${max} ms</text>`);
  parts.push('</svg>');
  return parts.join('');
}
