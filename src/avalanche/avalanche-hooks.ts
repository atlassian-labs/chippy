/**
 * Avalanche hooks: per-recording callbacks a plugin runs next to the detector.
 *
 * A hook set gets `onStart` when a recording starts (install or clear),
 * `onStep` after every captured commit, and `onEnd` when a report is built.
 * Whatever a callback returns becomes evidence in the report under
 * `hooks[<id>]`: `start`, `steps[commitId]`, and `end`. Each hook set keeps a
 * private `state` object for the length of one recording.
 *
 * Hooks never break capture. A throwing callback is recorded in `errors`, and
 * a set whose `onStep` keeps failing stops stepping for the rest of the
 * recording. Many hook sets can be active at once, unlike the single commit
 * metrics adapter.
 */

import type { Fiber } from './internals';

export type AvalancheHookCommit = {
  /** Commit number, the same key as `commitStats` and `commitTimings`. */
  id: number;
  /** Components the detector recorded in this commit. */
  components: number;
  /** `performance.now()` when the detector started handling the commit. */
  startTime: number;
  /** `performance.now()` when the detector finished handling the commit. */
  endTime: number;
  /** Current fiber of the committed root. */
  root: Fiber;
};

export type AvalancheHookContext = {
  /** Hook set id. */
  id: string;
  /** Private scratch object, reset when a recording starts. */
  state: Record<string, unknown>;
  /** Commits captured so far in this recording. */
  commits: number;
  /** The commit just captured; only set in `onStep`. */
  commit?: AvalancheHookCommit;
};

export type AvalancheHooks = {
  /** Stable id; the report keys this set's results by it. */
  readonly id: string;
  /** Markdown for agents on how to read this set's results; copied into the report. */
  readonly instructions?: string;
  onStart?(context: AvalancheHookContext): unknown;
  onStep?(context: AvalancheHookContext): unknown;
  onEnd?(context: AvalancheHookContext): unknown;
};

export type AvalancheHookError = { phase: 'start' | 'step' | 'end'; commitId?: number; message: string };

export type AvalancheHookResult = {
  /** How to read this result, from the hook set (for example a pack's instructions). */
  instructions?: string;
  start?: unknown;
  /** onStep results keyed by commit id; commits whose step returned undefined are absent. */
  steps: Record<number, unknown>;
  end?: unknown;
  /** First errors thrown by the callbacks, oldest first. */
  errors: AvalancheHookError[];
  /** Total callback failures, including those past the `errors` cap. */
  errorCount: number;
  /** True once onStep failed too often and stopped running. */
  stepDisabled: boolean;
};

const MAX_RECORDED_ERRORS = 5;
const MAX_STEP_FAILURES = 20;

const registered = new Map<string, AvalancheHooks>();

/**
 * Register a hook set. Registering the same id again replaces the earlier set.
 * Returns an unregister function.
 */
export function registerAvalancheHooks(hooks: AvalancheHooks): () => void {
  if (!hooks || typeof hooks.id !== 'string' || !hooks.id) {
    throw new TypeError('registerAvalancheHooks expects hooks with a non-empty id');
  }
  for (const phase of ['onStart', 'onStep', 'onEnd'] as const) {
    if (hooks[phase] !== undefined && typeof hooks[phase] !== 'function') {
      throw new TypeError(`avalanche hooks ${hooks.id}: ${phase} must be a function`);
    }
  }
  registered.set(hooks.id, hooks);
  return () => {
    if (registered.get(hooks.id) === hooks) registered.delete(hooks.id);
  };
}

export function getAvalancheHooks(): AvalancheHooks[] {
  return [...registered.values()];
}

/** Keep results JSON-safe: drop functions and cycles, keep plain data. */
function toEvidence(value: unknown): unknown {
  if (value === undefined || typeof value === 'function') return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

type Session = { hooks: AvalancheHooks; context: AvalancheHookContext; result: AvalancheHookResult; stepFailures: number };

/**
 * One detector's view of the registered hooks. Sessions start on `start()` and
 * lazily for a set registered mid-recording, so its first callback is a step.
 */
export function createAvalancheHookRunner(source: () => AvalancheHooks[] = getAvalancheHooks) {
  let sessions = new Map<AvalancheHooks, Session>();
  let commits = 0;
  let started = false;

  function fail(session: Session, error: AvalancheHookError): void {
    session.result.errorCount += 1;
    if (session.result.errors.length < MAX_RECORDED_ERRORS) session.result.errors.push(error);
  }

  function open(hooks: AvalancheHooks, runStart: boolean): Session {
    const session: Session = {
      hooks,
      context: { id: hooks.id, state: {}, commits },
      result: {
        ...(hooks.instructions && { instructions: hooks.instructions }),
        steps: {},
        errors: [],
        errorCount: 0,
        stepDisabled: false,
      },
      stepFailures: 0,
    };
    sessions.set(hooks, session);
    if (runStart && hooks.onStart) {
      try {
        session.result.start = toEvidence(hooks.onStart(session.context));
      } catch (error) {
        fail(session, { phase: 'start', message: messageOf(error) });
      }
    }
    return session;
  }

  function current(): Session[] {
    const live = source();
    for (const hooks of sessions.keys()) if (!live.includes(hooks)) sessions.delete(hooks);
    return live.map((hooks) => sessions.get(hooks) ?? open(hooks, false));
  }

  return {
    /** Begin a recording: fresh state for every set, then onStart. */
    start(): void {
      started = true;
      sessions = new Map();
      commits = 0;
      for (const hooks of source()) open(hooks, true);
    },

    /** Start once; later calls keep the running recording (install() is idempotent). */
    ensureStarted(): void {
      if (!started) this.start();
    },

    /** Run onStep for one captured commit. */
    step(commit: AvalancheHookCommit): void {
      commits += 1;
      for (const session of current()) {
        const { hooks, context, result } = session;
        context.commits = commits;
        if (!hooks.onStep || result.stepDisabled) continue;
        context.commit = commit;
        try {
          const value = toEvidence(hooks.onStep(context));
          if (value !== undefined) result.steps[commit.id] = value;
        } catch (error) {
          fail(session, { phase: 'step', commitId: commit.id, message: messageOf(error) });
          session.stepFailures += 1;
          if (session.stepFailures >= MAX_STEP_FAILURES) result.stepDisabled = true;
        } finally {
          context.commit = undefined;
        }
      }
    },

    /** Run onEnd and return every set's results, or null when none is registered. */
    collect(): Record<string, AvalancheHookResult> | null {
      const live = current();
      if (live.length === 0) return null;
      const out: Record<string, AvalancheHookResult> = {};
      for (const session of live) {
        const { hooks, context, result } = session;
        context.commits = commits;
        const snapshot: AvalancheHookResult = { ...result, steps: { ...result.steps }, errors: [...result.errors] };
        if (hooks.onEnd) {
          try {
            snapshot.end = toEvidence(hooks.onEnd(context));
          } catch (error) {
            snapshot.errorCount += 1;
            if (snapshot.errors.length < MAX_RECORDED_ERRORS) snapshot.errors.push({ phase: 'end', message: messageOf(error) });
          }
        }
        out[hooks.id] = snapshot;
      }
      return out;
    },
  };
}

/** Forget every registration. Test helper. */
export function resetAvalancheHooks(): void {
  registered.clear();
}
