import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fiber } from '../../layout-lab/fiber-walk';
import { describeContext, findBoundaryFibers, registerContextProvider } from '../../layout-lab/marker-context';
import { describeJiraContext, jiraContextProvider, parseOwnerMarkDisplayName } from './context-provider';

let unregister: () => void = () => {};
beforeEach(() => {
  unregister = registerContextProvider(jiraContextProvider);
});
afterEach(() => unregister());

describe('jira context provider', () => {
  it('parses Jira encoded OwnerMark display names', () => {
    expect(parseOwnerMarkDisplayName('OwnerMark___placeholder___BenefitModal___@jira/changeboarding___flag')).toEqual({
      markerName: 'OwnerMark___placeholder___BenefitModal___@jira/changeboarding___flag',
      type: 'placeholder',
      name: 'BenefitModal',
      packageName: '@jira/changeboarding',
      teamName: null,
      variant: 'flag',
      source: 'display-name',
    });
  });

  it('reads OwnershipMark fields from live props', () => {
    const fiber: Fiber = {
      type: { name: 'OwnershipMark' },
      memoizedProps: {
        type: 'feature',
        name: 'benefit-modal',
        packageName: 'jiraEocChangeboarding',
        teamName: 'alexstrasza',
        variant: 'modal',
      },
    };

    const context = describeContext(fiber);
    expect(context?.ownership).toEqual({
      markerName: 'OwnershipMark',
      type: 'feature',
      name: 'benefit-modal',
      packageName: 'jiraEocChangeboarding',
      teamName: 'alexstrasza',
      variant: 'modal',
      source: 'props',
    });
    expect(context?.display.kinds).toEqual([{ kind: 'owner', label: 'owner', accent: '#0c66e4' }]);
    expect(context?.display.titles.owner).toBe('benefit-modal');
    expect(context?.providers).toEqual(['jira']);
  });

  it('expands ErrorComponent to its nearest JSErrorBoundary props', () => {
    const boundary: Fiber = {
      type: { name: 'JSErrorBoundary' },
      memoizedProps: {
        id: 'eoc.changeboarding.benefit.modal',
        packageName: 'jiraEocChangeboarding',
        fallback: 'flag',
        teamName: 'alexstrasza',
      },
    };
    const error: Fiber = { type: { name: 'ErrorComponent' }, return: boundary };

    expect(describeJiraContext(error)).toEqual({
      ownership: null,
      errorComponent: true,
      errorBoundary: {
        componentName: 'JSErrorBoundary',
        id: 'eoc.changeboarding.benefit.modal',
        packageName: 'jiraEocChangeboarding',
        fallback: 'flag',
        teamName: 'alexstrasza',
      },
      boundaries: {
        owner: null,
        error: {
          componentName: 'JSErrorBoundary',
          detectedBy: 'name',
          id: 'eoc.changeboarding.benefit.modal',
          packageName: 'jiraEocChangeboarding',
          fallback: 'flag',
          teamName: 'alexstrasza',
          distance: 1,
        },
        suspense: null,
      },
      display: {
        kinds: [],
        titles: {},
        fields: {
          error: [
            { label: 'team', value: 'alexstrasza' },
            { label: 'id', value: 'eoc.changeboarding.benefit.modal' },
          ],
        },
        showError: true,
      },
      providers: ['jira'],
    });
  });

  it('flags a bare ErrorComponent with no boundary for display', () => {
    const context = describeContext({ type: { name: 'IssueErrorComponent' } });
    expect(context?.display).toMatchObject({ showError: true, titles: { error: 'ErrorComponent' } });
    expect(context?.boundaries.error).toBeNull();
  });

  it('uses the debug-owner path when the return path has no Jira marker', () => {
    const mark: Fiber = {
      type: { displayName: 'OwnerMark___lazy___IssueView___@jira/issue-view___default' },
    };
    const fiber: Fiber = { type: { name: 'Issue' }, _debugOwner: mark };
    expect(describeJiraContext(fiber)?.ownership).toMatchObject({ packageName: '@jira/issue-view' });
  });

  it('continues through a debug owner that also appears on the return path', () => {
    const mark: Fiber = {
      type: { displayName: 'OwnerMark___lazy___IssueView___@jira/issue-view___default' },
    };
    const sharedParent: Fiber = { type: { name: 'SharedParent' }, _debugOwner: mark };
    const fiber: Fiber = {
      type: { name: 'Issue' },
      return: sharedParent,
      _debugOwner: sharedParent,
    };
    expect(describeJiraContext(fiber)?.ownership).toMatchObject({ packageName: '@jira/issue-view' });
  });

  it('returns null for a generic component tree', () => {
    expect(describeJiraContext({ type: { name: 'GenericButton' } })).toBeNull();
  });

  it('keeps the legacy Jira fields on a Suspense-only tree', () => {
    const suspense: Fiber = { type: { name: 'Suspense' } };
    const ctx = describeJiraContext({ type: { name: 'Leaf' }, return: suspense });
    expect(ctx?.ownership).toBeNull();
    expect(ctx?.errorBoundary).toBeNull();
    expect(ctx?.boundaries.owner).toBeNull();
    expect(ctx?.boundaries.suspense?.distance).toBe(1);
  });

  it('records boundary distances as fiber hops from the probed fiber', () => {
    const suspense: Fiber = { type: { name: 'Suspense' } };
    const boundary: Fiber = {
      type: { name: 'JSErrorBoundary' },
      memoizedProps: { id: 'x.y.z' },
      return: suspense,
    };
    const owner: Fiber = {
      type: { displayName: 'OwnerMark___lazy___IssueView___@jira/issue-view___default' },
      return: boundary,
    };
    const probed: Fiber = { type: { name: 'Leaf' }, return: owner };

    const ctx = describeContext(probed);
    expect(ctx?.boundaries.owner).toMatchObject({ packageName: '@jira/issue-view', distance: 1 });
    expect(ctx?.boundaries.error).toMatchObject({ id: 'x.y.z', distance: 2 });
    expect(ctx?.boundaries.suspense).toMatchObject({ componentName: 'Suspense', distance: 3 });
  });

  it('findBoundaryFibers locates the owner, error and suspense fibers', () => {
    const suspense: Fiber = { tag: 13, type: null } as unknown as Fiber;
    const errorB: Fiber = { type: { name: 'JSErrorBoundary' }, memoizedProps: { id: 'x' }, return: suspense };
    const owner: Fiber = { type: { name: 'OwnerMark' }, return: errorB };
    const probed: Fiber = { type: { name: 'Leaf' }, return: owner };
    expect(findBoundaryFibers(probed)).toEqual({ owner, error: errorB, suspense });
  });
});
