/* eslint-disable */
(function installLayoutLab(global) {
  const chippy = global.__CHIPPY = global.__CHIPPY || {};
  // Always reinstall — guards caused stale code to win after extension reload.

  // p1 = red, p2 = green. No p3.
  const MARKER_IDS = ['1', '2'];
  const CHIPPY_LOGO = "<svg data-chippy-logo aria-hidden=\"true\" width=\"24\" height=\"24\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" fill=\"none\">\n  <defs>\n    <linearGradient id=\"chippy-trace-blue\" x1=\"4\" y1=\"25\" x2=\"28\" y2=\"7\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#1558BC\"/><stop offset=\"1\" stop-color=\"#357DE8\"/></linearGradient>\n    <linearGradient id=\"chippy-trace-light\" x1=\"4\" y1=\"9\" x2=\"27\" y2=\"9\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#85B8FF\"/><stop offset=\"1\" stop-color=\"#357DE8\"/></linearGradient>\n  </defs>\n  <style>\n    @keyframes chippy-trace-reveal { from { opacity: .45; transform: translateY(-1.5px); } to { opacity: 1; transform: translateY(0); } }\n    .chippy-trace-cut { animation: chippy-trace-reveal 650ms ease-out both; }\n    @media (prefers-reduced-motion: reduce) { .chippy-trace-cut { animation: none; } }\n  </style>\n  <path d=\"M4 9 16 1.5 28 9 21 13.4 16 10.3 11 13.4v5.2l5 3.1 5-3.1 7 4.4L16 30.5 4 23Z\" fill=\"url(#chippy-trace-blue)\"/>\n  <path class=\"chippy-trace-cut\" d=\"M4 9 16 1.5 28 9 21 13.4 16 10.3 11 13.4Z\" fill=\"url(#chippy-trace-light)\"/>\n  <path d=\"m11 18.6 5 3.1 5-3.1 7 4.4-12 7.5-5-3.1Z\" fill=\"#1868DB\"/>\n</svg>";
  const MARKER_COLORS = { '1': '#F87168', '2': '#4BCE97' };
  const MARKER_SIZE = 36;
  const DOCK_GAP = 12;
  const PANEL_WIDTH = 340;
  const PANEL_LAUNCHER_SIZE = 48;
  // How close (px) to dock centre to snap back
  const DOCK_SNAP_RADIUS = 80;

  function emitLabEvent(reason, detail = {}) {
    global.dispatchEvent(
      new CustomEvent('layout-lab:update', {
        detail: {
          reason,
          ...detail,
        },
      }),
    );
  }

  // ─── React fiber helpers ──────────────────────────────────────────────────

  // ─── Fiber-walk shims — implementations live in src/layout-lab/fiber-walk.ts
  // bundled into __AVALANCHE__.layoutLab. Fallbacks are intentionally minimal:
  // if the bundle is missing, the lab degrades gracefully (no probes resolve)
  // rather than carrying a duplicated fiber-walk.
  function getLab() { return (window.__AVALANCHE__ && window.__AVALANCHE__.layoutLab) || null; }
  function getFiberKey(node) { const l = getLab(); return l ? l.getFiberKey(node) : null; }
  function getFiber(node) { const l = getLab(); return l ? l.getFiber(node) : null; }
  function getDisplayName(type) { const l = getLab(); return l ? l.getDisplayName(type) : null; }
  function isUserComponent(fiber) { const l = getLab(); return l ? l.isUserComponent(fiber) : false; }
  function getNearestFiber(domNode) { const l = getLab(); return l ? l.getNearestFiber(domNode) : null; }
  function getNearestComponent(domNode) { const l = getLab(); return l ? l.getNearestComponent(domNode) : null; }

  function getHookSummary(fiber) { const l = getLab(); return l ? l.getHookSummary(fiber) : { hookCount: 0, hookCountTruncated: false, hookCountMax: 500 }; }
  function getOwnerChain(fiber) { const l = getLab(); return l ? l.getOwnerChain(fiber) : []; }
  function getOwnerFibers(fiber) { const l = getLab(); return l ? l.getOwnerFibers(fiber) : []; }
  function getFiberDomNode(fiber) { const l = getLab(); return l ? l.getFiberDomNode(fiber) : null; }
  function getReturnComponentChain(fiber) { const l = getLab(); return l ? l.getReturnComponentChain(fiber) : []; }
  function getReturnComponentFibers(fiber) { const l = getLab(); return l ? l.getReturnComponentFibers(fiber) : []; }
  function describeSource(source) { const l = getLab(); return l ? l.describeSource(source) : null; }
  function describeFiberTarget(fiber, domNode) { const l = getLab(); return l ? l.describeFiberTarget(fiber, domNode) : null; }
  function describeComponent(fiber) { const l = getLab(); return l ? l.describeComponent(fiber) : null; }
  function describeContext(fiber) {
    const l = getLab();
    const describe = l?.describeContext;
    return typeof describe === 'function' ? describe(fiber) : null;
  }
  function findBoundaryFibers(fiber) { const l = getLab(); return typeof l?.findBoundaryFibers === 'function' ? l.findBoundaryFibers(fiber) : { error: null, suspense: null }; }
  function normalizeProbeAnnotation(value) {
    const l = getLab();
    if (typeof l?.normalizeProbeAnnotation === 'function') return l.normalizeProbeAnnotation(value);
    const intent = ['explain', 'investigate', 'change'].includes(value?.intent) ? value.intent : null;
    return { intent, comment: typeof value?.comment === 'string' ? value.comment.slice(0, 2000) : '' };
  }

  // ─── Overlay helpers ──────────────────────────────────────────────────────

  // All Chippy UI elements carry data-chippy-ui so they can be filtered out uniformly
  function isOverlay(node) {
    return Boolean(node?.closest?.('[data-chippy-ui]'));
  }

  function hideOverlayWhile(fn) {
    const els = document.querySelectorAll('[data-chippy-ui]');
    els.forEach((el) => { el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; });
    const result = fn();
    els.forEach((el) => { el.style.visibility = ''; el.style.pointerEvents = ''; });
    return result;
  }

  function ownsProbeDockUi() {
    const ui = chippy.config?.ui || window.__CHIPPY_OWNER__?.ui || null;
    return ui !== 'none';
  }

  function ownsProbePanelUi() {
    const ui = chippy.config?.ui || window.__CHIPPY_OWNER__?.ui || null;
    return ui !== 'storybook-panel' && ui !== 'none';
  }

  function removeInPageUi() {
    // Storybook addon owns visualization, so remove only the in-page panel.
    // Keep its standalone probe dock/markers in the preview frame.
    document.querySelector('[data-layout-lab-panel]')?.remove();
  }

  function renderDockSlots() {
    return MARKER_IDS.map((id) => {
      const color = MARKER_COLORS[id] || '#A9ABAF';
      return `<div style="
        width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;border-radius:50%;
        border:2px dashed ${color};opacity:0.35;
        display:flex;align-items:center;justify-content:center;
        color:${color};font-size:12px;font-weight:700;
      ">${id}</div>`;
    }).join('');
  }

  function ensureDock() {
    if (!ownsProbeDockUi()) {
      document.querySelector('[data-layout-lab-dock]')?.remove();
      return null;
    }

    // In-page panel owners use one unified surface. Their dock is rendered
    // inside the expanded panel, so the collapsed state is genuinely one small
    // launcher instead of a launcher plus a second floating probe tray.
    if (ownsProbePanelUi()) {
      const dock = document.querySelector('[data-layout-lab-panel] [data-layout-lab-dock]');
      document.querySelectorAll('body > [data-layout-lab-dock]').forEach((node) => node.remove());
      return dock;
    }

    // Storybook renders probe details in the manager frame. It still needs a
    // standalone dock inside the preview frame where the markers can be dragged.
    let dock = document.querySelector('[data-layout-lab-dock]');
    if (!dock) {
      dock = document.createElement('div');
      dock.setAttribute('data-layout-lab-dock', 'true');
      dock.setAttribute('data-chippy-ui', 'true');
      dock.style.cssText = `
        position:fixed;left:50%;bottom:20px;transform:translateX(-50%);
        display:flex;align-items:center;gap:${DOCK_GAP}px;
        padding:10px 18px;border-radius:999px;
        background:rgba(15,23,42,0.88);backdrop-filter:blur(8px);
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        pointer-events:none;z-index:2147483646;
      `;
      dock.innerHTML = renderDockSlots();
      document.body.appendChild(dock);
    }
    return dock;
  }

  const existingPanel = document.querySelector('[data-layout-lab-panel]');
  const panelState = chippy.__layoutLabPanelState || {
    side: existingPanel?.style.left ? 'left' : 'right',
    expanded: existingPanel?.getAttribute('data-chippy-panel-expanded') === 'true',
    settingsExpanded: Boolean(existingPanel?.querySelector('[data-chippy-settings-section]')),
  };
  chippy.__layoutLabPanelState = panelState;

  function applyPanelStyle(panel) {
    panel.setAttribute('data-chippy-panel-expanded', panelState.expanded ? 'true' : 'false');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Chippy');
    panel.style.cssText = panelState.expanded ? `
      position:fixed;${panelState.side}:20px;bottom:20px;width:${PANEL_WIDTH}px;
      max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;
      pointer-events:auto;padding:14px;border-radius:18px;
      background:#1F1F21;color:#CECFD2;
      font:12px/1.5 'Atlassian Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 16px 40px rgba(0,0,0,0.35);
      z-index:2147483647;
    ` : `
      position:fixed;${panelState.side}:20px;bottom:20px;
      width:${PANEL_LAUNCHER_SIZE}px;height:${PANEL_LAUNCHER_SIZE}px;
      overflow:visible;pointer-events:auto;padding:0;border-radius:50%;
      background:transparent;color:#CECFD2;
      font:12px/1.5 'Atlassian Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:none;
      z-index:2147483647;
    `;
  }

  function ensurePanel() {
    if (!ownsProbePanelUi()) {
      document.querySelector('[data-layout-lab-panel]')?.remove();
      return null;
    }
    let panel = document.querySelector('[data-layout-lab-panel]');
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('data-layout-lab-panel', 'true');
      panel.setAttribute('data-chippy-ui', 'true');
      applyPanelStyle(panel);
      document.body.appendChild(panel);
    }
    return panel;
  }

  function syncDockedMarkers() {
    const dock = ensureDock();
    MARKER_IDS.forEach((id, index) => {
      const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
      if (!marker || !marker.__docked) return;
      if (!dock) {
        marker.style.display = 'none';
        return;
      }
      const slot = getDockSlotPos(index);
      if (!slot) {
        marker.style.display = 'none';
        return;
      }
      marker.style.display = '';
      setMarkerViewportPos(marker, slot.x, slot.y);
    });
  }

  function setPanelExpanded(expanded) {
    panelState.expanded = Boolean(expanded);
    if (!panelState.expanded) panelState.settingsExpanded = false;
    updatePanel();
    emitLabEvent(panelState.expanded ? 'panel-expanded' : 'panel-collapsed', {
      panelExpanded: panelState.expanded,
    });
  }

  function togglePanelSide() {
    panelState.side = panelState.side === 'right' ? 'left' : 'right';
    const panel = document.querySelector('[data-layout-lab-panel]');
    if (panel) {
      panel.style.left = panelState.side === 'left' ? '20px' : '';
      panel.style.right = panelState.side === 'right' ? '20px' : '';
    }
    syncDockedMarkers();
    emitLabEvent('toggle-panel-side', { panelSide: panelState.side });
  }

  // ─── Probe resolution ─────────────────────────────────────────────────────

  function probePoint(x, y) {
    return hideOverlayWhile(() => {
      const elements = document.elementsFromPoint(x, y);
      const results = [];

      for (const el of elements) {
        if (isOverlay(el)) continue;
        const exactFiber = getNearestFiber(el);
        const componentFiber = getNearestComponent(el);
        results.push({
          exact: describeFiberTarget(exactFiber, el),
          component: describeComponent(componentFiber),
          _el: el,
        });
      }

      const best = results.find((result) => result.component || result.exact) || results[0] || null;
      // Strip internal _el before returning
      return {
        best: best ? { exact: best.exact, component: best.component } : null,
        all: results.slice(0, 6).map(({ exact, component }) => ({ exact, component })),
        _bestEl: best?._el || null,
      };
    });
  }

  // ─── Element highlight ────────────────────────────────────────────────────

  // One highlight element per marker — a very faint tinted overlay on the target element.
  const _highlights = {};

  // Per-marker scroll listener cleanup — keyed by marker id
  const _scrollListeners = {};

  function attachScrollListeners(id, targetEl, color) {
    // Remove any previous listeners for this marker
    detachScrollListeners(id);

    if (!targetEl) return;

    const listeners = [];
    let current = targetEl.parentNode;

    // Walk up to document.body only — page scroll is handled automatically
    // because the highlight is position:absolute in document coordinates.
    // Only internal scrollable containers need explicit listeners.
    while (current && current !== document.body && current !== document) {
      const node = current;
      const cb = () => {
        const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
        if (!marker || marker.__docked || marker.__dragging) return;
        const currentTarget = marker.__syncTargetEl || marker.__probe?._targetEl || marker.__baseEl;
        if (!currentTarget) return;
        syncMarkerToTarget(marker, currentTarget);
        updateHighlight(id, currentTarget, color);
        updateParentBorder();
      };
      node.addEventListener('scroll', cb, { passive: true });
      listeners.push({ node, cb });
      current = current.parentNode;
    }

    _scrollListeners[id] = listeners;
  }

  function detachScrollListeners(id) {
    const listeners = _scrollListeners[id];
    if (!listeners) return;
    listeners.forEach(({ node, cb }) => {
      try { node.removeEventListener('scroll', cb); } catch {}
    });
    delete _scrollListeners[id];
  }

  function getHighlightEl(id) {
    if (!_highlights[id]) {
      const el = document.createElement('div');
      el.setAttribute('data-layout-lab-highlight', id);
      el.setAttribute('data-chippy-ui', 'true');
      el.style.cssText = `
        position:absolute;pointer-events:none;z-index:2147483646;
        border-radius:3px;transition:opacity 80ms ease;
        display:none;
      `;
      document.documentElement.appendChild(el);
      _highlights[id] = el;
    }
    return _highlights[id];
  }

  function updateHighlight(id, targetEl, color) {
    const hl = getHighlightEl(id);
    if (!targetEl) { hl.style.display = 'none'; return; }
    const r = targetEl.getBoundingClientRect();
    if (!r || r.width === 0) { hl.style.display = 'none'; return; }
    // Convert viewport rect to document-absolute coords
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const hex = color.replace('#', '');
    const rb = parseInt(hex.slice(0,2),16), gb = parseInt(hex.slice(2,4),16), bb = parseInt(hex.slice(4,6),16);
    hl.style.cssText = `
      position:absolute;pointer-events:none;z-index:2147483646;
      border-radius:3px;transition:opacity 80ms ease;
      left:${r.left + scrollX}px;top:${r.top + scrollY}px;
      width:${r.width}px;height:${r.height}px;
      background:rgba(${rb},${gb},${bb},0.08);
      outline:1.5px solid rgba(${rb},${gb},${bb},0.28);
      display:block;
    `;
  }

  function clearHighlight(id) {
    const hl = _highlights[id];
    if (hl) hl.style.display = 'none';
  }

  // ─── Boundary highlight (on-page location of a collateral boundary) ─────────

  // Boundary fibers (Suspense, error boundaries, OwnerMark) are often composite
  // fibers with no direct DOM node. Find the nearest host DOM element: first walk
  // DOWN the child/sibling subtree to the first hostable element (the boundary's
  // rendered content), then fall back to walking UP the return chain.
  function nearestHostElement(fiber) {
    if (!fiber) return null;
    const seen = new Set();
    const queue = [fiber];
    while (queue.length) {
      const f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      if (f.stateNode instanceof Element) return f.stateNode;
      if (f.child) queue.push(f.child);
      if (f.sibling && f !== fiber) queue.push(f.sibling);
      if (seen.size > 400) break;
    }
    let cur = fiber.return;
    let hops = 0;
    while (cur && hops < 400) {
      if (cur.stateNode instanceof Element) return cur.stateNode;
      cur = cur.return;
      hops += 1;
    }
    return null;
  }

  const BOUNDARY_HIGHLIGHT_COLORS = { error: '#ae2e24', suspense: '#BF63F3' };
  const BOUNDARY_HIGHLIGHT_ID = '__boundary';

  function providerKindAccent(kind) {
    const providers = getLab()?.getContextProviders?.() || [];
    for (const provider of providers) {
      const match = (provider.kinds || []).find((entry) => entry.kind === kind);
      if (match?.accent) return match.accent;
    }
    return null;
  }

  // Highlight a collateral boundary's DOM subtree on the page so the user can see
  // WHERE it is, and scroll it into view. Returns the located element (or null).
  function highlightBoundary(markerId, kind) {
    const markerEl = document.querySelector(`[data-layout-lab-marker="${markerId}"]`);
    const fibers = findBoundaryFibers(markerEl?.__probe?._bestFiber || null);
    const el = nearestHostElement(fibers[kind]);
    if (!el) { clearHighlight(BOUNDARY_HIGHLIGHT_ID); return null; }
    updateHighlight(BOUNDARY_HIGHLIGHT_ID, el, BOUNDARY_HIGHLIGHT_COLORS[kind] || providerKindAccent(kind) || '#CECFD2');
    // keep the overlay tracking scroll/resize while it is shown
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (_) {}
    return el;
  }

  // ─── Shared-parent border ─────────────────────────────────────────────────

  let _parentBorderEl = null;

  function getParentBorderEl() {
    if (!_parentBorderEl) {
      _parentBorderEl = document.createElement('div');
      _parentBorderEl.setAttribute('data-layout-lab-parent-border', 'true');
      _parentBorderEl.setAttribute('data-chippy-ui', 'true');
      _parentBorderEl.style.cssText = `
        position:absolute;pointer-events:none;z-index:2147483645;
        border:2px dashed rgba(148,163,184,0.55);border-radius:4px;
        display:none;
      `;
      document.documentElement.appendChild(_parentBorderEl);
    }
    return _parentBorderEl;
  }

  function findNearestSharedParentEl(fiberA, fiberB) {
    if (!fiberA || !fiberB) return null;
    // Walk return chain of A, collect stateNodes
    const setA = new Set();
    let cur = fiberA.return;
    while (cur) {
      if (cur.stateNode && cur.stateNode instanceof Element) setA.add(cur.stateNode);
      cur = cur.return;
    }
    // Walk return chain of B, first match wins
    cur = fiberB.return;
    while (cur) {
      if (cur.stateNode && cur.stateNode instanceof Element && setA.has(cur.stateNode)) {
        return cur.stateNode;
      }
      cur = cur.return;
    }
    return null;
  }


  function getCommonParentInspection() {
    const m1 = document.querySelector('[data-layout-lab-marker="1"]');
    const m2 = document.querySelector('[data-layout-lab-marker="2"]');
    if (!m1 || !m2 || m1.__docked || m2.__docked) return null;
    const f1 = m1.__probe?._bestFiber;
    const f2 = m2.__probe?._bestFiber;
    const sharedEl = findNearestSharedParentEl(f1, f2);
    if (!sharedEl) return null;
    return chippy.inspectReact?.inspectNode?.(sharedEl) || null;
  }

  function updateParentBorder() {
    const pb = getParentBorderEl();
    const m1 = document.querySelector('[data-layout-lab-marker="1"]');
    const m2 = document.querySelector('[data-layout-lab-marker="2"]');
    if (!m1 || !m2 || m1.__docked || m2.__docked) { pb.style.display = 'none'; return; }
    const f1 = m1.__probe?._bestFiber;
    const f2 = m2.__probe?._bestFiber;
    const sharedEl = findNearestSharedParentEl(f1, f2);
    if (!sharedEl) { pb.style.display = 'none'; return; }
    const r = sharedEl.getBoundingClientRect();
    if (!r || r.width === 0) { pb.style.display = 'none'; return; }
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    pb.style.cssText = `
      position:absolute;pointer-events:none;z-index:2147483645;
      border:2px dashed rgba(148,163,184,0.55);border-radius:4px;
      left:${r.left + scrollX - 3}px;top:${r.top + scrollY - 3}px;
      width:${r.width + 6}px;height:${r.height + 6}px;
      display:block;
    `;
  }

  // ─── Marker lifecycle ─────────────────────────────────────────────────────

  function scrollOffset() {
    return {
      x: window.scrollX || document.documentElement.scrollLeft,
      y: window.scrollY || document.documentElement.scrollTop,
    };
  }

  function setPos(marker, x, y) {
    // Active probes use document-absolute coordinates; docked probes use viewport coordinates.
    marker.__x = x;
    marker.__y = y;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
  }

  function setMarkerViewportPos(marker, x, y) {
    marker.__x = x;
    marker.__y = y;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
  }

  function storeMarkerAnchor(marker, targetEl) {
    if (!marker || !targetEl) return;
    const mr = marker.getBoundingClientRect();
    const tr = targetEl.getBoundingClientRect();
    // Probe tip is marker left/bottom.
    marker.__anchorDx = mr.left - tr.left;
    marker.__anchorDy = mr.bottom - tr.top;
    marker.__syncTargetEl = targetEl;
  }

  function syncMarkerToTarget(marker, targetEl) {
    if (!marker || !targetEl) return;
    const tr = targetEl.getBoundingClientRect();
    const { x: sx, y: sy } = scrollOffset();
    const tipX = tr.left + (marker.__anchorDx || 0);
    const tipY = tr.top + (marker.__anchorDy || 0);
    setPos(marker, tipX + sx, tipY + sy - MARKER_SIZE);
  }

  function getDockSlotPos(index) {
    // Dock is position:fixed, so docked markers use viewport coordinates too.
    const dock = ensureDock();
    if (!dock) return null;
    if (ownsProbePanelUi()) {
      const id = MARKER_IDS[index];
      const slot = dock.querySelector(`[data-chippy-probe-dock-slot="${id}"]`);
      if (!slot) return null;
      const slotRect = slot.getBoundingClientRect();
      return {
        x: slotRect.left + (slotRect.width - MARKER_SIZE) / 2,
        y: slotRect.top + (slotRect.height - MARKER_SIZE) / 2,
      };
    }
    const dockRect = dock.getBoundingClientRect();
    const totalWidth = MARKER_IDS.length * MARKER_SIZE + (MARKER_IDS.length - 1) * DOCK_GAP;
    const startX = dockRect.left + (dockRect.width - totalWidth) / 2;
    return {
      x: startX + index * (MARKER_SIZE + DOCK_GAP),
      y: dockRect.top + (dockRect.height - MARKER_SIZE) / 2,
    };
  }

  function snapToDock(marker) {
    const id = marker.getAttribute('data-layout-lab-marker');
    const index = MARKER_IDS.indexOf(id);
    marker.__docked = true;
    marker.__probe = null;
    marker.__baseEl = null;
    marker.__levelOffset = 0;
    detachScrollListeners(id);
    // applyMarkerStyle rewrites cssText — call setPos after
    applyMarkerStyle(marker);
    const slot = getDockSlotPos(index);
    if (!slot) {
      marker.style.display = 'none';
      clearHighlight(id);
      updateParentBorder();
      updatePanel();
      emitLabEvent('marker-docked', { markerId: id });
      return;
    }
    setMarkerViewportPos(marker, slot.x, slot.y);
    clearHighlight(id);
    updateParentBorder();
    updatePanel();
    emitLabEvent('marker-docked', { markerId: id });
  }

  function isNearDock(clientX, clientY) {
    const dock = document.querySelector('[data-layout-lab-dock]');
    if (!dock) return false;
    const slots = Array.from(dock.querySelectorAll('[data-chippy-probe-dock-slot]'));
    if (slots.length > 0) {
      return slots.some((slot) => {
        const r = slot.getBoundingClientRect();
        return Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)) < DOCK_SNAP_RADIUS;
      });
    }
    const r = dock.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return Math.hypot(clientX - cx, clientY - cy) < DOCK_SNAP_RADIUS;
  }

  function applyMarkerStyle(marker) {
    const id = marker.getAttribute('data-layout-lab-marker');
    const color = MARKER_COLORS[id] || '#A9ABAF';
    const docked = marker.__docked;
    const S = MARKER_SIZE;
    marker.style.cssText = `
      position:${docked ? 'fixed' : 'absolute'};width:${S}px;height:${S}px;
      border:0;border-radius:${docked ? '50%' : '50% 50% 50% 0'};
      background:${docked ? 'rgba(71,85,105,0.55)' : color};
      color:#fff;font-weight:700;font-size:14px;
      box-shadow:${docked ? 'none' : '0 4px 16px rgba(0,0,0,0.30)'};
      pointer-events:auto;cursor:grab;
      touch-action:none;user-select:none;
      transition:border-radius 150ms ease, background 150ms ease, box-shadow 150ms ease;
      z-index:2147483647;opacity:${docked ? 0.55 : 1};
      display:flex;align-items:center;justify-content:center;
    `;
  }

  function getMarkerState(id) {
    const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
    if (!marker) return null;
    const annotation = normalizeProbeAnnotation({ intent: marker.__intent, comment: marker.__comment });
    return {
      id,
      docked: marker.__docked ?? true,
      position: { x: marker.__x ?? null, y: marker.__y ?? null },
      ...annotation,
      probe: marker.__probe || null,
    };
  }

  function setMarkerAnnotation(id, patch = {}) {
    const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
    if (!marker) return null;
    const current = normalizeProbeAnnotation({ intent: marker.__intent, comment: marker.__comment });
    const next = normalizeProbeAnnotation({
      intent: patch.intent === undefined ? current.intent : patch.intent,
      comment: patch.comment === undefined ? current.comment : patch.comment,
    });
    marker.__intent = next.intent;
    marker.__comment = next.comment;
    emitLabEvent('marker-annotation-change', { markerId: id, ...next });
    return { id, ...next };
  }

  function getAllMarkerStates() {
    return MARKER_IDS.reduce((acc, id) => {
      const state = getMarkerState(id);
      if (state) acc[id] = state;
      return acc;
    }, {});
  }

  // Walk DOM parentElement chain by N steps (for level walking — works on any site, React or not)
  function getDomElAtLevel(baseEl, offset) {
    if (!baseEl || offset === 0) return baseEl;
    if (offset > 0) {
      // Go up — skip elements that have zero size (wrappers with no visual box)
      let cur = baseEl.parentElement;
      let steps = offset;
      while (cur && steps > 0) {
        const r = cur.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) steps--;
        if (steps > 0) cur = cur.parentElement;
      }
      return cur || baseEl;
    }
    // Go down — first visible child
    let cur = baseEl.firstElementChild;
    let steps = -offset;
    while (cur && steps > 0) {
      const r = cur.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) steps--;
      if (steps > 0) cur = cur.firstElementChild || cur.nextElementSibling;
    }
    return cur || baseEl;
  }

  function refreshMarker(marker, reason = 'refresh-marker') {
    const id = marker.getAttribute('data-layout-lab-marker');
    const color = MARKER_COLORS[id] || '#A9ABAF';
    const rect = marker.getBoundingClientRect();
    // Probe from the sharp corner (bottom-left tip), not the centre
    const cx = rect.left;
    const cy = rect.bottom;

    const levelOffset = marker.__levelOffset || 0;
    const fiberOffset = marker.__fiberOffset || 0;

    // On level-walk, reuse the stored base element — don't re-probe
    // On fiber-walk (up/down), target fiber from return chain instead of DOM walk
    // On normal drag/drop, always re-probe and store fresh base element
    let rawProbe = marker.__probe;
    let baseEl = marker.__baseEl || null;

    if (reason === 'marker-level-up' || reason === 'marker-level-down') {
      // DOM level walk — reuse existing base element
      if (!baseEl && rawProbe?._bestEl) {
        baseEl = rawProbe._bestEl;
        marker.__baseEl = baseEl;
      }
    } else if (reason === 'marker-fiber-up' || reason === 'marker-fiber-down') {
      // Fiber parent walk — reuse existing probe, pick fiber from parents array
      if (!baseEl && rawProbe?._bestEl) {
        baseEl = rawProbe._bestEl;
        marker.__baseEl = baseEl;
      }
    } else if (reason === 'marker-scroll') {
      // Scroll syncing is handled by moving the marker to the tracked target, not by re-probing.
    } else {
      // Fresh probe from current position
      rawProbe = probePoint(cx, cy);
      baseEl = rawProbe?._bestEl || null;
      marker.__baseEl = baseEl;
      // Reset both offsets on fresh probe
      marker.__levelOffset = 0;
      marker.__fiberOffset = 0;
      marker.__fiberReturnChain = null;
    }

    // Walk DOM to target element at current DOM level offset
    const targetEl = getDomElAtLevel(baseEl, levelOffset);

    // Determine best fiber: fiber-walk overrides DOM-walk fiber
    const baseFiber = targetEl ? getNearestComponent(targetEl) : null;
    let bestFiber;
    if (fiberOffset > 0) {
      // Walk fiber return chain using actual fiber references (not description objects)
      if (!marker.__fiberReturnChain || reason !== 'marker-fiber-up' && reason !== 'marker-fiber-down') {
        marker.__fiberReturnChain = baseFiber ? getReturnComponentFibers(baseFiber) : [];
      }
      const chain = marker.__fiberReturnChain;
      const clampedOffset = Math.min(fiberOffset, chain.length);
      marker.__fiberOffset = clampedOffset; // clamp so panel stays in sync
      bestFiber = chain[clampedOffset - 1] || baseFiber;
    } else {
      marker.__fiberReturnChain = null; // reset chain on return to base
      bestFiber = baseFiber;
    }

    // Store full fiber parent chain for up/down navigation
    marker.__fiberParents = bestFiber ? getReturnComponentChain(bestFiber) : [];
    // Store actual owner fiber references for owner-click navigation
    marker.__ownerFibers = bestFiber ? getOwnerFibers(bestFiber) : [];

    // Determine highlight target: when fiber-walking, find the actual DOM node rendered by that fiber
    const highlightEl = fiberOffset > 0
      ? (getFiberDomNode(bestFiber) || targetEl)
      : targetEl;

    marker.__probe = rawProbe
      ? { ...rawProbe, _bestFiber: bestFiber, _targetEl: targetEl, best: { exact: describeFiberTarget(getNearestFiber(targetEl), targetEl), component: describeComponent(bestFiber) } }
      : null;

    updateHighlight(id, highlightEl, color);
    storeMarkerAnchor(marker, highlightEl);
    updateParentBorder();
    updatePanel();
    // Reattach scroll listeners whenever the target element changes
    attachScrollListeners(id, highlightEl, color);
    emitLabEvent(reason, { markerId: id, marker: getMarkerState(id) });
  }

  // Key handler attached during drag for level walking (left/right = DOM) and fiber walking (up/down = fiber parents)
  function makeDragKeyHandler(marker) {
    return function onKey(event) {
      if (!marker.__dragging) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        marker.__levelOffset = (marker.__levelOffset || 0) + 1; // go up DOM
        refreshMarker(marker, 'marker-level-up');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        marker.__levelOffset = Math.max(0, (marker.__levelOffset || 0) - 1); // go down DOM
        refreshMarker(marker, 'marker-level-down');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        marker.__fiberOffset = (marker.__fiberOffset || 0) + 1; // go up fiber parents
        refreshMarker(marker, 'marker-fiber-up');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        marker.__fiberOffset = Math.max(0, (marker.__fiberOffset || 0) - 1); // go down fiber parents
        refreshMarker(marker, 'marker-fiber-down');
      }
    };
  }

  function makeMarkerDraggable(marker) {
    let keyHandler = null;

    marker.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      marker.__dragging = true;
      marker.__levelOffset = marker.__levelOffset || 0;
      marker.__fiberOffset = marker.__fiberOffset || 0;
      marker.__startX = event.clientX;
      marker.__startY = event.clientY;
      marker.setPointerCapture(event.pointerId);
      // Undock if was docked — applyMarkerStyle rewrites cssText, so capture offsets AFTER
      if (marker.__docked) {
        const rect = marker.getBoundingClientRect();
        marker.__docked = false;
        applyMarkerStyle(marker);
        const { x: sx, y: sy } = scrollOffset();
        setPos(marker, rect.left + sx, rect.top + sy);
      }
      // Capture grab offset relative to current rendered position
      marker.__ox = event.clientX - marker.getBoundingClientRect().left;
      marker.__oy = event.clientY - marker.getBoundingClientRect().top;
      marker.style.cursor = 'grabbing';
      marker.style.transform = 'scale(1.08)';
      // Attach key handler for level walking
      keyHandler = makeDragKeyHandler(marker);
      document.addEventListener('keydown', keyHandler);
      emitLabEvent('marker-drag-start', { markerId: marker.getAttribute('data-layout-lab-marker') });
    });

    marker.addEventListener('pointermove', (event) => {
      if (!marker.__dragging) return;
      const { x: sx, y: sy } = scrollOffset();
      setPos(marker, event.clientX - marker.__ox + sx, event.clientY - marker.__oy + sy);
      refreshMarker(marker, 'marker-dragging');
    });

    marker.addEventListener('pointerup', (event) => {
      if (!marker.__dragging) return;
      marker.__dragging = false;
      marker.releasePointerCapture(event.pointerId);
      marker.style.transform = 'scale(1)';
      if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }

      const dropX = event.clientX;
      const dropY = event.clientY;

      if (isNearDock(dropX, dropY)) {
        snapToDock(marker);
      } else {
        // applyMarkerStyle rewrites cssText — must call setPos AFTER it
        applyMarkerStyle(marker);
        const { x: sx, y: sy } = scrollOffset();
        setPos(marker, dropX - marker.__ox + sx, dropY - marker.__oy + sy);
        // No re-probe on mouse up — the last drag position already has the probe computed
      }
    });
  }

  function createMarker(id, index) {
    // Markers go on <html> as position:absolute — tracks with document scroll naturally
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.textContent = id;
    marker.setAttribute('data-layout-lab-marker', id);
    marker.setAttribute('data-chippy-ui', 'true');
    marker.__docked = true;
    marker.__levelOffset = 0;
    marker.__intent = null;
    marker.__comment = '';
    applyMarkerStyle(marker);
    document.documentElement.appendChild(marker);
    makeMarkerDraggable(marker);

    const dockSlot = getDockSlotPos(index);
    marker.__docked = true;
    applyMarkerStyle(marker);
    marker.style.display = dockSlot ? '' : 'none';
    if (dockSlot) setMarkerViewportPos(marker, dockSlot.x, dockSlot.y);
    return marker;
  }

  // ─── Panel ────────────────────────────────────────────────────────────────

  const PROBE_LABELS = { '1': 'P1', '2': 'P2' };
  const PROBE_INTENT_LABELS = {
    explain: 'Explain',
    investigate: 'Investigate',
    change: 'Change',
  };

  function contextUiEnabled() {
    return chippy.config?.contextUiEnabled !== false;
  }

  function renderContextField(label, value) {
    if (value == null || value === '') return '';
    return `<div style="display:grid;grid-template-columns:58px 1fr;gap:5px;align-items:baseline;">
      <span style="color:#A9ABAF;font-size:9px;text-transform:uppercase;letter-spacing:.04em;">${escapeAttr(label)}</span>
      <span style="color:#CECFD2;font-family:monospace;font-size:10px;overflow-wrap:anywhere;">${escapeAttr(value)}</span>
    </div>`;
  }

  function renderBoundaryDistance(distance) {
    if (distance == null) return '';
    const hops = distance === 1 ? '1 hop' : `${distance} hops`;
    return `<span data-chippy-boundary-distance style="margin-left:auto;padding:1px 5px;border-radius:999px;background:rgba(148,163,184,.18);color:#CECFD2;font-size:9px;font-weight:600;">${escapeAttr(hops)}</span>`;
  }

  const EMPTY_DISPLAY = { kinds: [], titles: {}, fields: {}, showError: false };

  function contextDisplay(context) {
    return context.display || EMPTY_DISPLAY;
  }

  function boundaryAccent(kind) {
    if (kind.accent && /^#[0-9a-f]{3,8}$/i.test(kind.accent)) return kind.accent;
    return '#5E6C84';
  }

  function renderContext(context, markerId) {
    if (!contextUiEnabled() || !context) return '';
    const boundaries = context.boundaries || {};
    const display = contextDisplay(context);
    const suspense = boundaries.suspense || null;

    // Provider boundaries (for example a team/package ownership marker). These
    // are NOT the React render owner, which is the separate "jump to owner"
    // affordance. Each is a SHORT clickable lozenge (title + distance only), so
    // Chippy can select the boundary fiber as the next inspection target.
    const providerHtml = (display.kinds || []).map((kind) => {
      const ref = boundaries[kind.kind];
      if (!ref) return '';
      const accent = boundaryAccent(kind);
      const title = display.titles?.[kind.kind] || ref.componentName || kind.label;
      return `
      <div data-chippy-boundary-marker="${markerId}" data-chippy-boundary="${escapeAttr(kind.kind)}" role="button" tabindex="0"
        style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;background:${accent}22;border:1px solid ${accent}44;cursor:pointer;">
        <span style="padding:1px 5px;border-radius:999px;background:${accent};color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${escapeAttr(kind.label)}</span>
        <strong style="color:#CECFD2;font-size:10px;overflow-wrap:anywhere;">${escapeAttr(title)}</strong>
        ${renderBoundaryDistance(ref.distance)}
      </div>`;
    }).join('');

    // Error boundary: providers choose the operational fields to show (for
    // example team and a Sentry id); the full boundary payload is still sent
    // to the backend on click.
    const errorBoundaryRef = boundaries.error;
    const errorTitle = display.titles?.error || '';
    const errorFields = (display.fields?.error || []).map((f) => renderContextField(f.label, f.value)).join('');
    const boundaryHtml = errorBoundaryRef || display.showError ? `
      <div data-chippy-boundary-marker="${markerId}" data-chippy-boundary="error" role="button" tabindex="0"
        style="display:grid;gap:3px;padding:7px 8px;border-radius:7px;background:rgba(174,46,36,.12);border:1px solid rgba(255,116,102,.22);cursor:pointer;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;">
          <span style="padding:1px 5px;border-radius:999px;background:#ae2e24;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">error boundary</span>
          ${errorTitle ? `<strong style="color:#FF9C8F;font-size:10px;">${escapeAttr(errorTitle)}</strong>` : ''}
          ${renderBoundaryDistance(errorBoundaryRef?.distance)}
        </div>
        ${errorFields}
      </div>` : '';

    const suspenseHtml = suspense ? `
      <div data-chippy-boundary-marker="${markerId}" data-chippy-boundary="suspense" role="button" tabindex="0"
        style="display:grid;gap:3px;padding:7px 8px;border-radius:7px;background:rgba(124,58,237,.12);border:1px solid rgba(167,139,250,.22);cursor:pointer;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;">
          <span style="padding:1px 5px;border-radius:999px;background:#BF63F3;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">suspense boundary</span>
          <strong style="color:#D8A0F7;font-size:10px;">${escapeAttr(suspense.componentName || 'Suspense')}</strong>
          ${renderBoundaryDistance(suspense.distance)}
        </div>
      </div>` : '';

    if (!providerHtml && !boundaryHtml && !suspenseHtml) return '';
    return `<div data-chippy-context="${markerId}" style="display:grid;gap:5px;margin-top:2px;">${providerHtml}${boundaryHtml}${suspenseHtml}</div>`;
  }

  function renderProbeRow(id) {
    const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
    const color = MARKER_COLORS[id] || '#A9ABAF';
    const docked = marker?.__docked ?? true;
    const levelOffset = marker?.__levelOffset || 0;

    if (docked) {
      return `
        <div data-chippy-key="probe-row-${id}" data-chippy-probe-row="${id}" style="min-height:50px;padding:7px 12px 7px 8px;border-radius:10px;background:rgba(30,41,59,0.55);
          display:grid;grid-template-columns:${MARKER_SIZE}px 1fr;align-items:center;gap:10px;
          border:1px solid rgba(148,163,184,.10);">
          <span data-chippy-probe-dock-slot="${id}" aria-hidden="true" style="
            width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;border-radius:50%;box-sizing:border-box;
            border:2px dashed ${color};opacity:.25;display:block;
          "></span>
          <span style="font-size:11px;color:#A9ABAF;"><strong style="color:${color};font-style:normal;">${PROBE_LABELS[id]}</strong><span aria-hidden="true"> — </span>drag to source</span>
        </div>
      `;
    }

    const probe = marker?.__probe;
    const exact = probe?.best?.exact;
    const component = probe?.best?.component;
    const domTag = exact?.domTag || '—';
    const domText = (exact?.domText || '').slice(0, 32);
    const exactType = exact?.fiberType || domTag;
    const exactSource = exact?.source || null;
    const exactSourceStr = exactSource
      ? `${exactSource.fileName?.split('/').slice(-3).join('/')}:${exactSource.lineNumber}`
      : 'no source (production)';
    const compName = component?.name || '—';
    const owners = component?.owners || [];
    const compSource = component?.source;
    const ownerSource = owners.find((o) => o.source)?.source;
    const markerContext = describeContext(marker?.__probe?._bestFiber || null);
    const componentSource = compSource || ownerSource || null;
    const componentSourceStr = componentSource
      ? `${componentSource.fileName?.split('/').slice(-3).join('/')}:${componentSource.lineNumber}`
      : 'no source';
    const props = component?.props || {};
    const propsStr = Object.entries(props)
      .filter(([k]) => !['children', 'style', 'className'].includes(k))
      .slice(0, 4)
      .map(([k, v]) => {
        let s;
        if (typeof v === 'object' && v !== null) {
          if (v?.id) {
            s = String(v.id).slice(0, 16);
          } else {
            try { s = JSON.stringify(v).slice(0, 16); } catch { s = '[obj]'; }
          }
        } else {
          s = String(v).slice(0, 16);
        }
        return `<span style="color:#A9ABAF;">${k}</span><span style="color:#A9ABAF;">=</span><span style="color:#CECFD2;">${s}</span>`;
      }).join('  ') || '<span style="color:#A9ABAF;">—</span>';

    const markerEl = document.querySelector(`[data-layout-lab-marker="${id}"]`);
    const fiberOffset = markerEl?.__fiberOffset || 0;
    const levelHint = levelOffset > 0
      ? `<span style="color:#A9ABAF;font-size:10px;margin-left:4px;">DOM↑${levelOffset}</span>`
      : '';
    const fiberHint = fiberOffset > 0
      ? `<span style="color:#D8A0F7;font-size:10px;margin-left:4px;">fiber↑${fiberOffset}</span>`
      : '';

    // Clickable owner breadcrumbs — each item is a button that navigates to that owner
    const ownerButtons = owners.slice(0, 5).map((o, i) =>
      `<button data-chippy-owner-btn="${id}" data-owner-index="${i}" style="
        border:0;background:none;padding:0 3px;cursor:pointer;pointer-events:auto;
        color:#D8A0F7;font-size:10px;font-family:inherit;text-decoration:underline dotted;
        text-decoration-color:rgba(196,181,253,0.4);
      ">${o.name}</button>`
    ).join(`<span style="color:#A9ABAF;"> › </span>`);
    const intent = marker?.__intent ?? null;
    const comment = marker?.__comment || '';
    const intentOptions = [
      '<option value="">Choose intent</option>',
      ...Object.entries(PROBE_INTENT_LABELS).map(([value, label]) =>
        `<option value="${value}"${intent === value ? ' selected' : ''}>${label}</option>`
      ),
    ].join('');

    return `
      <div data-chippy-key="probe-row-${id}" data-chippy-probe-row="${id}" style="border-radius:10px;overflow:hidden;border-left:3px solid ${color};">
        <div style="min-height:44px;padding:4px 10px 4px 6px;background:rgba(30,41,59,0.85);display:flex;align-items:center;gap:7px;">
          <span data-chippy-probe-dock-slot="${id}" aria-hidden="true" style="
            width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;border-radius:50%;box-sizing:border-box;
            border:2px dashed ${color};opacity:.25;display:inline-block;flex-shrink:0;
          "></span>
          <strong style="font-size:12px;color:${color};flex-shrink:0;">${PROBE_LABELS[id]}</strong>
          ${levelHint}${fiberHint}
          <span style="color:#A9ABAF;font-family:monospace;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">&lt;${domTag}&gt;${domText ? ' ' + domText : ''}</span>
        </div>
        <div style="padding:8px 10px;background:rgba(15,23,42,0.7);display:grid;gap:5px;">
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">element</span>
            <span style="color:#FD9891;font-weight:600;font-family:monospace;font-size:11px;">${exactType}</span>
          </div>
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">source</span>
            <span style="color:${exactSource ? '#F5CD47' : '#7D818A'};font-family:monospace;font-size:10px;">${exactSourceStr}</span>
          </div>
          <div style="height:1px;background:rgba(255,255,255,0.06);margin:2px 0;"></div>
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">component</span>
            <span style="color:#8FB8F6;font-weight:600;font-size:11px;">${compName}</span>
          </div>
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">file</span>
            <span style="color:${componentSource ? '#7EE2B8' : '#7D818A'};font-family:monospace;font-size:10px;">${componentSourceStr}</span>
          </div>
          ${owners.length > 0 ? `
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">owners</span>
            <span style="line-height:1.8;">${ownerButtons || '<span style="color:#A9ABAF;">—</span>'}</span>
          </div>` : ''}
          ${renderContext(markerContext, id)}
          ${Object.keys(props).filter(k => !['children','style','className'].includes(k)).length > 0 ? `
          <div style="display:grid;grid-template-columns:52px 1fr;gap:4px;align-items:baseline;">
            <span style="color:#A9ABAF;font-size:10px;text-transform:uppercase;letter-spacing:.04em;">props</span>
            <span style="font-family:monospace;font-size:10px;line-height:1.6;">${propsStr}</span>
          </div>` : ''}
          <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>
          <div data-chippy-key="probe-annotation-${id}" data-chippy-probe-annotation="${id}" style="display:grid;gap:5px;">
            <select data-chippy-key="probe-intent-${id}" data-chippy-probe-intent="${id}" aria-label="${PROBE_LABELS[id]} intent" style="
              width:100%;border:1px solid rgba(148,163,184,.25);border-radius:6px;padding:5px 7px;
              background:#1F1F21;color:#CECFD2;font:11px 'Atlassian Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;
            ">${intentOptions}</select>
            <textarea data-chippy-key="probe-comment-${id}" data-chippy-probe-comment="${id}" aria-label="${PROBE_LABELS[id]} comment" maxlength="2000"
              placeholder="What should Chippy do with this probe?" style="
                box-sizing:border-box;width:100%;min-height:54px;resize:vertical;
                border:1px solid rgba(148,163,184,.25);border-radius:6px;padding:6px 7px;
                background:#1F1F21;color:#CECFD2;font:11px/1.4 'Atlassian Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;
              ">${escapeAttr(comment)}</textarea>
          </div>
        </div>
      </div>
    `;
  }

  const CONN_STYLES = {
    connected:    { color: '#4BCE97', label: '● connected' },
    reconnecting: { color: '#F5CD47', label: '● reconnecting' },
    failed:       { color: '#F87168', label: '● helper unavailable' },
    unknown:      { color: '#A9ABAF', label: '○ unknown' },
  };

  function getConnState() {
    return chippy.connState || 'unknown';
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getConnTitle(state) {
    const helperBaseUrl = chippy.config?.helperBaseUrl;
    if (state === 'connected' && helperBaseUrl) return `Connected to ${helperBaseUrl}`;
    if (state === 'reconnecting' && helperBaseUrl) return `Reconnecting to ${helperBaseUrl}`;
    if (state === 'failed' && helperBaseUrl) return `Helper unavailable at ${helperBaseUrl}`;
    return CONN_STYLES[state]?.label || CONN_STYLES.unknown.label;
  }

  function renderConnPill() {
    const s = getConnState();
    const style = CONN_STYLES[s] || CONN_STYLES.unknown;
    const title = escapeAttr(getConnTitle(s));
    return `<span data-chippy-key="connection-pill" data-chippy-conn-pill title="${title}" style="
      font-size:10px;color:${style.color};font-family:monospace;letter-spacing:.04em;
    ">${style.label}</span>`;
  }

  function isExtensionIntegration() {
    const integration = chippy.config?.integration || window.__CHIPPY_OWNER__?.integration || null;
    return integration?.kind === 'extension';
  }

  function renderSettingsSection() {
    if (!isExtensionIntegration() || !panelState.settingsExpanded) return '';
    return `
      <div data-chippy-key="settings-section" data-chippy-settings-section style="
        padding:10px;border-radius:12px;background:rgba(30,41,59,.55);
        border:1px solid rgba(148,163,184,.12);
      ">
        <div data-chippy-key="settings-slot" data-chippy-settings-slot style="min-height:176px;"></div>
      </div>
    `;
  }

  function renderExpandedPanel(sideLabel) {
    const settingsButton = isExtensionIntegration() ? `
      <button type="button" data-chippy-key="settings-toggle" data-chippy-settings-toggle aria-label="${panelState.settingsExpanded ? 'Hide' : 'Show'} Chippy settings"
        aria-expanded="${panelState.settingsExpanded ? 'true' : 'false'}" style="
          border:0;background:${panelState.settingsExpanded ? 'rgba(59,130,246,.22)' : 'rgba(255,255,255,.08)'};
          color:${panelState.settingsExpanded ? '#B8D6FF' : '#A9ABAF'};border-radius:7px;padding:4px 7px;
          cursor:pointer;font-size:12px;line-height:1;pointer-events:auto;
        " title="Settings">⚙</button>
    ` : '';

    return `
      <div data-chippy-key="expanded-panel" data-chippy-expanded-panel style="display:grid;gap:10px;">
        <div data-chippy-key="panel-header" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,0.07);gap:8px;">
          <div style="display:flex;align-items:center;gap:7px;min-width:0;">
            ${CHIPPY_LOGO}
            <div style="font-weight:650;font-size:14px;color:#CECFD2;">Chippy</div>
            ${renderConnPill()}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${settingsButton}
            <button type="button" data-chippy-key="toggle-side" data-layout-lab-toggle-side aria-label="Move Chippy panel to the ${panelState.side === 'right' ? 'left' : 'right'}" style="
              border:0;background:rgba(255,255,255,0.08);color:#A9ABAF;
              border-radius:7px;padding:4px 7px;cursor:pointer;font-size:11px;line-height:1;
              pointer-events:auto;
            ">${sideLabel}</button>
            <button type="button" data-chippy-key="collapse-panel" data-chippy-panel-collapse aria-label="Collapse Chippy" style="
              border:0;background:rgba(255,255,255,0.08);color:#A9ABAF;
              border-radius:7px;padding:4px 7px;cursor:pointer;font-size:14px;line-height:1;
              pointer-events:auto;
            ">−</button>
          </div>
        </div>
        <div data-chippy-key="probe-dock" data-layout-lab-dock="true" data-chippy-ui="true" style="
          position:relative;display:grid;gap:6px;pointer-events:auto;
        ">${MARKER_IDS.map(renderProbeRow).join('')}</div>
        <div data-chippy-key="panel-help" style="font-size:10px;color:#A9ABAF;text-align:center;padding-top:1px;">← / → DOM levels &nbsp;·&nbsp; ↑ / ↓ fiber parents &nbsp;·&nbsp; click owner to jump</div>
        ${renderSettingsSection()}
      </div>
    `;
  }

  function patchPanelContent(panel, html) {
    if (panel.__chippyRenderedHtml === html) return false;
    const patchChildren = global.__CHIPPY_PANEL_DOM__?.patchChildren;
    if (typeof patchChildren === 'function') patchChildren(panel, html);
    else panel.innerHTML = html; // Minimal degradation for legacy direct-script consumers.
    panel.__chippyRenderedHtml = html;
    return true;
  }

  function bindPanelEvent(node, type, listener) {
    if (!node) return;
    const slot = `__chippyPanelListener_${type}`;
    if (node[slot]) node.removeEventListener(type, node[slot]);
    node[slot] = listener;
    node.addEventListener(type, listener);
  }

  function requestSettingsMount(panel) {
    if (!panel.querySelector('[data-chippy-settings-slot]')) return;
    document.dispatchEvent(new Event('chippy-settings-mount-request'));
  }

  // Subscribe once: re-render panel on conn-state change.
  // Guard: only update if Chippy UI is already present (i.e. not cleared after disable).
  if (!chippy.__connStateListenerInstalled) {
    chippy.__connStateListenerInstalled = true;
    global.addEventListener('chippy-conn-state', () => {
      try {
        if (document.querySelector('[data-layout-lab-panel]')) updatePanel();
      } catch {}
    });
  }

  function updatePanel() {
    const panel = ensurePanel();
    if (!panel) return;
    applyPanelStyle(panel);

    if (!panelState.expanded) {
      const style = CONN_STYLES[getConnState()] || CONN_STYLES.unknown;
      const collapsedHtml = `
        <button type="button" data-chippy-panel-launcher aria-label="Open Chippy" title="Open Chippy" style="
          position:relative;width:${PANEL_LAUNCHER_SIZE}px;height:${PANEL_LAUNCHER_SIZE}px;
          display:flex;align-items:center;justify-content:center;border:1px solid rgba(148,163,184,.22);
          border-radius:50%;background:#1F1F21;color:#CECFD2;cursor:pointer;
          box-shadow:0 10px 28px rgba(0,0,0,.32);font-size:20px;line-height:1;pointer-events:auto;
        ">
          ${CHIPPY_LOGO}
          <span aria-hidden="true" style="position:absolute;right:2px;bottom:3px;width:9px;height:9px;border-radius:50%;background:${style.color};border:2px solid #1F1F21;"></span>
        </button>
      `;
      patchPanelContent(panel, collapsedHtml);
      bindPanelEvent(
        panel.querySelector('[data-chippy-panel-launcher]'),
        'click',
        () => setPanelExpanded(true),
      );
      syncDockedMarkers();
      return;
    }

    const sideLabel = panelState.side === 'right' ? '◀' : '▶';
    const html = renderExpandedPanel(sideLabel);
    patchPanelContent(panel, html);
    bindPanelEvent(panel.querySelector('[data-chippy-panel-collapse]'), 'click', () => setPanelExpanded(false));
    bindPanelEvent(panel.querySelector('[data-chippy-settings-toggle]'), 'click', () => {
      panelState.settingsExpanded = !panelState.settingsExpanded;
      updatePanel();
      emitLabEvent(panelState.settingsExpanded ? 'settings-opened' : 'settings-closed', {
        settingsExpanded: panelState.settingsExpanded,
      });
    });
    bindPanelEvent(panel.querySelector('[data-layout-lab-toggle-side]'), 'click', () => {
      togglePanelSide();
      updatePanel();
    });
    panel.querySelectorAll('[data-chippy-probe-intent]').forEach((intentInput) => {
      bindPanelEvent(intentInput, 'change', (event) => {
        event.stopPropagation();
        const markerId = intentInput.getAttribute('data-chippy-probe-intent');
        const commentInput = panel.querySelector(`[data-chippy-probe-comment="${markerId}"]`);
        setMarkerAnnotation(markerId, {
          intent: intentInput?.value || null,
          comment: commentInput?.value || '',
        });
      });
    });
    panel.querySelectorAll('[data-chippy-probe-comment]').forEach((commentInput) => {
      bindPanelEvent(commentInput, 'keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        const markerId = commentInput.getAttribute('data-chippy-probe-comment');
        const intentInput = panel.querySelector(`[data-chippy-probe-intent="${markerId}"]`);
        setMarkerAnnotation(markerId, {
          intent: intentInput?.value || null,
          comment: commentInput?.value || '',
        });
      });
    });
    // Wire declarative-boundary clicks (owner / error / suspense). These are NOT
    // the React render owner — they are the boundaries that define the collateral
    // scope. Clicking reports the boundary + its fiber-hop distance to the Chippy
    // backend via a lab event, so it can investigate the boundary later.
    const boundaryEls = panel.querySelectorAll('[data-chippy-boundary]');
    boundaryEls.forEach((el) => {
      const activate = (e) => {
        e.stopPropagation();
        const kind = el.getAttribute('data-chippy-boundary');
        const markerId = el.getAttribute('data-chippy-boundary-marker');
        if (!markerId) return;
        // Persistent selected feedback: clear siblings, mark this one selected,
        // so the click is visibly acknowledged and the active boundary is clear.
        boundaryEls.forEach((other) => {
          other.removeAttribute('data-chippy-boundary-selected');
          other.style.outline = '';
          other.style.outlineOffset = '';
        });
        el.setAttribute('data-chippy-boundary-selected', 'true');
        el.style.outline = '2px solid #CECFD2';
        el.style.outlineOffset = '1px';
        // Show WHERE the boundary is: highlight its DOM subtree on the page and
        // scroll it into view. This is the on-page counterpart to the lozenge feedback.
        highlightBoundary(markerId, kind);
        const markerEl = document.querySelector(`[data-layout-lab-marker="${markerId}"]`);
        const markerContext = describeContext(markerEl?.__probe?._bestFiber || null);
        const boundary = markerContext?.boundaries?.[kind] || null;
        emitLabEvent('inspect-boundary', {
          markerId,
          boundaryKind: kind,
          boundary,
          distance: boundary?.distance ?? null,
        });
      };
      bindPanelEvent(el, 'click', activate);
      bindPanelEvent(el, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      });
    });
    // Wire owner breadcrumb clicks — jump directly to that owner fiber
    panel.querySelectorAll('[data-chippy-owner-btn]').forEach((btn) => {
      bindPanelEvent(btn, 'click', (e) => {
        e.stopPropagation();
        const markerId = btn.getAttribute('data-chippy-owner-btn');
        const ownerIndex = parseInt(btn.getAttribute('data-owner-index'), 10);
        const markerEl = document.querySelector(`[data-layout-lab-marker="${markerId}"]`);
        if (!markerEl) return;
        const ownerFibers = markerEl.__ownerFibers;
        if (!ownerFibers || !ownerFibers[ownerIndex]) return;
        const targetFiber = ownerFibers[ownerIndex];
        const color = MARKER_COLORS[markerId] || '#A9ABAF';
        // Resolve the owner fiber into a full component description and pin it
        const component = describeComponent(targetFiber);
        const targetEl = getFiberDomNode(targetFiber) || markerEl.__baseEl;
        markerEl.__probe = {
          ...(markerEl.__probe || {}),
          _bestFiber: targetFiber,
          _targetEl: targetEl,
          best: {
            exact: describeFiberTarget(getNearestFiber(targetEl), targetEl),
            component,
          },
        };
        markerEl.__fiberOffset = 0; // reset fiber walk — we're now pinned to a specific owner
        markerEl.__fiberParents = getReturnComponentChain(targetFiber);
        updateHighlight(markerId, targetEl, color);
        storeMarkerAnchor(markerEl, targetEl);
        attachScrollListeners(markerId, targetEl, color);
        updateParentBorder();
        updatePanel();
        emitLabEvent('marker-owner-jump', { markerId, ownerIndex });
      });
    });
    syncDockedMarkers();
    requestSettingsMount(panel);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  function getMarkerProbe(id) {
    const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
    if (!marker) return null;
    const annotation = normalizeProbeAnnotation({ intent: marker.__intent, comment: marker.__comment });
    return {
      id,
      ...annotation,
      probe: marker.__probe || null,
    };
  }

  function exposeDefaultMarkers() {
    // Clean up any existing markers + highlights + parent border
    document.querySelectorAll('[data-layout-lab-marker]').forEach((marker) => marker.remove());
    document.querySelectorAll('[data-layout-lab-highlight]').forEach((el) => el.remove());
    document.querySelector('[data-layout-lab-parent-border]')?.remove();
    if (_parentBorderEl) _parentBorderEl = null;
    Object.keys(_highlights).forEach((k) => delete _highlights[k]);

    ensurePanel();
    ensureDock();
    // Markers always start docked. In the unified UI they stay hidden until the
    // launcher expands; Storybook places them in its standalone preview dock.
    MARKER_IDS.forEach((id, index) => createMarker(id, index));
    updatePanel();
    emitLabEvent('markers-exposed', { markers: getAllMarkerStates() });
  }

  function clearAll() {
    panelState.expanded = false;
    panelState.settingsExpanded = false;
    MARKER_IDS.forEach((id) => detachScrollListeners(id));
    document.querySelector('[data-layout-lab-dock]')?.remove();
    document.querySelector('[data-layout-lab-panel]')?.remove();
    document.querySelectorAll('[data-layout-lab-marker]').forEach((marker) => marker.remove());
    document.querySelectorAll('[data-layout-lab-highlight]').forEach((el) => el.remove());
    document.querySelector('[data-layout-lab-parent-border]')?.remove();
    if (_parentBorderEl) _parentBorderEl = null;
    Object.keys(_highlights).forEach((k) => delete _highlights[k]);
    emitLabEvent('markers-cleared');
  }

  // ─── Style inspection ─────────────────────────────────────────────────────
  // getComputedStyleAt({ probeId, parentLevel?, selector? })
  //   probeId     — '1' or '2'
  //   parentLevel — 0 = probe target, 1 = direct parent, N = Nth ancestor (default 0)
  //   selector    — optional querySelector within the resolved node
  // Returns full getComputedStyle output as a plain object.

  function getComputedStyleAt({ probeId, parentLevel = 0, selector } = {}) {
    const probe = chippy.layoutLab?.getMarkerProbe(String(probeId));
    const targetEl = probe?.probe?._targetEl || null;
    if (!targetEl) return { error: `No target element for probe ${probeId}` };

    // Walk up parentLevel ancestors
    let el = targetEl;
    for (let i = 0; i < parentLevel; i++) {
      if (!el.parentElement) return { error: `parentLevel ${parentLevel} exceeds DOM depth (stopped at ${i})` };
      el = el.parentElement;
    }

    // Optional scoped querySelector
    if (selector) {
      const found = el.querySelector(selector);
      if (!found) return { error: `selector "${selector}" not found within node at parentLevel ${parentLevel}` };
      el = found;
    }

    const cs = window.getComputedStyle(el);
    const result = {};
    for (const prop of cs) result[prop] = cs.getPropertyValue(prop);
    return result;
  }

  chippy.getComputedStyleAt = getComputedStyleAt;

  chippy.layoutLab = {
    exposeDefaultMarkers,
    clearAll,
    getMarkerProbe,
    getCommonParentInspection,
    getHookSummary,
    getMarkerState,
    getAllMarkerStates,
    setMarkerAnnotation,
    probePoint,
    updatePanel,
    removeInPageUi,
    togglePanelSide,
    snapToDock: (id) => {
      const marker = document.querySelector(`[data-layout-lab-marker="${id}"]`);
      if (marker) snapToDock(marker);
    },
    markerIds: [...MARKER_IDS],
    markerColors: { ...MARKER_COLORS },
  };
})(window);
