/**
 * One A/B sample: a run of one condition (one reload and the stimulus),
 * saved as the Avalanche export and a portable fiber state capture.
 *
 * Samples are files; an arm is the set of samples taken under one condition
 * (a directory, or a list of files). `ab-arm` and `ab-compare` read them
 * offline, so comparing arms needs no connected page.
 */
import type { FiberStateCapture } from '../chippy-bridge/fiber-state';

export const AB_SAMPLE_KIND = 'chippy-ab-sample';

export type AbSample = {
  kind: typeof AB_SAMPLE_KIND;
  version: 1;
  /** The arm the sample was saved into: its directory name. */
  arm: string;
  /** Free text from `ab-capture`, such as the flag value; null when none was given. */
  label: string | null;
  /** 1-based order within the arm, from the file name. */
  index: number;
  capturedAt: string;
  /** The Avalanche export (`ReportDTO`). */
  report: Record<string, unknown> & { meta: Record<string, unknown>; commitStats: Record<string, unknown> };
  /** Portable fiber state at the end of the run; null when the page could not capture it. */
  fiberState: FiberStateCapture | null;
  /** Why `fiberState` is null; null otherwise. */
  fiberStateError: string | null;
};

export function isAbSample(value: unknown): value is AbSample {
  const v = value as AbSample | null;
  return !!v && typeof v === 'object' && v.kind === AB_SAMPLE_KIND && v.version === 1
    && !!v.report && typeof v.report === 'object' && typeof v.report.commitStats === 'object';
}

/**
 * The fiber state from a helper `eval-probe` response, a `{ result }` wrapper,
 * or a bare capture; an error message when the response holds none.
 */
export function unwrapFiberState(value: unknown): { state: FiberStateCapture } | { error: string } {
  const candidates = [value, (value as any)?.result, (value as any)?.payload?.result, (value as any)?.payload];
  const state = candidates.find((c) => c && typeof c === 'object' && c.version === 1 && Array.isArray(c.fibers));
  if (state) return { state: state as FiberStateCapture };
  const error = candidates.map((c) => (c && typeof c === 'object' ? (c as any).error : null)).find((e) => typeof e === 'string');
  return { error: error || 'response has no fiber state capture' };
}

export function buildAbSample(input: {
  arm: string;
  label: string | null;
  index: number;
  report: AbSample['report'];
  fiberState: FiberStateCapture | null;
  fiberStateError: string | null;
  capturedAt?: string;
}): AbSample {
  return {
    kind: AB_SAMPLE_KIND,
    version: 1,
    arm: input.arm,
    label: input.label,
    index: input.index,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    report: input.report,
    fiberState: input.fiberState,
    fiberStateError: input.fiberState ? null : input.fiberStateError ?? 'no fiber state',
  };
}
