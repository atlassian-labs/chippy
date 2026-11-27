import { describe, expect, it } from 'vitest';
import { idleGaps, type BusySpan } from './idle-gaps';

const commit = (start: number, end: number, commitId: number): BusySpan => ({ start, end, cause: { kind: 'commit', commitId } });

describe('idleGaps', () => {
  it('finds quiet stretches between overlapping spans, longest first', () => {
    const spans = [commit(0, 50, 1), commit(30, 120, 2), commit(400, 420, 3), commit(600, 610, 4)];
    expect(idleGaps(spans, 0, 1000)).toEqual([
      { from: 120, until: 400, ms: 280, endedBy: { kind: 'commit', commitId: 3 } },
      { from: 420, until: 600, ms: 180, endedBy: { kind: 'commit', commitId: 4 } },
    ]);
  });

  it('skips the quiet tail and spans after the end', () => {
    expect(idleGaps([commit(501, 510, 1)], 0, 500)).toEqual([]);
    // The window's last commit starts exactly at the end and still ends the gap.
    expect(idleGaps([commit(500, 510, 1)], 0, 500)).toEqual([{ from: 0, until: 500, ms: 500, endedBy: { kind: 'commit', commitId: 1 } }]);
    // Abutting spans leave no zero-length gap, even with no minimum.
    expect(idleGaps([commit(0, 10, 1), commit(10, 20, 2)], 0, 100, 0)).toEqual([]);
    expect(idleGaps([commit(200, 210, 1)], 0, 1000)).toHaveLength(1);
  });

  it('lets a span that started before the window move the cursor', () => {
    expect(idleGaps([commit(-100, 300, 1), commit(350, 360, 2)], 0, 1000)).toEqual([]);
  });

  it('drops pauses that a user input ends and measures from the last input', () => {
    // Typing at 0, 150, 300; each keystroke commits briefly; a debounce fires a commit 500 ms after the last one.
    const spans = [commit(0, 10, 1), commit(150, 160, 2), commit(300, 310, 3), commit(800, 820, 4)];
    expect(idleGaps(spans, 0, 2000, 100, 10, [0, 150, 300])).toEqual([
      { from: 310, until: 800, ms: 490, endedBy: { kind: 'commit', commitId: 4 } },
    ]);
    // Without the inputs, the pauses between keystrokes would read as waits.
    expect(idleGaps(spans, 0, 2000)).toHaveLength(3);
  });

  it('honours the minimum and the cap', () => {
    const spans = Array.from({ length: 5 }, (_, i) => commit(200 * (i + 1), 200 * (i + 1) + 10, i));
    expect(idleGaps(spans, 0, 2000, 150, 2)).toHaveLength(2);
    expect(idleGaps(spans, 0, 2000, 250)).toEqual([]);
  });
});
