import { describe, it, expect } from 'vitest';
import { summarizeHookList, formatCounts, renderTreeText, renderCompactComponentText, type HookSummary } from './inspect-formatters';

function summarizeHooks(raw: unknown): HookSummary {
  const result = summarizeHookList(raw);
  if ('error' in result) throw new Error('unexpected hook list error: ' + result.error);
  return result;
}

describe('inspect-formatters', () => {
  // ─── summarizeHookList ──────────────────────────────────────────────────

  it('handles empty hook list', () => {
    const result = summarizeHooks({ hooks: [] });
    expect(result.hookCount).toBe(0);
    expect(result.counts).toEqual({});
    expect(result.cleanupEffectCount).toBe(0);
    expect(result.runs).toEqual([]);
  });

  it('handles error-tagged input', () => {
    const result = summarizeHookList({ error: 'test error' });
    expect('error' in result ? result.error : undefined).toBe('test error');
  });

  it('handles null input', () => {
    const result = summarizeHookList(null);
    expect('error' in result ? result.error : undefined).toBeDefined();
  });

  it('counts hook tags correctly', () => {
    const result = summarizeHooks({
      hooks: [
        { tag: 'State' },
        { tag: 'State' },
        { tag: 'Effect' },
        { tag: 'Memo' },
      ],
    });
    expect(result.counts).toEqual({ State: 2, Effect: 1, Memo: 1 });
  });

  it('tracks cleanup effects', () => {
    const result = summarizeHooks({
      hooks: [
        { tag: 'Effect', hasCleanup: true },
        { tag: 'Effect', hasCleanup: false },
        { tag: 'Effect', hasCleanup: true },
      ],
    });
    expect(result.cleanupEffectCount).toBe(2);
    expect(result.cleanupEffects).toEqual([0, 2]);
  });

  it('extracts value hints', () => {
    const result = summarizeHooks({
      hooks: [
        { tag: 'State', value: 42 },
        { tag: 'Ref', value: null },
        { tag: 'Memo', value: undefined },
        { tag: 'Value', value: 'test' },
      ],
    });
    expect(result.valueHints.length).toBe(2); // value: 42 and 'test' (null and undefined excluded)
    expect(result.valueHints[0]).toEqual({ index: 0, tag: 'State', value: 42 });
    expect(result.valueHints[1]).toEqual({ index: 3, tag: 'Value', value: 'test' });
  });

  it('groups hooks into runs by tag', () => {
    const result = summarizeHooks({
      hooks: [
        { tag: 'State' },
        { tag: 'State' },
        { tag: 'Effect' },
        { tag: 'Effect' },
        { tag: 'Effect' },
        { tag: 'Memo' },
      ],
    });
    expect(result.runs).toEqual([
      { start: 0, end: 1, tag: 'State', count: 2 },
      { start: 2, end: 4, tag: 'Effect', count: 3 },
      { start: 5, end: 5, tag: 'Memo', count: 1 },
    ]);
  });

  it('preserves name and fiberId from input', () => {
    const result = summarizeHooks({
      name: 'TestComponent',
      fiberId: 'fiber-42',
      hooks: [],
    });
    expect(result.name).toBe('TestComponent');
    expect(result.fiberId).toBe('fiber-42');
  });

  it('honors hookCount and truncated flags', () => {
    const result = summarizeHooks({
      hookCount: 500,
      truncated: true,
      maxHooks: 500,
      hooks: [{ tag: 'State' }],
    });
    expect(result.hookCount).toBe(500);
    expect(result.truncated).toBe(true);
    expect(result.maxHooks).toBe(500);
  });

  // ─── formatCounts ───────────────────────────────────────────────────────

  it('formats empty counts', () => {
    expect(formatCounts({})).toBe('');
    expect(formatCounts(null)).toBe('');
  });

  it('formats single count', () => {
    expect(formatCounts({ State: 5 })).toBe('State=5');
  });

  it('formats multiple counts sorted alphabetically', () => {
    expect(formatCounts({ Memo: 1, State: 3, Effect: 2 })).toBe('Effect=2, Memo=1, State=3');
  });

  // ─── renderTreeText ─────────────────────────────────────────────────────

  it('renders component name without source', () => {
    const text = renderTreeText('MyComponent', null, []);
    expect(text).toBe('MyComponent');
  });

  it('renders component name with source location', () => {
    const text = renderTreeText('MyComponent', { fileName: 'Component.tsx', lineNumber: 42 }, []);
    expect(text).toBe('MyComponent @ Component.tsx:42');
  });

  it('renders component name with source but no line number', () => {
    const text = renderTreeText('MyComponent', { fileName: 'Component.tsx' }, []);
    expect(text).toBe('MyComponent @ Component.tsx');
  });

  it('renders single root-level hook group', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [],
        hooks: [{ hookId: 0, primitive: 'State' }],
      },
    ]);
    expect(text).toContain('MyComponent');
    expect(text).toContain('└─ hook 0 State');
  });

  it('renders custom-hook ancestry with nested paths', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [{ name: 'useCustomHook' }],
        hooks: [{ hookId: 0, primitive: 'State' }],
      },
    ]);
    expect(text).toContain('MyComponent');
    expect(text).toContain('└─ useCustomHook');
    expect(text).toContain('└─ hook 0 State');
  });

  it('renders deeply nested custom-hook ancestry', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [
          { name: 'useOuter', loc: 'outer.ts:10' },
          { name: 'useInner', loc: 'inner.ts:5' },
        ],
        hooks: [
          { hookId: 0, primitive: 'State' },
          { hookId: 1, primitive: 'Effect' },
        ],
      },
    ]);
    expect(text).toContain('└─ useOuter @ outer.ts:10');
    expect(text).toContain('└─ useInner @ inner.ts:5');
    expect(text).toContain('├─ hook 0 State');
    expect(text).toContain('└─ hook 1 Effect');
  });

  it('renders mixed hook connectors (├─ and └─)', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [],
        hooks: [
          { hookId: 0, primitive: 'State' },
          { hookId: 1, primitive: 'Effect' },
          { hookId: 2, primitive: 'Memo' },
        ],
      },
    ]);
    const lines = text.split('\n');
    expect(lines[1]).toContain('├─ hook 0 State');
    expect(lines[2]).toContain('├─ hook 1 Effect');
    expect(lines[3]).toContain('└─ hook 2 Memo');
  });

  it('groups repeated custom-hook frames by stable parent callsite location', () => {
    const text = renderTreeText('MyComponent', null, [
      { path: [{ name: 'useOuter', loc: 'parent.ts:1' }, { name: 'useInner', loc: 'outer.ts:10' }], hooks: [{ hookId: 0, primitive: 'Ref' }] },
      { path: [{ name: 'useOuter', loc: 'parent.ts:1' }, { name: 'useInner', loc: 'outer.ts:10' }], hooks: [{ hookId: 1, primitive: 'Memo' }] },
      { path: [{ name: 'useOuter', loc: 'parent.ts:2' }, { name: 'useInner', loc: 'outer.ts:10' }], hooks: [{ hookId: 2, primitive: 'State' }] },
    ]);

    expect(text).toBe([
      'MyComponent',
      '├─ useOuter @ parent.ts:1',
      '│  └─ useInner @ outer.ts:10',
      '│     ├─ hook 0 Ref',
      '│     └─ hook 1 Memo',
      '└─ useOuter @ parent.ts:2',
      '   └─ useInner @ outer.ts:10',
      '      └─ hook 2 State',
    ].join('\n'));
  });

  it('groups repeated custom-hook prefixes into folders', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [
          { name: 'useCloudId' },
          { name: 'useTenantContext' },
          { name: 'useSweetState' },
        ],
        hooks: [{ hookId: 0, primitive: 'Ref' }],
      },
      {
        path: [
          { name: 'useCloudId' },
          { name: 'useTenantContext' },
          { name: 'useSweetState' },
        ],
        hooks: [{ hookId: 1, primitive: 'Memo' }],
      },
      {
        path: [
          { name: 'useCloudId' },
          { name: 'useTenantContext' },
          { name: 'useSweetState' },
          { name: 'useStoreState' },
        ],
        hooks: [
          { hookId: 4, primitive: 'SyncExternalStore' },
          { hookId: 5, primitive: 'Effect' },
        ],
      },
    ]);

    expect(text).toBe([
      'MyComponent',
      '└─ useCloudId',
      '   └─ useTenantContext',
      '      └─ useSweetState',
      '         ├─ hook 0 Ref',
      '         ├─ hook 1 Memo',
      '         └─ useStoreState',
      '            ├─ hook 4 SyncExternalStore',
      '            └─ hook 5 Effect',
    ].join('\n'));
  });

  it('renders multiple groups with different paths', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [],
        hooks: [{ hookId: 0, primitive: 'State' }],
      },
      {
        path: [{ name: 'useCustom' }],
        hooks: [{ hookId: 1, primitive: 'Effect' }],
      },
    ]);
    expect(text).toContain('hook 0 State');
    expect(text).toContain('useCustom');
    expect(text).toContain('hook 1 Effect');
  });

  it('renders hook debug labels', () => {
    const text = renderTreeText('MyComponent', null, [
      {
        path: [{ name: 'useSweetState', loc: 'store.ts:25' }],
        hooks: [{ hookId: null, primitive: 'DebugValue', debugLabel: 'RSS: JWMFormStore__1xxy1q6' }],
      },
    ]);

    expect(text).toContain('└─ hook · DebugValue — RSS: JWMFormStore__1xxy1q6');
  });

  // ─── renderCompactComponentText ─────────────────────────────────────────

  it('renders compact text with minimal data', () => {
    const text = renderCompactComponentText('MyComponent', null, { hookCount: 3, counts: { State: 1, Effect: 2 }, cleanupEffectCount: 0 }, [], []);
    expect(text).toContain('MyComponent');
    expect(text).toContain('hooks: 3 (Effect=2, State=1)');
  });

  it('marks truncated hooks with +', () => {
    const text = renderCompactComponentText('MyComponent', null, { hookCount: 500, truncated: true, counts: { State: 500 }, cleanupEffectCount: 0 }, [], []);
    expect(text).toContain('hooks: 500+');
  });

  it('reports cleanup effect count', () => {
    const text = renderCompactComponentText('MyComponent', null, { hookCount: 5, counts: { Effect: 3 }, cleanupEffectCount: 2 }, [], []);
    expect(text).toContain('effects with cleanup: 2');
  });

  it('includes source location in header', () => {
    const text = renderCompactComponentText('MyComponent', { fileName: 'Component.tsx', lineNumber: 10 }, { hookCount: 1, counts: { State: 1 }, cleanupEffectCount: 0 }, [], []);
    expect(text).toContain('MyComponent @ Component.tsx:10');
  });

  it('renders compact structure as a folder tree', () => {
    const text = renderCompactComponentText(
      'MyComponent',
      null,
      { hookCount: 4, counts: { State: 2, Effect: 1, Memo: 1 }, cleanupEffectCount: 0 },
      [
        { index: 0, primitive: 'State', path: [] },
        { index: 1, primitive: 'Effect', path: [{ name: 'useCustom' }] },
        { index: 2, primitive: 'Memo', path: [{ name: 'useCustom' }, { name: 'useNested' }] },
        { index: 3, primitive: 'State', path: [{ name: 'useCustom' }] },
      ],
      [],
    );
    expect(text).toContain('structure:');
    expect(text).toContain('  ├─ hook 0 State');
    expect(text).toContain('  └─ useCustom');
    expect(text).toContain('     ├─ hook 1 Effect');
    expect(text).toContain('     ├─ useNested');
    expect(text).toContain('     │  └─ hook 2 Memo');
    expect(text).toContain('     └─ hook 3 State');
    expect(text).not.toContain(' → ');
  });

  it('preserves debug labels in compact structure', () => {
    const text = renderCompactComponentText(
      'MyComponent',
      null,
      { hookCount: 1, counts: { DebugValue: 1 }, cleanupEffectCount: 0 },
      [{ index: null, primitive: 'DebugValue', debugLabel: 'RSS: JWMFormStore__1xxy1q6', path: [{ name: 'useSweetState' }] }],
      [],
    );

    expect(text).toContain('hook · DebugValue — RSS: JWMFormStore__1xxy1q6');
  });

  it('renders a bounded complexity section before the full structure', () => {
    const text = renderCompactComponentText(
      'MyComponent',
      null,
      {
        hookCount: 6,
        counts: { State: 2, Effect: 2, Memo: 1, DebugValue: 1 },
        cleanupEffectCount: 1,
        cleanupEffects: [5],
      },
      [
        { index: null, primitive: 'DebugValue', debugLabel: 'RSS: JWMFormStore__1xxy1q6', path: [{ name: 'useSweetState', loc: 'store.ts:25' }] },
        { index: 0, primitive: 'State', path: [] },
        { index: 1, primitive: 'State', path: [{ name: 'useSweetState', loc: 'store.ts:25' }] },
        { index: 2, primitive: 'Memo', path: [{ name: 'useSweetState', loc: 'store.ts:25' }] },
        { index: 3, primitive: 'Effect', path: [{ name: 'useResource' }] },
        { index: 4, primitive: 'Effect', path: [{ name: 'useResource' }] },
        { index: 5, primitive: 'Effect', path: [{ name: 'useAnalytics' }] },
      ],
      [],
    );

    expect(text).toContain('complexity:\n  total hook slots: 6');
    expect(text).toContain('  primitive counts: DebugValue=1, Effect=2, Memo=1, State=2');
    expect(text).toContain('  cleanup effects: 1 @ hooks 5');
    expect(text).toContain('  top hook families:');
    expect(text).toContain('    useResource: 2');
    expect(text).toContain('    useSweetState @ store.ts:25: 2');
    expect(text).toContain('  debug landmarks:');
    expect(text).toContain('    useSweetState @ store.ts:25 > hook · DebugValue — RSS: JWMFormStore__1xxy1q6');
    expect(text.indexOf('complexity:')).toBeLessThan(text.indexOf('structure:'));
  });

  it('does not truncate compact folder structure by grouped row count', () => {
    const records = Array.from({ length: 25 }, (_, i) => ({ index: i, primitive: 'State', path: [{ name: `useHook${i}` }] }));
    const text = renderCompactComponentText('MyComponent', null, { hookCount: 25, counts: { State: 25 }, cleanupEffectCount: 0 }, records, []);
    expect(text).toContain('useHook24');
    expect(text).not.toContain('more groups');
  });

  it('includes warnings', () => {
    const text = renderCompactComponentText('MyComponent', null, { hookCount: 1, counts: { State: 1 }, cleanupEffectCount: 0 }, [], [
      'fiber-only: no replay',
      'another warning',
    ]);
    expect(text).toContain('warnings: fiber-only: no replay; another warning');
  });

  it('reports fiber-only fallback when replay count differs', () => {
    const summary = { hookCount: 3, counts: { State: 3 }, cleanupEffectCount: 0, replayedHookCount: 0 };
    const text = renderCompactComponentText('MyComponent', null, summary, [], []);
    expect(text).toContain('fiber-only: 0 hooks replayed; 3 committed hook slots read');
  });
});
