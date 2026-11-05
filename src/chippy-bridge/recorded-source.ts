/**
 * Correct React <=18 `_debugSource` lines through the served module.
 *
 * The JSX transform records `lineNumber`/`columnNumber` from the code it
 * receives. When an earlier transform adds lines first, the recorded position
 * points into that intermediate code rather than the authored file. For
 * example, `@vitejs/plugin-react` adds a Fast Refresh header before esbuild
 * compiles JSX, which shifts every recorded line in the module.
 *
 * The served module still contains the recorded literal, and its source map
 * maps that literal to the JSX element in the authored file. This module finds
 * the literal and the URLs that may serve the recorded file; the call-site
 * resolver in fiber-source.ts fetches the module and applies the map.
 */

export type RecordedSource = {
  fileName: string;
  lineNumber: number;
  columnNumber: number | null;
};

export type ServedPosition = { line: number; column: number };

export type PageModules = {
  origin: string;
  /** Script and module URLs the page loaded, oldest first. */
  resourceUrls: readonly string[];
  /** Vite serves any allowed file from `/@fs/<absolute path>`. */
  vite: boolean;
};

/**
 * The position of the single debug literal for `source` in served code, or
 * null when the literal is missing or appears more than once.
 */
export function recordedLiteralPosition(code: string, source: RecordedSource): ServedPosition | null {
  const column = source.columnNumber === null ? '' : `,\\s*columnNumber:\\s*${source.columnNumber}`;
  const literal = new RegExp(`lineNumber:\\s*${source.lineNumber}${column}(?!\\d)`, 'g');
  const first = literal.exec(code);
  if (first === null || literal.exec(code) !== null) return null;
  const before = code.slice(0, first.index);
  const lineStart = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: first.index - lineStart };
}

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function slashPath(fileName: string): string {
  return fileName.replace(/\\/g, '/');
}

/**
 * Same-origin URLs that may serve `fileName`, best match first: loaded modules
 * whose path ends the recorded file path, newest first, then Vite's `/@fs`
 * URL when the page runs on Vite.
 */
export function servedModuleUrls(fileName: string, page: PageModules): string[] {
  const file = slashPath(fileName);
  const matches = new Map<string, { url: string; length: number }>();
  for (const raw of page.resourceUrls) {
    let url: URL;
    try {
      url = new URL(raw, page.origin);
    } catch {
      continue;
    }
    if (url.origin !== page.origin) continue;
    const path = decodedPath(url.pathname).replace(/^\/@fs(?=\/)/, '');
    const tail = /^\/[A-Za-z]:\//.test(path) && /^[A-Za-z]:\//.test(file) ? path.slice(1) : path;
    if (tail.length < 2 || !file.endsWith(tail)) continue;
    // Later entries are newer, for example a module reloaded with `?t=`.
    matches.set(tail, { url: url.href, length: tail.length });
  }
  const ranked = [...matches.values()].sort((a, b) => b.length - a.length).map((entry) => entry.url);
  if (page.vite && (file.startsWith('/') || /^[A-Za-z]:\//.test(file))) {
    const fsUrl = new URL(`/@fs${file.startsWith('/') ? '' : '/'}${file}`, page.origin).href;
    if (!ranked.includes(fsUrl)) ranked.push(fsUrl);
  }
  return ranked;
}

function readPageModules(): PageModules | null {
  const scope = globalThis as {
    location?: { origin?: string };
    performance?: { getEntriesByType?: (type: string) => Array<{ name: string }> };
    document?: { scripts?: ArrayLike<{ src?: string }> };
  };
  const origin = scope.location?.origin;
  if (!origin || origin === 'null') return null;
  const resourceUrls: string[] = [];
  for (const script of Array.from(scope.document?.scripts ?? [])) {
    if (script.src) resourceUrls.push(script.src);
  }
  try {
    for (const entry of scope.performance?.getEntriesByType?.('resource') ?? []) resourceUrls.push(entry.name);
  } catch {}
  const vite = resourceUrls.some((url) => url.includes('/@vite/client'));
  return { origin, resourceUrls, vite };
}

/** Candidate module URLs for a recorded file on the current page. */
export function pageModuleUrls(fileName: string): string[] {
  const page = readPageModules();
  return page ? servedModuleUrls(fileName, page) : [];
}

export function baseName(path: string): string {
  const clean = slashPath(path).replace(/[?#].*$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}
