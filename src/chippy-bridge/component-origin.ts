/**
 * Recover a component's authored name and definition from the bundle that
 * defines it.
 *
 * Production builds minify component names and drop React's development source
 * metadata. The component function still exists, and its text is an exact
 * slice of the script that defined it. This module finds that slice in the
 * scripts the page loaded, maps its position through the script's source map,
 * and reads the authored name from the map's `names` table or its
 * `sourcesContent`.
 *
 * Results are cached per component function. Synchronous readers use
 * `recoveredComponentName` and `componentDefinitionOf`; they return null until
 * `resolveComponentOrigin` has finished for that type.
 */

import { mappingAt, type GeneratedMapping } from './source-map';
import {
  createModuleMapCache,
  fetchModuleFromPage,
  sourcePath,
  type ModuleMapCache,
  type ModuleMaps,
} from './module-maps';

export type ComponentDefinition = {
  fileName: string;
  lineNumber: number;
  columnNumber: number | null;
};

/**
 * How the name was recovered:
 * - `map-name`: the source map's `names` entry for the function's own identifier.
 * - `source-text`: the function's own name in the authored source.
 * - `binding-map-name`: the `names` entry for the variable or property that holds it.
 * - `binding-source-text`: that binding in the authored source.
 */
export type NameEvidence = 'map-name' | 'source-text' | 'binding-map-name' | 'binding-source-text';

export type OriginStatus =
  /** The definition was mapped to authored source. */
  | 'resolved'
  /** The function text was found, but the script has no usable source map. */
  | 'no-source-map'
  /** The source map has no segment for the function's position. */
  | 'unmapped'
  /** The function text occurs more than once in the script that holds it. */
  | 'ambiguous'
  /** No loaded script contains the function text. */
  | 'not-found'
  /** The type is not a function component, class, memo, or forwardRef. */
  | 'unsupported';

export type ComponentOrigin = {
  status: OriginStatus;
  /** Authored name, or null when no evidence names the component. */
  name: string | null;
  nameEvidence: NameEvidence | null;
  /** The runtime (minified) function name, or null when anonymous. */
  generatedName: string | null;
  /** Authored definition, or null unless `status` is `resolved`. */
  definition: ComponentDefinition | null;
  /** Script URL that defines the function, or null when it was not found. */
  script: string | null;
  /** Generated 1-based position of the function in `script`. */
  generated: { line: number; column: number } | null;
};

export type ScriptRef = {
  /** Script URL, or a stable key such as `inline:0` for inline scripts. */
  key: string;
  /** Base URL for resolving the script's `sourceMappingURL`. */
  url: string;
  /** Script text the page already holds; fetched from `url` when absent. */
  text: string | null;
};

export type ComponentOriginResolver = {
  resolve(type: unknown): Promise<ComponentOrigin>;
  /** Cached result for `type`, or null when it has not been resolved. */
  peek(type: unknown): ComponentOrigin | null;
  readonly stats: { functions: number; scripts: number; resolved: number };
};

export type ComponentOriginDeps = {
  listScripts: () => readonly ScriptRef[];
  modules?: ModuleMapCache;
};

type Fn = (...args: never[]) => unknown;

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const OWN_FUNCTION_NAME = new RegExp(`^(?:async\\s*)?function\\s*\\*?\\s*(${IDENTIFIER})\\s*\\(`);
const OWN_CLASS_NAME = new RegExp(`^class\\s+(${IDENTIFIER})(?=[\\s{])`);
const AUTHORED_OWN_NAME = new RegExp(
  `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)(${IDENTIFIER})`,
);
// `name = ` or `name: ` followed by any wrapping calls, e.g. `x=(0,r.memo)(`.
const CALLEE = `(?:\\(\\s*0\\s*,\\s*${IDENTIFIER}(?:\\.${IDENTIFIER})*\\s*\\)|${IDENTIFIER}(?:\\.${IDENTIFIER})*)`;
const GENERATED_BINDING = new RegExp(`(${IDENTIFIER})\\s*[=:]\\s*(?:${CALLEE}\\s*\\(\\s*)*$`);
const AUTHORED_BINDING = new RegExp(
  `(?:^|[^\\w$.])(${IDENTIFIER})\\s*(?::[^=;{}()]*)?=\\s*(?:${CALLEE}\\s*(?:<[^()]*>)?\\s*\\(\\s*)*$`,
);
const GENERATED_LOOKBACK = 160;
const AUTHORED_LOOKBACK = 240;
const MIN_FUNCTION_TEXT = 12;

/** The function that React calls for a component type, unwrapping memo and forwardRef. */
export function componentFunctionOf(type: unknown, depth = 0): Fn | null {
  if (typeof type === 'function') return type as Fn;
  if (!type || typeof type !== 'object' || depth > 4) return null;
  const wrapper = type as { render?: unknown; type?: unknown };
  if (typeof wrapper.render === 'function') return wrapper.render as Fn;
  return wrapper.type ? componentFunctionOf(wrapper.type, depth + 1) : null;
}

function functionText(fn: Fn): string | null {
  try {
    const text = Function.prototype.toString.call(fn);
    if (text.length < MIN_FUNCTION_TEXT || /\{\s*\[native code\]\s*\}$/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** 1-based line and 0-based column of `offset`, using precomputed line starts. */
function positionOf(lineStarts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low]! };
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

function offsetOf(text: string, line: number, column: number): number | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return null;
    offset = next + 1;
  }
  return offset + column;
}

function identifierAt(text: string, offset: number): string | null {
  const match = new RegExp(`^${IDENTIFIER}`).exec(text.slice(offset, offset + 200));
  return match ? match[0] : null;
}

/** Authored own name, then authored binding, around a mapped definition. */
function authoredNames(mapping: GeneratedMapping): { own: string | null; binding: string | null } {
  const content = mapping.sourceContent;
  if (content === null) return { own: null, binding: null };
  const offset = offsetOf(content, mapping.line, mapping.column - 1);
  if (offset === null) return { own: null, binding: null };
  const own = AUTHORED_OWN_NAME.exec(content.slice(offset, offset + 300))?.[1] ?? null;
  const before = content.slice(Math.max(0, offset - AUTHORED_LOOKBACK), offset);
  const binding = AUTHORED_BINDING.exec(before)?.[1] ?? null;
  return { own, binding };
}

type Located = {
  script: ScriptRef;
  module: ModuleMaps;
  offset: number;
  ambiguous: boolean;
};

export function createComponentOriginResolver(deps: ComponentOriginDeps): ComponentOriginResolver {
  const modules = deps.modules ?? createModuleMapCache(fetchModuleFromPage);
  const settled = new WeakMap<Fn, ComponentOrigin>();
  const pending = new WeakMap<Fn, Promise<ComponentOrigin>>();
  const lineStarts = new Map<string, number[]>();
  // Components cluster in a few chunks; search recent hits first.
  const recentScripts: string[] = [];
  const stats = { functions: 0, scripts: 0, resolved: 0 };

  function moduleFor(script: ScriptRef): Promise<ModuleMaps | null> {
    stats.scripts = modules.stats.modules;
    return script.text === null
      ? modules.forUrl(script.url)
      : modules.forCode(script.key, script.text, script.url);
  }

  function orderedScripts(): ScriptRef[] {
    const scripts = deps.listScripts();
    const rank = new Map(recentScripts.map((key, index) => [key, index]));
    return scripts
      .map((script, index) => ({ script, index }))
      .sort((a, b) => (rank.get(a.script.key) ?? Infinity) - (rank.get(b.script.key) ?? Infinity) || a.index - b.index)
      .map((entry) => entry.script);
  }

  async function locate(text: string): Promise<Located | null> {
    for (const script of orderedScripts()) {
      const module = await moduleFor(script);
      if (!module) continue;
      const offset = module.code.indexOf(text);
      if (offset === -1) continue;
      const ambiguous = module.code.indexOf(text, offset + 1) !== -1;
      const at = recentScripts.indexOf(script.key);
      if (at !== -1) recentScripts.splice(at, 1);
      recentScripts.unshift(script.key);
      if (recentScripts.length > 16) recentScripts.length = 16;
      return { script, module, offset, ambiguous };
    }
    return null;
  }

  function startsOf(located: Located): number[] {
    let starts = lineStarts.get(located.script.key);
    if (!starts) {
      starts = lineStartsOf(located.module.code);
      lineStarts.set(located.script.key, starts);
    }
    return starts;
  }

  function mappedNameAt(located: Located, offset: number): string | null {
    const { line, column } = positionOf(startsOf(located), offset);
    const mapping = mappingAt(located.module.maps, line, column + 1);
    if (!mapping || !mapping.exact) return null;
    if (mapping.name) return mapping.name;
    if (mapping.sourceContent === null) return null;
    const authoredOffset = offsetOf(mapping.sourceContent, mapping.line, mapping.column - 1);
    return authoredOffset === null ? null : identifierAt(mapping.sourceContent, authoredOffset);
  }

  async function compute(fn: Fn): Promise<ComponentOrigin> {
    const generatedName = typeof fn.name === 'string' && fn.name !== '' ? fn.name : null;
    const base: ComponentOrigin = {
      status: 'not-found', name: null, nameEvidence: null, generatedName,
      definition: null, script: null, generated: null,
    };
    const text = functionText(fn);
    if (text === null) return { ...base, status: 'unsupported' };

    const located = await locate(text);
    if (!located) return base;
    const generated = positionOf(startsOf(located), located.offset);
    const found: ComponentOrigin = {
      ...base,
      script: located.script.text === null ? located.script.url : located.script.key,
      generated: { line: generated.line, column: generated.column + 1 },
    };
    if (located.ambiguous) return { ...found, status: 'ambiguous' };
    if (located.module.maps.length === 0) return { ...found, status: 'no-source-map' };

    const mapping = mappingAt(located.module.maps, generated.line, generated.column + 1);
    if (!mapping) return { ...found, status: 'unmapped' };
    const definition: ComponentDefinition = {
      fileName: sourcePath(mapping.source, located.module.sourceBaseUrl),
      lineNumber: mapping.line,
      columnNumber: mapping.column,
    };

    const ownMatch = OWN_FUNCTION_NAME.exec(text) ?? OWN_CLASS_NAME.exec(text);
    const ownOffset = ownMatch ? located.offset + ownMatch[0].lastIndexOf(ownMatch[1]!) : null;
    const lookback = located.module.code.slice(Math.max(0, located.offset - GENERATED_LOOKBACK), located.offset);
    const bindingMatch = GENERATED_BINDING.exec(lookback);
    const bindingOffset = bindingMatch
      ? located.offset - lookback.length + bindingMatch.index + bindingMatch[0].indexOf(bindingMatch[1]!)
      : null;
    const authored = authoredNames(mapping);

    const candidates: Array<[NameEvidence, () => string | null]> = [
      ['map-name', () => (ownOffset === null ? null : mappedNameAt(located, ownOffset))],
      ['source-text', () => authored.own],
      ['binding-map-name', () => (bindingOffset === null ? null : mappedNameAt(located, bindingOffset))],
      ['binding-source-text', () => authored.binding],
    ];
    for (const [evidence, read] of candidates) {
      const name = read();
      if (name) return { ...found, status: 'resolved', name, nameEvidence: evidence, definition };
    }
    return { ...found, status: 'resolved', definition };
  }

  function resolve(type: unknown): Promise<ComponentOrigin> {
    const fn = componentFunctionOf(type);
    if (!fn) {
      return Promise.resolve({
        status: 'unsupported', name: null, nameEvidence: null, generatedName: null,
        definition: null, script: null, generated: null,
      });
    }
    const cached = pending.get(fn);
    if (cached) return cached;
    stats.functions += 1;
    const answer = compute(fn)
      .catch((): ComponentOrigin => ({
        status: 'not-found', name: null, nameEvidence: null, generatedName: fn.name || null,
        definition: null, script: null, generated: null,
      }))
      .then((origin) => {
        if (origin.status === 'resolved') stats.resolved += 1;
        settled.set(fn, origin);
        return origin;
      });
    pending.set(fn, answer);
    return answer;
  }

  function peek(type: unknown): ComponentOrigin | null {
    const fn = componentFunctionOf(type);
    return fn ? settled.get(fn) ?? null : null;
  }

  return { resolve, peek, stats };
}

// ─── Page scripts ────────────────────────────────────────────────────────────

const SCRIPT_PATH = /\.(?:m?js|cjs|jsx|tsx?)$/i;

function isChippyAsset(url: URL): boolean {
  return url.pathname.startsWith('/__chippy/') || url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:';
}

/** Scripts the current document loaded: script elements, then script resources. */
export function listPageScripts(): ScriptRef[] {
  const scope = globalThis as {
    location?: { href?: string };
    document?: { scripts?: ArrayLike<{ src?: string; text?: string }> };
    performance?: { getEntriesByType?: (type: string) => Array<{ name: string; initiatorType?: string }> };
  };
  const base = scope.location?.href;
  if (!base) return [];
  const out: ScriptRef[] = [];
  const seen = new Set<string>();
  const add = (raw: string, initiator: string | null) => {
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') return;
    if (isChippyAsset(url)) return;
    if (initiator !== null && initiator !== 'script' && !SCRIPT_PATH.test(url.pathname)) return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    out.push({ key: url.href, url: url.href, text: null });
  };

  Array.from(scope.document?.scripts ?? []).forEach((script, index) => {
    if (script.src) add(script.src, null);
    else if (script.text && script.text.length >= MIN_FUNCTION_TEXT) {
      out.push({ key: `inline:${index}`, url: base, text: script.text });
    }
  });
  try {
    for (const entry of scope.performance?.getEntriesByType?.('resource') ?? []) {
      add(entry.name, entry.initiatorType ?? '');
    }
  } catch {}
  return out;
}

let pageResolver: ComponentOriginResolver | null = null;

/** The page-realm resolver over the current document's scripts. */
export function pageComponentOrigins(): ComponentOriginResolver {
  if (!pageResolver) pageResolver = createComponentOriginResolver({ listScripts: listPageScripts });
  return pageResolver;
}

/** Recovered authored name for a component type, once resolved. */
export function recoveredComponentName(type: unknown): string | null {
  return pageResolver?.peek(type)?.name ?? null;
}

/** Recovered authored definition for a component type, once resolved. */
export function componentDefinitionOf(type: unknown): ComponentDefinition | null {
  return pageResolver?.peek(type)?.definition ?? null;
}

/** Resolve the origin of a component type through the page resolver. */
export function resolveComponentOrigin(type: unknown): Promise<ComponentOrigin> {
  return pageComponentOrigins().resolve(type);
}

// ─── Reading names ───────────────────────────────────────────────────────────

type Named = { displayName?: unknown; name?: unknown };

function ownName(value: unknown): string | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
  const named = value as Named;
  if (typeof named.displayName === 'string' && named.displayName !== '') return named.displayName;
  return null;
}

/**
 * The name to show for a component type: an explicit `displayName`, then the
 * name recovered from the bundle's source map, then the runtime function name.
 * Host types (strings) return themselves.
 */
export function readComponentName(type: unknown): string | null {
  if (!type) return null;
  if (typeof type === 'string') return type;
  if (typeof type !== 'object' && typeof type !== 'function') return null;
  const explicit = ownName(type);
  if (explicit) return explicit;
  const recovered = recoveredComponentName(type);
  if (recovered) return recovered;
  const name = (type as Named).name;
  return typeof name === 'string' && name !== '' ? name : null;
}

/** The runtime name when a recovered name replaced it; otherwise null. */
export function minifiedComponentName(type: unknown): string | null {
  const origin = pageResolver?.peek(type);
  if (!origin?.name || ownName(type)) return null;
  return origin.generatedName && origin.generatedName !== origin.name ? origin.generatedName : null;
}

/**
 * Production builds: replace a described entry's minified `name` with the
 * recovered one, keeping the runtime name as `minifiedName`, and attach the
 * authored `definition`. Leaves entries without recovered data unchanged.
 */
export function applyRecoveredOrigin(entry: Record<string, unknown> | null | undefined, type: unknown): void {
  if (!entry) return;
  const minifiedName = minifiedComponentName(type);
  const definition = componentDefinitionOf(type);
  if (minifiedName) {
    entry.name = readComponentName(type);
    entry.minifiedName = minifiedName;
  }
  if (definition) entry.definition = definition;
}

// ─── Production fibers ───────────────────────────────────────────────────────

export type OriginFiber = {
  type?: unknown;
  _debugSource?: unknown;
  _debugStack?: unknown;
  _debugOwner?: unknown;
};

/**
 * True when React recorded no development metadata for the fiber, so its
 * name and location can only come from the bundle.
 */
export function needsComponentOrigin(fiber: OriginFiber | null | undefined): boolean {
  if (!fiber || !componentFunctionOf(fiber.type)) return false;
  if (fiber._debugSource || fiber._debugStack || fiber._debugOwner) return false;
  const type = fiber.type as { _debugSource?: unknown };
  return !type._debugSource && !ownName(fiber.type);
}

/** Resolve the fiber's component origin when the build recorded no metadata. */
export function resolveFiberComponentOrigin(fiber: OriginFiber | null | undefined): Promise<ComponentOrigin | null> {
  return needsComponentOrigin(fiber) ? resolveComponentOrigin(fiber!.type).catch(() => null) : Promise.resolve(null);
}

export type NameRecoveryStats = {
  /** Distinct component types without development metadata. */
  types: number;
  resolved: number;
  named: number;
  /** Types left unresolved because the time budget ran out. */
  skipped: number;
  statuses: Partial<Record<OriginStatus, number>>;
};

/**
 * Resolve origins for every production component type the walk visits, within
 * `budgetMs`. Used before name filters so they match authored names.
 */
export async function warmComponentNames(
  walk: (visit: (fiber: OriginFiber) => void) => void,
  budgetMs = 3000,
  resolver: ComponentOriginResolver = pageComponentOrigins(),
): Promise<NameRecoveryStats | null> {
  const types = new Set<unknown>();
  walk((fiber) => {
    if (needsComponentOrigin(fiber)) types.add(componentFunctionOf(fiber.type));
  });
  return warmComponentTypes(types, budgetMs, resolver);
}

/**
 * Resolve origins for component types a caller already holds, such as the
 * types Avalanche recorded, within `budgetMs`. Types with an explicit
 * `displayName` are skipped. Returns null when there is nothing to resolve.
 */
export async function warmComponentTypes(
  candidates: Iterable<unknown>,
  budgetMs = 3000,
  resolver: ComponentOriginResolver = pageComponentOrigins(),
): Promise<NameRecoveryStats | null> {
  const types = new Set<unknown>();
  for (const candidate of candidates) {
    const fn = componentFunctionOf(candidate);
    if (fn && !ownName(candidate) && !(candidate as { _debugSource?: unknown })._debugSource) types.add(fn);
  }
  if (types.size === 0) return null;
  const stats: NameRecoveryStats = { types: types.size, resolved: 0, named: 0, skipped: 0, statuses: {} };
  const deadline = Date.now() + budgetMs;
  for (const type of types) {
    if (Date.now() > deadline) {
      stats.skipped += 1;
      continue;
    }
    const origin = await resolver.resolve(type);
    stats.statuses[origin.status] = (stats.statuses[origin.status] ?? 0) + 1;
    if (origin.status === 'resolved') stats.resolved += 1;
    if (origin.name) stats.named += 1;
  }
  return stats;
}
