import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GREP_LIMITS, grepFiber, grepValue, parseGrepScopes, type GrepHit } from './fiber-grep';
import { evalFindFibers, type ScriptHelpers } from './eval-helpers';

/** Build a committed hook linked list from memoizedState values. */
function hooks(...nodes: Array<{ memoizedState: unknown; queue?: unknown }>) {
  const built = nodes.map((n) => ({ memoizedState: n.memoizedState, queue: n.queue ?? null, next: null as unknown }));
  built.forEach((n, i) => { n.next = built[i + 1] ?? null; });
  return built[0] ?? null;
}
const stateQueue = { dispatch: () => {} };

describe('parseGrepScopes', () => {
  it('defaults to props and state, accepts aliases, and rejects unknown scopes', () => {
    expect(parseGrepScopes(undefined).scopes).toEqual(['props', 'state']);
    expect(parseGrepScopes('hooks,debug').scopes).toEqual(['state', 'debug']);
    expect(parseGrepScopes('all').scopes).toEqual(['props', 'state', 'debug']);
    expect(parseGrepScopes('nope').error).toMatch(/Unknown grep scope/);
  });
});

describe('grepValue', () => {
  it('matches nested keys, values, and function names with dotted paths', () => {
    const hits: GrepHit[] = [];
    function onIssueSelect() {}
    grepValue({ issue: { key: 'PROJ-12', tags: ['alpha', 'proj-beta'] }, onIssueSelect }, /proj/i, 'props', 'props', DEFAULT_GREP_LIMITS, hits);
    expect(hits.map((h) => [h.path, h.match])).toEqual([
      ['props.issue.key', 'value'],
      ['props.issue.tags[1]', 'value'],
    ]);
    const fnHits: GrepHit[] = [];
    grepValue({ onIssueSelect }, /issueselect/i, 'props', 'props', DEFAULT_GREP_LIMITS, fnHits);
    expect(fnHits).toEqual([
      { scope: 'props', path: 'props.onIssueSelect', match: 'key', value: '[function:onIssueSelect]' },
      { scope: 'props', path: 'props.onIssueSelect', match: 'value', value: '[function:onIssueSelect]' },
    ]);
  });

  it('does not enter React elements, cycles, or depth beyond the limit', () => {
    const cyclic: Record<string, unknown> = { label: 'needle' };
    cyclic.self = cyclic;
    const hits: GrepHit[] = [];
    grepValue({
      children: { $$typeof: Symbol.for('react.element'), props: { title: 'needle' } },
      cyclic,
      deep: { a: { b: { c: { d: { e: 'needle' } } } } },
    }, /needle/, 'props', 'props', DEFAULT_GREP_LIMITS, hits);
    expect(hits.map((h) => h.path)).toEqual(['props.cyclic.label']);
  });

  it('stops at maxHits', () => {
    const hits: GrepHit[] = [];
    grepValue(Array.from({ length: 30 }, () => 'x'), /x/, 'state', 's', { ...DEFAULT_GREP_LIMITS, maxHits: 3 }, hits);
    expect(hits).toHaveLength(3);
  });
});

describe('grepFiber', () => {
  it('reads hook slots without execution: state, ref, memo, and effect deps', () => {
    const fiber = {
      tag: 0,
      memoizedProps: {},
      memoizedState: hooks(
        { memoizedState: { user: { name: 'Ada' } }, queue: stateQueue },
        { memoizedState: { current: 'ada-ref' } },
        { memoizedState: [{ fullName: 'Ada Lovelace' }, []] },
      ),
    };
    const { hits } = grepFiber(fiber, /ada/i, ['state'], DEFAULT_GREP_LIMITS, null);
    expect(hits.map((h) => h.path)).toEqual([
      'hook[0:State].user.name',
      'hook[1:Ref].current',
      'hook[2:Memo].fullName',
    ]);
  });

  it('searches class component state as one object', () => {
    const { hits } = grepFiber({ tag: 1, memoizedState: { mode: 'editing' } }, /edit/, ['state'], DEFAULT_GREP_LIMITS, null);
    expect(hits).toEqual([{ scope: 'state', path: 'state.mode', match: 'value', value: 'editing' }]);
  });

  it('replays only fibers that call useDebugValue and reports the custom hook path', () => {
    const replay = vi.fn(() => ({
      replayStatus: 'complete',
      records: [
        { id: 0, index: 0, primitive: 'State', value: 1, path: [], source: null, fiberOnly: false, debugLabel: undefined },
        { id: 'debug:1', index: null, primitive: 'DebugValue', value: undefined, path: [{ name: 'useSweetState', loc: 'x' }], source: null, fiberOnly: false, debugLabel: 'RSS: IssueStore' },
      ],
    }));
    const plain = grepFiber({ tag: 0, _debugHookTypes: ['useState'] }, /issuestore/i, ['debug'], DEFAULT_GREP_LIMITS, replay);
    expect(plain.hits).toEqual([]);
    expect(replay).not.toHaveBeenCalled();

    const debug = grepFiber({ tag: 0, _debugHookTypes: ['useState', 'useDebugValue'] }, /issuestore/i, ['debug'], DEFAULT_GREP_LIMITS, replay);
    expect(debug.hits).toEqual([{
      scope: 'debug', path: 'debug(useSweetState)', match: 'value', value: 'RSS: IssueStore', hookPath: ['useSweetState'],
    }]);
    expect(debug.replay).toEqual({ status: 'complete' });
  });
});

describe('evalFindFibers --grep', () => {
  const fibers = [
    { fiber: { tag: 0, memoizedProps: { issueKey: 'PROJ-1' }, _debugHookTypes: ['useDebugValue'] }, info: { name: 'IssueRow' } },
    { fiber: { tag: 0, memoizedProps: { label: 'other' }, memoizedState: hooks({ memoizedState: 'proj-2', queue: stateQueue }) }, info: { name: 'Picker' } },
    { fiber: { tag: 0, memoizedProps: { label: 'none' } }, info: { name: 'Footer' } },
  ];
  const helpers: ScriptHelpers = {
    walkAll: (visit) => fibers.forEach((f) => visit(f.fiber)),
    fiberInfo: (fiber) => fibers.find((f) => f.fiber === fiber)?.info ?? null,
  };

  it('returns only fibers with hits, combined with other filters, and reports scan stats', () => {
    const replay = vi.fn();
    const out = evalFindFibers({ grep: 'proj' }, helpers, () => 'id', { replay });
    expect(out.items.map((i) => i.name)).toEqual(['IssueRow', 'Picker']);
    expect(out.items[0].hits).toEqual([{ scope: 'props', path: 'props.issueKey', match: 'value', value: 'PROJ-1' }]);
    expect(out.grep).toMatchObject({ scopes: ['props', 'state'], scanned: 3, debugCandidates: 1, replayed: 0 });
    expect((out.grep as { note?: string }).note).toMatch(/useDebugValue/);
    expect(replay).not.toHaveBeenCalled();

    const named = evalFindFibers({ grep: 'proj', name: 'picker' }, helpers, () => 'id', { replay });
    expect(named.items.map((i) => i.name)).toEqual(['Picker']);
  });

  it('replays debug candidates only when debug is requested', () => {
    const replay = vi.fn(() => ({ replayStatus: 'complete', records: [] }));
    const out = evalFindFibers({ grep: 'zzz', in: 'debug' }, helpers, () => 'id', { replay });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(out.grep).toMatchObject({ replayed: 1, replayFailed: 0 });
  });

  it('rejects an unknown scope and keeps the legacy shape without grep', () => {
    expect(evalFindFibers({ grep: 'x', in: 'dom' }, helpers, () => 'id')).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown grep scope/) });
    expect(evalFindFibers({ grep: '(' }, helpers, () => 'id')).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid --grep regex/) });
    expect(evalFindFibers({ name: '(' }, helpers, () => 'id')).toMatchObject({ ok: false, count: 0, error: expect.stringMatching(/Invalid --name regex/) });
    expect(evalFindFibers({ text: '[' }, helpers, () => 'id')).toMatchObject({ ok: false, count: 0, error: expect.stringMatching(/Invalid --text regex/) });
    expect(Object.keys(evalFindFibers({}, helpers, () => 'id'))).toEqual(['count', 'items']);
  });
});
