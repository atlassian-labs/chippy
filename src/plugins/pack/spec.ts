/**
 * Chippy pack: a JSON document that teaches Chippy one application without a
 * rebuild. The extension stores packs and hands them to the page at startup;
 * a page or agent can also register one at runtime.
 *
 * ```json
 * {
 *   "id": "feature-gates",
 *   "label": "Feature gates",
 *   "instructions": "How an agent reads this pack's boundaries and hooks output.",
 *   "components": [
 *     { "kind": "gate", "label": "gate", "match": { "names": ["FeatureGate"] },
 *       "title": ["props.flag", "name"], "fields": [{ "label": "flag", "value": "props.flag" }] }
 *   ],
 *   "avalancheExtensions": {
 *     "flags": {
 *       "instructions": "`steps[commitId].reads` counts flag reads in that commit.",
 *       "onInit": "window.__FLAGS_READ = window.__FLAGS_READ || 0;",
 *       "onStart": "ctx.state.base = window.__FLAGS_READ;",
 *       "onStep": "var n = window.__FLAGS_READ; var d = n - ctx.state.base; ctx.state.base = n; return { reads: d };"
 *     }
 *   }
 * }
 * ```
 *
 * Value references read a matched fiber: `name` (display name),
 * `props.<key>`, or `parts.<key>` (a named piece of a split display name).
 * A list tries each reference in order and keeps the first non-empty value.
 */

export type PackValueRef = string | string[];

export type PackComponentRule = {
  /** Boundary kind. `error` enriches the core error boundary; any other kind is a new boundary kind. */
  kind: string;
  /** Lozenge label for a new kind; defaults to the kind. */
  label?: string;
  accent?: string;
  /** A fiber matches when its display name is in `names` or matches `pattern`. */
  match: { names?: string[]; pattern?: string };
  /** Split the display name, e.g. `Mark___type___name`, into `parts.<key>`. */
  nameParts?: { separator: string; keys: string[] };
  /** Card title for the kind. */
  title?: PackValueRef;
  /** Card fields for the kind; empty values are omitted. */
  fields?: Array<{ label: string; value: PackValueRef }>;
  /** Extra values on the boundary payload (or the error enrichment). */
  data?: Record<string, PackValueRef>;
  /** Show the error row even when the core found no error boundary. */
  showError?: boolean;
};

/**
 * One named Avalanche extension: optional instructions plus script bodies.
 * A pack may carry several; each keeps its own state, errors, and results,
 * reported under `hooks["<pack id>.<extension name>"]`.
 */
export type PackScripts = {
  /** Markdown for agents on this extension's results; defaults to the pack's instructions. */
  instructions?: string;
  /**
   * Runs once when the pack registers, with `ctx = { id }`. A pack loaded at
   * startup registers before the page's scripts, so this is where a pack
   * creates host globals the page must find while it loads (for example a
   * metrics slot an instrumented renderer writes to). Keep it idempotent: the
   * bundle can evaluate twice on one page.
   */
  onInit?: string;
  /** Recording phases; each receives `ctx` (see AvalancheHookContext). */
  onStart?: string;
  onStep?: string;
  onEnd?: string;
};

export type ChippyPack = {
  id: string;
  label?: string;
  /** Markdown for agents: what this pack's data means and how to read it. */
  instructions?: string;
  components?: PackComponentRule[];
  /** Named Avalanche extensions, for example `{ "atl": { "onInit": "...", "onStep": "..." } }`. */
  avalancheExtensions?: Record<string, PackScripts>;
};

const ID = /^[a-z][a-z0-9-]*$/;
const TOP_KEYS = new Set(['id', 'label', 'instructions', 'components', 'avalancheExtensions']);
const RULE_KEYS = new Set(['kind', 'label', 'accent', 'match', 'nameParts', 'title', 'fields', 'data', 'showError']);
const SCRIPT_KEYS = new Set(['onInit', 'onStart', 'onStep', 'onEnd']);
const EXTENSION_KEYS = new Set(['instructions', ...SCRIPT_KEYS]);
const REF = /^(name|props\.[^.\s]+|parts\.[^.\s]+)$/;

function fail(path: string, message: string): never {
  throw new TypeError(`chippy pack ${path}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(path, `unknown key "${key}"`);
}

function checkString(value: unknown, path: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !value) fail(path, 'must be a non-empty string');
}

function checkRef(value: unknown, path: string): void {
  const refs = Array.isArray(value) ? value : [value];
  if (refs.length === 0) fail(path, 'must name at least one reference');
  for (const ref of refs) {
    if (typeof ref !== 'string' || !REF.test(ref)) fail(path, `"${String(ref)}" is not name, props.<key>, or parts.<key>`);
  }
}

function checkRule(rule: unknown, path: string): void {
  if (!isObject(rule)) fail(path, 'must be an object');
  checkKeys(rule, RULE_KEYS, path);
  checkString(rule.kind, `${path}.kind`);
  if (rule.kind === 'suspense') fail(`${path}.kind`, 'suspense is a core kind');
  checkString(rule.label, `${path}.label`, true);
  checkString(rule.accent, `${path}.accent`, true);
  if (!isObject(rule.match)) fail(`${path}.match`, 'must be an object');
  checkKeys(rule.match, new Set(['names', 'pattern']), `${path}.match`);
  const { names, pattern } = rule.match;
  if (names === undefined && pattern === undefined) fail(`${path}.match`, 'needs names or pattern');
  if (names !== undefined && (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || !name))) {
    fail(`${path}.match.names`, 'must be a list of names');
  }
  if (pattern !== undefined) {
    checkString(pattern, `${path}.match.pattern`);
    try {
      new RegExp(pattern as string);
    } catch (error) {
      fail(`${path}.match.pattern`, (error as Error).message);
    }
  }
  if (rule.nameParts !== undefined) {
    const parts = rule.nameParts;
    if (!isObject(parts)) fail(`${path}.nameParts`, 'must be an object');
    checkString(parts.separator, `${path}.nameParts.separator`);
    if (!Array.isArray(parts.keys) || parts.keys.some((key) => typeof key !== 'string')) {
      fail(`${path}.nameParts.keys`, 'must be a list of keys');
    }
  }
  if (rule.title !== undefined) checkRef(rule.title, `${path}.title`);
  if (rule.fields !== undefined) {
    if (!Array.isArray(rule.fields)) fail(`${path}.fields`, 'must be a list');
    rule.fields.forEach((field, index) => {
      if (!isObject(field)) fail(`${path}.fields[${index}]`, 'must be an object');
      checkString(field.label, `${path}.fields[${index}].label`);
      checkRef(field.value, `${path}.fields[${index}].value`);
    });
  }
  if (rule.data !== undefined) {
    if (!isObject(rule.data)) fail(`${path}.data`, 'must be an object');
    for (const [key, ref] of Object.entries(rule.data)) checkRef(ref, `${path}.data.${key}`);
  }
  if (rule.showError !== undefined && typeof rule.showError !== 'boolean') fail(`${path}.showError`, 'must be a boolean');
}

/** Validate a pack (object or JSON text). Throws a TypeError naming the bad path. */
export function parsePack(input: unknown): ChippyPack {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      fail('', `is not valid JSON (${(error as Error).message})`);
    }
  }
  if (!isObject(value)) fail('', 'must be an object');
  checkKeys(value, TOP_KEYS, '');
  if (typeof value.id !== 'string' || !ID.test(value.id)) fail('id', 'must match /^[a-z][a-z0-9-]*$/');
  checkString(value.label, 'label', true);
  checkString(value.instructions, 'instructions', true);
  if (value.components !== undefined) {
    if (!Array.isArray(value.components)) fail('components', 'must be a list');
    value.components.forEach((rule, index) => checkRule(rule, `components[${index}]`));
  }
  if (value.avalancheExtensions !== undefined) {
    const extensions = value.avalancheExtensions;
    if (!isObject(extensions)) fail('avalancheExtensions', 'must be an object of named extensions');
    for (const [name, extension] of Object.entries(extensions)) {
      const path = `avalancheExtensions.${name}`;
      if (!ID.test(name)) fail(path, 'name must match /^[a-z][a-z0-9-]*$/');
      if (!isObject(extension)) fail(path, 'must be an object');
      checkKeys(extension, EXTENSION_KEYS, path);
      for (const key of EXTENSION_KEYS) checkString(extension[key], `${path}.${key}`, true);
    }
  }
  return value as ChippyPack;
}
