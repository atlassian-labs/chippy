import { describe, expect, it } from 'vitest';
import { collectOwnerFibers, isComponentFiber } from './owner-chain';

type F = { type?: unknown; _debugOwner?: F | null; return?: F | null; id: string };

const always = () => true;

describe('collectOwnerFibers', () => {
  it('returns an empty owner chain for a missing fiber', () => {
    expect(collectOwnerFibers<F>(null, always)).toEqual({ ownerStackKind: 'owners', fibers: [] });
  });

  it('prefers the debug-owner chain when it yields fibers', () => {
    const owner: F = { id: 'owner', _debugOwner: null };
    const parent: F = { id: 'parent' };
    const fiber: F = { id: 'self', _debugOwner: owner, return: parent };
    expect(collectOwnerFibers(fiber, always)).toEqual({ ownerStackKind: 'owners', fibers: [owner] });
  });

  it('falls back to the parent chain when the debug-owner chain is absent', () => {
    const root: F = { id: 'root' };
    const parent: F = { id: 'parent', return: root };
    const fiber: F = { id: 'self', return: parent };
    expect(collectOwnerFibers(fiber, always)).toEqual({ ownerStackKind: 'parents', fibers: [parent, root] });
  });

  it('falls back when every debug owner is filtered out', () => {
    const hostOwner: F = { id: 'host', type: 'div' };
    const parent: F = { id: 'parent', type: function Parent() {} };
    const fiber: F = { id: 'self', _debugOwner: hostOwner, return: parent };
    expect(collectOwnerFibers(fiber, isComponentFiber)).toEqual({ ownerStackKind: 'parents', fibers: [parent] });
  });

  it('labels an empty result by whether the build records debug owners', () => {
    expect(collectOwnerFibers<F>({ id: 'dev-root', _debugOwner: null }, isComponentFiber))
      .toEqual({ ownerStackKind: 'owners', fibers: [] });
    expect(collectOwnerFibers<F>({ id: 'prod-root' }, isComponentFiber))
      .toEqual({ ownerStackKind: 'parents', fibers: [] });
  });

  it('passes the chain kind to the filter and honors the limit', () => {
    const kinds: string[] = [];
    const a: F = { id: 'a' };
    const b: F = { id: 'b', return: a };
    const fiber: F = { id: 'self', return: b };
    const out = collectOwnerFibers(fiber, (_f, kind) => { kinds.push(kind); return true; }, 1);
    expect(out.fibers).toEqual([b]);
    expect(kinds).toEqual(['parents']);
  });
});

describe('isComponentFiber', () => {
  it('accepts functions and wrapper objects, rejects host and typeless fibers', () => {
    expect(isComponentFiber({ type: function Button() {} })).toBe(true);
    expect(isComponentFiber({ type: { $$typeof: Symbol.for('react.memo') } })).toBe(true);
    expect(isComponentFiber({ type: { render() {} } })).toBe(true);
    expect(isComponentFiber({ type: 'div' })).toBe(false);
    expect(isComponentFiber({})).toBe(false);
  });
});
