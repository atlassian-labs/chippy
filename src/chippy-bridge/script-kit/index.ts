/**
 * The `chippy` object handed to eval-page scripts as `ctx.chippy` (and as a
 * bare `chippy` binding). It composes the building blocks behind the normal
 * commands into one toolkit for questions no command answers.
 *
 * Every block reports incomplete or low-confidence answers to the run ledger,
 * which the runner returns as `limits` next to the result. Fibers are exposed
 * only as `FiberRef`s; the raw fiber is reachable through `ref.raw`, and
 * reading it is itself recorded as a limit.
 */

import type { Fiber } from '../../layout-lab/fiber-walk';
import type { FiberHooksResult, ReplayResult } from '../../debug-render/replay';
import type { AreaGeometry } from '../component-area/measure';
import { createRefRegistry, currentOf, type FiberRef, type LiveFiber } from './fiber-ref';
import { createGeometry } from './geometry';
import { createHooks } from './hooks';
import { createLedger, type Ledger, type ScriptGate } from './ledger';
import { clearOverlay, listOverlay, paintOverlay, type OverlayLayer } from './overlay';
import { createRelate } from './relate';
import { createSelect } from './select';

export const SCRIPT_KIT_VERSION = 1;

export interface ScriptKitDeps {
  rememberFiber: (fiber: Fiber) => string | number;
  getRememberedFiber?: (id: string) => Fiber | null;
  getRootFibers: () => Fiber[];
  evalFiberHooks: (fiber: Fiber) => FiberHooksResult;
  replayComponentHooks: (fiber: Fiber) => ReplayResult;
  allowed: readonly ScriptGate[];
  log: unknown[];
  ledger?: Ledger;
  geometry?: AreaGeometry;
}

/** Values kept between runs on this page, e.g. ids found by an earlier script. */
const session: Record<string, unknown> = {};

const HELP: Record<string, string> = {
  select: 'roots() | first(query) | find({ name, file, testId, text, kind, within, visibleOnly, where, max }) | fromElement(el|selector) | byId("fiber:N")',
  relate: 'parents(ref, { until, inclusive, components, max }) | boundaries(ref, { kinds }) | nearest(ref, "suspense"|"error") | components(ref, query) | distance(from, to) | isAncestor(a, b) | owners(ref)',
  measure: 'hostNodes(ref) | rects(ref) | bounds(ref|refs) | area(ref|refs) -> { area, visibleArea, box, nodes, cellSize }',
  hooks: 'hooks(ref) fiber-only | hooks(ref, { replay: true }) names custom hooks (needs --allow replay) | hooks.callers("useQuery", query) (needs --allow replay) | props(ref)',
  overlay: 'overlay.paint({ items, color, label, dashed } | layers[], { id }) | overlay.clear(id?) | overlay.list()',
  run: 'checkpoint(value) keeps a partial result for timeouts | session persists between runs | log(...values) | allowed lists the gates of this run',
  ref: 'FiberRef: id name kind tag key source status hidden raw resolveSource(); serializes as { fiberId, name, kind, source }; refs compare with ===',
};

export function createScriptKit(deps: ScriptKitDeps) {
  const ledger = deps.ledger || createLedger();
  const registry = createRefRegistry({ rememberFiber: deps.rememberFiber, ledger });
  const select = createSelect({ getRootFibers: deps.getRootFibers, registry, ledger });
  const relate = createRelate({ registry, ledger, find: select.find });
  const geometry = createGeometry({ registry, geometry: deps.geometry });
  const hookReads = createHooks({
    registry,
    ledger,
    allowed: deps.allowed,
    find: select.find,
    evalFiberHooks: deps.evalFiberHooks,
    replayComponentHooks: deps.replayComponentHooks,
  });
  let partial: { value: unknown } | null = null;

  function byId(id: string | number): FiberRef | null {
    const key = /^\d+$/.test(String(id)) ? 'fiber:' + id : String(id);
    const fiber = deps.getRememberedFiber?.(key) as LiveFiber | null | undefined;
    if (!fiber) {
      ledger.add('byId', 'gap', `no remembered fiber ${key} on this page session`);
      return null;
    }
    return registry.ref(currentOf(fiber));
  }

  const overlay = {
    paint(layers: OverlayLayer | OverlayLayer[], options: { id?: string } = {}) {
      return paintOverlay(layers, options, { boxOf: geometry.bounds, isAncestor: relate.isAncestor });
    },
    clear: clearOverlay,
    list: listOverlay,
  };

  const chippy = {
    version: SCRIPT_KIT_VERSION,
    allowed: [...deps.allowed],
    ...select,
    byId,
    ...relate,
    ...geometry,
    ...hookReads,
    overlay,
    session,
    isRef: registry.isRef,
    checkpoint(value: unknown) { partial = { value }; return value; },
    log(...values: unknown[]) { deps.log.push(values.length === 1 ? values[0] : values); },
    help(topic?: string) { return topic ? HELP[topic] || `unknown topic; one of ${Object.keys(HELP).join(', ')}` : HELP; },
  };

  return {
    chippy,
    ledger,
    partial: () => partial,
  };
}

export type ScriptKit = ReturnType<typeof createScriptKit>['chippy'];
