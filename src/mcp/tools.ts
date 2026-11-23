import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HelperConnection } from './helper';

const id = z.string().min(1);
const index = z.number().int().nonnegative();
const positive = z.number().int().positive();
const timeout = positive.max(60000).default(5000);
const pagePath = (clientId: string) => `/api/pages/${encodeURIComponent(clientId)}`;

export function registerChippyTools(server: McpServer, helper: HelperConnection) {
  function tool(name: string, description: string, schema: z.ZodRawShape,
    run: (args: any, signal: AbortSignal) => Promise<any>, readOnly = false) {
    server.registerTool(name, {
      description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    }, async (args, extra) => {
      try {
        const value = await run(args, extra.signal);
        const failed = value?.ok === false || value?.result?.ok === false;
        return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value, isError: failed };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: String(error instanceof Error ? error.message : error) }], isError: true };
      }
    });
  }

  tool('chippy_status', 'Start or reuse the local helper. Distinguish helper readiness from browser connection. No connected page is a normal setup state.', {}, async (_, signal) => {
    const pages = await helper.request('/api/pages', undefined, signal);
    return { ok: pages.ok, ...helper.status(), browserConnected: pages.count > 0, pages: pages.pages, hint: pages.hint ?? null };
  }, true);
  tool('chippy_pages', 'List connected pages. Resolve a fresh clientId by URL/title before inspection; never guess a page.', {},
    (_, signal) => helper.request('/api/pages', undefined, signal), true);
  tool('chippy_snapshot', 'Read the stored snapshot, or request a fresh page snapshot. Refresh is asynchronous; read again after the page responds.', {
    clientId: id, refresh: z.boolean().default(false),
  }, ({ clientId, refresh }, signal) => helper.request(`${pagePath(clientId)}/snapshot`, refresh ? {} : undefined, signal));
  tool('chippy_probe', 'Inspect a placed probe. Hook replay can execute component and hook bodies: disclose target and use props/parents when unsafe. Preserve probes while they anchor an investigation.', {
    clientId: id, probeId: id,
    view: z.enum(['dom', 'parents', 'boundaries', 'owners', 'props', 'prop-value', 'hooks', 'hooks-summary']),
    ownerIndex: index.optional(), prop: id.optional(), parentLevel: index.optional(), max: positive.optional(), timeoutMs: timeout,
  }, ({ clientId, probeId, view, timeoutMs, ...fields }, signal) => {
    if (view === 'owners') return helper.request(`${pagePath(clientId)}/probe/${encodeURIComponent(probeId)}/owners?timeoutMs=${timeoutMs}`, undefined, signal, timeoutMs + 2000);
    if (view === 'prop-value' && !fields.prop) throw new Error('prop is required for prop-value');
    const command = view === 'prop-value' ? 'eval-prop-value' : `eval-probe-${view}`;
    return helper.request(`${pagePath(clientId)}/eval-probe`, { command, probeId, timeoutMs, ...fields }, signal, timeoutMs + 2000);
  });
  tool('chippy_find_fibers', 'Find components without manually placed probes. grep searches prop keys/values, hook state, and, when `in` includes debug, useDebugValue labels (replays only components that call useDebugValue). Refresh fiber ids after commits, HMR, or navigation.', {
    clientId: id, filters: z.object({
      name: id.optional(), file: id.optional(), prop: id.optional(), testid: id.optional(), text: id.optional(),
      grep: id.optional(), in: id.optional(), depth: positive.max(12).optional(), max: positive.optional(),
    }).strict(), timeoutMs: timeout,
  }, ({ clientId, ...args }, signal) => helper.request(`${pagePath(clientId)}/eval-probe`, { command: 'find-fibers', ...args }, signal, args.timeoutMs + 2000), true);
  tool('chippy_inspect_fiber', 'Read a current fiber. structure and describe/explain may replay component bodies; disclose target and execution before using them. props/parents/boundaries avoid replay.', {
    clientId: id, fiberId: id,
    view: z.enum(['props', 'owners', 'parents', 'boundaries', 'hooks', 'hooks-summary', 'structure', 'describe', 'explain']),
    hookIndex: index.optional(), windowSize: positive.optional(), max: positive.optional(), timeoutMs: timeout,
  }, ({ clientId, view, ...args }, signal) => {
    if (view === 'structure' && args.hookIndex === undefined) throw new Error('hookIndex is required for structure');
    const command = view === 'describe' ? 'describe-component' : view === 'explain' ? 'explain-component' : `inspect-fiber-${view}`;
    return helper.request(`${pagePath(clientId)}/eval-probe`, { command, ...args }, signal, args.timeoutMs + 2000);
  });
  tool('chippy_avalanche', 'Capture and inspect React commits. install starts capture; clear resets evidence; uninstall stops capture. summary is the first read of a capture in one call: commit count and stat totals, the interaction timeline without lanes, the top commits by collateral (top, default 5) with timing, their sources (maxItems per commit, default 3) and whether each changed hook kept equal content, the latest input, and each pack hook\'s result. Hot components alone do not prove the cause. debug-hook requires a captured sourceId and hookIndex. network lists captured requests (Resource Timing) with the commits they landed before or started after; `window` bounds those links in ms. timeline puts input, requests, Suspense fallbacks, and commits on one clock from the interaction and returns a perceived-wait summary plus a Mermaid gantt; fromCommit/toCommit bound it, minRequestMs and exclude filter requests, each wait is labelled by the first parent or owner that sets its boundary apart, and `boundaries` lists five parents and five owners with identifying props; `screen` gives VC50/VC90/VC100 (Visually Complete) from the screen area each commit changed; format map adds settleMapSvg, full adds lanes and settleMapSvg. Links are timing, not cause. perf lists the browser performance entries recorded with the capture (User Timing marks and measures, long animation frames with their longest scripts, layout shifts and events with the component of the node, LCP, paint, navigation), each with the commits that started inside it (`during`) and the last commit before it; a long animation frame with several commits under `during` ran them in one frame without a paint between them; types filters entry types, match is a regex over entry names, top caps entries per type, fromCommit/toCommit bound it; commit-peek include `perf` returns the entries near one commit. dom-diff lists what each commit changed in the DOM, read from committed fibers: + inserted, - removed, ~ updated props with before → after, move, show/hide; each commit is one change set with no order inside it, order is between commits; fromCommit/toCommit bound it, match is a regex over the changes, maxItems caps changes per commit, top caps commits; commit-peek include `dom` returns the changes of one commit. Loaded packs: status lists their instructions and a `hooks` summary per extension; commit-peek include `hooks` (default) returns each extension\'s result for that commit.', {
    clientId: id,
    action: z.enum(['status', 'install', 'uninstall', 'clear', 'export', 'hot-sources', 'commit-list', 'commit-peek', 'debug-hook', 'describe-action', 'export-last', 'network', 'perf', 'timeline', 'dom-diff', 'summary']),
    options: z.object({ detectionMode: z.enum(['stats', 'sources', 'amplifiers', 'full']).optional(), historySize: positive.optional(), captureFibers: z.boolean().optional() }).strict().optional(),
    limit: positive.optional(), count: positive.optional(), top: positive.optional(), by: id.optional(), commitId: index.optional(),
    include: z.array(id).optional(), depth: index.optional(), maxItems: positive.optional(),
    sourceId: id.optional(), hookIndex: index.optional(), window: index.optional(), actionId: index.optional(),
    match: id.optional(), initiators: z.array(id).optional(), types: z.array(id).optional(),
    fromCommit: index.optional(), toCommit: index.optional(), minRequestMs: index.optional(), exclude: id.optional(), format: z.enum(['summary', 'map', 'full']).optional(),
    timeoutMs: timeout,
  }, ({ clientId, ...args }, signal) => helper.request(`${pagePath(clientId)}/avalanche`, args, signal, args.timeoutMs + 2000));
  tool('chippy_interact', 'Apply one explicit stimulus. Name the exact target and stimulus first. invoke requires source inspection and a proven callback contract; schedule-update runs render/effect code without changing props/hooks.', {
    clientId: id, action: z.enum(['click', 'prop-contract', 'invoke', 'schedule-update']), target: id,
    targetKind: z.enum(['selector', 'probeId', 'fiberId']).default('selector'),
    propName: id.optional(), args: z.array(z.unknown()).optional().describe('invoke arguments; an entry {"$event":"click"} passes a synthetic event targeting the fiber\'s element'), ownerIndex: index.optional(), timeoutMs: timeout,
  }, ({ clientId, action, target, targetKind, propName, args, ownerIndex, timeoutMs }, signal) => {
    if (['prop-contract', 'invoke'].includes(action) && !propName) throw new Error('propName is required for this action');
    const route = { click: 'page-click', 'prop-contract': 'fiber-prop-contract', invoke: 'fiber-invoke', 'schedule-update': 'fiber-schedule-update' }[action];
    const body = action === 'click' ? { [targetKind]: target, timeoutMs } : { fiberId: target, propName, args, ownerIndex, timeoutMs };
    return helper.request(`${pagePath(clientId)}/${route}`, body, signal, timeoutMs + 2000);
  });
  tool('chippy_wait_annotation', 'Wait for the next UI annotation after a cursor. Pass the previous result\'s cursor as `after` so no annotation is missed between waits. Repeat only while the user-requested wait loop remains active, and stop after two consecutive empty timeouts. A timeout is a normal empty result; cancellation closes the helper long poll.', {
    clientId: id, timeoutMs: positive.max(60000).default(30000), after: z.number().int().min(0).optional(),
  }, ({ clientId, timeoutMs, after }, signal) => helper.request(
    `${pagePath(clientId)}/probe-annotations/wait?timeoutMs=${timeoutMs}${after === undefined ? '' : `&after=${after}`}`,
    undefined, signal, timeoutMs + 2000,
  ), true);
  tool('chippy_ack_annotation', 'Mark an annotation event handled after you finish it. The page clears that probe\'s intent and comment unless the user changed them since.', {
    clientId: id, sequence: z.number().int().min(1),
  }, ({ clientId, sequence }, signal) => helper.request(`${pagePath(clientId)}/probe-annotations/ack`, { sequence }, signal));
}
