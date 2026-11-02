import { describe, it, expect, vi } from 'vitest';
import { evalDescribeComponent } from './describe-component';
import type { DescribeComponentDeps, Fiber } from './describe-component';

describe('describe-component', () => {
  // ─── Helper stubs ───────────────────────────────────────────────────────

  function createStubDeps(overrides: Partial<DescribeComponentDeps> = {}): DescribeComponentDeps {
    const fiberRegistry = new Map<string, Fiber>();
    let fiberCounter = 0;

    const defaults: DescribeComponentDeps = {
      resolveFiberTarget: (probe, fiberId, name) => {
        if (fiberId) return { fiber: fiberRegistry.get(String(fiberId)) || ({} as Fiber), resolvedBy: 'fiberId' };
        if (name) return { fiber: { type: { displayName: String(name) } } as unknown as Fiber, resolvedBy: 'name' };
        return { error: 'No fiber found' };
      },
      rememberFiber: (fiber) => {
        const id = 'fiber-' + ++fiberCounter;
        fiberRegistry.set(id, fiber);
        return id;
      },
      getRememberedFiber: (id) => fiberRegistry.get(String(id)) || null,
      evalFiberHooks: () => ({ hookCount: 0 }),
      replayComponentHooks: () => ({
        componentName: 'TestComponent',
        records: [],
        replayAttempted: false,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'not-run',
      }),
      renderTreeText: () => 'TestComponent\n',
      ...overrides,
    };
    return defaults;
  }

  // ─── Core functionality ──────────────────────────────────────────────────

  it('resolves fiber by fiberId', () => {
    const fiber = { type: { displayName: 'MyComponent' } } as unknown as Fiber;
    const deps = createStubDeps({
      resolveFiberTarget: (probe, fiberId) => {
        if (fiberId === 'fiber-1') return { fiber, resolvedBy: 'fiberId' };
        return { error: 'Not found' };
      },
    });

    const result = evalDescribeComponent('fiber-1', null, deps);
    expect(result.ok).toBe(true);
    expect(result.resolvedBy).toBe('fiberId');
    expect(result.componentName).toBe('TestComponent');
  });

  it('resolves fiber by name', () => {
    const fiber = { type: { displayName: 'MyComponent' } } as unknown as Fiber;
    const deps = createStubDeps({
      resolveFiberTarget: (probe, fiberId, name) => {
        if (name === 'MyComponent') return { fiber, resolvedBy: 'name' };
        return { error: 'Not found' };
      },
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.ok).toBe(true);
    expect(result.resolvedBy).toBe('name');
  });

  it('returns error when fiber not found', () => {
    const deps = createStubDeps({
      resolveFiberTarget: () => ({ error: 'Fiber not found' }),
    });

    const result = evalDescribeComponent('invalid-id', null, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Fiber not found');
  });

  it('includes componentName and hookCount in result', () => {
    const deps = createStubDeps({
      evalFiberHooks: () => ({ hookCount: 5 }),
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'State' },
          { index: 1, primitive: 'Effect' },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.ok).toBe(true);
    expect(result.componentName).toBe('MyComponent');
    expect(result.hookCount).toBe(5);
    expect(result.replayedHookCount).toBe(2);
  });

  it('includes source location from fiber', () => {
    const fiber = {
      type: { displayName: 'MyComponent' },
      _debugSource: { fileName: 'Component.tsx', lineNumber: 42 },
    } as unknown as Fiber;

    const deps = createStubDeps({
      resolveFiberTarget: () => ({ fiber, resolvedBy: 'name' }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.source).toEqual({ fileName: 'Component.tsx', lineNumber: 42 });
  });

  it('falls back to type._debugSource', () => {
    const fiber = {
      type: {
        displayName: 'MyComponent',
        _debugSource: { fileName: 'Component.tsx', lineNumber: 10 },
      },
    } as unknown as Fiber;

    const deps = createStubDeps({
      resolveFiberTarget: () => ({ fiber, resolvedBy: 'name' }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.source?.fileName).toBe('Component.tsx');
  });

  // ─── Replay and warnings ─────────────────────────────────────────────────

  it('warns when replay was not attempted', () => {
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [],
        replayAttempted: false,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'fiber-only',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('fiber-only'))).toBe(true);
  });

  it('warns when replay had an error', () => {
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [],
        replayAttempted: true,
        replayError: 'Hook dispatcher not available',
        replayErrorDetails: null,
        replayStatus: 'error',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('replay-error'))).toBe(true);
  });

  it('warns when no custom-hook ancestry available but hooks exist', () => {
    const deps = createStubDeps({
      evalFiberHooks: () => ({ hookCount: 3 }),
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'State' },
          { index: 1, primitive: 'State' },
          { index: 2, primitive: 'State' },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('flat-records'))).toBe(true);
  });

  it('does not warn about ancestry when hooks are from custom hooks', () => {
    const deps = createStubDeps({
      evalFiberHooks: () => ({ hookCount: 2 }),
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'State', path: [{ name: 'useCustom' }] },
          { index: 1, primitive: 'Effect', path: [{ name: 'useCustom' }] },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.warnings).not.toContainEqual(expect.stringContaining('flat-records'));
  });

  // ─── Groups and tree rendering ───────────────────────────────────────────

  it('groups records by path and calls renderTreeText', () => {
    let renderCalls = 0;
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'State', path: [] },
          { index: 1, primitive: 'Effect', path: [{ name: 'useCustom' }] },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
      renderTreeText: (componentName, source, groups) => {
        renderCalls++;
        expect(componentName).toBe('MyComponent');
        expect(groups).toHaveLength(2);
        expect(groups[0].path).toEqual([]);
        expect(groups[1].path).toEqual([{ name: 'useCustom' }]);
        return 'rendered tree';
      },
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(renderCalls).toBe(1);
    expect(result.text).toBe('rendered tree');
  });

  it('preserves replay record order when building tree groups', () => {
    // Regression: evalDescribeComponent used to pre-group by path before calling
    // renderTreeText. That moved late parent-level hooks ahead of child folders,
    // e.g. hook 101 appeared near the top of useOpenIssueTransitionModal.
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'DebugValue', path: [{ name: 'useParent', loc: 'p:1' }] },
          { index: 1, primitive: 'Ref', path: [{ name: 'useParent', loc: 'p:1' }, { name: 'useChild', loc: 'c:1' }] },
          { index: 2, primitive: 'Callback', path: [{ name: 'useParent', loc: 'p:1' }] },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
      renderTreeText: (componentName, source, groups) => {
        expect(groups.map((g) => ({ path: g.path.map((p) => p.name).join('>'), hook: g.hooks[0].hookId }))).toEqual([
          { path: 'useParent', hook: 0 },
          { path: 'useParent>useChild', hook: 1 },
          { path: 'useParent', hook: 2 },
        ]);
        return 'ordered tree';
      },
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.text).toBe('ordered tree');
  });

  it('includes hooks in groups with correct hookId and primitive', () => {
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [
          { index: 0, primitive: 'State', debugLabel: 'count', path: [] },
          { index: 1, primitive: 'Effect', debugLabel: 'effect', path: [] },
        ],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
      renderTreeText: (componentName, source, groups) => {
        expect(groups.map((g) => g.hooks[0])).toEqual([
          { hookId: 0, primitive: 'State', debugLabel: 'count' },
          { hookId: 1, primitive: 'Effect', debugLabel: 'effect' },
        ]);
        return 'rendered tree';
      },
    });

    evalDescribeComponent(null, 'MyComponent', deps);
  });

  // ─── Fiber memory management ────────────────────────────────────────────

  it('reuses fiberId if fiber already remembered', () => {
    const rememberFiber = vi.fn(() => 'fiber-existing-id');
    const getRememberedFiber = vi.fn((id) => (id === 'fiber-1' ? ({} as Fiber) : null));

    const deps = createStubDeps({ rememberFiber, getRememberedFiber });

    const result = evalDescribeComponent('fiber-1', null, deps);
    expect(result.fiberId).toBe('fiber-1');
    expect(rememberFiber).not.toHaveBeenCalled();
  });

  it('remembers fiber if fiberId not recognized', () => {
    const fiber = { type: { displayName: 'MyComponent' } } as unknown as Fiber;
    const rememberFiber = vi.fn(() => 'fiber-new-id');
    const getRememberedFiber = vi.fn(() => null);

    const deps = createStubDeps({
      rememberFiber,
      getRememberedFiber,
      resolveFiberTarget: () => ({ fiber, resolvedBy: 'name' }),
    });

    const result = evalDescribeComponent('unknown-id', null, deps);
    expect(rememberFiber).toHaveBeenCalled();
    expect(result.fiberId).toBe('fiber-new-id');
  });

  // ─── Metadata and capture status ─────────────────────────────────────────

  it('sets captureEngineOk when replay was attempted and records exist', () => {
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [{ index: 0, primitive: 'State' }],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.captureEngineOk).toBe(true);
  });

  it('sets captureEngineOk false when replay was not attempted', () => {
    const deps = createStubDeps({
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [],
        replayAttempted: false,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'fiber-only',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.captureEngineOk).toBe(false);
  });

  it('includes replayStatus and distinguishes replayed vs live hookCount', () => {
    const deps = createStubDeps({
      evalFiberHooks: () => ({ hookCount: 5 }),
      replayComponentHooks: () => ({
        componentName: 'MyComponent',
        records: [{ index: 0, primitive: 'State' }],
        replayAttempted: true,
        replayError: null,
        replayErrorDetails: null,
        replayStatus: 'success',
      }),
    });

    const result = evalDescribeComponent(null, 'MyComponent', deps);
    expect(result.liveHookCount).toBe(5);
    expect(result.replayedHookCount).toBe(1);
    expect(result.hookCount).toBe(5);
    expect(result.replayStatus).toBe('success');
  });
});
