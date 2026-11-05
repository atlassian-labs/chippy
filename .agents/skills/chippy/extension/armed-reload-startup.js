/* eslint-disable */
// One-shot early startup for an armed reload, loaded into the background
// service worker with importScripts().
//
// The background's normal startup injection waits on several asynchronous
// lookups after navigation commits, so a fast page can commit React before
// Avalanche installs. Before an armed reload, the page bridge stores the arm in
// sessionStorage and asks for this registration. Chrome then runs the scripts
// below synchronously at document_start of the next document, and
// startup-handoff.js turns the stored arm into the startup config.
//
// The registration covers one navigation of one frame: it is removed when that
// document finishes parsing, when its navigation fails, or when it is older
// than PENDING_MAX_AGE_MS at the next navigation event.
(function chippyArmedReloadStartup(global) {
  const SCRIPT_ID = 'chippy-armed-reload-startup';
  const PENDING_KEY = 'chippyArmedReloadPending';
  const PENDING_MAX_AGE_MS = 60000;
  const FILES = ['devtools-hook-shim.js', 'startup-handoff.js', 'avalanche.iife.js', 'early-bootstrap.js'];

  function originPattern(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Unsupported page URL: ${url}`);
    return `${parsed.origin}/*`;
  }

  async function unregister() {
    try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch {}
    try { await chrome.storage.session.remove(PENDING_KEY); } catch {}
  }

  // Registration calls run one at a time; Chrome rejects a concurrent
  // registration of the same id.
  let queue = Promise.resolve();
  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function register({ tabId, frameId, url }) {
    const pattern = originPattern(url);
    await unregister();
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: [pattern],
      js: FILES,
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: frameId !== 0,
      persistAcrossSessions: false,
    }]);
    await chrome.storage.session.set({ [PENDING_KEY]: { tabId, frameId, pattern, at: Date.now() } });
    return { ok: true, pattern };
  }

  async function settle(details) {
    let pending;
    try { pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY]; } catch { return; }
    if (!pending) return;
    const ours = pending.tabId === details.tabId && pending.frameId === details.frameId;
    if (ours || Date.now() - pending.at > PENDING_MAX_AGE_MS) await serialized(unregister);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'chippy-register-armed-reload') return false;
    const tabId = sender.tab?.id;
    if (tabId == null || !sender.url) {
      sendResponse({ ok: false, error: 'No sender tab for the armed reload' });
      return false;
    }
    serialized(() => register({ tabId, frameId: sender.frameId ?? 0, url: sender.url }))
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  // document_start injection has happened by DOMContentLoaded.
  chrome.webNavigation.onDOMContentLoaded.addListener((details) => { settle(details); });
  chrome.webNavigation.onErrorOccurred.addListener((details) => { settle(details); });

  global.chippyArmedReloadStartup = { SCRIPT_ID, FILES, originPattern };
})(globalThis);
