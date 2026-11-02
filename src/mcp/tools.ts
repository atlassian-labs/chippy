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
  tool('chippy_find_fibers', 'Find components without manually placed probes. Refresh fiber ids after commits, HMR, or navigation.', {
    clientId: id, filters: z.object({ name: id.optional(), file: id.optional(), prop: id.optional(), testid: id.optional(), text: id.optional(), max: positive.optional() }).strict(), timeoutMs: timeout,
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
  tool('chippy_avalanche', 'Capture and inspect React commits. install starts capture; clear resets evidence; uninstall stops capture. Hot components alone do not prove the cause. debug-hook requires a captured sourceId and hookIndex.', {
    clientId: id,
    action: z.enum(['status', 'install', 'uninstall', 'clear', 'export', 'hot-sources', 'commit-list', 'commit-peek', 'debug-hook', 'describe-action', 'export-last']),
    options: z.object({ detectionMode: z.enum(['stats', 'sources', 'amplifiers', 'full']).optional(), historySize: positive.optional(), captureFibers: z.boolean().optional() }).strict().optional(),
    limit: positive.optional(), count: positive.optional(), top: positive.optional(), by: id.optional(), commitId: index.optional(),
    include: z.array(id).optional(), depth: index.optional(), maxItems: positive.optional(),
    sourceId: id.optional(), hookIndex: index.optional(), window: index.optional(), actionId: index.optional(), timeoutMs: timeout,
  }, ({ clientId, ...args }, signal) => helper.request(`${pagePath(clientId)}/avalanche`, args, signal, args.timeoutMs + 2000));
  tool('chippy_interact', 'Apply one explicit stimulus. Name the exact target and stimulus first. invoke requires source inspection and a proven callback contract; schedule-update runs render/effect code without changing props/hooks.', {
    clientId: id, action: z.enum(['click', 'prop-contract', 'invoke', 'schedule-update']), target: id,
    targetKind: z.enum(['selector', 'probeId', 'fiberId']).default('selector'),
    propName: id.optional(), args: z.array(z.unknown()).optional(), ownerIndex: index.optional(), timeoutMs: timeout,
  }, ({ clientId, action, target, targetKind, propName, args, ownerIndex, timeoutMs }, signal) => {
    if (['prop-contract', 'invoke'].includes(action) && !propName) throw new Error('propName is required for this action');
    const route = { click: 'page-click', 'prop-contract': 'fiber-prop-contract', invoke: 'fiber-invoke', 'schedule-update': 'fiber-schedule-update' }[action];
    const body = action === 'click' ? { [targetKind]: target, timeoutMs } : { fiberId: target, propName, args, ownerIndex, timeoutMs };
    return helper.request(`${pagePath(clientId)}/${route}`, body, signal, timeoutMs + 2000);
  });
  tool('chippy_wait_annotation', 'Wait once for the next UI annotation. Repeat only while the user-requested wait loop remains active. A timeout is a normal empty result; cancellation closes the helper long poll.', {
    clientId: id, timeoutMs: positive.max(60000).default(30000),
  }, ({ clientId, timeoutMs }, signal) => helper.request(`${pagePath(clientId)}/probe-annotations/wait?timeoutMs=${timeoutMs}`, undefined, signal, timeoutMs + 2000), true);
}
