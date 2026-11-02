/* eslint-disable */
// The page bridge is the transport/orchestration shell, not the owner of
// React-internals algorithms. It resolves page events and helper commands,
// delegates capability work to __AVALANCHE__.bridge, and publishes snapshots.
// Keeping that boundary thin is what lets the TypeScript bundle and the
// extension/import/Storybook integrations share behavior without drift.
(function installChippyPageBridge(global) {
  /** @type {ChippyPageRuntime} */
  const chippy = global.__CHIPPY = global.__CHIPPY || {};
  const BRIDGE_VERSION = '0.2.5';
  if (chippy.pageBridge) {
    // Always tear down and reinstall — version-equality skip caused stale code to win.
    try { chippy.pageBridge.destroy?.(); } catch (e) {}
  }
  const DEFAULTS = {
    helperBaseUrl: 'http://127.0.0.1:7823',
    // activated = false: bridge connects but does NOT auto-show probes.
    // User must explicitly call ensureProbes() or send 'ensure-probes' command.
    activated: false,
    // Marker context (declarative boundaries plus context-provider plugins) is
    // visible by default and can be toggled at runtime by the helper command.
    // jiraUiEnabled is the pre-0.4.23 name, kept in sync for one release.
    contextUiEnabled: true,
    jiraUiEnabled: true,
    reconnectDelayMs: 1500,
    publishDebounceMs: 180,
  };

  function normalizeBaseUrl(value) {
    return String(value || DEFAULTS.helperBaseUrl).replace(/\/+$/, '');
  }

  function deriveWsUrl(baseUrl) {
    // http → ws, https → wss. Respects whatever the user configured.
    return normalizeBaseUrl(baseUrl).replace(/^http/i, 'ws') + '/__chippy/ws';
  }

  function getIntegrationIdentity() {
    return config?.integration || global.__CHIPPY_OWNER__?.integration || null;
  }

  function getStoredClientId() {
    try {
      const existing = global.sessionStorage?.getItem('__chippyClientId');
      if (existing) return existing;
      const next = global.crypto?.randomUUID?.() || `chippy-${Date.now()}`;
      global.sessionStorage?.setItem('__chippyClientId', next);
      return next;
    } catch {
      return `chippy-${Date.now()}`;
    }
  }

  function getStoryId() {
    const params = new URLSearchParams(global.location.search || '');
    return params.get('id') || null;
  }

  // ─── Build mode detection ───────────────────────────────────────────────

  function detectBuildMode() {
    // Walk ALL elements with React fibers — cast a wider net than a single node.
    function getFiberKey(node) {
      return Object.getOwnPropertyNames(node).find((k) => k.startsWith('__reactFiber$'));
    }

    // Use body as root — head/meta/script nodes don't carry React fibers.
    const root = global.document.body || global.document.documentElement || global.document;
    const candidates = Array.from(root.querySelectorAll('*'));
    for (const el of candidates) {
      const key = getFiberKey(el);
      if (!key) continue;
      let fiber = el[key];
      let steps = 0;
      while (fiber && steps < 30) {
        // React <=18 exposes _debugSource; React 19 captures the JSX call site
        // in _debugStack instead. Both are development evidence.
        if (fiber._debugSource?.fileName || typeof fiber._debugStack?.stack === 'string') return 'dev';
        fiber = fiber.return;
        steps++;
      }
    }

    // No development source metadata found anywhere — check if we at least see named component functions.
    // That means production (names intact) vs fully stripped (unknown).
    for (const el of candidates) {
      const key = getFiberKey(el);
      if (!key) continue;
      let fiber = el[key];
      let steps = 0;
      while (fiber && steps < 30) {
        if (typeof fiber.type === 'function' && (fiber.type.name || fiber.type.displayName)) {
          return 'production';
        }
        fiber = fiber.return;
        steps++;
      }
    }

    return 'unknown';
  }

  // ─── Marker summaries ───────────────────────────────────────────────────

  function summarizeMarkerContext(id) {
    if (config.contextUiEnabled === false) return null;
    const fiber = chippy.layoutLab?.getMarkerProbe?.(id)?.probe?._bestFiber || null;
    const lab = global.__AVALANCHE__?.layoutLab;
    // Bundles before 0.4.23 publish only describeJiraContext.
    const describe = lab?.describeContext || lab?.describeJiraContext;
    if (!fiber || typeof describe !== 'function') return null;
    try {
      return describe(fiber) || null;
    } catch {
      return null;
    }
  }

  function summarizeMarkers() {
    const states = chippy.layoutLab?.getAllMarkerStates?.() || {};
    const activeIds = Object.entries(states)
      .filter(([, s]) => !s.docked)
      .map(([id]) => id);
    const summaries = activeIds.length > 0
      ? (chippy.resolveProbesCompact?.(...activeIds) || {})
      : {};
    const result = {};
    for (const id of ['1', '2']) {
      const context = summaries[id] ? summarizeMarkerContext(id) : null;
      result[id] = {
        position: states[id]?.position || null,
        docked: states[id]?.docked ?? true,
        intent: states[id]?.intent ?? null,
        comment: states[id]?.comment || '',
        resolved: summaries[id] || null,
        context,
        // Deprecated alias of `context`, kept for one release.
        jiraContext: context,
      };
    }
    const commonInspection = global.__CHIPPY?.layoutLab?.getCommonParentInspection?.();
    if (commonInspection) {
      result['3'] = {
        position: null,
        docked: false,
        intent: null,
        comment: '',
        context: null,
        jiraContext: null,
        resolved: {
          confidence: commonInspection.component?.debugSource?.fileName || commonInspection.owners?.some((o) => o?.debugSource?.fileName) ? 'dev' : 'production',
          dom: {
            tag: commonInspection.dom?.tagName || null,
            text: (commonInspection.dom?.text || '').slice(0, 80),
            fiberType: commonInspection.fiber?.type || commonInspection.fiber?.elementType || null,
            source: commonInspection.fiber?.debugSource || null,
            parents: [],
            matchedStyles: [],
          },
          component: {
            name: commonInspection.component?.type || commonInspection.component?.elementType || null,
            key: commonInspection.component?.key ?? null,
            propNames: commonInspection.component?.memoizedPropsKeys?.filter((k) => k !== 'children') || [],
            props: {},
            hookCount: null,
            hookCountTruncated: false,
            hookCountMax: null,
            complexityNote: null,
            source: commonInspection.component?.debugSource || null,
            owners: (commonInspection.owners || []).map((o) => ({
              name: o?.type || o?.elementType || null,
              key: o?.key ?? null,
              source: o?.debugSource || null,
              propNames: o?.memoizedPropsKeys?.filter((k) => k !== 'children') || [],
              hookCount: null,
              hookCountTruncated: false,
              hookCountMax: null,
              complexityNote: null,
            })),
            componentStack: null,
            parents: (commonInspection.returns || []).map((o) => ({
              name: o?.type || o?.elementType || null,
              key: o?.key ?? null,
              source: o?.debugSource || null,
              propNames: o?.memoizedPropsKeys?.filter((k) => k !== 'children') || [],
              hookCount: null,
              hookCountTruncated: false,
              hookCountMax: null,
              complexityNote: null,
            })),
          },
          nearestTestId: commonInspection.nearestTestIdParent?.testId || null,
          note: 'Nearest common parent for probes 1, 2.',
        },
      };
    }
    return result;
  }

  function getCommonParentSourceFibers(lab) {
    const first = chippy.layoutLab?.getMarkerProbe?.('1')?.probe?._bestFiber || null;
    const second = chippy.layoutLab?.getMarkerProbe?.('2')?.probe?._bestFiber || null;
    if (!first || !second) return null;

    const firstElements = new Set();
    let current = first.return || null;
    let steps = 0;
    while (current && steps < 400) {
      if (current.stateNode?.nodeType === 1) firstElements.add(current.stateNode);
      current = current.return || null;
      steps += 1;
    }

    current = second.return || null;
    steps = 0;
    while (current && steps < 400) {
      const element = current.stateNode?.nodeType === 1 ? current.stateNode : null;
      if (element && firstElements.has(element)) {
        const exactFiber = typeof lab.getNearestFiber === 'function' ? lab.getNearestFiber(element) : current;
        const componentFiber = typeof lab.getNearestComponent === 'function'
          ? lab.getNearestComponent(element)
          : chippy.inspectReact?.getNearestCompositeFiber?.(exactFiber) || null;
        return { exactFiber, componentFiber };
      }
      current = current.return || null;
      steps += 1;
    }
    return null;
  }

  async function enrichOneMarkerSource(marker, exactFiber, componentFiber, lab) {
    if (!marker?.resolved || !componentFiber) return;
    const ownerFibers = typeof lab.getOwnerFibers === 'function' ? lab.getOwnerFibers(componentFiber).slice(0, 10) : [];
    const parentFibers = typeof lab.getReturnComponentFibers === 'function' ? lab.getReturnComponentFibers(componentFiber).slice(0, 20) : [];
    const [domSource, componentSource, ownerSources, parentSources] = await Promise.all([
      exactFiber ? lab.resolveFiberSource(exactFiber) : null,
      lab.resolveFiberSource(componentFiber),
      Promise.all(ownerFibers.map((fiber) => lab.resolveFiberSource(fiber))),
      Promise.all(parentFibers.map((fiber) => lab.resolveFiberSource(fiber))),
    ]);

    if (domSource && marker.resolved.dom) marker.resolved.dom.source = domSource;
    if (componentSource && marker.resolved.component) marker.resolved.component.source = componentSource;
    for (let index = 0; index < ownerSources.length; index++) {
      if (ownerSources[index] && marker.resolved.component?.owners?.[index]) {
        marker.resolved.component.owners[index].source = ownerSources[index];
      }
    }
    for (let index = 0; index < parentSources.length; index++) {
      if (parentSources[index] && marker.resolved.component?.parents?.[index]) {
        marker.resolved.component.parents[index].source = parentSources[index];
      }
    }
    if (domSource || componentSource || ownerSources.some(Boolean) || parentSources.some(Boolean)) {
      marker.resolved.confidence = 'dev';
      marker.resolved.note = null;
    }
  }

  async function enrichMarkerSources(markers) {
    const lab = global.__AVALANCHE__?.layoutLab;
    if (typeof lab?.resolveFiberSource !== 'function') return markers;

    const jobs = ['1', '2'].map((id) => {
      const probe = chippy.layoutLab?.getMarkerProbe?.(id)?.probe || null;
      const componentFiber = probe?._bestFiber || null;
      const targetElement = probe?._targetEl || null;
      const exactFiber = targetElement && typeof lab.getNearestFiber === 'function'
        ? lab.getNearestFiber(targetElement)
        : null;
      return enrichOneMarkerSource(markers[id], exactFiber, componentFiber, lab);
    });

    const common = getCommonParentSourceFibers(lab);
    if (common) jobs.push(enrichOneMarkerSource(markers['3'], common.exactFiber, common.componentFiber, lab));
    await Promise.all(jobs);
    return markers;
  }

  function probesActive() {
    const states = chippy.layoutLab?.getAllMarkerStates?.() || {};
    // At least one probe must be placed (not docked) to count as active
    return Object.values(states).some((s) => !s.docked);
  }

  function probesInstalled() {
    const states = chippy.layoutLab?.getAllMarkerStates?.() || {};
    return ['1', '2'].every((id) => Boolean(states[id]));
  }

  function getPageState() {
    return {
      url: global.location.href,
      title: global.document.title,
      storyId: getStoryId(),
      readyState: global.document.readyState,
    };
  }

  // ─── Status overlay ─────────────────────────────────────────────────────

  function ensureStatus() {
    /** @type {HTMLElement | null} */
    let node = global.document.querySelector('[data-chippy-status]');
    if (!node) {
      node = global.document.createElement('div');
      node.setAttribute('data-chippy-status', 'true');
      node.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'max-width:320px',
        'padding:10px 12px', 'border-radius:12px',
        'background:rgba(15,23,42,0.94)', 'color:#e2e8f0',
        'font:12px/1.4 Inter,system-ui,sans-serif',
        'box-shadow:0 12px 28px rgba(0,0,0,0.28)',
        'z-index:2147483647', 'pointer-events:none', 'display:none',
      ].join(';');
      global.document.body.appendChild(node);
    }
    return node;
  }

  function showStatus(_message) {
    // Banner suppressed — connection state lives in chippy panel via setConnState().
    // Kept as no-op so existing call sites and command handlers don't break.
  }

  function hideStatus() {
    const node = global.document.querySelector('[data-chippy-status]');
    if (node) node.remove();
  }

  // Connection state is mirrored to chippy.connState and dispatched as event for layout-lab panel.
  function setConnState(state) {
    chippy.connState = state;
    try {
      global.dispatchEvent(new CustomEvent('chippy-conn-state', { detail: { state } }));
    } catch {}
  }

  // ─── State ──────────────────────────────────────────────────────────────

  // Config is stored in window.__CHIPPY.config by the extension or proxy bootstrap.
  function readExtensionConfig() {
    return chippy.config || {};
  }
  const extensionConfig = readExtensionConfig();

  /** @type {Record<string, any>} */
  let config = {
    ...DEFAULTS,
    ...extensionConfig,
    helperBaseUrl: normalizeBaseUrl(
      extensionConfig.helperBaseUrl || DEFAULTS.helperBaseUrl,
    ),
    activated: extensionConfig.activated ?? DEFAULTS.activated,
  };
  chippy.config = { ...config };

  let socket = null;
  // WebSocket state is disposable transport state. Probes and their marker
  // coordinates belong to the page integration and are re-published after a
  // reconnect; the helper must never become the source of truth for them.
  let reconnectTimer = null;
  let locationInterval = null;
  let heartbeatInterval = null;
  let lastPointerActivityAt = 0;
  let lastFocusActivityAt = 0;
  let lastVisibilityState = global.document.visibilityState || 'unknown';
  let destroyed = false;
  let onLayoutLabUpdate = null;
  let onWindowMessage = null;
  let onExtCommand = null;
  let publishTimer = null;
  let snapshotSequence = 0;
  let lastLocationHref = global.location.href;
  const clientId = getStoredClientId();
  // Build mode is detected lazily — React fibers are not available at injection
  // time if the script runs before the first render. We resolve it on first
  // snapshot and cache the result.
  let buildMode = 'unknown';

  function resolveBuildMode() {
    if (buildMode !== 'unknown') return buildMode;
    buildMode = detectBuildMode();
    return buildMode;
  }

  // ─── Messaging ──────────────────────────────────────────────────────────

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function sendActivity(reason, detail) {
    return send({
      type: 'activity',
      clientId,
      bridgeVersion: BRIDGE_VERSION,
      buildMode: resolveBuildMode(),
      page: getPageState(),
      integration: getIntegrationIdentity(),
      activated: config.activated,
      probesActive: probesActive(),
      activity: {
        reason,
        detail: detail || null,
        at: new Date().toISOString(),
      },
    });
  }

  function publishSnapshot(reason) {
    const sequence = ++snapshotSequence;
    const mode = resolveBuildMode();
    const markers = summarizeMarkers();
    const payload = {
      type: 'snapshot',
      clientId,
      bridgeVersion: BRIDGE_VERSION,
      buildMode: mode,
      page: getPageState(),
      integration: getIntegrationIdentity(),
      activated: config.activated,
      probesActive: probesActive(),
      reason,
      snapshot: {
        page: getPageState(),
        integration: getIntegrationIdentity(),
        buildMode: mode,
        activated: config.activated,
        probesActive: probesActive(),
        markers,
      },
    };
    const beforeResolution = JSON.stringify(markers);
    const sent = send(payload);
    if (!sent) return false;

    // React 19 locations require fetching the served module and decoding its
    // source map. Publish the immediate stack-frame position first, then replace
    // it with the original source position once the shared resolver finishes.
    Promise.resolve(enrichMarkerSources(markers)).then((resolvedMarkers) => {
      if (sequence !== snapshotSequence) return;
      if (JSON.stringify(resolvedMarkers) === beforeResolution) return;
      send({
        ...payload,
        reason: reason + '-source-resolved',
        snapshot: { ...payload.snapshot, markers: resolvedMarkers },
      });
    }).catch(() => {});

    return sent;
  }

  function setProbeAnnotation(probeId, patch) {
    return chippy.layoutLab?.setMarkerAnnotation?.(String(probeId), patch || {}) || null;
  }

  // Snapshot publication is debounced because marker placement, activation,
  // and probe resolution can change in the same browser task. Consumers need
  // the settled state, not a sequence of transient intermediate snapshots.
  function scheduleSnapshot(reason) {
    global.clearTimeout(publishTimer);
    publishTimer = global.setTimeout(() => publishSnapshot(reason), config.publishDebounceMs);
  }

  function sendHello(reason) {
    send({
      type: 'hello',
      reason,
      clientId,
      bridgeVersion: BRIDGE_VERSION,
      buildMode: resolveBuildMode(),
      page: getPageState(),
      integration: getIntegrationIdentity(),
      activated: config.activated,
      probesActive: probesActive(),
      userAgent: global.navigator.userAgent,
    });
  }

  // ─── Probe control ───────────────────────────────────────────────────────

  function activate() {
    config.activated = true;
    if (!probesInstalled()) chippy.layoutLab?.exposeDefaultMarkers?.();
    else chippy.layoutLab?.updatePanel?.();
    hideStatus();
    // Defer build-mode detection until after first render settles
    global.setTimeout(() => {
      buildMode = detectBuildMode();
      scheduleSnapshot('activate');
    }, 300);
  }

  function deactivate() {
    config.activated = false;
    chippy.layoutLab?.clearAll?.();
    scheduleSnapshot('deactivate');
  }

  function ensureProbes() {
    if (!config.activated) activate();
    else if (!probesInstalled()) chippy.layoutLab?.exposeDefaultMarkers?.();
    else chippy.layoutLab?.updatePanel?.();
    scheduleSnapshot('ensure-probes');
  }

  function clearProbes() {
    chippy.layoutLab?.clearAll?.();
    scheduleSnapshot('clear-probes');
  }

  function setContextUiEnabled(enabled, reason) {
    applyConfig({ contextUiEnabled: Boolean(enabled) });
    chippy.layoutLab?.updatePanel?.();
    scheduleSnapshot(reason);
  }

  // ─── Avalanche bridge (upstream-native) ──────────────────────────────────
  //
  // Reads the Avalanche IIFE published as globalThis.__AVALANCHE__. The page
  // bridge exposes lifecycle, status, export, metrics, help, and debug-hook
  // conveniences while request commands are translated to the bundled API.

  function getAvalancheApi() {
    const root = global.__AVALANCHE__ || null;
    if (!root) return null;
    if (typeof root.status === 'function' || typeof root.report === 'function' || typeof root.install === 'function') return root;
    const d = root.default || null;
    if (d && (typeof d.status === 'function' || typeof d.report === 'function' || typeof d.install === 'function')) return d;
    return root;
  } 

  function getAvalancheModule() {
    return global.__AVALANCHE__ || null;
  }

  // Upstream commitStats tuple index → field name.
  // Source: src/avalanche/detector.tsx ~line 952 (commitStats[N] = [...])
  // ─── Avalanche command surface — delegated to __AVALANCHE__.bridge ────────
  // Implementation lives in src/chippy-bridge/avalanche-commands.ts and is
  // bundled into __AVALANCHE__.bridge. The bridge supplies the live api/mod
  // refs at call time; the bundle owns all action handling, getReport,
  // tupleToStats, and the UPSTREAM_COMMIT_STAT_KEYS constant.
  function readAvalancheStatus() {
    const b = getBridge();
    return b
      ? b.readAvalancheStatus(getAvalancheApi(), getAvalancheModule())
      : { ok: false, available: false, error: 'bridge module not loaded' };
  }

  function evalAvalanche(command) {
    const b = getBridge();
    if (!b) {
      const action = String(command?.action || 'status');
      return { ok: false, available: false, action, error: 'bridge module not loaded' };
    }
    return b.evalAvalanche(command, getAvalancheApi(), getAvalancheModule());
  }

  function handleCommand(command) {
    switch (command?.type) {
      case 'activate':
        activate();
        break;
      case 'deactivate':
        deactivate();
        break;
      case 'ensure-probes':
        ensureProbes();
        break;
      case 'clear-probes':
        clearProbes();
        break;
      case 'request-snapshot':
        publishSnapshot('request-snapshot');
        break;
      case 'show-status':
        showStatus(command.text || 'Chippy is connected.');
        break;
      case 'hide-status':
        hideStatus();
        break;
      case 'set-context-ui':
        setContextUiEnabled(command.enabled !== false, 'set-context-ui');
        break;
      case 'set-jira-ui':
        // Deprecated alias of set-context-ui, kept for one release.
        setContextUiEnabled(command.enabled !== false, 'set-jira-ui');
        break;
      case 'reload':
        try { send({ type: 'reload-ack', clientId, requestId: command.requestId || null }); } catch (e) {}
        setTimeout(function() { try { window.location.reload(); } catch (e) {} }, 50);
        break;
      case 'storybook-force-remount': {
        // The Storybook addon owns the host API. The bridge only relays the
        // request so a Storybook SUT remount does not navigate its preview.
        const remountEvent = new CustomEvent('chippy-storybook-force-remount', {
          cancelable: true,
          detail: { requestId: command.requestId || null },
        });
        global.dispatchEvent(remountEvent);
        try {
          send({
            type: 'reload-ack',
            clientId,
            requestId: command.requestId || null,
            action: 'storybook-force-remount',
            ok: remountEvent.defaultPrevented,
          });
        } catch (e) {}
        break;
      }
      case 'eval-computed-style': {
        const requestId = command.requestId || null;
        const result = chippy.getComputedStyleAt
          ? chippy.getComputedStyleAt({ probeId: command.probeId, parentLevel: command.parentLevel || 0, selector: command.selector || undefined })
          : { error: 'getComputedStyleAt not available' };
        send({ type: 'computed-style-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-dom': {
        const requestId = command.requestId || null;
        const result = evalProbeDom(command.probeId, command.parentLevel || 0);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-props': {
        const requestId = command.requestId || null;
        const result = evalProbeProps(command.probeId, command.ownerIndex);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-owners': {
        const requestId = command.requestId || null;
        const result = evalProbeOwners(command.probeId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-parents': {
        const requestId = command.requestId || null;
        const result = evalProbeParents(command.probeId, command.max);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-boundaries': {
        const requestId = command.requestId || null;
        const result = evalProbeBoundaries(command.probeId, command.max);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-hooks': {
        const requestId = command.requestId || null;
        const result = evalProbeHooks(command.probeId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-probe-hooks-summary': {
        const requestId = command.requestId || null;
        const result = evalProbeHooksSummary(command.probeId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'find-fibers': {
        const requestId = command.requestId || null;
        const result = evalFindFibers(command.filters || {});
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'capture-fiber-state': {
        const requestId = command.requestId || null;
        const result = evalCaptureFiberState(command.options || {});
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'compare-fiber-states': {
        const requestId = command.requestId || null;
        const result = evalCompareFiberStates(command.before, command.after, command.options || {});
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'page-boundaries': {
        const requestId = command.requestId || null;
        const result = evalPageBoundaries(command.max);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-hooks': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberHooks(command.fiberId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-hooks-summary': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberHooksSummary(command.fiberId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-props': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberProps(command.fiberId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-owners': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberOwners(command.fiberId);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-parents': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberParents(command.fiberId, command.max);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-boundaries': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberBoundaries(command.fiberId, command.max);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'inspect-fiber-structure': {
        const requestId = command.requestId || null;
        const result = evalInspectFiberStructure(command.fiberId, command.hookIndex, command.windowSize);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'describe-component': {
        const requestId = command.requestId || null;
        Promise.resolve(evalDescribeComponent(command.fiberId, command.name))
          .then((result) => send({ type: 'eval-probe-result', clientId, requestId, result }))
          .catch((error) => send({
            type: 'eval-probe-result',
            clientId,
            requestId,
            result: { ok: false, error: error?.message || String(error), stack: error?.stack },
          }));
        break;
      }
      case 'explain-component': {
        const requestId = command.requestId || null;
        Promise.resolve(evalExplainComponent(command.probeId, command.fiberId, command.name))
          .then((result) => send({ type: 'eval-probe-result', clientId, requestId, result }))
          .catch((error) => send({
            type: 'eval-probe-result',
            clientId,
            requestId,
            result: { ok: false, error: error?.message || String(error), stack: error?.stack },
          }));
        break;
      }
      case 'page-click': {
        const requestId = command.requestId || null;
        const result = evalPageClick(command.target || {});
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'fiber-invoke': {
        const requestId = command.requestId || null;
        Promise.resolve(evalFiberInvoke(command.fiberId, command.propName, command.args))
          .then((result) => {
            send({ type: 'eval-probe-result', clientId, requestId, result });
          })
          .catch((error) => {
            send({
              type: 'eval-probe-result',
              clientId,
              requestId,
              result: {
                ok: false,
                error: error && error.message ? error.message : String(error),
                stack: error && error.stack ? error.stack : undefined,
              },
            });
          });
        break;
      }
      case 'fiber-prop-contract': {
        const requestId = command.requestId || null;
        const result = evalFiberPropContract(command.fiberId, command.propName);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'fiber-schedule-update': {
        const requestId = command.requestId || null;
        const result = evalFiberScheduleUpdate(command.fiberId, command.ownerIndex);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-prop-value': {
        const requestId = command.requestId || null;
        const result = evalPropValue(command.probeId, command.prop, command.ownerIndex);
        send({ type: 'eval-probe-result', clientId, requestId, result });
        break;
      }
      case 'eval-avalanche': {
        const requestId = command.requestId || null;
        const result = evalAvalanche(command);
        send({ type: 'eval-avalanche-result', clientId, requestId, result });
        break;
      }
      case 'eval-script': {
        const requestId = command.requestId || null;
        // async — must be handled with a promise. send result when ready.
        evalScript(command).then((result) => {
          send({ type: 'eval-script-result', clientId, requestId, result });
        });
        break;
      }
      default:
        break;
    }
  }

  // ─── Generic in-page script execution ────────────────────────────────────
  // Snippet receives ctx = { args, helpers, log[] }. Must return a JSON-serializable value.
  // Helpers walk React fibers from all roots discovered via DevTools renderer interface.

  async function evalScript(command) {
    const startedAt = Date.now();
    const source = String(command.source || '');
    const args = command.args && typeof command.args === 'object' ? command.args : {};
    const timeoutMs = Math.min(30000, Math.max(50, Number(command.timeoutMs) || 5000));
    if (!source.trim()) return { ok: false, error: 'empty script source' };
    const log = [];
    const helpers = buildScriptHelpers(log);
    const ctx = { args, helpers, log };
    try {
      // Wrap as async IIFE; allow `return` and `await`. Indirect Function() to keep page-scope, not extension scope.
      const factory = new Function(
        'ctx',
        '"use strict"; return (async function chippyScript(ctx){\n' + source + '\n}).call(globalThis, ctx);',
      );
      const resultPromise = Promise.resolve(factory(ctx));
      const timeout = new Promise((_, reject) => global.setTimeout(() => reject(new Error('script timeout after ' + timeoutMs + 'ms')), timeoutMs));
      const value = await Promise.race([resultPromise, timeout]);
      const safe = safeJson(value);
      return { ok: true, durationMs: Date.now() - startedAt, log, result: safe };
    } catch (e) {
      return { ok: false, durationMs: Date.now() - startedAt, log, error: String(e?.stack || e?.message || e) };
    }
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-introspect.ts
  function safeJson(value, depth, seen) {
    const b = getBridge();
    if (b) return b.safeJson(value, depth, seen);
    // Minimal fallback: pass primitives through, stringify the rest.
    if (value == null) return value;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    return String(value);
  }

  const fiberRegistry = new Map();
  let fiberRegistrySeq = 1;

  function rememberFiber(fiber) {
    const id = 'fiber:' + (fiberRegistrySeq++);
    fiberRegistry.set(id, fiber);
    return id;
  }

  function normalizeRememberedFiberId(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    return /^\d+$/.test(raw) ? `fiber:${raw}` : raw;
  }

  function getRememberedFiber(id) {
    const key = normalizeRememberedFiberId(id);
    return key ? (fiberRegistry.get(key) || null) : null;
  }

  function buildScriptHelpers(log) {
    function devtoolsHook() { return global.__REACT_DEVTOOLS_GLOBAL_HOOK__ || null; }
    function getDisplayName(fiber) {
      const t = fiber?.type;
      if (!t) return null;
      return t.displayName || t.name || (typeof t === 'string' ? t : null);
    }
    function getRootFibers() {
      const hook = devtoolsHook();
      const out = [];
      if (!hook?.renderers) return out;
      const seen = new Set();
      for (const [rendererId] of hook.renderers) {
        try {
          if (hook.getFiberRoots) {
            const roots = hook.getFiberRoots(rendererId);
            if (roots && typeof roots.forEach === 'function') {
              roots.forEach((root) => {
                if (root && !seen.has(root)) {
                  seen.add(root);
                  out.push(root);
                }
              });
            }
          }
        } catch (_) {}
      }
      // Robust fallback: walk all root containers via document
      const containers = document.querySelectorAll('[id], body div, body main');
      containers.forEach((el) => {
        const key = Object.keys(el).find((k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
        if (!key) return;
        let fiber = el[key];
        // climb to root
        while (fiber && fiber.return) fiber = fiber.return;
        if (fiber && !seen.has(fiber)) { seen.add(fiber); out.push(fiber); }
      });
      return out;
    }
    function walkAll(visit, options) {
      const limit = options?.limit ?? 200000;
      let count = 0;
      const roots = getRootFibers();
      for (const root of roots) {
        const stack = [root];
        while (stack.length) {
          const f = stack.pop();
          if (!f) continue;
          if (count++ > limit) { log.push('walkAll: hit limit ' + limit); return; }
          try { visit(f); } catch (e) { log.push('visit error: ' + (e?.message || e)); }
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
      }
    }
    function findFibers(predicate, options) {
      const out = [];
      const max = options?.max ?? 5000;
      walkAll((f) => { if (out.length < max && predicate(f)) out.push(f); }, options);
      return out;
    }
    function fiberInfo(f) {
      const dom = f?.stateNode && f.stateNode.nodeType === 1 ? f.stateNode : null;
      return {
        name: getDisplayName(f),
        tag: typeof f?.tag === 'number' ? f.tag : null,
        elementType: typeof f?.elementType === 'object' ? null : (f?.elementType?.displayName || f?.elementType?.name || null),
        source: getFiberSource(f),
        owner: f?._debugOwner ? (getDisplayName(f._debugOwner) || null) : null,
        domTag: dom?.tagName?.toLowerCase() || null,
        domText: dom?.textContent ? String(dom.textContent).trim().slice(0, 120) : null,
        domTestId: dom?.getAttribute?.('data-testid') || null,
      };
    }
    function ancestorFibers(fiber, max = 30) {
      const out = [];
      let cur = fiber?.return || null;
      while (cur && out.length < max) { out.push(fiber.return ? fiberInfo(cur) : null); cur = cur.return; }
      return out.filter(Boolean);
    }
    return { getDisplayName, getRootFibers, walkAll, findFibers, fiberInfo, ancestorFibers, devtoolsHook };
  }

  // ─── DOM node inspection ──────────────────────────────────────────────────

  function getProbeData(probeId) {
    const probeData = chippy.layoutLab?.getMarkerProbe?.(String(probeId));
    if (!probeData?.probe) return { error: 'No probe data for ' + probeId };
    return probeData;
  }

  function getProbeElement(probeId) {
    const probeData = getProbeData(probeId);
    if (probeData?.error) return probeData;
    const element = probeData.probe?._targetEl || null;
    if (!element) return { error: 'No target element for probe ' + probeId + ' (probe not placed on an element)' };
    return { probeData, element };
  }

  function getProbeFiber(probeId) {
    const probeData = getProbeData(probeId);
    if (probeData?.error) return probeData;
    const fiber = probeData.probe?._bestFiber || null;
    if (!fiber) return { error: 'No fiber for probe ' + probeId };
    return { probeData, fiber };
  }

  function getFiberDomNode(fiber) {
    if (!fiber) return null;
    let current = fiber;
    while (current) {
      const node = current.stateNode;
      if (node && node.nodeType === 1) return node;
      current = current.child || null;
    }
    return null;
  }

  function normalizeTargetText(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  function describeClickedElement(element) {
    if (!element || element.nodeType !== 1) return null;
    return {
      tag: String(element.tagName || '').toLowerCase() || null,
      testId: element.getAttribute?.('data-testid') || null,
      text: normalizeTargetText(element.textContent || ''),
    };
  }

  /** @param {{ selector?: string, probeId?: string, fiberId?: string, [key: string]: any }} [target] */
  function resolvePageClickTarget(target = {}) {
    if (target == null || typeof target !== 'object') {
      return { ok: false, error: 'target object is required' };
    }
    if (target.selector != null) {
      const selector = String(target.selector || '').trim();
      if (!selector) return { ok: false, error: 'selector is required' };
      let elements;
      try {
        elements = Array.from(global.document.querySelectorAll(selector));
      } catch (e) {
        return { ok: false, error: `invalid selector: ${e.message}` };
      }
      if (elements.length === 0) return { ok: false, error: `selector matched no elements: ${selector}` };
      if (elements.length > 1) {
        return { ok: false, error: `selector matched ${elements.length} elements; refine the selector to one target`, matched: elements.length };
      }
      return { ok: true, mode: 'selector', selector, element: elements[0] };
    }
    if (target.probeId != null) {
      const probeId = String(target.probeId || '').trim();
      if (!probeId) return { ok: false, error: 'probeId is required' };
      const resolved = getProbeElement(probeId);
      if (resolved?.error) return { ok: false, error: resolved.error };
      return { ok: true, mode: 'probe', probeId, element: resolved.element };
    }
    if (target.fiberId != null) {
      const fiberId = normalizeRememberedFiberId(target.fiberId);
      if (!fiberId) return { ok: false, error: 'fiberId is required' };
      const fiber = getRememberedFiber(fiberId);
      if (!fiber) return { ok: false, error: `fiber ${fiberId} not found` };
      const element = getFiberDomNode(fiber);
      if (!element) return { ok: false, error: `fiber ${fiberId} has no DOM node` };
      return { ok: true, mode: 'fiber', fiberId, element };
    }
    return { ok: false, error: 'one of selector, probeId, or fiberId is required' };
  }

  function evalPageClick(target) {
    const resolved = resolvePageClickTarget(target);
    if (!resolved.ok) return resolved;
    const element = resolved.element;
    if (!element || typeof element.click !== 'function') {
      return { ok: false, error: 'target element is not clickable', target: describeClickedElement(element) };
    }
    element.click();
    return {
      ok: true,
      mode: resolved.mode,
      target: describeClickedElement(element),
      selector: resolved.selector || null,
      probeId: resolved.probeId || null,
      fiberId: resolved.fiberId ?? null,
    };
  }

  function readFiberProp(fiberId, propName) {
    const rememberedFiberId = normalizeRememberedFiberId(fiberId);
    if (!rememberedFiberId) return { ok: false, error: 'fiberId is required' };
    const name = String(propName || '').trim();
    if (!name) return { ok: false, error: 'propName is required' };
    const fiber = getRememberedFiber(rememberedFiberId);
    if (!fiber) return { ok: false, error: `fiber ${rememberedFiberId} not found`, fiberId: rememberedFiberId };
    const props = fiber.memoizedProps;
    if (!props || typeof props !== 'object') {
      return { ok: false, error: `fiber ${rememberedFiberId} has no props`, fiberId: rememberedFiberId, fiber };
    }
    if (!(name in props)) {
      return { ok: false, error: `prop ${name} not found on fiber ${rememberedFiberId}`, fiberId: rememberedFiberId, fiber, props };
    }
    return { ok: true, fiberId: rememberedFiberId, fiber, props, propName: name, value: props[name] };
  }

  function getFiberDisplayName(fiber) {
    if (!fiber) return 'Unknown';
    if (typeof fiber.type === 'string') return fiber.type;
    if (fiber.type && (fiber.type.displayName || fiber.type.name)) return fiber.type.displayName || fiber.type.name;
    if (typeof fiber.elementType === 'string') return fiber.elementType;
    if (fiber.elementType && (fiber.elementType.displayName || fiber.elementType.name)) return fiber.elementType.displayName || fiber.elementType.name;
    return 'Unknown';
  }

  function functionSourcePreview(fn, max = 800) {
    try {
      const source = Function.prototype.toString.call(fn);
      return source.length > max ? source.slice(0, max) + '…' : source;
    } catch (e) {
      return null;
    }
  }

  function getFiberSource(fiber) {
    const b = getBridge();
    if (b?.describeFiberSource) return b.describeFiberSource(fiber);
    const source = fiber?._debugSource || fiber?.type?._debugSource || null;
    if (!source) return null;
    return {
      fileName: source.fileName || null,
      lineNumber: source.lineNumber || null,
      columnNumber: source.columnNumber || null,
    };
  }

  function summarizeFunctionContract(value) {
    if (typeof value !== 'function') {
      return { propType: typeof value, isFunction: false, fnLength: null, fnName: null, fnSourcePreview: null };
    }
    return {
      propType: 'function',
      isFunction: true,
      fnLength: Number.isFinite(value.length) ? value.length : null,
      fnName: value.name || null,
      fnSourcePreview: functionSourcePreview(value),
    };
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-invoke.ts
  function evalFiberPropContract(fiberId, propName) {
    const b = getBridge();
    if (!b || !b.evalFiberPropContract) return { ok: false, error: 'bridge module not loaded' };
    return b.evalFiberPropContract(fiberId, propName, {
      normalizeRememberedFiberId,
      getRememberedFiber,
    });
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-invoke.ts
  // Returns a Promise. The handler routes async responses through `send` once resolved.
  function evalFiberInvoke(fiberId, propName, args) {
    const b = getBridge();
    if (!b || !b.evalFiberInvoke) return Promise.resolve({ ok: false, error: 'bridge module not loaded' });
    return Promise.resolve(b.evalFiberInvoke(fiberId, propName, args, {
      normalizeRememberedFiberId,
      getRememberedFiber,
      safeSerialize,
    }));
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-schedule-update.ts
  // Forces one re-render on a fiber via the DevTools renderer's scheduleUpdate.
  function evalFiberScheduleUpdate(fiberId, ownerIndex) {
    const b = getBridge();
    if (!b || !b.evalFiberScheduleUpdate) {
      return { ok: false, reason: 'no-scheduleUpdate', error: 'bridge module not loaded' };
    }
    return b.evalFiberScheduleUpdate(fiberId, ownerIndex, {
      normalizeRememberedFiberId,
      getRememberedFiber,
    });
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/eval-helpers.ts
  function evalElementDom(element, parentLevel) {
    const b = getBridge();
    if (!b) return { error: 'bridge module not loaded' };
    return b.evalElementDom(element, parentLevel, window.getComputedStyle.bind(window));
  }

  function evalProbeDom(probeId, parentLevel) {
    const resolved = getProbeElement(probeId);
    if (resolved?.error) return resolved;
    return evalElementDom(resolved.element, parentLevel);
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/eval-helpers.ts
  function evalFiberProps(baseFiber, ownerIndex) {
    const b = getBridge();
    if (!b) return { error: 'bridge module not loaded' };
    return b.evalFiberProps(baseFiber, ownerIndex, chippy.layoutLab?.getHookSummary, resolveOwnerFiber);
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/eval-helpers.ts
  function evalFiberPropValue(baseFiber, propName, ownerIndex) {
    const b = getBridge();
    if (!b) return { error: 'bridge module not loaded' };
    return b.evalFiberPropValue(baseFiber, propName, ownerIndex, chippy.layoutLab?.getHookSummary, resolveOwnerFiber, safeSerialize);
  }

  // Delegated to avalanche.iife.js — see src/debug-render/replay.ts
  function evalFiberHooks(fiber) {
    const r = getReplay();
    if (r) return r.evalFiberHooks(fiber);
    if (!fiber) return { name: 'Unknown', hookCount: 0, truncated: false, maxHooks: 500, hooks: [], error: 'No fiber available' };
    return { name: (fiber.type && (fiber.type.displayName || fiber.type.name)) || 'Unknown', hookCount: 0, truncated: false, maxHooks: 500, hooks: [] };
  }

  function summarizeHookList(raw) {
    const b = getBridge();
    return b ? b.summarizeHookList(raw) : (raw || { error: 'bridge module not loaded' });
  }

  function formatCounts(counts) {
    const b = getBridge();
    return b ? b.formatCounts(counts) : '';
  }

  // ─── Replay engine — delegated to avalanche.iife.js → __AVALANCHE__.replay ─
  // The full implementation lives in src/debug-render/replay.ts and is bundled
  // into dist/avalanche.iife.js (single Chippy IIFE; no extra globals).
  // These shims delegate to that module, with inline fallbacks so the bridge
  // does not hard-crash when avalanche.iife.js has not yet loaded.

  function getReplay() {
    const av = getAvalancheApi();
    return (av && av.replay) || null;
  }

  function getBridge() {
    const av = getAvalancheApi();
    return (av && av.bridge) || null;
  }

  function replayErrorPayload(e) {
    const r = getReplay();
    if (r) return r.replayErrorPayload(e);
    if (!e) return null;
    return { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' };
  }

  function logReplayError(label, componentName, err) {
    const r = getReplay();
    if (r) { r.logReplayError(label, componentName, err); return; }
    try { console.error('[Chippy replay-error] ' + label + ' ' + componentName, err); } catch (_) {}
  }

  // ─── Safe serialization ───────────────────────────────────────────────────

  function safeSerialize(value, depth, seen) {
    const r = getReplay();
    if (r) return r.safeSerialize(value, depth === undefined ? 0 : depth, seen === undefined ? new Set() : seen);
    // Minimal inline fallback (used only before avalanche.iife.js loads).
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'function') return '[function' + (value.name ? ':' + value.name : '') + ']';
    if (typeof value === 'symbol') return '[symbol:' + value.toString() + ']';
    if (Array.isArray(value)) return '[array:' + value.length + ']';
    return '[object]';
  }

  // ─── Probe props eval ─────────────────────────────────────────────────────

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-introspect.ts
  // Walks _debugOwner chain for component fibers; ownerIndex is deterministic.
  function resolveOwnerFiber(baseFiber, ownerIndex) {
    const b = getBridge();
    if (b) return b.resolveOwnerFiber(baseFiber, ownerIndex);
    return null; // safe fallback — caller treats null as "not found"
  }

  function getFiberDomSummary(fiber) {
    const dom = getFiberDomNode(fiber);
    if (!dom) return null;
    return {
      tag: dom.tagName ? dom.tagName.toLowerCase() : null,
      testId: dom.getAttribute?.('data-testid') || null,
      text: dom.textContent ? String(dom.textContent).trim().slice(0, 120) : null,
    };
  }

  function summarizePathFiber(fiber, index, relation) {
    if (!fiber) return null;
    const props = fiber.memoizedProps || {};
    const propNames = props && typeof props === 'object'
      ? Object.keys(props).filter((k) => k !== 'children')
      : [];
    const hooks = evalFiberHooks(fiber);
    return {
      index,
      relation,
      name: getFiberDisplayName(fiber),
      tag: typeof fiber.tag === 'number' ? fiber.tag : null,
      key: fiber.key ?? null,
      propNames,
      hookCount: hooks?.hookCount ?? null,
      hookCountTruncated: hooks?.truncated ?? false,
      hookCountMax: hooks?.maxHooks ?? null,
      source: getFiberSource(fiber),
      dom: getFiberDomSummary(fiber),
    };
  }

  function summarizeOwnerFiber(fiber, ownerIndex) {
    const summary = summarizePathFiber(fiber, ownerIndex, 'owner');
    if (!summary) return null;
    const { index, relation, tag, dom, ...owner } = summary;
    return { ownerIndex: index, ...owner };
  }

  function collectParentFibers(fiber, max) {
    const limit = Math.max(0, Math.min(200, Number(max) || 50));
    const parents = [];
    let cur = fiber?.return || null;
    while (cur && parents.length < limit) {
      parents.push(summarizePathFiber(cur, parents.length, 'return'));
      cur = cur.return || null;
    }
    return parents.filter(Boolean);
  }

  function evalFiberParents(fiber, fiberId, max) {
    if (!fiber) return { ok: false, error: 'No fiber available' };
    return {
      ok: true,
      fiberId: fiberId || null,
      component: summarizePathFiber(fiber, -1, 'self'),
      parents: collectParentFibers(fiber, max),
    };
  }

  function evalProbeParents(probeId, max) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return { ok: false, ...resolved };
    return { probeId: String(probeId), ...evalFiberParents(resolved.fiber, null, max) };
  }

  function evalProbeOwners(probeId) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return { ok: false, ...resolved };
    const componentHooks = evalFiberHooks(resolved.fiber);
    const props = resolved.fiber?.memoizedProps || {};
    const propNames = props && typeof props === 'object'
      ? Object.keys(props).filter((k) => k !== 'children')
      : [];
    const owners = [];
    for (let i = 0; i < 50; i++) {
      const owner = resolveOwnerFiber(resolved.fiber, i);
      if (!owner) break;
      owners.push(summarizeOwnerFiber(owner, i));
    }
    return {
      ok: true,
      probeId: String(probeId),
      component: {
        name: getFiberDisplayName(resolved.fiber),
        propNames,
        hookCount: componentHooks?.hookCount ?? null,
        hookCountTruncated: componentHooks?.truncated ?? false,
        hookCountMax: componentHooks?.maxHooks ?? null,
      },
      owners,
    };
  }

  function evalProbeProps(probeId, ownerIndex) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return resolved;
    return evalFiberProps(resolved.fiber, ownerIndex);
  }

  // ─── Single prop value eval ───────────────────────────────────────────────

  function evalPropValue(probeId, propName, ownerIndex) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return resolved;
    return evalFiberPropValue(resolved.fiber, propName, ownerIndex);
  }

  // ─── Probe hooks eval ─────────────────────────────────────────────────────

  function evalProbeHooks(probeId) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return resolved;
    return evalFiberHooks(resolved.fiber);
  }

  function evalProbeHooksSummary(probeId) {
    const raw = evalProbeHooks(probeId);
    return summarizeHookList(raw);
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/eval-helpers.ts
  function evalFindFibers(filters) {
    const b = getBridge();
    if (!b) return { count: 0, items: [], error: 'bridge module not loaded' };
    return b.evalFindFibers(filters, buildScriptHelpers([]), rememberFiber);
  }

  function evalCaptureFiberState(options) {
    const b = getBridge();
    if (!b?.captureFiberState) return { ok: false, error: 'bridge module not loaded' };
    const helpers = buildScriptHelpers([]);
    return b.captureFiberState({
      ...options,
      page: { url: global.location?.href || null, title: global.document?.title || null },
    }, {
      getRootFibers: helpers.getRootFibers,
      getDisplayName: helpers.getDisplayName,
    });
  }

  function evalCompareFiberStates(before, after, options) {
    const b = getBridge();
    if (!b?.compareFiberStates) return { ok: false, error: 'bridge module not loaded' };
    return b.compareFiberStates(before, after, options);
  }

  // Declarative Error/Suspense inspection is bundled with Avalanche so the
  // extension shim stays version-coupled but implementation-free.
  function evalBoundaryChain(fiber, max) {
    const b = getBridge();
    if (!b) return { ok: false, error: 'bridge module not loaded' };
    return b.inspectDeclarativeBoundaryChain(fiber, max, {
      rememberFiber,
      getFiberDomNode: getAvalancheApi()?.layoutLab?.getFiberDomNode || getFiberDomNode,
    });
  }

  function evalProbeBoundaries(probeId, max) {
    const resolved = getProbeFiber(probeId);
    if (resolved?.error) return { ok: false, ...resolved };
    return { probeId: String(probeId), ...evalBoundaryChain(resolved.fiber, max) };
  }

  function evalInspectFiberBoundaries(fiberId, max) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { ok: false, error: 'Unknown fiberId: ' + fiberId };
    return { fiberId: String(fiberId), ...evalBoundaryChain(fiber, max) };
  }

  function evalPageBoundaries(max) {
    const b = getBridge();
    if (!b) return { ok: false, error: 'bridge module not loaded' };
    const helpers = buildScriptHelpers([]);
    return b.inspectPageDeclarativeBoundaries(max, {
      rememberFiber,
      getFiberDomNode: getAvalancheApi()?.layoutLab?.getFiberDomNode || getFiberDomNode,
      getRootFibers: helpers.getRootFibers,
    });
  }

  function evalInspectFiberHooks(fiberId) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { error: 'Unknown fiberId: ' + fiberId };
    return { fiberId: String(fiberId), ...evalFiberHooks(fiber) };
  }

  function evalInspectFiberHooksSummary(fiberId) {
    return summarizeHookList(evalInspectFiberHooks(fiberId));
  }

  // Delegated to avalanche.iife.js — see src/debug-render/replay.ts
  function noop() {}
  function getDispatcherRef() { const r = getReplay(); return r ? r.getDispatcherRef() : null; }
  function readHookValueFromNode(hookNode) { const r = getReplay(); return r ? r.readHookValueFromNode(hookNode) : (hookNode ? hookNode.memoizedState : undefined); }
  function fiberOnlyHookRecords(fiber) { const r = getReplay(); return r ? r.fiberOnlyHookRecords(fiber) : []; }
  function readContextValueFromFiber(fiber, contextArg) { const r = getReplay(); return r ? r.readContextValueFromFiber(fiber, contextArg) : undefined; }
  function isDispatcherIdle(ref) { const r = getReplay(); return r ? r.isDispatcherIdle(ref) : false; }

  // Delegated to avalanche.iife.js — see src/debug-render/replay.ts
  function replayComponentHooks(fiber) {
    const r = getReplay();
    if (r) return r.replayComponentHooks(fiber);
    // Minimal fallback: fiber-only records, no replay attempted.
    const componentName = (fiber && fiber.type && (fiber.type.displayName || fiber.type.name)) || 'Unknown';
    return {
      componentName,
      records: fiberOnlyHookRecords(fiber),
      replayAttempted: false,
      replayError: 'avalanche.iife.js not loaded',
      replayErrorDetails: null,
      replayStatus: 'fiber-only-fallback',
    };
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-introspect.ts
  function evalInspectFiberStructure(fiberId, hookIndex, windowSize) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { error: 'Unknown fiberId: ' + fiberId };
    const b = getBridge();
    if (!b) return { error: 'bridge module not loaded' };
    return b.inspectFiberStructure(fiber, fiberId, hookIndex, windowSize, replayComponentHooks, evalFiberHooks);
  }

  function evalInspectFiberProps(fiberId) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { error: 'Unknown fiberId: ' + fiberId };
    return { fiberId: String(fiberId), ...evalFiberProps(fiber, null) };
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-introspect.ts
  function findFiberByName(name) {
    const b = getBridge();
    if (!b) return null;
    return b.findFiberByName(name, buildScriptHelpers([]));
  }

  function renderTreeText(componentName, source, groups) {
    const b = getBridge();
    return b ? b.renderTreeText(componentName, source, groups) : componentName;
  }

  function resolveFiberTarget(probeIdRaw, fiberIdRaw, nameRaw) {
    let fiber = null;
    let resolvedBy = null;
    if (probeIdRaw != null) {
      const resolved = getProbeFiber(probeIdRaw);
      if (resolved?.error) return { error: resolved.error };
      fiber = resolved.fiber;
      resolvedBy = 'probe';
    }
    if (!fiber && fiberIdRaw) {
      fiber = getRememberedFiber(fiberIdRaw);
      if (fiber) resolvedBy = 'fiberId';
    }
    if (!fiber && nameRaw) {
      fiber = findFiberByName(nameRaw);
      if (fiber) resolvedBy = 'name';
    }
    if (!fiber) return { error: fiberIdRaw ? ('Unknown fiberId: ' + fiberIdRaw) : ('No fiber matches name: ' + nameRaw) };
    return { fiber, resolvedBy };
  }

  async function evalDescribeComponent(fiberIdRaw, nameRaw) {
    const b = getBridge();
    if (!b) return { ok: false, error: 'bridge module not loaded' };
    const target = resolveFiberTarget(null, fiberIdRaw, nameRaw);
    if (target.error) return { ok: false, error: target.error };
    if (b.resolveFiberSource) await b.resolveFiberSource(target.fiber);
    return b.evalDescribeComponent(fiberIdRaw, nameRaw, {
      // Keep source resolution, hook reads, and replay on the same fiber even
      // if React commits while the source map is being fetched.
      resolveFiberTarget: () => target,
      rememberFiber,
      getRememberedFiber,
      evalFiberHooks,
      replayComponentHooks,
      renderTreeText: b.renderTreeText,
    });
  }

  function renderCompactComponentText(componentName, source, summary, records, warnings) {
    const b = getBridge();
    return b ? b.renderCompactComponentText(componentName, source, summary, records, warnings) : componentName;
  }

  async function evalExplainComponent(probeIdRaw, fiberIdRaw, nameRaw) {
    const target = resolveFiberTarget(probeIdRaw, fiberIdRaw, nameRaw);
    if (target.error) return { ok: false, error: target.error };
    const { fiber, resolvedBy } = target;
    const b = getBridge();
    if (b?.resolveFiberSource) await b.resolveFiberSource(fiber);
    const fiberId = fiberIdRaw && getRememberedFiber(fiberIdRaw) ? String(fiberIdRaw) : rememberFiber(fiber);
    const raw = { fiberId, ...evalFiberHooks(fiber) };
    const summary = summarizeHookList(raw);
    const { componentName, records, replayAttempted, replayError, replayErrorDetails, replayStatus } = replayComponentHooks(fiber);
    summary.liveHookCount = summary.hookCount;
    summary.replayedHookCount = records.filter((r) => r.index != null).length;
    const source = getFiberSource(fiber);
    const warnings = [];
    if (!replayAttempted) warnings.push('fiber-only: component functions and hooks were not executed; custom-hook ancestry is unavailable unless captured metadata exists');
    if (replayError) warnings.push('replay-error: ' + replayError + ' (stack logged to browser console)');
    const text = renderCompactComponentText(componentName, source, summary, records, warnings);
    return {
      ok: true,
      componentName,
      fiberId,
      resolvedBy,
      source: source ? { fileName: source.fileName || null, lineNumber: source.lineNumber || null } : null,
      hookCount: summary.hookCount,
      liveHookCount: summary.liveHookCount,
      replayedHookCount: summary.replayedHookCount,
      replayStatus: replayStatus || 'not-run-fiber-only',
      text,
      captureEngineOk: true,
      warnings,
      replayError: replayError || undefined,
      replayErrorDetails: replayErrorDetails || undefined,
    };
  }

  // Delegated to avalanche.iife.js — see src/chippy-bridge/fiber-introspect.ts
  function evalInspectFiberOwners(fiberId) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { error: 'Unknown fiberId: ' + fiberId };
    const b = getBridge();
    if (!b) return { error: 'bridge module not loaded' };
    return b.inspectFiberOwners(fiber, fiberId, buildScriptHelpers([]));
  }

  function evalInspectFiberParents(fiberId, max) {
    const fiber = getRememberedFiber(fiberId);
    if (!fiber) return { ok: false, error: 'Unknown fiberId: ' + fiberId };
    return evalFiberParents(fiber, String(fiberId), max);
  }


  // ─── Connection ──────────────────────────────────────────────────────────

  function connect() {
    const wsUrl = deriveWsUrl(config.helperBaseUrl);
    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
      setConnState('connected');
      // Defer hello + snapshot slightly so React has time to render
      // and detectBuildMode() has fibers to walk.
      global.setTimeout(() => {
        if (destroyed) return;
        buildMode = detectBuildMode();
        sendHello('open');
        if (config.activated && !probesInstalled()) {
          // A navigation clears the DOM; an ordinary socket reconnect does not.
          chippy.layoutLab?.exposeDefaultMarkers?.();
        } else if (config.activated) {
          chippy.layoutLab?.updatePanel?.();
        }
        scheduleSnapshot('open');
      }, 350);
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') {
          // server echoes back our real clientId if it assigned one
        }
        if (payload.type === 'command') {
          handleCommand(payload.command);
        }
      } catch (e) {
        console.error('[chippy-bridge] message parse error:', e?.message || e);
      }
    });

    socket.addEventListener('close', () => {
      if (destroyed) return;
      setConnState('reconnecting');
      reconnectTimer = global.setTimeout(connect, config.reconnectDelayMs);
    });

    socket.addEventListener('error', () => {
      setConnState('failed');
    });
  }

  // ─── Config update ───────────────────────────────────────────────────────

  function applyConfig(nextConfig) {
    const previousBaseUrl = config.helperBaseUrl;
    const wasActivated = config.activated;

    const contextUi = nextConfig?.contextUiEnabled ?? nextConfig?.jiraUiEnabled;
    config = {
      ...config,
      ...nextConfig,
      helperBaseUrl: normalizeBaseUrl(nextConfig?.helperBaseUrl || config.helperBaseUrl),
      activated: nextConfig?.activated ?? config.activated,
      // contextUiEnabled wins; jiraUiEnabled mirrors it for older consumers.
      ...(contextUi === undefined ? {} : { contextUiEnabled: contextUi !== false, jiraUiEnabled: contextUi !== false }),
    };
    chippy.config = { ...config };
    if (config.ui === 'storybook-panel' || config.ui === 'none') {
      chippy.layoutLab?.removeInPageUi?.();
    }

    if (config.activated && !wasActivated && !probesInstalled()) {
      chippy.layoutLab?.exposeDefaultMarkers?.();
    }
    if (!config.activated && wasActivated) {
      chippy.layoutLab?.clearAll?.();
    }

    if (socket && previousBaseUrl !== config.helperBaseUrl) {
      try { socket.close(); } catch {}
    }
  }

  // ─── Event listeners ─────────────────────────────────────────────────────

  // Publish a fresh snapshot whenever layout-lab updates (markers moved/dropped/docked).
  onLayoutLabUpdate = (event) => {
    const reason = event.detail?.reason || 'layout-lab-update';
    // A boundary selection is a structured signal, not just a snapshot refresh:
    // forward the collateral boundary + distance to the helper as activity so it
    // is recorded distinctly from generic marker movement.
    if (reason === 'inspect-boundary') {
      sendActivity('inspect-boundary', {
        markerId: event.detail?.markerId ?? null,
        boundaryKind: event.detail?.boundaryKind ?? null,
        boundary: event.detail?.boundary ?? null,
        distance: event.detail?.distance ?? event.detail?.boundary?.distance ?? null,
      });
    }
    scheduleSnapshot(reason);
  };
  global.addEventListener('layout-lab:update', onLayoutLabUpdate);

  // Legacy postMessage path from the extension content-script
  onWindowMessage = (event) => {
    if (event.source !== global || event.data?.source !== 'chippy-extension') return;
    if (event.data.type === 'config') { applyConfig(event.data.payload || {}); scheduleSnapshot('config'); }
    if (event.data.type === 'activate') activate();
    if (event.data.type === 'deactivate') deactivate();
  };
  global.addEventListener('message', onWindowMessage);

  // CSP-safe commands from the extension content-script via CustomEvent
  onExtCommand = (event) => {
    const detail = event.detail || {};
    if (detail.type === 'deactivate') deactivate();
    if (detail.type === 'activate') activate();
    if (detail.type === 'apply-config') {
      applyConfig({ helperBaseUrl: detail.helperBaseUrl, activated: detail.activated });
      scheduleSnapshot('apply-config');
    }
  };
  global.document.addEventListener('chippy-ext-command', onExtCommand);

  locationInterval = global.setInterval(() => {
    if (global.location.href !== lastLocationHref) {
      lastLocationHref = global.location.href;
      sendHello('location-change');
      scheduleSnapshot('location-change');
    }
  }, 1000);

  heartbeatInterval = global.setInterval(() => {
    send({
      type: 'heartbeat',
      clientId,
      bridgeVersion: BRIDGE_VERSION,
      buildMode: resolveBuildMode(),
      page: getPageState(),
      integration: getIntegrationIdentity(),
      activated: config.activated,
      probesActive: probesActive(),
    });
  }, 15000);

  function handleFocusActivity() {
    const now = Date.now();
    if (now - lastFocusActivityAt < 750) return;
    lastFocusActivityAt = now;
    sendActivity('focus', { visibilityState: global.document.visibilityState || 'unknown' });
  }

  function handleVisibilityActivity() {
    const nextState = global.document.visibilityState || 'unknown';
    if (nextState === lastVisibilityState) return;
    lastVisibilityState = nextState;
    sendActivity(nextState === 'visible' ? 'visible' : 'hidden', { visibilityState: nextState });
  }

  function handlePointerActivity() {
    const now = Date.now();
    if (now - lastPointerActivityAt < 3000) return;
    lastPointerActivityAt = now;
    sendActivity('pointer', { visibilityState: global.document.visibilityState || 'unknown' });
  }

  global.addEventListener('focus', handleFocusActivity, true);
  global.addEventListener('pointerdown', handlePointerActivity, true);
  global.document.addEventListener('visibilitychange', handleVisibilityActivity, true);

  function destroy() {
    destroyed = true;
    try { if (reconnectTimer) global.clearTimeout(reconnectTimer); } catch (e) {}
    try { if (locationInterval) global.clearInterval(locationInterval); } catch (e) {}
    try { if (heartbeatInterval) global.clearInterval(heartbeatInterval); } catch (e) {}
    try { if (socket) socket.close(); } catch (e) {}
    try { if (onLayoutLabUpdate) global.removeEventListener('layout-lab:update', onLayoutLabUpdate); } catch (e) {}
    try { if (onWindowMessage) global.removeEventListener('message', onWindowMessage); } catch (e) {}
    try { if (onExtCommand) global.document.removeEventListener('chippy-ext-command', onExtCommand); } catch (e) {}
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  chippy.evalElementDom = evalElementDom;
  chippy.evalFiberProps = evalFiberProps;
  chippy.evalFiberPropValue = evalFiberPropValue;
  chippy.evalFiberHooks = evalFiberHooks;

  chippy.pageBridge = {
    version: BRIDGE_VERSION,
    helpers: buildScriptHelpers([]),
    __debug: {
      replayComponentHooks,
      evalDescribeComponent,
      evalExplainComponent,
      evalInspectFiberStructure,
      rememberFiber,
    },
    destroy,
    applyConfig,
     activate,
    deactivate,
    publishSnapshot,
    setProbeAnnotation,
    ensureProbes,
    clearProbes,
    showStatus,
    hideStatus,
    avalanche: {
      install() { return evalAvalanche({ action: 'install' }); },
      start(options) { return evalAvalanche({ action: 'start', max: options?.max }); },
      stop() { return evalAvalanche({ action: 'stop' }); },
      clear() { return evalAvalanche({ action: 'clear' }); },
      uninstall() { return evalAvalanche({ action: 'uninstall' }); },
      status() { return evalAvalanche({ action: 'status' }); },
      export() { return evalAvalanche({ action: 'export' }); },
      exportLast(count) { return evalAvalanche({ action: 'export-last', count }); },
      debugHook(sourceId, hookIndex, windowSize) { return evalAvalanche({ action: 'debug-hook', sourceId, hookIndex, window: windowSize }); },
      metrics() { return evalAvalanche({ action: 'metrics' }); },
      help() { return evalAvalanche({ action: 'help' }); },
    },
    getState() {
      return {
        clientId,
        config,
        owner: global.__CHIPPY_OWNER__ || null,
        ownerResult: global.__CHIPPY_OWNER_RESULT__ || null,
        integration: getIntegrationIdentity(),
        connState: chippy.connState || 'unknown',
        buildMode: resolveBuildMode(),
        page: getPageState(),
        activated: config.activated,
        probesActive: probesActive(),
        markers: summarizeMarkers(),
        avalanche: readAvalancheStatus(),
      };
    },
  };

  // If bootstrap/config asked for activation, expose probes immediately.
  // Do not wait for helper WebSocket open or an external command.
  if (config.activated && !probesInstalled()) {
    chippy.layoutLab?.exposeDefaultMarkers?.();
  }

  connect();
})(window);
