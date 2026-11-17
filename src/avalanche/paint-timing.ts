/**
 * When did a commit reach the screen?
 *
 * React commits to the DOM synchronously, but the browser paints only after
 * the task that ran the commit ends. When several renders and commits run in
 * one long task, every one of them waits for that task to finish. In that
 * case the commit time says when the DOM changed, not when the user saw it.
 *
 * After a commit the tracker requests an animation frame. Once that frame's
 * callbacks have run, it posts a message, and the message runs after the
 * browser finishes the frame's rendering update (style, layout, paint). The
 * time of that message is the commit's `paintAt`. Commits that land before
 * the same frame share one `paintAt`.
 *
 * `paintAt` is the end of the frame's rendering work on the main thread.
 * Compositing and display can add a few milliseconds that the page cannot
 * observe.
 *
 * Hidden documents get no animation frames, so commits made while the page is
 * hidden get no `paintAt`.
 */

export interface PaintTimingEnvironment {
  requestFrame: (callback: () => void) => void;
  /** Runs `callback` in a new task, after the current frame's rendering update. */
  postTask: (callback: () => void) => void;
  now: () => number;
  hidden: () => boolean;
}

export interface PaintTracker {
  /** Call after recording a commit. `onPaint` gets the time it reached the screen. */
  afterCommit(commitId: number): void;
  /** Forget pending commits; frames already requested report nothing. */
  reset(): void;
}

function browserEnvironment(): PaintTimingEnvironment | null {
  if (typeof requestAnimationFrame !== 'function' || typeof MessageChannel !== 'function') return null;
  const channel = new MessageChannel();
  const queue: Array<() => void> = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return {
    requestFrame: (callback) => { requestAnimationFrame(() => callback()); },
    postTask: (callback) => { queue.push(callback); channel.port2.postMessage(null); },
    now: () => performance.now(),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  };
}

export function createPaintTracker(
  onPaint: (commitIds: number[], paintAt: number) => void,
  environment: PaintTimingEnvironment | null = browserEnvironment(),
): PaintTracker {
  let pending: number[] = [];
  let scheduled = false;
  let generation = 0;

  return {
    afterCommit(commitId) {
      if (!environment || environment.hidden()) return;
      pending.push(commitId);
      if (scheduled) return;
      scheduled = true;
      const mine = generation;
      environment.requestFrame(() => {
        environment.postTask(() => {
          if (mine !== generation) return;
          const ids = pending;
          pending = [];
          scheduled = false;
          if (ids.length) onPaint(ids, environment.now());
        });
      });
    },
    reset() {
      generation++;
      pending = [];
      scheduled = false;
    },
  };
}
