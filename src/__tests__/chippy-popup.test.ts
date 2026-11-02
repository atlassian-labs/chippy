import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const POPUP_SOURCE = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/popup.js'),
  'utf8',
);
const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../.agents/skills/chippy/extension/popup.html'),
  'utf8',
);

async function flushTasks() {
  await new Promise((done) => setTimeout(done, 0));
  await new Promise((done) => setTimeout(done, 0));
}

function openPopup(initiallyEnabled: boolean) {
  const dom = new JSDOM(POPUP_HTML, {
    url: 'chrome-extension://chippy/popup.html',
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & Record<string, any>;
  const writes: Array<Record<string, unknown>> = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  const tabMessages: Array<Record<string, unknown>> = [];
  let closed = false;
  let stored = {
    helperBaseUrl: 'http://127.0.0.1:7823',
    enabledOrigins: initiallyEnabled ? { 'https://example.test': true } : {},
  };

  win.chrome = {
    tabs: {
      query: async () => [{ id: 17, url: 'https://example.test/page' }],
      sendMessage: async (_tabId: number, message: Record<string, unknown>) => {
        tabMessages.push(message);
        return { ok: true };
      },
    },
    runtime: {
      sendMessage: async (message: Record<string, unknown>) => {
        runtimeMessages.push(message);
        return { ok: true };
      },
    },
    storage: {
      local: {
        get: async () => stored,
        set: async (value: Record<string, unknown>) => {
          writes.push(value);
          stored = { ...stored, ...value } as typeof stored;
        },
      },
    },
  };
  win.close = () => { closed = true; };
  win.eval(POPUP_SOURCE);

  return {
    dom,
    win,
    writes,
    runtimeMessages,
    tabMessages,
    wasClosed: () => closed,
  };
}

describe('Chippy extension popup', () => {
  it('enables the current origin and injects Chippy', async () => {
    const popup = openPopup(false);
    await flushTasks();
    const enable = popup.win.document.querySelector('#btn-activate') as HTMLButtonElement;
    const disable = popup.win.document.querySelector('#btn-deactivate') as HTMLButtonElement;
    expect(enable.disabled).toBe(false);
    expect(disable.disabled).toBe(true);

    enable.click();
    await flushTasks();

    expect(popup.writes).toEqual([{ enabledOrigins: { 'https://example.test': true } }]);
    expect(popup.runtimeMessages).toEqual([
      { type: 'chippy-ensure-content-script', tabId: 17 },
      { type: 'chippy-inject-bundle', tabId: 17, helperBaseUrl: 'http://127.0.0.1:7823' },
    ]);
    expect(popup.wasClosed()).toBe(true);
    popup.dom.window.close();
  });

  it('disables the current origin and removes Chippy from the tab', async () => {
    const popup = openPopup(true);
    await flushTasks();
    const enable = popup.win.document.querySelector('#btn-activate') as HTMLButtonElement;
    const disable = popup.win.document.querySelector('#btn-deactivate') as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    expect(disable.disabled).toBe(false);

    disable.click();
    await flushTasks();

    expect(popup.writes).toEqual([{ enabledOrigins: {} }]);
    expect(popup.tabMessages).toEqual([{ type: 'chippy-disable-now' }]);
    expect(popup.wasClosed()).toBe(true);
    popup.dom.window.close();
  });
});
