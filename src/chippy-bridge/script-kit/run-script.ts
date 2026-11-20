/**
 * The eval-page runner: executes an agent-written script in the page with the
 * `chippy` toolkit and returns one envelope with the result, the run ledger,
 * and what the script changed.
 *
 * The script body runs as an async function, so it may `await` and `return`.
 * It receives `ctx = { args, helpers, log, chippy }` and a bare `chippy`
 * binding. Results are serialized with `scriptResultJson`, which honors
 * `toJSON`, so returned `FiberRef`s become `{ fiberId, name, kind, source }`.
 *
 * A timeout cannot stop a running script; it only stops waiting for it. The
 * envelope then carries the last `chippy.checkpoint(value)` as `partial`.
 */

import type { Fiber } from '../../layout-lab/fiber-walk';
import type { FiberHooksResult, ReplayResult } from '../../debug-render/replay';
import { createScriptKit } from './index';
import { GateError, createLedger, parseGates, type LimitEntry, type ScriptGate } from './ledger';
import { fiberRootsOf, watchSideEffects, type SideEffectReport } from './side-effects';

export const DEFAULT_SCRIPT_TIMEOUT_MS = 5000;
export const MAX_SCRIPT_TIMEOUT_MS = 120_000;
const MIN_SCRIPT_TIMEOUT_MS = 50;

export interface RunScriptCommand {
  source?: unknown;
  args?: unknown;
  timeoutMs?: unknown;
  /** Gates opened for this run: an array or a comma-separated string. */
  allow?: unknown;
}

export interface RunScriptDeps {
  /** Builds the legacy `ctx.helpers`; their notes go to the run's log. */
  buildHelpers: (log: unknown[]) => ScriptHelpers;
  rememberFiber: (fiber: Fiber) => string | number;
  getRememberedFiber?: (id: string) => Fiber | null;
  evalFiberHooks: (fiber: Fiber) => FiberHooksResult;
  replayComponentHooks: (fiber: Fiber) => ReplayResult;
  scriptResultJson: (value: unknown) => unknown;
  now?: () => number;
}

export type ScriptHelpers = { getRootFibers: () => Fiber[] } & Record<string, unknown>;

export interface RunScriptEnvelope {
  ok: boolean;
  durationMs: number;
  log: unknown;
  result?: unknown;
  error?: string;
  /** The gate a GateError asked for. */
  gate?: string;
  timedOut?: true;
  /** Last checkpoint value, when the script timed out or threw. */
  partial?: unknown;
  /** Incomplete or low-confidence answers recorded during the run. Empty means none. */
  limits: LimitEntry[];
  sideEffects: SideEffectReport;
  allowed: ScriptGate[];
  unknownGates?: string[];
}

export function clampScriptTimeout(value: unknown): number {
  const ms = Number(value) || DEFAULT_SCRIPT_TIMEOUT_MS;
  return Math.min(MAX_SCRIPT_TIMEOUT_MS, Math.max(MIN_SCRIPT_TIMEOUT_MS, ms));
}

class ScriptTimeout extends Error {
  constructor(ms: number) {
    super(`script timeout after ${ms}ms; the script may still be running in the page`);
    this.name = 'ScriptTimeout';
  }
}

export async function runChippyScript(command: RunScriptCommand, deps: RunScriptDeps): Promise<RunScriptEnvelope> {
  const now = deps.now || Date.now;
  const startedAt = now();
  const source = String(command.source || '');
  const args = command.args && typeof command.args === 'object' ? command.args : {};
  const timeoutMs = clampScriptTimeout(command.timeoutMs);
  const gates = parseGates(command.allow);
  const log: unknown[] = [];
  const ledger = createLedger();
  const serialize = (value: unknown) => deps.scriptResultJson(value);

  const base = () => ({
    durationMs: now() - startedAt,
    log: serialize(log),
    limits: ledger.entries(),
    allowed: gates.allowed,
    ...(gates.unknown.length ? { unknownGates: gates.unknown } : {}),
  });

  if (!source.trim()) {
    return { ok: false, error: 'empty script source', sideEffects: { domMutations: 0, rootsCommitted: 0, globalsAdded: [] }, ...base() };
  }

  const helpers = deps.buildHelpers(log);
  const kit = createScriptKit({
    rememberFiber: deps.rememberFiber,
    getRememberedFiber: deps.getRememberedFiber,
    getRootFibers: helpers.getRootFibers,
    evalFiberHooks: deps.evalFiberHooks,
    replayComponentHooks: deps.replayComponentHooks,
    allowed: gates.allowed,
    log,
    ledger,
  });
  const ctx = { args, helpers, log, chippy: kit.chippy };
  const stopWatching = watchSideEffects({ fiberRoots: () => fiberRootsOf(helpers.getRootFibers() as Array<{ stateNode?: unknown }>) });
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const factory = new Function(
      'ctx',
      'chippy',
      '"use strict"; return (async function chippyScript(ctx, chippy){\n' + source + '\n}).call(globalThis, ctx, chippy);',
    ) as (ctx: unknown, chippy: unknown) => Promise<unknown>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ScriptTimeout(timeoutMs)), timeoutMs);
    });
    const value = await Promise.race([Promise.resolve().then(() => factory(ctx, kit.chippy)), timeout]);
    const result = serialize(value);
    return { ok: true, result, sideEffects: stopWatching(), ...base() };
  } catch (error) {
    const partial = kit.partial();
    const envelope: RunScriptEnvelope = {
      ok: false,
      error: String((error as Error)?.stack || (error as Error)?.message || error),
      sideEffects: stopWatching(),
      ...base(),
    };
    if (error instanceof GateError) {
      envelope.gate = error.gate;
      envelope.error = error.message;
    }
    if (error instanceof ScriptTimeout) envelope.timedOut = true;
    if (partial) envelope.partial = serialize(partial.value);
    return envelope;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
