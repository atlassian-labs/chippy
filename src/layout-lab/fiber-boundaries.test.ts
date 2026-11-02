import { describe, expect, it } from 'vitest';
import type { Fiber } from './fiber-walk';
import {
  collectFiberBoundaries,
  describeErrorBoundary,
  describeSuspenseBoundary,
} from './fiber-boundaries';

describe('fiber-boundaries (generic, fiber-native)', () => {
  it('detects a non-Jira error boundary by getDerivedStateFromError lifecycle', () => {
    class MyErrorBoundary {
      static getDerivedStateFromError() {
        return {};
      }
    }
    const fiber: Fiber = { tag: 1, type: MyErrorBoundary } as unknown as Fiber;
    expect(describeErrorBoundary(fiber)).toEqual({
      componentName: 'MyErrorBoundary',
      detectedBy: 'lifecycle',
    });
  });

  it('detects an error boundary by componentDidCatch on the prototype', () => {
    class Guard {
      componentDidCatch() {}
    }
    const fiber: Fiber = { tag: 1, type: Guard } as unknown as Fiber;
    expect(describeErrorBoundary(fiber)?.detectedBy).toBe('lifecycle');
  });

  it('falls back to a name heuristic when no lifecycle is introspectable', () => {
    const fiber: Fiber = { type: { displayName: 'SomethingErrorBoundary' } };
    expect(describeErrorBoundary(fiber)).toEqual({
      componentName: 'SomethingErrorBoundary',
      detectedBy: 'name',
    });
  });

  it('does not treat a plain component as an error boundary', () => {
    const fiber: Fiber = { tag: 0, type: { name: 'PlainThing' } } as unknown as Fiber;
    expect(describeErrorBoundary(fiber)).toBeNull();
  });

  it('detects Suspense by fiber tag 13', () => {
    const fiber: Fiber = { tag: 13, type: null } as unknown as Fiber;
    expect(describeSuspenseBoundary(fiber)).toEqual({ componentName: 'Suspense' });
  });

  it('collects nearest error + suspense with distance from an ordered list', () => {
    class EB {
      static getDerivedStateFromError() {
        return {};
      }
    }
    const list: Fiber[] = [
      { type: { name: 'Leaf' } },
      { type: { name: 'Mid' } },
      { tag: 1, type: EB } as unknown as Fiber,
      { type: { name: 'More' } },
      { tag: 13, type: null } as unknown as Fiber,
    ];
    const b = collectFiberBoundaries(list);
    expect(b.error).toMatchObject({ componentName: 'EB', distance: 2 });
    expect(b.suspense).toEqual({ componentName: 'Suspense', distance: 4 });
  });
});
