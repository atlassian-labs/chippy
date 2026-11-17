import { describe, expect, it } from 'vitest';
import { createPaintTracker, type PaintTimingEnvironment } from './paint-timing';

function fakeEnvironment() {
  const frames: Array<() => void> = [];
  const tasks: Array<() => void> = [];
  let clock = 0;
  let hidden = false;
  const env: PaintTimingEnvironment = {
    requestFrame: (cb) => frames.push(cb),
    postTask: (cb) => tasks.push(cb),
    now: () => clock,
    hidden: () => hidden,
  };
  return {
    env,
    setClock: (t: number) => { clock = t; },
    setHidden: (h: boolean) => { hidden = h; },
    // Runs one frame: its callbacks, then the task posted after its rendering update.
    frame: () => { frames.splice(0).forEach((cb) => cb()); tasks.splice(0).forEach((cb) => cb()); },
    frames,
  };
}

describe('createPaintTracker', () => {
  it('gives commits that land before one frame the same paint time', () => {
    const fake = fakeEnvironment();
    const painted: Array<[number[], number]> = [];
    const tracker = createPaintTracker((ids, t) => painted.push([ids, t]), fake.env);
    tracker.afterCommit(1);
    tracker.afterCommit(2);
    expect(fake.frames).toHaveLength(1);
    fake.setClock(2300);
    fake.frame();
    tracker.afterCommit(3);
    fake.setClock(2320);
    fake.frame();
    expect(painted).toEqual([[[1, 2], 2300], [[3], 2320]]);
  });

  it('skips commits made while the page is hidden', () => {
    const fake = fakeEnvironment();
    const painted: number[][] = [];
    const tracker = createPaintTracker((ids) => painted.push(ids), fake.env);
    fake.setHidden(true);
    tracker.afterCommit(1);
    fake.frame();
    expect(painted).toEqual([]);
  });

  it('drops pending commits on reset', () => {
    const fake = fakeEnvironment();
    const painted: number[][] = [];
    const tracker = createPaintTracker((ids) => painted.push(ids), fake.env);
    tracker.afterCommit(1);
    tracker.reset();
    fake.frame();
    tracker.afterCommit(2);
    fake.frame();
    expect(painted).toEqual([[2]]);
  });

  it('does nothing without a browser environment', () => {
    const tracker = createPaintTracker(() => { throw new Error('unexpected'); }, null);
    expect(() => tracker.afterCommit(1)).not.toThrow();
  });
});
