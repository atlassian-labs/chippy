import { afterEach, describe, expect, it } from 'vitest';
import { buildRoot, cls, comp, div, suspense } from '../../chippy-bridge/script-kit/test-fibers';
import { labelFiber } from '../../layout-lab/marker-context';
import { resetPlugins } from '../index';
import { parsePack, registerPack, resetPacks } from './index';
import { compileLabels } from './labels';
import type { PackLabelRule } from './spec';

class Catcher {
  static getDerivedStateFromError() { return {}; }
}

afterEach(() => {
  resetPacks();
  resetPlugins();
});

const named = (name: string) => ({ [name]: function () { return null; } })[name];

describe('pack labels', () => {
  it.each([
    [{ for: '', value: 'name' }, /labels\[0\]\.for/],
    [{ for: 'suspense', from: 'up', value: 'name' }, /from/],
    [{ for: 'suspense', from: 'parents', value: 'name' }, /match/],
    [{ for: 'suspense', from: 'parents', match: { names: ['X'] }, within: 0, value: 'name' }, /within/],
    [{ for: 'suspense', from: 'parents', match: { names: ['X'] }, within: 11, value: 'name' }, /within/],
    [{ for: 'suspense', value: 'state.x' }, /value/],
    [{ for: 'suspense', value: 'name', extra: 1 }, /extra/],
  ])('rejects %j', (rule, message) => {
    expect(() => parsePack({ id: 'x', labels: [rule] })).toThrow(message);
  });

  it('reads the fiber itself, a component above, or one below', () => {
    const root = buildRoot([
      comp('Section', [
        suspense([div([0, 0, 1, 1])]),
        cls(Catcher, [comp('Inner', [comp('Mark___tile___profile', [div([0, 0, 1, 1])])])]),
      ], { props: { name: 'main-section' } }),
      suspense([], false),
    ]);
    (root.hostRoot.child!.sibling as { memoizedProps: object }).memoizedProps = { region: 'footer' };
    const label = compileLabels([
      { for: 'suspense', value: 'props.region' },
      { for: 'suspense', from: 'parents', match: { names: ['Section'] }, value: 'props.name' },
      {
        for: 'error',
        from: 'children',
        match: { pattern: '^Mark___' },
        within: 2,
        nameParts: { separator: '___', keys: ['marker', 'type', 'name'] },
        value: 'parts.name',
      },
    ])!;
    const section = root.byName('Section');
    expect(label(section.child!, 'suspense')).toBe('main-section');
    expect(label(root.hostRoot.child!.sibling!, 'suspense')).toBe('footer');
    expect(label(section.child!.sibling!, 'error')).toBe('profile');
    expect(label(section.child!.sibling!, 'component')).toBeNull();
  });

  it('stops at within, counting named components only', () => {
    const root = buildRoot([
      comp('Far', [comp('Near', [div([0, 0, 1, 1], [div([0, 0, 1, 1], [suspense([])])])])], { props: { name: 'far' } }),
    ]);
    const target = root.byName('Near').child!.child!.child!;
    const rule = (within: number): PackLabelRule => ({ for: 'suspense', from: 'parents', match: { names: ['Far'] }, within, value: 'props.name' });
    expect(compileLabels([rule(1)])!(target, 'suspense')).toBeNull();
    expect(compileLabels([rule(2)])!(target, 'suspense')).toBe('far');
  });

  it('labels fibers through a registered pack, including its own kinds', () => {
    registerPack({
      id: 'regions',
      components: [{ kind: 'region', match: { pattern: '^Region___' } }],
      labels: [
        { for: 'region', nameParts: { separator: '___', keys: ['marker', 'name'] }, value: 'parts.name' },
        { for: 'suspense', from: 'parents', match: { pattern: '^Region___' }, nameParts: { separator: '___', keys: ['marker', 'name'] }, value: 'parts.name' },
      ],
    });
    const root = buildRoot([{ tag: 0, type: named('Region___sidebar'), children: [suspense([])] }]);
    const region = root.hostRoot.child!;
    expect(labelFiber(region, 'component')).toBe('sidebar');
    expect(labelFiber(region.child!, 'suspense')).toBe('sidebar');
    expect(labelFiber(region.child!, 'error')).toBeNull();
  });
});
