/**
 * Served-module text and source maps, fetched once per URL.
 *
 * Shared by the React 19 call-site resolver and the production component-name
 * resolver: both read a script the page loaded, follow its `sourceMappingURL`
 * (inline or external), and decode the Source Map v3 payload.
 */

import { inlineSourceMapOf, parseSourceMap, sourceMappingUrlOf, type SourceMap } from './source-map';

export type FetchModule = (url: string) => Promise<string | null>;

export type ModuleMaps = {
  /** The served text. */
  code: string;
  /** Decoded maps; empty when the module has no usable source map. */
  maps: readonly SourceMap[];
  /** URL that relative `sources` entries resolve against. */
  sourceBaseUrl: string;
};

export type ModuleMapCache = {
  /** Fetch only the served text of `url`, without its map. */
  codeOf(url: string): Promise<string | null>;
  /** Fetch `url`, then its map. Null when the module itself is unavailable. */
  forUrl(url: string): Promise<ModuleMaps | null>;
  /** Decode the map of text the page already holds, such as an inline script. */
  forCode(key: string, code: string, baseUrl: string): Promise<ModuleMaps>;
  readonly stats: { modules: number; maps: number };
};

export function parseUrl(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

/**
 * A map `sources` entry as a path: absolute file paths stay absolute; URLs
 * relative to the map become origin-relative paths such as `src/App.tsx`.
 */
export function sourcePath(source: string, moduleUrl: string): string {
  if (/^\/(?:Users|home|private|Volumes)\//.test(source)) return source;
  const direct = parseUrl(source);
  if (direct?.protocol === 'file:') return decodeURIComponent(direct.pathname);
  if (direct && /^(?:webpack|rollup|vite|ng):$/.test(direct.protocol)) {
    return source.replace(/^[a-z]+:\/\/[^/]*\/?/i, '').replace(/^\.\//, '');
  }
  const resolved = parseUrl(source, moduleUrl)?.href ?? source;
  const parsed = parseUrl(resolved);
  return parsed ? parsed.pathname.replace(/^\/+/, '') : resolved;
}

export function createModuleMapCache(fetchModule: FetchModule): ModuleMapCache {
  const byKey = new Map<string, Promise<ModuleMaps | null>>();
  const codeByUrl = new Map<string, Promise<string | null>>();
  const stats = { modules: 0, maps: 0 };

  async function mapsOf(code: string, url: string): Promise<ModuleMaps> {
    const annotation = sourceMappingUrlOf(code);
    if (annotation === null) return { code, maps: [], sourceBaseUrl: url };
    const inline = inlineSourceMapOf(annotation);
    if (inline !== null) {
      stats.maps += 1;
      return { code, maps: parseSourceMap(inline), sourceBaseUrl: url };
    }
    const mapUrl = parseUrl(annotation, url)?.href ?? null;
    const text = mapUrl === null ? null : await fetchModule(mapUrl);
    if (text === null || mapUrl === null) return { code, maps: [], sourceBaseUrl: url };
    stats.maps += 1;
    return { code, maps: parseSourceMap(text), sourceBaseUrl: mapUrl };
  }

  function codeOf(url: string): Promise<string | null> {
    const cached = codeByUrl.get(url);
    if (cached) return cached;
    stats.modules += 1;
    const pending = fetchModule(url).catch(() => null);
    codeByUrl.set(url, pending);
    return pending;
  }

  function forUrl(url: string): Promise<ModuleMaps | null> {
    const cached = byKey.get(url);
    if (cached) return cached;
    const pending = (async () => {
      const code = await codeOf(url);
      return code === null ? null : mapsOf(code, url);
    })().catch(() => null);
    byKey.set(url, pending);
    return pending;
  }

  function forCode(key: string, code: string, baseUrl: string): Promise<ModuleMaps> {
    const cached = byKey.get(key);
    if (cached) return cached as Promise<ModuleMaps>;
    const pending = mapsOf(code, baseUrl).catch(() => ({ code, maps: [], sourceBaseUrl: baseUrl }));
    byKey.set(key, pending);
    return pending;
  }

  return { codeOf, forUrl, forCode, stats };
}

/** Fetch a module or map in the page realm with a short timeout. */
export async function fetchModuleFromPage(url: string): Promise<string | null> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetchFn) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 4000) : null;
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
