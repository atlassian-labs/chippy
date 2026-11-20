import { afterEach, describe, expect, it } from 'vitest';
import { createAvalancheHookRunner, resetAvalancheHooks } from '../../avalanche/avalanche-hooks';
import type { Fiber } from '../../layout-lab/fiber-walk';
import { describeContext, getContextProviders } from '../../layout-lab/marker-context';
import { listPlugins, registerPlugin, resetPlugins } from '../index';
import { listPacks, parsePack, registerPack, registerPacks, resetPacks, unregisterPack } from './index';

// A neutral example pack. Product packs live with their products, not in Chippy.
const regionPack = {
  id: 'regions',
  label: 'Region marks and app counters',
  instructions: 'A `region` boundary names the owning area. `hooks["regions.counters"].steps[commitId]` is the counter change in that commit.',
  components: [
    {
      kind: 'region',
      accent: '#0c66e4',
      match: { names: ['RegionMark'], pattern: '^Region___' },
      nameParts: { separator: '___', keys: ['marker', 'name', 'package'] },
      title: ['parts.name', 'props.name', 'name'],
      data: { name: ['parts.name', 'props.name'], packageName: 'parts.package', teamName: 'props.teamName' },
      fields: [{ label: 'team', value: 'props.teamName' }],
    },
    {
      kind: 'error',
      match: { names: ['AppErrorBoundary'] },
      data: { id: 'props.id', teamName: 'props.teamName' },
      fields: [
        { label: 'team', value: 'props.teamName' },
        { label: 'id', value: 'props.id' },
      ],
    },
    { kind: 'error', match: { pattern: 'ErrorView$' }, title: 'name', showError: true },
  ],
  avalancheExtensions: {
    counters: {
    onStart: 'var m = window.__APP_COUNTERS; ctx.state.last = m ? Object.assign({}, m) : null; ctx.state.total = {}; return { available: !!m };',
    onStep:
      'var m = window.__APP_COUNTERS; if (!m) return; var last = ctx.state.last || {}; var delta = {}; for (var k in m) { var d = m[k] - (last[k] || 0); if (d) { delta[k] = d; ctx.state.total[k] = (ctx.state.total[k] || 0) + d; } } ctx.state.last = Object.assign({}, m); return delta;',
    onEnd: 'return { commits: ctx.commits, total: ctx.state.total || {} };',
    },
  },
};

type CounterWindow = { __APP_COUNTERS?: Record<string, number> };

afterEach(() => {
  resetPacks();
  resetPlugins();
  resetAvalancheHooks();
  delete (window as CounterWindow).__APP_COUNTERS;
});

describe('parsePack', () => {
  it('accepts JSON text', () => {
    expect(parsePack(JSON.stringify(regionPack)).id).toBe('regions');
  });

  it.each([
    [{ id: 'Bad' }, /id/],
    [{ id: 'x', extra: 1 }, /extra/],
    [{ id: 'x', components: [{ kind: 'k', match: {}, title: 'name' }] }, /match/],
    [{ id: 'x', components: [{ kind: 'k', match: { names: ['K'] }, title: 'nope.x' }] }, /title/],
    [{ id: 'x', components: [{ kind: 'k', match: { pattern: '(' } }] }, /pattern/],
    [{ id: 'x', components: [{ kind: 'suspense', match: { names: ['S'] } }] }, /suspense/],
    [{ id: 'x', avalancheExtensions: { a: { onStep: 1 } } }, /avalancheExtensions\.a\.onStep/],
    [{ id: 'x', avalancheExtensions: { Bad: {} } }, /name must match/],
    [{ id: 'x', avalancheExtensions: { a: { onTick: 'x' } } }, /onTick/],
    [{ id: 'x', avalanche: {} }, /avalanche/],
  ])('rejects %j', (input, message) => {
    expect(() => parsePack(input)).toThrow(message);
  });
});

describe('pack component rules', () => {
  it('reads an encoded display name as a new boundary kind', () => {
    registerPack(regionPack);
    const mark: Fiber = { type: { displayName: 'Region___Checkout___@shop/checkout' }, memoizedProps: { teamName: 'payments' } };
    const leaf: Fiber = { type: { name: 'Button' }, return: { type: { name: 'Body' }, return: mark } };
    const context = describeContext(leaf);
    expect(context?.boundaries.region).toEqual({
      distance: 2,
      componentName: 'Region___Checkout___@shop/checkout',
      name: 'Checkout',
      packageName: '@shop/checkout',
      teamName: 'payments',
    });
    expect(context?.display.kinds).toEqual([{ kind: 'region', label: 'region', accent: '#0c66e4' }]);
    expect(context?.display.titles.region).toBe('Checkout');
    expect(context?.display.fields.region).toEqual([{ label: 'team', value: 'payments' }]);
    expect(context?.providers).toEqual(['regions']);
  });

  it('enriches the error boundary and flags an error view', () => {
    registerPack(regionPack);
    const boundary: Fiber = { type: { name: 'AppErrorBoundary' }, memoizedProps: { id: 'checkout.form', teamName: 'payments' } };
    const error: Fiber = { type: { name: 'CheckoutErrorView' }, return: boundary };
    const context = describeContext(error);
    expect(context?.boundaries.error).toMatchObject({ componentName: 'AppErrorBoundary', id: 'checkout.form', teamName: 'payments' });
    expect(context?.display.showError).toBe(true);
    expect(context?.display.fields.error).toEqual([
      { label: 'team', value: 'payments' },
      { label: 'id', value: 'checkout.form' },
    ]);
  });
});

describe('registerPack', () => {
  it('lists the pack with its instructions and enables it', () => {
    const status = registerPack(regionPack);
    expect(status).toMatchObject({
      id: 'regions',
      kinds: ['region'],
      extensions: [{ name: 'counters', reportKey: 'regions.counters', scripts: ['onStart', 'onStep', 'onEnd'] }],
      compileErrors: [],
      initErrors: [],
    });
    expect(status.instructions).toBe(regionPack.instructions);
    expect(listPlugins()).toContainEqual({ id: 'regions', label: regionPack.label, enabled: true });
    expect(listPacks().map((pack) => pack.id)).toEqual(['regions']);
  });

  it('replaces a registered plugin with the same id', () => {
    registerPlugin({ id: 'gate', label: 'Feature gates', contextProvider: { id: 'gate', describe: () => null } });
    registerPack({ id: 'gate', label: 'override', components: [{ kind: 'area', match: { names: ['Area'] } }] });
    expect(listPlugins().find((plugin) => plugin.id === 'gate')).toEqual({ id: 'gate', label: 'override', enabled: true });
    const providers = getContextProviders().filter((provider) => provider.id === 'gate');
    expect(providers).toHaveLength(1);
    expect(providers[0].kinds).toEqual([{ kind: 'area', label: 'area' }]);
  });

  it('loads several packs, keeps going past a bad one, and unloads by id', () => {
    const results = registerPacks([{ id: 'one' }, { id: 'Nope' }, { id: 'two', instructions: 'read me' }]);
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
    expect(listPacks().map((pack) => pack.id)).toEqual(['one', 'two']);
    expect(unregisterPack('one')).toBe(true);
    expect(unregisterPack('one')).toBe(false);
    expect(listPacks().map((pack) => pack.id)).toEqual(['two']);
  });

  it('runs pack scripts as per-commit counter deltas', () => {
    const counters = { mounts: 1, updates: 0 };
    (window as CounterWindow).__APP_COUNTERS = counters;
    registerPack(regionPack);
    const runner = createAvalancheHookRunner();
    runner.start();
    counters.updates = 3;
    runner.step({ id: 1, components: 3, startTime: 0, endTime: 1, root: {} as never });
    counters.updates = 4;
    counters.mounts = 3;
    runner.step({ id: 2, components: 3, startTime: 1, endTime: 2, root: {} as never });
    const result = runner.collect()!['regions.counters'];
    expect(result.instructions).toBe(regionPack.instructions);
    expect(result.start).toEqual({ available: true });
    expect(result.steps).toEqual({ 1: { updates: 3 }, 2: { updates: 1, mounts: 2 } });
    expect(result.end).toEqual({ commits: 2, total: { updates: 4, mounts: 2 } });
  });

  it('runs onInit once at registration so a pack creates the globals it reads', () => {
    const status = registerPack({
      ...regionPack,
      avalancheExtensions: {
        counters: { ...regionPack.avalancheExtensions.counters, onInit: 'window.__APP_COUNTERS = window.__APP_COUNTERS || { mounts: 0 }; window.__INIT_ID = ctx.id;' },
      },
    });
    expect(status.extensions[0].scripts).toEqual(['onInit', 'onStart', 'onStep', 'onEnd']);
    expect(status.initErrors).toEqual([]);
    expect((window as CounterWindow).__APP_COUNTERS).toEqual({ mounts: 0 });
    expect((window as { __INIT_ID?: string }).__INIT_ID).toBe('regions.counters');

    const runner = createAvalancheHookRunner();
    runner.start();
    (window as CounterWindow).__APP_COUNTERS!.mounts = 2;
    runner.step({ id: 1, components: 2, startTime: 0, endTime: 1, root: {} as never });
    expect(runner.collect()!['regions.counters']).toMatchObject({ start: { available: true }, steps: { 1: { mounts: 2 } } });
    delete (window as { __INIT_ID?: string }).__INIT_ID;
  });

  it('records an onInit failure and still registers the pack', () => {
    const status = registerPack({ id: 'init-fails', avalancheExtensions: { slot: { onInit: 'throw new Error("no slot")' } } });
    expect(status.initErrors).toEqual(['init-fails.slot: Error: no slot']);
    expect(listPacks().map((pack) => pack.id)).toEqual(['init-fails']);
  });

  it('composes named extensions with separate state, results, and instructions', () => {
    registerPack({
      id: 'combo',
      instructions: 'pack-level guide',
      avalancheExtensions: {
        a: { instructions: 'a counts commits', onStart: 'ctx.state.n = 0;', onStep: 'ctx.state.n += 1; return ctx.state.n;' },
        b: { onStep: 'if (ctx.commit.id === 1) throw new Error("b failed"); return "ok";' },
      },
    });
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step({ id: 1, components: 1, startTime: 0, endTime: 1, root: {} as never });
    runner.step({ id: 2, components: 1, startTime: 1, endTime: 2, root: {} as never });
    const result = runner.collect()!;
    expect(Object.keys(result)).toEqual(['combo.a', 'combo.b']);
    expect(result['combo.a']).toMatchObject({ instructions: 'a counts commits', steps: { 1: 1, 2: 2 }, errorCount: 0 });
    expect(result['combo.b']).toMatchObject({ instructions: 'pack-level guide', steps: { 2: 'ok' }, errorCount: 1 });
    unregisterPack('combo');
    expect(runner.collect()).toBeNull();
  });

  it('reports a script that does not compile from its phase', () => {
    const status = registerPack({ id: 'broken', avalancheExtensions: { x: { onStep: 'return (' } } });
    expect(status.compileErrors[0]).toMatch(/^broken\.x onStep did not compile/);
    const runner = createAvalancheHookRunner();
    runner.start();
    runner.step({ id: 1, components: 1, startTime: 0, endTime: 1, root: {} as never });
    expect(runner.collect()!['broken.x'].errors[0].message).toMatch(/onStep did not compile/);
  });
});
