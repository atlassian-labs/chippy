/**
 * Map production call-stack frames to authored source, outside the page.
 *
 * Production frames name minified functions at `line:column` of a bundle. The
 * bundle's source map turns that into an authored file, line, and source text.
 * Production maps are large (tens of megabytes) and often public, so the
 * helper process fetches and decodes them: the page keeps only each frame's
 * script URL and pays nothing. Nothing here runs unless a command asks for it.
 */

import { sourcePath } from './module-maps';
import { inlineSourceMapOf, mappingAt, parseSourceMap, sourceMappingUrlOf, type SourceMap } from './source-map';

export type RawFrame = { name: string; loc: string; url?: string };

export type SymbolicatedFrame = {
  name: string;
  loc: string;
  /** Authored `path:line:column`, when the script's map covers the frame. */
  source?: string;
  /** Authored text of that line, trimmed. */
  code?: string;
  /** Identifier at this frame's call site: the function or hook it called. */
  calls?: string;
  /** Authored name of this frame's function, read from its caller's call site. */
  fn?: string;
  /** The script URL, kept only when the frame could not be mapped. */
  url?: string;
};

export type FetchText = (url: string, options: { timeoutMs: number; tail?: number }) => Promise<string | null>;

export type SymbolicateOptions = {
  /** Wall-clock budget for one call. Fetches that run past it keep warming the cache. */
  budgetMs?: number;
};

export type SymbolicationStatus = {
  /** `mapped`: every frame with a script mapped; `partial`: some; `none`: none. */
  status: 'mapped' | 'partial' | 'none';
  mapped: number;
  unmapped: number;
  /** React and scheduler frames removed: hook entry points above the app frames and the render loop below them. */
  internalFrames: number;
  /** Why scripts could not be mapped, keyed by script URL. */
  failures?: Record<string, string>;
  ms: number;
};

type ScriptMaps = { maps: readonly SourceMap[]; baseUrl: string } | { error: string };

const DEFAULT_BUDGET_MS = 20_000;
const SCRIPT_TAIL_BYTES = 4096;
const CODE_MAX = 160;

/**
 * React's own render and scheduling code. Matches the package directories and
 * React's published bundle files, so aliased or forked copies
 * (`node_modules/react-dom-fork/cjs/react-dom.profiling.min.js`) count too.
 */
const INTERNAL_SOURCE = new RegExp([
  String.raw`(?:^|\/)node_modules\/(?:react|react-dom|react-reconciler|scheduler)\/`,
  String.raw`\/cjs\/(?:react|react-dom|react-reconciler|scheduler)(?:-[\w-]+)?\.(?:development|production|profiling)(?:\.min)?\.js$`,
].join('|'));

function parseLoc(loc: string): { line: number; column: number } | null {
  const match = /^(\d+):(\d+)$/.exec(loc);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
}

function lineOf(text: string, line: number): string | null {
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', start);
    if (next === -1) return null;
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  const value = text.slice(start, end === -1 ? undefined : end).trim();
  return value.length > CODE_MAX ? `${value.slice(0, CODE_MAX - 1)}…` : value;
}

export function createStackSymbolicator(fetchText: FetchText, { maxScripts = 6 } = {}) {
  // Insertion order is recency: a hit is re-inserted, the oldest is evicted.
  const scripts = new Map<string, Promise<ScriptMaps>>();

  async function load(url: string): Promise<ScriptMaps> {
    const tail = await fetchText(url, { timeoutMs: 5000, tail: SCRIPT_TAIL_BYTES });
    if (tail === null) return { error: 'script fetch failed' };
    const annotation = sourceMappingUrlOf(tail);
    if (annotation === null) return { error: 'no sourceMappingURL' };
    const inline = inlineSourceMapOf(annotation);
    if (inline !== null) return { maps: parseSourceMap(inline), baseUrl: url };
    let mapUrl: string;
    try {
      mapUrl = new URL(annotation, url).href;
    } catch {
      return { error: 'bad sourceMappingURL' };
    }
    const text = await fetchText(mapUrl, { timeoutMs: 30_000 });
    if (text === null) return { error: 'source map fetch failed' };
    const maps = parseSourceMap(text);
    return maps.length ? { maps, baseUrl: mapUrl } : { error: 'unreadable source map' };
  }

  function scriptMaps(url: string): Promise<ScriptMaps> {
    const cached = scripts.get(url);
    if (cached) {
      scripts.delete(url);
      scripts.set(url, cached);
      return cached;
    }
    const pending = load(url).catch((error) => ({ error: String(error?.message || error) }));
    scripts.set(url, pending);
    while (scripts.size > maxScripts) scripts.delete(scripts.keys().next().value as string);
    return pending;
  }

  /** `name` is set only when the frame's column starts a mapped segment; a nearby segment's name is some other identifier. */
  type Mapped = { source: string; path: string; line: number; column: number; name: string | null; code: string | null };

  function mapFrame(frame: RawFrame, loaded: ScriptMaps | undefined): Mapped | null {
    if (!loaded || 'error' in loaded) return null;
    const at = parseLoc(frame.loc);
    if (!at) return null;
    const found = mappingAt(loaded.maps, at.line, at.column);
    if (!found) return null;
    return {
      source: found.source,
      path: sourcePath(found.source, loaded.baseUrl),
      line: found.line,
      column: found.column,
      name: found.exact ? found.name : null,
      code: found.sourceContent === null ? null : lineOf(found.sourceContent, found.line),
    };
  }

  /**
   * Map each list of frames (innermost first). React frames above the first
   * app frame are dropped, and the list is cut at the next React or scheduler
   * frame, since what follows is React's render loop.
   */
  async function symbolicate(
    lists: readonly (readonly RawFrame[])[],
    { budgetMs = DEFAULT_BUDGET_MS }: SymbolicateOptions = {},
  ): Promise<{ lists: SymbolicatedFrame[][]; status: SymbolicationStatus }> {
    const started = Date.now();
    const urls = [...new Set(lists.flatMap((frames) => frames.map((frame) => frame.url).filter((url): url is string => !!url)))];
    const loaded = new Map<string, ScriptMaps>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), budgetMs); });
    await Promise.all(urls.map(async (url) => {
      const result = await Promise.race([scriptMaps(url), deadline]);
      loaded.set(url, result === 'timeout' ? { error: 'timed out; still loading, retry' } : result);
    }));
    clearTimeout(timer);

    let mapped = 0;
    let unmapped = 0;
    let internalFrames = 0;
    const failures: Record<string, string> = {};
    const out = lists.map((frames) => {
      const resolved = frames.map((frame) => (frame.url ? mapFrame(frame, loaded.get(frame.url)) : null));
      const internal = (entry: Mapped | null | undefined) => !!entry && INTERNAL_SOURCE.test(entry.path);
      // Innermost frames can be React's own hook entry points (`useState`);
      // the caller's call site already names them, so skip them, then stop at
      // the next React frame, where the render loop starts.
      let first = 0;
      while (first < frames.length && internal(resolved[first])) first += 1;
      let kept = first;
      while (kept < frames.length && !internal(resolved[kept])) kept += 1;
      internalFrames += frames.length - (kept - first);
      const result: SymbolicatedFrame[] = [];
      for (let index = first; index < kept; index += 1) {
        const frame = frames[index]!;
        const entry = resolved[index];
        if (!entry) {
          if (frame.url) {
            unmapped += 1;
            const script = loaded.get(frame.url);
            if (script && 'error' in script) failures[frame.url] = script.error;
          }
          result.push(frame.url ? { name: frame.name, loc: frame.loc, url: frame.url } : { name: frame.name, loc: frame.loc });
          continue;
        }
        mapped += 1;
        const symbolicated: SymbolicatedFrame = { name: frame.name, loc: frame.loc, source: `${entry.path}:${entry.line}:${entry.column}` };
        if (entry.code) symbolicated.code = entry.code;
        if (entry.name) symbolicated.calls = entry.name;
        // The caller's call site names this frame's function.
        const caller = resolved[index + 1];
        if (caller?.name && index + 1 < kept) symbolicated.fn = caller.name;
        result.push(symbolicated);
      }
      return result;
    });

    const status: SymbolicationStatus = {
      status: mapped === 0 ? 'none' : unmapped === 0 ? 'mapped' : 'partial',
      mapped,
      unmapped,
      internalFrames,
      ms: Date.now() - started,
    };
    if (Object.keys(failures).length) status.failures = failures;
    return { lists: out, status };
  }

  return { symbolicate };
}

/** Fetch text with Node's `fetch`; `tail` asks for only the last bytes. */
export const nodeFetchText: FetchText = async (url, { timeoutMs, tail }) => {
  if (!/^https?:/i.test(url)) return null;
  try {
    const response = await fetch(url, {
      headers: tail ? { range: `bytes=-${tail}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
};

type DebugHookPayload = {
  ok?: boolean;
  parents?: RawFrame[];
  neighborhood?: Array<{ parents?: RawFrame[] }>;
  sourceMaps?: SymbolicationStatus;
};

/** Map the frames of an `avalanche-debug-hook` payload in place. */
export async function symbolicateDebugHookPayload(
  payload: DebugHookPayload | null | undefined,
  symbolicator: ReturnType<typeof createStackSymbolicator>,
  options?: SymbolicateOptions,
): Promise<void> {
  if (!payload || payload.ok === false || !Array.isArray(payload.parents)) return;
  const neighborhood = Array.isArray(payload.neighborhood) ? payload.neighborhood : [];
  const lists = [payload.parents, ...neighborhood.map((entry) => entry.parents ?? [])];
  if (!lists.some((frames) => frames.some((frame) => frame?.url))) return;
  const { lists: mapped, status } = await symbolicator.symbolicate(lists, options);
  payload.parents = mapped[0]!;
  neighborhood.forEach((entry, index) => { if (entry.parents) entry.parents = mapped[index + 1]!; });
  payload.sourceMaps = status;
}
