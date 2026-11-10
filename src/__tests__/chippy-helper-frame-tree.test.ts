import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { describeClientFrame } = require('../../.agents/skills/chippy/scripts/frame-tree.js');

type Frame = { isTop: boolean; path: number[]; ancestorOrigins?: string[]; parentClientId?: string | null; parentOrigin?: string | null; childClientIds?: string[] };
const client = (clientId: string, url: string, frame: Frame | null) => ({ clientId, page: { url, frame } });
const byId = (...list: ReturnType<typeof client>[]) => new Map(list.map((c) => [c.clientId, c]));

const top = () => client('top', 'https://top.test/app', { isTop: true, path: [], childClientIds: ['cross', 'nested-parent'] });
const cross = () => client('cross', 'https://frame.test/embed', {
  isTop: false, path: [0], ancestorOrigins: ['https://top.test'], parentClientId: 'top', parentOrigin: 'https://top.test', childClientIds: [],
});

describe('helper frame tree', () => {
  it('links a child to its parent when both frames report the link', () => {
    const clients = byId(top(), cross());
    expect(describeClientFrame(clients.get('cross'), clients)).toEqual({
      isTop: false, path: [0], ancestorOrigins: ['https://top.test'],
      parentClientId: 'top', parentOrigin: 'https://top.test', unconfirmedParentClientId: null,
      topClientId: 'top', childClientIds: [], panelRemembered: false,
    });
    expect(describeClientFrame(clients.get('top'), clients)).toMatchObject({
      isTop: true, parentClientId: null, topClientId: 'top', childClientIds: ['cross'],
    });
  });

  it('passes through whether the agent chose to show the panel in a child frame', () => {
    const shown = cross();
    (shown.page.frame as Record<string, unknown>).panelRemembered = true;
    const clients = byId(top(), shown);
    expect(describeClientFrame(clients.get('cross'), clients)?.panelRemembered).toBe(true);
  });

  it('does not link a child the parent never confirmed', () => {
    const parent = top();
    parent.page.frame!.childClientIds = [];
    const clients = byId(parent, cross());
    expect(describeClientFrame(clients.get('cross'), clients)).toMatchObject({
      parentClientId: null, unconfirmedParentClientId: 'top', topClientId: null,
    });
    expect(describeClientFrame(clients.get('top'), clients)?.childClientIds).toEqual([]);
  });

  it('does not link when the parent page origin differs from the origin the child saw', () => {
    const child = cross();
    child.page.frame!.parentOrigin = 'https://elsewhere.test';
    const clients = byId(top(), child);
    expect(describeClientFrame(clients.get('cross'), clients)).toMatchObject({ parentClientId: null, unconfirmedParentClientId: 'top' });
  });

  it('reports a claimed parent that is no longer connected as unconfirmed', () => {
    const clients = byId(cross());
    expect(describeClientFrame(clients.get('cross'), clients)).toMatchObject({ parentClientId: null, unconfirmedParentClientId: 'top' });
  });

  it('resolves the top client through nested confirmed links', () => {
    const middle = client('nested-parent', 'https://top.test/inner', {
      isTop: false, path: [1], parentClientId: 'top', parentOrigin: 'https://top.test', childClientIds: ['leaf'],
    });
    const leaf = client('leaf', 'https://frame.test/leaf', {
      isTop: false, path: [1, 0], parentClientId: 'nested-parent', parentOrigin: 'https://top.test', childClientIds: [],
    });
    const clients = byId(top(), middle, leaf);
    expect(describeClientFrame(leaf, clients)).toMatchObject({ parentClientId: 'nested-parent', topClientId: 'top' });
    expect(describeClientFrame(middle, clients)?.childClientIds).toEqual(['leaf']);
  });

  it('returns null for a bridge that reports no frame data', () => {
    const old = client('old', 'https://top.test/', null);
    expect(describeClientFrame(old, byId(old))).toBeNull();
  });
});
