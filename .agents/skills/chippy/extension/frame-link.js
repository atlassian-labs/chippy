/* eslint-disable */
// Links a Chippy bridge in an iframe to the Chippy bridge in its parent frame.
// Each frame stays a separate helper client; this module only lets the helper
// show how those clients nest.
//
// Handshake, over window.postMessage:
//   child  → parent  { type: 'hello', clientId }        announce, with own id
//   parent → child   { type: 'parent', clientId, childClientId }
//   parent → frames  { type: 'ask' }                    children re-announce
// The parent answers only a window that is one of its own frames, and the
// child accepts an answer only from its own parent window. Each side reports
// what it saw: the child its parent's id, the parent its children's ids. The
// helper links two clients only when both reports agree.
//
// It also owns the panel policy for child frames: an iframe shows no Chippy
// panel unless the agent turned it on there with the helper's `activate`
// command. That choice is remembered in the frame's localStorage under the
// frame's address, so the panel returns when the frame loads again.
(function installFrameLink(global) {
  /** @type {ChippyPageRuntime} */
  const chippy = global.__CHIPPY = global.__CHIPPY || {};
  const SOURCE = 'chippy-frame';
  const MAX_CHILDREN = 64;

  function isTopFrame() {
    try { return global === global.parent; } catch { return true; }
  }

  // The index path from the top frame. Window.parent and Window.frames are
  // readable across origins, so the path is available in cross-origin frames.
  function framePath() {
    const path = [];
    try {
      /** @type {Window} */
      let current = global;
      while (current !== current.parent && path.length < 16) {
        const siblings = current.parent.frames;
        let index = -1;
        for (let i = 0; i < siblings.length; i += 1) {
          if (siblings[i] === current) { index = i; break; }
        }
        path.unshift(index);
        current = current.parent;
      }
    } catch {
      return null;
    }
    return path;
  }

  function ancestorOrigins() {
    try { return Array.from(global.location.ancestorOrigins || []); } catch { return []; }
  }

  function isOwnFrame(source) {
    if (!source) return false;
    try {
      for (let i = 0; i < global.frames.length; i += 1) {
        if (global.frames[i] === source) return true;
      }
    } catch {}
    return false;
  }

  function post(target, message, targetOrigin) {
    try {
      target.postMessage({ source: SOURCE, ...message }, targetOrigin && targetOrigin !== 'null' ? targetOrigin : '*');
    } catch {}
  }

  /**
   * @param {{ getClientId: () => string, onChange?: () => void }} options
   */
  function createFrameLink(options) {
    const top = isTopFrame();
    let parentClientId = null;
    let parentOrigin = null;
    /** @type {Map<string, string>} child client id → child origin */
    const children = new Map();
    let started = false;

    function changed() {
      try { options.onChange?.(); } catch {}
    }

    function announce() {
      if (top) return;
      post(global.parent, { type: 'hello', clientId: options.getClientId() }, ancestorOrigins()[0]);
    }

    function askChildren() {
      try {
        for (let i = 0; i < global.frames.length; i += 1) post(global.frames[i], { type: 'ask' });
      } catch {}
    }

    function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== SOURCE || typeof data.type !== 'string') return;
      if (data.type === 'hello' && typeof data.clientId === 'string' && isOwnFrame(event.source)) {
        const known = children.get(data.clientId) === event.origin;
        if (!known && children.size < MAX_CHILDREN) {
          children.set(data.clientId, event.origin);
          changed();
        }
        post(event.source, { type: 'parent', clientId: options.getClientId(), childClientId: data.clientId }, event.origin);
        return;
      }
      if (data.type === 'parent' && !top && event.source === global.parent
        && typeof data.clientId === 'string' && data.childClientId === options.getClientId()) {
        if (parentClientId === data.clientId && parentOrigin === event.origin) return;
        parentClientId = data.clientId;
        parentOrigin = event.origin;
        changed();
        return;
      }
      if (data.type === 'ask' && !top && event.source === global.parent) announce();
    }

    return {
      start() {
        if (started) return;
        started = true;
        global.addEventListener('message', onMessage);
        announce();
        askChildren();
      },
      stop() {
        started = false;
        global.removeEventListener('message', onMessage);
      },
      // Called when the bridge (re)connects, so a frame loaded earlier or later
      // than its parent still links.
      refresh() {
        announce();
        askChildren();
      },
      describe() {
        return {
          isTop: top,
          path: framePath(),
          ancestorOrigins: ancestorOrigins(),
          parentClientId,
          parentOrigin,
          childClientIds: Array.from(children.keys()),
        };
      },
    };
  }

  const SHOWN_FRAMES_KEY = '__chippyShownFrames';
  const MAX_SHOWN_FRAMES = 50;

  function frameAddress() {
    try { return global.location.origin + global.location.pathname; } catch { return null; }
  }

  function readShownFrames() {
    try {
      const list = JSON.parse(global.localStorage.getItem(SHOWN_FRAMES_KEY) || '[]');
      return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  function createFramePanelPreference() {
    const child = !isTopFrame();

    function remembered() {
      if (!child) return false;
      const address = frameAddress();
      return Boolean(address) && readShownFrames().includes(address);
    }

    return {
      isChild: child,
      remembered,
      // Saves whether the agent wants the panel in this frame. Storage can be
      // unavailable, as in a sandboxed frame; the choice then lasts until reload.
      remember(shown) {
        if (!child) return;
        const address = frameAddress();
        if (!address) return;
        try {
          const list = readShownFrames().filter((item) => item !== address);
          if (shown) list.push(address);
          if (list.length) global.localStorage.setItem(SHOWN_FRAMES_KEY, JSON.stringify(list.slice(-MAX_SHOWN_FRAMES)));
          else global.localStorage.removeItem(SHOWN_FRAMES_KEY);
        } catch {}
      },
      // Whether an integration's request to show the panel applies. In a child
      // frame it applies only when the agent chose this frame, and it never
      // hides a panel the agent showed.
      gate(requested, current) {
        if (!child || !requested) return Boolean(requested);
        return remembered() || Boolean(current);
      },
    };
  }

  chippy.createFrameLink = createFrameLink;
  chippy.createFramePanelPreference = createFramePanelPreference;
})(window);
