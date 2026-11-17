import { describe, expect, it } from 'vitest';
import type { ScreenChange } from './screen-changes';
import { screenStability, settleMapSvg, type ScreenFrame } from './screen-stability';

function change(rects: ScreenChange['rects'], label: string, share: number): ScreenChange {
  return { viewport: [1000, 500], area: 0, removedArea: 0, share, rects, regions: [{ label, area: 0 }], nodes: rects.length, ms: 0 };
}

// A header (top 10%) at +100, a body (next 80%) at +400, then a 10% footer
// strip keeps changing until +900.
const frames: ScreenFrame[] = [
  { commitId: 1, t: 100, change: change([[0, 0, 1000, 50]], 'header', 0.1) },
  { commitId: 2, t: 400, change: change([[0, 50, 1000, 450]], 'body', 0.8) },
  { commitId: 3, t: 700, change: change([[0, 450, 1000, 500]], 'footer', 0.1) },
  { commitId: 4, t: 900, change: change([[0, 450, 1000, 500]], 'footer', 0.1) },
];

describe('screenStability', () => {
  it('reports VC50, VC90, and VC100 over the viewport', () => {
    const s = screenStability(frames)!;
    expect(s.changedShare).toBe(1);
    expect(s.vc50).toBe(400);
    expect(s.vc90).toBe(400);
    expect(s.vc100).toBe(900);
    expect(s.late.map((l) => [l.label, l.at])).toEqual([['footer', 900], ['footer', 700]]);
  });

  it('counts unchanged cells as complete from the origin', () => {
    const s = screenStability([{ commitId: 1, t: 300, change: change([[0, 0, 1000, 25]], 'banner', 0.05) }])!;
    expect(s.vc90).toBe(0);
    expect(s.vc100).toBe(300);
    expect(s.changedVc90).toBe(300);
  });

  it('returns null without screen data', () => {
    expect(screenStability([])).toBeNull();
  });
});

describe('settleMapSvg', () => {
  it('draws the viewport with a legend and the latest regions', () => {
    const svg = settleMapSvg(frames)!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('footer +900');
    expect(svg).toContain('+100 ms');
    expect(svg).toContain('+900 ms');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
