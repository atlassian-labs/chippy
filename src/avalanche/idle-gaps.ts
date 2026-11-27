/**
 * Idle gaps: stretches after an interaction where nothing observable ran.
 *
 * A gap has no request in flight, no long frame, and no React render or commit.
 * A debounce, a timer, or a wait on something Chippy does not see (a worker,
 * an idle callback) shows up here as a gap, even when no Suspense fallback
 * appeared.
 */

export type IdleGapEnd =
  | { kind: 'request'; label: string; requestId: number | string }
  | { kind: 'commit'; commitId: number }
  | { kind: 'frame'; label: string };

export interface BusySpan {
  start: number;
  end: number;
  /** What the gap before this span is reported as ended by. */
  cause: IdleGapEnd;
}

/**
 * A user input inside the range. The quiet time before it is the user's own
 * pause, not a wait, so it is not reported; a new gap can start at the input.
 * This is how typing reports the debounce after the last keystroke.
 */
export type GapRestart = number;

export interface IdleGap {
  from: number;
  until: number;
  ms: number;
  endedBy: IdleGapEnd;
}

/** Gaps shorter than this are ordinary scheduling, not a wait (default). */
export const MIN_IDLE_GAP_MS = 100;
export const MAX_IDLE_GAPS = 10;

/**
 * Returns the gaps between `from` and `until`, longest first. A gap counts only
 * when something ended it, so the quiet tail after the last span is not one.
 * A gap that a user input ends is dropped, and the next gap starts at the input.
 */
export function idleGaps(spans: BusySpan[], from: number, until: number, minMs = MIN_IDLE_GAP_MS, max = MAX_IDLE_GAPS, restarts: GapRestart[] = []): IdleGap[] {
  const gaps: IdleGap[] = [];
  let cursor = from;
  type SweepEvent = { start: number; end: number; cause: IdleGapEnd | null };
  const events: SweepEvent[] = [...spans, ...restarts.filter((t) => t > from).map((t) => ({ start: t, end: t, cause: null }))]
    // At equal times an input goes first, so the span it caused does not end a gap.
    .sort((a, b) => a.start - b.start || Number(a.cause !== null) - Number(b.cause !== null) || b.end - a.end);
  for (const span of events) {
    // A span that starts exactly at `until` (the window's last commit) still ends the gap before it.
    if (span.start > until) break;
    if (span.cause === null) {
      cursor = Math.max(cursor, span.start);
      continue;
    }
    if (span.end <= cursor) continue;
    if (span.start > cursor && span.start - cursor >= minMs) gaps.push({ from: cursor, until: span.start, ms: span.start - cursor, endedBy: span.cause });
    cursor = Math.max(cursor, span.end);
  }
  return gaps.sort((a, b) => b.ms - a.ms || a.from - b.from).slice(0, max);
}

export function describeGapEnd(end: IdleGapEnd): string {
  if (end.kind === 'request') return `request ${end.label}`;
  if (end.kind === 'commit') return `commit c${end.commitId}`;
  return `long frame ${end.label}`;
}
