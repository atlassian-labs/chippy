/**
 * Minimal unit tests for fiber-walk functions.
 * These tests exercise the pure fiber introspection helpers without jsdom overhead.
 */

import { describe, it, expect } from 'vitest';
import {
  Fiber,
  getDisplayName,
  isUserComponent,
  getHookSummary,
  describeSource,
  getFiberKey,
  getFiber,
  getNearestFiber,
  getNearestComponent,
  getOwnerChain,
  getOwnerFibers,
  getFiberDomNode,
  getReturnComponentChain,
  getReturnComponentFibers,
  describeFiberTarget,
  describeComponent,
} from './fiber-walk';

describe('fiber-walk', () => {
  describe('getDisplayName', () => {
    it('returns null for null/undefined', () => {
      expect(getDisplayName(null)).toBeNull();
      expect(getDisplayName(undefined)).toBeNull();
    });

    it('returns string types as-is', () => {
      expect(getDisplayName('div')).toBe('div');
    });

    it('prefers displayName over name', () => {
      expect(getDisplayName({ displayName: 'Memo', name: 'Component' })).toBe('Memo');
    });

    it('falls back to name property', () => {
      expect(getDisplayName({ name: 'MyComponent' })).toBe('MyComponent');
    });

    it('returns null if no displayName or name', () => {
      expect(getDisplayName({})).toBeNull();
    });
  });

  describe('isUserComponent', () => {
    it('returns false for null/undefined', () => {
      expect(isUserComponent(null)).toBe(false);
      expect(isUserComponent(undefined)).toBe(false);
    });

    it('returns false for DOM string types', () => {
      const fiber: Fiber = { type: 'div' };
      expect(isUserComponent(fiber)).toBe(false);
    });

    it('returns true for named function components', () => {
      const fiber: Fiber = { type: { name: 'MyComponent' } };
      expect(isUserComponent(fiber)).toBe(true);
    });

    it('filters out framework wrappers', () => {
      const hookified: Fiber = { type: { name: 'hookified' } };
      const anonymous: Fiber = { type: { name: 'Anonymous' } };
      expect(isUserComponent(hookified)).toBe(false);
      expect(isUserComponent(anonymous)).toBe(false);
    });
  });

  describe('getHookSummary', () => {
    it('returns 0 hooks for null fiber', () => {
      const summary = getHookSummary(null);
      expect(summary.hookCount).toBe(0);
      expect(summary.hookCountTruncated).toBe(false);
      expect(summary.hookCountMax).toBe(500);
    });

    it('counts hooks in linked list', () => {
      const hook2 = { next: null };
      const hook1 = { next: hook2 };
      const fiber: Fiber = { memoizedState: hook1 };
      const summary = getHookSummary(fiber);
      expect(summary.hookCount).toBe(2);
      expect(summary.hookCountTruncated).toBe(false);
    });

    it('detects cycle and stops', () => {
      const hook: Record<string, unknown> = { next: null };
      hook.next = hook; // Self-reference
      const fiber: Fiber = { memoizedState: hook };
      const summary = getHookSummary(fiber);
      expect(summary.hookCount).toBe(1);
      expect(summary.hookCountTruncated).toBe(false);
    });
  });

  describe('describeSource', () => {
    it('returns null for null source', () => {
      expect(describeSource(null)).toBeNull();
      expect(describeSource(undefined)).toBeNull();
    });

    it('normalizes source location', () => {
      const described = describeSource({
        fileName: 'Test.tsx',
        lineNumber: 42,
        columnNumber: 10,
      });
      expect(described).toEqual({
        fileName: 'Test.tsx',
        lineNumber: 42,
        columnNumber: 10,
      });
    });

    it('handles missing fields', () => {
      const described = describeSource({ fileName: 'Test.tsx' });
      expect(described?.fileName).toBe('Test.tsx');
      expect(described?.lineNumber).toBeNull();
      expect(described?.columnNumber).toBeNull();
    });
  });

  describe('getOwnerChain', () => {
    it('returns empty array for null fiber', () => {
      expect(getOwnerChain(null)).toEqual([]);
    });

    it('collects owner chain with metadata', () => {
      const owner: Fiber = {
        type: { name: 'Owner' },
        memoizedProps: { foo: 'bar' },
        _debugSource: { fileName: 'Owner.tsx', lineNumber: 10 },
      };
      const fiber: Fiber = { _debugOwner: owner };

      const chain = getOwnerChain(fiber);
      expect(chain).toHaveLength(1);
      expect(chain[0].name).toBe('Owner');
      expect(chain[0].props).toEqual(['foo']);
      expect(chain[0].source?.fileName).toBe('Owner.tsx');
    });
  });

  describe('owner fallback in production builds', () => {
    // Production fibers have no `_debugOwner`; Chippy uses the parent chain.
    const app: Fiber = { type: { name: 'App' } };
    const host: Fiber = { type: 'div', return: app };
    const layout: Fiber = { type: { name: 'Layout' }, return: host };
    const fiber: Fiber = { type: { name: 'Button' }, return: layout };

    it('returns component parents from getOwnerChain and getOwnerFibers', () => {
      expect(getOwnerChain(fiber).map((entry) => entry.name)).toEqual(['Layout', 'App']);
      expect(getOwnerFibers(fiber)).toEqual([layout, app]);
    });

    it('labels the chain in describeComponent', () => {
      const desc = describeComponent(fiber);
      expect(desc?.ownerStackKind).toBe('parents');
      expect(desc?.owners.map((entry) => entry.name)).toEqual(['Layout', 'App']);
    });

    it('keeps debug owners and labels them when React records them', () => {
      const owner: Fiber = { type: { name: 'Owner' } };
      const desc = describeComponent({ type: { name: 'Button' }, _debugOwner: owner, return: layout });
      expect(desc?.ownerStackKind).toBe('owners');
      expect(desc?.owners.map((entry) => entry.name)).toEqual(['Owner']);
    });
  });

  describe('getOwnerFibers', () => {
    it('returns empty array for null', () => {
      expect(getOwnerFibers(null)).toEqual([]);
    });

    it('returns raw fiber nodes from owner chain', () => {
      const owner: Fiber = { type: { name: 'Owner' } };
      const fiber: Fiber = { _debugOwner: owner };

      const fibers = getOwnerFibers(fiber);
      expect(fibers).toHaveLength(1);
      expect(fibers[0]).toBe(owner);
    });
  });

  describe('getReturnComponentChain', () => {
    it('returns empty array for null', () => {
      expect(getReturnComponentChain(null)).toEqual([]);
    });

    it('collects parent components via return chain', () => {
      const parent: Fiber = {
        type: { name: 'Parent' },
        memoizedProps: { x: 1 },
      };
      const fiber: Fiber = { return: parent };

      const chain = getReturnComponentChain(fiber);
      expect(chain).toHaveLength(1);
      expect(chain[0].name).toBe('Parent');
    });
  });

  describe('getReturnComponentFibers', () => {
    it('returns raw fibers from return chain', () => {
      const parent: Fiber = { type: { name: 'Parent' } };
      const fiber: Fiber = { return: parent };
      const fibers = getReturnComponentFibers(fiber);
      expect(fibers).toEqual([parent]);
    });
  });

  describe('describeFiberTarget', () => {
    it('returns null for null fiber and domNode', () => {
      expect(describeFiberTarget(null, null)).toBeNull();
    });

    it('describes fiber properties', () => {
      const fiber: Fiber = {
        type: { name: 'Button' },
        _debugSource: { fileName: 'Button.tsx', lineNumber: 5 },
      };

      const target = describeFiberTarget(fiber, null);
      expect(target?.fiberType).toBe('Button');
      expect(target?.source?.fileName).toBe('Button.tsx');
      expect(target?.domTag).toBeNull();
    });
  });

  describe('describeComponent', () => {
    it('returns null for null fiber', () => {
      expect(describeComponent(null)).toBeNull();
    });

    it('describes full component', () => {
      const owner: Fiber = { type: { name: 'Owner' } };
      const parent: Fiber = { type: { name: 'Parent' } };
      const fiber: Fiber = {
        type: { name: 'MyComponent' },
        key: 'key-1',
        memoizedProps: { id: 'test', count: 5 },
        _debugOwner: owner,
        return: parent,
        _debugSource: { fileName: 'MyComponent.tsx', lineNumber: 20 },
      };

      const desc = describeComponent(fiber);
      expect(desc?.name).toBe('MyComponent');
      expect(desc?.key).toBe('key-1');
      expect(desc?.props).toEqual({ id: 'test', count: 5 });
      expect(desc?.source?.lineNumber).toBe(20);
      expect(desc?.owners).toHaveLength(1);
      expect(desc?.parents).toHaveLength(1);
      expect(desc?.hookCount).toBe(0);
    });

    it('includes hook summary', () => {
      const hook: Record<string, unknown> = { next: null };
      const fiber: Fiber = {
        type: { name: 'WithHooks' },
        memoizedState: { next: hook },
      };

      const desc = describeComponent(fiber);
      expect(desc?.hookCount).toBe(2);
    });

    it('uses a React 19 _debugStack project frame when _debugSource is absent', () => {
      const fiber: Fiber = {
        type: { name: 'React19Component' },
        _debugStack: {
          stack: [
            'Error: react-stack-top-frame',
            '    at exports.jsxDEV (http://host/.vite/deps/react_jsx-dev-runtime.js:10:2)',
            '    at App (http://host/src/App.tsx:14:7)',
          ].join('\n'),
        },
      };

      expect(describeComponent(fiber)?.source).toEqual({
        fileName: 'http://host/src/App.tsx',
        lineNumber: 14,
        columnNumber: 7,
      });
    });
  });
});
