/**
 * Bounded, JSON-safe copies of live hook values for reports.
 *
 * Changed-hook samples (`trashers`) hold whatever a hook stored: refs to DOM
 * nodes, fibers, stores, React elements. Those values can be circular or huge,
 * and one of them makes `JSON.stringify` of the whole report throw. A report
 * DTO therefore carries this bounded copy instead of the live value.
 *
 * Primitives keep their value (long strings are cut). Objects and arrays keep
 * a few levels and entries; deeper or repeated structure becomes a short
 * `[...]` marker string. The result always survives `JSON.stringify`.
 */

const MAX_DEPTH = 2;
const MAX_ENTRIES = 8;
const MAX_STRING = 200;

function cut(text: string): string {
  return text.length > MAX_STRING ? text.slice(0, MAX_STRING) + `…(${text.length})` : text;
}

function constructorName(value: object): string {
  try {
    const proto = Object.getPrototypeOf(value);
    const name = proto && proto.constructor && proto.constructor.name;
    return typeof name === 'string' && name ? name : 'Object';
  } catch {
    return 'Object';
  }
}

function elementTypeName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return (type as { displayName?: string }).displayName || type.name || 'Anonymous';
  if (type && typeof type === 'object') {
    const t = type as { displayName?: string; render?: { name?: string }; type?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render && t.render.name) return t.render.name;
    if (t.type) return elementTypeName(t.type);
  }
  return 'Unknown';
}

/** A one-line marker for values that are never copied structurally. */
function opaqueMarker(value: object): string | null {
  const node = value as { nodeType?: unknown; nodeName?: unknown };
  if (typeof node.nodeType === 'number' && typeof node.nodeName === 'string') {
    return `[${constructorName(value)} ${String(node.nodeName).toLowerCase()}]`;
  }
  const element = value as { $$typeof?: unknown; type?: unknown };
  if (typeof element.$$typeof === 'symbol') {
    return `[ReactElement ${elementTypeName(element.type)}]`;
  }
  const fiber = value as { tag?: unknown; stateNode?: unknown; return?: unknown; memoizedProps?: unknown };
  if (typeof fiber.tag === 'number' && 'stateNode' in fiber && 'return' in fiber && 'memoizedProps' in fiber) {
    return '[Fiber]';
  }
  if (typeof (value as { then?: unknown }).then === 'function') return '[Promise]';
  if (value instanceof Map) return `[Map(${value.size})]`;
  if (value instanceof Set) return `[Set(${value.size})]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Date invalid]' : value.toISOString();
  if (value instanceof RegExp) return cut(String(value));
  if (value instanceof Error) return cut(`[${value.name}: ${value.message}]`);
  if (ArrayBuffer.isView(value)) return `[${constructorName(value)}]`;
  return null;
}

function copy(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'undefined':
      return undefined;
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'string':
      return cut(value);
    case 'bigint':
      return `${String(value)}n`;
    case 'symbol':
      return cut(String(value));
    case 'function':
      return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  let marker: string | null;
  try {
    marker = opaqueMarker(object);
  } catch {
    return `[${constructorName(object)}]`;
  }
  if (marker !== null) return marker;
  if (Array.isArray(object)) {
    if (depth >= MAX_DEPTH) return `[Array(${object.length})]`;
    seen.add(object);
    const items = object.slice(0, MAX_ENTRIES).map((item) => {
      const next = copy(item, depth + 1, seen);
      return next === undefined ? null : next;
    });
    if (object.length > MAX_ENTRIES) items.push(`…(${object.length - MAX_ENTRIES} more)`);
    seen.delete(object);
    return items;
  }
  let keys: string[];
  try {
    keys = Object.keys(object);
  } catch {
    return `[${constructorName(object)}]`;
  }
  const name = constructorName(object);
  if (depth >= MAX_DEPTH) return `[${name}(${keys.length} keys)]`;
  seen.add(object);
  const out: Record<string, unknown> = {};
  for (const key of keys.slice(0, MAX_ENTRIES)) {
    let item: unknown;
    try {
      item = (object as Record<string, unknown>)[key];
    } catch {
      item = '[Unreadable]';
    }
    out[key] = copy(item, depth + 1, seen);
  }
  if (keys.length > MAX_ENTRIES) out['…'] = `${keys.length - MAX_ENTRIES} more keys`;
  seen.delete(object);
  return out;
}

/** A bounded copy of `value` that `JSON.stringify` always accepts. */
export function toWireValue(value: unknown): unknown {
  return copy(value, 0, new WeakSet());
}
