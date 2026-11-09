/**
 * evalDescribeComponent
 *
 * Orchestrate a detailed component description with fiber-only fallback.
 * Depends on injected callables for resolution, memory, evaluation, and replay.
 *
 * Extracted from chippy-page-bridge.js line 1354.
 */

import type { Source, TreeGroup } from './inspect-formatters';
import { renderTreeText } from './inspect-formatters';
import { getFiberSource } from './fiber-source';
import { componentDefinitionOf, minifiedComponentName, type ComponentDefinition } from './component-origin';

// ─── Type definitions for injected dependencies ──────────────────────────

export type Fiber = {
  _debugSource?: Source | null;
  _debugStack?: unknown;
  type?: {
    _debugSource?: Source | null;
    displayName?: string | null;
    name?: string | null;
  } | null;
  // Additional fiber properties may exist; we only care about source + type.
  [key: string]: any;
};

export type HookRecord = {
  index: number | null;
  primitive: string;
  path?: Array<{ name: string; loc?: string | null }> | null;
  debugLabel?: string | null;
};

export type ReplayResult = {
  componentName: string;
  records: HookRecord[];
  replayAttempted: boolean;
  replayError: string | null;
  replayErrorDetails: unknown;
  replayStatus: string;
};

export type EvalFiberHooksResult = {
  hookCount: number;
  [key: string]: any;
};

export type DescribeComponentDeps = {
  /**
   * Resolve a fiber by probe, fiberId, or name.
   * Returns { fiber, resolvedBy } or { error }.
   */
  resolveFiberTarget: (probeId: unknown, fiberId: unknown, name: unknown) => { fiber?: Fiber; resolvedBy?: string; error?: string };

  /**
   * Store a fiber in a registry and return its string ID.
   */
  rememberFiber: (fiber: Fiber) => string;

  /**
   * Retrieve a previously stored fiber by ID.
   */
  getRememberedFiber: (id: string | number) => Fiber | null;

  /**
   * Evaluate live hooks for a fiber (from React fiber tree, no replay).
   */
  evalFiberHooks: (fiber: Fiber) => EvalFiberHooksResult;

  /**
   * Replay a component's hooks by executing its function.
   * Returns full hook records with custom-hook ancestry if available.
   */
  replayComponentHooks: (fiber: Fiber) => ReplayResult;

  /**
   * Render a component tree with custom-hook ancestry as ASCII.
   */
  renderTreeText: (componentName: string, source: Source | null | undefined, groups: TreeGroup[]) => string;
};

export type DescribeComponentResult = {
  ok: boolean;
  error?: string;
  componentName?: string;
  /** Runtime name, when a production name was recovered from the source map. */
  minifiedName?: string;
  fiberId?: string;
  resolvedBy?: string;
  source?: { fileName: string | null; lineNumber: number | null } | null;
  /** Authored definition recovered from the bundle's source map (production). */
  definition?: ComponentDefinition;
  hookCount?: number;
  liveHookCount?: number;
  replayedHookCount?: number;
  replayStatus?: string;
  tree?: TreeGroup[];
  text?: string;
  captureEngineOk?: boolean;
  warnings?: string[];
  replayError?: string;
  replayErrorDetails?: unknown;
};

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Describe a component's hook structure in full detail.
 *
 * Accepts a fiberIdRaw and/or nameRaw; resolves via deps.resolveFiberTarget.
 * Groups hook records by custom-hook ancestry path, renders as ASCII tree,
 * and returns full metadata including replay status and warnings.
 */
export function evalDescribeComponent(
  fiberIdRaw: unknown,
  nameRaw: unknown,
  deps: DescribeComponentDeps,
): DescribeComponentResult {
  const target = deps.resolveFiberTarget(null, fiberIdRaw, nameRaw);
  if (target.error) return { ok: false, error: target.error };

  const { fiber, resolvedBy } = target as { fiber: Fiber; resolvedBy: string };

  const fiberId = fiberIdRaw && deps.getRememberedFiber(String(fiberIdRaw)) ? String(fiberIdRaw) : deps.rememberFiber(fiber);
  const liveHooks = deps.evalFiberHooks(fiber);
  const liveHookCount = liveHooks.hookCount;
  const { componentName, records, replayAttempted, replayError, replayErrorDetails, replayStatus } =
    deps.replayComponentHooks(fiber);
  const source = getFiberSource(fiber);
  const replayedHookCount = records.filter((r) => r.index != null).length;
  const hookCount = liveHookCount;

  const captureEngineOk = replayAttempted && records.length > 0;
  const warnings: string[] = [];
  if (!replayAttempted)
    warnings.push('fiber-only: component functions and hooks were not executed; custom-hook ancestry is unavailable unless captured metadata exists');
  if (replayError) warnings.push('replay-error: ' + replayError);
  const anyAncestry = records.some((r) => r.path && r.path.length > 0);
  if (!anyAncestry && hookCount > 0)
    warnings.push('flat-records: no custom-hook ancestry; reload page with devtools-hook-shim injected before react-dom');

  // Preserve replay record order. renderTreeText owns the tree/folder grouping;
  // pre-grouping by path here loses interleaving and can move late parent-level
  // hooks before child folders that executed earlier.
  const tree: TreeGroup[] = records.map((r) => ({
    path: (r.path as unknown[] as any) || [],
    hooks: [{ hookId: r.index, primitive: r.primitive, debugLabel: r.debugLabel }],
  }));
  const definition = componentDefinitionOf(fiber.type);
  const minifiedName = minifiedComponentName(fiber.type);
  const text = deps.renderTreeText(componentName, (source ?? definition) as Source | null, tree);

  return {
    ok: true,
    componentName,
    ...(minifiedName ? { minifiedName } : {}),
    fiberId,
    resolvedBy,
    source: source ? { fileName: (source as any)?.fileName || null, lineNumber: (source as any)?.lineNumber || null } : null,
    ...(definition ? { definition } : {}),
    hookCount,
    liveHookCount,
    replayedHookCount,
    replayStatus: replayStatus || 'not-run-fiber-only',
    tree,
    text,
    captureEngineOk,
    warnings,
    replayError: replayError || undefined,
    replayErrorDetails: replayErrorDetails || undefined,
  };
}
