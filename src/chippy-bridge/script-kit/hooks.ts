/**
 * Hook and prop reads for page scripts.
 *
 * `hooks(ref)` reads the committed hook list from the fiber: primitive families
 * and value previews, with no custom-hook names. Naming custom hooks
 * (`useQuery`, `useSuspenseQuery`) needs debug replay, which runs the
 * component's render function and hook bodies against a stub dispatcher. Replay
 * schedules no update, but render-time side effects in application code do
 * run, so it is behind the `replay` gate.
 */

import type { Fiber } from '../../layout-lab/fiber-walk';
import type { ReplayResult, FiberHooksResult } from '../../debug-render/replay';
import { GateError, type Ledger, type ScriptGate } from './ledger';
import type { FiberRef, RefRegistry } from './fiber-ref';
import type { FindQuery } from './select';

export interface ScriptHook {
  index: number | null;
  /** React primitive family: State, Effect, Ref, Memo, Value, Context, ... */
  primitive: string;
  /** Custom hooks that led to this primitive, outermost first. Empty without replay. */
  path: string[];
  /** Short preview of the stored value. */
  value: unknown;
}

export interface HooksResult {
  component: FiberRef;
  /** `fiber-only` without replay; otherwise the replay status. */
  status: 'fiber-only' | ReplayResult['replayStatus'];
  hooks: ScriptHook[];
  /** Custom hook names called by the component, outermost first, de-duplicated. */
  customHooks: string[];
  truncated: boolean;
  error: string | null;
}

export interface HooksOptions {
  /** Name custom hooks through debug replay. Needs `--allow replay`. */
  replay?: boolean;
}

export interface CallersOptions extends Omit<FindQuery, 'where'> {
  /** Stop after replaying this many components (default 2000). */
  maxReplays?: number;
}

export interface HookDeps {
  registry: RefRegistry;
  ledger: Ledger;
  allowed: readonly ScriptGate[];
  find: (query: FindQuery) => FiberRef[];
  evalFiberHooks: (fiber: Fiber) => FiberHooksResult;
  replayComponentHooks: (fiber: Fiber) => ReplayResult;
}

const HOOK_COMPONENT_TAGS = new Set([0, 11, 14, 15]);
const DEFAULT_MAX_REPLAYS = 2000;

/** `Object.useQuery` and `useQuery` name the same hook in stack frames. */
export function bareHookName(frameName: string): string {
  return frameName.slice(frameName.lastIndexOf('.') + 1);
}

function matchesHook(matcher: string | RegExp, name: string): boolean {
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(name);
  }
  return name === matcher;
}

export function createHooks(deps: HookDeps) {
  const { registry, ledger } = deps;
  const cache = new Map<FiberRef, HooksResult>();

  function requireReplay(what: string): void {
    if (!deps.allowed.includes('replay')) {
      // Recorded too, so a script that catches the error still reports the gap.
      ledger.add('hooks', 'gap', `${what} needs --allow replay`);
      throw new GateError('replay', `${what} runs component render functions through debug replay.`);
    }
  }

  function fiberOnly(ref: FiberRef): HooksResult {
    const raw = deps.evalFiberHooks(registry.fiberOf(ref) as Fiber);
    if (raw.truncated) ledger.add('hooks', 'truncated', `hook list cut at ${raw.maxHooks} hooks`);
    return {
      component: ref,
      status: 'fiber-only',
      hooks: raw.hooks.map((hook) => ({
        index: hook.index,
        primitive: hook.tag,
        path: [],
        value: hook.value !== undefined ? hook.value : hook.current !== undefined ? hook.current : hook.deps,
      })),
      customHooks: [],
      truncated: raw.truncated,
      error: raw.error || null,
    };
  }

  function replayed(ref: FiberRef): HooksResult {
    const cached = cache.get(ref);
    if (cached) return cached;
    const raw = deps.replayComponentHooks(registry.fiberOf(ref) as Fiber);
    if (raw.replayStatus !== 'complete') {
      ledger.add('hooks', 'confidence', `replay ${raw.replayStatus}${raw.replayError ? ': ' + raw.replayError : ''}`);
    }
    const customHooks: string[] = [];
    const hooks = raw.records.map((record) => {
      const path = (record.path || []).map((frame) => bareHookName(frame.name));
      for (const name of path) if (!customHooks.includes(name)) customHooks.push(name);
      return { index: record.index, primitive: record.primitive, path, value: record.value };
    });
    const result: HooksResult = {
      component: ref,
      status: raw.replayStatus,
      hooks,
      customHooks,
      truncated: false,
      error: raw.replayError || null,
    };
    cache.set(ref, result);
    return result;
  }

  function hooks(ref: FiberRef, options: HooksOptions = {}): HooksResult {
    if (!options.replay) return fiberOnly(ref);
    requireReplay('hooks(ref, { replay: true })');
    return replayed(ref);
  }

  /**
   * Components that call a custom hook, directly or through other custom hooks.
   * Replays each candidate component once per run.
   */
  function callers(hook: string | RegExp, options: CallersOptions = {}): FiberRef[] {
    requireReplay(`hooks.callers(${String(hook)})`);
    const maxReplays = Math.max(1, Math.floor(options.maxReplays ?? DEFAULT_MAX_REPLAYS));
    const { maxReplays: _ignored, ...query } = options;
    const candidates = deps.find({ kind: 'component', ...query, where: (ref) => HOOK_COMPONENT_TAGS.has(ref.tag) });
    if (candidates.length > maxReplays) {
      ledger.add('hooks.callers', 'truncated', `replayed ${maxReplays} of ${candidates.length} candidate components; narrow with name, file, or within`);
    }
    return candidates.slice(0, maxReplays).filter((ref) => replayed(ref).customHooks.some((name) => matchesHook(hook, name)));
  }

  /** The component's committed props object. Values are live application data. */
  function props(ref: FiberRef): Record<string, unknown> {
    const value = registry.fiberOf(ref).memoizedProps;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  return { hooks: Object.assign(hooks, { callers }), props };
}
