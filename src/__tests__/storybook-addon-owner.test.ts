import { afterEach, describe, expect, it, vi } from 'vitest';

// The extension's early startup can stamp the preview iframe before the addon's
// setup module evaluates. The addon is user-driven and must take that frame over.
describe('Storybook addon owner claim', () => {
  afterEach(() => {
    delete (globalThis as any).__CHIPPY_OWNER__;
    delete (globalThis as any).__CHIPPY_OWNER_RESULT__;
    delete (globalThis as any).__CHIPPY_BLOCKED__;
    delete (globalThis as any).__CHIPPY_STARTUP_CONFIG;
    delete (globalThis as any).__CHIPPY;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadWithOwner(owner: unknown) {
    (globalThis as any).__CHIPPY_OWNER__ = owner;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const claimed: unknown[] = [];
    const listener = (event: Event) => claimed.push((event as CustomEvent).detail);
    globalThis.addEventListener('chippy-owner-claimed', listener);
    try {
      const mod = await import('../../.storybook/chippy-addon/setup.js');
      return { result: mod.ownerResult, claimed };
    } finally {
      globalThis.removeEventListener('chippy-owner-claimed', listener);
    }
  }

  it('replaces a live extension owner and tells its bridge to stand down', async () => {
    const { result, claimed } = await loadWithOwner({
      ownerId: 'chippy-extension', integration: { kind: 'extension' }, heartbeatAt: Date.now(), staleAfterMs: 15_000,
    });
    expect(result.ok).toBe(true);
    expect((globalThis as any).__CHIPPY_OWNER__.ownerId).toBe('storybook-addon');
    expect((globalThis as any).__CHIPPY_STARTUP_CONFIG.integration.kind).toBe('storybook');
    expect(claimed).toEqual([JSON.stringify({ ownerId: 'storybook-addon' })]);
  });

  it('still yields to a live owner of another user-driven integration', async () => {
    const { result, claimed } = await loadWithOwner({
      ownerId: 'chippy-import', integration: { kind: 'import' }, heartbeatAt: Date.now(), staleAfterMs: 15_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('owned-by-other-chippy');
    expect(claimed).toEqual([]);
  });
});
