import {
  inlineSourceMapOf,
  originalPositionFor,
  parseSourceMap,
  sourceMappingUrlOf,
  type OriginalPosition,
  type SourceMap,
} from './source-map';
import { baseName, pageModuleUrls, recordedLiteralPosition } from './recorded-source';

export type FiberSourceLocation = {
  fileName: string;
  lineNumber: number;
  columnNumber: number | null;
};

export type StackFrame = {
  url: string;
  line: number;
  column: number;
  function?: string;
};

export type SourceFiber = {
  type?: unknown;
  _debugSource?: unknown;
  _debugStack?: unknown;
};

export type FetchModule = (url: string) => Promise<string | null>;

/** Module URLs that may serve a file named by React <=18 `_debugSource`. */
export type ModuleUrlsFor = (fileName: string) => readonly string[];

export type CallSiteResolver = {
  locate(frames: readonly StackFrame[]): Promise<FiberSourceLocation | null>;
  /** Map a recorded `_debugSource` position through its served module. */
  locateRecorded(source: FiberSourceLocation): Promise<FiberSourceLocation>;
  readonly stats: { modules: number; sites: number; located: number };
};

type ResolvedMaps = {
  code: string;
  maps: readonly SourceMap[];
  sourceBaseUrl: string;
};

const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const AT_FRAME = /^\s*(?:(.*?)@)(.+?):(\d+):(\d+)$/;
const MAX_CALL_SITE_FRAMES = 4;

const resolvedFiberSources = new WeakMap<object, FiberSourceLocation | null>();
const pendingFiberSources = new WeakMap<object, Promise<FiberSourceLocation | null>>();
let defaultResolver: CallSiteResolver | null = null;

export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];

  for (const raw of stack.split('\n')) {
    const line = raw.trimEnd();
    if (line === '' || line.includes('(eval at ')) continue;
    const match = V8_FRAME.exec(line) ?? AT_FRAME.exec(line);
    if (!match) continue;

    const [, name, url = '', lineDigits = '', columnDigits = ''] = match;
    if (url === '' || url.startsWith('data:')) continue;
    const at = Number(lineDigits);
    const column = Number(columnDigits);
    if (!Number.isFinite(at) || !Number.isFinite(column) || at < 1) continue;
    frames.push({
      url,
      line: at,
      column,
      ...(name !== undefined && name !== '' ? { function: name } : {}),
    });
  }

  return frames;
}

export function isVendorPath(path: string): boolean {
  return (
    path.includes('node_modules') ||
    path.includes('/.vite/deps/') ||
    path.includes('/.yarn/')
  );
}

function rawLocation(frame: StackFrame): FiberSourceLocation {
  return { fileName: frame.url, lineNumber: frame.line, columnNumber: frame.column };
}

function locationFromOriginal(original: OriginalPosition): FiberSourceLocation {
  return { fileName: original.source, lineNumber: original.line, columnNumber: original.column };
}

export function writerLocationOf(
  frames: readonly StackFrame[],
  originalFor: (frame: StackFrame) => OriginalPosition | null,
): FiberSourceLocation | null {
  for (const frame of frames) {
    if (isVendorPath(frame.url)) continue;
    const original = originalFor(frame);
    if (original === null) return rawLocation(frame);
    if (isVendorPath(original.source)) continue;
    return locationFromOriginal(original);
  }
  return null;
}

function parseUrl(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

function sourcePath(source: string, moduleUrl: string): string {
  if (/^\/(?:Users|home|private|Volumes)\//.test(source)) return source;
  const direct = parseUrl(source);
  if (direct?.protocol === 'file:') return decodeURIComponent(direct.pathname);
  const resolved = parseUrl(source, moduleUrl)?.href ?? source;
  const parsed = parseUrl(resolved);
  return parsed ? parsed.pathname.replace(/^\/+/, '') : resolved;
}

export function createCallSiteResolver(
  fetchModule: FetchModule,
  moduleUrlsFor: ModuleUrlsFor = () => [],
): CallSiteResolver {
  const maps = new Map<string, Promise<ResolvedMaps | null>>();
  const sites = new Map<string, Promise<FiberSourceLocation | null>>();
  const recordedSites = new Map<string, Promise<FiberSourceLocation>>();
  const stats = { modules: 0, sites: 0, located: 0 };

  async function mapsFor(url: string): Promise<ResolvedMaps | null> {
    const cached = maps.get(url);
    if (cached) return cached;

    const pending = (async () => {
      stats.modules += 1;
      const code = await fetchModule(url);
      if (code === null) return null;
      const annotation = sourceMappingUrlOf(code);
      if (annotation === null) return null;
      const inline = inlineSourceMapOf(annotation);
      if (inline !== null) return { code, maps: parseSourceMap(inline), sourceBaseUrl: url };
      const mapUrl = parseUrl(annotation, url)?.href ?? null;
      const text = mapUrl === null ? null : await fetchModule(mapUrl);
      return text === null || mapUrl === null
        ? null
        : { code, maps: parseSourceMap(text), sourceBaseUrl: mapUrl };
    })();

    maps.set(url, pending);
    return pending;
  }

  async function locateFrame(frame: StackFrame): Promise<FiberSourceLocation | null> {
    const parsed = await mapsFor(frame.url);
    if (!parsed || parsed.maps.length === 0) return null;
    const original = originalPositionFor(parsed.maps, frame.line, frame.column);
    if (!original) return null;
    return {
      fileName: sourcePath(original.source, parsed.sourceBaseUrl),
      lineNumber: original.line,
      columnNumber: original.column,
    };
  }

  async function locate(frames: readonly StackFrame[]): Promise<FiberSourceLocation | null> {
    for (const frame of frames) {
      if (isVendorPath(frame.url)) continue;
      const key = `${frame.url}:${frame.line}:${frame.column}`;
      let answer = sites.get(key);
      if (!answer) {
        stats.sites += 1;
        answer = locateFrame(frame);
        sites.set(key, answer);
      }

      const located = await answer;
      const chosen = located === null
        ? writerLocationOf([frame], () => null)
        : isVendorPath(located.fileName) ? null : located;
      if (chosen) {
        stats.located += 1;
        return chosen;
      }
    }
    return null;
  }

  async function correctRecorded(source: FiberSourceLocation): Promise<FiberSourceLocation> {
    for (const url of moduleUrlsFor(source.fileName)) {
      const parsed = await mapsFor(url);
      if (!parsed || parsed.maps.length === 0) continue;
      const served = recordedLiteralPosition(parsed.code, source);
      if (served === null) continue;
      const original = originalPositionFor(parsed.maps, served.line, served.column);
      // The literal must map back into the recorded file, not a neighbor.
      if (!original || baseName(original.source) !== baseName(source.fileName)) continue;
      return { fileName: source.fileName, lineNumber: original.line, columnNumber: original.column };
    }
    return source;
  }

  function locateRecorded(source: FiberSourceLocation): Promise<FiberSourceLocation> {
    const key = `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
    let answer = recordedSites.get(key);
    if (!answer) {
      answer = correctRecorded(source).catch(() => source);
      recordedSites.set(key, answer);
    }
    return answer;
  }

  return { locate, locateRecorded, stats };
}

function debugSourceOf(value: unknown): FiberSourceLocation | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown };
  if (typeof source.fileName !== 'string' || typeof source.lineNumber !== 'number') return null;
  return {
    fileName: source.fileName,
    lineNumber: source.lineNumber,
    columnNumber: typeof source.columnNumber === 'number' ? source.columnNumber : null,
  };
}

function recordedSource(fiber: SourceFiber): FiberSourceLocation | null {
  const direct = debugSourceOf(fiber._debugSource);
  if (direct) return direct;
  const type = fiber.type;
  return type && (typeof type === 'object' || typeof type === 'function')
    ? debugSourceOf((type as { _debugSource?: unknown })._debugSource)
    : null;
}

export function getFiberStackFrames(fiber: SourceFiber | null | undefined): StackFrame[] {
  if (!fiber || !fiber._debugStack || typeof fiber._debugStack !== 'object') return [];
  const stack = (fiber._debugStack as { stack?: unknown }).stack;
  if (typeof stack !== 'string' || stack === '') return [];
  const candidates: StackFrame[] = [];
  for (const frame of parseStackFrames(stack)) {
    if (isVendorPath(frame.url)) continue;
    candidates.push(frame);
    if (candidates.length >= MAX_CALL_SITE_FRAMES) break;
  }
  return candidates;
}

/** Stable synchronous source, before any async source-map upgrade. */
export function getFiberSourceCandidate(fiber: SourceFiber | null | undefined): FiberSourceLocation | null {
  if (!fiber) return null;
  const recorded = recordedSource(fiber);
  if (recorded) return recorded;
  return writerLocationOf(getFiberStackFrames(fiber), () => null);
}

/**
 * Synchronous source read used by fiber walks and snapshots: the resolved
 * source once `resolveFiberSource` has run for this fiber, else the candidate.
 */
export function getFiberSource(fiber: SourceFiber | null | undefined): FiberSourceLocation | null {
  if (!fiber) return null;
  const cached = resolvedFiberSources.get(fiber as object);
  if (cached !== undefined) return cached;
  return getFiberSourceCandidate(fiber);
}

async function fetchModuleFromPage(url: string): Promise<string | null> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetchFn) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 2000) : null;
  try {
    const response = await fetchFn(url, {
      credentials: 'same-origin',
      signal: controller?.signal,
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function pageResolver(): CallSiteResolver {
  if (!defaultResolver) defaultResolver = createCallSiteResolver(fetchModuleFromPage, pageModuleUrls);
  return defaultResolver;
}

/**
 * Resolve a fiber's authored source through the served module's inline or
 * external map: the React 19 `_debugStack` call site, or the React <=18
 * `_debugSource` literal when a transform shifted its recorded line.
 */
export function resolveFiberSource(
  fiber: SourceFiber | null | undefined,
  resolver: CallSiteResolver = pageResolver(),
): Promise<FiberSourceLocation | null> {
  if (!fiber) return Promise.resolve(null);
  const cached = pendingFiberSources.get(fiber as object);
  if (cached) return cached;

  const recorded = recordedSource(fiber);
  if (recorded) {
    const pending = resolver.locateRecorded(recorded).then((located) => {
      resolvedFiberSources.set(fiber as object, located);
      return located;
    });
    pendingFiberSources.set(fiber as object, pending);
    return pending;
  }

  const frames = getFiberStackFrames(fiber);
  const fallback = writerLocationOf(frames, () => null);
  const pending = resolver.locate(frames)
    .catch(() => null)
    .then((source) => {
      const located = source ?? fallback;
      resolvedFiberSources.set(fiber as object, located);
      return located;
    });
  pendingFiberSources.set(fiber as object, pending);
  return pending;
}
