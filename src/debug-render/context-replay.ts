/**
 * Best-effort Context inputs for structural hook replay.
 *
 * Values returned here are disposable execution scaffolding. They are never
 * exposed by explain-component or describe-component; they only keep product
 * guards and property reads from aborting custom-hook discovery.
 */

export type ContextFiber = {
  type?: unknown;
  elementType?: unknown;
  tag?: number;
  memoizedProps?: unknown;
  pendingProps?: unknown;
  alternate?: ContextFiber | null;
  return?: ContextFiber | null;
  dependencies?: {
    firstContext?: { context: unknown; memoizedValue: unknown; next?: unknown } | null;
  };
};

type ContextRead = { found: boolean; value: unknown };

// Custom hooks often read a context-derived object and then call or iterate
// it. Returning `undefined` would stop replay at the first such guard and lose
// ancestry for all later hooks. This proxy is intentionally disposable: it
// keeps structural discovery moving, but is never reported as product state.
const replayScaffoldingTarget = function chippyReplayScaffolding() {};
const replayScaffolding: unknown = new Proxy(replayScaffoldingTarget, {
  get(target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (descriptor && !descriptor.configurable && 'value' in descriptor && !descriptor.writable) {
      return descriptor.value;
    }
    if (property === 'then') return undefined;
    if (property === Symbol.iterator) return function* emptyReplayIterator() {};
    if (property === Symbol.toPrimitive) return () => 'chippy-replay';
    return replayScaffolding;
  },
  apply() {
    return replayScaffolding;
  },
  construct() {
    return replayScaffolding as object;
  },
});

function readContextDependency(fiber: ContextFiber | null | undefined, contextArg: unknown): ContextRead {
  let item = fiber?.dependencies?.firstContext as
    | { context: unknown; memoizedValue: unknown; next?: unknown }
    | null
    | undefined;
  while (item) {
    if (item.context === contextArg) return { found: true, value: item.memoizedValue };
    item = item.next as typeof item;
  }
  return { found: false, value: undefined };
}

function isContextProvider(fiber: ContextFiber, contextArg: unknown): boolean {
  const type = fiber.type as { _context?: unknown } | null | undefined;
  const elementType = fiber.elementType as { _context?: unknown } | null | undefined;
  return (
    fiber.tag === 10 &&
    (fiber.type === contextArg || fiber.elementType === contextArg || type?._context === contextArg || elementType?._context === contextArg)
  );
}

function readProviderValue(start: ContextFiber | null | undefined, contextArg: unknown): ContextRead {
  const seen = new Set<ContextFiber>();
  // Prefer the fiber's dependency snapshot, then walk providers. Reading the
  // global context current value first would describe the page's latest
  // provider rather than the value this committed fiber actually consumed.
  let fiber = start?.return || null;
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    if (isContextProvider(fiber, contextArg)) {
      const memoizedProps = fiber.memoizedProps as { value?: unknown } | null | undefined;
      const pendingProps = fiber.pendingProps as { value?: unknown } | null | undefined;
      if (memoizedProps && Object.prototype.hasOwnProperty.call(memoizedProps, 'value') && memoizedProps.value != null) {
        return { found: true, value: memoizedProps.value };
      }
      if (pendingProps && Object.prototype.hasOwnProperty.call(pendingProps, 'value')) {
        return { found: true, value: pendingProps.value };
      }
      if (memoizedProps && Object.prototype.hasOwnProperty.call(memoizedProps, 'value')) {
        return { found: true, value: memoizedProps.value };
      }
    }
    fiber = fiber.return || null;
  }
  return { found: false, value: undefined };
}

export function readContextValueFromFiber(fiber: ContextFiber, contextArg: unknown): unknown {
  const candidates = [fiber, fiber?.alternate || null];
  for (const candidate of candidates) {
    const dependency = readContextDependency(candidate, contextArg);
    if (dependency.found && dependency.value != null) return dependency.value;
  }
  for (const candidate of candidates) {
    const provider = readProviderValue(candidate, contextArg);
    if (provider.found && provider.value != null) return provider.value;
  }
  if (contextArg && typeof contextArg === 'object') {
    const context = contextArg as { _currentValue?: unknown; _currentValue2?: unknown };
    if (Object.prototype.hasOwnProperty.call(context, '_currentValue') && context._currentValue != null) {
      return context._currentValue;
    }
    if (Object.prototype.hasOwnProperty.call(context, '_currentValue2') && context._currentValue2 != null) {
      return context._currentValue2;
    }
  }
  return replayScaffolding;
}
