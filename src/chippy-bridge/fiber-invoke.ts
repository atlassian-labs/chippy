/**
 * fiber-invoke — extract from chippy-page-bridge.js with three correctness fixes.
 *
 * Source: .agents/skills/chippy/extension/chippy-page-bridge.js
 *   - readFiberProp              (lines 775–790)
 *   - getFiberDisplayName        (lines 792–794)
 *   - functionSourcePreview      (lines 796–803)
 *   - getFiberSource             (lines 805–813)
 *   - summarizeFunctionContract  (lines 815–826)
 *   - evalFiberPropContract      (lines 828–848)
 *   - evalFiberInvoke            (lines 850–880)
 *
 * Fixes vs the shim:
 *   1. `value.apply(null, args)` → `value.apply(thisArg, args)` where thisArg is
 *      `fiber.stateNode` for class components and `undefined` otherwise.
 *   2. Wrap `apply` in try/catch and return `{ ok: false, error, threw: true }`.
 *      A throwing user callback must not hang the bridge.
 *   3. If the return value is a thenable, await it with a timeout and serialize
 *      the resolved value.
 */

import { getFiberSource as readFiberSource } from './fiber-source';

export type Fiber = {
  tag?: number;
  type?: { displayName?: string; name?: string } | unknown;
  stateNode?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  _debugStack?: unknown;
  [key: string]: unknown;
};

export type NormalizeRememberedFiberId = (raw: unknown) => string | null;
export type GetRememberedFiber = (id: string) => Fiber | null;
export type SafeSerialize = (value: unknown, depth?: number, seen?: Set<unknown>) => unknown;

export type ReadFiberPropResult =
  | { ok: true; fiberId: string; fiber: Fiber; props: Record<string, unknown>; propName: string; value: unknown; error?: undefined }
  | { ok: false; error: string; fiberId?: string; fiber?: Fiber; props?: Record<string, unknown> };

export interface FiberInvokeDeps {
  normalizeRememberedFiberId: NormalizeRememberedFiberId;
  getRememberedFiber: GetRememberedFiber;
  safeSerialize: SafeSerialize;
  /** Optional. Default 2000ms. Promise resolution timeout for async callbacks. */
  awaitTimeoutMs?: number;
}

// Invocation is the explicitly active bridge capability. Its caller must
// prove the prop is callable first; this module still rechecks the contract so
// stale fiber IDs and changing props fail as a structured result rather than
// turning an inspection command into an unhandled page exception.

const REACT_TAG_CLASS_COMPONENT = 1;

export function readFiberProp(
  fiberId: unknown,
  propName: unknown,
  deps: Pick<FiberInvokeDeps, 'normalizeRememberedFiberId' | 'getRememberedFiber'>,
): ReadFiberPropResult {
  const rememberedFiberId = deps.normalizeRememberedFiberId(fiberId);
  if (!rememberedFiberId) return { ok: false, error: 'fiberId is required' };
  const name = String(propName || '').trim();
  if (!name) return { ok: false, error: 'propName is required' };
  const fiber = deps.getRememberedFiber(rememberedFiberId);
  if (!fiber) return { ok: false, error: `fiber ${rememberedFiberId} not found`, fiberId: rememberedFiberId };
  const props = fiber.memoizedProps;
  if (!props || typeof props !== 'object') {
    return { ok: false, error: `fiber ${rememberedFiberId} has no props`, fiberId: rememberedFiberId, fiber };
  }
  if (!(name in props)) {
    return { ok: false, error: `prop ${name} not found on fiber ${rememberedFiberId}`, fiberId: rememberedFiberId, fiber, props: props as Record<string, unknown> };
  }
  return { ok: true, fiberId: rememberedFiberId, fiber, props: props as Record<string, unknown>, propName: name, value: (props as Record<string, unknown>)[name] };
}

export function getFiberDisplayName(fiber: Fiber | null | undefined): string {
  const type = fiber?.type as { displayName?: string; name?: string } | undefined;
  return (type && (type.displayName || type.name)) || 'Unknown';
}

export function functionSourcePreview(fn: unknown, max = 800): string | null {
  try {
    const source = Function.prototype.toString.call(fn);
    return source.length > max ? source.slice(0, max) + '…' : source;
  } catch (_e) {
    return null;
  }
}

export function getFiberSource(fiber: Fiber | null | undefined): { fileName: string | null; lineNumber: number | null; columnNumber: number | null } | null {
  return readFiberSource(fiber);
}

export function summarizeFunctionContract(value: unknown): { propType: string; isFunction: boolean; fnLength: number | null; fnName: string | null; fnSourcePreview: string | null } {
  if (typeof value !== 'function') {
    return { propType: typeof value, isFunction: false, fnLength: null, fnName: null, fnSourcePreview: null };
  }
  return {
    propType: 'function',
    isFunction: true,
    fnLength: Number.isFinite((value as { length: number }).length) ? (value as { length: number }).length : null,
    fnName: (value as { name?: string }).name || null,
    fnSourcePreview: functionSourcePreview(value),
  };
}

export function evalFiberPropContract(
  fiberId: unknown,
  propName: unknown,
  deps: Pick<FiberInvokeDeps, 'normalizeRememberedFiberId' | 'getRememberedFiber'>,
): unknown {
  const read = readFiberProp(fiberId, propName, deps);
  if (!read.ok) {
    const fiberName = read.fiber ? getFiberDisplayName(read.fiber) : null;
    return { ok: false, error: read.error, fiberId: read.fiberId, fiberName, propNames: read.props ? Object.keys(read.props) : [] };
  }
  const propNames = Object.keys(read.props);
  const contract = summarizeFunctionContract(read.value);
  return {
    ok: true,
    fiberId: read.fiberId,
    fiberName: getFiberDisplayName(read.fiber),
    source: getFiberSource(read.fiber),
    propName: read.propName,
    propNames,
    ...contract,
    nextStep: contract.isFunction
      ? 'Read the component/owner source to determine the callback argument contract before fiber-invoke.'
      : 'This prop is not callable; do not fiber-invoke it.',
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';
}

function pickThisArg(fiber: Fiber): unknown {
  if (fiber.tag === REACT_TAG_CLASS_COMPONENT && fiber.stateNode != null) {
    return fiber.stateNode;
  }
  return undefined;
}

export async function evalFiberInvoke(
  fiberId: unknown,
  propName: unknown,
  args: unknown,
  deps: FiberInvokeDeps,
): Promise<unknown> {
  const read = readFiberProp(fiberId, propName, deps);
  if (!read.ok) {
    const fiberName = read.fiber ? getFiberDisplayName(read.fiber) : null;
    return { ok: false, error: read.error, fiberId: read.fiberId, fiberName };
  }
  const value = read.value;
  if (typeof value !== 'function') {
    return {
      ok: false,
      error: `prop ${read.propName} is not a function`,
      fiberId: read.fiberId,
      fiberName: getFiberDisplayName(read.fiber),
      propName: read.propName,
      propType: typeof value,
    };
  }
  const invokeArgs = Array.isArray(args) ? args : [];
  const thisArg = pickThisArg(read.fiber);
  let result: unknown;
  try {
    result = (value as (...a: unknown[]) => unknown).apply(thisArg, invokeArgs);
  } catch (e) {
    const err = e as { message?: string; stack?: string };
    return {
      ok: false,
      error: err?.message || String(e),
      stack: err?.stack || null,
      threw: true,
      fiberId: read.fiberId,
      fiberName: getFiberDisplayName(read.fiber),
      propName: read.propName,
      propType: 'function',
      args: deps.safeSerialize(invokeArgs, 0, new Set()),
    };
  }

  const base = {
    ok: true as const,
    fiberId: read.fiberId,
    fiberName: getFiberDisplayName(read.fiber),
    propName: read.propName,
    propType: 'function' as const,
    fnLength: Number.isFinite((value as { length: number }).length) ? (value as { length: number }).length : null,
    invoked: true as const,
    args: deps.safeSerialize(invokeArgs, 0, new Set()),
  };

  if (isThenable(result)) {
    const timeoutMs = Math.max(1, Math.min(30000, deps.awaitTimeoutMs ?? 2000));
    try {
      const resolved = await Promise.race([
        Promise.resolve(result),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`async callback did not resolve within ${timeoutMs}ms`)), timeoutMs)),
      ]);
      return { ...base, async: true, returnValue: deps.safeSerialize(resolved, 0, new Set()) };
    } catch (e) {
      const err = e as { message?: string; stack?: string };
      return {
        ok: false,
        async: true,
        error: err?.message || String(e),
        stack: err?.stack || null,
        threw: false,
        rejected: true,
        fiberId: read.fiberId,
        fiberName: getFiberDisplayName(read.fiber),
        propName: read.propName,
        propType: 'function',
        args: deps.safeSerialize(invokeArgs, 0, new Set()),
      };
    }
  }

  return { ...base, async: false, returnValue: deps.safeSerialize(result, 0, new Set()) };
}
