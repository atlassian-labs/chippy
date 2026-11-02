import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertChippyLabIdentity, resolveChippyLabTarget } from '../test/chippy-lab-target';

afterEach(() => vi.unstubAllGlobals());

describe('Chippy lab target', () => {
  it('resolves the default and a selected port consistently', () => {
    expect(resolveChippyLabTarget(undefined)).toEqual({ port: '6007', origin: 'http://127.0.0.1:6007' });
    expect(resolveChippyLabTarget('6008')).toEqual({ port: '6008', origin: 'http://127.0.0.1:6008' });
  });
  it.each(['', '0', '65536', '3.5', 'nope'])('rejects an invalid port: %s', port => {
    expect(() => resolveChippyLabTarget(port)).toThrow('CHIPPY_STORYBOOK_PORT');
  });
  it('accepts the lab fixture and rejects an unrelated responding Storybook', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ entries: { 'avalanche-churnlab--default': {} } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entries: { 'other-project--default': {} } }) });
    vi.stubGlobal('fetch', fetch);
    await expect(assertChippyLabIdentity('http://127.0.0.1:6008')).resolves.toBeUndefined();
    await expect(assertChippyLabIdentity('http://127.0.0.1:6007')).rejects.toThrow('another Storybook');
    expect(fetch.mock.calls[0]).toEqual(['http://127.0.0.1:6008/index.json']);
  });
  it('reports an unavailable story index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(assertChippyLabIdentity('http://127.0.0.1:6008')).rejects.toThrow('Cannot read Storybook index');
  });
});
