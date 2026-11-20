import { forwardRef, memo } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAvalancheDetector } from './detector';
import { PerformedWork, type Fiber } from './internals';

const runtime = globalThis as any;
const previousHook = runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__;
let detector: ReturnType<typeof createAvalancheDetector> | null = null;

afterEach(() => {
  detector?.uninstall();
  detector = null;
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;
});

// A one-component tree whose root fiber has the given type and tag.
function setup(type: unknown, tag: number) {
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { onCommitFiberRoot: () => undefined };
  detector = createAvalancheDetector({ detectionMode: 'full', metricsAdapter: null });
  detector.install();
  const root = {
    current: {
      tag, type, elementType: type, flags: PerformedWork,
      subtreeFlags: 0, child: null, sibling: null, return: null,
      memoizedState: null, memoizedProps: {}, alternate: null,
    } as unknown as Fiber,
  };
  const commit = () => {
    root.current = { ...root.current };
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root);
  };
  return { detector, commit };
}

const renderedNames = (d: ReturnType<typeof createAvalancheDetector>) =>
  Object.values(d.report(Infinity).renderedByCommit ?? {}).flat().map((entry) => entry.name);

describe('rendered component names', () => {
  it('names forwardRef and memo components after the function they wrap', () => {
    const forwarded = setup(forwardRef(function Button() { return null; }), 11);
    forwarded.commit();
    expect(renderedNames(forwarded.detector)).toEqual(['Button']);
    forwarded.detector.uninstall();

    const memoized = setup(memo(function Card() { return null; }), 14);
    memoized.commit();
    expect(renderedNames(memoized.detector)).toEqual(['Card']);
  });

  it('renames entries recorded as Anonymous once their type has a name', () => {
    const type = forwardRef(() => null);
    const { detector, commit } = setup(type, 11);
    commit();
    commit();
    expect(renderedNames(detector)).toEqual(['Anonymous', 'Anonymous']);
    // The bridge recovers names for these types before an export.
    expect(detector.unnamedRenderedTypes()).toEqual([type]);

    // Stands in for a name recovered from the source map after the commits.
    type.displayName = 'Text';
    expect(renderedNames(detector)).toEqual(['Text', 'Text']);
    expect(detector.unnamedRenderedTypes()).toEqual([]);
  });

  it('finds the type behind an internal rendered source id', () => {
    const type = memo(() => null);
    const { detector, commit } = setup(type, 14);
    commit();
    const [entry] = Object.values(detector.report(Infinity).renderedByCommit ?? {}).flat();
    expect(entry.sourceId).toMatch(/^T\d+#1@\d+$/);
    expect(detector.componentTypesFor([entry.sourceId])).toEqual([type]);
  });

  it('gives fibers mounted before a reset ids that resolve to their own type', () => {
    const Alpha = forwardRef(() => null);
    const Beta = memo(() => null);
    const { detector } = setup(Alpha, 11);
    const fiberOf = (type: unknown, tag: number, extra: object = {}) => ({
      tag, type, elementType: type, flags: PerformedWork, subtreeFlags: PerformedWork,
      child: null, sibling: null, return: null, memoizedState: null, memoizedProps: {}, alternate: null, ...extra,
    }) as unknown as Fiber;
    const alpha = fiberOf(Alpha, 11);
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: alpha });
    detector.reset();

    // React keeps the same fiber pair across commits; Beta mounts after the reset.
    const beta = fiberOf(Beta, 14);
    const next = fiberOf(Alpha, 11, { alternate: alpha, child: beta });
    (beta as any).return = next;
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: next });

    const entries = Object.values(detector.report(Infinity).renderedByCommit ?? {}).flat();
    expect(entries).toHaveLength(2);
    const [first, second] = entries;
    expect(detector.componentTypesFor([first.sourceId])).toEqual([Alpha]);
    expect(detector.componentTypesFor([second.sourceId])).toEqual([Beta]);
  });

  it('forgets unnamed entries on reset', () => {
    const { detector, commit } = setup(forwardRef(() => null), 11);
    commit();
    detector.reset();
    expect(detector.unnamedRenderedTypes()).toEqual([]);
  });
});
