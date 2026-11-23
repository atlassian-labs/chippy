/**
 * Page-side composition root for Chippy and Avalanche.
 *
 * This file is intentionally the only place that assembles the public
 * `__AVALANCHE__` surface. The extension/import integrations can therefore
 * share the same React-internals implementation while their bridge shells
 * remain small and replaceable. Keep implementation in domain modules; a
 * bridge shim must not grow a second copy of a capability.
 */

import type { RenderedEvidenceStatus } from './avalanche/rendered-evidence-store';
import { createAvalancheDetector, DETECTION_LEVEL } from './avalanche/detector';
import { noteOwnWork } from './avalanche/own-work';
import { type AvalancheHookSummary, summarizeHookResults } from './avalanche/avalanche-hooks';
import {
  type IntegrationMode,
  getCommitMetricsAdapter,
  registerCommitMetricsAdapter,
  runPrePageHooks,
} from './avalanche/commit-metrics-adapter';
import {
  replayComponentHooks,
  evalFiberHooks,
  fiberOnlyHookRecords,
  classifyHook,
  safeSerialize,
  getDispatcherRef,
  isDispatcherIdle,
  customHookPathFromFrames,
  customHookPathFromStack,
  readContextValueFromFiber,
  readHookValueFromNode,
  PRIMITIVE_HOOK_NAMES,
  replayErrorPayload,
  logReplayError,
} from './debug-render/replay';
import {
  getFiberKey,
  getFiber,
  getDisplayName,
  isUserComponent,
  getNearestFiber,
  getNearestComponent,
  getHookSummary,
  getOwnerChain,
  getOwnerFibers,
  getFiberDomNode,
  getReturnComponentChain,
  getReturnComponentFibers,
  describeSource,
  describeFiberSource,
  resolveFiberSource,
  describeFiberTarget,
  describeComponent,
} from './layout-lab/fiber-walk';
import {
  describeContext,
  findBoundaryFibers,
  getContextProviders,
  registerContextProvider,
} from './layout-lab/marker-context';
import { enableDefaultPlugins, enablePlugins, listPlugins, registerPlugin, selectPlugins } from './plugins';
import { type PackLoadResult, type PackStatus, listPacks, registerPack, registerPacks, unregisterPack } from './plugins/pack';
import {
  PROBE_INTENTS,
  normalizeProbeAnnotation,
  updateProbeAnnotation,
} from './layout-lab/probe-intent';
import {
  summarizeHookList,
  formatCounts,
  renderTreeText,
  renderCompactComponentText,
} from './chippy-bridge/inspect-formatters';
import { evalDescribeComponent as evalDescribeComponentImpl } from './chippy-bridge/describe-component';
import {
  readAvalancheStatus as readAvalancheStatusImpl,
  evalAvalanche as evalAvalancheImpl,
  evalAvalancheWithNames as evalAvalancheWithNamesImpl,
} from './chippy-bridge/avalanche-commands';
import {
  evalElementDom as evalElementDomImpl,
  evalFiberProps as evalFiberPropsImpl,
  evalFiberPropValue as evalFiberPropValueImpl,
  evalFindFibers as evalFindFibersImpl,
  resolveFindFiberSources as resolveFindFiberSourcesImpl,
  warmFindFiberNames as warmFindFiberNamesImpl,
} from './chippy-bridge/eval-helpers';
import { applyRecoveredOrigin, readComponentName, resolveComponentOrigin } from './chippy-bridge/component-origin';
import { applyProductionBreadcrumbs } from './chippy-bridge/production-breadcrumbs';
import { scriptResultJson } from './chippy-bridge/script-result';
import { runChippyScript } from './chippy-bridge/script-kit/run-script';
import { clearOverlay } from './chippy-bridge/script-kit/overlay';
import { measureComponentArea } from './chippy-bridge/component-area/measure';
import { readAreaWatch, startAreaWatch, stopAreaWatch } from './chippy-bridge/component-area/watch';
import {
  safeJson as safeJsonImpl,
  resolveOwnerFiber as resolveOwnerFiberImpl,
  getOwnerStackKind as getOwnerStackKindImpl,
  findFiberByName as findFiberByNameImpl,
  inspectFiberOwners as inspectFiberOwnersImpl,
  inspectFiberStructure as inspectFiberStructureImpl,
} from './chippy-bridge/fiber-introspect';
import {
  evalFiberInvoke as evalFiberInvokeImpl,
  evalFiberPropContract as evalFiberPropContractImpl,
} from './chippy-bridge/fiber-invoke';
import { evalFiberScheduleUpdate as evalFiberScheduleUpdateImpl } from './chippy-bridge/fiber-schedule-update';
import { captureFiberState as captureFiberStateImpl, compareFiberStates as compareFiberStatesImpl } from './chippy-bridge/fiber-state';
import {
  inspectDeclarativeBoundaryChain as inspectDeclarativeBoundaryChainImpl,
  inspectPageDeclarativeBoundaries as inspectPageDeclarativeBoundariesImpl,
} from './chippy-bridge/declarative-boundaries';
import type { DescribeComponentDeps } from './chippy-bridge/describe-component';

type StartupConfig = {
  /** Plugin ids to enable before React evaluates, e.g. `['my-plugin']`. */
  plugins?: string[];
  /** Chippy packs (JSON) the extension stored; registered and enabled at load. */
  packs?: unknown[];
  avalanche?: {
    autoStart?: boolean;
    /** Detector options applied when autoStart installs Avalanche. */
    options?: Pick<NonNullable<Parameters<typeof createAvalancheDetector>[0]>, 'detectionMode' | 'captureFibers'>;
    /** History size for the auto-started detector. */
    max?: number;
  };
};

type DevtoolsRenderer = {
  currentDispatcherRef?: unknown;
};

type DevtoolsHook = {
  supportsFiber: boolean;
  renderers: Map<number, DevtoolsRenderer>;
  inject(renderer: DevtoolsRenderer): number;
  onScheduleFiberRoot(): void;
  onCommitFiberRoot(): void;
  onCommitFiberUnmount(): void;
  onPostCommitFiberRoot(): void;
};

type GlobalWithChippyRuntime = typeof globalThis & {
  // Another Chippy copy may have published this, so its methods are not guaranteed.
  __AVALANCHE__?: Partial<AvalancheApi>;
  __CHIPPY_STARTUP_CONFIG?: StartupConfig;
  /** Plugin ids for pages that load the bundle without a startup config. */
  __CHIPPY_PLUGINS?: string[];
  /** Chippy packs for pages that load the bundle without a startup config. */
  __CHIPPY_PACKS?: unknown[];
  /** Load result of every startup pack, including the invalid ones. */
  __CHIPPY_PACK_RESULTS__?: PackLoadResult[];
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook;
  top?: typeof globalThis & {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook;
  };
};

const runtime = globalThis as GlobalWithChippyRuntime;
// A second injection must reuse the already-published runtime. Replacing it
// would strand the bridge's references to the first detector and can create
// two commit listeners observing the same React root. An armed extension
// reload evaluates this bundle twice: once from the one-shot document_start
// registration and once from the background's navigation injection.
const publishedApi = runtime.__AVALANCHE__;

// Product-specific recognizers are plugins that ship outside this bundle
// (packed builds and packs). None is enabled unless the page opts in or a
// packed build names it as a default; enabling here, before early bootstrap
// calls runPrePageHooks(), lets an adapter's pre-page setup run.
{
  const fromConfig = runtime.__CHIPPY_STARTUP_CONFIG?.plugins;
  const fromGlobal = runtime.__CHIPPY_PLUGINS;
  if (Array.isArray(fromConfig) || Array.isArray(fromGlobal)) {
    selectPlugins([...(fromConfig ?? []), ...(fromGlobal ?? [])]);
  }
  const packsFromConfig = runtime.__CHIPPY_STARTUP_CONFIG?.packs;
  const packsFromGlobal = runtime.__CHIPPY_PACKS;
  if (Array.isArray(packsFromConfig) || Array.isArray(packsFromGlobal)) {
    runtime.__CHIPPY_PACK_RESULTS__ = registerPacks([...(packsFromConfig ?? []), ...(packsFromGlobal ?? [])]);
  }
}

// Do NOT seed a commit metrics adapter's host surface at bundle-load time.
// The host page owns that surface and defines/deletes it on its own
// lifecycle. Racing it causes a non-configurable descriptor conflict that
// makes host `delete` throw TypeError in strict mode. The adapter prepares
// its surface lazily inside api.install() only when Avalanche is started, and
// pre-page setup runs only when early bootstrap calls runPrePageHooks().

// React only registers its renderer when the DevTools hook exists while
// react-dom evaluates. The shim is deliberately minimal: it records the
// renderer object but does not pretend to be a DevTools client.
(function installDevtoolsShim() {
  if (runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const hook: DevtoolsHook = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = (this.renderers.size || 0) + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
  // A same-origin frame adopts the top frame's hook. Reading a cross-origin
  // top window throws, so such a frame keeps its own hook.
  let shared: DevtoolsHook | undefined;
  try {
    if (runtime.top && !runtime.top.__REACT_DEVTOOLS_GLOBAL_HOOK__) runtime.top.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    shared = runtime.top?.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  } catch (_) { /* cross-origin */ }
  runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = shared || hook;
})();

const startupConfig = runtime.__CHIPPY_STARTUP_CONFIG;
const __auto = !!startupConfig?.avalanche?.autoStart;

let detector: ReturnType<typeof createAvalancheDetector> | null = null;
let installed = false;

type AvalancheApi = {
  install: (options?: Parameters<typeof createAvalancheDetector>[0]) => { ok: true; detectionLevel: string } | { ok: false; error: string };
  uninstall: () => { ok: true };
  reset: () => { ok: true };
  /** Stop adding to the capture while staying attached; reset() or resume() records again. */
  pause: () => { ok: true } | { ok: false; error: string };
  resume: () => { ok: true } | { ok: false; error: string };
  report: (topN?: number, sortBy?: 'effect' | 'callback' | 'memo' | 'total', options?: Record<string, unknown>) => unknown;
  exportLast: (n?: number) => unknown;
  componentTypesFor: (sourceIds: Iterable<string>) => unknown[];
  unnamedRenderedTypes: () => unknown[];
  componentTypesNamed: (names?: Iterable<string>) => unknown[];
  debugHook: (sourceId: string, hookIndex: number, windowSize?: number) => unknown;
  _debugRawHookEvents: (componentName: string) => unknown;
  status: () => {
    installed: boolean;
    /** True after pause(): the capture holds only what came before `pausedAt`. */
    paused: boolean;
    /** performance.now() when the capture was paused, or null while it records. */
    pausedAt: number | null;
    hasMetricsGlobal: boolean;
    commitCount: number;
    integrationMode: IntegrationMode;
    /** Detection level of the running capture (`sources`, `full`, ...); null when not installed. */
    detectionMode: string | null;
    metricsAdapter: string | null;
    /** Network requests captured so far (Resource Timing). */
    networkRequests: number;
    /** `renderedByCommit` budget and what it dropped; null when not installed. */
    renderedEvidence: RenderedEvidenceStatus | null;
    /** Loaded packs and how to read their data. */
    packs: Array<{ id: string; label: string; instructions: string | null; extensions: PackStatus['extensions']; compileErrors: string[]; initErrors: string[] }>;
    /** Pack extension results keyed by report key, without per-commit steps; null when none ran. */
    hooks: Record<string, AvalancheHookSummary> | null;
  };
  registerCommitMetricsAdapter: typeof registerCommitMetricsAdapter;
  /** Enable plugins by id; returns the running ids. */
  enablePlugins: typeof enablePlugins;
  /** Register a plugin; `chippy pack` appends these calls to the bundle. */
  registerPlugin: typeof registerPlugin;
  /** Enable a packed build's defaults unless the page chose its own plugins. */
  enableDefaultPlugins: typeof enableDefaultPlugins;
  listPlugins: typeof listPlugins;
  /** Register and enable a Chippy pack (JSON object or text); a same-id pack is replaced. */
  registerPack: typeof registerPack;
  unregisterPack: typeof unregisterPack;
  /** Loaded packs with their agent instructions, kinds, scripts, and compile errors. */
  listPacks: typeof listPacks;
  runPrePageHooks: typeof runPrePageHooks;
  DETECTION_LEVEL: typeof DETECTION_LEVEL;
  replay: {
    replayComponentHooks: typeof replayComponentHooks;
    evalFiberHooks: typeof evalFiberHooks;
    fiberOnlyHookRecords: typeof fiberOnlyHookRecords;
    classifyHook: typeof classifyHook;
    safeSerialize: typeof safeSerialize;
    getDispatcherRef: typeof getDispatcherRef;
    isDispatcherIdle: typeof isDispatcherIdle;
    customHookPathFromFrames: typeof customHookPathFromFrames;
    customHookPathFromStack: typeof customHookPathFromStack;
    readContextValueFromFiber: typeof readContextValueFromFiber;
    readHookValueFromNode: typeof readHookValueFromNode;
    PRIMITIVE_HOOK_NAMES: typeof PRIMITIVE_HOOK_NAMES;
    replayErrorPayload: typeof replayErrorPayload;
    logReplayError: typeof logReplayError;
  };
  layoutLab: {
    getFiberKey: typeof getFiberKey;
    getFiber: typeof getFiber;
    getDisplayName: typeof getDisplayName;
    isUserComponent: typeof isUserComponent;
    getNearestFiber: typeof getNearestFiber;
    getNearestComponent: typeof getNearestComponent;
    getHookSummary: typeof getHookSummary;
    getOwnerChain: typeof getOwnerChain;
    getOwnerFibers: typeof getOwnerFibers;
    getFiberDomNode: typeof getFiberDomNode;
    getReturnComponentChain: typeof getReturnComponentChain;
    getReturnComponentFibers: typeof getReturnComponentFibers;
    describeSource: typeof describeSource;
    describeFiberSource: typeof describeFiberSource;
    resolveFiberSource: typeof resolveFiberSource;
    describeFiberTarget: typeof describeFiberTarget;
    describeComponent: typeof describeComponent;
    describeContext: typeof describeContext;
    registerContextProvider: typeof registerContextProvider;
    getContextProviders: typeof getContextProviders;
    findBoundaryFibers: typeof findBoundaryFibers;
    PROBE_INTENTS: typeof PROBE_INTENTS;
    normalizeProbeAnnotation: typeof normalizeProbeAnnotation;
    updateProbeAnnotation: typeof updateProbeAnnotation;
  };
  bridge: {
    summarizeHookList: typeof summarizeHookList;
    formatCounts: typeof formatCounts;
    renderTreeText: typeof renderTreeText;
    renderCompactComponentText: typeof renderCompactComponentText;
    evalDescribeComponent: (fiberIdRaw: unknown, nameRaw: unknown, deps: DescribeComponentDeps) => unknown;
    readAvalancheStatus: (api: unknown, mod: unknown) => unknown;
    evalAvalanche: (command: unknown, api: unknown, mod: unknown) => unknown;
    evalAvalancheWithNames: (command: unknown, api: unknown, mod: unknown) => Promise<unknown>;
    evalElementDom: typeof evalElementDomImpl;
    evalFiberProps: typeof evalFiberPropsImpl;
    evalFiberPropValue: typeof evalFiberPropValueImpl;
    evalFindFibers: typeof evalFindFibersImpl;
    resolveFindFiberSources: typeof resolveFindFiberSourcesImpl;
    warmFindFiberNames: typeof warmFindFiberNamesImpl;
    readComponentName: typeof readComponentName;
    resolveComponentOrigin: typeof resolveComponentOrigin;
    applyRecoveredOrigin: typeof applyRecoveredOrigin;
    applyProductionBreadcrumbs: typeof applyProductionBreadcrumbs;
    safeJson: typeof safeJsonImpl;
    scriptResultJson: typeof scriptResultJson;
    runChippyScript: typeof runChippyScript;
    /** Records a span of Chippy's own work so long frames it caused stay out of page metrics. */
    noteOwnWork: typeof noteOwnWork;
    clearScriptOverlay: typeof clearOverlay;
    measureComponentArea: (options?: Parameters<typeof measureComponentArea>[0]) => ReturnType<typeof measureComponentArea>;
    areaWatch: { start: (options?: Parameters<typeof startAreaWatch>[0]) => ReturnType<typeof startAreaWatch>; read: typeof readAreaWatch; stop: typeof stopAreaWatch };
    resolveOwnerFiber: typeof resolveOwnerFiberImpl;
    getOwnerStackKind: typeof getOwnerStackKindImpl;
    findFiberByName: typeof findFiberByNameImpl;
    inspectFiberOwners: typeof inspectFiberOwnersImpl;
    inspectFiberStructure: typeof inspectFiberStructureImpl;
    evalFiberInvoke: typeof evalFiberInvokeImpl;
    evalFiberPropContract: typeof evalFiberPropContractImpl;
    evalFiberScheduleUpdate: typeof evalFiberScheduleUpdateImpl;
    describeFiberSource: typeof describeFiberSource;
    resolveFiberSource: typeof resolveFiberSource;
    captureFiberState: typeof captureFiberStateImpl;
    compareFiberStates: typeof compareFiberStatesImpl;
    inspectDeclarativeBoundaryChain: typeof inspectDeclarativeBoundaryChainImpl;
    inspectPageDeclarativeBoundaries: typeof inspectPageDeclarativeBoundariesImpl;
  };
};

const api: AvalancheApi = {
  install(options) {
    // The adapter seeds its host surface unless the host already owns it.
    try { getCommitMetricsAdapter()?.prepare?.(); } catch (_) { /* swallow */ }

    if (detector) {
      try { detector.uninstall(); } catch (_) {}
    }
    detector = createAvalancheDetector(options);
    console.log('[avalanche] start', { detectionMode: (options && (options as any).detectionMode) || 'default' });
    detector.install();
    installed = true;
    return { ok: true, detectionLevel: (options && (options as any).detectionMode) || 'default' };
  },
  uninstall() {
    console.log('[avalanche] stop');
    if (detector) detector.uninstall();
    installed = false;
    return { ok: true };
  },
  reset() {
    console.log('[avalanche] reset');
    if (detector) detector.reset();
    return { ok: true };
  },
  pause() {
    if (!detector) return { ok: false, error: 'not installed' };
    detector.pause();
    return { ok: true };
  },
  resume() {
    if (!detector) return { ok: false, error: 'not installed' };
    detector.resume();
    return { ok: true };
  },
  report(topN, sortBy, options) {
    if (!detector) return { ok: false, error: 'not installed' };
    return detector.report(topN, sortBy as any, options as any);
  },
  exportLast(n) {
    if (!detector) return { ok: false, error: 'not installed' };
    const r = detector.report(Number.POSITIVE_INFINITY);
    if (n != null && (r as any).commits && Array.isArray((r as any).commits)) {
      return { ...(r as any), commits: (r as any).commits.slice(-n) };
    }
    return r;
  },
  componentTypesFor(sourceIds: Iterable<string>) {
    return detector ? detector.componentTypesFor(sourceIds) : [];
  },
  unnamedRenderedTypes() {
    return detector ? detector.unnamedRenderedTypes() : [];
  },
  componentTypesNamed(names?: Iterable<string>) {
    return detector ? detector.componentTypesNamed(names) : [];
  },
  debugHook(sourceId, hookIndex, windowSize) {
    if (!detector) return { ok: false, error: 'not installed' };
    const fn = (detector as any).debugHook;
    if (typeof fn !== 'function') return { ok: false, error: 'debugHook unavailable' };
    return fn(sourceId, hookIndex, windowSize);
  },
  _debugRawHookEvents(componentName) {
    if (!detector) return { ok: false, error: 'not installed' };
    const fn = (detector as any)._debugRawHookEvents;
    if (typeof fn !== 'function') return { ok: false, error: '_debugRawHookEvents unavailable' };
    return fn(componentName);
  },
  status() {
    let hasMetricsGlobal = false;
    try { hasMetricsGlobal = !!getCommitMetricsAdapter()?.isAvailable(); } catch (_) {}
    let commitCount = 0;
    let networkRequests = 0;
    let perfEntries = 0;
    let renderedEvidence: RenderedEvidenceStatus | null = null;
    let paused = false;
    let pausedAt: number | null = null;
    try {
      // Counting must not build and walk a full report.
      const counts = detector ? detector.counts() : null;
      if (counts) ({ commits: commitCount, networkRequests, perfEntries, renderedEvidence, capture: { paused, pausedAt } } = counts);
    } catch (_) {}
    const integrationMode = detector
      ? (detector as any).getIntegrationMode?.() ?? 'none'
      : 'none';
    const detectionMode: string | null = installed && detector ? detector.getDetectionLevel() : null;
    const metricsAdapter = detector
      ? (detector as any).getMetricsAdapterId?.() ?? null
      : getCommitMetricsAdapter()?.id ?? null;
    // Pack instructions ride on status so an agent reads them before the data.
    const packs = listPacks().map(({ id, label, instructions, extensions, compileErrors, initErrors }) => ({ id, label, instructions, extensions, compileErrors, initErrors }));
    let hooks: Record<string, AvalancheHookSummary> | null = null;
    try { hooks = summarizeHookResults(detector?.hookResults()); } catch (_) {}
    return { installed, paused, pausedAt, hasMetricsGlobal, commitCount, integrationMode, detectionMode, metricsAdapter, networkRequests, perfEntries, renderedEvidence, packs, hooks };
  },
  registerCommitMetricsAdapter,
  enablePlugins,
  registerPlugin,
  enableDefaultPlugins,
  listPlugins,
  registerPack,
  unregisterPack,
  listPacks,
  runPrePageHooks,
  DETECTION_LEVEL,
  replay: {
    replayComponentHooks,
    evalFiberHooks,
    fiberOnlyHookRecords,
    classifyHook,
    safeSerialize,
    getDispatcherRef,
    isDispatcherIdle,
    customHookPathFromFrames,
    customHookPathFromStack,
    readContextValueFromFiber,
    readHookValueFromNode,
    PRIMITIVE_HOOK_NAMES,
    replayErrorPayload,
    logReplayError,
  },
  layoutLab: {
    getFiberKey,
    getFiber,
    getDisplayName,
    isUserComponent,
    getNearestFiber,
    getNearestComponent,
    getHookSummary,
    getOwnerChain,
    getOwnerFibers,
    getFiberDomNode,
    getReturnComponentChain,
    getReturnComponentFibers,
    describeSource,
    describeFiberSource,
    resolveFiberSource,
    describeFiberTarget,
    describeComponent,
    describeContext,
    registerContextProvider,
    getContextProviders,
    findBoundaryFibers,
    PROBE_INTENTS,
    normalizeProbeAnnotation,
    updateProbeAnnotation,
  },
  bridge: {
    summarizeHookList,
    formatCounts,
    renderTreeText,
    renderCompactComponentText,
    evalDescribeComponent: evalDescribeComponentImpl,
    readAvalancheStatus: readAvalancheStatusImpl,
    evalAvalanche: evalAvalancheImpl,
    evalAvalancheWithNames: evalAvalancheWithNamesImpl as (command: unknown, api: unknown, mod: unknown) => Promise<unknown>,
    evalElementDom: evalElementDomImpl,
    evalFiberProps: evalFiberPropsImpl,
    evalFiberPropValue: evalFiberPropValueImpl,
    evalFindFibers: evalFindFibersImpl,
    resolveFindFiberSources: resolveFindFiberSourcesImpl,
    warmFindFiberNames: warmFindFiberNamesImpl,
    readComponentName,
    resolveComponentOrigin,
    applyRecoveredOrigin,
    applyProductionBreadcrumbs,
    safeJson: safeJsonImpl,
    scriptResultJson,
    runChippyScript,
    noteOwnWork,
    clearScriptOverlay: clearOverlay,
    measureComponentArea: (options) => measureComponentArea(options),
    areaWatch: { start: (options) => startAreaWatch(options), read: readAreaWatch, stop: stopAreaWatch },
    resolveOwnerFiber: resolveOwnerFiberImpl,
    getOwnerStackKind: getOwnerStackKindImpl,
    findFiberByName: findFiberByNameImpl,
    inspectFiberOwners: inspectFiberOwnersImpl,
    inspectFiberStructure: inspectFiberStructureImpl,
    evalFiberInvoke: evalFiberInvokeImpl,
    evalFiberPropContract: evalFiberPropContractImpl,
    evalFiberScheduleUpdate: evalFiberScheduleUpdateImpl,
    describeFiberSource,
    resolveFiberSource,
    captureFiberState: captureFiberStateImpl,
    compareFiberStates: compareFiberStatesImpl,
    inspectDeclarativeBoundaryChain: inspectDeclarativeBoundaryChainImpl,
    inspectPageDeclarativeBoundaries: inspectPageDeclarativeBoundariesImpl,
  },
};

if (__auto) {
  try {
    const requested = startupConfig?.avalanche?.options || {};
    const targetApi = publishedApi && typeof publishedApi.install === 'function' ? publishedApi : api;
    const alreadyInstalled = !!(targetApi.status && targetApi.status().installed);
    if (!alreadyInstalled) {
      targetApi.install({
        detectionMode: requested.detectionMode || 'sources',
        historySize: startupConfig?.avalanche?.max || 1000,
        captureFibers: requested.captureFibers !== false,
      } as any);
    }
  } catch (e) { /* swallow */ }
}

// The IIFE build assigns this export to `__AVALANCHE__`, so a later evaluation
// exports the runtime that is already published instead of replacing it.
export default (publishedApi ?? api) as typeof api;
