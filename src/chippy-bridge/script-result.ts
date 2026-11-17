// Serializes eval-script (snippet) results for the WebSocket transport.
//
// Snippets return plain report data that is often nested several levels deep
// (for example entries → type → items → scripts → frame). A fixed shallow
// depth turns that data into "[Object]" placeholders, so this serializer
// allows deeper nesting and bounds the total size with a node budget instead.
// Cycles, functions, and DOM/fiber graphs still terminate.

export const SCRIPT_RESULT_DEPTH = 16;
export const SCRIPT_RESULT_MAX_NODES = 50000;
const MAX_ITEMS = 500;

export interface ScriptResultOptions {
  depth?: number;
  maxNodes?: number;
}

export function scriptResultJson(value: unknown, options: ScriptResultOptions = {}): unknown {
  const budget = { left: options.maxNodes ?? SCRIPT_RESULT_MAX_NODES, exhausted: false };
  const seen = new WeakSet<object>();

  function walk(input: unknown, depth: number): unknown {
    if (input == null) return input;
    const t = typeof input;
    if (t === 'string' || t === 'boolean') return input;
    if (t === 'number') return Number.isFinite(input) ? input : String(input);
    if (t === 'function') return '[Function ' + ((input as { name?: string }).name || 'anonymous') + ']';
    if (t !== 'object') return String(input);
    if (depth <= 0) return Array.isArray(input) ? '[Array]' : '[Object]';
    if (budget.left <= 0) { budget.exhausted = true; return '[Truncated]'; }
    budget.left--;
    const obj = input as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
    try {
      if (typeof (obj as { toJSON?: unknown }).toJSON === 'function' && !(obj instanceof Date)) {
        return walk((obj as { toJSON: () => unknown }).toJSON(), depth);
      }
      if (obj instanceof Date) return obj.toISOString();
      if (typeof Node !== 'undefined' && obj instanceof Node) return '[' + (obj.nodeName || 'Node') + ']';
      if (Array.isArray(obj)) {
        const out = obj.slice(0, MAX_ITEMS).map((v) => walk(v, depth - 1));
        if (obj.length > MAX_ITEMS) out.push('[+' + (obj.length - MAX_ITEMS) + ' more]');
        return out;
      }
      if (obj instanceof Map) return walk(Object.fromEntries(Array.from(obj.entries()).slice(0, MAX_ITEMS).map(([k, v]) => [String(k), v])), depth);
      if (obj instanceof Set) return walk(Array.from(obj), depth);
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const k of Object.keys(obj)) {
        if (n++ >= MAX_ITEMS) { out._truncated = true; break; }
        try { out[k] = walk((obj as Record<string, unknown>)[k], depth - 1); } catch (_) { out[k] = '[Unserializable]'; }
      }
      return out;
    } finally {
      // Shared references that are not cycles serialize in each place.
      seen.delete(obj);
    }
  }

  const result = walk(value, options.depth ?? SCRIPT_RESULT_DEPTH);
  if (budget.exhausted && result && typeof result === 'object' && !Array.isArray(result)) {
    (result as Record<string, unknown>)._truncated = true;
  }
  return result;
}
