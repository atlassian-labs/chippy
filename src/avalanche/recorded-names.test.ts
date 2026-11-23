import { describe, expect, it } from 'vitest';
import { applyRecordedRenames, createNameLedger } from './recorded-names';

type Fiber = { type: string };

// Types are strings; `runtime` is what the page names them before recovery.
function setup(runtime: Record<string, string>) {
  const recovered = new Map<string, string>();
  const ledger = createNameLedger<Fiber, string>({
    componentName: (fiber) => recovered.get(fiber.type) ?? runtime[fiber.type],
    typeOf: (fiber) => fiber.type,
    nameOf: (type) => recovered.get(type) ?? runtime[type],
    minifiedNameOf: (type) => (recovered.has(type) ? runtime[type] : null),
  });
  return { ledger, recovered };
}

describe('createNameLedger', () => {
  it('translates a written name once its type has an authored name', () => {
    const { ledger, recovered } = setup({ item: 'Qr', list: 'Kt' });
    expect(ledger.nameOf({ type: 'item' })).toBe('Qr');
    ledger.nameOf({ type: 'list' });
    expect(ledger.types(['Qr'])).toEqual(['item']);
    expect(ledger.update()).toEqual(new Map());

    recovered.set('item', 'Item');
    expect(ledger.update()).toEqual(new Map([['Qr', 'Item']]));
    // Each written name is translated once.
    expect(ledger.update()).toEqual(new Map());
    expect(ledger.renames()).toEqual([{ name: 'Item', minifiedName: 'Qr' }]);
  });

  it('keeps a written name whose types recovered different names', () => {
    // Two bundles minified different components to the same name.
    const { ledger, recovered } = setup({ star: 'a', heart: 'a' });
    ledger.nameOf({ type: 'star' });
    ledger.nameOf({ type: 'heart' });
    recovered.set('star', 'StarIcon');
    expect(ledger.update()).toEqual(new Map());
    recovered.set('heart', 'HeartIcon');
    expect(ledger.update()).toEqual(new Map());
    expect(ledger.renames()).toEqual([
      { name: 'StarIcon', minifiedName: 'a' },
      { name: 'HeartIcon', minifiedName: 'a' },
    ]);
  });

  it('notes names written for a type without a fiber', () => {
    const { ledger, recovered } = setup({ spinner: 'Zt' });
    ledger.note('Zt', 'spinner');
    recovered.set('spinner', 'Spinner');
    expect(ledger.update()).toEqual(new Map([['Zt', 'Spinner']]));
  });

  it('forgets everything on reset', () => {
    const { ledger } = setup({ item: 'Qr' });
    ledger.nameOf({ type: 'item' });
    ledger.reset();
    expect(ledger.types()).toEqual([]);
    expect(ledger.renames()).toEqual([]);
  });
});

describe('applyRecordedRenames', () => {
  it('replaces written names in every stored place', () => {
    // Shared by an action and the commit it was linked to.
    const location = { targetFiber: { name: 'Qr', ownerStack: [{ name: 'Kt' }, { name: null }] } };
    const targets = {
      domByCommit: { 1: { changes: [{ at: 'App › Kt › Qr' }, { at: 'Qr' }, { at: '(root)' }] } },
      suspenseByCommit: { 2: [{ location: { fallback: 'Qr', chain: [{ name: 'Kt' }, { name: 'App' }] } }, {}] },
      screenByCommit: { 3: { regions: [{ label: 'Qr' }, { label: 'App' }] } },
      perfEntries: [
        { sources: [{ component: 'Qr' }, null], target: { component: 'Kt' }, element: null },
        { target: { component: null } },
      ],
      unmountSamples: [[{ name: 'Qr' }], null],
      interactionLocations: [location, location, null, { targetFiber: null }],
    };
    const changed = applyRecordedRenames(targets, new Map([['Qr', 'Item'], ['Kt', 'List']]));
    expect(targets.domByCommit[1].changes.map((change) => change.at)).toEqual(['App › List › Item', 'Item', '(root)']);
    expect(targets.suspenseByCommit[2][0].location).toEqual({ fallback: 'Item', chain: [{ name: 'List' }, { name: 'App' }] });
    expect(targets.screenByCommit[3].regions.map((region) => region.label)).toEqual(['Item', 'App']);
    expect(targets.perfEntries[0]).toEqual({ sources: [{ component: 'Item' }, null], target: { component: 'List' }, element: null });
    expect(targets.unmountSamples[0]).toEqual([{ name: 'Item' }]);
    expect(location.targetFiber).toEqual({ name: 'Item', ownerStack: [{ name: 'List' }, { name: null }] });
    expect(changed).toBe(11);
  });

  it('changes nothing for an empty table', () => {
    const targets = { domByCommit: { 1: { changes: [{ at: 'Qr' }] } } };
    expect(applyRecordedRenames(targets, new Map())).toBe(0);
    expect(targets.domByCommit[1].changes[0].at).toBe('Qr');
  });
});
