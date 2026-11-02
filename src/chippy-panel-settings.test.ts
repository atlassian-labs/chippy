import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const EXTENSION_DIR = resolve(__dirname, '../.agents/skills/chippy/extension');
const SETTINGS_SOURCE = readFileSync(resolve(EXTENSION_DIR, 'panel-settings.js'), 'utf8');
const CONTENT_SCRIPT_SOURCE = readFileSync(resolve(EXTENSION_DIR, 'content-script.js'), 'utf8');
const POPUP_HTML = readFileSync(resolve(EXTENSION_DIR, 'popup.html'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(resolve(EXTENSION_DIR, 'manifest.json'), 'utf8'));

async function flushTasks() {
  await new Promise((done) => setTimeout(done, 0));
}

describe('Chippy embedded extension settings', () => {
  it('mounts settings in a closed shadow root without an iframe', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://example.test/page',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    let settingsRoot: ShadowRoot | null = null;
    const attachShadow = win.Element.prototype.attachShadow;
    win.Element.prototype.attachShadow = function captureClosedRoot(init: ShadowRootInit) {
      settingsRoot = attachShadow.call(this, init);
      return settingsRoot;
    };
    win.chrome = {
      storage: {
        local: {
          get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', forwardPort: null }),
          set: async () => undefined,
        },
      },
    };

    win.eval(SETTINGS_SOURCE);
    const slot = win.document.createElement('div');
    slot.setAttribute('data-chippy-settings-slot', 'true');
    win.document.body.appendChild(slot);
    win.document.dispatchEvent(new win.Event('chippy-settings-mount-request'));
    await flushTasks();
    const host = slot.querySelector('[data-chippy-settings-host]') as HTMLElement;

    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeNull();
    expect(settingsRoot).toBeTruthy();
    expect(settingsRoot?.querySelector('form')).toBeTruthy();
    expect(SETTINGS_SOURCE).toContain('Auto-detect from page URL');
    expect(win.document.querySelector('iframe')).toBeNull();
    expect(SETTINGS_SOURCE).not.toContain('createElement(\'iframe\')');
    expect(CONTENT_SCRIPT_SOURCE).not.toContain('createElement(\'iframe\')');
    expect(MANIFEST.content_scripts[0].js).toEqual(['panel-settings.js', 'content-script.js']);
    expect(MANIFEST.web_accessible_resources[0].resources).not.toContain('panel-settings.html');
    dom.window.close();
  });

  it('persists settings and applies them to the current page', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div data-chippy-settings-slot></div></body></html>', {
      url: 'https://example.test/page',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    let settingsRoot: ShadowRoot | null = null;
    const attachShadow = win.Element.prototype.attachShadow;
    win.Element.prototype.attachShadow = function captureClosedRoot(init: ShadowRootInit) {
      settingsRoot = attachShadow.call(this, init);
      return settingsRoot;
    };
    const writes: Array<Record<string, unknown>> = [];
    const commands: Array<Record<string, unknown>> = [];
    win.chrome = {
      storage: {
        local: {
          get: async () => ({ helperBaseUrl: 'http://localhost:7823/', forwardPort: 6007, plugins: ['jira'] }),
          set: async (value: Record<string, unknown>) => { writes.push(value); },
        },
      },
    };
    win.document.addEventListener('chippy-ext-command', (event: Event) => {
      commands.push((event as CustomEvent).detail);
    });

    win.eval(SETTINGS_SOURCE);
    await flushTasks();
    const helperInput = settingsRoot?.querySelector('[data-helper-url]') as HTMLInputElement;
    const forwardPortInput = settingsRoot?.querySelector('[data-forward-port]') as HTMLInputElement;
    expect(helperInput.value).toBe('http://localhost:7823');
    expect(forwardPortInput.value).toBe('6007');
    const plugin = (id: string) => settingsRoot?.querySelector(`[data-plugin][value="${id}"]`) as HTMLInputElement;
    expect(plugin('jira').checked).toBe(true);
    expect(plugin('atl').checked).toBe(false);

    helperInput.value = 'http://127.0.0.1:9000/';
    forwardPortInput.value = '6010';
    plugin('jira').checked = false;
    plugin('atl').checked = true;
    (settingsRoot?.querySelector('form') as HTMLFormElement).dispatchEvent(
      new win.Event('submit', { bubbles: true, cancelable: true }),
    );
    await flushTasks();

    expect(writes).toEqual([{ helperBaseUrl: 'http://127.0.0.1:9000', forwardPort: 6010, plugins: ['atl'] }]);
    expect(commands).toEqual([{
      type: 'apply-config',
      helperBaseUrl: 'http://127.0.0.1:9000',
      activated: true,
    }]);
    expect(settingsRoot?.querySelector('[data-status]')?.textContent).toBe('Saved.');
    dom.window.close();
  });

  it('lists a packed build\'s plugins and checks its defaults before the user saves', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div data-chippy-settings-slot></div></body></html>', {
      url: 'https://example.test/page',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    let settingsRoot: ShadowRoot | null = null;
    const attachShadow = win.Element.prototype.attachShadow;
    win.Element.prototype.attachShadow = function captureClosedRoot(init: ShadowRootInit) {
      settingsRoot = attachShadow.call(this, init);
      return settingsRoot;
    };
    win.chrome = {
      storage: {
        local: {
          // chrome.storage returns the supplied defaults for keys never saved.
          get: async (defaults: Record<string, unknown>) => ({ ...defaults }),
          set: async () => undefined,
        },
      },
    };
    win.__CHIPPY_BUILD = {
      plugins: [{ id: 'jira', label: 'Jira' }, { id: 'gate', label: '<Gate>' }],
      defaultPlugins: ['gate'],
    };

    win.eval(SETTINGS_SOURCE);
    await flushTasks();
    const inputs = Array.from(settingsRoot!.querySelectorAll('[data-plugin]')) as HTMLInputElement[];
    expect(inputs.map((input) => [input.value, input.checked])).toEqual([['jira', false], ['gate', true]]);
    expect(settingsRoot!.querySelector('fieldset')?.textContent).toContain('<Gate>');
    dom.window.close();
  });

  it('keeps one content-script-owned settings host across reinjection', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div data-chippy-settings-slot></div></body></html>', {
      url: 'https://example.test/page',
      runScripts: 'outside-only',
    });
    const win = dom.window as unknown as Window & Record<string, any>;
    win.chrome = {
      storage: {
        local: {
          get: async () => ({ helperBaseUrl: 'http://127.0.0.1:7823', forwardPort: null }),
          set: async () => undefined,
        },
      },
    };

    win.eval(SETTINGS_SOURCE);
    const firstHost = win.document.querySelector('[data-chippy-settings-host]');
    win.eval(SETTINGS_SOURCE);
    await flushTasks();

    const hosts = win.document.querySelectorAll('[data-chippy-settings-host]');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).not.toBe(firstHost);
    expect(hosts[0].parentElement).toHaveAttribute('data-chippy-settings-slot');
    dom.window.close();
  });

  it('removes the duplicate settings form from the toolbar popup', () => {
    expect(POPUP_HTML).not.toContain('id="settings-form"');
    const dom = new JSDOM(POPUP_HTML);
    const popupDocument: Document = dom.window.document;
    const buttons = Array.from(popupDocument.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['Enable', 'Disable']);
    expect(dom.window.document.querySelectorAll('body > :not(button):not(script):not(header)')).toHaveLength(0);
    expect(dom.window.document.querySelector('header')?.textContent).toBe('Chippy');
    expect(POPUP_HTML).not.toContain('settings now live');
    expect(POPUP_HTML).not.toContain('This tab');
    dom.window.close();
  });
});
