import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const frameLinkSource = readFileSync('.agents/skills/chippy/extension/frame-link.js', 'utf8');

type Listener = (event: { data: unknown; origin: string; source: FakeWindow }) => void;
type FrameLink = {
  start(): void;
  stop(): void;
  refresh(): void;
  describe(): {
    isTop: boolean;
    path: number[] | null;
    ancestorOrigins: string[];
    parentClientId: string | null;
    parentOrigin: string | null;
    childClientIds: string[];
  };
};

class FakeStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
  removeItem(key: string) { this.items.delete(key); }
}

// A window model with only what the handshake uses. postMessage delivers
// asynchronously with the browser-set origin and source of the sending window,
// and drops a message whose targetOrigin does not match the receiver.
class FakeWindow {
  listeners: Listener[] = [];
  frames: FakeWindow[] = [];
  parent: FakeWindow = this;
  location: { ancestorOrigins: string[]; origin: string; pathname: string };
  localStorage = new FakeStorage();
  __CHIPPY: Record<string, any> = {};

  constructor(public origin: string, private bus: { sender: FakeWindow | null }, parent?: FakeWindow) {
    if (parent) {
      this.parent = parent;
      parent.frames.push(this);
    }
    const ancestors: string[] = [];
    for (let w: FakeWindow = this; w.parent !== w; w = w.parent) ancestors.push(w.parent.origin);
    this.location = { ancestorOrigins: ancestors, origin, pathname: '/' };
  }

  addEventListener(type: string, listener: Listener) {
    if (type === 'message') this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  postMessage(data: unknown, targetOrigin: string) {
    const sender = this.bus.sender;
    if (!sender) throw new Error('postMessage outside a window task');
    if (targetOrigin !== '*' && targetOrigin !== this.origin) return;
    setTimeout(() => this.dispatch({ data: structuredClone(data), origin: sender.origin, source: sender }), 0);
  }

  dispatch(event: { data: unknown; origin: string; source: FakeWindow }) {
    const previous = this.bus.sender;
    this.bus.sender = this;
    try { for (const l of [...this.listeners]) l(event); } finally { this.bus.sender = previous; }
  }

  run<T>(fn: () => T): T {
    const previous = this.bus.sender;
    this.bus.sender = this;
    try { return fn(); } finally { this.bus.sender = previous; }
  }
}

function install(win: FakeWindow, clientId: string, onChange: () => void = () => undefined): FrameLink {
  runInNewContext(frameLinkSource, { window: win });
  return win.run(() => win.__CHIPPY.createFrameLink({ getClientId: () => clientId, onChange }));
}

const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function tree() {
  const bus = { sender: null as FakeWindow | null };
  const top = new FakeWindow('https://top.test', bus);
  const same = new FakeWindow('https://top.test', bus, top);
  const cross = new FakeWindow('https://frame.test', bus, top);
  return { bus, top, same, cross };
}

describe('frame link handshake', () => {
  it('links same-origin and cross-origin child frames to the parent client', async () => {
    const { top, same, cross } = tree();
    const topLink = install(top, 'top-id');
    const sameLink = install(same, 'same-id');
    const crossLink = install(cross, 'cross-id');
    top.run(() => topLink.start());
    same.run(() => sameLink.start());
    cross.run(() => crossLink.start());
    await settle();

    expect(topLink.describe()).toMatchObject({ isTop: true, path: [], parentClientId: null });
    expect(topLink.describe().childClientIds.sort()).toEqual(['cross-id', 'same-id']);
    expect(sameLink.describe()).toMatchObject({
      isTop: false, path: [0], ancestorOrigins: ['https://top.test'],
      parentClientId: 'top-id', parentOrigin: 'https://top.test', childClientIds: [],
    });
    expect(crossLink.describe()).toMatchObject({
      isTop: false, path: [1], ancestorOrigins: ['https://top.test'],
      parentClientId: 'top-id', parentOrigin: 'https://top.test',
    });
  });

  it('links a child that started before its parent once the parent asks', async () => {
    const { top, cross } = tree();
    const crossLink = install(cross, 'cross-id');
    cross.run(() => crossLink.start());
    await settle();
    expect(crossLink.describe().parentClientId).toBeNull();

    const changes: string[] = [];
    const topLink = install(top, 'top-id', () => changes.push('top'));
    top.run(() => topLink.start());
    await settle();
    expect(crossLink.describe().parentClientId).toBe('top-id');
    expect(topLink.describe().childClientIds).toEqual(['cross-id']);
    expect(changes).toEqual(['top']);
  });

  it('ignores a parent answer from a window that is not its parent', async () => {
    const { top, same, cross } = tree();
    const crossLink = install(cross, 'cross-id');
    cross.run(() => crossLink.start());
    // A sibling frame forges a parent answer.
    same.run(() => cross.postMessage({ source: 'chippy-frame', type: 'parent', clientId: 'forged', childClientId: 'cross-id' }, '*'));
    await settle();
    expect(crossLink.describe().parentClientId).toBeNull();
    expect(top.frames).toContain(cross);
  });

  it('ignores a hello from a window that is not one of its frames', async () => {
    const { top, same } = tree();
    const sameLink = install(same, 'same-id');
    same.run(() => sameLink.start());
    // A sibling announces itself to another sibling, which is not its parent.
    top.frames[1].run(() => same.postMessage({ source: 'chippy-frame', type: 'hello', clientId: 'intruder' }, '*'));
    await settle();
    expect(sameLink.describe().childClientIds).toEqual([]);
  });

  it('stops answering after stop()', async () => {
    const { top, cross } = tree();
    const topLink = install(top, 'top-id');
    top.run(() => { topLink.start(); topLink.stop(); });
    const crossLink = install(cross, 'cross-id');
    cross.run(() => crossLink.start());
    await settle();
    expect(crossLink.describe().parentClientId).toBeNull();
    expect(topLink.describe().childClientIds).toEqual([]);
  });
});

type FramePanel = {
  isChild: boolean;
  remembered(): boolean;
  remember(shown: boolean): void;
  gate(requested: boolean, current: boolean): boolean;
};

function panelFor(win: FakeWindow): FramePanel {
  runInNewContext(frameLinkSource, { window: win });
  return win.__CHIPPY.createFramePanelPreference();
}

describe('frame panel preference', () => {
  it('keeps an integration-requested panel in the top frame', () => {
    const { top } = tree();
    const panel = panelFor(top);
    expect(panel.isChild).toBe(false);
    expect(panel.gate(true, false)).toBe(true);
    expect(panel.gate(false, true)).toBe(false);
  });

  it('hides the panel in a child frame until the agent chooses it, and remembers the choice', () => {
    const { cross } = tree();
    cross.location.pathname = '/widget';
    expect(panelFor(cross).gate(true, false)).toBe(false);

    panelFor(cross).remember(true);
    // A new document in the same frame address reads the saved choice.
    const reloaded = panelFor(cross);
    expect(reloaded.remembered()).toBe(true);
    expect(reloaded.gate(true, false)).toBe(true);

    cross.location.pathname = '/other';
    expect(panelFor(cross).gate(true, false)).toBe(false);

    cross.location.pathname = '/widget';
    panelFor(cross).remember(false);
    expect(panelFor(cross).gate(true, false)).toBe(false);
    expect(cross.localStorage.items.size).toBe(0);
  });

  it('does not hide a panel the agent showed when the integration reapplies its config', () => {
    const { cross } = tree();
    expect(panelFor(cross).gate(true, true)).toBe(true);
  });

  it('falls back to hidden when storage is unavailable', () => {
    const { cross } = tree();
    (cross as any).localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const panel = panelFor(cross);
    expect(() => panel.remember(true)).not.toThrow();
    expect(panel.gate(true, false)).toBe(false);
  });
});
