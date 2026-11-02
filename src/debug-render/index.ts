/**
 * Debug-render's singleton page API plus replay utilities. A single created
 * capture engine matters because dispatcher patching is process-wide within a
 * page; separate callers must share its installed/restored state.
 */

import { createDebugRender } from './core';

type DebugRenderApi = ReturnType<typeof createDebugRender>;

const api: DebugRenderApi = createDebugRender();

export default api;

export { replayComponentHooks, fiberOnlyHookRecords, evalFiberHooks, classifyHook, safeSerialize } from './replay';
export type { Fiber, HookNode, HookRecord, ClassifiedHook, FiberHooksResult, ReplayResult, ErrorPayload } from './replay';
