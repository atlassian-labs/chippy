/**
 * Spans of time Chippy spent on its own work in the page: a bridge command
 * from receipt to its result, or a snapshot. Chrome leaves extension scripts
 * out of long animation frame attribution, so a frame Chippy caused lists no
 * scripts, or only Chippy's; these spans let the perf summary tell such
 * frames apart from the page's own.
 *
 * Recording costs two `performance.now()` reads per command and a bounded
 * ring of spans, kept whether or not Avalanche is capturing.
 */

export type OwnWorkSpan = { start: number; end: number; label: string };

const MAX_SPANS = 200;
const spans: OwnWorkSpan[] = [];

export function noteOwnWork(start: unknown, end: unknown, label: unknown = ''): void {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
  spans.push({ start: Math.round(from * 10) / 10, end: Math.round(to * 10) / 10, label: String(label).slice(0, 60) });
  if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
}

/** Spans that ended at or after `since`, oldest first. */
export function ownWorkSince(since = -Infinity): OwnWorkSpan[] {
  return spans.filter((span) => span.end >= since);
}

export function clearOwnWork(): void {
  spans.length = 0;
}

type FrameLike = {
  startTime: number;
  duration: number;
  scripts?: Array<{ duration: number; chippy?: true }>;
};

/**
 * A long frame is Chippy's when it overlaps a span of Chippy's work and the
 * page's own attributed scripts cover less than half of it. Both are needed:
 * a span can include waits during which the page ran frames of its own, and
 * those frames list the page's scripts.
 */
export function isOwnFrame(frame: FrameLike, own: readonly OwnWorkSpan[] | undefined): boolean {
  const scripts = frame.scripts ?? [];
  const pageScriptMs = scripts.reduce((sum, script) => sum + (script.chippy ? 0 : script.duration || 0), 0);
  if (pageScriptMs * 2 >= frame.duration) return false;
  if (scripts.some((script) => script.chippy)) return true;
  const from = frame.startTime;
  const to = frame.startTime + frame.duration;
  return !!own?.some((span) => span.start < to && span.end > from);
}
