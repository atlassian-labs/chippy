import { describe, expect, it } from 'vitest';
import type { Fiber } from './internals';
import { describeSuspenseLocation, distinguishingLabels, isLocationProp, pickLocationProps } from './suspense-location';

type F = Fiber & { _debugOwner?: unknown; key?: unknown };

function component(name: string, props: Record<string, unknown> = {}, parent: F | null = null): F {
  const type = function () {};
  Object.defineProperty(type, 'name', { value: name });
  return { tag: 0, type, return: parent, memoizedProps: props, alternate: null, child: null, sibling: null, flags: 0, subtreeFlags: 0, lanes: 0, memoizedState: null, updateQueue: null } as unknown as F;
}

function suspense(parent: F, owner: F | null, props: Record<string, unknown> = {}): F {
  return { tag: 13, type: Symbol.for('react.suspense'), return: parent, _debugOwner: owner, memoizedProps: props } as unknown as F;
}

describe('location props', () => {
  it('keeps identifying string props and drops the rest', () => {
    expect(isLocationProp('team')).toBe(true);
    expect(isLocationProp('packageName')).toBe(true);
    expect(isLocationProp('issueId')).toBe(true);
    expect(isLocationProp('className')).toBe(false);
    expect(isLocationProp('onClick')).toBe(false);
    expect(pickLocationProps({ name: 'side-panel', count: 3, onLoad: () => {}, id: 7, team: '' })).toEqual({ name: 'side-panel', id: '7' });
  });
});

describe('describeSuspenseLocation', () => {
  it('lists five parents then owners, marking components found in both', () => {
    const app = component('App');
    const chain: F[] = [app];
    for (const name of ['Layout', 'Modal', 'Panel', 'Section', 'Wrapper', 'Extra']) chain.push(component(name, {}, chain[chain.length - 1]));
    const wrapper = chain[chain.length - 1];
    const ownerOwner = component('FeatureRoot', { packageName: 'issue-view' });
    const owner = component('Section', { name: 'details' });
    (owner as F)._debugOwner = ownerOwner;
    (wrapper as F)._debugOwner = null;
    const boundary = suspense(wrapper, owner, { fallback: { type: function Skeleton() {} } });
    const location = describeSuspenseLocation(boundary);
    expect(location.chain.slice(0, 5).map((e) => [e.via, e.name])).toEqual([
      ['parent', 'Extra'], ['parent', 'Wrapper'], ['parent', 'Section'], ['parent', 'Panel'], ['parent', 'Modal'],
    ]);
    expect(location.chain.slice(5).map((e) => [e.via, e.name, e.props])).toEqual([
      ['owner', 'Section', { name: 'details' }],
      ['owner', 'FeatureRoot', { packageName: 'issue-view' }],
    ]);
    expect(location.fallback).toBe('Skeleton');
  });

  it('lists a component once when it is both parent and owner', () => {
    const owner = component('Loader', { name: 'body' });
    const boundary = suspense(owner, owner);
    const location = describeSuspenseLocation(boundary);
    expect(location.chain).toEqual([{ via: 'both', name: 'Loader', props: { name: 'body' } }]);
  });

  it('uses the Suspense name prop when set', () => {
    expect(describeSuspenseLocation(suspense(component('A'), null, { name: 'sidebar' })).name).toBe('sidebar');
  });
});

describe('distinguishingLabels', () => {
  it('skips the shared wrapper and picks the first entry that differs', () => {
    const shared = { via: 'parent' as const, name: 'SuspenseWrapper' };
    const labels = distinguishingLabels([
      { chain: [shared, { via: 'parent', name: 'IssueModal', props: { packageName: 'issue-view' } }] },
      { chain: [shared, { via: 'parent', name: 'IssueBody' }] },
      { chain: [shared, { via: 'parent', name: 'SidePanel', props: { team: 'side' } }] },
      null,
    ]);
    expect(labels).toEqual(['IssueModal packageName=issue-view', 'IssueBody', 'SidePanel team=side', null]);
  });

  it('keeps wrapper props that tell boundaries apart', () => {
    const labels = distinguishingLabels([
      { chain: [{ via: 'parent', name: 'Boundary', props: { name: 'iv-data' } }] },
      { chain: [{ via: 'parent', name: 'Boundary', props: { name: 'iv-side' } }] },
    ]);
    expect(labels).toEqual(['Boundary name=iv-data', 'Boundary name=iv-side']);
  });
});
