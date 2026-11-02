import { afterEach, describe, expect, it } from 'vitest';
import type { Fiber } from './fiber-walk';
import {
  type ContextProvider,
  collectContextFibers,
  describeContext,
  findBoundaryFibers,
  getContextProviders,
  registerContextProvider,
} from './marker-context';

const cleanups: Array<() => void> = [];
function register(provider: ContextProvider) {
  cleanups.push(registerContextProvider(provider));
}
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const regionProvider: ContextProvider = {
  id: 'region',
  kinds: [{ kind: 'region', label: 'region', accent: '#123456' }],
  describe(fibers) {
    const index = fibers.findIndex((fiber) => (fiber.type as { name?: string })?.name === 'Region');
    if (index < 0) return null;
    return {
      boundaries: { region: { name: 'main', distance: index } },
      titles: { region: 'main' },
      fields: { region: [{ label: 'zone', value: 'a' }, { label: 'empty', value: '' }] },
      extra: { regionName: 'main' },
    };
  },
  matchBoundary: (fiber) => ((fiber.type as { name?: string })?.name === 'Region' ? 'region' : null),
};

describe('marker-context', () => {
  it('reports generic Error and Suspense boundaries with no provider registered', () => {
    const suspense: Fiber = { tag: 13, type: null } as unknown as Fiber;
    const probed: Fiber = { type: { name: 'Leaf' }, return: suspense };
    expect(describeContext(probed)).toEqual({
      boundaries: { error: null, suspense: { componentName: 'Suspense', distance: 1 } },
      display: { kinds: [], titles: {}, fields: {}, showError: false },
      providers: [],
    });
  });

  it('returns null for a tree with no boundaries', () => {
    expect(describeContext({ type: { name: 'GenericButton' } })).toBeNull();
  });

  it('reaches a Suspense boundary that is deeper than 80 fibers', () => {
    const suspense: Fiber = { tag: 13, type: null } as unknown as Fiber;
    let head: Fiber = suspense;
    for (let i = 0; i < 170; i += 1) head = { type: { name: `Filler${i}` }, return: head };
    const probed: Fiber = { type: { name: 'Leaf' }, return: head };
    expect(describeContext(probed)?.boundaries.suspense).toEqual({ componentName: 'Suspense', distance: 171 });
  });

  it('merges a provider contribution: kinds, titles, non-empty fields, extra', () => {
    register(regionProvider);
    const region: Fiber = { type: { name: 'Region' } };
    const probed: Fiber = { type: { name: 'Leaf' }, return: region };
    expect(describeContext(probed)).toEqual({
      regionName: 'main',
      boundaries: { error: null, suspense: null, region: { name: 'main', distance: 1 } },
      display: {
        kinds: [{ kind: 'region', label: 'region', accent: '#123456' }],
        titles: { region: 'main' },
        fields: { region: [{ label: 'zone', value: 'a' }] },
        showError: false,
      },
      providers: ['region'],
    });
  });

  it('merges error enrichment onto the generic error boundary and keeps its distance', () => {
    register({ id: 'enrich', describe: () => ({ errorEnrichment: { team: 't', distance: 99 } }) });
    const boundary: Fiber = { type: { name: 'ErrorBoundary', prototype: { componentDidCatch() {} } } };
    const probed: Fiber = { type: { name: 'Leaf' }, return: boundary };
    const error = describeContext(probed)?.boundaries.error;
    expect(error).toMatchObject({ team: 't', distance: 1 });
  });

  it('ignores boundaries of undeclared kinds and survives a throwing provider', () => {
    register({ id: 'sneaky', describe: () => ({ boundaries: { suspense: { distance: 0 } } }) });
    register({ id: 'broken', describe: () => { throw new Error('boom'); } });
    expect(describeContext({ type: { name: 'GenericButton' } })).toBeNull();
  });

  it('rejects core kinds and replaces a provider registered again by id', () => {
    expect(() => registerContextProvider({ id: 'x', kinds: [{ kind: 'error', label: 'e' }], describe: () => null })).toThrow(TypeError);
    register(regionProvider);
    register({ ...regionProvider, kinds: [{ kind: 'region', label: 'zone' }] });
    expect(getContextProviders()).toEqual([{ id: 'region', kinds: [{ kind: 'region', label: 'zone' }] }]);
  });

  it('unregisters a provider', () => {
    const unregister = registerContextProvider(regionProvider);
    unregister();
    expect(getContextProviders()).toEqual([]);
  });

  it('findBoundaryFibers returns core and provider boundary fibers', () => {
    register(regionProvider);
    const suspense: Fiber = { tag: 13, type: null } as unknown as Fiber;
    const region: Fiber = { type: { name: 'Region' }, return: suspense };
    const probed: Fiber = { type: { name: 'Leaf' }, return: region };
    expect(findBoundaryFibers(probed)).toEqual({ error: null, suspense, region });
  });

  it('bounds cyclic parent paths', () => {
    const fiber: Fiber = { type: { name: 'GenericButton' } };
    fiber.return = fiber;
    expect(collectContextFibers(fiber)).toEqual([fiber]);
  });
});
