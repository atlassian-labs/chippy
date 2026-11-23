// Generated from src/chippy-bridge/stack-symbolication.ts by `yarn chippy:mcp:build`; do not edit.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/chippy-bridge/stack-symbolication.ts
var stack_symbolication_exports = {};
__export(stack_symbolication_exports, {
  createStackSymbolicator: () => createStackSymbolicator,
  nodeFetchText: () => nodeFetchText,
  symbolicateDebugHookPayload: () => symbolicateDebugHookPayload
});
module.exports = __toCommonJS(stack_symbolication_exports);

// src/chippy-bridge/source-map.ts
var DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var VALUE_OF = new Int8Array(128).fill(-1);
for (let index = 0; index < DIGITS.length; index += 1) {
  VALUE_OF[DIGITS.charCodeAt(index)] = index;
}
function walkLine(mappings, start, end, state, sourceCount, out) {
  let generatedColumn = 0;
  let index = start;
  while (index < end) {
    let count = 0;
    let v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0;
    let value = 0;
    let shift = 0;
    let broken = false;
    for (; index < end; index += 1) {
      const code = mappings.charCodeAt(index);
      if (code === 44) break;
      const digit = code < 128 ? VALUE_OF[code] : -1;
      if (digit < 0 || broken) {
        broken = true;
        continue;
      }
      value += (digit & 31) << shift;
      if ((digit & 32) !== 0) {
        shift += 5;
        continue;
      }
      const magnitude = value >>> 1;
      const decoded = (value & 1) === 1 ? magnitude === 0 ? -2147483648 : -magnitude : magnitude;
      if (count === 0) v0 = decoded;
      else if (count === 1) v1 = decoded;
      else if (count === 2) v2 = decoded;
      else if (count === 3) v3 = decoded;
      else if (count === 4) v4 = decoded;
      count += 1;
      value = 0;
      shift = 0;
    }
    index += 1;
    if (count === 0) continue;
    generatedColumn += v0;
    if (count < 4) {
      out?.push({ generatedColumn, sourceIndex: null, originalLine: null, originalColumn: null, nameIndex: null });
      continue;
    }
    state.sourceIndex += v1;
    state.originalLine += v2;
    state.originalColumn += v3;
    const named = count >= 5;
    if (named) state.nameIndex += v4;
    if (out && state.sourceIndex >= 0 && state.sourceIndex < sourceCount) {
      out.push({
        generatedColumn,
        sourceIndex: state.sourceIndex,
        originalLine: state.originalLine,
        originalColumn: state.originalColumn,
        nameIndex: named ? state.nameIndex : null
      });
    }
  }
  out?.sort((left, right) => left.generatedColumn - right.generatedColumn);
}
var MappingLines = class {
  #mappings;
  #sourceCount;
  #starts = null;
  /** State at the start of each line up to `#knownLines`, four ints per line. */
  #states = new Int32Array(4);
  #knownLines = 1;
  #decoded = /* @__PURE__ */ new Map();
  constructor(mappings, sourceCount) {
    this.#mappings = mappings;
    this.#sourceCount = sourceCount;
  }
  #lineStarts() {
    if (this.#starts) return this.#starts;
    const starts = [0];
    for (let at = this.#mappings.indexOf(";"); at !== -1; at = this.#mappings.indexOf(";", at + 1)) {
      starts.push(at + 1);
    }
    this.#starts = starts;
    return starts;
  }
  get length() {
    return this.#lineStarts().length;
  }
  #lineEnd(starts, line) {
    return line + 1 < starts.length ? starts[line + 1] - 1 : this.#mappings.length;
  }
  #stateAt(line) {
    const starts = this.#lineStarts();
    if (this.#states.length < starts.length * 4) {
      const grown = new Int32Array(starts.length * 4);
      grown.set(this.#states);
      this.#states = grown;
    }
    const states = this.#states;
    while (this.#knownLines <= line) {
      const previous = this.#knownLines - 1;
      const state = {
        sourceIndex: states[previous * 4],
        originalLine: states[previous * 4 + 1],
        originalColumn: states[previous * 4 + 2],
        nameIndex: states[previous * 4 + 3]
      };
      walkLine(this.#mappings, starts[previous], this.#lineEnd(starts, previous), state, this.#sourceCount, null);
      const next = this.#knownLines * 4;
      states[next] = state.sourceIndex;
      states[next + 1] = state.originalLine;
      states[next + 2] = state.originalColumn;
      states[next + 3] = state.nameIndex;
      this.#knownLines += 1;
    }
    return {
      sourceIndex: states[line * 4],
      originalLine: states[line * 4 + 1],
      originalColumn: states[line * 4 + 2],
      nameIndex: states[line * 4 + 3]
    };
  }
  /** Segments of the 0-based generated `line`, sorted by column; undefined past the end. */
  at(line) {
    const cached = this.#decoded.get(line);
    if (cached) return cached;
    const starts = this.#lineStarts();
    if (line < 0 || line >= starts.length) return void 0;
    const segments = [];
    walkLine(this.#mappings, starts[line], this.#lineEnd(starts, line), this.#stateAt(line), this.#sourceCount, segments);
    this.#decoded.set(line, segments);
    return segments;
  }
};
function resolveSources(raw) {
  if (!Array.isArray(raw.sources)) return null;
  const root = typeof raw.sourceRoot === "string" ? raw.sourceRoot : "";
  return raw.sources.map((source) => {
    if (typeof source !== "string") return "";
    if (root === "" || source === "" || /^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
    if (root.endsWith("/") && source.startsWith("/")) return `${root}${source.slice(1)}`;
    if (root.endsWith("/") || source.startsWith("/")) return `${root}${source}`;
    return `${root}/${source}`;
  });
}
function parseSourceMap(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (raw === null || typeof raw !== "object") return [];
  if (raw.version !== 3) return [];
  if (Array.isArray(raw.sections)) {
    return raw.sections.flatMap((section) => {
      if (section === null || typeof section !== "object") return [];
      const { offset, map } = section;
      if (offset === null || typeof offset !== "object" || map === null || typeof map !== "object") return [];
      const { line, column } = offset;
      if (typeof line !== "number" || typeof column !== "number") return [];
      return parseSourceMap(JSON.stringify(map)).map((parsed) => ({ ...parsed, offset: { line, column } }));
    });
  }
  const sources = resolveSources(raw);
  if (sources === null || typeof raw.mappings !== "string") return [];
  const names = Array.isArray(raw.names) ? raw.names.map((name) => typeof name === "string" ? name : "") : [];
  const contents = Array.isArray(raw.sourcesContent) ? raw.sourcesContent : [];
  const sourcesContent = sources.map((_, index) => typeof contents[index] === "string" ? contents[index] : null);
  return [{
    sources,
    names,
    sourcesContent,
    lines: new MappingLines(raw.mappings, sources.length),
    offset: { line: 0, column: 0 }
  }];
}
function sectionsFor(maps, line, column) {
  if (maps.length === 0 || maps.length === 1 && maps[0]?.offset.line === 0 && maps[0]?.offset.column === 0) return maps;
  const zeroBasedLine = line - 1;
  const candidates = maps.filter(
    (map) => map.offset.line < zeroBasedLine || map.offset.line === zeroBasedLine && map.offset.column < column
  );
  return candidates.length === 0 ? [] : [candidates[candidates.length - 1]];
}
function segmentAt(segments, column) {
  let low = 0;
  let high = segments.length - 1;
  let found;
  while (low <= high) {
    const middle = low + high >> 1;
    const segment = segments[middle];
    if (segment.generatedColumn <= column) {
      found = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
function mappingAt(maps, line, column) {
  for (const map of sectionsFor(maps, line, column)) {
    const localLine = line - map.offset.line;
    const localColumn = localLine === 1 ? column - map.offset.column : column;
    const segments = map.lines.at(localLine - 1);
    if (segments === void 0 || segments.length === 0) continue;
    const found = segmentAt(segments, localColumn - 1);
    if (found === void 0) continue;
    if (found.sourceIndex === null || found.originalLine === null || found.originalColumn === null) return null;
    const source = map.sources[found.sourceIndex];
    if (source === void 0 || source === "") continue;
    return {
      source,
      line: found.originalLine + 1,
      column: found.originalColumn + 1,
      name: found.nameIndex === null ? null : map.names[found.nameIndex] || null,
      exact: found.generatedColumn === localColumn - 1,
      sourceContent: map.sourcesContent[found.sourceIndex] ?? null
    };
  }
  return null;
}
function sourceMappingUrlOf(code) {
  const found = [...code.matchAll(/^[/*]{2,}[#@]\s*sourceMappingURL=(\S+)\s*(?:\*\/)?$/gm)];
  return found.at(-1)?.[1] ?? null;
}
function inlineSourceMapOf(url) {
  const match = /^data:application\/json[^,]*,(.*)$/s.exec(url);
  if (match === null) return null;
  const payload = match[1];
  if (!/;base64/i.test(url)) {
    try {
      return decodeURIComponent(payload);
    } catch {
      return null;
    }
  }
  try {
    const decode = globalThis.atob;
    if (decode) {
      const binary = decode(payload);
      const Decoder = globalThis.TextDecoder;
      return Decoder ? new Decoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))) : binary;
    }
    const buffer = globalThis.Buffer;
    return buffer?.from(payload, "base64").toString("utf8") ?? null;
  } catch {
    return null;
  }
}

// src/chippy-bridge/module-maps.ts
function parseUrl(url, base) {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}
function sourcePath(source, moduleUrl) {
  if (/^\/(?:Users|home|private|Volumes)\//.test(source)) return source;
  const direct = parseUrl(source);
  if (direct?.protocol === "file:") return decodeURIComponent(direct.pathname);
  if (direct && /^(?:webpack|rollup|vite|ng):$/.test(direct.protocol)) {
    return source.replace(/^[a-z]+:\/\/[^/]*\/?/i, "").replace(/^\.\//, "");
  }
  const resolved = parseUrl(source, moduleUrl)?.href ?? source;
  const parsed = parseUrl(resolved);
  return parsed ? parsed.pathname.replace(/^\/+/, "") : resolved;
}

// src/chippy-bridge/stack-symbolication.ts
var DEFAULT_BUDGET_MS = 2e4;
var SCRIPT_TAIL_BYTES = 4096;
var CODE_MAX = 160;
var INTERNAL_SOURCE = new RegExp([
  String.raw`(?:^|\/)node_modules\/(?:react|react-dom|react-reconciler|scheduler)\/`,
  String.raw`\/cjs\/(?:react|react-dom|react-reconciler|scheduler)(?:-[\w-]+)?\.(?:development|production|profiling)(?:\.min)?\.js$`
].join("|"));
function parseLoc(loc) {
  const match = /^(\d+):(\d+)$/.exec(loc);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
}
function lineOf(text, line) {
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) return null;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  const value = text.slice(start, end === -1 ? void 0 : end).trim();
  return value.length > CODE_MAX ? `${value.slice(0, CODE_MAX - 1)}\u2026` : value;
}
function createStackSymbolicator(fetchText, { maxScripts = 6 } = {}) {
  const scripts = /* @__PURE__ */ new Map();
  async function load(url) {
    const tail = await fetchText(url, { timeoutMs: 5e3, tail: SCRIPT_TAIL_BYTES });
    if (tail === null) return { error: "script fetch failed" };
    const annotation = sourceMappingUrlOf(tail);
    if (annotation === null) return { error: "no sourceMappingURL" };
    const inline = inlineSourceMapOf(annotation);
    if (inline !== null) return { maps: parseSourceMap(inline), baseUrl: url };
    let mapUrl;
    try {
      mapUrl = new URL(annotation, url).href;
    } catch {
      return { error: "bad sourceMappingURL" };
    }
    const text = await fetchText(mapUrl, { timeoutMs: 3e4 });
    if (text === null) return { error: "source map fetch failed" };
    const maps = parseSourceMap(text);
    return maps.length ? { maps, baseUrl: mapUrl } : { error: "unreadable source map" };
  }
  function scriptMaps(url) {
    const cached = scripts.get(url);
    if (cached) {
      scripts.delete(url);
      scripts.set(url, cached);
      return cached;
    }
    const pending = load(url).catch((error) => ({ error: String(error?.message || error) }));
    scripts.set(url, pending);
    while (scripts.size > maxScripts) scripts.delete(scripts.keys().next().value);
    return pending;
  }
  function mapFrame(frame, loaded) {
    if (!loaded || "error" in loaded) return null;
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
      code: found.sourceContent === null ? null : lineOf(found.sourceContent, found.line)
    };
  }
  async function symbolicate(lists, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
    const started = Date.now();
    const urls = [...new Set(lists.flatMap((frames) => frames.map((frame) => frame.url).filter((url) => !!url)))];
    const loaded = /* @__PURE__ */ new Map();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), budgetMs);
    });
    await Promise.all(urls.map(async (url) => {
      const result = await Promise.race([scriptMaps(url), deadline]);
      loaded.set(url, result === "timeout" ? { error: "timed out; still loading, retry" } : result);
    }));
    clearTimeout(timer);
    let mapped = 0;
    let unmapped = 0;
    let internalFrames = 0;
    const failures = {};
    const out = lists.map((frames) => {
      const resolved = frames.map((frame) => frame.url ? mapFrame(frame, loaded.get(frame.url)) : null);
      const internal = (entry) => !!entry && INTERNAL_SOURCE.test(entry.path);
      let first = 0;
      while (first < frames.length && internal(resolved[first])) first += 1;
      let kept = first;
      while (kept < frames.length && !internal(resolved[kept])) kept += 1;
      internalFrames += frames.length - (kept - first);
      const result = [];
      for (let index = first; index < kept; index += 1) {
        const frame = frames[index];
        const entry = resolved[index];
        if (!entry) {
          if (frame.url) {
            unmapped += 1;
            const script = loaded.get(frame.url);
            if (script && "error" in script) failures[frame.url] = script.error;
          }
          result.push(frame.url ? { name: frame.name, loc: frame.loc, url: frame.url } : { name: frame.name, loc: frame.loc });
          continue;
        }
        mapped += 1;
        const symbolicated = { name: frame.name, loc: frame.loc, source: `${entry.path}:${entry.line}:${entry.column}` };
        if (entry.code) symbolicated.code = entry.code;
        if (entry.name) symbolicated.calls = entry.name;
        const caller = resolved[index + 1];
        if (caller?.name && index + 1 < kept) symbolicated.fn = caller.name;
        result.push(symbolicated);
      }
      return result;
    });
    const status = {
      status: mapped === 0 ? "none" : unmapped === 0 ? "mapped" : "partial",
      mapped,
      unmapped,
      internalFrames,
      ms: Date.now() - started
    };
    if (Object.keys(failures).length) status.failures = failures;
    return { lists: out, status };
  }
  return { symbolicate };
}
var nodeFetchText = async (url, { timeoutMs, tail }) => {
  if (!/^https?:/i.test(url)) return null;
  try {
    const response = await fetch(url, {
      headers: tail ? { range: `bytes=-${tail}` } : void 0,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
};
async function symbolicateDebugHookPayload(payload, symbolicator, options) {
  if (!payload || payload.ok === false || !Array.isArray(payload.parents)) return;
  const neighborhood = Array.isArray(payload.neighborhood) ? payload.neighborhood : [];
  const lists = [payload.parents, ...neighborhood.map((entry) => entry.parents ?? [])];
  if (!lists.some((frames) => frames.some((frame) => frame?.url))) return;
  const { lists: mapped, status } = await symbolicator.symbolicate(lists, options);
  payload.parents = mapped[0];
  neighborhood.forEach((entry, index) => {
    if (entry.parents) entry.parents = mapped[index + 1];
  });
  payload.sourceMaps = status;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createStackSymbolicator,
  nodeFetchText,
  symbolicateDebugHookPayload
});
