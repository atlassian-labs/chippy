/**
 * One-line, bounded summaries of prop values for rendered evidence.
 *
 * A summary is a string an agent can read without a schema:
 *   undefined | null | true | 21 | 10n | Symbol(id)
 *   "text"                      strings keep their quotes, so 21 and "21" differ
 *   "first 64 chars…"(len 200)  long strings are cut
 *   function onClick | function
 *   array(5)[1, "a", object{id}] the first three items, never nested further
 *   object{id,title,"a,b",…+3}  the first five keys; odd keys are quoted
 *   element <Row> | element <div>  React elements, by type
 *
 * Summaries depend only on what they show, so identical ones are shared:
 * callbacks and objects recreated on every render would otherwise build two
 * strings per changed prop per commit.
 */

const MAX_STRING = 64;
const MAX_KEYS = 5;
const MAX_ITEMS = 3;
const MAX_SHARED = 10_000;
const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

export type PropValueSummarizer = (value: unknown) => string;

export function createPropSummarizer(): PropValueSummarizer {
  const byFunctionName = new Map<string, string>();
  const byObjectKeys = new Map<string, string>();
  const byString = new Map<string, string>();
  const byElementType = new Map<string, string>();

  function shared(cache: Map<string, string>, key: string, build: () => string): string {
    let summary = cache.get(key);
    if (summary === undefined) {
      summary = build();
      // Start over rather than stop sharing when values keep changing.
      if (cache.size >= MAX_SHARED) cache.clear();
      cache.set(key, summary);
    }
    return summary;
  }

  function summarize(value: unknown, nested = false): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    const type = typeof value;
    if (type === 'function') {
      const name = (value as Function).name || '';
      return shared(byFunctionName, name, () => (name ? `function ${name}` : 'function'));
    }
    if (type === 'string') {
      const text = value as string;
      if (text.length > MAX_STRING) return `${JSON.stringify(text.slice(0, MAX_STRING)).slice(0, -1)}…"(len ${text.length})`;
      return shared(byString, text, () => JSON.stringify(text));
    }
    // Cheaper to build than to look up.
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'number') return String(value);
    if (type === 'bigint') return `${String(value)}n`;
    if (type === 'symbol') return String(value);
    if (Array.isArray(value)) {
      if (nested || value.length === 0) return `array(${value.length})`;
      const items = value.slice(0, MAX_ITEMS).map((item) => summarize(item, true));
      return `array(${value.length})[${items.join(', ')}]`;
    }
    const element = elementName(value as object);
    if (element !== null) return shared(byElementType, element, () => `element <${element}>`);
    // A non-array object's summary depends only on its keys, read now, so
    // sharing stays correct when the object is mutated later.
    const keys = Object.keys(value as object);
    const shown = keys.length > MAX_KEYS ? keys.slice(0, MAX_KEYS) : keys;
    const shape = keys.length > MAX_KEYS ? `${shown.join('\u0001')}\u0000${keys.length}` : keys.join('\u0001');
    return shared(byObjectKeys, shape, () => {
      const names = shown.map((key) => (PLAIN_KEY.test(key) ? key : JSON.stringify(key)));
      if (keys.length > MAX_KEYS) names.push(`…+${keys.length - MAX_KEYS}`);
      return `object{${names.join(',')}}`;
    });
  }

  return (value) => summarize(value);
}

/** The type name of a React element, or null when the value is not one. */
function elementName(value: object): string | null {
  const candidate = value as { $$typeof?: unknown; type?: unknown };
  if (typeof candidate.$$typeof !== 'symbol' || !('type' in candidate)) return null;
  type Named = { displayName?: unknown; name?: unknown };
  const type = candidate.type as (Named & { render?: Named; type?: Named }) | string | symbol | null;
  if (typeof type === 'string') return type;
  if (typeof type === 'symbol') return String(type).replace(/^Symbol\((?:react\.)?(.*)\)$/, '$1');
  if (type && (typeof type === 'function' || typeof type === 'object')) {
    // forwardRef keeps the component in `render`, memo in `type`.
    const named = type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name;
    if (typeof named === 'string' && named) return named;
  }
  return 'Anonymous';
}
