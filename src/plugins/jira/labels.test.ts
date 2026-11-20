import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRoot, cls, comp, div, suspense } from '../../chippy-bridge/script-kit/test-fibers';
import { labelFiber, registerContextProvider } from '../../layout-lab/marker-context';
import { parsePack } from '../pack/spec';
import { jiraContextProvider } from './context-provider';
import { JIRA_LABEL_RULES } from './labels';

class ErrorBoundary {
  static getDerivedStateFromError() { return {}; }
}
// A production build leaves the boundary class a one-letter name.
const i = class {
  componentDidCatch() {}
};

const named = (name: string) => ({ [name]: function () { return null; } })[name];
const mark = (name: string, children = [div([0, 0, 1, 1])]) => ({ tag: 0, type: named(name), children });

let unregister = () => {};
beforeEach(() => {
  unregister = registerContextProvider(jiraContextProvider);
});
afterEach(() => unregister());

describe('jira labels', () => {
  it('are a valid pack labels list', () => {
    expect(() => parsePack({ id: 'jira', labels: JIRA_LABEL_RULES })).not.toThrow();
  });

  it('name a lazy section from SuspenseWrapper, then from its OwnerMark', () => {
    const root = buildRoot([
      comp('SuspensePlaceholder', [
        mark('OwnerMark___placeholder___nav-top___-___-'),
        comp('SuspenseWrapper', [suspense([div([0, 0, 1, 1])])], { props: { name: 'nav-top' } }),
      ], { props: { name: 'nav-top' } }),
      mark('OwnerMark___placeholder___lazy-search___-___-'),
    ]);
    const wrapped = root.byName('SuspenseWrapper').child!;
    expect(labelFiber(wrapped, 'suspense')).toBe('nav-top');
    const bare = buildRoot([{ tag: 0, type: named('OwnerMark___placeholder___lazy-search___-___-'), children: [comp('X', [suspense([])])] }]);
    expect(labelFiber(bare.byName('X').child!, 'suspense')).toBe('lazy-search');
  });

  it('name a Suspense by its interaction, or by the named Suspense around it', () => {
    const root = buildRoot([{ ...suspense([suspense([])]), props: { interactionName: 'global-root-app-chrome' } }]);
    const outer = root.hostRoot.child!;
    expect(labelFiber(outer, 'suspense')).toBe('global-root-app-chrome');
    expect(labelFiber(outer.child!, 'suspense')).toBe('global-root-app-chrome');
  });

  it('name an error boundary from its props, its OwnerMark, or its wrapper', () => {
    const root = buildRoot([
      comp('JSErrorBoundary', [
        { ...cls(ErrorBoundary, [mark('OwnerMark___error-boundary___top-nav___jiraNavPlatLayout___-')]), props: { id: 'top-nav', packageName: 'jiraNavPlatLayout' } },
      ], { props: { id: 'top-nav' } }),
      comp('Bare', [cls(ErrorBoundary, [comp('Inner', [mark('OwnerMark___error-boundary___banner___jiraNavPlatLayout___-')])])]),
      comp('NavErrorBoundary', [comp('InnerErrorBoundary', [cls(i, [div([0, 0, 1, 1])])], { props: { location: 'app-chrome' } })]),
    ]);
    expect(labelFiber(root.byName('JSErrorBoundary').child!, 'error')).toBe('top-nav');
    expect(labelFiber(root.byName('Bare').child!, 'error')).toBe('banner');
    expect(labelFiber(root.byName('InnerErrorBoundary').child!, 'error')).toBe('app-chrome');
  });

  it('name an ownership marker by its name segment', () => {
    const root = buildRoot([mark('OwnerMark___feature___benefit-modal___@jira/changeboarding___modal')]);
    expect(labelFiber(root.hostRoot.child!, 'component')).toBe('benefit-modal');
  });
});
