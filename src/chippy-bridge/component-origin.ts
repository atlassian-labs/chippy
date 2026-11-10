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

import { createModuleMapCache, fetchModuleFromPage, type ModuleMapCache } from './module-maps';
import { referencedNames } from './component-references';
import {
  lineStartsOf,
  nameOccurrence,
  type ComponentDefinition,
  type NameEvidence,
  type Occurrence,
  type OccurrenceOrigin,
} from './component-occurrence';

export type { ComponentDefinition, NameEvidence } from './component-occurrence';

export type OriginStatus =
  /** The definition was mapped to authored source. */
  | 'resolved'
  /** The function text was found, but the script has no usable source map. */
  | 'no-source-map'
  /** The source map has no segment for the function's position. */
  | 'unmapped'
  /**
   * The function text occurs more than once, and the occurrences map to
   * different authored names. `candidates` lists them.
   */
  | 'ambiguous'
  /** No loaded script contains the function text. */
  | 'not-found'
  /** The type is not a function component, class, memo, or forwardRef. */
  | 'unsupported';

/** One authored definition the function text maps to. */
export type OriginCandidate = {
  name: string | null;
  definition: ComponentDefinition | null;
  script: string;
};

export type ComponentOrigin = {
  status: OriginStatus;
  /** Authored name, or null when no evidence names the component. */
  name: string | null;
  nameEvidence: NameEvidence | null;
  /** The runtime (minified) function name, or null when anonymous. */
  generatedName: string | null;
  /**
   * Authored definition, or null unless `status` is `resolved` and every
   * occurrence maps to the same definition.
   */
  definition: ComponentDefinition | null;
  /** Script URL that defines the function, or null when it was not found. */
  script: string | null;
  /** Generated 1-based position of the function in `script`. */
  generated: { line: number; column: number } | null;
  /**
   * How many times the exact function text occurs across the loaded scripts,
   * capped at `MAX_OCCURRENCES`. Minifiers mangle each scope independently,
   * so small components in separate scopes can compile to identical text.
   */
  occurrences: number;
  /** Distinct authored definitions when occurrences disagree on name or definition. */
  candidates?: OriginCandidate[];
  /**
   * True when `MAX_OCCURRENCES` or `MAX_CANDIDATES` cut the search short, so
   * `candidates` may miss the component's real definition.
   */
  truncated?: true;
  /**
   * Set when `nameEvidence` is `ancestor-reference`: the ancestor component
   * whose code references this name, and how many fibers up it is.
   */
  context?: { name: string; definition: ComponentDefinition | null; distance: number };
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
  /**
   * Authored identifiers the component's code references, or null when its
   * origin is not resolved to one authored name.
   */
  references(type: unknown): Promise<ReadonlySet<string> | null>;
  /** Replace the cached origin of `type`, for example after reading fiber context. */
  settle(type: unknown, origin: ComponentOrigin): void;
  readonly stats: { functions: number; scripts: number; resolved: number };
};

export type ComponentOriginDeps = {
  listScripts: () => readonly ScriptRef[];
  modules?: ModuleMapCache;
};

type Fn = (...args: never[]) => unknown;

const MIN_FUNCTION_TEXT = 12;
/** Occurrences named per function; the search stops at this cap. */
export const MAX_OCCURRENCES = 4096;
/** Distinct name and definition pairs kept per function. */
export const MAX_CANDIDATES = 256;

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

function definitionKey(definition: ComponentDefinition | null): string {
  return definition ? `${definition.fileName}:${definition.lineNumber}:${definition.columnNumber}` : '';
}

/**
 * Combine the named occurrences of one function text. Identical text that
 * maps to one authored name is that component, even when it was emitted more
 * than once; text that maps to different names cannot be attributed.
 */
export function combineOccurrences(
  named: readonly OccurrenceOrigin[],
  base: Pick<ComponentOrigin, 'generatedName'>,
  occurrences: number,
): ComponentOrigin {
  const first = named[0]!;
  const origin: ComponentOrigin = { ...first, generatedName: base.generatedName, occurrences };
  if (named.length === 1 || !named.some((item) => item.status === 'resolved')) return origin;

  const distinct = new Map<string, OriginCandidate>();
  for (const item of named) {
    const key = `${item.name ?? ''}|${definitionKey(item.definition)}`;
    if (!distinct.has(key)) distinct.set(key, { name: item.name, definition: item.definition, script: item.script });
  }
  const truncated = occurrences >= MAX_OCCURRENCES || distinct.size > MAX_CANDIDATES;
  const candidates = Array.from(distinct.values()).slice(0, MAX_CANDIDATES);
  const names = new Set(named.map((item) => item.name));
  const definitions = new Set(named.map((item) => definitionKey(item.definition)));
  const allResolved = named.every((item) => item.status === 'resolved');

  if (allResolved && names.size === 1 && first.name !== null) {
    return definitions.size === 1
      ? origin
      : { ...origin, definition: null, candidates };
  }
  return {
    ...origin, status: 'ambiguous', name: null, nameEvidence: null, definition: null, candidates,
    ...(truncated ? { truncated: true as const } : {}),
  };
}

export function createComponentOriginResolver(deps: ComponentOriginDeps): ComponentOriginResolver {
  const modules = deps.modules ?? createModuleMapCache(fetchModuleFromPage);
  const settled = new WeakMap<Fn, ComponentOrigin>();
  const pending = new WeakMap<Fn, Promise<ComponentOrigin>>();
  const lineStarts = new Map<string, number[]>();
  const located = new WeakMap<Fn, { text: string; found: Occurrence[] }>();
  const referenced = new WeakMap<Fn, Promise<ReadonlySet<string> | null>>();
  const stats = { functions: 0, scripts: 0, resolved: 0 };

  function codeOf(script: ScriptRef): Promise<string | null> {
    return script.text === null ? modules.codeOf(script.url) : Promise.resolve(script.text);
  }

  async function mapsFor(script: ScriptRef) {
    const module = script.text === null
      ? await modules.forUrl(script.url)
      : await modules.forCode(script.key, script.text, script.url);
    stats.scripts = modules.stats.modules;
    return module;
  }

  function startsOf(key: string, code: string): number[] {
    let starts = lineStarts.get(key);
    if (!starts) {
      starts = lineStartsOf(code);
      lineStarts.set(key, starts);
    }
    return starts;
  }

  /**
   * Every occurrence of `text` across the loaded scripts, up to the cap. Only
   * scripts that hold the text have their source maps fetched.
   */
  async function locateAll(text: string): Promise<{ found: Occurrence[]; count: number }> {
    const found: Occurrence[] = [];
    let count = 0;
    for (const script of deps.listScripts()) {
      const code = await codeOf(script);
      if (!code) continue;
      let offset = code.indexOf(text);
      if (offset === -1) continue;
      const module = await mapsFor(script);
      if (!module) continue;
      for (; offset !== -1 && count < MAX_OCCURRENCES; offset = code.indexOf(text, offset + text.length)) {
        count += 1;
        found.push({ script, module, offset });
      }
      if (count >= MAX_OCCURRENCES) break;
    }
    return { found, count };
  }

  async function compute(fn: Fn): Promise<ComponentOrigin> {
    const generatedName = typeof fn.name === 'string' && fn.name !== '' ? fn.name : null;
    const base: ComponentOrigin = {
      status: 'not-found', name: null, nameEvidence: null, generatedName,
      definition: null, script: null, generated: null, occurrences: 0,
    };
    const text = functionText(fn);
    if (text === null) return { ...base, status: 'unsupported' };

    const { found, count } = await locateAll(text);
    if (found.length === 0) return base;
    located.set(fn, { text, found });
    const named = found.map((occurrence) =>
      nameOccurrence(text, occurrence, startsOf(occurrence.script.key, occurrence.module.code)));
    return combineOccurrences(named, base, count);
  }

  function unsupported(generatedName: string | null, status: OriginStatus): ComponentOrigin {
    return {
      status, name: null, nameEvidence: null, generatedName,
      definition: null, script: null, generated: null, occurrences: 0,
    };
  }

  function resolve(type: unknown): Promise<ComponentOrigin> {
    const fn = componentFunctionOf(type);
    if (!fn) return Promise.resolve(unsupported(null, 'unsupported'));
    const cached = pending.get(fn);
    if (cached) return cached;
    stats.functions += 1;
    const answer = compute(fn)
      .catch(() => unsupported(fn.name || null, 'not-found'))
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

  function references(type: unknown): Promise<ReadonlySet<string> | null> {
    const fn = componentFunctionOf(type);
    if (!fn) return Promise.resolve(null);
    let answer = referenced.get(fn);
    if (!answer) {
      answer = resolve(fn).then((origin) => {
        const where = located.get(fn);
        if (origin.status !== 'resolved' || !origin.name || !where) return null;
        const names = new Set<string>();
        for (const occurrence of where.found) {
          const starts = startsOf(occurrence.script.key, occurrence.module.code);
          for (const name of referencedNames(where.text, occurrence, starts)) names.add(name);
        }
        return names;
      }).catch(() => null);
      referenced.set(fn, answer);
    }
    return answer;
  }

  function settle(type: unknown, origin: ComponentOrigin): void {
    const fn = componentFunctionOf(type);
    if (!fn) return;
    settled.set(fn, origin);
    pending.set(fn, Promise.resolve(origin));
  }

  return { resolve, peek, references, settle, stats };
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

/** The ancestor a recovered name was read from, when it came from fiber context. */
export function nameContextOf(type: unknown): ComponentOrigin['context'] | null {
  if (ownName(type)) return null;
  return pageResolver?.peek(type)?.context ?? null;
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
 * authored `definition`. A name read from an ancestor's code adds
 * `nameInferredFrom`. Leaves entries without recovered data unchanged.
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
  const context = nameContextOf(type);
  if (context) entry.nameInferredFrom = context;
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

export type NameRecoveryStats = {
  /** Distinct component types without development metadata. */
  types: number;
  /** Types resolved by an earlier call; not counted below. */
  cached: number;
  resolved: number;
  named: number;
  /** Types left unresolved because the time budget ran out. */
  skipped: number;
  /** Ambiguous types named from an ancestor's code; included in `named`. */
  byContext: number;
  statuses: Partial<Record<OriginStatus, number>>;
};

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
  const stats: NameRecoveryStats = { types: types.size, cached: 0, resolved: 0, named: 0, skipped: 0, byContext: 0, statuses: {} };
  const deadline = Date.now() + budgetMs;
  for (const type of types) {
    if (resolver.peek(type)) {
      stats.cached += 1;
      continue;
    }
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
