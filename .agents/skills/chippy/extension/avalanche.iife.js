this.__AVALANCHE__ = (function() {
  "use strict";
  var _a, _b, _c, _d, _e;
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), member.set(obj, value), value);
  var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
  var _mappings, _sourceCount, _starts, _states, _knownLines, _decoded, _MappingLines_instances, lineStarts_fn, lineEnd_fn, stateAt_fn;
  const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const VALUE_OF = new Int8Array(128).fill(-1);
  for (let index = 0; index < DIGITS.length; index += 1) {
    VALUE_OF[DIGITS.charCodeAt(index)] = index;
  }
  function walkLine(mappings, start, end, state2, sourceCount, out) {
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
        out == null ? void 0 : out.push({ generatedColumn, sourceIndex: null, originalLine: null, originalColumn: null, nameIndex: null });
        continue;
      }
      state2.sourceIndex += v1;
      state2.originalLine += v2;
      state2.originalColumn += v3;
      const named = count >= 5;
      if (named) state2.nameIndex += v4;
      if (out && state2.sourceIndex >= 0 && state2.sourceIndex < sourceCount) {
        out.push({
          generatedColumn,
          sourceIndex: state2.sourceIndex,
          originalLine: state2.originalLine,
          originalColumn: state2.originalColumn,
          nameIndex: named ? state2.nameIndex : null
        });
      }
    }
    out == null ? void 0 : out.sort((left, right) => left.generatedColumn - right.generatedColumn);
  }
  class MappingLines {
    constructor(mappings, sourceCount) {
      __privateAdd(this, _MappingLines_instances);
      __privateAdd(this, _mappings);
      __privateAdd(this, _sourceCount);
      __privateAdd(this, _starts, null);
      __privateAdd(this, _states, new Int32Array(4));
      __privateAdd(this, _knownLines, 1);
      __privateAdd(this, _decoded, /* @__PURE__ */ new Map());
      __privateSet(this, _mappings, mappings);
      __privateSet(this, _sourceCount, sourceCount);
    }
    get length() {
      return __privateMethod(this, _MappingLines_instances, lineStarts_fn).call(this).length;
    }
    /** Segments of the 0-based generated `line`, sorted by column; undefined past the end. */
    at(line) {
      const cached = __privateGet(this, _decoded).get(line);
      if (cached) return cached;
      const starts = __privateMethod(this, _MappingLines_instances, lineStarts_fn).call(this);
      if (line < 0 || line >= starts.length) return void 0;
      const segments = [];
      walkLine(__privateGet(this, _mappings), starts[line], __privateMethod(this, _MappingLines_instances, lineEnd_fn).call(this, starts, line), __privateMethod(this, _MappingLines_instances, stateAt_fn).call(this, line), __privateGet(this, _sourceCount), segments);
      __privateGet(this, _decoded).set(line, segments);
      return segments;
    }
  }
  _mappings = /* @__PURE__ */ new WeakMap();
  _sourceCount = /* @__PURE__ */ new WeakMap();
  _starts = /* @__PURE__ */ new WeakMap();
  _states = /* @__PURE__ */ new WeakMap();
  _knownLines = /* @__PURE__ */ new WeakMap();
  _decoded = /* @__PURE__ */ new WeakMap();
  _MappingLines_instances = /* @__PURE__ */ new WeakSet();
  lineStarts_fn = function() {
    if (__privateGet(this, _starts)) return __privateGet(this, _starts);
    const starts = [0];
    for (let at2 = __privateGet(this, _mappings).indexOf(";"); at2 !== -1; at2 = __privateGet(this, _mappings).indexOf(";", at2 + 1)) {
      starts.push(at2 + 1);
    }
    __privateSet(this, _starts, starts);
    return starts;
  };
  lineEnd_fn = function(starts, line) {
    return line + 1 < starts.length ? starts[line + 1] - 1 : __privateGet(this, _mappings).length;
  };
  stateAt_fn = function(line) {
    const starts = __privateMethod(this, _MappingLines_instances, lineStarts_fn).call(this);
    if (__privateGet(this, _states).length < starts.length * 4) {
      const grown = new Int32Array(starts.length * 4);
      grown.set(__privateGet(this, _states));
      __privateSet(this, _states, grown);
    }
    const states = __privateGet(this, _states);
    while (__privateGet(this, _knownLines) <= line) {
      const previous = __privateGet(this, _knownLines) - 1;
      const state2 = {
        sourceIndex: states[previous * 4],
        originalLine: states[previous * 4 + 1],
        originalColumn: states[previous * 4 + 2],
        nameIndex: states[previous * 4 + 3]
      };
      walkLine(__privateGet(this, _mappings), starts[previous], __privateMethod(this, _MappingLines_instances, lineEnd_fn).call(this, starts, previous), state2, __privateGet(this, _sourceCount), null);
      const next = __privateGet(this, _knownLines) * 4;
      states[next] = state2.sourceIndex;
      states[next + 1] = state2.originalLine;
      states[next + 2] = state2.originalColumn;
      states[next + 3] = state2.nameIndex;
      __privateSet(this, _knownLines, __privateGet(this, _knownLines) + 1);
    }
    return {
      sourceIndex: states[line * 4],
      originalLine: states[line * 4 + 1],
      originalColumn: states[line * 4 + 2],
      nameIndex: states[line * 4 + 3]
    };
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
    var _a2, _b2;
    if (maps.length === 0 || maps.length === 1 && ((_a2 = maps[0]) == null ? void 0 : _a2.offset.line) === 0 && ((_b2 = maps[0]) == null ? void 0 : _b2.offset.column) === 0) return maps;
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
  function originalPositionFor(maps, line, column) {
    const found = mappingAt(maps, line, column);
    return found === null ? null : { source: found.source, line: found.line, column: found.column };
  }
  function sourceMappingUrlOf(code) {
    var _a2;
    const found = [...code.matchAll(/^[/*]{2,}[#@]\s*sourceMappingURL=(\S+)\s*(?:\*\/)?$/gm)];
    return ((_a2 = found.at(-1)) == null ? void 0 : _a2[1]) ?? null;
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
      return (buffer == null ? void 0 : buffer.from(payload, "base64").toString("utf8")) ?? null;
    } catch {
      return null;
    }
  }
  function mappingsInRange(maps, start, end) {
    const out = [];
    const before = (line, column, other) => line < other.line || line === other.line && column < other.column;
    for (const map of maps) {
      for (let localLine = 1; localLine <= map.lines.length; localLine += 1) {
        const line = localLine + map.offset.line;
        if (line < start.line) continue;
        if (line > end.line) break;
        for (const segment of map.lines.at(localLine - 1)) {
          const column = segment.generatedColumn + 1 + (localLine === 1 ? map.offset.column : 0);
          if (before(line, column, start)) continue;
          if (!before(line, column, end)) break;
          if (segment.sourceIndex === null || segment.originalLine === null || segment.originalColumn === null) continue;
          const source = map.sources[segment.sourceIndex];
          if (source === void 0 || source === "") continue;
          out.push({
            source,
            line: segment.originalLine + 1,
            column: segment.originalColumn + 1,
            name: segment.nameIndex === null ? null : map.names[segment.nameIndex] || null,
            sourceContent: map.sourcesContent[segment.sourceIndex] ?? null
          });
        }
      }
    }
    return out;
  }
  const MAX_OWN_REQUESTS = 2e3;
  const ownUrls = /* @__PURE__ */ new Set();
  function absolute(url) {
    var _a2;
    try {
      return new URL(url, (_a2 = globalThis.location) == null ? void 0 : _a2.href).href;
    } catch {
      return url;
    }
  }
  function markOwnRequest(url) {
    if (ownUrls.size >= MAX_OWN_REQUESTS) ownUrls.delete(ownUrls.values().next().value);
    ownUrls.add(absolute(url));
  }
  function isOwnRequest(url) {
    return ownUrls.has(url) || ownUrls.has(absolute(url));
  }
  function isChippyAssetUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.startsWith("/__chippy/") || parsed.protocol === "chrome-extension:" || parsed.protocol === "moz-extension:";
    } catch {
      return false;
    }
  }
  function parseUrl(url, base) {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  }
  function sourcePath(source, moduleUrl) {
    var _a2;
    if (/^\/(?:Users|home|private|Volumes)\//.test(source)) return source;
    const direct = parseUrl(source);
    if ((direct == null ? void 0 : direct.protocol) === "file:") return decodeURIComponent(direct.pathname);
    if (direct && /^(?:webpack|rollup|vite|ng):$/.test(direct.protocol)) {
      return source.replace(/^[a-z]+:\/\/[^/]*\/?/i, "").replace(/^\.\//, "");
    }
    const resolved = ((_a2 = parseUrl(source, moduleUrl)) == null ? void 0 : _a2.href) ?? source;
    const parsed = parseUrl(resolved);
    return parsed ? parsed.pathname.replace(/^\/+/, "") : resolved;
  }
  function createModuleMapCache(fetchModule) {
    const byKey = /* @__PURE__ */ new Map();
    const codeByUrl = /* @__PURE__ */ new Map();
    const stats = { modules: 0, maps: 0 };
    async function mapsOf(code, url) {
      var _a2;
      const annotation = sourceMappingUrlOf(code);
      if (annotation === null) return { code, maps: [], sourceBaseUrl: url };
      const inline = inlineSourceMapOf(annotation);
      if (inline !== null) {
        stats.maps += 1;
        return { code, maps: parseSourceMap(inline), sourceBaseUrl: url };
      }
      const mapUrl = ((_a2 = parseUrl(annotation, url)) == null ? void 0 : _a2.href) ?? null;
      const text = mapUrl === null ? null : await fetchModule(mapUrl);
      if (text === null || mapUrl === null) return { code, maps: [], sourceBaseUrl: url };
      stats.maps += 1;
      return { code, maps: parseSourceMap(text), sourceBaseUrl: mapUrl };
    }
    function codeOf(url) {
      const cached = codeByUrl.get(url);
      if (cached) return cached;
      stats.modules += 1;
      const pending = fetchModule(url).catch(() => null);
      codeByUrl.set(url, pending);
      return pending;
    }
    function forUrl(url) {
      const cached = byKey.get(url);
      if (cached) return cached;
      const pending = (async () => {
        const code = await codeOf(url);
        return code === null ? null : mapsOf(code, url);
      })().catch(() => null);
      byKey.set(url, pending);
      return pending;
    }
    function forCode(key, code, baseUrl) {
      const cached = byKey.get(key);
      if (cached) return cached;
      const pending = mapsOf(code, baseUrl).catch(() => ({ code, maps: [], sourceBaseUrl: baseUrl }));
      byKey.set(key, pending);
      return pending;
    }
    return { codeOf, forUrl, forCode, stats };
  }
  async function fetchModuleFromPage(url) {
    const fetchFn = globalThis.fetch;
    if (!fetchFn) return null;
    markOwnRequest(url);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 4e3) : null;
    try {
      const response = await fetchFn(url, {
        credentials: "same-origin",
        signal: controller == null ? void 0 : controller.signal
      });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }
  const IDENTIFIER$1 = "[A-Za-z_$][\\w$]*";
  const OWN_FUNCTION_NAME = new RegExp(`^(?:async\\s*)?function\\s*\\*?\\s*(${IDENTIFIER$1})\\s*\\(`);
  const OWN_CLASS_NAME = new RegExp(`^class\\s+(${IDENTIFIER$1})(?=[\\s{])`);
  const AUTHORED_OWN_NAME = new RegExp(
    `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)(${IDENTIFIER$1})`
  );
  const CALLEE = `(?:\\(\\s*0\\s*,\\s*${IDENTIFIER$1}(?:\\.${IDENTIFIER$1})*\\s*\\)|${IDENTIFIER$1}(?:\\.${IDENTIFIER$1})*)`;
  const GENERATED_BINDING = new RegExp(`(${IDENTIFIER$1})\\s*[=:]\\s*(?:${CALLEE}\\s*\\(\\s*)*$`);
  const AUTHORED_BINDING = new RegExp(
    `(?:^|[^\\w$.])(${IDENTIFIER$1})\\s*(?::[^=;{}()]*)?=\\s*(?:${CALLEE}\\s*(?:<[^()]*>)?\\s*\\(\\s*)*$`
  );
  const LEADING_IDENTIFIER = new RegExp(`^${IDENTIFIER$1}`);
  const GENERATED_LOOKBACK = 160;
  const AUTHORED_LOOKBACK = 240;
  function lineStartsOf(text) {
    const starts = [0];
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      starts.push(index + 1);
    }
    return starts;
  }
  function positionOf(lineStarts, offset) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = low + high + 1 >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] };
  }
  const contentLineStarts = /* @__PURE__ */ new Map();
  function offsetOf(text, line, column) {
    let starts = contentLineStarts.get(text);
    if (!starts) {
      starts = lineStartsOf(text);
      contentLineStarts.set(text, starts);
    }
    const start = starts[line - 1];
    return start === void 0 ? null : start + column;
  }
  function authoredNames(mapping) {
    var _a2, _b2;
    const content = mapping.sourceContent;
    if (content === null) return { own: null, binding: null };
    const offset = offsetOf(content, mapping.line, mapping.column - 1);
    if (offset === null) return { own: null, binding: null };
    const own = ((_a2 = AUTHORED_OWN_NAME.exec(content.slice(offset, offset + 300))) == null ? void 0 : _a2[1]) ?? null;
    const before = content.slice(Math.max(0, offset - AUTHORED_LOOKBACK), offset);
    const binding = ((_b2 = AUTHORED_BINDING.exec(before)) == null ? void 0 : _b2[1]) ?? null;
    return { own, binding };
  }
  function mappedNameAt(maps, lineStarts, offset) {
    var _a2;
    const { line, column } = positionOf(lineStarts, offset);
    const mapping = mappingAt(maps, line, column + 1);
    if (!mapping || !mapping.exact) return null;
    if (mapping.name) return mapping.name;
    if (mapping.sourceContent === null) return null;
    const authoredOffset = offsetOf(mapping.sourceContent, mapping.line, mapping.column - 1);
    if (authoredOffset === null) return null;
    return ((_a2 = LEADING_IDENTIFIER.exec(mapping.sourceContent.slice(authoredOffset, authoredOffset + 200))) == null ? void 0 : _a2[0]) ?? null;
  }
  function nameOccurrence(text, occurrence, lineStarts) {
    const { script, module, offset } = occurrence;
    const generated = positionOf(lineStarts, offset);
    const found = {
      status: "resolved",
      name: null,
      nameEvidence: null,
      definition: null,
      script: script.text === null ? script.url : script.key,
      generated: { line: generated.line, column: generated.column + 1 }
    };
    if (module.maps.length === 0) return { ...found, status: "no-source-map" };
    const mapping = mappingAt(module.maps, generated.line, generated.column + 1);
    if (!mapping) return { ...found, status: "unmapped" };
    const definition = {
      fileName: sourcePath(mapping.source, module.sourceBaseUrl),
      lineNumber: mapping.line,
      columnNumber: mapping.column
    };
    const ownMatch = OWN_FUNCTION_NAME.exec(text) ?? OWN_CLASS_NAME.exec(text);
    const ownOffset = ownMatch ? offset + ownMatch[0].lastIndexOf(ownMatch[1]) : null;
    const lookback = module.code.slice(Math.max(0, offset - GENERATED_LOOKBACK), offset);
    const bindingMatch = GENERATED_BINDING.exec(lookback);
    const bindingOffset = bindingMatch ? offset - lookback.length + bindingMatch.index + bindingMatch[0].indexOf(bindingMatch[1]) : null;
    const authored = authoredNames(mapping);
    const candidates = [
      ["map-name", () => ownOffset === null ? null : mappedNameAt(module.maps, lineStarts, ownOffset)],
      ["source-text", () => authored.own],
      ["binding-map-name", () => bindingOffset === null ? null : mappedNameAt(module.maps, lineStarts, bindingOffset)],
      ["binding-source-text", () => authored.binding]
    ];
    for (const [evidence, read2] of candidates) {
      const name = read2();
      if (name) return { ...found, name, nameEvidence: evidence, definition };
    }
    return { ...found, definition };
  }
  const IDENTIFIERS = /[A-Za-z_$][\w$]*/g;
  const LAST_TOKEN = /^[A-Za-z_$][\w$]*/;
  const MAX_AUTHORED_SPAN = 2e5;
  function referencedNames(text, occurrence, lineStarts) {
    var _a2;
    const names = /* @__PURE__ */ new Set();
    const { module, offset } = occurrence;
    if (module.maps.length === 0) return names;
    const toPosition = (at2) => {
      const { line, column } = positionOf(lineStarts, at2);
      return { line, column: column + 1 };
    };
    const mappings = mappingsInRange(module.maps, toPosition(offset), toPosition(offset + text.length));
    for (const mapping of mappings) {
      if (mapping.name) names.add(mapping.name);
    }
    const first = mappings[0];
    if (!(first == null ? void 0 : first.sourceContent)) return names;
    let low = first;
    let high = first;
    for (const mapping of mappings) {
      if (mapping.source !== first.source) continue;
      if (mapping.line < low.line || mapping.line === low.line && mapping.column < low.column) low = mapping;
      if (mapping.line > high.line || mapping.line === high.line && mapping.column > high.column) high = mapping;
    }
    const start = offsetOf(first.sourceContent, low.line, low.column - 1);
    const end = offsetOf(first.sourceContent, high.line, high.column - 1);
    if (start === null || end === null || end - start > MAX_AUTHORED_SPAN) return names;
    const last = ((_a2 = LAST_TOKEN.exec(first.sourceContent.slice(end, end + 200))) == null ? void 0 : _a2[0]) ?? "";
    const span = first.sourceContent.slice(start, end) + last;
    for (const match of span.matchAll(IDENTIFIERS)) names.add(match[0]);
    return names;
  }
  const MIN_FUNCTION_TEXT = 12;
  const MAX_OCCURRENCES = 4096;
  const MAX_CANDIDATES = 256;
  function componentFunctionOf(type, depth = 0) {
    if (typeof type === "function") return type;
    if (!type || typeof type !== "object" || depth > 4) return null;
    const wrapper = type;
    if (typeof wrapper.render === "function") return wrapper.render;
    return wrapper.type ? componentFunctionOf(wrapper.type, depth + 1) : null;
  }
  function functionText(fn) {
    try {
      const text = Function.prototype.toString.call(fn);
      if (text.length < MIN_FUNCTION_TEXT || /\{\s*\[native code\]\s*\}$/.test(text)) return null;
      return text;
    } catch {
      return null;
    }
  }
  function definitionKey$1(definition) {
    return definition ? `${definition.fileName}:${definition.lineNumber}:${definition.columnNumber}` : "";
  }
  function combineOccurrences(named, base, occurrences) {
    const first = named[0];
    const origin = { ...first, generatedName: base.generatedName, occurrences };
    if (named.length === 1 || !named.some((item) => item.status === "resolved")) return origin;
    const distinct = /* @__PURE__ */ new Map();
    for (const item of named) {
      const key = `${item.name ?? ""}|${definitionKey$1(item.definition)}`;
      if (!distinct.has(key)) distinct.set(key, { name: item.name, definition: item.definition, script: item.script });
    }
    const truncated = occurrences >= MAX_OCCURRENCES || distinct.size > MAX_CANDIDATES;
    const candidates = Array.from(distinct.values()).slice(0, MAX_CANDIDATES);
    const names = new Set(named.map((item) => item.name));
    const definitions = new Set(named.map((item) => definitionKey$1(item.definition)));
    const allResolved = named.every((item) => item.status === "resolved");
    if (allResolved && names.size === 1 && first.name !== null) {
      return definitions.size === 1 ? origin : { ...origin, definition: null, candidates };
    }
    return {
      ...origin,
      status: "ambiguous",
      name: null,
      nameEvidence: null,
      definition: null,
      candidates,
      ...truncated ? { truncated: true } : {}
    };
  }
  function createComponentOriginResolver(deps) {
    const modules = deps.modules ?? createModuleMapCache(fetchModuleFromPage);
    const settled = /* @__PURE__ */ new WeakMap();
    const pending = /* @__PURE__ */ new WeakMap();
    const lineStarts = /* @__PURE__ */ new Map();
    const located = /* @__PURE__ */ new WeakMap();
    const referenced = /* @__PURE__ */ new WeakMap();
    const stats = { functions: 0, scripts: 0, resolved: 0 };
    function codeOf(script) {
      return script.text === null ? modules.codeOf(script.url) : Promise.resolve(script.text);
    }
    async function mapsFor(script) {
      const module = script.text === null ? await modules.forUrl(script.url) : await modules.forCode(script.key, script.text, script.url);
      stats.scripts = modules.stats.modules;
      return module;
    }
    function startsOf(key, code) {
      let starts = lineStarts.get(key);
      if (!starts) {
        starts = lineStartsOf(code);
        lineStarts.set(key, starts);
      }
      return starts;
    }
    async function locateAll(text) {
      const found = [];
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
    async function compute(fn) {
      const generatedName = typeof fn.name === "string" && fn.name !== "" ? fn.name : null;
      const base = {
        status: "not-found",
        name: null,
        nameEvidence: null,
        generatedName,
        definition: null,
        script: null,
        generated: null,
        occurrences: 0
      };
      const text = functionText(fn);
      if (text === null) return { ...base, status: "unsupported" };
      const { found, count } = await locateAll(text);
      if (found.length === 0) return base;
      located.set(fn, { text, found });
      const named = found.map((occurrence) => nameOccurrence(text, occurrence, startsOf(occurrence.script.key, occurrence.module.code)));
      return combineOccurrences(named, base, count);
    }
    function unsupported(generatedName, status) {
      return {
        status,
        name: null,
        nameEvidence: null,
        generatedName,
        definition: null,
        script: null,
        generated: null,
        occurrences: 0
      };
    }
    function resolve2(type) {
      const fn = componentFunctionOf(type);
      if (!fn) return Promise.resolve(unsupported(null, "unsupported"));
      const cached = pending.get(fn);
      if (cached) return cached;
      stats.functions += 1;
      const answer = compute(fn).catch(() => unsupported(fn.name || null, "not-found")).then((origin) => {
        if (origin.status === "resolved") stats.resolved += 1;
        settled.set(fn, origin);
        return origin;
      });
      pending.set(fn, answer);
      return answer;
    }
    function peek(type) {
      const fn = componentFunctionOf(type);
      return fn ? settled.get(fn) ?? null : null;
    }
    function references(type) {
      const fn = componentFunctionOf(type);
      if (!fn) return Promise.resolve(null);
      let answer = referenced.get(fn);
      if (!answer) {
        answer = resolve2(fn).then((origin) => {
          const where = located.get(fn);
          if (origin.status !== "resolved" || !origin.name || !where) return null;
          const names = /* @__PURE__ */ new Set();
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
    function settle(type, origin) {
      const fn = componentFunctionOf(type);
      if (!fn) return;
      settled.set(fn, origin);
      pending.set(fn, Promise.resolve(origin));
    }
    return { resolve: resolve2, peek, references, settle, stats };
  }
  const SCRIPT_PATH = /\.(?:m?js|cjs|jsx|tsx?)$/i;
  function isChippyAsset(url) {
    return url.pathname.startsWith("/__chippy/") || url.protocol === "chrome-extension:" || url.protocol === "moz-extension:";
  }
  function listPageScripts() {
    var _a2, _b2, _c2, _d2;
    const scope = globalThis;
    const base = (_a2 = scope.location) == null ? void 0 : _a2.href;
    if (!base) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (raw, initiator) => {
      let url;
      try {
        url = new URL(raw, base);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") return;
      if (isChippyAsset(url)) return;
      if (initiator !== null && initiator !== "script" && !SCRIPT_PATH.test(url.pathname)) return;
      url.hash = "";
      if (seen.has(url.href)) return;
      seen.add(url.href);
      out.push({ key: url.href, url: url.href, text: null });
    };
    Array.from(((_b2 = scope.document) == null ? void 0 : _b2.scripts) ?? []).forEach((script, index) => {
      if (script.src) add(script.src, null);
      else if (script.text && script.text.length >= MIN_FUNCTION_TEXT) {
        out.push({ key: `inline:${index}`, url: base, text: script.text });
      }
    });
    try {
      for (const entry of ((_d2 = (_c2 = scope.performance) == null ? void 0 : _c2.getEntriesByType) == null ? void 0 : _d2.call(_c2, "resource")) ?? []) {
        add(entry.name, entry.initiatorType ?? "");
      }
    } catch {
    }
    return out;
  }
  let pageResolver$1 = null;
  function pageComponentOrigins() {
    if (!pageResolver$1) pageResolver$1 = createComponentOriginResolver({ listScripts: listPageScripts });
    return pageResolver$1;
  }
  function recoveredComponentName(type) {
    var _a2;
    return ((_a2 = pageResolver$1 == null ? void 0 : pageResolver$1.peek(type)) == null ? void 0 : _a2.name) ?? null;
  }
  function componentDefinitionOf(type) {
    var _a2;
    return ((_a2 = pageResolver$1 == null ? void 0 : pageResolver$1.peek(type)) == null ? void 0 : _a2.definition) ?? null;
  }
  function nameContextOf(type) {
    var _a2;
    if (ownName(type)) return null;
    return ((_a2 = pageResolver$1 == null ? void 0 : pageResolver$1.peek(type)) == null ? void 0 : _a2.context) ?? null;
  }
  function possibleComponentNames(type) {
    const origin = pageResolver$1 == null ? void 0 : pageResolver$1.peek(type);
    if ((origin == null ? void 0 : origin.status) !== "ambiguous" || ownName(type)) return [];
    const names = /* @__PURE__ */ new Set();
    for (const candidate of origin.candidates ?? []) if (candidate.name) names.add(candidate.name);
    return Array.from(names);
  }
  function resolveComponentOrigin(type) {
    return pageComponentOrigins().resolve(type);
  }
  const FORWARD_REF = Symbol.for("react.forward_ref");
  const MEMO = Symbol.for("react.memo");
  const MAX_WRAPPERS = 4;
  function wrappedComponentOf(type) {
    if (!type || typeof type !== "object") return null;
    const wrapper = type;
    if (wrapper.$$typeof === FORWARD_REF) return wrapper.render ?? null;
    if (wrapper.$$typeof === MEMO) return wrapper.type ?? null;
    return null;
  }
  function ownString(value, key) {
    if (!value || typeof value !== "object" && typeof value !== "function") return null;
    const named = value[key];
    return typeof named === "string" && named !== "" ? named : null;
  }
  function ownName(value) {
    let current = value;
    for (let depth = 0; current && depth <= MAX_WRAPPERS; depth += 1) {
      const explicit = ownString(current, "displayName");
      if (explicit) return explicit;
      current = wrappedComponentOf(current);
    }
    return null;
  }
  function runtimeName$1(value) {
    let current = value;
    for (let depth = 0; current && depth <= MAX_WRAPPERS; depth += 1) {
      const name = ownString(current, "name");
      if (name) return name;
      current = wrappedComponentOf(current);
    }
    return null;
  }
  function readComponentName(type) {
    if (!type) return null;
    if (typeof type === "string") return type;
    if (typeof type !== "object" && typeof type !== "function") return null;
    const explicit = ownName(type);
    if (explicit) return explicit;
    const recovered = recoveredComponentName(type);
    if (recovered) return recovered;
    return runtimeName$1(type);
  }
  function minifiedComponentName(type) {
    const origin = pageResolver$1 == null ? void 0 : pageResolver$1.peek(type);
    if (!(origin == null ? void 0 : origin.name) || ownName(type)) return null;
    return origin.generatedName && origin.generatedName !== origin.name ? origin.generatedName : null;
  }
  function applyRecoveredOrigin(entry, type) {
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
  function needsComponentOrigin(fiber) {
    if (!fiber || !componentFunctionOf(fiber.type)) return false;
    if (fiber._debugSource || fiber._debugStack || fiber._debugOwner) return false;
    const type = fiber.type;
    return !type._debugSource && !ownName(fiber.type);
  }
  async function warmComponentTypes(candidates, budgetMs = 3e3, resolver = pageComponentOrigins()) {
    const types = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const fn = componentFunctionOf(candidate);
      if (fn && !ownName(candidate) && !candidate._debugSource) types.add(fn);
    }
    if (types.size === 0) return null;
    const stats = { types: types.size, cached: 0, resolved: 0, named: 0, skipped: 0, byContext: 0, statuses: {} };
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
      if (origin.status === "resolved") stats.resolved += 1;
      if (origin.name) stats.named += 1;
    }
    return stats;
  }
  const MAX_CONTEXT_ANCESTORS = 16;
  const SAMPLE_FIBERS = 3;
  function definitionKey(definition) {
    return definition ? `${definition.fileName}:${definition.lineNumber}:${definition.columnNumber}` : "";
  }
  async function nameFromAncestors(fiber, origin, resolver, maxAncestors = MAX_CONTEXT_ANCESTORS) {
    if (origin.status !== "ambiguous" || origin.truncated) return null;
    const candidates = (origin.candidates ?? []).filter((candidate) => candidate.name);
    const wanted = new Set(candidates.map((candidate) => candidate.name));
    if (wanted.size === 0) return null;
    let distance = 0;
    for (let node = fiber.return; node && distance < maxAncestors; node = node.return) {
      if (!componentFunctionOf(node.type)) continue;
      distance += 1;
      const references = await resolver.references(node.type);
      if (!references) continue;
      const hits = Array.from(wanted).filter((name2) => references.has(name2));
      if (hits.length === 0) continue;
      if (hits.length > 1) return null;
      const name = hits[0];
      const matching = candidates.filter((candidate) => candidate.name === name);
      const sameDefinition = new Set(matching.map((candidate) => definitionKey(candidate.definition))).size === 1;
      const ancestor = resolver.peek(node.type);
      return {
        ...origin,
        status: "resolved",
        name,
        nameEvidence: "ancestor-reference",
        definition: sameDefinition ? matching[0].definition : null,
        script: matching[0].script,
        context: { name: (ancestor == null ? void 0 : ancestor.name) ?? "", definition: (ancestor == null ? void 0 : ancestor.definition) ?? null, distance }
      };
    }
    return null;
  }
  async function resolveFiberComponentOrigin(fiber, resolver = pageComponentOrigins()) {
    if (!fiber || !needsComponentOrigin(fiber)) return null;
    try {
      const origin = await resolver.resolve(fiber.type);
      const named = await nameFromAncestors(fiber, origin, resolver);
      if (!named) return origin;
      resolver.settle(fiber.type, named);
      return named;
    } catch {
      return null;
    }
  }
  async function warmComponentNames(walk2, budgetMs = 3e3, resolver = pageComponentOrigins()) {
    const deadline = Date.now() + budgetMs;
    const samples = /* @__PURE__ */ new Map();
    walk2((fiber) => {
      if (!needsComponentOrigin(fiber)) return;
      const fn = componentFunctionOf(fiber.type);
      const list = samples.get(fn);
      if (!list) samples.set(fn, [fiber]);
      else if (list.length < SAMPLE_FIBERS) list.push(fiber);
    });
    const stats = await warmComponentTypes(samples.keys(), budgetMs, resolver);
    if (!stats) return null;
    for (const [type, fibers] of samples) {
      const origin = resolver.peek(type);
      if ((origin == null ? void 0 : origin.status) !== "ambiguous") continue;
      for (const fiber of fibers) {
        if (Date.now() > deadline) return stats;
        const named = await nameFromAncestors(fiber, origin, resolver);
        if (!named) continue;
        resolver.settle(type, named);
        stats.byContext += 1;
        stats.named += 1;
        break;
      }
    }
    return stats;
  }
  function recordedLiteralPosition(code, source) {
    const column = source.columnNumber === null ? "" : `,\\s*columnNumber:\\s*${source.columnNumber}`;
    const literal = new RegExp(`lineNumber:\\s*${source.lineNumber}${column}(?!\\d)`, "g");
    const first = literal.exec(code);
    if (first === null || literal.exec(code) !== null) return null;
    const before = code.slice(0, first.index);
    const lineStart = before.lastIndexOf("\n");
    return { line: before.split("\n").length, column: first.index - lineStart };
  }
  function decodedPath(pathname) {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }
  function slashPath(fileName) {
    return fileName.replace(/\\/g, "/");
  }
  function servedModuleUrls(fileName, page) {
    const file = slashPath(fileName);
    const matches2 = /* @__PURE__ */ new Map();
    for (const raw of page.resourceUrls) {
      let url;
      try {
        url = new URL(raw, page.origin);
      } catch {
        continue;
      }
      if (url.origin !== page.origin) continue;
      const path = decodedPath(url.pathname).replace(/^\/@fs(?=\/)/, "");
      const tail = /^\/[A-Za-z]:\//.test(path) && /^[A-Za-z]:\//.test(file) ? path.slice(1) : path;
      if (tail.length < 2 || !file.endsWith(tail)) continue;
      matches2.set(tail, { url: url.href, length: tail.length });
    }
    const ranked = [...matches2.values()].sort((a, b) => b.length - a.length).map((entry) => entry.url);
    if (page.vite && (file.startsWith("/") || /^[A-Za-z]:\//.test(file))) {
      const fsUrl = new URL(`/@fs${file.startsWith("/") ? "" : "/"}${file}`, page.origin).href;
      if (!ranked.includes(fsUrl)) ranked.push(fsUrl);
    }
    return ranked;
  }
  function readPageModules() {
    var _a2, _b2, _c2, _d2;
    const scope = globalThis;
    const origin = (_a2 = scope.location) == null ? void 0 : _a2.origin;
    if (!origin || origin === "null") return null;
    const resourceUrls = [];
    for (const script of Array.from(((_b2 = scope.document) == null ? void 0 : _b2.scripts) ?? [])) {
      if (script.src) resourceUrls.push(script.src);
    }
    try {
      for (const entry of ((_d2 = (_c2 = scope.performance) == null ? void 0 : _c2.getEntriesByType) == null ? void 0 : _d2.call(_c2, "resource")) ?? []) resourceUrls.push(entry.name);
    } catch {
    }
    const vite = resourceUrls.some((url) => url.includes("/@vite/client"));
    return { origin, resourceUrls, vite };
  }
  function pageModuleUrls(fileName) {
    const page = readPageModules();
    return page ? servedModuleUrls(fileName, page) : [];
  }
  function baseName(path) {
    const clean = slashPath(path).replace(/[?#].*$/, "");
    return clean.slice(clean.lastIndexOf("/") + 1);
  }
  const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const AT_FRAME = /^\s*(?:(.*?)@)(.+?):(\d+):(\d+)$/;
  const MAX_CALL_SITE_FRAMES = 4;
  const resolvedFiberSources = /* @__PURE__ */ new WeakMap();
  const pendingFiberSources = /* @__PURE__ */ new WeakMap();
  let defaultResolver = null;
  function parseStackFrames$1(stack) {
    const frames = [];
    for (const raw of stack.split("\n")) {
      const line = raw.trimEnd();
      if (line === "" || line.includes("(eval at ")) continue;
      const match = V8_FRAME.exec(line) ?? AT_FRAME.exec(line);
      if (!match) continue;
      const [, name, url = "", lineDigits = "", columnDigits = ""] = match;
      if (url === "" || url.startsWith("data:")) continue;
      const at2 = Number(lineDigits);
      const column = Number(columnDigits);
      if (!Number.isFinite(at2) || !Number.isFinite(column) || at2 < 1) continue;
      frames.push({
        url,
        line: at2,
        column,
        ...name !== void 0 && name !== "" ? { function: name } : {}
      });
    }
    return frames;
  }
  function isVendorPath(path) {
    return path.includes("node_modules") || path.includes("/.vite/deps/") || path.includes("/.yarn/");
  }
  function rawLocation(frame2) {
    return { fileName: frame2.url, lineNumber: frame2.line, columnNumber: frame2.column };
  }
  function locationFromOriginal(original) {
    return { fileName: original.source, lineNumber: original.line, columnNumber: original.column };
  }
  function writerLocationOf(frames, originalFor) {
    for (const frame2 of frames) {
      if (isVendorPath(frame2.url)) continue;
      const original = originalFor(frame2);
      if (original === null) return rawLocation(frame2);
      if (isVendorPath(original.source)) continue;
      return locationFromOriginal(original);
    }
    return null;
  }
  function createCallSiteResolver(fetchModule, moduleUrlsFor = () => []) {
    const modules = createModuleMapCache(fetchModule);
    const sites = /* @__PURE__ */ new Map();
    const recordedSites = /* @__PURE__ */ new Map();
    const stats = {
      get modules() {
        return modules.stats.modules;
      },
      sites: 0,
      located: 0
    };
    const mapsFor = (url) => modules.forUrl(url);
    async function locateFrame(frame2) {
      const parsed = await mapsFor(frame2.url);
      if (!parsed || parsed.maps.length === 0) return null;
      const original = originalPositionFor(parsed.maps, frame2.line, frame2.column);
      if (!original) return null;
      return {
        fileName: sourcePath(original.source, parsed.sourceBaseUrl),
        lineNumber: original.line,
        columnNumber: original.column
      };
    }
    async function locate(frames) {
      for (const frame2 of frames) {
        if (isVendorPath(frame2.url)) continue;
        const key = `${frame2.url}:${frame2.line}:${frame2.column}`;
        let answer = sites.get(key);
        if (!answer) {
          stats.sites += 1;
          answer = locateFrame(frame2);
          sites.set(key, answer);
        }
        const located = await answer;
        const chosen = located === null ? writerLocationOf([frame2], () => null) : isVendorPath(located.fileName) ? null : located;
        if (chosen) {
          stats.located += 1;
          return chosen;
        }
      }
      return null;
    }
    async function correctRecorded(source) {
      for (const url of moduleUrlsFor(source.fileName)) {
        const parsed = await mapsFor(url);
        if (!parsed || parsed.maps.length === 0) continue;
        const served = recordedLiteralPosition(parsed.code, source);
        if (served === null) continue;
        const original = originalPositionFor(parsed.maps, served.line, served.column);
        if (!original || baseName(original.source) !== baseName(source.fileName)) continue;
        return { fileName: source.fileName, lineNumber: original.line, columnNumber: original.column };
      }
      return source;
    }
    function locateRecorded(source) {
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
  function debugSourceOf(value) {
    if (!value || typeof value !== "object") return null;
    const source = value;
    if (typeof source.fileName !== "string" || typeof source.lineNumber !== "number") return null;
    return {
      fileName: source.fileName,
      lineNumber: source.lineNumber,
      columnNumber: typeof source.columnNumber === "number" ? source.columnNumber : null
    };
  }
  function recordedSource(fiber) {
    const direct = debugSourceOf(fiber._debugSource);
    if (direct) return direct;
    const type = fiber.type;
    return type && (typeof type === "object" || typeof type === "function") ? debugSourceOf(type._debugSource) : null;
  }
  function getFiberStackFrames(fiber) {
    if (!fiber || !fiber._debugStack || typeof fiber._debugStack !== "object") return [];
    const stack = fiber._debugStack.stack;
    if (typeof stack !== "string" || stack === "") return [];
    const candidates = [];
    for (const frame2 of parseStackFrames$1(stack)) {
      if (isVendorPath(frame2.url)) continue;
      candidates.push(frame2);
      if (candidates.length >= MAX_CALL_SITE_FRAMES) break;
    }
    return candidates;
  }
  function getFiberSourceCandidate(fiber) {
    if (!fiber) return null;
    const recorded = recordedSource(fiber);
    if (recorded) return recorded;
    return writerLocationOf(getFiberStackFrames(fiber), () => null);
  }
  function getFiberSource$2(fiber) {
    if (!fiber) return null;
    const cached = resolvedFiberSources.get(fiber);
    if (cached !== void 0) return cached;
    return getFiberSourceCandidate(fiber);
  }
  function pageResolver() {
    if (!defaultResolver) defaultResolver = createCallSiteResolver(fetchModuleFromPage, pageModuleUrls);
    return defaultResolver;
  }
  function resolveFiberSource$1(fiber, resolver = pageResolver()) {
    if (!fiber) return Promise.resolve(null);
    const cached = pendingFiberSources.get(fiber);
    if (cached) return cached;
    const recorded = recordedSource(fiber);
    if (recorded) {
      const pending2 = resolver.locateRecorded(recorded).then((located) => {
        resolvedFiberSources.set(fiber, located);
        return located;
      });
      pendingFiberSources.set(fiber, pending2);
      return pending2;
    }
    const frames = getFiberStackFrames(fiber);
    const fallback = writerLocationOf(frames, () => null);
    const origin = frames.length === 0 ? resolveFiberComponentOrigin(fiber) : Promise.resolve(null);
    const pending = Promise.all([resolver.locate(frames), origin]).then(([source]) => source).catch(() => null).then((source) => {
      const located = source ?? fallback;
      resolvedFiberSources.set(fiber, located);
      return located;
    });
    pendingFiberSources.set(fiber, pending);
    return pending;
  }
  const UNNAMED_COMPONENT = "Anonymous";
  function createRenderedNames(deps) {
    let unnamed = /* @__PURE__ */ new Set();
    let renamed = /* @__PURE__ */ new Map();
    let walkedThrough = -Infinity;
    function note(entry) {
      if (entry.name === UNNAMED_COMPONENT) unnamed.add(entry.sourceId);
    }
    function unnamedTypes() {
      const types = /* @__PURE__ */ new Set();
      for (const sourceId of unnamed) {
        const type = deps.typeOf(sourceId);
        if (type !== null) types.add(type);
      }
      return Array.from(types);
    }
    function namedSinceRecorded() {
      const named = /* @__PURE__ */ new Map();
      for (const sourceId of unnamed) {
        const type = deps.typeOf(sourceId);
        if (type === null) continue;
        const name = deps.nameOf(type);
        if (name !== UNNAMED_COMPONENT) named.set(sourceId, name);
      }
      return named;
    }
    function newlyRenamed() {
      const fresh = /* @__PURE__ */ new Map();
      for (const type of deps.types()) {
        if (renamed.has(type)) continue;
        const minifiedName = deps.minifiedNameOf(type);
        if (!minifiedName) continue;
        const rename = { name: deps.nameOf(type), minifiedName };
        fresh.set(type, rename);
        renamed.set(type, rename);
      }
      return fresh;
    }
    function refresh(byCommit) {
      const anonymous = unnamed.size > 0 ? namedSinceRecorded() : /* @__PURE__ */ new Map();
      const fresh = newlyRenamed();
      if (anonymous.size === 0 && fresh.size === 0 && renamed.size === 0) return 0;
      let changed = 0;
      let latest = walkedThrough;
      for (const [key, entries] of Object.entries(byCommit)) {
        const commitId = Number(key);
        if (commitId > latest) latest = commitId;
        const recent = commitId > walkedThrough;
        const table = recent ? renamed : fresh;
        if (anonymous.size === 0 && table.size === 0) continue;
        for (const entry of entries) {
          const name = anonymous.get(entry.sourceId);
          if (name !== void 0 && entry.name === UNNAMED_COMPONENT) {
            entry.name = name;
            changed += 1;
          }
          if (table.size === 0) continue;
          const type = deps.typeOf(entry.sourceId);
          const rename = type === null ? void 0 : table.get(type);
          if (rename && entry.minifiedName !== rename.minifiedName) {
            entry.name = rename.name;
            entry.minifiedName = rename.minifiedName;
            changed += 1;
          }
        }
      }
      walkedThrough = latest;
      for (const sourceId of anonymous.keys()) unnamed.delete(sourceId);
      return changed;
    }
    function renames() {
      return Array.from(renamed.values());
    }
    function reset() {
      unnamed = /* @__PURE__ */ new Set();
      renamed = /* @__PURE__ */ new Map();
      walkedThrough = -Infinity;
    }
    return { note, unnamedTypes, refresh, renames, reset };
  }
  const PerformedWork = 1;
  const Placement = 2;
  const Hydrating = 4096;
  const COMPONENT_TAGS = /* @__PURE__ */ new Set([0, 1, 2, 11, 14, 15]);
  const CONTEXT_PROVIDER_TAG = 10;
  const SuspenseTag = 13;
  const ChildDeletion = 16;
  const Update = 4;
  function isComponentFiber$1(tag) {
    return COMPONENT_TAGS.has(tag);
  }
  function isContextProviderFiber(tag) {
    return tag === CONTEXT_PROVIDER_TAG;
  }
  function isSuspenseFiber(tag) {
    return tag === SuspenseTag;
  }
  function didSuspenseStateChange(fiber) {
    const currSuspended = fiber.memoizedState !== null;
    if (!fiber.alternate) {
      if (currSuspended) {
        return { entered: true, left: false };
      }
      return null;
    }
    const prevSuspended = fiber.alternate.memoizedState !== null;
    if (prevSuspended === currSuspended) return null;
    return { entered: currSuspended, left: prevSuspended };
  }
  function didContextValueChange(fiber) {
    if (fiber.tag !== CONTEXT_PROVIDER_TAG || !fiber.alternate) return false;
    const alternateFiber = fiber.alternate;
    const currentFiber = fiber;
    const prevProps = alternateFiber.memoizedProps;
    const currentProps = currentFiber.memoizedProps;
    return prevProps && currentProps && !Object.is(prevProps.value, currentProps.value);
  }
  function isReactInternalComponentType(type) {
    return typeof type === "symbol";
  }
  function getComponentName(fiber) {
    const named = readComponentName(fiber.type) || readComponentName(fiber.elementType);
    if (named) return named;
    const source = getFiberSourceCandidate(fiber);
    return source && `<${source.fileName}:${source.lineNumber}>` || UNNAMED_COMPONENT;
  }
  function isStateHook(hook) {
    const queue = hook.queue;
    if (!queue) return false;
    return typeof queue.dispatch === "function" || "value" in queue && "getSnapshot" in queue;
  }
  function isExternalStoreHook(hook) {
    const queue = hook.queue;
    return queue && typeof queue.dispatch !== "function" && "value" in queue && "getSnapshot" in queue;
  }
  function detectHookStateChanges(prevHookChain, currentHookChain) {
    var _a2, _b2;
    if (prevHookChain === currentHookChain) {
      return {
        hasChange: false,
        actionable: false,
        changedIndices: [],
        changedHooks: [],
        hasExternalStoreChange: false
      };
    }
    let prevHook = prevHookChain;
    let currentHook = currentHookChain;
    let memoizedStateIndex = 0;
    const changedIndices = [];
    const changedHooks = [];
    let hasExternalStoreChange = false;
    while (prevHook && currentHook) {
      if (isStateHook(currentHook)) {
        const prevValueRaw = prevHook.memoizedState === void 0 ? (_a2 = prevHook.queue) == null ? void 0 : _a2.lastRenderedState : prevHook.memoizedState;
        const curValueRaw = currentHook.memoizedState === void 0 ? (_b2 = currentHook.queue) == null ? void 0 : _b2.lastRenderedState : currentHook.memoizedState;
        if (!Object.is(prevValueRaw, curValueRaw)) {
          const isExternal = isExternalStoreHook(currentHook);
          if (isExternal) hasExternalStoreChange = true;
          changedIndices.push(memoizedStateIndex);
          changedHooks.push({
            prevValue: prevValueRaw,
            currentValue: curValueRaw,
            ...isExternal && { isExternalStore: true }
          });
        }
      }
      prevHook = prevHook.next;
      currentHook = currentHook.next;
      memoizedStateIndex++;
    }
    return {
      hasChange: changedIndices.length > 0,
      actionable: changedIndices.length > 0,
      changedIndices,
      changedHooks,
      hasExternalStoreChange
    };
  }
  function detectHookThrashing(prevHookChain, currentHookChain, mode = "non-primitive", valueProvenance = null) {
    if (prevHookChain === currentHookChain) {
      return { effects: [], callbacks: [], memos: [] };
    }
    const thrashedEffects = [];
    const thrashedCallbacks = [];
    const thrashedMemos = [];
    let prevHook = prevHookChain;
    let currentHook = currentHookChain;
    let hookIndex = 0;
    while (prevHook && currentHook) {
      if (!isStateHook(currentHook)) {
        const prevValue = prevHook.memoizedState;
        const currentValue = currentHook.memoizedState;
        let prevDeps = null;
        let currentDeps = null;
        let hookType = null;
        if (prevValue && currentValue && typeof prevValue === "object" && typeof currentValue === "object" && "deps" in prevValue && "deps" in currentValue && "tag" in currentValue) {
          prevDeps = prevValue.deps;
          currentDeps = currentValue.deps;
          hookType = "effect";
        } else if (Array.isArray(prevValue) && Array.isArray(currentValue) && prevValue.length === 2 && currentValue.length === 2 && Array.isArray(prevValue[1]) && Array.isArray(currentValue[1])) {
          prevDeps = prevValue[1];
          currentDeps = currentValue[1];
          hookType = typeof currentValue[0] === "function" ? "callback" : "memo";
        }
        if (hookType && Array.isArray(prevDeps) && Array.isArray(currentDeps)) {
          const changedDepIndices = [];
          const changedDepOrigins = [];
          for (let j = 0; j < currentDeps.length; j++) {
            if (!Object.is(prevDeps[j], currentDeps[j])) {
              changedDepIndices.push(j);
              let origin = null;
              const dep = currentDeps[j];
              if (valueProvenance && dep != null && (typeof dep === "object" || typeof dep === "function")) {
                origin = valueProvenance.get(dep) || null;
              }
              changedDepOrigins.push(origin);
            }
          }
          let shouldReport = changedDepIndices.length > 0;
          if (shouldReport && mode === "non-primitive") {
            shouldReport = changedDepIndices.some((idx) => {
              const dep = currentDeps[idx];
              const t = typeof dep;
              return !(dep == null || t === "string" || t === "number" || t === "boolean" || t === "symbol" || t === "bigint");
            });
          }
          if (shouldReport) {
            const thrashInfo = {
              hookIndex,
              hookType,
              deps: currentDeps,
              changedDepIndices,
              changedDepOrigins
            };
            if (hookType === "effect") {
              const effectValue = currentValue;
              thrashInfo.effectTag = effectValue.tag;
              if (effectValue.create) {
                thrashInfo.hookBody = effectValue.create;
              }
              thrashedEffects.push(thrashInfo);
            } else if (hookType === "callback") {
              const callbackFn = currentValue[0];
              thrashInfo.hookBody = callbackFn;
              thrashedCallbacks.push(thrashInfo);
            } else {
              const memoValue = currentValue[0];
              thrashInfo.memoValue = memoValue;
              thrashInfo.hookBody = memoValue;
              thrashedMemos.push(thrashInfo);
            }
          }
        }
      }
      prevHook = prevHook.next;
      currentHook = currentHook.next;
      hookIndex++;
    }
    return {
      effects: thrashedEffects,
      callbacks: thrashedCallbacks,
      memos: thrashedMemos
    };
  }
  function didFiberUpdate(fiber) {
    return (fiber.flags & PerformedWork) !== 0;
  }
  function didFiberSelfUpdate(fiber) {
    if (!didFiberUpdate(fiber)) return null;
    const alt = fiber.alternate;
    if (!alt) return null;
    const prevState = alt.memoizedState;
    const currentState = fiber.memoizedState;
    const result = detectHookStateChanges(prevState, currentState);
    return result.hasChange ? result : null;
  }
  function isDevelopment() {
    return false;
  }
  const MAX_SPANS = 200;
  const spans = [];
  function noteOwnWork(start, end, label = "") {
    const from = Number(start);
    const to = Number(end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
    spans.push({ start: Math.round(from * 10) / 10, end: Math.round(to * 10) / 10, label: String(label).slice(0, 60) });
    if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
  }
  function ownWorkSince(since = -Infinity) {
    return spans.filter((span) => span.end >= since);
  }
  function isOwnFrame(frame2, own) {
    const scripts = frame2.scripts ?? [];
    const pageScriptMs = scripts.reduce((sum, script) => sum + (script.chippy ? 0 : script.duration || 0), 0);
    if (pageScriptMs * 2 >= frame2.duration) return false;
    if (scripts.some((script) => script.chippy)) return true;
    const from = frame2.startTime;
    const to = frame2.startTime + frame2.duration;
    return !!(own == null ? void 0 : own.some((span) => span.start < to && span.end > from));
  }
  const CS_RESTARTS = 2;
  const CS_UNMOUNTED_COMPONENTS = 8;
  const CS_UNMOUNTED_SUBTREES = 9;
  const MAX_DEPTH$1 = 2;
  const MAX_ENTRIES = 8;
  const MAX_STRING$1 = 200;
  function cut$1(text) {
    return text.length > MAX_STRING$1 ? text.slice(0, MAX_STRING$1) + `…(${text.length})` : text;
  }
  function constructorName(value) {
    try {
      const proto = Object.getPrototypeOf(value);
      const name = proto && proto.constructor && proto.constructor.name;
      return typeof name === "string" && name ? name : "Object";
    } catch {
      return "Object";
    }
  }
  function elementTypeName(type) {
    if (typeof type === "string") return type;
    if (typeof type === "function") return type.displayName || type.name || "Anonymous";
    if (type && typeof type === "object") {
      const t = type;
      if (t.displayName) return t.displayName;
      if (t.render && t.render.name) return t.render.name;
      if (t.type) return elementTypeName(t.type);
    }
    return "Unknown";
  }
  function opaqueMarker(value) {
    const node = value;
    if (typeof node.nodeType === "number" && typeof node.nodeName === "string") {
      return `[${constructorName(value)} ${String(node.nodeName).toLowerCase()}]`;
    }
    const element = value;
    if (typeof element.$$typeof === "symbol") {
      return `[ReactElement ${elementTypeName(element.type)}]`;
    }
    const fiber = value;
    if (typeof fiber.tag === "number" && "stateNode" in fiber && "return" in fiber && "memoizedProps" in fiber) {
      return "[Fiber]";
    }
    if (typeof value.then === "function") return "[Promise]";
    if (value instanceof Map) return `[Map(${value.size})]`;
    if (value instanceof Set) return `[Set(${value.size})]`;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[Date invalid]" : value.toISOString();
    if (value instanceof RegExp) return cut$1(String(value));
    if (value instanceof Error) return cut$1(`[${value.name}: ${value.message}]`);
    if (ArrayBuffer.isView(value)) return `[${constructorName(value)}]`;
    return null;
  }
  function copy(value, depth, seen) {
    if (value === null) return null;
    switch (typeof value) {
      case "undefined":
        return void 0;
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) ? value : String(value);
      case "string":
        return cut$1(value);
      case "bigint":
        return `${String(value)}n`;
      case "symbol":
        return cut$1(String(value));
      case "function":
        return `[Function ${value.name || "anonymous"}]`;
    }
    const object = value;
    if (seen.has(object)) return "[Circular]";
    let marker;
    try {
      marker = opaqueMarker(object);
    } catch {
      return `[${constructorName(object)}]`;
    }
    if (marker !== null) return marker;
    if (Array.isArray(object)) {
      if (depth >= MAX_DEPTH$1) return `[Array(${object.length})]`;
      seen.add(object);
      const items = object.slice(0, MAX_ENTRIES).map((item) => {
        const next = copy(item, depth + 1, seen);
        return next === void 0 ? null : next;
      });
      if (object.length > MAX_ENTRIES) items.push(`…(${object.length - MAX_ENTRIES} more)`);
      seen.delete(object);
      return items;
    }
    let keys;
    try {
      keys = Object.keys(object);
    } catch {
      return `[${constructorName(object)}]`;
    }
    const name = constructorName(object);
    if (depth >= MAX_DEPTH$1) return `[${name}(${keys.length} keys)]`;
    seen.add(object);
    const out = {};
    for (const key of keys.slice(0, MAX_ENTRIES)) {
      let item;
      try {
        item = object[key];
      } catch {
        item = "[Unreadable]";
      }
      out[key] = copy(item, depth + 1, seen);
    }
    if (keys.length > MAX_ENTRIES) out["…"] = `${keys.length - MAX_ENTRIES} more keys`;
    seen.delete(object);
    return out;
  }
  function toWireValue(value) {
    return copy(value, 0, /* @__PURE__ */ new WeakSet());
  }
  function wireTrashers(hooks) {
    return hooks.map((hook) => ({
      index: hook.index,
      prevValue: toWireValue(hook.prevValue),
      currentValue: toWireValue(hook.currentValue)
    }));
  }
  function serializeReport(report) {
    const sources = report.sources.map((source) => ({
      sourceId: source.sourceId,
      depth: source.depth,
      causedUpdates: source.causedUpdates,
      collateralUpdates: source.collateralUpdates,
      maxCollateralUpdates: source.maxCollateralUpdates,
      maxPenetrationDepth: source.maxPenetrationDepth,
      ...source.restartWaste !== void 0 && { restartWaste: source.restartWaste },
      ...source.maxRestartWaste !== void 0 && { maxRestartWaste: source.maxRestartWaste }
    }));
    const sourcesByCommit = report.sourcesByCommit ? Object.fromEntries(
      Object.entries(report.sourcesByCommit).map(([commitId, commitSources]) => [
        commitId,
        commitSources.map((src) => ({
          sourceId: src.sourceId,
          depth: src.depth,
          collateral: src.collateral,
          rank: src.rank,
          sourceIndex: src.sourceIndex,
          ...(src.trashers || src.hooks) && { trashers: wireTrashers(src.trashers || src.hooks) },
          ...src.isRepeat && { isRepeat: true }
        }))
      ])
    ) : void 0;
    const suspenseByCommit = {};
    if (report.suspenseByCommit) {
      for (const [k, evts] of Object.entries(report.suspenseByCommit)) {
        suspenseByCommit[Number(k)] = evts.map((e) => ({
          depth: e.depth,
          ...typeof e.boundary === "number" && { boundary: e.boundary },
          entered: e.entered,
          left: e.left,
          ...e.location && { location: e.location }
        }));
      }
    }
    return {
      meta: report.meta,
      sources,
      commitStats: report.commitStats,
      suspenseByCommit,
      ...sourcesByCommit && { sourcesByCommit },
      ...report.interactionsByCommit && { interactionsByCommit: report.interactionsByCommit },
      ...report.renderedByCommit && { renderedByCommit: report.renderedByCommit },
      ...report.metricsByCommit && { metricsByCommit: report.metricsByCommit },
      ...report.commitTimings && { commitTimings: report.commitTimings },
      ...report.networkRequests && { networkRequests: report.networkRequests.map((request) => ({ ...request })) },
      ...report.perfEntries && { perfEntries: report.perfEntries.map((entry) => ({ ...entry })) },
      ...report.screenByCommit && { screenByCommit: report.screenByCommit },
      ...report.domByCommit && { domByCommit: report.domByCommit },
      ...report.hooks && { hooks: report.hooks }
    };
  }
  let active$1 = null;
  const REQUIRED_METHODS = ["isAvailable", "snapshot", "measure", "attach", "isAttached", "reattach", "detach"];
  function registerCommitMetricsAdapter(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id) {
      throw new TypeError("registerCommitMetricsAdapter expects an adapter with a non-empty id");
    }
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== "function") {
        throw new TypeError(`commit metrics adapter ${adapter.id} is missing ${method}()`);
      }
    }
    active$1 = adapter;
    return () => {
      if (active$1 === adapter) active$1 = null;
    };
  }
  function getCommitMetricsAdapter() {
    return active$1;
  }
  function runPrePageHooks(config) {
    const adapter = active$1;
    if (!adapter || typeof adapter.prePage !== "function") return null;
    try {
      adapter.prePage(config);
      return adapter.id;
    } catch {
      return null;
    }
  }
  function adapterIdFromMode(mode) {
    return typeof mode === "string" && mode.startsWith("adapter:") ? mode.slice("adapter:".length) : null;
  }
  function isTrueSource(s) {
    const commits = Object.values(s.updateHistory);
    if (commits.length === 0) return false;
    for (let i = 0; i < commits.length; i++) {
      const entry = commits[i];
      if (!entry || entry === "repeat") ;
      else if (typeof entry === "object" && entry !== null) {
        if (Object.values(entry).some((hook) => hook !== "repeat")) {
          return true;
        }
      }
    }
    return false;
  }
  function humanSourceId(internalId, type, depth) {
    const componentName = getComponentName({ type });
    const match = internalId.match(/#(\d+)@/);
    const instanceNum = match ? match[1] : "1";
    return `${componentName}#${instanceNum}@${depth}`;
  }
  function buildReport(state2, thrashMode, topN, sortBy, options = {}, detectorConfig) {
    const { minCollateral = 1 } = options;
    const toHumanReadableId = humanSourceId;
    const idMapping = /* @__PURE__ */ new Map();
    const allSources = Array.from(state2.sources.entries()).map(([internalId, s]) => {
      const humanId = toHumanReadableId(internalId, s.type, s.depth);
      idMapping.set(internalId, humanId);
      return {
        sourceId: humanId,
        ...s,
        maxPenetrationDepth: Math.max(0, s.maxPenetrationDepth - s.depth),
        // Convert to relative depth (never negative!)
        // Initialize restart waste tracking
        restartWaste: 0,
        maxRestartWaste: 0,
        restartWasteByCommit: {}
      };
    }).filter(isTrueSource);
    Object.entries(state2.commitStats).forEach(([commitIdStr, stats]) => {
      const commitId = Number(commitIdStr);
      const restarts = stats[CS_RESTARTS];
      if (restarts === 0) return;
      const sourcesInCommit = allSources.filter(
        (source) => source.updateHistory[commitId] !== void 0
      );
      if (sourcesInCommit.length === 0) {
        return;
      }
      const restartsPerSource = restarts / sourcesInCommit.length;
      for (const sourceItem of sourcesInCommit) {
        sourceItem.restartWaste += restartsPerSource;
        sourceItem.restartWasteByCommit[commitId] = restartsPerSource;
        if (restartsPerSource > sourceItem.maxRestartWaste) {
          sourceItem.maxRestartWaste = restartsPerSource;
        }
      }
    });
    if (thrashMode === "full") {
      for (const sourceItem of allSources) {
        const amplifiedByThisSource = [];
        state2.amplifierSources.forEach((amplifierData, amplifierInternalId) => {
          const amplifierHumanId = idMapping.get(amplifierInternalId) || toHumanReadableId(amplifierInternalId, amplifierData.type, amplifierData.depth);
          const causedByHumanId = amplifierData.causedBySourceId ? idMapping.get(amplifierData.causedBySourceId) : null;
          if (causedByHumanId === sourceItem.sourceId || amplifierHumanId === sourceItem.sourceId) {
            amplifiedByThisSource.push({
              sourceId: amplifierHumanId,
              type: amplifierData.type,
              depth: amplifierData.depth,
              effectCount: amplifierData.effectCount,
              callbackCount: amplifierData.callbackCount,
              memoCount: amplifierData.memoCount,
              hooksTotal: amplifierData.hooksTotal,
              commitIds: amplifierData.commitIds,
              byCommit: amplifierData.byCommit,
              lastAmplification: amplifierData.lastAmplification
            });
          }
        });
        if (amplifiedByThisSource.length > 0) {
          sourceItem.amplified = amplifiedByThisSource;
        }
      }
    }
    const sources = [...allSources].sort((a, b) => {
      const aTotalWaste = a.collateralUpdates + (a.restartWaste || 0);
      const bTotalWaste = b.collateralUpdates + (b.restartWaste || 0);
      return bTotalWaste - aTotalWaste || b.maxCollateralUpdates - a.maxCollateralUpdates || (b.maxRestartWaste || 0) - (a.maxRestartWaste || 0);
    }).slice(0, topN);
    const coverage = state2.commits > 0 ? Math.round(state2.commitsWithMemoizedUpdaters / state2.commits * 100) + "%" : "0%";
    const timingEntries = Object.values(state2.commitTimings);
    const totalDetectorOverhead = timingEntries.reduce((sum, t) => sum + t.detectorOverhead, 0);
    const totalTimeSpan = timingEntries.reduce((sum, t) => sum + t.timeSinceLastCommit, 0);
    const avgDetectorOverhead = timingEntries.length > 0 ? totalDetectorOverhead / timingEntries.length : 0;
    const avgTimeBetweenCommits = timingEntries.length > 0 ? totalTimeSpan / timingEntries.length : 0;
    const topNLookup = /* @__PURE__ */ new Map();
    for (let i = 0; i < sources.length; i++) {
      topNLookup.set(sources[i].sourceId, { rank: i + 1, index: i });
    }
    const sourcesByCommit = {};
    allSources.forEach((source) => {
      Object.entries(source.updateHistory).forEach(([commitIdStr, data]) => {
        var _a2;
        const commitId = Number(commitIdStr);
        if (typeof data === "string" && data !== "repeat") {
          return;
        }
        const collateral = ((_a2 = source.collateralByCommit) == null ? void 0 : _a2[commitId]) ?? 0;
        if (collateral < minCollateral) {
          return;
        }
        if (!sourcesByCommit[commitId]) {
          sourcesByCommit[commitId] = [];
        }
        const isRepeat = data === "repeat";
        let hookChanges;
        if (typeof data === "object" && data !== null) {
          hookChanges = Object.entries(data).map(([index, hookData]) => ({
            index: Number(index),
            prevValue: (
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              hookData !== "repeat" ? hookData.prevValue : void 0
            ),
            currentValue: hookData !== "repeat" ? (
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              hookData.currentValue
            ) : void 0
          }));
        }
        const lookup = topNLookup.get(source.sourceId);
        const rank = (lookup == null ? void 0 : lookup.rank) ?? null;
        const sourceIndex = (lookup == null ? void 0 : lookup.index) ?? null;
        const entry = {
          sourceId: source.sourceId,
          type: source.type,
          depth: source.depth,
          collateral,
          rank,
          sourceIndex
        };
        if (hookChanges && hookChanges.length > 0) {
          entry.hooks = hookChanges;
        }
        if (isRepeat) {
          entry.isRepeat = true;
        }
        sourcesByCommit[commitId].push(entry);
      });
    });
    const hasMetricsData = Object.keys(state2.metricsByCommit).length > 0;
    const integrationMode = (detectorConfig == null ? void 0 : detectorConfig.integrationMode) ?? "none";
    const metricsAdapter = adapterIdFromMode(integrationMode);
    const metricsAvailable = metricsAdapter !== null && hasMetricsData;
    const renderTicks = (detectorConfig == null ? void 0 : detectorConfig.renderTicks) ?? { available: false, sources: [], reason: "detector not installed" };
    const meta = {
      version: 9,
      // v9: perfEntries + meta.perf; v8: networkRequests + meta.network; v7: meta.timeOrigin, absolute commit and action timestamps
      timeOrigin: performance.timeOrigin,
      commits: state2.commits,
      config: {
        detectionLevel: (detectorConfig == null ? void 0 : detectorConfig.detectionLevel) ?? "full",
        effectThrashMode: (detectorConfig == null ? void 0 : detectorConfig.effectThrashMode) ?? "non-primitive",
        captureFibers: (detectorConfig == null ? void 0 : detectorConfig.captureFibers) ?? false,
        historySize: (detectorConfig == null ? void 0 : detectorConfig.historySize) ?? 1
      },
      memoizedUpdatersSupport: {
        available: state2.memoizedUpdatersAvailable,
        commitsWithData: state2.commitsWithMemoizedUpdaters,
        coverage
      },
      integrationMode,
      metricsAdapter,
      // Per-field availability — fiber-walk fields are always real measurements
      // because recordTree() runs in every mode. The only adapter-exclusive
      // datapoint is the render-counter delta (restarts, metricsByCommit).
      dataAvailability: {
        collateral: true,
        sources: true,
        restarts: metricsAvailable,
        performedWork: true,
        effects: true,
        memos: true,
        callbacks: true,
        contextUpdates: true,
        metricsByCommit: metricsAvailable,
        ticks: renderTicks.available
      },
      renderTicks,
      ...(detectorConfig == null ? void 0 : detectorConfig.renderedEvidence) && { renderedEvidence: detectorConfig.renderedEvidence },
      ...(detectorConfig == null ? void 0 : detectorConfig.domDiff) && { domDiff: detectorConfig.domDiff },
      ...(detectorConfig == null ? void 0 : detectorConfig.capture) && { capture: detectorConfig.capture },
      network: (detectorConfig == null ? void 0 : detectorConfig.network) ?? { supported: false, enabled: false, windowStart: 0, requests: 0, dropped: 0, ignoredOwn: 0, pausedAt: null },
      ...(detectorConfig == null ? void 0 : detectorConfig.perf) && { perf: detectorConfig.perf },
      timing: {
        totalDetectorOverhead,
        avgDetectorOverhead,
        totalTimeSpan,
        avgTimeBetweenCommits
      }
    };
    const base = {
      meta,
      sources,
      sourcesByCommit,
      commitStats: state2.commitStats,
      commitTimings: state2.commitTimings,
      suspenseByCommit: state2.suspenseByCommit,
      unmountsByCommit: state2.unmountsByCommit,
      interactionsByCommit: state2.interactionsByCommit,
      renderedByCommit: state2.renderedByCommit,
      networkRequests: state2.networkRequests.slice(),
      ...state2.perfEntries && { perfEntries: state2.perfEntries.slice() },
      ...ownWorkSince().length > 0 && { ownWork: ownWorkSince() },
      ...state2.screenByCommit && Object.keys(state2.screenByCommit).length > 0 && { screenByCommit: { ...state2.screenByCommit } },
      ...state2.domByCommit && Object.keys(state2.domByCommit).length > 0 && { domByCommit: { ...state2.domByCommit } },
      ...hasMetricsData && { metricsByCommit: state2.metricsByCommit },
      toSerializable() {
        return serializeReport(this);
      }
    };
    if (thrashMode === "full") {
      const getSortValue = (amplifier) => {
        if (sortBy === "effect") return amplifier.effectCount;
        if (sortBy === "callback") return amplifier.callbackCount;
        if (sortBy === "memo") return amplifier.memoCount;
        if (sortBy === "total") return amplifier.hooksTotal;
        return amplifier.effectCount;
      };
      const getLinkedSortValue = (as) => {
        if (sortBy === "effect") return as.effectCount;
        if (sortBy === "callback") return as.callbackCount;
        if (sortBy === "memo") return as.memoCount;
        if (sortBy === "total") return as.hooksTotal;
        return as.effectCount;
      };
      const amplifierSources = Array.from(state2.amplifierSources.entries()).map(([internalId, lt]) => {
        const humanId = idMapping.get(internalId) || toHumanReadableId(internalId, lt.type, lt.depth);
        const sourceData = state2.sources.get(internalId);
        return {
          sourceId: humanId,
          type: lt.type,
          depth: lt.depth,
          collateralUpdates: (sourceData == null ? void 0 : sourceData.collateralUpdates) ?? 0,
          effectCount: lt.effectCount,
          callbackCount: lt.callbackCount,
          memoCount: lt.memoCount,
          hooksTotal: lt.hooksTotal,
          commitIds: lt.commitIds,
          byCommit: lt.byCommit,
          causedBySourceId: lt.causedBySourceId ? idMapping.get(lt.causedBySourceId) || lt.causedBySourceId : null,
          lastAmplification: lt.lastAmplification
        };
      }).sort((a, b) => getLinkedSortValue(b) - getLinkedSortValue(a) || b.hooksTotal - a.hooksTotal).slice(0, topN);
      return {
        ...base,
        amplifiers: Array.from(state2.amplifiers.entries()).map(([type, s]) => ({ type, ...s })).sort(
          (a, b) => getSortValue(b) - getSortValue(a) || b.hooksTotal - a.hooksTotal || b.maxHooksPerCommit - a.maxHooksPerCommit
        ).slice(0, topN),
        amplifierSources
      };
    }
    if (thrashMode === "counts" && state2.thrashCounts) {
      meta.amplifiersMetrics = {
        totalHookThrashes: state2.thrashCounts.totalHooks,
        affectedComponentCount: state2.thrashCounts.affectedComponents.size
      };
    }
    return base;
  }
  function getReactRenderers(scope = globalThis) {
    const g = scope;
    const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook || !hook.renderers || typeof hook.renderers.entries !== "function") {
      return [];
    }
    const out = [];
    for (const [, renderer] of hook.renderers.entries()) {
      if (renderer) out.push(renderer);
    }
    return out;
  }
  function dispatcherSlotOf(injected) {
    if (!injected || typeof injected !== "object") return null;
    const owner2 = injected;
    if (typeof owner2.H !== "undefined") return { owner: owner2, key: "H" };
    if ("current" in owner2) return { owner: owner2, key: "current" };
    return null;
  }
  function getDispatcherSlot(scope = globalThis) {
    for (const renderer of getReactRenderers(scope)) {
      const slot = dispatcherSlotOf(renderer.currentDispatcherRef);
      if (slot) return slot;
    }
    return null;
  }
  const modernRefs = /* @__PURE__ */ new WeakMap();
  function dispatcherRefOf(slot) {
    if (slot.key === "current") return slot.owner;
    let ref = modernRefs.get(slot.owner);
    if (!ref) {
      const { owner: owner2 } = slot;
      ref = {
        get current() {
          return owner2.H;
        },
        set current(value) {
          owner2.H = value;
        }
      };
      modernRefs.set(owner2, ref);
    }
    return ref;
  }
  function getDispatcherRef(scope = globalThis) {
    const slot = getDispatcherSlot(scope);
    return slot ? dispatcherRefOf(slot) : null;
  }
  function getScheduleUpdate(scope = globalThis) {
    for (const renderer of getReactRenderers(scope)) {
      if (typeof renderer.scheduleUpdate === "function") return renderer.scheduleUpdate;
    }
    return null;
  }
  function parseStackLine(line) {
    const m = line.match(/^\s*at\s+([^\s(]+)\s*\(([^)]+)\)/) || line.match(/^\s*at\s+()(.+)$/);
    if (!m) return null;
    const name = (m[1] || "").trim();
    const locRaw = (m[2] || "").trim();
    const tail = locRaw.match(/:(\d+):(\d+)\)?$/);
    if (!name) return null;
    if (!tail) return { name, loc: locRaw };
    const url = locRaw.slice(0, tail.index);
    return url ? { name, loc: `${tail[1]}:${tail[2]}`, url } : { name, loc: `${tail[1]}:${tail[2]}` };
  }
  function parseStackFrames(stack) {
    return stack.split("\n").slice(1).map(parseStackLine).filter((f) => !!f);
  }
  const HOOK_METHODS = [
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "useId",
    "useCacheRefresh",
    "useMemoCache"
  ];
  const HOOK_PRIMITIVE = {
    useCallback: "Callback",
    useContext: "Context",
    useDebugValue: "DebugValue",
    useDeferredValue: "DeferredValue",
    useEffect: "Effect",
    useImperativeHandle: "ImperativeHandle",
    useInsertionEffect: "InsertionEffect",
    useLayoutEffect: "LayoutEffect",
    useMemo: "Memo",
    useReducer: "Reducer",
    useRef: "Ref",
    useState: "State",
    useSyncExternalStore: "SyncExternalStore",
    useTransition: "Transition",
    useId: "Id",
    useCacheRefresh: "CacheRefresh",
    useMemoCache: "MemoCache"
  };
  function isReactInternalFrameName(name) {
    return name === "atlDispatcherHook" || name === "record" || name.startsWith("Object.") || name === "renderWithHooks" || name === "updateFunctionComponent" || name === "mountIndeterminateComponent" || name === "beginWork" || /^beginWork\$/.test(name) || name === "performUnitOfWork" || name === "workLoopSync" || name === "renderRootSync" || name === "performConcurrentWorkOnRoot" || name === "workLoop" || name === "flushWork";
  }
  function isHookFrameName(name) {
    return /^use[A-Z0-9_]/.test(name.slice(name.lastIndexOf(".") + 1));
  }
  function deriveComponentName(frames) {
    const wrapper = frames.findIndex((frame2) => frame2.name === "atlDispatcherHook" || frame2.name.endsWith(".atlDispatcherHook"));
    for (const { name } of wrapper >= 0 ? frames.slice(wrapper + 1) : frames) {
      if (!name) continue;
      if (isReactInternalFrameName(name)) continue;
      if (isHookFrameName(name)) continue;
      return name;
    }
    return "Unknown";
  }
  const NAME_STACK_FRAMES = 8;
  function stackFrameCount(stack) {
    let count = 0;
    for (let i = stack.indexOf("\n"); i >= 0; i = stack.indexOf("\n", i + 1)) count++;
    return count;
  }
  const isWrapperFrame = (name) => name === "atlDispatcherHook" || name.endsWith(".atlDispatcherHook");
  const isComponentFrame = (name) => !!name && !isReactInternalFrameName(name) && !isHookFrameName(name);
  function deriveComponentNameFromStack(stack) {
    const seen = [];
    let afterWrapper = false;
    let start = stack.indexOf("\n");
    while (start >= 0) {
      const end = stack.indexOf("\n", start + 1);
      const frame2 = parseStackLine(stack.slice(start + 1, end < 0 ? void 0 : end));
      start = end;
      if (!frame2) continue;
      if (afterWrapper) {
        if (isComponentFrame(frame2.name)) return frame2.name;
      } else if (isWrapperFrame(frame2.name)) {
        afterWrapper = true;
      } else {
        seen.push(frame2);
      }
    }
    return afterWrapper ? "Unknown" : deriveComponentName(seen);
  }
  function currentFiberReader() {
    const readers = getReactRenderers().map((renderer) => renderer.getCurrentFiber).filter((read2) => typeof read2 === "function");
    return readers.length === 1 ? readers[0] : null;
  }
  function createDebugRender(options = {}) {
    const maxEventsPerComponent = options.maxEventsPerComponent ?? 600;
    const eventsByComponent = /* @__PURE__ */ new Map();
    const patchedDispatchers = /* @__PURE__ */ new WeakMap();
    let installed2 = false;
    let originalDescriptor = void 0;
    let dispatcherSlot = null;
    let lastSeenDispatcher = null;
    let renderSerial = 0;
    let currentFiber = null;
    const namesByType = /* @__PURE__ */ new WeakMap();
    let sequence = null;
    function renderingType() {
      var _a2;
      if (!currentFiber) return null;
      try {
        const type = (_a2 = currentFiber()) == null ? void 0 : _a2.type;
        return type && (typeof type === "function" || typeof type === "object") ? type : null;
      } catch (_) {
        return null;
      }
    }
    function record(primitive, args) {
      if ((sequence == null ? void 0 : sequence.serial) !== renderSerial) {
        const type = renderingType();
        let componentName2 = type ? namesByType.get(type) : void 0;
        let firstStack = null;
        if (componentName2 === void 0) {
          const previousLimit = Error.stackTraceLimit;
          let stack2;
          try {
            Error.stackTraceLimit = NAME_STACK_FRAMES;
            stack2 = new Error().stack || "";
          } finally {
            Error.stackTraceLimit = previousLimit;
          }
          let complete = stackFrameCount(stack2) < NAME_STACK_FRAMES;
          componentName2 = deriveComponentNameFromStack(stack2);
          if (componentName2 === "Unknown" && !complete) {
            stack2 = new Error().stack || "";
            complete = true;
            componentName2 = deriveComponentNameFromStack(stack2);
          }
          if (complete) firstStack = stack2;
          if (type && componentName2 !== "Unknown") namesByType.set(type, componentName2);
        }
        let list2 = eventsByComponent.get(componentName2);
        if (!list2) eventsByComponent.set(componentName2, list2 = []);
        sequence = { serial: renderSerial, componentName: componentName2, list: list2, position: 0, firstStack };
      }
      const position = sequence.position++;
      const { list, componentName } = sequence;
      if (position < list.length || position >= maxEventsPerComponent) return;
      const stack = position === 0 && sequence.firstStack || new Error().stack || "";
      let frames = null;
      list.push({
        primitive,
        stack,
        // Parsed on first read: most events are never inspected.
        get frames() {
          return frames ?? (frames = parseStackFrames(stack));
        },
        set frames(value) {
          frames = value;
        },
        componentName,
        args
      });
    }
    function patchDispatcher(dispatcher) {
      if (!dispatcher || typeof dispatcher !== "object") return;
      const obj = dispatcher;
      if (patchedDispatchers.has(obj)) return;
      const restoreMap = /* @__PURE__ */ new Map();
      for (const methodName of HOOK_METHODS) {
        const original = obj[methodName];
        if (typeof original !== "function") continue;
        restoreMap.set(methodName, original);
        const primitive = HOOK_PRIMITIVE[methodName] || methodName;
        obj[methodName] = function atlDispatcherHook(...args) {
          try {
            record(primitive, args);
          } catch (_) {
          }
          return original.apply(this, args);
        };
      }
      patchedDispatchers.set(obj, restoreMap);
    }
    function unpatchDispatcher(dispatcher) {
      if (!dispatcher || typeof dispatcher !== "object") return;
      const obj = dispatcher;
      const restoreMap = patchedDispatchers.get(obj);
      if (!restoreMap) return;
      for (const [methodName, fn] of restoreMap.entries()) {
        obj[methodName] = fn;
      }
      patchedDispatchers.delete(obj);
    }
    function install() {
      if (installed2) return { ok: true };
      const slot = getDispatcherSlot();
      if (!slot) return { ok: false, reason: "ReactCurrentDispatcher not found" };
      dispatcherSlot = slot;
      const { owner: owner2, key } = slot;
      currentFiber = currentFiberReader();
      patchDispatcher(owner2[key]);
      lastSeenDispatcher = owner2[key];
      originalDescriptor = Object.getOwnPropertyDescriptor(owner2, key) || null;
      let stored = owner2[key];
      try {
        Object.defineProperty(owner2, key, {
          configurable: true,
          get() {
            return stored;
          },
          set(next) {
            stored = next;
            renderSerial++;
            if (next !== lastSeenDispatcher) {
              lastSeenDispatcher = next;
              patchDispatcher(next);
            }
          }
        });
      } catch (e) {
        unpatchDispatcher(owner2[key]);
        dispatcherSlot = null;
        return { ok: false, reason: "cannot define property on ReactCurrentDispatcher" };
      }
      installed2 = true;
      return { ok: true };
    }
    function uninstall() {
      if (!installed2) return;
      if (dispatcherSlot) {
        const { owner: owner2, key } = dispatcherSlot;
        try {
          if (originalDescriptor) {
            Object.defineProperty(owner2, key, originalDescriptor);
          } else {
            Object.defineProperty(owner2, key, {
              configurable: true,
              writable: true,
              enumerable: true,
              value: lastSeenDispatcher
            });
          }
        } catch (_) {
        }
      }
      unpatchDispatcher(lastSeenDispatcher);
      currentFiber = null;
      installed2 = false;
      dispatcherSlot = null;
      originalDescriptor = void 0;
      lastSeenDispatcher = null;
    }
    function reset() {
      eventsByComponent.clear();
      sequence = null;
    }
    function rawEvents(componentName) {
      return (eventsByComponent.get(componentName) || []).slice(-maxEventsPerComponent);
    }
    function allComponents() {
      return Array.from(eventsByComponent.keys());
    }
    function status() {
      const g = globalThis;
      const hasDevtoolsHook = !!g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const rendererCount = getReactRenderers().length;
      const hasDispatcherRef = !!(dispatcherSlot || getDispatcherSlot());
      let totalCapturedEvents = 0;
      for (const list of eventsByComponent.values()) totalCapturedEvents += Math.min(list.length, maxEventsPerComponent);
      let reason;
      let hint;
      if (!hasDevtoolsHook) {
        reason = "no __REACT_DEVTOOLS_GLOBAL_HOOK__ on window";
        hint = "devtools-hook-shim must run before react-dom evaluates (extension document_start, or Playwright addInitScript)";
      } else if (rendererCount === 0) {
        reason = "__REACT_DEVTOOLS_GLOBAL_HOOK__ present but renderers Map is empty";
        hint = "react-dom evaluated before the hook shim was installed; reload the page after installing the shim, or use addInitScript before navigation";
      } else if (!hasDispatcherRef) {
        reason = "renderer registered but no currentDispatcherRef";
        hint = "unsupported react-dom version, or hook was replaced after registration";
      } else if (!installed2) {
        reason = "debug-render not installed";
        hint = "detector did not call debugRender.install() — check avalanche install() lifecycle";
      } else if (totalCapturedEvents === 0) {
        reason = "capture engine installed but no hook events recorded yet";
        hint = "trigger at least one render of the component you want to inspect after install";
      }
      const ok = installed2 && hasDispatcherRef && totalCapturedEvents > 0;
      return {
        ok,
        installed: installed2,
        hasDevtoolsHook,
        rendererCount,
        hasDispatcherRef,
        totalCapturedComponents: eventsByComponent.size,
        totalCapturedEvents,
        reason,
        hint
      };
    }
    return {
      install,
      uninstall,
      reset,
      isInstalled: () => installed2,
      dispatcherRef: () => dispatcherSlot ? dispatcherRefOf(dispatcherSlot) : getDispatcherRef(),
      rawEvents,
      allComponents,
      status,
      recordEventForTest(event) {
        const list = eventsByComponent.get(event.componentName) || [];
        list.push(event);
        eventsByComponent.set(event.componentName, list);
      }
    };
  }
  function createCommitSurfaceOwnership() {
    let adapterObserved = false;
    let devtoolsCaptures = /* @__PURE__ */ new WeakMap();
    return {
      get adapterObserved() {
        return adapterObserved;
      },
      recordDevtools(root, capture) {
        devtoolsCaptures.set(root, { current: root.current, capture });
      },
      observeAdapter(root) {
        const previous = devtoolsCaptures.get(root);
        adapterObserved = true;
        devtoolsCaptures.delete(root);
        return (previous == null ? void 0 : previous.current) === root.current ? previous.capture : null;
      },
      reset() {
        adapterObserved = false;
        devtoolsCaptures = /* @__PURE__ */ new WeakMap();
      }
    };
  }
  function walk(fiber, next, include, limit) {
    const fibers = [];
    let current = next(fiber);
    while (current && fibers.length < limit) {
      if (include(current)) fibers.push(current);
      current = next(current);
    }
    return fibers;
  }
  const debugOwnerOf = (fiber) => fiber._debugOwner || null;
  const returnOf = (fiber) => fiber.return || null;
  function collectOwnerFibers(fiber, include, limit = Number.POSITIVE_INFINITY) {
    if (!fiber) return { ownerStackKind: "owners", fibers: [] };
    const owners = walk(fiber, debugOwnerOf, (candidate) => include(candidate, "owners"), limit);
    if (owners.length > 0) return { ownerStackKind: "owners", fibers: owners };
    const parents = walk(fiber, returnOf, (candidate) => include(candidate, "parents"), limit);
    if (parents.length > 0) return { ownerStackKind: "parents", fibers: parents };
    return { ownerStackKind: "_debugOwner" in fiber ? "owners" : "parents", fibers: [] };
  }
  function isComponentFiber(fiber) {
    const t = fiber.type;
    return typeof t === "function" || typeof t === "object" && t !== null && Boolean(t.$$typeof || t.render);
  }
  function getFiberKey(node) {
    if (!node) return null;
    const keys = Object.getOwnPropertyNames(node);
    const key = keys.find((k) => k.startsWith("__reactFiber$"));
    return key || null;
  }
  function getFiber(node) {
    if (!node) return null;
    const key = getFiberKey(node);
    return key ? node[key] : null;
  }
  function getDisplayName(type) {
    return readComponentName(type);
  }
  function describeRecoveredOrigin(type) {
    const definition = componentDefinitionOf(type);
    const minifiedName = minifiedComponentName(type);
    const nameInferredFrom = nameContextOf(type);
    return {
      ...definition ? { definition } : {},
      ...minifiedName ? { minifiedName } : {},
      ...nameInferredFrom ? { nameInferredFrom } : {}
    };
  }
  function isUserComponent(fiber) {
    if (!fiber) return false;
    if (typeof fiber.type === "string") return false;
    const name = getDisplayName(fiber.type);
    if (!name) return needsComponentOrigin(fiber);
    if (["hookified", "unboundStoryFn", "Anonymous"].includes(name)) return false;
    return true;
  }
  function getNearestFiber(domNode) {
    let current = domNode;
    while (current) {
      const fiber = getFiber(current);
      if (fiber) return fiber;
      current = current.parentElement;
    }
    return null;
  }
  function getNearestComponent(domNode) {
    let fiber = getNearestFiber(domNode);
    while (fiber) {
      if (isUserComponent(fiber)) return fiber;
      fiber = fiber.return || null;
    }
    return null;
  }
  function getHookSummary(fiber) {
    const MAX_HOOKS2 = 500;
    const seen = /* @__PURE__ */ new Set();
    let hookNode = (fiber == null ? void 0 : fiber.memoizedState) || null;
    let hookCount = 0;
    let hookCountTruncated = false;
    while (hookNode) {
      if (seen.has(hookNode)) break;
      if (hookCount >= MAX_HOOKS2) {
        hookCountTruncated = true;
        break;
      }
      seen.add(hookNode);
      hookCount += 1;
      hookNode = hookNode.next || null;
    }
    return { hookCount, hookCountTruncated, hookCountMax: MAX_HOOKS2 };
  }
  function describeOwnerEntry(fiber) {
    return {
      name: getDisplayName(fiber.type),
      key: fiber.key || null,
      props: fiber.memoizedProps ? Object.keys(fiber.memoizedProps) : [],
      ...getHookSummary(fiber),
      source: describeFiberSource(fiber),
      ...describeRecoveredOrigin(fiber.type)
    };
  }
  function getOwnerChainFibers(fiber) {
    return collectOwnerFibers(fiber, isUserComponent);
  }
  function getOwnerChain(fiber) {
    return getOwnerChainFibers(fiber).fibers.map(describeOwnerEntry);
  }
  function getOwnerFibers(fiber) {
    return getOwnerChainFibers(fiber).fibers;
  }
  function getFiberDomNode(fiber) {
    if (!fiber) return null;
    if (fiber.stateNode instanceof Element) return fiber.stateNode;
    let child = fiber.child || null;
    while (child) {
      const found = getFiberDomNode(child);
      if (found) return found;
      child = child.sibling || null;
    }
    return null;
  }
  function getReturnComponentChain(fiber) {
    const chain = [];
    let current = (fiber == null ? void 0 : fiber.return) || null;
    while (current) {
      if (isUserComponent(current)) chain.push(describeOwnerEntry(current));
      current = current.return || null;
    }
    return chain;
  }
  function getReturnComponentFibers(fiber) {
    const fibers = [];
    let current = (fiber == null ? void 0 : fiber.return) || null;
    while (current) {
      if (isUserComponent(current)) fibers.push(current);
      current = current.return || null;
    }
    return fibers;
  }
  function describeSource(source) {
    if (!source) return null;
    return {
      fileName: source.fileName || null,
      lineNumber: source.lineNumber || null,
      columnNumber: source.columnNumber || null
    };
  }
  function describeFiberSource(fiber) {
    return describeSource(getFiberSource$2(fiber));
  }
  async function resolveFiberSource(fiber) {
    return describeSource(await resolveFiberSource$1(fiber));
  }
  function describeFiberTarget(fiber, domNode) {
    var _a2, _b2;
    if (!fiber && !domNode) return null;
    return {
      domTag: ((_a2 = domNode == null ? void 0 : domNode.tagName) == null ? void 0 : _a2.toLowerCase()) || null,
      domText: ((_b2 = domNode == null ? void 0 : domNode.textContent) == null ? void 0 : _b2.trim().slice(0, 60)) || "",
      fiberType: getDisplayName(fiber == null ? void 0 : fiber.type) || getDisplayName(fiber == null ? void 0 : fiber.elementType) || null,
      source: describeFiberSource(fiber)
    };
  }
  function describeComponent(fiber) {
    if (!fiber) return null;
    const ownerChain = getOwnerChainFibers(fiber);
    return {
      name: getDisplayName(fiber.type),
      key: fiber.key || null,
      props: fiber.memoizedProps || {},
      ...getHookSummary(fiber),
      source: describeFiberSource(fiber),
      stateNode: fiber.stateNode instanceof Element ? fiber.stateNode.tagName.toLowerCase() : null,
      ownerStackKind: ownerChain.ownerStackKind,
      owners: ownerChain.fibers.map(describeOwnerEntry),
      parents: getReturnComponentChain(fiber),
      ...describeRecoveredOrigin(fiber.type)
    };
  }
  function modifiersOf(event) {
    const held = [];
    if (event.altKey) held.push("Alt");
    if (event.ctrlKey) held.push("Control");
    if (event.metaKey) held.push("Meta");
    if (event.shiftKey) held.push("Shift");
    return held;
  }
  function safeKeyName(key) {
    if (typeof key !== "string" || key === "") return "unknown";
    return [...key].length === 1 ? "character" : key;
  }
  function describeInputEvent(event) {
    const details = { trusted: event.isTrusted };
    const withModifiers = event;
    if (typeof withModifiers.key !== "undefined" && /^key/.test(event.type)) {
      details.key = safeKeyName(withModifiers.key);
    }
    if (typeof withModifiers.metaKey === "boolean") {
      const held = modifiersOf(withModifiers);
      if (held.length) details.modifiers = held;
    }
    return details;
  }
  const CHIPPY_UI_SELECTOR = "[data-chippy-ui], [data-layout-lab-panel]";
  function isChippyUi$1(node) {
    return typeof Element !== "undefined" && node instanceof Element && node.matches(CHIPPY_UI_SELECTOR);
  }
  const EXPLICIT_INTERACTION_EVENTS = ["click", "keydown", "keyup", "input", "change", "submit"];
  const NOISY_INTERACTION_EVENTS = ["wheel", "scroll", "pointermove", "mousemove", "touchmove"];
  const ALL_INTERACTION_EVENTS = [
    ...EXPLICIT_INTERACTION_EVENTS,
    "pointerdown",
    "pointerup",
    "dblclick",
    "focusin",
    "focusout",
    ...NOISY_INTERACTION_EVENTS
  ];
  const MAX_INTERACTION_ACTIONS = 200;
  function createInteractionCapture(options = {}, noteName) {
    const {
      interactionCapture = "explicit",
      interactionEvents = [],
      interactionWindowMs = 1e3
    } = options;
    const state2 = {
      actions: [],
      byCommit: {}
    };
    let nextActionId = 1;
    let installed2 = false;
    let paused = false;
    function eventNames() {
      const base = interactionCapture === "off" ? [] : interactionCapture === "explicit" ? EXPLICIT_INTERACTION_EVENTS : interactionCapture === "noisy" ? EXPLICIT_INTERACTION_EVENTS.concat(NOISY_INTERACTION_EVENTS) : ALL_INTERACTION_EVENTS;
      return Array.from(new Set(base.concat(interactionEvents).map((name) => String(name).trim()).filter(Boolean)));
    }
    function findReactFiberKey(node) {
      return Object.getOwnPropertyNames(node).find((key) => key.startsWith("__reactFiber$")) || null;
    }
    function nearestFiberFromNode(node) {
      let current = node instanceof Element ? node : null;
      while (current) {
        const key = findReactFiberKey(current);
        if (key) return current[key] || null;
        current = current.parentElement;
      }
      return null;
    }
    function nearestComponentFiber(node) {
      let fiber = nearestFiberFromNode(node);
      while (fiber) {
        if (isComponentFiber$1(fiber.tag)) return fiber;
        fiber = fiber.return || null;
      }
      return null;
    }
    function nearestTestId2(node) {
      let current = node instanceof Element ? node : null;
      while (current) {
        const value = current.getAttribute("data-testid");
        if (value) return value;
        current = current.parentElement;
      }
      return null;
    }
    function describeActionLocation(target) {
      const domTarget = target instanceof Element ? target : null;
      const fiber = nearestComponentFiber(target);
      const describedTarget = describeFiberTarget(fiber, domTarget);
      const describedComponent = describeComponent(fiber);
      if (describedComponent && fiber && noteName) {
        if (describedComponent.name) noteName(describedComponent.name, fiber.type);
        const owners = getOwnerChainFibers(fiber).fibers;
        describedComponent.owners.forEach((owner2, index) => {
          if (owner2.name && owners[index]) noteName(owner2.name, owners[index].type);
        });
      }
      return {
        dom: {
          tag: (describedTarget == null ? void 0 : describedTarget.domTag) || null,
          text: (describedTarget == null ? void 0 : describedTarget.domText) || "",
          nearestTestId: nearestTestId2(target)
        },
        targetFiber: describedComponent ? {
          name: describedComponent.name,
          key: describedComponent.key,
          source: describedComponent.source,
          // describeComponent already falls back to parents and labels the chain.
          ownerStackKind: describedComponent.ownerStackKind,
          ownerStack: describedComponent.owners
        } : null
      };
    }
    function capture(event) {
      if (paused) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.some(isChippyUi$1)) return;
      const pathTarget = path[0] ?? null;
      const target = pathTarget instanceof Element ? pathTarget : event.target;
      state2.actions.push({
        id: nextActionId++,
        action: event.type,
        timestamp: performance.now(),
        location: describeActionLocation(target),
        event: describeInputEvent(event)
      });
      if (state2.actions.length > MAX_INTERACTION_ACTIONS) {
        state2.actions.splice(0, state2.actions.length - MAX_INTERACTION_ACTIONS);
      }
    }
    return {
      state: state2,
      install() {
        if (installed2) return;
        const names = eventNames();
        if (names.length === 0 || typeof document === "undefined") return;
        for (const name of names) document.addEventListener(name, capture, true);
        installed2 = true;
      },
      /** Ignore page input until resume() or reset(). */
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
      },
      uninstall() {
        if (!installed2 || typeof document === "undefined") return;
        for (const name of eventNames()) document.removeEventListener(name, capture, true);
        installed2 = false;
      },
      reset() {
        paused = false;
        state2.actions.length = 0;
        for (const key of Object.keys(state2.byCommit)) {
          delete state2.byCommit[Number(key)];
        }
        nextActionId = 1;
      },
      linkRecent(commitId, commitTime) {
        const windowMs = Math.max(0, Number(interactionWindowMs) || 0);
        if (windowMs === 0 || state2.actions.length === 0) return;
        const linked = state2.actions.filter((action) => action.timestamp <= commitTime && commitTime - action.timestamp <= windowMs).map((action) => ({
          id: action.id,
          lastCommitId: Math.max(0, commitId - 1),
          deltaTime: Math.round((commitTime - action.timestamp) * 100) / 100,
          timestamp: action.timestamp,
          action: action.action,
          location: action.location,
          ...action.event && { event: action.event }
        }));
        if (linked.length > 0) state2.byCommit[commitId] = linked;
        while (state2.actions.length > 0 && commitTime - state2.actions[0].timestamp > windowMs) {
          state2.actions.shift();
        }
      }
    };
  }
  const DEFAULT_MAX_NETWORK_REQUESTS = 500;
  const MAX_URL_LENGTH = 300;
  const round$7 = (value) => Math.round(value * 10) / 10;
  function cacheUse(entry) {
    if (entry.deliveryType === "cache") return true;
    const transfer = entry.transferSize ?? 0;
    const decoded = entry.decodedBodySize ?? 0;
    if (transfer > 0) return false;
    return decoded > 0 ? true : null;
  }
  function createNetworkCapture(options = {}) {
    const enabled = options.networkCapture !== false;
    const limit = Math.max(1, Math.floor(Number(options.maxNetworkRequests) || DEFAULT_MAX_NETWORK_REQUESTS));
    const requests = [];
    let nextId = 1;
    let dropped = 0;
    let ignoredOwn = 0;
    let windowStart = performance.now();
    let pausedAt = null;
    let observer = null;
    function observerConstructor() {
      const ctor = globalThis.PerformanceObserver;
      if (typeof ctor !== "function") return null;
      const types = ctor.supportedEntryTypes;
      return Array.isArray(types) && !types.includes("resource") ? null : ctor;
    }
    function record(raw) {
      const entry = raw;
      if (!entry || typeof entry.name !== "string" || typeof entry.startTime !== "number") return;
      const endTime = typeof entry.responseEnd === "number" && entry.responseEnd > 0 ? entry.responseEnd : entry.startTime + (entry.duration ?? 0);
      if (endTime < windowStart) return;
      if (pausedAt !== null && entry.startTime >= pausedAt) return;
      if (isChippyAssetUrl(entry.name)) return;
      if (entry.initiatorType === "fetch" && isOwnRequest(entry.name)) {
        ignoredOwn += 1;
        return;
      }
      requests.push({
        id: nextId++,
        url: entry.name.length > MAX_URL_LENGTH ? entry.name.slice(0, MAX_URL_LENGTH) : entry.name,
        initiatorType: entry.initiatorType || "other",
        startTime: round$7(entry.startTime),
        endTime: round$7(endTime),
        duration: round$7(endTime - entry.startTime),
        status: typeof entry.responseStatus === "number" && entry.responseStatus > 0 ? entry.responseStatus : null,
        cached: cacheUse(entry),
        startedBeforeCapture: entry.startTime < windowStart
      });
      if (requests.length > limit) {
        const excess = requests.length - limit;
        requests.splice(0, excess);
        dropped += excess;
      }
    }
    function flush() {
      if (!observer || typeof observer.takeRecords !== "function") return;
      try {
        for (const entry of observer.takeRecords()) record(entry);
      } catch {
      }
    }
    return {
      requests,
      flush,
      install() {
        if (!enabled || observer) return;
        const Ctor = observerConstructor();
        if (!Ctor) return;
        try {
          observer = new Ctor((list) => {
            for (const entry of list.getEntries()) record(entry);
          });
          observer.observe({ type: "resource", buffered: true });
        } catch {
          observer = null;
        }
      },
      uninstall() {
        if (!observer) return;
        flush();
        try {
          observer.disconnect();
        } catch {
        }
        observer = null;
      },
      /** Stop taking new requests; requests already in flight still finish into the capture. */
      pause() {
        if (pausedAt !== null) return;
        flush();
        pausedAt = performance.now();
      },
      resume() {
        flush();
        pausedAt = null;
      },
      reset() {
        flush();
        pausedAt = null;
        requests.length = 0;
        nextId = 1;
        dropped = 0;
        ignoredOwn = 0;
        windowStart = performance.now();
      },
      status() {
        return {
          supported: observerConstructor() !== null,
          enabled,
          windowStart: round$7(windowStart),
          requests: requests.length,
          dropped,
          ignoredOwn,
          pausedAt: pausedAt === null ? null : round$7(pausedAt)
        };
      }
    };
  }
  const MAX_ANCESTORS = 200;
  function elementOf(node) {
    if (typeof Element === "undefined" || !node) return null;
    if (node instanceof Element) return node;
    const parent = node.parentElement;
    return parent instanceof Element ? parent : null;
  }
  function hostFiberOf(element) {
    let current = element;
    for (let depth = 0; current && depth < MAX_ANCESTORS; depth += 1) {
      const key = Object.getOwnPropertyNames(current).find((name) => name.startsWith("__reactFiber$"));
      if (key) return current[key] ?? null;
      current = current.parentElement;
    }
    return null;
  }
  function describeNodeOwner(node, nameOf = getComponentName) {
    var _a2, _b2;
    const element = elementOf(node);
    if (!element) return null;
    let fiber = hostFiberOf(element);
    for (let depth = 0; fiber && !isComponentFiber$1(fiber.tag) && depth < MAX_ANCESTORS; depth += 1) fiber = fiber.return ?? null;
    let component = null;
    try {
      component = fiber && isComponentFiber$1(fiber.tag) ? nameOf(fiber) : null;
    } catch {
      component = null;
    }
    return {
      element: element.tagName ? element.tagName.toLowerCase() + (element.id ? "#" + element.id : "") : null,
      testId: ((_b2 = (_a2 = element.closest) == null ? void 0 : _a2.call(element, "[data-testid]")) == null ? void 0 : _b2.getAttribute("data-testid")) ?? null,
      component
    };
  }
  const PERF_ENTRY_TYPES = [
    "mark",
    "measure",
    "long-animation-frame",
    "layout-shift",
    "event",
    "largest-contentful-paint",
    "paint",
    "navigation"
  ];
  const DEFAULT_MAX_PERF_ENTRIES_PER_TYPE = 300;
  const EVENT_DURATION_THRESHOLD_MS = 16;
  const NON_INTERACTION_EVENT_MIN_MS = 50;
  const MAX_TEXT = 200;
  const MAX_SCRIPTS = 5;
  const MAX_SHIFT_SOURCES = 5;
  const round$6 = (value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  const cut = (text) => text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text;
  function detailOf(value) {
    if (value === void 0 || value === null) return null;
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      text = void 0;
    }
    return cut(typeof text === "string" ? text : String(value));
  }
  function rectOf(rect) {
    return rect ? [round$6(rect.x), round$6(rect.y), round$6(rect.width), round$6(rect.height)] : null;
  }
  function owner(node, nameOf) {
    try {
      return describeNodeOwner(node, nameOf);
    } catch {
      return null;
    }
  }
  function scriptsOf(raw) {
    const scripts = Array.isArray(raw.scripts) ? raw.scripts.slice() : [];
    return scripts.sort((a, b) => ((b == null ? void 0 : b.duration) ?? 0) - ((a == null ? void 0 : a.duration) ?? 0)).slice(0, MAX_SCRIPTS).map((s) => {
      const sourceURL = typeof (s == null ? void 0 : s.sourceURL) === "string" && s.sourceURL ? cut(s.sourceURL) : null;
      return {
        duration: round$6(s == null ? void 0 : s.duration),
        forcedStyleAndLayoutDuration: typeof (s == null ? void 0 : s.forcedStyleAndLayoutDuration) === "number" ? round$6(s.forcedStyleAndLayoutDuration) : null,
        invoker: typeof (s == null ? void 0 : s.invoker) === "string" && s.invoker ? cut(s.invoker) : null,
        invokerType: (s == null ? void 0 : s.invokerType) || null,
        sourceURL,
        sourceFunctionName: (s == null ? void 0 : s.sourceFunctionName) || null,
        sourceCharPosition: typeof (s == null ? void 0 : s.sourceCharPosition) === "number" && s.sourceCharPosition >= 0 ? s.sourceCharPosition : null,
        ...sourceURL && isChippyAssetUrl(sourceURL) && { chippy: true }
      };
    });
  }
  function shapePerfEntry(raw, nameOf) {
    if (!raw || typeof raw.startTime !== "number") return null;
    const entryType = String(raw.entryType || "");
    const base = { entryType, name: cut(String(raw.name ?? "")), startTime: round$6(raw.startTime), duration: round$6(raw.duration) };
    switch (entryType) {
      case "mark":
      case "measure":
        return { ...base, detail: detailOf(raw.detail) };
      case "long-animation-frame":
        return {
          ...base,
          blockingDuration: round$6(raw.blockingDuration),
          renderStart: round$6(raw.renderStart),
          styleAndLayoutStart: round$6(raw.styleAndLayoutStart),
          scripts: scriptsOf(raw)
        };
      case "layout-shift":
        return {
          ...base,
          value: Math.round(Number(raw.value || 0) * 1e4) / 1e4,
          hadRecentInput: !!raw.hadRecentInput,
          sources: (Array.isArray(raw.sources) ? raw.sources : []).slice(0, MAX_SHIFT_SOURCES).map((s) => ({
            ...owner(s == null ? void 0 : s.node, nameOf) ?? { element: null, testId: null, component: null },
            previousRect: rectOf(s == null ? void 0 : s.previousRect),
            currentRect: rectOf(s == null ? void 0 : s.currentRect)
          }))
        };
      case "event":
        return {
          ...base,
          interactionId: Number(raw.interactionId) || 0,
          inputDelay: round$6(raw.processingStart - raw.startTime),
          processing: round$6(raw.processingEnd - raw.processingStart),
          presentationDelay: round$6(raw.startTime + (raw.duration ?? 0) - raw.processingEnd),
          target: owner(raw.target, nameOf)
        };
      case "largest-contentful-paint":
        return {
          ...base,
          renderTime: round$6(raw.renderTime),
          loadTime: round$6(raw.loadTime),
          size: Number(raw.size) || 0,
          url: typeof raw.url === "string" && raw.url ? cut(raw.url) : null,
          element: owner(raw.element, nameOf)
        };
      case "navigation":
        return {
          ...base,
          navigationType: String(raw.type || ""),
          ttfb: round$6(raw.responseStart),
          domContentLoaded: round$6(raw.domContentLoadedEventEnd),
          load: round$6(raw.loadEventEnd),
          transferSize: Number(raw.transferSize) || 0
        };
      case "paint":
      case "longtask":
        return base;
      default:
        return null;
    }
  }
  function createPerfCapture(options = {}, nameOf) {
    const enabled = options.perfCapture !== false;
    const limit = Math.max(1, Math.floor(Number(options.maxPerfEntries) || DEFAULT_MAX_PERF_ENTRIES_PER_TYPE));
    const entries = [];
    const kept = /* @__PURE__ */ new Map();
    const dropped = /* @__PURE__ */ new Map();
    let nextId = 1;
    let windowStart = performance.now();
    let pausedAt = null;
    let observers = [];
    function observerConstructor() {
      const ctor = globalThis.PerformanceObserver;
      return typeof ctor === "function" ? ctor : null;
    }
    function plannedTypes() {
      const ctor = observerConstructor();
      const supported = ctor && Array.isArray(ctor.supportedEntryTypes) ? ctor.supportedEntryTypes : [];
      const observed = PERF_ENTRY_TYPES.filter((type) => supported.includes(type));
      const unsupported = PERF_ENTRY_TYPES.filter((type) => !supported.includes(type));
      if (!supported.includes("long-animation-frame") && supported.includes("longtask")) observed.push("longtask");
      return { observed, unsupported };
    }
    function dropOldest(type) {
      const index = entries.findIndex((entry) => entry.entryType === type);
      if (index < 0) return;
      entries.splice(index, 1);
      kept.set(type, (kept.get(type) ?? 1) - 1);
      dropped.set(type, (dropped.get(type) ?? 0) + 1);
    }
    function record(raw) {
      const entry = raw;
      if (!entry || typeof entry.startTime !== "number") return;
      const end = entry.startTime + (typeof entry.duration === "number" ? entry.duration : 0);
      if (end < windowStart) return;
      if (pausedAt !== null && entry.startTime >= pausedAt) return;
      if (entry.entryType === "event" && !entry.interactionId && (entry.duration ?? 0) < NON_INTERACTION_EVENT_MIN_MS) return;
      const shaped = shapePerfEntry(entry, nameOf);
      if (!shaped) return;
      entries.push({ id: nextId++, ...shaped });
      kept.set(shaped.entryType, (kept.get(shaped.entryType) ?? 0) + 1);
      if ((kept.get(shaped.entryType) ?? 0) > limit) dropOldest(shaped.entryType);
    }
    function flush() {
      for (const observer of observers) {
        if (typeof observer.takeRecords !== "function") continue;
        try {
          for (const entry of observer.takeRecords()) record(entry);
        } catch {
        }
      }
    }
    return {
      entries,
      flush,
      install() {
        if (!enabled || observers.length) return;
        const Ctor = observerConstructor();
        if (!Ctor) return;
        for (const type of plannedTypes().observed) {
          try {
            const observer = new Ctor((list) => {
              for (const entry of list.getEntries()) record(entry);
            });
            observer.observe({
              type,
              buffered: true,
              ...type === "event" && { durationThreshold: EVENT_DURATION_THRESHOLD_MS }
            });
            observers.push(observer);
          } catch {
          }
        }
      },
      uninstall() {
        flush();
        for (const observer of observers) {
          try {
            observer.disconnect();
          } catch {
          }
        }
        observers = [];
      },
      /** Stop taking new entries; entries that started before the pause still arrive. */
      pause() {
        if (pausedAt !== null) return;
        flush();
        pausedAt = performance.now();
      },
      resume() {
        flush();
        pausedAt = null;
      },
      reset() {
        flush();
        pausedAt = null;
        entries.length = 0;
        kept.clear();
        dropped.clear();
        nextId = 1;
        windowStart = performance.now();
      },
      status() {
        const { observed, unsupported } = enabled ? plannedTypes() : { observed: [], unsupported: [] };
        const byType = {};
        for (const [type, count] of kept) if (count > 0) byType[type] = count;
        return {
          enabled,
          observed,
          unsupported,
          windowStart: round$6(windowStart),
          entries: entries.length,
          byType,
          dropped: Object.fromEntries(dropped),
          pausedAt: pausedAt === null ? null : round$6(pausedAt)
        };
      }
    };
  }
  function browserEnvironment() {
    if (typeof requestAnimationFrame !== "function" || typeof MessageChannel !== "function") return null;
    const channel = new MessageChannel();
    const queue = [];
    channel.port1.onmessage = () => {
      var _a2;
      return (_a2 = queue.shift()) == null ? void 0 : _a2();
    };
    return {
      requestFrame: (callback) => {
        requestAnimationFrame(() => callback());
      },
      postTask: (callback) => {
        queue.push(callback);
        channel.port2.postMessage(null);
      },
      now: () => performance.now(),
      hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden"
    };
  }
  function createPaintTracker(onPaint, environment = browserEnvironment()) {
    let pending = [];
    let scheduled = false;
    let generation = 0;
    return {
      afterCommit(commitId) {
        if (!environment || environment.hidden()) return;
        pending.push(commitId);
        if (scheduled) return;
        scheduled = true;
        const mine = generation;
        environment.requestFrame(() => {
          environment.postTask(() => {
            if (mine !== generation) return;
            const ids = pending;
            pending = [];
            scheduled = false;
            if (ids.length) onPaint(ids, environment.now());
          });
        });
      },
      reset() {
        generation++;
        pending = [];
        scheduled = false;
      }
    };
  }
  const MAX_RECORDED_ERRORS = 5;
  const MAX_STEP_FAILURES = 20;
  const registered$1 = /* @__PURE__ */ new Map();
  function registerAvalancheHooks(hooks) {
    if (!hooks || typeof hooks.id !== "string" || !hooks.id) {
      throw new TypeError("registerAvalancheHooks expects hooks with a non-empty id");
    }
    for (const phase of ["onStart", "onStep", "onEnd"]) {
      if (hooks[phase] !== void 0 && typeof hooks[phase] !== "function") {
        throw new TypeError(`avalanche hooks ${hooks.id}: ${phase} must be a function`);
      }
    }
    registered$1.set(hooks.id, hooks);
    return () => {
      if (registered$1.get(hooks.id) === hooks) registered$1.delete(hooks.id);
    };
  }
  function getAvalancheHooks() {
    return [...registered$1.values()];
  }
  function toEvidence(value) {
    if (value === void 0 || typeof value === "function") return void 0;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  function messageOf(error) {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
  }
  function createAvalancheHookRunner(source = getAvalancheHooks) {
    let sessions = /* @__PURE__ */ new Map();
    let commits = 0;
    let started = false;
    function fail2(session2, error) {
      session2.result.errorCount += 1;
      if (session2.result.errors.length < MAX_RECORDED_ERRORS) session2.result.errors.push(error);
    }
    function open(hooks, runStart) {
      const session2 = {
        hooks,
        context: { id: hooks.id, state: {}, commits },
        result: {
          ...hooks.instructions && { instructions: hooks.instructions },
          steps: {},
          errors: [],
          errorCount: 0,
          stepDisabled: false
        },
        stepFailures: 0
      };
      sessions.set(hooks, session2);
      if (runStart && hooks.onStart) {
        try {
          session2.result.start = toEvidence(hooks.onStart(session2.context));
        } catch (error) {
          fail2(session2, { phase: "start", message: messageOf(error) });
        }
      }
      return session2;
    }
    function current() {
      const live = source();
      for (const hooks of sessions.keys()) if (!live.includes(hooks)) sessions.delete(hooks);
      return live.map((hooks) => sessions.get(hooks) ?? open(hooks, false));
    }
    return {
      /** Begin a recording: fresh state for every set, then onStart. */
      start() {
        started = true;
        sessions = /* @__PURE__ */ new Map();
        commits = 0;
        for (const hooks of source()) open(hooks, true);
      },
      /** Start once; later calls keep the running recording (install() is idempotent). */
      ensureStarted() {
        if (!started) this.start();
      },
      /** Run onStep for one captured commit. */
      step(commit) {
        commits += 1;
        for (const session2 of current()) {
          const { hooks, context, result } = session2;
          context.commits = commits;
          if (!hooks.onStep || result.stepDisabled) continue;
          context.commit = commit;
          try {
            const value = toEvidence(hooks.onStep(context));
            if (value !== void 0) result.steps[commit.id] = value;
          } catch (error) {
            fail2(session2, { phase: "step", commitId: commit.id, message: messageOf(error) });
            session2.stepFailures += 1;
            if (session2.stepFailures >= MAX_STEP_FAILURES) result.stepDisabled = true;
          } finally {
            context.commit = void 0;
          }
        }
      },
      /** Run onEnd and return every set's results, or null when none is registered. */
      collect() {
        const live = current();
        if (live.length === 0) return null;
        const out = {};
        for (const session2 of live) {
          const { hooks, context, result } = session2;
          context.commits = commits;
          const snapshot = { ...result, steps: { ...result.steps }, errors: [...result.errors] };
          if (hooks.onEnd) {
            try {
              snapshot.end = toEvidence(hooks.onEnd(context));
            } catch (error) {
              snapshot.errorCount += 1;
              if (snapshot.errors.length < MAX_RECORDED_ERRORS) snapshot.errors.push({ phase: "end", message: messageOf(error) });
            }
          }
          out[hooks.id] = snapshot;
        }
        return out;
      }
    };
  }
  function summarizeHookResults(results) {
    if (!results) return null;
    const out = {};
    for (const [id, { steps, instructions: _instructions, ...rest }] of Object.entries(results)) {
      out[id] = { ...rest, stepCount: Object.keys(steps ?? {}).length };
    }
    return out;
  }
  function hookStepsAt(results, commitId) {
    const out = {};
    for (const [id, result] of Object.entries(results ?? {})) {
      const steps = (result == null ? void 0 : result.steps) ?? {};
      const value = steps[commitId] ?? steps[String(commitId)];
      if (value !== void 0) out[id] = value;
    }
    return out;
  }
  const MAX_CELLS = 25e4;
  function rectArea(rect) {
    return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
  }
  function intersectRect(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }
  function cellSizeFor(clip2) {
    const area = rectArea(clip2);
    return Math.max(1, Math.ceil(Math.sqrt(area / MAX_CELLS)));
  }
  function createAreaGrid(clip2, cell = cellSizeFor(clip2)) {
    const cols = Math.max(0, Math.ceil((clip2.right - clip2.left) / cell));
    const rows = Math.max(0, Math.ceil((clip2.bottom - clip2.top) / cell));
    const bits = new Uint8Array(cols * rows);
    let covered = 0;
    function add(rect) {
      const r = intersectRect(rect, clip2);
      if (!r) return;
      const c0 = Math.max(0, Math.round((r.left - clip2.left) / cell));
      const c1 = Math.min(cols, Math.round((r.right - clip2.left) / cell));
      const r0 = Math.max(0, Math.round((r.top - clip2.top) / cell));
      const r1 = Math.min(rows, Math.round((r.bottom - clip2.top) / cell));
      for (let y = r0; y < r1; y++) {
        const row = y * cols;
        for (let x = c0; x < c1; x++) {
          if (bits[row + x] === 0) {
            bits[row + x] = 1;
            covered++;
          }
        }
      }
    }
    function area() {
      const full = rectArea(clip2);
      return Math.min(full, covered * cell * cell);
    }
    return { clip: clip2, cell, add, area };
  }
  const Visibility = 8192;
  const MUTATION_MASK = Placement | Update | ChildDeletion | Visibility;
  const HOST_COMPONENT = 5;
  const HOST_TEXT = 6;
  const HOST_HOISTABLE = 26;
  const HOST_SINGLETON = 27;
  const OFFSCREEN = 22;
  const MAX_NODES_PER_COMMIT = 400;
  const MAX_RECTS_PER_COMMIT = 48;
  const MAX_REGIONS = 5;
  const domScreenGeometry = {
    viewport: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
    rect: (node) => {
      if (node.nodeType === 1) return node.getBoundingClientRect();
      if (node.nodeType === 3) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      }
      return null;
    },
    now: () => performance.now()
  };
  function isHost(tag) {
    return tag === HOST_COMPONENT || tag === HOST_TEXT || tag === HOST_HOISTABLE || tag === HOST_SINGLETON;
  }
  function isNode(value) {
    return !!value && typeof value === "object" && typeof value.nodeType === "number";
  }
  function forEachVisiblePropChange(prev, next, visit) {
    if (prev === next) return false;
    if (!prev || !next || typeof prev !== "object" || typeof next !== "object") {
      visit("props", prev, next);
      return true;
    }
    const a = prev;
    const b = next;
    let any = false;
    for (const key of /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "ref" || key === "key") continue;
      const x = a[key];
      const y = b[key];
      if (Object.is(x, y)) continue;
      if (typeof x === "function" || typeof y === "function") continue;
      if (key === "children") {
        const textual = (v) => typeof v === "string" || typeof v === "number";
        if (!textual(x) && !textual(y)) continue;
        any = true;
        if (visit(key, textual(x) ? x : void 0, textual(y) ? y : void 0)) return true;
        continue;
      }
      if (key === "style") {
        const sx = x && typeof x === "object" ? x : {};
        const sy = y && typeof y === "object" ? y : {};
        for (const styleKey of /* @__PURE__ */ new Set([...Object.keys(sx), ...Object.keys(sy)])) {
          if (Object.is(sx[styleKey], sy[styleKey])) continue;
          any = true;
          if (visit("style." + styleKey, sx[styleKey], sy[styleKey])) return true;
        }
        continue;
      }
      if (key === "dangerouslySetInnerHTML") {
        const hx = x == null ? void 0 : x.__html;
        const hy = y == null ? void 0 : y.__html;
        if (Object.is(hx, hy)) continue;
        any = true;
        if (visit(key, hx, hy)) return true;
        continue;
      }
      any = true;
      if (visit(key, x, y)) return true;
    }
    return any;
  }
  function visiblePropsChanged(prev, next) {
    return forEachVisiblePropChange(prev, next, () => true);
  }
  function findChangedHosts(root, options = {}) {
    const { limit = MAX_NODES_PER_COMMIT, descendUpdated = false, detectMoves = false } = typeof options === "number" ? { limit: options } : options;
    const found = [];
    let truncated = false;
    const push = (fiber, kind, parent) => {
      if (found.length >= limit) {
        truncated = true;
        return;
      }
      const node = fiber.stateNode;
      if (!isNode(node)) return;
      const removed = kind === "removed" || kind === "hidden";
      found.push(parent ? { node, fiber, removed, kind, parent } : { node, fiber, removed, kind });
    };
    const collectTop = (start, kind, parent) => {
      const stack2 = [start];
      while (stack2.length) {
        const fiber = stack2.pop();
        if (isHost(fiber.tag)) {
          push(fiber, kind, parent);
          continue;
        }
        const children = [];
        for (let child = fiber.child; child; child = child.sibling) children.push(child);
        for (let i = children.length - 1; i >= 0; i--) stack2.push(children[i]);
      }
    };
    const collectMoves = (first) => {
      var _a2;
      if (!first.sibling) return;
      let lastPlaced = 0;
      for (let child = first; child; child = child.sibling) {
        const old = (_a2 = child.alternate) == null ? void 0 : _a2.index;
        if (typeof old !== "number") continue;
        if (old < lastPlaced && (child.flags & Placement) === 0) collectTop(child, "moved");
        else lastPlaced = Math.max(lastPlaced, old);
      }
    };
    const stack = root.child ? [root.child] : [];
    while (stack.length && !truncated) {
      const fiber = stack.pop();
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.alternate === null) {
        const hiddenMount = fiber.tag === OFFSCREEN && !!fiber.memoizedState;
        if (!hiddenMount) collectTop(fiber, "inserted");
        continue;
      }
      if (((fiber.flags | fiber.subtreeFlags) & MUTATION_MASK) === 0) continue;
      if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions) {
        for (const deleted of fiber.deletions) collectTop(deleted, "removed", fiber);
      }
      if ((fiber.flags & Placement) !== 0) {
        collectTop(fiber, "moved");
        continue;
      }
      if (fiber.tag === OFFSCREEN && (fiber.flags & Visibility) !== 0) {
        const hidden = !!fiber.memoizedState;
        for (let child = fiber.child; child; child = child.sibling) collectTop(child, hidden ? "hidden" : "shown");
        continue;
      }
      if (isHost(fiber.tag) && (fiber.flags & Update) !== 0 && fiber.alternate) {
        const changed = fiber.tag === HOST_TEXT ? fiber.memoizedProps !== fiber.alternate.memoizedProps : visiblePropsChanged(fiber.alternate.memoizedProps, fiber.memoizedProps);
        if (changed) {
          push(fiber, "updated");
          if (!descendUpdated) continue;
        }
      }
      if (fiber.child) {
        if (detectMoves) collectMoves(fiber.child);
        stack.push(fiber.child);
      }
    }
    return { found, truncated };
  }
  function regionLabel(node, fiber, nameOf) {
    var _a2, _b2, _c2;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const testId = (_b2 = (_a2 = element == null ? void 0 : element.closest) == null ? void 0 : _a2.call(element, "[data-testid]")) == null ? void 0 : _b2.getAttribute("data-testid");
    if (testId) return testId;
    for (let f = fiber.return; f; f = f.return) {
      if (isComponentFiber$1(f.tag)) return nameOf(f);
    }
    return ((_c2 = element == null ? void 0 : element.tagName) == null ? void 0 : _c2.toLowerCase()) || "unknown";
  }
  const round$5 = (n) => Math.round(n);
  const MAX_DESCENT = 32;
  function isEmptyBox(box) {
    return !box || box.right - box.left <= 0 || box.bottom - box.top <= 0;
  }
  function unionRect(boxes) {
    return {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom))
    };
  }
  function measureVisible(node, geometry) {
    const own = geometry.rect(node);
    if (!isEmptyBox(own)) return [{ node, box: own }];
    const out = [];
    const queue = node.nodeType === 1 ? Array.from(node.children) : [];
    let visited = 0;
    while (queue.length && visited < MAX_DESCENT) {
      const element = queue.shift();
      visited++;
      const box = geometry.rect(element);
      if (!isEmptyBox(box)) out.push({ node: element, box });
      else queue.push(...Array.from(element.children));
    }
    return out;
  }
  function createScreenCapture(options = {}, geometry = domScreenGeometry, nameOf = getComponentName) {
    const enabled = options.screenCapture !== false && typeof document !== "undefined" && typeof window !== "undefined";
    const byCommit = {};
    let lastRects = /* @__PURE__ */ new WeakMap();
    function record(commitId, root) {
      if (!enabled) return;
      const started = geometry.now();
      const { found, truncated } = findChangedHosts(root);
      if (found.length === 0) return;
      const viewport = geometry.viewport();
      const cell = Math.max(4, Math.ceil(Math.sqrt(rectArea(viewport) / 4e4)));
      const changed = createAreaGrid(viewport, cell);
      const removed = createAreaGrid(viewport, cell);
      const rects = [];
      const regions = /* @__PURE__ */ new Map();
      for (const { node, fiber, removed: isRemoved } of found) {
        let boxes;
        if (isRemoved) {
          const last = lastRects.get(node);
          boxes = last ? [{ node, box: last }] : [];
        } else {
          boxes = measureVisible(node, geometry);
          if (boxes.length) lastRects.set(node, unionRect(boxes.map((b) => b.box)));
        }
        for (const { node: measured, box } of boxes) {
          const clipped = intersectRect(box, viewport);
          if (!clipped) continue;
          const area2 = rectArea(clipped);
          (isRemoved ? removed : changed).add(clipped);
          rects.push({ rect: clipped, area: area2 });
          const label = regionLabel(measured, fiber, nameOf);
          regions.set(label, (regions.get(label) || 0) + area2);
        }
      }
      if (rects.length === 0) return;
      const full = Math.max(1, rectArea(viewport));
      const area = round$5(changed.area());
      const removedArea = round$5(removed.area());
      rects.sort((a, b) => b.area - a.area);
      byCommit[commitId] = {
        viewport: [round$5(viewport.right - viewport.left), round$5(viewport.bottom - viewport.top)],
        area,
        removedArea,
        share: Math.min(1, Math.round((area + removedArea) / full * 1e3) / 1e3),
        rects: rects.slice(0, MAX_RECTS_PER_COMMIT).map(({ rect }) => [round$5(rect.left), round$5(rect.top), round$5(rect.right), round$5(rect.bottom)]),
        regions: [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_REGIONS).map(([label, regionArea]) => ({ label, area: round$5(Math.min(regionArea, full)) })),
        nodes: found.length,
        ...truncated && { truncated: true },
        ms: Math.round((geometry.now() - started) * 100) / 100
      };
    }
    function reset() {
      for (const key of Object.keys(byCommit)) delete byCommit[Number(key)];
      lastRects = /* @__PURE__ */ new WeakMap();
    }
    return { enabled, byCommit, record, reset };
  }
  const DEFAULT_MAX_RENDERED_ENTRIES = 25e4;
  function createRenderedEvidenceStore(byCommit, maxEntries = DEFAULT_MAX_RENDERED_ENTRIES) {
    return createCommitBudgetStore(byCommit, maxEntries, (list) => list.length, DEFAULT_MAX_RENDERED_ENTRIES);
  }
  function createCommitBudgetStore(byCommit, maxEntries, sizeOf, fallbackMaxEntries = DEFAULT_MAX_RENDERED_ENTRIES) {
    const budget = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : fallbackMaxEntries;
    let order = [];
    let head = 0;
    let entries = 0;
    let evicted = null;
    function add(commitId, value) {
      const previous = byCommit[commitId];
      if (previous !== void 0) entries -= sizeOf(previous);
      else order.push(commitId);
      byCommit[commitId] = value;
      entries += sizeOf(value);
      while (entries > budget && order.length - head > 1) {
        const oldest = order[head++];
        const held = byCommit[oldest];
        const dropped = held === void 0 ? 0 : sizeOf(held);
        delete byCommit[oldest];
        entries -= dropped;
        evicted = {
          commits: ((evicted == null ? void 0 : evicted.commits) ?? 0) + 1,
          entries: ((evicted == null ? void 0 : evicted.entries) ?? 0) + dropped,
          throughCommit: Math.max((evicted == null ? void 0 : evicted.throughCommit) ?? oldest, oldest)
        };
      }
      if (head > 1024 && head * 2 > order.length) {
        order = order.slice(head);
        head = 0;
      }
    }
    function reset() {
      for (const key of Object.keys(byCommit)) delete byCommit[Number(key)];
      order = [];
      head = 0;
      entries = 0;
      evicted = null;
    }
    function status() {
      return { maxEntries: budget, entries, commits: order.length - head, evicted: evicted && { ...evicted } };
    }
    function inEvictedRange(commitId) {
      return !!evicted && commitId <= evicted.throughCommit && byCommit[commitId] === void 0;
    }
    return { add, reset, status, inEvictedRange };
  }
  const MAX_DOM_CHANGES_PER_COMMIT = 200;
  const DEFAULT_MAX_DOM_CHANGES = 5e4;
  const MAX_PROPS_PER_CHANGE = 12;
  const MAX_VALUE$1 = 80;
  const MAX_ATTR_VALUE = 40;
  const MAX_TEXT_HINT = 60;
  const MAX_MARKUP = 200;
  const MAX_ELEMENT_COUNT = 1e3;
  const ANCHOR_DEPTH = 3;
  const OPS = {
    inserted: "+",
    removed: "-",
    updated: "~",
    moved: "move",
    shown: "show",
    hidden: "hide"
  };
  const PROP_NAMES = {
    children: "text",
    className: "class",
    htmlFor: "for",
    dangerouslySetInnerHTML: "innerHTML"
  };
  const VOID_TAGS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }
  function formatValue(value) {
    if (value === void 0) return null;
    if (typeof value === "string") return clip(JSON.stringify(value), MAX_VALUE$1);
    if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return clip(JSON.stringify(value) ?? String(value), MAX_VALUE$1);
    } catch {
      return "[object]";
    }
  }
  function isElement$1(node) {
    return node.nodeType === 1;
  }
  function describeNode(node) {
    if (!isElement$1(node)) {
      const parent = node.parentElement;
      return parent ? describeNode(parent) + " #text" : "#text";
    }
    const tag = node.tagName.toLowerCase();
    const testId = node.getAttribute("data-testid");
    if (testId) return `${tag}[data-testid=${clip(testId, MAX_ATTR_VALUE)}]`;
    if (node.id) return `${tag}#${clip(node.id, MAX_ATTR_VALUE)}`;
    const role = node.getAttribute("role");
    return role ? `${tag}[role=${role}]` : tag;
  }
  function textHint(node) {
    if (!isElement$1(node)) return (node.nodeValue || "").replace(/\s+/g, " ").trim();
    const doc = node.ownerDocument;
    if (!(doc == null ? void 0 : doc.createTreeWalker)) return "";
    const walker = doc.createTreeWalker(
      node,
      4
      /* NodeFilter.SHOW_TEXT */
    );
    let out = "";
    while (out.length <= MAX_TEXT_HINT && walker.nextNode()) {
      const text = (walker.currentNode.nodeValue || "").replace(/\s+/g, " ");
      if (text.trim()) out += text;
    }
    return clip(out.replace(/\s+/g, " ").trim(), MAX_TEXT_HINT);
  }
  function countElements(node, cap = MAX_ELEMENT_COUNT) {
    if (!isElement$1(node)) return 0;
    const doc = node.ownerDocument;
    if (!(doc == null ? void 0 : doc.createTreeWalker)) return 1;
    const walker = doc.createTreeWalker(
      node,
      1
      /* NodeFilter.SHOW_ELEMENT */
    );
    let count = 1;
    while (count < cap && walker.nextNode()) count++;
    return count;
  }
  function markup(node) {
    if (!isElement$1(node)) return clip(JSON.stringify(textHint(node)), MAX_MARKUP);
    const tag = node.tagName.toLowerCase();
    let open = "<" + tag;
    for (const attr of Array.from(node.attributes)) {
      open += ` ${attr.name}="${clip(attr.value, MAX_ATTR_VALUE)}"`;
    }
    open += ">";
    if (VOID_TAGS.has(tag)) return clip(open, MAX_MARKUP);
    return clip(open + textHint(node), MAX_MARKUP - tag.length - 3) + `</${tag}>`;
  }
  function anchorOf(fiber, parent, nameOf = getComponentName) {
    const names = [];
    let f = fiber.return;
    let resumed = false;
    while (names.length < ANCHOR_DEPTH) {
      if (!f) {
        if (resumed || !parent) break;
        f = parent;
        resumed = true;
        continue;
      }
      if (isComponentFiber$1(f.tag)) names.push(nameOf(f));
      f = f.return;
    }
    return names.length ? names.reverse().join(" › ") : "(root)";
  }
  function propChanges(found) {
    var _a2;
    const { fiber } = found;
    const before = (_a2 = fiber.alternate) == null ? void 0 : _a2.memoizedProps;
    const after = fiber.memoizedProps;
    if (found.node.nodeType === 3) return [["text", formatValue(before), formatValue(after)]];
    const out = [];
    forEachVisiblePropChange(before, after, (key, x, y) => {
      out.push([PROP_NAMES[key] || key, formatValue(x), formatValue(y)]);
      return out.length >= MAX_PROPS_PER_CHANGE;
    });
    return out;
  }
  function toDomChange(found, nameOf = getComponentName) {
    const op = OPS[found.kind];
    const base = { op, node: describeNode(found.node), at: anchorOf(found.fiber, found.parent, nameOf) };
    if (op === "~") return { ...base, props: propChanges(found) };
    return { ...base, html: markup(found.node), elements: countElements(found.node) };
  }
  function diffCommit(root, limit = MAX_DOM_CHANGES_PER_COMMIT, nameOf = getComponentName) {
    const { found, truncated } = findChangedHosts(root, { limit, descendUpdated: true, detectMoves: true });
    return { changes: found.map((item) => toDomChange(item, nameOf)), truncated };
  }
  function createDomDiffCapture(options = {}, now = () => performance.now(), nameOf = getComponentName) {
    const enabled = options.domDiff !== false && typeof document !== "undefined";
    const byCommit = {};
    const store = createCommitBudgetStore(byCommit, options.maxDomChanges ?? DEFAULT_MAX_DOM_CHANGES, (diff) => diff.changes.length, DEFAULT_MAX_DOM_CHANGES);
    function record(commitId, root) {
      if (!enabled) return;
      const started = now();
      const { changes, truncated } = diffCommit(root, MAX_DOM_CHANGES_PER_COMMIT, nameOf);
      if (changes.length === 0) return;
      store.add(commitId, {
        changes,
        ...truncated && { truncated: true },
        ms: Math.round((now() - started) * 100) / 100
      });
    }
    return {
      enabled,
      byCommit,
      record,
      reset: store.reset,
      status: () => store.status()
    };
  }
  const LOCATION_PARENTS = 5;
  const LOCATION_OWNERS = 5;
  const MAX_PROPS = 8;
  const MAX_VALUE = 80;
  const EXACT_PROP_NAMES = /* @__PURE__ */ new Set([
    "name",
    "id",
    "testid",
    "data-testid",
    "datatestid",
    "team",
    "owner",
    "package",
    "pkg",
    "module",
    "entrypoint",
    "component",
    "feature",
    "featureflag",
    "experience",
    "metric",
    "metrickey",
    "interaction",
    "area",
    "section",
    "region",
    "slot",
    "location",
    "placement",
    "view",
    "page",
    "route",
    "screen",
    "product",
    "app",
    "source",
    "context",
    "scope",
    "label",
    "title",
    "type",
    "kind",
    "variant",
    "mode",
    "boundary",
    "fallback",
    "loader",
    "chunk",
    "query",
    "operation",
    "resource",
    "segment",
    "attribution",
    "actionsubject",
    "actionsubjectid",
    "analyticsid"
  ]);
  const PROP_NAME_SUFFIX = /(name|id|key|team|package|module|feature|experience|segment|source|location|area|slot|region|boundary|entrypoint)$/i;
  const IGNORED_PROPS = /* @__PURE__ */ new Set(["children", "className", "style", "ref", "key"]);
  function isLocationProp(name) {
    if (IGNORED_PROPS.has(name)) return false;
    return EXACT_PROP_NAMES.has(name.toLowerCase()) || PROP_NAME_SUFFIX.test(name);
  }
  function pickLocationProps(props) {
    if (!props || typeof props !== "object") return void 0;
    const picked = {};
    let count = 0;
    for (const [key, value] of Object.entries(props)) {
      if (count >= MAX_PROPS) break;
      if (typeof value !== "string" && typeof value !== "number" || value === "" || !isLocationProp(key)) continue;
      picked[key] = String(value).slice(0, MAX_VALUE);
      count++;
    }
    return count ? picked : void 0;
  }
  function nameOfType(type) {
    if (typeof type === "function") return type.displayName || type.name || null;
    if (type && typeof type === "object") {
      const t = type;
      return t.displayName || nameOfType(t.render) || nameOfType(t.type);
    }
    return null;
  }
  function entryFor(owner2, via, nameOf) {
    if (!owner2 || typeof owner2 !== "object") return null;
    const fiber = owner2;
    if (typeof fiber.tag === "number") {
      const source = getFiberSourceCandidate(fiber);
      const props2 = pickLocationProps(fiber.memoizedProps);
      return {
        via,
        name: nameOf(fiber),
        ...source && { source: { fileName: source.fileName, lineNumber: source.lineNumber } },
        ...props2 && { props: props2 }
      };
    }
    const info = owner2;
    if (typeof info.name !== "string") return null;
    const props = pickLocationProps(info.props);
    return { via, name: info.name, ...props && { props } };
  }
  function nextOwner(owner2) {
    if (!owner2 || typeof owner2 !== "object") return null;
    const value = owner2;
    return typeof value.tag === "number" ? value._debugOwner ?? null : value.owner ?? null;
  }
  function describeSuspenseLocation(boundary, parents = LOCATION_PARENTS, owners = LOCATION_OWNERS, nameOf = getComponentName, noteName) {
    const fiber = boundary;
    const chain = [];
    const listed = /* @__PURE__ */ new Map();
    const remember = (f, entry) => {
      listed.set(f, entry);
      const alternate = f.alternate;
      if (alternate) listed.set(alternate, entry);
    };
    for (let f = fiber.return, n = 0; f && n < parents; f = f.return) {
      if (!isComponentFiber$1(f.tag)) continue;
      const entry = entryFor(f, "parent", nameOf);
      if (!entry) continue;
      chain.push(entry);
      remember(f, entry);
      n++;
    }
    for (let o = fiber._debugOwner, n = 0; o && n < owners; o = nextOwner(o)) {
      const seen = listed.get(o);
      if (seen) {
        seen.via = "both";
        n++;
        continue;
      }
      const entry = entryFor(o, "owner", nameOf);
      if (!entry) continue;
      chain.push(entry);
      remember(o, entry);
      n++;
    }
    const props = fiber.memoizedProps || {};
    const name = typeof props.name === "string" ? props.name : typeof fiber.key === "string" ? fiber.key : void 0;
    const fallbackType = props.fallback && typeof props.fallback === "object" ? props.fallback.type : null;
    const fallback = fallbackType ? nameOfType(fallbackType) : null;
    if (fallback && noteName) noteName(fallback, fallbackType);
    return { ...name && { name }, ...fallback && { fallback }, chain };
  }
  function entryKey(entry) {
    return entry.name + (entry.props ? JSON.stringify(entry.props) : "") + (entry.source ? `@${entry.source.fileName}:${entry.source.lineNumber}` : "");
  }
  function entryLabel(entry) {
    const props = entry.props ? Object.entries(entry.props).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(" ") : "";
    return props ? `${entry.name} ${props}` : entry.name;
  }
  function distinguishingLabels(locations) {
    const counts = /* @__PURE__ */ new Map();
    for (const location of locations) {
      if (!location) continue;
      for (const key of new Set(location.chain.map(entryKey))) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const total = locations.filter(Boolean).length;
    return locations.map((location) => {
      if (!location) return null;
      if (location.name) return location.name;
      const chain = location.chain;
      if (chain.length === 0) return location.fallback ? `fallback ${location.fallback}` : null;
      const unique = total > 1 ? chain.filter((e) => (counts.get(entryKey(e)) || 0) < total) : chain;
      const pick = unique.find((e) => e.props) || unique[0] || chain.find((e) => e.props) || chain[0];
      return entryLabel(pick);
    });
  }
  const SLICE_END_HOOKS = ["markRenderYielded", "markRenderStopped"];
  function createRenderTickTracker(options = {}) {
    const now = options.now ?? (() => performance.now());
    const maxSlices = options.maxSlices ?? 32;
    let pending = null;
    let sliceStart = -1;
    let partialPending = false;
    let lastFailure = null;
    const sources = /* @__PURE__ */ new Map();
    const releases = /* @__PURE__ */ new Map();
    const prepared = /* @__PURE__ */ new WeakMap();
    const trappedInternals = /* @__PURE__ */ new Set();
    function openSlice() {
      if (sliceStart >= 0) return;
      sliceStart = now();
    }
    function closeSlice() {
      if (sliceStart < 0) return;
      const start = sliceStart;
      const end = now();
      sliceStart = -1;
      const duration = end - start;
      if (!pending) {
        pending = {
          ticks: 0,
          renderStart: start,
          renderEnd: end,
          workMs: 0,
          yieldedMs: 0,
          longestSliceMs: 0,
          slices: [],
          slicesTruncated: false,
          partial: partialPending
        };
      }
      pending.ticks++;
      pending.renderEnd = end;
      pending.workMs += duration;
      if (duration > pending.longestSliceMs) pending.longestSliceMs = duration;
      if (pending.slices.length < maxSlices) pending.slices.push([start, end]);
      else pending.slicesTruncated = true;
    }
    function attachAsyncDispatcher(owner2) {
      const previous = Object.getOwnPropertyDescriptor(owner2, "A");
      if (previous && previous.configurable === false) return null;
      let stored = previous && "value" in previous ? previous.value : void 0;
      const read2 = (previous == null ? void 0 : previous.get) ? () => previous.get.call(owner2) : () => stored;
      let outer = void 0;
      function set(next) {
        const before = read2();
        if (previous == null ? void 0 : previous.set) previous.set.call(owner2, next);
        else stored = next;
        if (sliceStart < 0) {
          outer = before;
          openSlice();
        } else if (next === outer) {
          closeSlice();
        }
      }
      try {
        Object.defineProperty(owner2, "A", {
          configurable: true,
          enumerable: (previous == null ? void 0 : previous.enumerable) ?? true,
          get: read2,
          set
        });
      } catch (_) {
        return null;
      }
      return () => {
        const current = Object.getOwnPropertyDescriptor(owner2, "A");
        if ((current == null ? void 0 : current.set) !== set) return;
        const value = read2();
        if ((previous == null ? void 0 : previous.get) || (previous == null ? void 0 : previous.set)) Object.defineProperty(owner2, "A", previous);
        else Object.defineProperty(owner2, "A", { configurable: true, enumerable: (previous == null ? void 0 : previous.enumerable) ?? true, writable: true, value });
      };
    }
    function compose(slot) {
      const external = slot.external;
      if (!slot.active) return external;
      const hooks = { ...external || {} };
      hooks.markRenderStarted = function markRenderStarted(...args) {
        var _a2;
        openSlice();
        (_a2 = external == null ? void 0 : external.markRenderStarted) == null ? void 0 : _a2.call(external, ...args);
      };
      for (const name of SLICE_END_HOOKS) {
        hooks[name] = function closeRenderSlice(...args) {
          var _a2;
          closeSlice();
          (_a2 = external == null ? void 0 : external[name]) == null ? void 0 : _a2.call(external, ...args);
        };
      }
      return hooks;
    }
    function prepareRenderer(renderer) {
      if (!renderer || typeof renderer !== "object") return;
      const r = renderer;
      if (prepared.has(r) || typeof r.injectProfilingHooks !== "function") return;
      const slot = {
        original: r.injectProfilingHooks,
        external: null,
        active: false,
        wrapper: (hooks) => {
          slot.external = hooks;
          slot.original(compose(slot));
        }
      };
      prepared.set(r, slot);
      try {
        r.injectProfilingHooks = slot.wrapper;
      } catch (_) {
        prepared.delete(r);
      }
    }
    function attachProfilingHooks(r, owned) {
      if (!prepared.has(r)) {
        if (owned) return null;
        prepareRenderer(r);
      }
      const slot = prepared.get(r);
      if (!slot) return null;
      slot.active = true;
      slot.original(compose(slot));
      return () => {
        slot.active = false;
        slot.original(slot.external);
        if (r.injectProfilingHooks === slot.wrapper) r.injectProfilingHooks = slot.original;
        prepared.delete(r);
      };
    }
    function attachRenderer(renderer, attachOptions = {}) {
      if (!renderer || typeof renderer !== "object") return null;
      const r = renderer;
      const existing = sources.get(r);
      if (existing) return existing;
      const internals = r.currentDispatcherRef;
      let source = null;
      let release = null;
      if (internals && typeof internals === "object" && "H" in internals && "A" in internals) {
        if (trappedInternals.has(internals)) {
          source = "async-dispatcher";
          release = () => {
          };
        } else {
          const untrap = attachAsyncDispatcher(internals);
          if (untrap) {
            trappedInternals.add(internals);
            source = "async-dispatcher";
            release = () => {
              trappedInternals.delete(internals);
              untrap();
            };
          } else {
            lastFailure = "React 19 async dispatcher slot is not configurable";
          }
        }
      } else if (typeof r.injectProfilingHooks === "function") {
        release = attachProfilingHooks(r, !!attachOptions.profilingHooksOwned);
        if (release) source = "profiling-hooks";
        else lastFailure = "React DevTools attached to this React 18 renderer before Avalanche and owns its profiling hooks; reload with Avalanche armed";
      } else {
        lastFailure = "this React build exposes no render-slice signal (React 18 production builds have none)";
      }
      if (!source || !release) return null;
      sources.set(r, source);
      releases.set(r, release);
      if (attachOptions.late) partialPending = true;
      return source;
    }
    function takeCommitTicks() {
      if (sources.size === 0) return null;
      const taken = pending;
      pending = null;
      partialPending = false;
      if (!taken) {
        return {
          ticks: 0,
          renderStart: -1,
          renderEnd: -1,
          workMs: 0,
          yieldedMs: 0,
          longestSliceMs: 0,
          slices: [],
          slicesTruncated: false,
          partial: true
        };
      }
      taken.yieldedMs = Math.max(0, taken.renderEnd - taken.renderStart - taken.workMs);
      return taken;
    }
    return {
      prepareRenderer,
      attachRenderer,
      takeCommitTicks,
      status() {
        const list = Array.from(sources.values());
        return {
          available: list.length > 0,
          sources: list,
          reason: list.length > 0 ? null : lastFailure ?? "no React renderer registered with the DevTools hook"
        };
      },
      reset() {
        pending = null;
        partialPending = false;
      },
      detach() {
        for (const release of releases.values()) {
          try {
            release();
          } catch (_) {
          }
        }
        releases.clear();
        sources.clear();
        pending = null;
        sliceStart = -1;
        partialPending = false;
      }
    };
  }
  function createNameLedger(deps) {
    let written = /* @__PURE__ */ new Map();
    let renamed = /* @__PURE__ */ new Map();
    function note(name, type) {
      let types2 = written.get(name);
      if (!types2) {
        types2 = /* @__PURE__ */ new Set();
        written.set(name, types2);
      }
      types2.add(type);
    }
    function nameOf(fiber) {
      const name = deps.componentName(fiber);
      note(name, deps.typeOf(fiber));
      return name;
    }
    function types(names) {
      const out = /* @__PURE__ */ new Set();
      const add = (set) => set == null ? void 0 : set.forEach((type) => out.add(type));
      if (names === void 0) written.forEach(add);
      else for (const name of names) add(written.get(name));
      return Array.from(out);
    }
    function update() {
      const fresh = /* @__PURE__ */ new Map();
      for (const [name, types2] of written) {
        if (renamed.has(name)) continue;
        let authored = null;
        for (const type of types2) {
          const candidate = deps.minifiedNameOf(type) === name ? deps.nameOf(type) : null;
          if (candidate === null || authored !== null && candidate !== authored) {
            authored = null;
            break;
          }
          authored = candidate;
        }
        if (authored !== null && authored !== name) {
          fresh.set(name, authored);
          renamed.set(name, authored);
        }
      }
      return fresh;
    }
    function renames() {
      const out = /* @__PURE__ */ new Map();
      for (const [minifiedName, types2] of written) {
        for (const type of types2) {
          if (deps.minifiedNameOf(type) !== minifiedName) continue;
          const name = deps.nameOf(type);
          out.set(`${minifiedName}\0${name}`, { name, minifiedName });
        }
      }
      return Array.from(out.values());
    }
    function reset() {
      written = /* @__PURE__ */ new Map();
      renamed = /* @__PURE__ */ new Map();
    }
    return { note, nameOf, types, update, renames, reset };
  }
  const ANCHOR_SEPARATOR = " › ";
  function applyRecordedRenames(targets, table) {
    var _a2, _b2, _c2;
    if (table.size === 0) return 0;
    let changed = 0;
    const rename = (name) => {
      const authored = table.get(name);
      if (authored === void 0) return name;
      changed += 1;
      return authored;
    };
    const renameNamed = (item) => {
      if (item && typeof item.name === "string") item.name = rename(item.name);
    };
    const renameOwner = (owner2) => {
      if (owner2 && typeof owner2.component === "string") owner2.component = rename(owner2.component);
    };
    for (const diff of Object.values(targets.domByCommit ?? {})) {
      for (const change of diff.changes) {
        if (!change.at.includes(ANCHOR_SEPARATOR) && !table.has(change.at)) continue;
        change.at = change.at.split(ANCHOR_SEPARATOR).map(rename).join(ANCHOR_SEPARATOR);
      }
    }
    for (const events of Object.values(targets.suspenseByCommit ?? {})) {
      for (const event of events) {
        const location = event.location;
        if (!location) continue;
        if (location.fallback) location.fallback = rename(location.fallback);
        location.chain.forEach(renameNamed);
      }
    }
    for (const screen of Object.values(targets.screenByCommit ?? {})) {
      for (const region of screen.regions) region.label = rename(region.label);
    }
    for (const entry of targets.perfEntries ?? []) {
      (_a2 = entry.sources) == null ? void 0 : _a2.forEach(renameOwner);
      renameOwner(entry.target);
      renameOwner(entry.element);
    }
    for (const samples of targets.unmountSamples ?? []) samples == null ? void 0 : samples.forEach(renameNamed);
    const seenLocations = /* @__PURE__ */ new Set();
    for (const location of targets.interactionLocations ?? []) {
      if (!location || seenLocations.has(location)) continue;
      seenLocations.add(location);
      renameNamed(location.targetFiber);
      (_c2 = (_b2 = location.targetFiber) == null ? void 0 : _b2.ownerStack) == null ? void 0 : _c2.forEach(renameNamed);
    }
    return changed;
  }
  const MAX_STRING = 64;
  const MAX_KEYS = 5;
  const MAX_ITEMS$1 = 3;
  const MAX_SHARED = 1e4;
  const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;
  function createPropSummarizer() {
    const byFunctionName = /* @__PURE__ */ new Map();
    const byObjectKeys = /* @__PURE__ */ new Map();
    const byString = /* @__PURE__ */ new Map();
    const byElementType = /* @__PURE__ */ new Map();
    function shared(cache, key, build) {
      let summary = cache.get(key);
      if (summary === void 0) {
        summary = build();
        if (cache.size >= MAX_SHARED) cache.clear();
        cache.set(key, summary);
      }
      return summary;
    }
    function summarize2(value, nested = false) {
      if (value === void 0) return "undefined";
      if (value === null) return "null";
      const type = typeof value;
      if (type === "function") {
        const name = value.name || "";
        return shared(byFunctionName, name, () => name ? `function ${name}` : "function");
      }
      if (type === "string") {
        const text = value;
        if (text.length > MAX_STRING) return `${JSON.stringify(text.slice(0, MAX_STRING)).slice(0, -1)}…"(len ${text.length})`;
        return shared(byString, text, () => JSON.stringify(text));
      }
      if (type === "boolean") return value ? "true" : "false";
      if (type === "number") return String(value);
      if (type === "bigint") return `${String(value)}n`;
      if (type === "symbol") return String(value);
      if (Array.isArray(value)) {
        if (nested || value.length === 0) return `array(${value.length})`;
        const items = value.slice(0, MAX_ITEMS$1).map((item) => summarize2(item, true));
        return `array(${value.length})[${items.join(", ")}]`;
      }
      const element = elementName(value);
      if (element !== null) return shared(byElementType, element, () => `element <${element}>`);
      const keys = Object.keys(value);
      const shown = keys.length > MAX_KEYS ? keys.slice(0, MAX_KEYS) : keys;
      const shape = keys.length > MAX_KEYS ? `${shown.join("")}\0${keys.length}` : keys.join("");
      return shared(byObjectKeys, shape, () => {
        const names = shown.map((key) => PLAIN_KEY.test(key) ? key : JSON.stringify(key));
        if (keys.length > MAX_KEYS) names.push(`…+${keys.length - MAX_KEYS}`);
        return `object{${names.join(",")}}`;
      });
    }
    return (value) => summarize2(value);
  }
  function elementName(value) {
    var _a2, _b2, _c2, _d2;
    const candidate = value;
    if (typeof candidate.$$typeof !== "symbol" || !("type" in candidate)) return null;
    const type = candidate.type;
    if (typeof type === "string") return type;
    if (typeof type === "symbol") return String(type).replace(/^Symbol\((?:react\.)?(.*)\)$/, "$1");
    if (type && (typeof type === "function" || typeof type === "object")) {
      const named = type.displayName || type.name || ((_a2 = type.render) == null ? void 0 : _a2.displayName) || ((_b2 = type.render) == null ? void 0 : _b2.name) || ((_c2 = type.type) == null ? void 0 : _c2.displayName) || ((_d2 = type.type) == null ? void 0 : _d2.name);
      if (typeof named === "string" && named) return named;
    }
    return "Anonymous";
  }
  const MAX_LISTED_KEYS = 8;
  const MAX_COMPARED_KEYS = 1e3;
  const hasOwn = Object.prototype.hasOwnProperty;
  function isPlainObject(value) {
    if ("$$typeof" in value) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
  }
  function sameKeyOrder(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isScalar(value) {
    return value === null || typeof value !== "object" && typeof value !== "function";
  }
  function createPropKeyDiffer(summarize2) {
    const byCurrent = /* @__PURE__ */ new WeakMap();
    function change(key, prevValue, currentValue, missing) {
      if (missing === "prev") return { key, kind: "added", current: summarize2(currentValue) };
      if (missing === "current") return { key, kind: "removed", prev: summarize2(prevValue) };
      if (isScalar(prevValue) && isScalar(currentValue)) {
        return { key, kind: "scalar-changed", prev: summarize2(prevValue), current: summarize2(currentValue) };
      }
      return { key, kind: "ref-changed" };
    }
    function finish2(changed, count) {
      if (count === 0) return { sameShallow: true, changedKeys: changed, changedKeyCount: 0 };
      return count > changed.length ? { changedKeys: changed, changedKeyCount: count, changedKeysTruncated: true } : { changedKeys: changed, changedKeyCount: count };
    }
    function diffArrays(prev, current) {
      const length = Math.max(prev.length, current.length);
      if (length > MAX_COMPARED_KEYS) return { keysNotCompared: length };
      const changed = [];
      let count = 0;
      for (let i = 0; i < length; i++) {
        const inPrev = i < prev.length;
        const inCurrent = i < current.length;
        if (inPrev && inCurrent && Object.is(prev[i], current[i])) continue;
        count++;
        if (changed.length < MAX_LISTED_KEYS) {
          changed.push(change(String(i), prev[i], current[i], inPrev ? inCurrent ? null : "current" : "prev"));
        }
      }
      return finish2(changed, count);
    }
    function diffObjects(prev, current) {
      const prevKeys = Object.keys(prev);
      const currentKeys = Object.keys(current);
      const keys = Math.max(prevKeys.length, currentKeys.length);
      if (keys > MAX_COMPARED_KEYS) return { keysNotCompared: keys };
      const changed = [];
      let count = 0;
      if (sameKeyOrder(prevKeys, currentKeys)) {
        const prevValues = Object.values(prev);
        const currentValues = Object.values(current);
        for (let i = 0; i < prevValues.length; i++) {
          if (Object.is(prevValues[i], currentValues[i])) continue;
          count++;
          if (changed.length < MAX_LISTED_KEYS) changed.push(change(prevKeys[i], prevValues[i], currentValues[i], null));
        }
        return finish2(changed, count);
      }
      let removed = 0;
      for (let i = 0; i < prevKeys.length; i++) {
        const key = prevKeys[i];
        const inCurrent = hasOwn.call(current, key);
        if (inCurrent && Object.is(prev[key], current[key])) continue;
        count++;
        if (!inCurrent) removed++;
        if (changed.length < MAX_LISTED_KEYS) changed.push(change(key, prev[key], current[key], inCurrent ? null : "current"));
      }
      if (currentKeys.length > prevKeys.length - removed) {
        for (let i = 0; i < currentKeys.length; i++) {
          const key = currentKeys[i];
          if (hasOwn.call(prev, key)) continue;
          count++;
          if (changed.length < MAX_LISTED_KEYS) changed.push(change(key, void 0, current[key], "prev"));
        }
      }
      return finish2(changed, count);
    }
    return (prev, current) => {
      if (!prev || !current || typeof prev !== "object" || typeof current !== "object" || prev === current) return null;
      const prevIsArray = Array.isArray(prev);
      if (prevIsArray !== Array.isArray(current)) return null;
      if (!prevIsArray && (!isPlainObject(prev) || !isPlainObject(current))) return null;
      const cached = byCurrent.get(current);
      if (cached && cached.prev === prev) return cached.diff;
      let diff;
      try {
        diff = prevIsArray ? diffArrays(prev, current) : diffObjects(prev, current);
      } catch {
        return null;
      }
      byCurrent.set(current, { prev, diff });
      return diff;
    };
  }
  var __defProp$1 = Object.defineProperty;
  var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
  function summarizeFiberSource(fiber) {
    const source = getFiberSourceCandidate(fiber);
    return source ? { fileName: source.fileName, lineNumber: source.lineNumber } : null;
  }
  function createAvalancheDetector(options = {}) {
    const {
      ignore = [],
      effectThrashMode = "non-primitive",
      captureFibers = isDevelopment(),
      detectionMode = "amplifiers",
      historySize = 1,
      maxRenderedEntries = DEFAULT_MAX_RENDERED_ENTRIES
    } = options;
    const mode = detectionMode;
    let metricsAdapter = null;
    const resolveMetricsAdapter = () => options.metricsAdapter === void 0 ? getCommitMetricsAdapter() : options.metricsAdapter;
    const ignoreSet = new Set(ignore);
    let detectionLevel;
    let thrashMode;
    if (mode === true) {
      detectionLevel = "full";
      thrashMode = "full";
    } else if (mode === false) {
      detectionLevel = "stats";
      thrashMode = false;
    } else if (mode === "stats") {
      detectionLevel = "stats";
      thrashMode = false;
    } else if (mode === "sources") {
      detectionLevel = "sources";
      thrashMode = false;
    } else if (mode === "amplifiers") {
      detectionLevel = "amplifiers";
      thrashMode = "full";
    } else if (mode === "amplifierMetrics") {
      detectionLevel = "amplifierMetrics";
      thrashMode = "counts";
    } else if (mode === "full") {
      detectionLevel = "full";
      thrashMode = "full";
    }
    const enableSourceTracking = detectionLevel !== "stats";
    const enableAmplifiers = thrashMode !== false;
    const valueProvenance = /* @__PURE__ */ new WeakMap();
    class StableSourceIdManager {
      constructor() {
        __publicField$1(this, "idMap", /* @__PURE__ */ new WeakMap());
        __publicField$1(this, "typeToId", /* @__PURE__ */ new WeakMap());
        __publicField$1(this, "instanceCounters", /* @__PURE__ */ new Map());
        __publicField$1(this, "nextTypeId", 1);
        __publicField$1(this, "idToType", /* @__PURE__ */ new Map());
      }
      getSourceId(fiber, type, depth) {
        let sourceId = this.idMap.get(fiber);
        if (sourceId) return sourceId;
        if (fiber.alternate) {
          sourceId = this.idMap.get(fiber.alternate);
          if (sourceId) {
            this.idMap.set(fiber, sourceId);
            return sourceId;
          }
        }
        const canBeWeakMapKey = typeof type === "object" && type !== null || typeof type === "function";
        const weakKey = canBeWeakMapKey ? type : null;
        let typeId = weakKey ? this.typeToId.get(weakKey) : void 0;
        if (typeId === void 0) {
          typeId = this.nextTypeId++;
          if (weakKey) {
            this.typeToId.set(weakKey, typeId);
            this.idToType.set(typeId, type);
          }
        }
        const baseKey = `${typeId}@${depth}`;
        const instanceNum = this.instanceCounters.get(baseKey) || 1;
        this.instanceCounters.set(baseKey, instanceNum + 1);
        sourceId = `T${typeId}#${instanceNum}@${depth}`;
        this.idMap.set(fiber, sourceId);
        if (fiber.alternate) {
          this.idMap.set(fiber.alternate, sourceId);
        }
        return sourceId;
      }
      /** The component type behind an internal `T<typeId>#n@depth` id, or null. */
      typeOf(sourceId) {
        if (sourceId.charCodeAt(0) !== 84) return null;
        const typeId = Number(sourceId.slice(1, sourceId.indexOf("#")));
        return this.idToType.get(typeId) ?? null;
      }
      /** Every component type given a source id since the last clear. */
      types() {
        return this.idToType.values();
      }
      clear() {
        this.idMap = /* @__PURE__ */ new WeakMap();
        this.instanceCounters.clear();
        this.typeToId = /* @__PURE__ */ new WeakMap();
        this.idToType.clear();
        this.nextTypeId = 1;
      }
    }
    const sourceIdManager = new StableSourceIdManager();
    const nameOfType2 = (type) => getComponentName({ type });
    const renderedNames = createRenderedNames({
      typeOf: (sourceId) => sourceIdManager.typeOf(sourceId),
      types: () => sourceIdManager.types(),
      nameOf: nameOfType2,
      minifiedNameOf: minifiedComponentName
    });
    const recordedNames = createNameLedger({
      componentName: getComponentName,
      typeOf: (fiber) => fiber.type,
      nameOf: nameOfType2,
      minifiedNameOf: minifiedComponentName
    });
    const noteRecordedName = (name, type) => recordedNames.note(name, type);
    const debugRender = createDebugRender();
    const interactionCapture = createInteractionCapture(options, noteRecordedName);
    const networkCapture = createNetworkCapture(options);
    const perfCapture = createPerfCapture(options, recordedNames.nameOf);
    const screenCapture = createScreenCapture(options, void 0, recordedNames.nameOf);
    const domDiff = createDomDiffCapture(options, void 0, recordedNames.nameOf);
    const hookRunner = createAvalancheHookRunner();
    const paintTracker = createPaintTracker((ids, paintAt) => {
      for (const id of ids) {
        const timing = state2.commitTimings[id];
        if (timing) timing.paintAt = paintAt;
      }
    });
    let boundaryIds = /* @__PURE__ */ new WeakMap();
    let nextBoundaryId = 1;
    const boundaryId = (fiber) => {
      let id = boundaryIds.get(fiber) ?? (fiber.alternate ? boundaryIds.get(fiber.alternate) : void 0);
      if (id === void 0) id = nextBoundaryId++;
      boundaryIds.set(fiber, id);
      if (fiber.alternate) boundaryIds.set(fiber.alternate, id);
      return id;
    };
    function getComponentDisplayName(type) {
      if (!type) return "Unknown";
      return type.displayName || type.name || String(type);
    }
    function isDebugInternalFrame(frame2, componentName) {
      var _a2, _b2;
      const name = frame2.name || "";
      return !!((_b2 = (_a2 = metricsAdapter ?? resolveMetricsAdapter()) == null ? void 0 : _a2.frameFilters) == null ? void 0 : _b2.includes(name)) || name === "record" || name === componentName || name.includes("react-dom") || name.includes("renderWithHooks") || name.includes("mount") || name.includes("update");
    }
    function parentFramesForEvent(event, componentName) {
      return event.frames.filter((frame2) => !isDebugInternalFrame(frame2, componentName));
    }
    function captureMetricsSnapshot() {
      return (metricsAdapter == null ? void 0 : metricsAdapter.snapshot()) ?? null;
    }
    const lastSeenHookState = /* @__PURE__ */ new WeakMap();
    function captureHookStateSnapshot(fiber) {
      const snapshot = [];
      let hook = fiber.memoizedState;
      while (hook) {
        snapshot.push(hook.memoizedState);
        hook = hook.next;
      }
      return snapshot;
    }
    function detectChangesFromLastSeen(fiber, currentSnapshot) {
      const lastSeen = lastSeenHookState.get(fiber) || fiber.alternate && lastSeenHookState.get(fiber.alternate);
      const changedIndices = [];
      const changedHooks = [];
      if (!lastSeen) {
        return { changedIndices, changedHooks };
      }
      const maxLen = Math.max(lastSeen.length, currentSnapshot.length);
      for (let i = 0; i < maxLen; i++) {
        const prev = lastSeen[i];
        const curr = currentSnapshot[i];
        if (!Object.is(prev, curr)) {
          changedIndices.push(i);
          changedHooks.push({ prevValue: prev, currentValue: curr });
        }
      }
      return { changedIndices, changedHooks };
    }
    const state2 = {
      commits: 0,
      sources: /* @__PURE__ */ new Map(),
      amplifiers: /* @__PURE__ */ new Map(),
      amplifierSources: /* @__PURE__ */ new Map(),
      thrashCounts: thrashMode === "counts" ? { totalHooks: 0, affectedComponents: /* @__PURE__ */ new Set() } : null,
      memoizedUpdatersAvailable: false,
      commitsWithMemoizedUpdaters: 0,
      // Per-commit stats: [collateral, effects, memos, callbacks]
      commitStats: {},
      // Per-commit adapter counter deltas
      metricsByCommit: {},
      lastMetricsSnapshot: null,
      // Per-commit timing data
      commitTimings: {},
      lastCommitEndTime: performance.now(),
      // Per-commit Suspense boundary transitions
      suspenseByCommit: {},
      unmountsByCommit: {},
      interactionActions: interactionCapture.state.actions,
      interactionsByCommit: interactionCapture.state.byCommit,
      networkRequests: networkCapture.requests,
      perfEntries: perfCapture.entries,
      screenByCommit: screenCapture.byCommit,
      domByCommit: domDiff.byCommit,
      renderedByCommit: {}
    };
    const renderedEvidence = createRenderedEvidenceStore(state2.renderedByCommit, maxRenderedEntries);
    function trimHistoryToSize(updHistory, limit) {
      const keys = Object.keys(updHistory).map(Number).sort((a, b) => a - b);
      const keysToKeep = keys.slice(keys.length - limit);
      const trimmed = {};
      keysToKeep.forEach((key) => {
        trimmed[key] = updHistory[key];
      });
      return trimmed;
    }
    function findLastConcreteHook(history, hookIndex, beforeCommitId) {
      const commitIds = Object.keys(history).map(Number).filter((id) => id < beforeCommitId).sort((a, b) => b - a);
      for (const commitId of commitIds) {
        const entry = history[commitId];
        if (entry && entry !== "repeat" && typeof entry !== "string") {
          const prev = entry[hookIndex];
          if (prev && prev !== "repeat" && typeof prev === "object") return prev;
        }
      }
      return null;
    }
    const summarizePropValue = createPropSummarizer();
    const diffPropKeys = enableSourceTracking ? createPropKeyDiffer(summarizePropValue) : null;
    function diffProps(prevProps, currentProps) {
      const changes = [];
      if (prevProps === currentProps) return changes;
      const prev = prevProps && typeof prevProps === "object" ? prevProps : {};
      const current = currentProps && typeof currentProps === "object" ? currentProps : {};
      const hasOwn2 = Object.prototype.hasOwnProperty;
      for (const name in prev) {
        if (!hasOwn2.call(prev, name)) continue;
        const prevValue = prev[name];
        if (!hasOwn2.call(current, name)) {
          changes.push({ name, kind: "removed", prev: summarizePropValue(prevValue) });
          continue;
        }
        const currentValue = current[name];
        if (Object.is(prevValue, currentValue)) continue;
        const isRef = prevValue !== null && currentValue !== null && (typeof prevValue === "object" || typeof prevValue === "function" || typeof currentValue === "object" || typeof currentValue === "function");
        const currentSummary = summarizePropValue(currentValue);
        const prevSummary = typeof prevValue === "function" && typeof currentValue === "function" && prevValue.name === currentValue.name ? currentSummary : summarizePropValue(prevValue);
        if (!isRef) {
          changes.push({ name, kind: "scalar-changed", prev: prevSummary, current: currentSummary });
          continue;
        }
        const refChange = prevSummary === currentSummary ? { name, kind: "ref-changed", current: currentSummary } : { name, kind: "ref-changed", prev: prevSummary, current: currentSummary };
        const keyDiff = diffPropKeys == null ? void 0 : diffPropKeys(prevValue, currentValue);
        changes.push(keyDiff ? Object.assign(refChange, keyDiff) : refChange);
      }
      for (const name in current) {
        if (!hasOwn2.call(current, name) || hasOwn2.call(prev, name)) continue;
        changes.push({ name, kind: "added", current: summarizePropValue(current[name]) });
      }
      return changes;
    }
    function pushUpdateHistory(updHistory, commitId, changedHookIndices, changedHooks) {
      const entry = {};
      for (let i = 0; i < changedHookIndices.length; i++) {
        const hookIndex = changedHookIndices[i];
        const hook = changedHooks[i];
        if (hook === "repeat") {
          entry[hookIndex] = "repeat";
        } else {
          const prevConcrete = findLastConcreteHook(updHistory, hookIndex, commitId);
          entry[hookIndex] = prevConcrete && typeof prevConcrete === "object" && Object.is(hook.prevValue, prevConcrete.prevValue) && Object.is(hook.currentValue, prevConcrete.currentValue) ? "repeat" : hook;
        }
      }
      const newEntry = Object.values(entry).every((v) => v === "repeat") ? "repeat" : entry;
      return { ...updHistory, [commitId]: newEntry };
    }
    function recordTree(rootFiber, memoizedUpdaters = null) {
      if (memoizedUpdaters && memoizedUpdaters.size > 0) {
        state2.memoizedUpdatersAvailable = true;
        state2.commitsWithMemoizedUpdaters++;
      }
      const perCommit = {
        selfUpdated: /* @__PURE__ */ new Map(),
        thrashing: /* @__PURE__ */ new Map(),
        /** Linked thrashing: keyed by sourceId, tracks per-component thrashing with linkage */
        linkedThrashing: /* @__PURE__ */ new Map(),
        rendered: [],
        // Index into `rendered` by sourceId; a linear search per fiber made the
        // walk quadratic in rendered components.
        renderedIndexBySourceId: /* @__PURE__ */ new Map(),
        selfFibers: /* @__PURE__ */ new WeakMap(),
        sourceFibers: /* @__PURE__ */ new Set(),
        // Track source fibers to exclude from collateral count
        blastBySourceId: /* @__PURE__ */ new Map(),
        depthBySourceId: /* @__PURE__ */ new Map(),
        // Simple counts for commitStats
        totalCollateral: 0,
        committedComponentCount: 0,
        // Components with PerformedWork that committed
        effectCount: 0,
        memoCount: 0,
        callbackCount: 0,
        contextUpdates: 0,
        // Unmount tracking (populated by deletions-array walk in visit())
        unmountedComponents: 0,
        unmountedSubtrees: 0,
        // Bounded identity samples for branch starts (topmost component fibers in
        // each deleted subtree). Cap to keep payload small.
        unmountSamples: null,
        // Suspense boundary transition events collected during this commit's visit pass
        suspenseEvents: null
      };
      function visit(fiber, depth = 0, currentOwnerSourceId = null) {
        if (!fiber) return;
        const hasWorkInSubtree = (
          // eslint-disable-next-line no-bitwise -- React fiber flags are bitmasks, bitwise AND is required
          (fiber.flags & PerformedWork) !== 0 || // eslint-disable-next-line no-bitwise
          (fiber.subtreeFlags & PerformedWork) !== 0 || // fiber.flags & ChildDeletion = this fiber has children being deleted this commit
          // (React sets ChildDeletion on fiber.flags, NOT subtreeFlags, at commit time)
          // eslint-disable-next-line no-bitwise
          (fiber.flags & ChildDeletion) !== 0 || // subtreeFlags propagation — some descendant has deletions
          // eslint-disable-next-line no-bitwise
          (fiber.subtreeFlags & ChildDeletion) !== 0 || // Suspense transitioning: React sets Update (4) on the Suspense fiber's flags at commit.
          // eslint-disable-next-line no-bitwise
          isSuspenseFiber(fiber.tag) && (fiber.flags & Update) !== 0 || // subtreeFlags & Update: a descendant (e.g. Suspense) received an Update this commit.
          // React propagates subtreeFlags upward — HostRoot and all intermediate host fibers
          // will have Update bit set if any descendant has it. This ensures we don't skip
          // the path to a Suspense boundary when no PerformedWork exists higher in the tree.
          // eslint-disable-next-line no-bitwise
          (fiber.subtreeFlags & Update) !== 0
        );
        if (!hasWorkInSubtree) {
          if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
          return;
        }
        if (isContextProviderFiber(fiber.tag) && didContextValueChange(fiber)) {
          perCommit.contextUpdates++;
        }
        if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions && fiber.deletions.length > 0) {
          for (let di = 0; di < fiber.deletions.length; di++) {
            let collectDeletions = function(df, parentIsComponent, branchStartDepth, currentBranch) {
              const dfIsComponent = isComponentFiber$1(df.tag);
              let nextBranch = currentBranch;
              if (dfIsComponent) {
                perCommit.unmountedComponents++;
                if (!parentIsComponent) {
                  perCommit.unmountedSubtrees++;
                  if (perCommit.unmountSamples == null) perCommit.unmountSamples = [];
                  if (perCommit.unmountSamples.length < 30) {
                    const fiberKey = df.key;
                    const sample = {
                      name: recordedNames.nameOf(df),
                      key: fiberKey == null ? null : String(fiberKey),
                      depth: branchStartDepth,
                      count: 1,
                      source: summarizeFiberSource(df),
                      host: summarizeHostSubtree(df)
                    };
                    perCommit.unmountSamples.push(sample);
                    nextBranch = { count: 1, sample };
                  } else {
                    nextBranch = null;
                  }
                } else if (currentBranch && currentBranch.sample) {
                  currentBranch.sample.count++;
                }
                lastSeenHookState.delete(df);
                if (df.alternate) lastSeenHookState.delete(df.alternate);
              }
              if (df.child) collectDeletions(df.child, dfIsComponent, branchStartDepth + 1, nextBranch);
              if (df.sibling) collectDeletions(df.sibling, parentIsComponent, branchStartDepth, currentBranch);
            };
            const deleted = fiber.deletions[di];
            if (perCommit.unmountSamples == null) perCommit.unmountSamples = [];
            if (perCommit.unmountSamples.length < 30) {
              let labelFiber2 = deleted;
              if (!isComponentFiber$1(labelFiber2.tag)) {
                const stack = [labelFiber2];
                labelFiber2 = null;
                while (stack.length) {
                  const f = stack.pop();
                  if (isComponentFiber$1(f.tag)) {
                    labelFiber2 = f;
                    break;
                  }
                  if (f.child) stack.push(f.child);
                  if (f.sibling) stack.push(f.sibling);
                }
              }
              if (labelFiber2) {
                const counts = countUnmountedComponentSubtree(deleted);
                const fiberKey = labelFiber2.key;
                perCommit.unmountSamples.push({
                  name: recordedNames.nameOf(labelFiber2),
                  key: fiberKey == null ? null : String(fiberKey),
                  depth,
                  count: counts.components,
                  source: summarizeFiberSource(labelFiber2),
                  host: summarizeHostSubtree(deleted)
                });
              }
            }
            collectDeletions(deleted, false, depth, null);
          }
        }
        const isComponent = isComponentFiber$1(fiber.tag);
        let ownerSourceId = currentOwnerSourceId;
        if (isSuspenseFiber(fiber.tag)) {
          const suspenseChange = didSuspenseStateChange(fiber);
          if (suspenseChange) {
            if (!perCommit.suspenseEvents) {
              perCommit.suspenseEvents = [];
            }
            const event = {
              depth,
              boundary: boundaryId(fiber),
              entered: suspenseChange.entered,
              left: suspenseChange.left,
              location: describeSuspenseLocation(fiber, void 0, void 0, recordedNames.nameOf, noteRecordedName),
              ...captureFibers && { fiber }
            };
            perCommit.suspenseEvents.push(event);
            if (enableSourceTracking) {
              const suspenseType = fiber.type;
              const sourceId = sourceIdManager.getSourceId(fiber, suspenseType, depth);
              const suspenseHook = {
                prevValue: suspenseChange.left ? "suspended" : null,
                currentValue: suspenseChange.entered ? "suspended" : null,
                info: suspenseChange.entered ? "suspense:entered-fallback" : "suspense:left-fallback"
              };
              perCommit.selfUpdated.set(sourceId, {
                type: suspenseType,
                depth,
                count: 1,
                changedHookIndices: [0],
                changedHooks: [suspenseHook],
                fiber: captureFibers ? fiber : void 0,
                isUpdater: true
              });
              ownerSourceId = sourceId;
            }
          }
        }
        if (isComponent) {
          const type = fiber.type;
          if (didFiberUpdate(fiber)) {
            perCommit.committedComponentCount++;
          }
          if (!didFiberUpdate(fiber)) {
            if (fiber.child) visit(fiber.child, depth + 1, ownerSourceId);
            if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
            return;
          }
          if (!ignoreSet.has(type) && !isReactInternalComponentType(type)) {
            const componentSourceId = sourceIdManager.getSourceId(fiber, type, depth);
            const parentFiber = fiber.return && isComponentFiber$1(fiber.return.tag) ? fiber.return : null;
            const parentSourceId = parentFiber ? sourceIdManager.getSourceId(parentFiber, parentFiber.type, depth - 1) : null;
            const existingRenderEvidenceIndex = perCommit.renderedIndexBySourceId.get(componentSourceId) ?? -1;
            const initialRenderEvidence = {
              sourceId: componentSourceId,
              name: getComponentName(fiber),
              depth
            };
            renderedNames.note(initialRenderEvidence);
            if (parentSourceId) initialRenderEvidence.parentSourceId = parentSourceId;
            if (fiber.alternate) {
              const propChanges2 = diffProps(fiber.alternate.memoizedProps, fiber.memoizedProps);
              if (propChanges2.length) initialRenderEvidence.propChanges = propChanges2;
            }
            if (existingRenderEvidenceIndex >= 0) {
              perCommit.rendered[existingRenderEvidenceIndex] = initialRenderEvidence;
            } else {
              perCommit.renderedIndexBySourceId.set(componentSourceId, perCommit.rendered.length);
              perCommit.rendered.push(initialRenderEvidence);
            }
            if (enableAmplifiers) {
              let hook = fiber.memoizedState;
              let hookIndex = 0;
              while (hook) {
                const ms2 = hook.memoizedState;
                if (Array.isArray(ms2) && ms2.length === 2 && Array.isArray(ms2[1])) {
                  const result = ms2[0];
                  if (result != null && (typeof result === "object" || typeof result === "function")) {
                    valueProvenance.set(result, {
                      type,
                      hookIndex,
                      depth,
                      hookType: typeof result === "function" ? "useCallback" : "useMemo"
                    });
                  }
                }
                hook = hook.next;
                hookIndex++;
              }
            }
            let currentHookSnapshot = null;
            if (enableSourceTracking) {
              currentHookSnapshot = captureHookStateSnapshot(fiber);
            }
            let isRealSource = false;
            let changedIndices = [];
            let changedHooks = [];
            if (enableSourceTracking) {
              const inMemoizedUpdaters = memoizedUpdaters ? memoizedUpdaters.has(fiber) || fiber.alternate && memoizedUpdaters.has(fiber.alternate) : null;
              if (memoizedUpdaters) {
                if (inMemoizedUpdaters) {
                  isRealSource = true;
                  const selfUpdateResult = didFiberSelfUpdate(fiber);
                  if (selfUpdateResult && selfUpdateResult.actionable) {
                    changedIndices = selfUpdateResult.changedIndices;
                    changedHooks = selfUpdateResult.changedHooks;
                  }
                }
              } else {
                const changes = detectChangesFromLastSeen(fiber, currentHookSnapshot);
                if (changes.changedIndices.length > 0) {
                  isRealSource = true;
                  changedIndices = changes.changedIndices;
                  changedHooks = changes.changedHooks;
                }
              }
              lastSeenHookState.set(fiber, currentHookSnapshot);
              if (fiber.alternate) {
                lastSeenHookState.set(fiber.alternate, currentHookSnapshot);
              }
            }
            if (isRealSource && changedIndices.length > 0) {
              const sourceId = componentSourceId;
              perCommit.sourceFibers.add(fiber);
              if (fiber.alternate) {
                perCommit.sourceFibers.add(fiber.alternate);
              }
              const existing = perCommit.selfUpdated.get(sourceId);
              const updateData = {
                type,
                depth,
                count: ((existing == null ? void 0 : existing.count) || 0) + 1,
                changedHookIndices: changedIndices,
                changedHooks,
                fiber: captureFibers ? fiber : void 0,
                isUpdater: true
              };
              perCommit.selfUpdated.set(sourceId, updateData);
              perCommit.selfFibers.set(fiber, depth);
              ownerSourceId = sourceId;
            }
            const isSourceItself = perCommit.sourceFibers.has(fiber);
            const isNonPreventable = (fiber.flags & (Placement | Hydrating)) !== 0;
            if (isComponent && fiber.alternate && didFiberUpdate(fiber) && ownerSourceId && !isSourceItself && !isNonPreventable) {
              perCommit.blastBySourceId.set(
                ownerSourceId,
                (perCommit.blastBySourceId.get(ownerSourceId) || 0) + 1
              );
              const currentMax = perCommit.depthBySourceId.get(ownerSourceId) || 0;
              if (depth > currentMax) {
                perCommit.depthBySourceId.set(ownerSourceId, depth);
              }
              perCommit.totalCollateral++;
            }
            const renderedIndex = perCommit.renderedIndexBySourceId.get(componentSourceId);
            const renderedEntry = renderedIndex === void 0 ? void 0 : perCommit.rendered[renderedIndex];
            if (renderedEntry) {
              if (ownerSourceId) renderedEntry.ownerSourceId = ownerSourceId;
              else if (renderedEntry.ownerSourceId !== void 0) delete renderedEntry.ownerSourceId;
              if (isRealSource && changedIndices.length > 0) renderedEntry.isSelfSource = true;
              else if (renderedEntry.isSelfSource) delete renderedEntry.isSelfSource;
            }
            if (enableAmplifiers && didFiberUpdate(fiber) && fiber.alternate) {
              const thrashResult = detectHookThrashing(
                fiber.alternate.memoizedState,
                fiber.memoizedState,
                effectThrashMode,
                valueProvenance
              );
              const totalThrashing = thrashResult.effects.length + thrashResult.callbacks.length + thrashResult.memos.length;
              if (totalThrashing > 0) {
                if (thrashMode === "counts") {
                  if (state2.thrashCounts) {
                    state2.thrashCounts.affectedComponents.add(type);
                    state2.thrashCounts.totalHooks += totalThrashing;
                  }
                } else if (thrashMode === "full") {
                  const allThrashedHooks = [
                    ...thrashResult.effects,
                    ...thrashResult.callbacks,
                    ...thrashResult.memos
                  ];
                  const existing = perCommit.thrashing.get(type);
                  const thrashData = {
                    instanceCount: ((existing == null ? void 0 : existing.instanceCount) || 0) + 1,
                    hookCount: ((existing == null ? void 0 : existing.hookCount) || 0) + totalThrashing,
                    lastAmplification: {
                      depth,
                      thrashedHooks: allThrashedHooks,
                      fiber: captureFibers ? fiber : void 0
                    }
                  };
                  perCommit.thrashing.set(type, thrashData);
                  const amplifierSourceId = sourceIdManager.getSourceId(fiber, type, depth);
                  const existingLinked = perCommit.linkedThrashing.get(amplifierSourceId);
                  const effects = ((existingLinked == null ? void 0 : existingLinked.effects) || 0) + thrashResult.effects.length;
                  const callbacks = ((existingLinked == null ? void 0 : existingLinked.callbacks) || 0) + thrashResult.callbacks.length;
                  const memos = ((existingLinked == null ? void 0 : existingLinked.memos) || 0) + thrashResult.memos.length;
                  perCommit.linkedThrashing.set(amplifierSourceId, {
                    type,
                    depth,
                    effects,
                    callbacks,
                    memos,
                    // If this fiber is a source, causedBySourceId is null (self-caused)
                    // If this fiber is collateral, ownerSourceId is who caused it
                    causedBySourceId: isRealSource ? null : ownerSourceId,
                    lastAmplification: {
                      depth,
                      thrashedHooks: allThrashedHooks,
                      fiber: captureFibers ? fiber : void 0
                    }
                  });
                  const amplifierIndex = perCommit.renderedIndexBySourceId.get(amplifierSourceId);
                  const renderedEntry2 = amplifierIndex === void 0 ? void 0 : perCommit.rendered[amplifierIndex];
                  if (renderedEntry2 && (effects || callbacks || memos)) {
                    renderedEntry2.trasherCounts = { effects, callbacks, memos };
                  }
                  perCommit.effectCount += thrashResult.effects.length;
                  perCommit.memoCount += thrashResult.memos.length;
                  perCommit.callbackCount += thrashResult.callbacks.length;
                }
              }
            }
          }
        }
        if (fiber.child) visit(fiber.child, depth + 1, ownerSourceId);
        if (fiber.sibling) visit(fiber.sibling, depth, currentOwnerSourceId);
      }
      visit(rootFiber);
      state2.commits++;
      for (const [sourceId, data] of perCommit.selfUpdated.entries()) {
        const { type, depth, count, changedHookIndices, fiber } = data;
        let s = state2.sources.get(sourceId);
        if (!s) {
          s = {
            type,
            depth,
            renderCount: 0,
            causedUpdates: 0,
            collateralUpdates: 0,
            maxCollateralUpdates: 0,
            maxPenetrationDepth: 0,
            updateHistory: {},
            collateralByCommit: {},
            // Per-commit collateral for this source
            debugHookIndices: changedHookIndices.slice()
          };
          state2.sources.set(sourceId, s);
        }
        s.renderCount++;
        s.debugHookIndices = changedHookIndices.slice();
        const historyWithUpdate = pushUpdateHistory(
          s.updateHistory,
          state2.commits,
          changedHookIndices,
          data.changedHooks
        );
        s.updateHistory = trimHistoryToSize(historyWithUpdate, historySize);
        const thisCommitEntry = s.updateHistory[state2.commits];
        const isRepeat = thisCommitEntry === "repeat";
        if (!isRepeat && data.isUpdater) {
          s.causedUpdates += count;
          const blast = perCommit.blastBySourceId.get(sourceId) || 0;
          s.collateralUpdates += blast;
          if (blast > s.maxCollateralUpdates) s.maxCollateralUpdates = blast;
          s.collateralByCommit[state2.commits] = blast;
          const penetrationDepth = perCommit.depthBySourceId.get(sourceId) || 0;
          if (penetrationDepth > s.maxPenetrationDepth) {
            s.maxPenetrationDepth = penetrationDepth;
          }
        }
        if (captureFibers && fiber) {
          s.fiber = fiber;
        }
      }
      if (enableAmplifiers && thrashMode === "full") {
        for (const [type, data] of perCommit.thrashing.entries()) {
          let s = state2.amplifiers.get(type);
          if (!s) {
            s = {
              renderCount: 0,
              instancesTotal: 0,
              maxInstancesPerCommit: 0,
              hooksTotal: 0,
              maxHooksPerCommit: 0,
              effectCount: 0,
              callbackCount: 0,
              memoCount: 0,
              lastAmplification: { depth: 0, thrashedHooks: [] }
            };
            state2.amplifiers.set(type, s);
          }
          s.renderCount++;
          s.instancesTotal += data.instanceCount;
          s.hooksTotal += data.hookCount;
          if (data.instanceCount > s.maxInstancesPerCommit)
            s.maxInstancesPerCommit = data.instanceCount;
          if (data.hookCount > s.maxHooksPerCommit) s.maxHooksPerCommit = data.hookCount;
          data.lastAmplification.thrashedHooks.forEach((hook) => {
            if (hook.hookType === "effect") s.effectCount++;
            else if (hook.hookType === "callback") s.callbackCount++;
            else if (hook.hookType === "memo") s.memoCount++;
          });
          s.lastAmplification = data.lastAmplification;
        }
        for (const [sourceId, data] of perCommit.linkedThrashing.entries()) {
          let as = state2.amplifierSources.get(sourceId);
          if (!as) {
            as = {
              type: data.type,
              depth: data.depth,
              effectCount: 0,
              callbackCount: 0,
              memoCount: 0,
              hooksTotal: 0,
              commitIds: [],
              byCommit: {},
              causedBySourceId: data.causedBySourceId,
              lastAmplification: { depth: 0, thrashedHooks: [] }
            };
            state2.amplifierSources.set(sourceId, as);
          }
          as.effectCount += data.effects;
          as.callbackCount += data.callbacks;
          as.memoCount += data.memos;
          as.hooksTotal += data.effects + data.callbacks + data.memos;
          if (!as.commitIds.includes(state2.commits)) {
            as.commitIds.push(state2.commits);
          }
          as.byCommit[state2.commits] = {
            effects: data.effects,
            callbacks: data.callbacks,
            memos: data.memos
          };
          if (data.causedBySourceId !== null) {
            as.causedBySourceId = data.causedBySourceId;
          }
          as.lastAmplification = data.lastAmplification;
        }
      }
      if (perCommit.suspenseEvents && perCommit.suspenseEvents.length > 0) {
        state2.suspenseByCommit[state2.commits] = perCommit.suspenseEvents;
      }
      if (perCommit.rendered.length > 0) {
        renderedEvidence.add(state2.commits, perCommit.rendered);
      }
      state2.commitStats[state2.commits] = [
        perCommit.totalCollateral,
        perCommit.selfUpdated.size,
        // Number of sources in this commit
        0,
        // restarts - will be updated after the adapter's delta calculation
        perCommit.committedComponentCount,
        // performedWork - components with PerformedWork flag
        perCommit.effectCount,
        perCommit.memoCount,
        perCommit.callbackCount,
        perCommit.contextUpdates,
        perCommit.unmountedComponents,
        perCommit.unmountedSubtrees
      ];
      if (perCommit.unmountSamples && perCommit.unmountSamples.length > 0) {
        state2.unmountsByCommit[state2.commits] = perCommit.unmountSamples;
      }
      return perCommit.committedComponentCount;
    }
    let pausedAt = null;
    function skipPausedCommit() {
      renderTicks.takeCommitTicks();
      state2.lastMetricsSnapshot = captureMetricsSnapshot();
      state2.lastCommitEndTime = performance.now();
      pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
      pendingDevtoolsUnmountSamples = [];
    }
    function captureStatus() {
      return { paused: pausedAt !== null, pausedAt: pausedAt === null ? null : Math.round(pausedAt * 10) / 10 };
    }
    function resumeCapture() {
      pausedAt = null;
      interactionCapture.resume();
      networkCapture.resume();
      perfCapture.resume();
    }
    function resetState() {
      resumeCapture();
      state2.commits = 0;
      state2.sources.clear();
      state2.amplifiers.clear();
      state2.amplifierSources.clear();
      if (state2.thrashCounts) {
        state2.thrashCounts.totalHooks = 0;
        state2.thrashCounts.affectedComponents.clear();
      }
      state2.memoizedUpdatersAvailable = false;
      state2.commitsWithMemoizedUpdaters = 0;
      for (const key of Object.keys(state2.commitStats)) {
        delete state2.commitStats[Number(key)];
      }
      for (const key of Object.keys(state2.metricsByCommit)) {
        delete state2.metricsByCommit[Number(key)];
      }
      for (const key of Object.keys(state2.commitTimings)) {
        delete state2.commitTimings[Number(key)];
      }
      for (const key of Object.keys(state2.suspenseByCommit)) {
        delete state2.suspenseByCommit[Number(key)];
      }
      for (const key of Object.keys(state2.unmountsByCommit)) {
        delete state2.unmountsByCommit[Number(key)];
      }
      renderedEvidence.reset();
      interactionCapture.reset();
      networkCapture.reset();
      perfCapture.reset();
      screenCapture.reset();
      domDiff.reset();
      paintTracker.reset();
      hookRunner.start();
      boundaryIds = /* @__PURE__ */ new WeakMap();
      nextBoundaryId = 1;
      state2.lastMetricsSnapshot = captureMetricsSnapshot();
      state2.lastCommitEndTime = performance.now();
      renderTicks.reset();
      sourceIdManager.clear();
      renderedNames.reset();
      recordedNames.reset();
    }
    function refreshComponentNames() {
      renderedNames.refresh(state2.renderedByCommit);
      applyRecordedRenames(
        {
          domByCommit: state2.domByCommit,
          suspenseByCommit: state2.suspenseByCommit,
          screenByCommit: state2.screenByCommit,
          perfEntries: state2.perfEntries,
          unmountSamples: [...Object.values(state2.unmountsByCommit), pendingDevtoolsUnmountSamples],
          interactionLocations: [
            ...interactionCapture.state.actions,
            ...Object.values(interactionCapture.state.byCommit).flat()
          ].map((action) => action.location)
        },
        recordedNames.update()
      );
      const all = /* @__PURE__ */ new Map();
      for (const rename of [...renderedNames.renames(), ...recordedNames.renames()]) {
        all.set(`${rename.minifiedName}\0${rename.name}`, rename);
      }
      return Array.from(all.values());
    }
    const commitSurface = createCommitSurfaceOwnership();
    const renderTicks = createRenderTickTracker();
    let devtoolsInjectPrev;
    let devtoolsInjectWrapper;
    let devtoolsHookPrev;
    let devtoolsUnmountPrev;
    let devtoolsHookCreatedByUs = false;
    let pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
    let pendingDevtoolsUnmountSamples = [];
    let integrationMode = "none";
    function countUnmountedComponentSubtree(fiber, parentIsComponent = false) {
      if (!fiber) return { components: 0, subtrees: 0 };
      const isComponent = isComponentFiber$1(fiber.tag);
      let components = isComponent ? 1 : 0;
      let subtrees = isComponent && !parentIsComponent ? 1 : 0;
      if (fiber.child) {
        const child = countUnmountedComponentSubtree(fiber.child, isComponent);
        components += child.components;
        subtrees += child.subtrees;
      }
      if (fiber.sibling) {
        const sibling = countUnmountedComponentSubtree(fiber.sibling, parentIsComponent);
        components += sibling.components;
        subtrees += sibling.subtrees;
      }
      return { components, subtrees };
    }
    function summarizeHostSubtree(fiber) {
      const tags = /* @__PURE__ */ new Map();
      const testIds = /* @__PURE__ */ new Map();
      const roles = /* @__PURE__ */ new Map();
      const ariaLabels = [];
      const textHints = [];
      let elements = 0;
      let text = 0;
      const add = (map, key) => {
        if (typeof key !== "string" || !key) return;
        map.set(key, (map.get(key) || 0) + 1);
      };
      const addHint = (arr, value, max = 6) => {
        if (typeof value !== "string") return;
        const trimmed = value.replace(/\s+/g, " ").trim();
        if (!trimmed || arr.includes(trimmed)) return;
        arr.push(trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed);
        if (arr.length > max) arr.length = max;
      };
      const top = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const walk2 = (f) => {
        if (!f) return;
        if (f.tag === 5) {
          elements++;
          const props = f.memoizedProps || {};
          add(tags, typeof f.type === "string" ? f.type : "host");
          add(testIds, props["data-testid"]);
          add(roles, props.role);
          addHint(ariaLabels, props["aria-label"]);
          addHint(ariaLabels, props.title);
          addHint(textHints, typeof props.children === "string" ? props.children : null);
        } else if (f.tag === 6) {
          text++;
          addHint(textHints, f.memoizedProps);
        }
        walk2(f.child);
        walk2(f.sibling);
      };
      walk2(fiber);
      return { elements, text, tagsTop: top(tags), testIdsTop: top(testIds), rolesTop: top(roles), ariaLabels, textHints };
    }
    function recordMetricsEvidence(commitId, committedComponents, before, after) {
      if (!metricsAdapter) return;
      const { delta, restarts } = metricsAdapter.measure(before, after, committedComponents, commitId);
      state2.metricsByCommit[commitId] = delta;
      if (state2.commitStats[commitId]) {
        state2.commitStats[commitId][CS_RESTARTS] = restarts;
      }
    }
    function handleCommit(root, metricsDeltaAvailable) {
      debugRender.install();
      const commitHookStartTime = performance.now();
      const timeSinceLastCommit = commitHookStartTime - state2.lastCommitEndTime;
      const ticks = renderTicks.takeCommitTicks();
      const metricsBefore = state2.lastMetricsSnapshot || captureMetricsSnapshot();
      const memoizedUpdaters = root.memoizedUpdaters;
      const committedComponents = recordTree(root.current, memoizedUpdaters || null);
      screenCapture.record(state2.commits, root.current);
      domDiff.record(state2.commits, root.current);
      const currentStats = state2.commitStats[state2.commits];
      if (currentStats && (pendingDevtoolsUnmounts.components > 0 || pendingDevtoolsUnmounts.subtrees > 0)) {
        const recordTreeSawDeletions = (currentStats[CS_UNMOUNTED_COMPONENTS] || 0) > 0;
        if (!recordTreeSawDeletions) {
          currentStats[CS_UNMOUNTED_COMPONENTS] = pendingDevtoolsUnmounts.components;
          currentStats[CS_UNMOUNTED_SUBTREES] = pendingDevtoolsUnmounts.subtrees;
        }
        pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
      }
      if (pendingDevtoolsUnmountSamples.length > 0) {
        const existing = state2.unmountsByCommit[state2.commits];
        if (existing && existing.length > 0) ;
        else {
          state2.unmountsByCommit[state2.commits] = pendingDevtoolsUnmountSamples;
        }
        pendingDevtoolsUnmountSamples = [];
      }
      const metricsAfter = captureMetricsSnapshot();
      if (metricsDeltaAvailable && metricsBefore && metricsAfter) {
        recordMetricsEvidence(state2.commits, committedComponents, metricsBefore, metricsAfter);
      }
      state2.lastMetricsSnapshot = metricsAfter;
      const commitHookEndTime = performance.now();
      interactionCapture.linkRecent(state2.commits, commitHookEndTime);
      state2.commitTimings[state2.commits] = {
        startTime: commitHookStartTime,
        endTime: commitHookEndTime,
        timeSinceLastCommit,
        detectorOverhead: commitHookEndTime - commitHookStartTime,
        ticks: ticks ? ticks.ticks : null,
        render: ticks
      };
      paintTracker.afterCommit(state2.commits);
      hookRunner.step({
        id: state2.commits,
        components: committedComponents,
        startTime: commitHookStartTime,
        endTime: commitHookEndTime,
        root: root.current
      });
      state2.lastCommitEndTime = commitHookEndTime;
      return committedComponents;
    }
    return {
      /**
       * Start profiling React commits.
       *
       * Integration model is OBSERVED at runtime, not declared at install time.
       *
       *   'devtools'     — DevTools `onCommitFiberRoot` is the canonical entry
       *                    point. We define the hook if absent, augment (chain)
       *                    if present. On every commit we capture the fiber tree.
       *
       *   'adapter:<id>' — Promoted from 'devtools' the first time the commit
       *                    metrics adapter's host callback actually fires for a
       *                    real commit. From then on the adapter is the
       *                    authoritative processor and the DevTools surface is
       *                    chained-observer-only. The adapter is preferred when
       *                    alive because it carries render-counter deltas
       *                    (restart math, metricsByCommit).
       *
       *   'none'         — Only when no DevTools hook surface can be created and
       *                    no adapter surface is reachable. Practically never
       *                    hit, since the content-script ships a
       *                    devtools-hook-shim before react-dom.
       *
       * Double-invocation safety:
       *   Once an adapter callback has fired, DevTools remains chained for
       *   existing tooling but does not capture commits; the adapter alone calls
       *   `handleCommit`. Without a live adapter, DevTools is the capture
       *   surface. This avoids duplicate capture without relying on per-root
       *   timing heuristics.
       *
       * Side effects:
       *   - Defines `__REACT_DEVTOOLS_GLOBAL_HOOK__` if it does not already exist
       *     (minimal contract: `onCommitFiberRoot` only). React reads the hook at
       *     module-eval time; the content-script shim handles ordering.
       *   - Asks the adapter (when one is registered) to route its host commit
       *     callback here, *if and when* the host calls it.
       *
       * Safe to call multiple times (idempotent: chains skipped when our wrappers
       * are already in place).
       */
      install() {
        resumeCapture();
        interactionCapture.install();
        networkCapture.install();
        perfCapture.install();
        hookRunner.ensureStarted();
        const devtoolsGlobal = globalThis;
        metricsAdapter = resolveMetricsAdapter();
        state2.lastMetricsSnapshot = captureMetricsSnapshot();
        let hook = devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!hook) {
          hook = {};
          devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
          devtoolsHookCreatedByUs = true;
        } else {
          devtoolsHookCreatedByUs = false;
        }
        devtoolsHookPrev = typeof hook.onCommitFiberRoot === "function" ? hook.onCommitFiberRoot : void 0;
        devtoolsUnmountPrev = typeof hook.onCommitFiberUnmount === "function" ? hook.onCommitFiberUnmount : void 0;
        const devtoolsHandler = (...args) => {
          if (devtoolsHookPrev) {
            try {
              devtoolsHookPrev(...args);
            } catch (_) {
            }
          }
          const root = args[1];
          if (!root) return;
          if (pausedAt !== null) {
            skipPausedCommit();
            return;
          }
          if (commitSurface.adapterObserved && metricsAdapter) {
            if (!metricsAdapter.isAttached()) {
              metricsAdapter.reattach();
              const metricsBefore2 = state2.lastMetricsSnapshot || captureMetricsSnapshot();
              const committedComponents2 = handleCommit(
                root,
                /* metricsDeltaAvailable */
                false
              );
              commitSurface.recordDevtools(root, { commitId: state2.commits, committedComponents: committedComponents2, metricsBefore: metricsBefore2 });
              return;
            }
            return;
          }
          const metricsBefore = state2.lastMetricsSnapshot || captureMetricsSnapshot();
          const committedComponents = handleCommit(
            root,
            /* metricsDeltaAvailable */
            false
          );
          commitSurface.recordDevtools(root, { commitId: state2.commits, committedComponents, metricsBefore });
        };
        hook.onCommitFiberRoot = devtoolsHandler;
        const devtoolsUnmountHandler = (...args) => {
          if (devtoolsUnmountPrev) {
            try {
              devtoolsUnmountPrev(...args);
            } catch (_) {
            }
          }
          const fiber = args[1];
          if (!fiber || pausedAt !== null) return;
          const counts = countUnmountedComponentSubtree(fiber);
          pendingDevtoolsUnmounts.components += counts.components;
          pendingDevtoolsUnmounts.subtrees += counts.subtrees;
          if (counts.components > 0 && pendingDevtoolsUnmountSamples.length < 30) {
            let labelFiber2 = fiber;
            if (!isComponentFiber$1(labelFiber2.tag)) {
              const stack = [labelFiber2];
              labelFiber2 = null;
              while (stack.length) {
                const f = stack.pop();
                if (isComponentFiber$1(f.tag)) {
                  labelFiber2 = f;
                  break;
                }
                if (f.child) stack.push(f.child);
                if (f.sibling) stack.push(f.sibling);
              }
            }
            if (labelFiber2) {
              const fiberKey = labelFiber2.key;
              pendingDevtoolsUnmountSamples.push({
                name: recordedNames.nameOf(labelFiber2),
                key: fiberKey == null ? null : String(fiberKey),
                depth: null,
                count: counts.components,
                source: summarizeFiberSource(labelFiber2),
                host: summarizeHostSubtree(fiber)
              });
            }
          }
          lastSeenHookState.delete(fiber);
          if (fiber.alternate) lastSeenHookState.delete(fiber.alternate);
        };
        hook.onCommitFiberUnmount = devtoolsUnmountHandler;
        if (hook.renderers && typeof hook.renderers.forEach === "function") {
          const devtoolsInterfaces = hook.rendererInterfaces;
          hook.renderers.forEach((renderer, id) => {
            renderTicks.attachRenderer(renderer, {
              late: true,
              profilingHooksOwned: devtoolsInterfaces instanceof Map && devtoolsInterfaces.has(id)
            });
          });
        }
        if (typeof hook.inject === "function" && hook.inject !== devtoolsInjectWrapper) {
          const prevInject = hook.inject;
          devtoolsInjectPrev = prevInject;
          devtoolsInjectWrapper = function inject(renderer) {
            renderTicks.prepareRenderer(renderer);
            const id = prevInject.call(this, renderer);
            renderTicks.attachRenderer(renderer);
            return id;
          };
          hook.inject = devtoolsInjectWrapper;
        }
        integrationMode = "devtools";
        commitSurface.reset();
        const adapter = metricsAdapter;
        if (adapter) {
          const adapterMode = `adapter:${adapter.id}`;
          adapter.attach((root) => {
            const previousCapture = commitSurface.observeAdapter(root);
            if (integrationMode !== adapterMode) {
              integrationMode = adapterMode;
            }
            if (pausedAt !== null) {
              skipPausedCommit();
              return;
            }
            if (previousCapture) {
              const metricsAfter = captureMetricsSnapshot();
              if (previousCapture.metricsBefore && metricsAfter) {
                recordMetricsEvidence(previousCapture.commitId, previousCapture.committedComponents, previousCapture.metricsBefore, metricsAfter);
              }
              state2.lastMetricsSnapshot = metricsAfter;
            } else {
              handleCommit(
                root,
                /* metricsDeltaAvailable */
                true
              );
            }
          });
        }
      },
      /**
       * Stop profiling React commits. Does not clear accumulated state.
       * Call reset() to clear state.
       *
       * Restores the DevTools hook to its prior state:
       *   - hook was created by us → delete the hook entirely
       *   - hook had a prior onCommitFiberRoot → restore it
       *   - hook had no handler → delete the property
       *
       * Asks the adapter to remove its host callback only if it is still ours
       * (don't stomp a concurrent installer).
       */
      uninstall() {
        metricsAdapter == null ? void 0 : metricsAdapter.detach();
        const devtoolsGlobal = globalThis;
        const hook = devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (hook) {
          if (devtoolsHookCreatedByUs) {
            delete devtoolsGlobal.__REACT_DEVTOOLS_GLOBAL_HOOK__;
          } else {
            if (devtoolsHookPrev) {
              hook.onCommitFiberRoot = devtoolsHookPrev;
            } else {
              delete hook.onCommitFiberRoot;
            }
            if (devtoolsUnmountPrev) {
              hook.onCommitFiberUnmount = devtoolsUnmountPrev;
            } else {
              delete hook.onCommitFiberUnmount;
            }
            if (devtoolsInjectPrev && hook.inject === devtoolsInjectWrapper) {
              hook.inject = devtoolsInjectPrev;
            }
          }
        }
        renderTicks.detach();
        devtoolsInjectPrev = void 0;
        devtoolsInjectWrapper = void 0;
        debugRender.uninstall();
        interactionCapture.uninstall();
        networkCapture.uninstall();
        perfCapture.uninstall();
        commitSurface.reset();
        pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
        pendingDevtoolsUnmountSamples = [];
        devtoolsHookPrev = void 0;
        devtoolsUnmountPrev = void 0;
        devtoolsHookCreatedByUs = false;
        integrationMode = "none";
        pausedAt = null;
      },
      /**
       * Stop adding to the capture while staying attached, so every reader sees
       * the capture as it stood at this moment. Requests already in flight still
       * finish into it. reset() or resume() starts recording again.
       */
      pause() {
        if (pausedAt !== null) return;
        pausedAt = performance.now();
        interactionCapture.pause();
        networkCapture.pause();
        perfCapture.pause();
      },
      /** Record again after pause(), keeping what the capture already holds. */
      resume() {
        if (pausedAt === null) return;
        resumeCapture();
        skipPausedCommit();
      },
      /**
       * Clear all accumulated profiling state. Useful for starting fresh measurements.
       * Does not uninstall the profiler - call uninstall() separately if needed.
       */
      reset() {
        resetState();
        debugRender.reset();
      },
      /**
       * Component types behind the given report source ids, such as the ids a
       * command is about to return. Lets callers recover names for just those.
       */
      componentTypesFor(sourceIds) {
        const wanted = new Set(sourceIds);
        const types = /* @__PURE__ */ new Set();
        const collect = (entries) => {
          for (const [internalId, entry] of entries) {
            if (wanted.has(humanSourceId(internalId, entry.type, entry.depth))) types.add(entry.type);
          }
        };
        collect(state2.sources.entries());
        collect(state2.amplifierSources.entries());
        for (const sourceId of wanted) {
          const type = sourceIdManager.typeOf(sourceId);
          if (type !== null) types.add(type);
        }
        return Array.from(types);
      },
      /**
       * Component types of rendered entries recorded as `Anonymous`, for
       * recovering their names before an export. See `rendered-names.ts`.
       */
      unnamedRenderedTypes() {
        return renderedNames.unnamedTypes();
      },
      /**
       * Component types the capture named with any of `names`, or every type it
       * named when omitted: types with a source id whose current name matches,
       * and types whose names were stored as text (DOM anchors, Suspense
       * locations, regions, perf owners, unmount samples, interaction targets;
       * see recorded-names.ts).
       * Lets callers recover names for the components a result mentions by name.
       */
      componentTypesNamed(names) {
        const wanted = names === void 0 ? null : new Set(names);
        const types = new Set(recordedNames.types(wanted ?? void 0));
        for (const type of sourceIdManager.types()) {
          if (!wanted || wanted.has(nameOfType2(type))) types.add(type);
        }
        return Array.from(types);
      },
      /**
       * Generate a report of top update sources and thrashing components.
       * @param topN - Number of top sources to include (default: 10)
       * @param sortBy - Sort thrashers by 'effect', 'callback', 'memo', or 'total' (default: 'effect')
       * @param options - Report filtering options (e.g., minCollateral to hide low-impact sources)
       * @returns Report containing sources, blast radius, and optional thrashing data
       */
      report(topN = 10, sortBy = "effect", reportOptions) {
        networkCapture.flush();
        perfCapture.flush();
        const componentNames = refreshComponentNames();
        const report = buildReport(state2, thrashMode, topN, sortBy, reportOptions, {
          effectThrashMode,
          captureFibers,
          historySize,
          detectionLevel,
          integrationMode,
          renderTicks: renderTicks.status(),
          network: networkCapture.status(),
          perf: perfCapture.status(),
          renderedEvidence: renderedEvidence.status(),
          ...domDiff.enabled && { domDiff: domDiff.status() },
          capture: captureStatus()
        });
        if (componentNames.length > 0) report.meta.componentNames = componentNames;
        const hooks = hookRunner.collect();
        if (hooks) report.hooks = hooks;
        return report;
      },
      /**
       * Raw passive hook events captured for a component (debug surface).
       */
      _debugRawHookEvents(componentName) {
        const components = debugRender.allComponents();
        const events = componentName === "*" ? [] : debugRender.rawEvents(componentName);
        return {
          ok: true,
          componentName,
          status: debugRender.status(),
          components,
          events
        };
      },
      _debugInjectHookEventsForTest(componentName, events) {
        if (typeof debugRender.recordEventForTest !== "function") return;
        for (const event of events) {
          debugRender.recordEventForTest({ ...event, componentName });
        }
      },
      _debugSetSourceForTest(sourceId, source) {
        state2.sources.set(sourceId, source);
      },
      debugHook(sourceId, hookIndex, windowSize = 3) {
        var _a2;
        let source = state2.sources.get(sourceId);
        let resolvedSourceId = sourceId;
        if (!source) {
          for (const [internalId, candidate] of state2.sources.entries()) {
            const candidateHumanId = `${getComponentDisplayName(candidate.type)}#${((_a2 = String(internalId).match(/#(\d+)@/)) == null ? void 0 : _a2[1]) || "1"}@${candidate.depth}`;
            if (candidateHumanId === sourceId) {
              source = candidate;
              resolvedSourceId = internalId;
              break;
            }
          }
        }
        if (!source) return { ok: false, error: "sourceId not found", sourceId };
        const componentName = getComponentDisplayName(source.type);
        let events = debugRender.rawEvents(componentName);
        let resolvedComponentName = componentName;
        if (events.length === 0) {
          const candidates = debugRender.allComponents();
          const matching = candidates.find((name) => name === componentName || name.includes(componentName) || componentName.includes(name));
          if (matching) {
            resolvedComponentName = matching;
            events = debugRender.rawEvents(matching);
          }
        }
        const sourceHookIndices = Array.isArray(source.debugHookIndices) ? source.debugHookIndices : [];
        const targetIndex = Math.floor(hookIndex);
        const eventIndex = sourceHookIndices[targetIndex] ?? targetIndex;
        const target = events[eventIndex];
        const radius = Math.max(0, Math.floor(windowSize));
        if (!target) {
          return {
            ok: false,
            error: "hook event not found",
            sourceId: resolvedSourceId,
            requestedSourceId: sourceId,
            componentName,
            resolvedComponentName,
            hookIndex: targetIndex,
            eventIndex,
            sourceHookIndices,
            eventCount: events.length,
            status: debugRender.status(),
            caveat: "hook ancestry comes from passive stack capture during real renders; component-name stack parsing can be ambiguous in bundled/minified code"
          };
        }
        const neighborhood = events.map((event, index) => ({ event, index })).filter(({ index }) => Math.abs(index - eventIndex) <= radius).map(({ event, index }) => ({
          hookIndex: sourceHookIndices.indexOf(index) >= 0 ? sourceHookIndices.indexOf(index) : index,
          eventIndex: index,
          primitive: event.primitive,
          parents: parentFramesForEvent(event, componentName)
        }));
        return {
          ok: true,
          sourceId: resolvedSourceId,
          requestedSourceId: sourceId,
          componentName,
          resolvedComponentName,
          hookIndex: targetIndex,
          eventIndex,
          sourceHookIndices,
          primitive: target.primitive,
          parents: parentFramesForEvent(target, componentName),
          neighborhood,
          eventCount: events.length,
          status: debugRender.status(),
          caveat: "hook ancestry comes from passive stack capture during real renders; source-local hook indices are mapped onto the captured component event stream"
        };
      },
      /**
       * Returns which commit-hook integration model is currently observed.
       *   'devtools'     — DevTools hook is the active processor (no proven adapter callbacks).
       *   'adapter:<id>' — The adapter's host surface has fired; it owns the math now.
       *   'none'         — Detector not installed.
       */
      getIntegrationMode() {
        return integrationMode;
      },
      /** Detection level this detector records at: `stats`, `sources`, `amplifierMetrics`, `amplifiers`, or `full`. */
      getDetectionLevel() {
        return detectionLevel ?? null;
      },
      /** Id of the commit metrics adapter resolved on install, or null. */
      getMetricsAdapterId() {
        return (metricsAdapter == null ? void 0 : metricsAdapter.id) ?? null;
      },
      /** Plugin hook results (runs each set's onEnd), without building a report. */
      hookResults() {
        return hookRunner.collect();
      },
      /** Commit, network request, and performance entry counts, without building a report. */
      counts() {
        networkCapture.flush();
        perfCapture.flush();
        return { commits: state2.commits, networkRequests: networkCapture.requests.length, perfEntries: perfCapture.entries.length, renderedEvidence: renderedEvidence.status(), capture: captureStatus() };
      }
    };
  }
  const DETECTION_LEVEL = {
    /** Level 1: Only commitStats (performedWork for restarts) - minimal overhead */
    LEVEL1_STATS: "stats",
    /** Level 2: Stats + source tracking (which components caused updates) */
    LEVEL2_SOURCES: "sources",
    /** Level 3a: Sources + aggregate amplifier counts only (meta.amplifiersMetrics) */
    LEVEL3_AMPLIFIER_METRICS: "amplifierMetrics",
    /** Level 3b: Sources + full amplifier arrays (report.amplifiers, report.amplifierSources) */
    LEVEL3_AMPLIFIERS: "amplifiers"
  };
  const replayScaffoldingTarget = function chippyReplayScaffolding() {
  };
  const replayScaffolding = new Proxy(replayScaffoldingTarget, {
    get(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor && !descriptor.configurable && "value" in descriptor && !descriptor.writable) {
        return descriptor.value;
      }
      if (property === "then") return void 0;
      if (property === Symbol.iterator) return function* emptyReplayIterator() {
      };
      if (property === Symbol.toPrimitive) return () => "chippy-replay";
      return replayScaffolding;
    },
    apply() {
      return replayScaffolding;
    },
    construct() {
      return replayScaffolding;
    }
  });
  function readContextDependency(fiber, contextArg) {
    var _a2;
    let item = (_a2 = fiber == null ? void 0 : fiber.dependencies) == null ? void 0 : _a2.firstContext;
    while (item) {
      if (item.context === contextArg) return { found: true, value: item.memoizedValue };
      item = item.next;
    }
    return { found: false, value: void 0 };
  }
  function isContextProvider(fiber, contextArg) {
    const type = fiber.type;
    const elementType = fiber.elementType;
    return fiber.tag === 10 && (fiber.type === contextArg || fiber.elementType === contextArg || (type == null ? void 0 : type._context) === contextArg || (elementType == null ? void 0 : elementType._context) === contextArg);
  }
  function readProviderValue(start, contextArg) {
    const seen = /* @__PURE__ */ new Set();
    let fiber = (start == null ? void 0 : start.return) || null;
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      if (isContextProvider(fiber, contextArg)) {
        const memoizedProps = fiber.memoizedProps;
        const pendingProps = fiber.pendingProps;
        if (memoizedProps && Object.prototype.hasOwnProperty.call(memoizedProps, "value") && memoizedProps.value != null) {
          return { found: true, value: memoizedProps.value };
        }
        if (pendingProps && Object.prototype.hasOwnProperty.call(pendingProps, "value")) {
          return { found: true, value: pendingProps.value };
        }
        if (memoizedProps && Object.prototype.hasOwnProperty.call(memoizedProps, "value")) {
          return { found: true, value: memoizedProps.value };
        }
      }
      fiber = fiber.return || null;
    }
    return { found: false, value: void 0 };
  }
  function readContextValueFromFiber(fiber, contextArg) {
    const candidates = [fiber, (fiber == null ? void 0 : fiber.alternate) || null];
    for (const candidate of candidates) {
      const dependency = readContextDependency(candidate, contextArg);
      if (dependency.found && dependency.value != null) return dependency.value;
    }
    for (const candidate of candidates) {
      const provider = readProviderValue(candidate, contextArg);
      if (provider.found && provider.value != null) return provider.value;
    }
    if (contextArg && typeof contextArg === "object") {
      const context = contextArg;
      if (Object.prototype.hasOwnProperty.call(context, "_currentValue") && context._currentValue != null) {
        return context._currentValue;
      }
      if (Object.prototype.hasOwnProperty.call(context, "_currentValue2") && context._currentValue2 != null) {
        return context._currentValue2;
      }
    }
    return replayScaffolding;
  }
  function noop() {
  }
  function safeSerialize(value, depth = 0, seen = /* @__PURE__ */ new Set()) {
    if (value === null || value === void 0) return value;
    if (typeof value === "string") return value.length > 120 ? value.slice(0, 120) + "…" : value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") return "[function" + (value.name ? ":" + value.name : "") + "]";
    if (typeof value === "symbol") return "[symbol:" + value.toString() + "]";
    if (Array.isArray(value)) return "[array:" + value.length + "]";
    if (typeof value === "object") {
      if (seen.has(value)) return "[circular]";
      if (depth >= 1) return "[object]";
      seen.add(value);
      const result = {};
      const keys = Object.keys(value).slice(0, 8);
      for (const k of keys) {
        try {
          result[k] = safeSerialize(value[k], depth + 1, seen);
        } catch {
          result[k] = "[error]";
        }
      }
      const total = Object.keys(value).length;
      if (total > 8) result["…"] = "[" + (total - 8) + " more]";
      return result;
    }
    return String(value);
  }
  function replayErrorPayload(e) {
    if (!e) return null;
    const err = e;
    return {
      name: err.name || "Error",
      message: err.message || String(e),
      stack: err.stack || ""
    };
  }
  function logReplayError(label, componentName, err) {
    const payload = replayErrorPayload(err);
    if (!payload) return;
    try {
      console.error("[Chippy replay-error] " + label + " " + componentName, payload.stack || payload.name + ": " + payload.message, payload);
    } catch (_) {
    }
  }
  function classifyHook(hookNode, index) {
    const ms2 = hookNode.memoizedState;
    const queue = hookNode.queue;
    const base = { index };
    if (queue && typeof queue.dispatch === "function") {
      return { ...base, tag: "State", value: safeSerialize(ms2, 0, /* @__PURE__ */ new Set()) };
    }
    if (isEffectNode(ms2)) {
      const m = ms2;
      return {
        ...base,
        tag: "Effect",
        deps: Array.isArray(m.deps) ? "[array:" + m.deps.length + "]" : m.deps === null ? "null" : String(m.deps),
        hasCleanup: typeof m.destroy === "function"
      };
    }
    if (!queue && ms2 !== null && typeof ms2 === "object" && Object.prototype.hasOwnProperty.call(ms2, "current")) {
      return { ...base, tag: "Ref", current: safeSerialize(ms2.current, 0, /* @__PURE__ */ new Set()) };
    }
    if (!queue && Array.isArray(ms2) && ms2.length === 2 && (Array.isArray(ms2[1]) || ms2[1] === null)) {
      const arr = ms2;
      const depsTag = arr[1] === null ? "null" : "[array:" + arr[1].length + "]";
      return {
        ...base,
        tag: "Memo",
        value: typeof arr[0] === "function" ? "[function" + (arr[0].name ? ":" + arr[0].name : "") + "]" : safeSerialize(arr[0], 0, /* @__PURE__ */ new Set()),
        deps: depsTag
      };
    }
    if (queue || ms2 === null || typeof ms2 !== "object" || isUnclaimedObject()) {
      return { ...base, tag: "Value", value: safeSerialize(ms2, 0, /* @__PURE__ */ new Set()) };
    }
    return {
      ...base,
      tag: "Unknown",
      hasQueue: !!queue,
      value: safeSerialize(ms2, 0, /* @__PURE__ */ new Set())
    };
  }
  function isEffectNode(ms2) {
    if (!ms2 || typeof ms2 !== "object") return false;
    const m = ms2;
    if (typeof m.tag !== "number") return false;
    if (typeof m.create !== "function") return false;
    if (m.next === void 0 || m.next === null) return false;
    const next = m.next;
    return typeof next.tag === "number" && typeof next.create === "function";
  }
  function isUnclaimedObject(_ms) {
    return false;
  }
  function primitiveFamily(primitive) {
    switch (primitive) {
      case "State":
      case "Reducer":
      case "Transition":
        return "State";
      case "Ref":
        return "Ref";
      case "Memo":
      case "Callback":
        return "Memo";
      case "Effect":
      case "LayoutEffect":
      case "InsertionEffect":
      case "ImperativeHandle":
        return "Effect";
      case "Id":
      case "Deferred":
      case "SyncExternalStore":
        return "Value";
      default:
        return null;
    }
  }
  const MAX_HOOKS = 500;
  function evalFiberHooks(fiber) {
    if (!fiber) return { name: "Unknown", hookCount: 0, truncated: false, maxHooks: MAX_HOOKS, hooks: [], error: "No fiber available" };
    const name = readComponentName(fiber.type) || "Unknown";
    const hooks = [];
    const seen = /* @__PURE__ */ new Set();
    let hookNode = fiber.memoizedState;
    let index = 0;
    let truncated = false;
    while (hookNode) {
      if (seen.has(hookNode)) {
        hooks.push({ index, tag: "Unknown", note: "cycle detected in hook list" });
        break;
      }
      if (index >= MAX_HOOKS) {
        truncated = true;
        break;
      }
      seen.add(hookNode);
      hooks.push(classifyHook(hookNode, index));
      hookNode = hookNode.next;
      index++;
    }
    return { name, hookCount: hooks.length, truncated, maxHooks: MAX_HOOKS, hooks };
  }
  function readHookValueFromNode(hookNode) {
    if (!hookNode) return void 0;
    return hookNode.memoizedState;
  }
  function fiberOnlyHookRecords(fiber) {
    const raw = evalFiberHooks(fiber);
    return (raw.hooks || []).map((hook) => ({
      id: hook.index,
      index: hook.index,
      primitive: hook.tag,
      value: hook.value,
      path: [],
      source: null,
      fiberOnly: true,
      debugLabel: void 0
    }));
  }
  const PRIMITIVE_HOOK_NAMES = /* @__PURE__ */ new Set([
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "useId"
  ]);
  function customHookPathFromFrames(frames, componentName) {
    const compIdx = frames.findIndex((f) => f.name === componentName);
    const relevant = compIdx >= 0 ? frames.slice(0, compIdx) : frames;
    const parentLookup = compIdx >= 0 ? frames.slice(0, compIdx + 1) : frames;
    const out = [];
    for (let i = relevant.length - 1; i >= 0; i--) {
      const { name, loc } = relevant[i];
      if (isHookFrameName(name) && !PRIMITIVE_HOOK_NAMES.has(name.slice(name.lastIndexOf(".") + 1))) {
        const parent = i + 1 < parentLookup.length ? parentLookup[i + 1] : null;
        out.push({ name, loc: parent ? parent.loc : loc });
      }
    }
    return out;
  }
  function customHookPathFromStack(stack, componentName) {
    return customHookPathFromFrames(parseStackFrames(stack), componentName);
  }
  function isDispatcherIdle(ref) {
    var _a2;
    const current = ref && ref.current;
    if (!current || typeof current !== "object") return false;
    const name = ((_a2 = current.constructor) == null ? void 0 : _a2.name) ?? "";
    return !/HooksDispatcher/i.test(name);
  }
  function replayComponentHooks(fiber) {
    const type = fiber == null ? void 0 : fiber.type;
    const frameName = (type == null ? void 0 : type.displayName) || (type == null ? void 0 : type.name) || "Unknown";
    const componentName = readComponentName(fiber == null ? void 0 : fiber.type) || "Unknown";
    const fallbackRecords = fiberOnlyHookRecords(fiber);
    const dispatcherRef = getDispatcherRef();
    if (!dispatcherRef) {
      return {
        componentName,
        records: fallbackRecords,
        replayAttempted: false,
        replayError: "ReactCurrentDispatcher not found",
        replayErrorDetails: null,
        replayStatus: "fiber-only-fallback"
      };
    }
    if (!isDispatcherIdle(dispatcherRef)) {
      return {
        componentName,
        records: fallbackRecords,
        replayAttempted: false,
        replayError: "React render in progress; refusing dispatcher swap",
        replayErrorDetails: null,
        replayStatus: "fiber-only-fallback"
      };
    }
    const hookNodes = [];
    let hookNode = fiber.memoizedState;
    const seen = /* @__PURE__ */ new Set();
    while (hookNode && !seen.has(hookNode)) {
      seen.add(hookNode);
      hookNodes.push(hookNode);
      hookNode = hookNode.next;
    }
    const originalDispatcher = dispatcherRef.current;
    const originalConsoleError = console.error;
    const records = [];
    let cursor = 0;
    let replayError = "";
    let replayErrorDetails = null;
    let replayAttempted = false;
    let replayDriftError = null;
    function captureFrames() {
      return parseStackFrames(new Error().stack || "");
    }
    function currentPath(frames) {
      return customHookPathFromFrames(frames, frameName);
    }
    function currentDebugOwner(frames) {
      const path = currentPath(frames);
      return path.length ? path[path.length - 1].name : componentName;
    }
    function consumeSlot(primitive, frames) {
      const node = hookNodes[cursor];
      if (!node) throw new Error("Hook cursor exhausted at slot " + cursor + " for " + primitive);
      const index = cursor;
      cursor += 1;
      const path = currentPath(frames);
      const value = readHookValueFromNode(node);
      const actualClassified = classifyHook(node, index);
      const actualTag = actualClassified.tag;
      const expectedFamily = primitiveFamily(primitive);
      const tagMatches = expectedFamily === null || actualTag === expectedFamily;
      if (!tagMatches) {
        const msg = "Hook cursor drift at slot " + index + ": expected " + primitive + " but fiber node is " + actualTag + ". A hook consumed by the live component is not handled by the replay dispatcher.";
        replayDriftError = msg;
        throw new Error(msg);
      }
      records.push({
        id: index,
        index,
        primitive,
        value: safeSerialize(value, 0, /* @__PURE__ */ new Set()),
        path,
        source: null,
        fiberOnly: false,
        debugLabel: void 0
      });
      return { node, value, index, path };
    }
    function setDebugLabel(frames, label) {
      const owner2 = currentDebugOwner(frames);
      for (let i = records.length - 1; i >= 0; i--) {
        const rec = records[i];
        const tail = rec.path && rec.path.length ? rec.path[rec.path.length - 1].name : componentName;
        if (tail === owner2) {
          rec.debugLabel = safeSerialize(label, 1, /* @__PURE__ */ new Set());
          return;
        }
      }
      records.push({
        id: "debug:" + records.length,
        index: null,
        primitive: "DebugValue",
        value: void 0,
        path: currentPath(frames),
        source: null,
        fiberOnly: false,
        debugLabel: safeSerialize(label, 1, /* @__PURE__ */ new Set())
      });
    }
    const stubDispatcher = {
      useState(initialValue) {
        const frames = captureFrames();
        const slot = consumeSlot("State", frames);
        return [slot.value, noop];
      },
      useReducer(_reducer, _initialArg, _init) {
        const frames = captureFrames();
        const slot = consumeSlot("Reducer", frames);
        return [slot.value, noop];
      },
      useRef(_initialValue) {
        const frames = captureFrames();
        const slot = consumeSlot("Ref", frames);
        return slot.value;
      },
      useMemo(_create, _deps) {
        const frames = captureFrames();
        const slot = consumeSlot("Memo", frames);
        return slot.value[0];
      },
      useCallback(_callback, _deps) {
        const frames = captureFrames();
        const slot = consumeSlot("Callback", frames);
        return slot.value[0];
      },
      useDeferredValue(_value) {
        const frames = captureFrames();
        const slot = consumeSlot("Deferred", frames);
        return slot.value;
      },
      useTransition() {
        const frames = captureFrames();
        consumeSlot("Transition", frames);
        return [false, noop];
      },
      useSyncExternalStore(_subscribe, _getSnapshot, _getServerSnapshot) {
        const frames = captureFrames();
        const slot = consumeSlot("SyncExternalStore", frames);
        consumeSlot("Effect", frames);
        return slot.value;
      },
      useContext(contextArg) {
        return readContextValueFromFiber(fiber, contextArg);
      },
      useDebugValue(value, formatter) {
        const frames = captureFrames();
        let label = value;
        try {
          label = typeof formatter === "function" ? formatter(value) : value;
        } catch (_) {
          label = value;
        }
        setDebugLabel(frames, label);
      },
      useEffect(_create, _deps) {
        const frames = captureFrames();
        consumeSlot("Effect", frames);
      },
      useLayoutEffect(_create, _deps) {
        const frames = captureFrames();
        consumeSlot("LayoutEffect", frames);
      },
      useInsertionEffect(_create, _deps) {
        const frames = captureFrames();
        consumeSlot("InsertionEffect", frames);
      },
      useImperativeHandle(_ref, _create, _deps) {
        const frames = captureFrames();
        consumeSlot("ImperativeHandle", frames);
      },
      useId() {
        const frames = captureFrames();
        const slot = consumeSlot("Id", frames);
        return slot.value;
      }
    };
    try {
      replayAttempted = true;
      dispatcherRef.current = stubDispatcher;
      console.error = function(...args) {
        try {
          return originalConsoleError.apply(console, args);
        } catch (_) {
        }
      };
      const renderFn = fiber && fiber.type;
      if (typeof renderFn !== "function") throw new Error("Fiber type is not executable");
      renderFn(fiber.memoizedProps, fiber.ref);
    } catch (e) {
      replayError = (e == null ? void 0 : e.message) || String(e);
      replayErrorDetails = replayErrorPayload(e);
      logReplayError("structure-render", componentName, e);
    } finally {
      try {
        dispatcherRef.current = originalDispatcher;
      } catch (_) {
      }
      console.error = originalConsoleError;
    }
    if (!replayError && replayDriftError) {
      replayError = replayDriftError;
    }
    return {
      componentName,
      records: records.length ? records : fallbackRecords,
      replayAttempted,
      replayError,
      replayErrorDetails,
      replayStatus: replayError ? "partial-replay" : "complete",
      __debugCursor: cursor,
      __debugTail: records.slice(Math.max(0, records.length - 5))
    };
  }
  const MAX_BOUNDARY_FIBERS = 400;
  const SUSPENSE_TAG$2 = 13;
  const CLASS_COMPONENT_TAG$1 = 1;
  function fiberTag$2(fiber) {
    return fiber.tag;
  }
  function describeErrorBoundary(fiber) {
    var _a2;
    const componentName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
    const type = fiber.type;
    const hasLifecycle = !!type && (typeof type.getDerivedStateFromError === "function" || typeof ((_a2 = type.prototype) == null ? void 0 : _a2.componentDidCatch) === "function");
    if (hasLifecycle && (fiberTag$2(fiber) === CLASS_COMPONENT_TAG$1 || fiberTag$2(fiber) === void 0)) {
      return { componentName: componentName || "ErrorBoundary", detectedBy: "lifecycle" };
    }
    if (componentName && /ErrorBoundary$/.test(componentName)) {
      return { componentName, detectedBy: "name" };
    }
    return null;
  }
  function describeSuspenseBoundary(fiber) {
    const displayName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
    const isSuspense = fiberTag$2(fiber) === SUSPENSE_TAG$2 || displayName === "Suspense" || displayName === "SuspenseComponent" || displayName === "SuspenseList";
    if (!isSuspense) return null;
    return { componentName: displayName || "Suspense" };
  }
  function collectFiberBoundaries(fibers) {
    const boundaries = { error: null, suspense: null };
    for (let distance = 0; distance < fibers.length; distance += 1) {
      const entry = fibers[distance];
      if (!boundaries.error) {
        const error = describeErrorBoundary(entry);
        if (error) boundaries.error = { ...error, distance };
      }
      if (!boundaries.suspense) {
        const suspense = describeSuspenseBoundary(entry);
        if (suspense) boundaries.suspense = { ...suspense, distance };
      }
      if (boundaries.error && boundaries.suspense) break;
    }
    return boundaries;
  }
  const MAX_CONTEXT_FIBERS = 400;
  const CORE_KINDS = /* @__PURE__ */ new Set(["error", "suspense"]);
  const providers = [];
  function registerContextProvider(provider) {
    if (!provider || typeof provider.id !== "string" || typeof provider.describe !== "function") {
      throw new TypeError("registerContextProvider expects { id: string, describe(fibers) }");
    }
    for (const kind of provider.kinds || []) {
      if (CORE_KINDS.has(kind.kind)) throw new TypeError(`context provider ${provider.id} cannot redefine core kind ${kind.kind}`);
    }
    const existing = providers.findIndex((entry) => entry.id === provider.id);
    if (existing >= 0) providers.splice(existing, 1, provider);
    else providers.push(provider);
    return () => {
      const index = providers.indexOf(provider);
      if (index >= 0) providers.splice(index, 1);
    };
  }
  function getContextProviders() {
    return providers.map((provider) => ({ id: provider.id, kinds: [...provider.kinds || []] }));
  }
  function collectChain(start, next, into, seen) {
    let current = start || null;
    const walked = /* @__PURE__ */ new Set();
    while (current && into.length < MAX_CONTEXT_FIBERS) {
      if (walked.has(current)) break;
      walked.add(current);
      if (!seen.has(current)) {
        seen.add(current);
        into.push(current);
      }
      current = next(current) || null;
    }
  }
  function collectContextFibers(fiber) {
    if (!fiber) return [];
    const fibers = [];
    const seen = /* @__PURE__ */ new Set();
    collectChain(fiber, (entry) => entry.return, fibers, seen);
    collectChain(fiber._debugOwner, (entry) => entry._debugOwner, fibers, seen);
    return fibers;
  }
  function labelFiber(fiber, kind) {
    for (const provider of providers) {
      if (!provider.label) continue;
      try {
        const label = provider.label(fiber, kind);
        if (typeof label === "string" && label) return label;
      } catch {
      }
    }
    return null;
  }
  function runProvider(provider, fibers) {
    try {
      return provider.describe(fibers) || null;
    } catch {
      return null;
    }
  }
  function describeContext(fiber) {
    const fibers = collectContextFibers(fiber);
    if (fibers.length === 0) return null;
    const generic = collectFiberBoundaries(fibers);
    const boundaries = { error: generic.error, suspense: generic.suspense };
    const display = { kinds: [], titles: {}, fields: {}, showError: !!generic.error };
    const contributors = [];
    const extra = {};
    for (const provider of providers) {
      const contribution = runProvider(provider, fibers);
      if (!contribution) continue;
      contributors.push(provider.id);
      const declared = new Set((provider.kinds || []).map((kind) => kind.kind));
      for (const [kind, ref] of Object.entries(contribution.boundaries || {})) {
        if (!declared.has(kind) || boundaries[kind]) continue;
        boundaries[kind] = ref || null;
      }
      for (const kind of provider.kinds || []) {
        if (boundaries[kind.kind] && !display.kinds.some((entry) => entry.kind === kind.kind)) display.kinds.push(kind);
      }
      if (contribution.errorEnrichment && boundaries.error) {
        boundaries.error = { ...boundaries.error, ...contribution.errorEnrichment, distance: boundaries.error.distance };
      }
      Object.assign(display.titles, contribution.titles || {});
      for (const [kind, fields] of Object.entries(contribution.fields || {})) {
        display.fields[kind] = [...display.fields[kind] || [], ...fields.filter((field) => field.value != null && field.value !== "")];
      }
      if (contribution.showError) display.showError = true;
      for (const [key, value] of Object.entries(contribution.extra || {})) {
        if (key !== "boundaries" && key !== "display" && key !== "providers") extra[key] = value;
      }
    }
    const found = Object.values(boundaries).some(Boolean) || display.showError;
    if (!found) return null;
    return { ...extra, boundaries, display, providers: contributors };
  }
  function findBoundaryFibers(fiber) {
    const result = { error: null, suspense: null };
    const matchers = providers.filter((provider) => typeof provider.matchBoundary === "function");
    for (const provider of matchers) for (const kind of provider.kinds || []) result[kind.kind] = null;
    const wanted = Object.keys(result).length;
    let located = 0;
    for (const entry of collectContextFibers(fiber)) {
      if (!result.error && describeErrorBoundary(entry)) {
        result.error = entry;
        located += 1;
      }
      if (!result.suspense && describeSuspenseBoundary(entry)) {
        result.suspense = entry;
        located += 1;
      }
      for (const provider of matchers) {
        let kind = null;
        try {
          kind = provider.matchBoundary(entry);
        } catch {
          kind = null;
        }
        if (kind && kind in result && !result[kind]) {
          result[kind] = entry;
          located += 1;
        }
      }
      if (located >= wanted) break;
    }
    return result;
  }
  const registered = /* @__PURE__ */ new Map();
  const requested = /* @__PURE__ */ new Set();
  const active = /* @__PURE__ */ new Map();
  let explicitSelection = false;
  function activate(plugin) {
    const hookSets = plugin.avalancheHooks ? [].concat(plugin.avalancheHooks) : [];
    const unregister = [
      plugin.contextProvider && registerContextProvider(plugin.contextProvider),
      plugin.commitMetricsAdapter && registerCommitMetricsAdapter(plugin.commitMetricsAdapter),
      ...hookSets.map(registerAvalancheHooks)
    ].filter((fn) => typeof fn === "function");
    active.set(plugin.id, () => {
      for (const fn of unregister.reverse()) fn();
    });
  }
  function deactivate(id) {
    var _a2;
    (_a2 = active.get(id)) == null ? void 0 : _a2();
    active.delete(id);
  }
  function validId(id) {
    return typeof id === "string" && id.length > 0;
  }
  function registerPlugin(plugin) {
    if (!plugin || !validId(plugin.id)) throw new TypeError("registerPlugin expects a plugin with a non-empty id");
    deactivate(plugin.id);
    registered.set(plugin.id, plugin);
    if (requested.has(plugin.id)) activate(plugin);
    return () => {
      if (registered.get(plugin.id) !== plugin) return;
      deactivate(plugin.id);
      registered.delete(plugin.id);
    };
  }
  function enablePlugins(ids) {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (!validId(id) || requested.has(id)) continue;
      requested.add(id);
      const plugin = registered.get(id);
      if (plugin && !active.has(id)) activate(plugin);
    }
    return [...active.keys()];
  }
  function selectPlugins(ids) {
    explicitSelection = true;
    return enablePlugins(ids);
  }
  function enableDefaultPlugins(ids) {
    return explicitSelection ? [...active.keys()] : enablePlugins(ids);
  }
  function listPlugins() {
    return [...registered.values()].map((plugin) => ({
      id: plugin.id,
      label: plugin.label ?? plugin.id,
      enabled: active.has(plugin.id)
    }));
  }
  const SUSPENSE_TAG$1 = 13;
  const DEFAULT_WITHIN = 3;
  const MAX_CHILD_VISITS = 200;
  function labelNameOf(fiber) {
    if (typeof fiber.type === "string") return null;
    const name = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
    if (name) return name;
    return fiber.tag === SUSPENSE_TAG$1 ? "Suspense" : null;
  }
  function compile$1(rule) {
    if (!rule.match) return { rule, matches: () => true };
    const names = new Set(rule.match.names ?? []);
    const pattern = rule.match.pattern ? new RegExp(rule.match.pattern) : null;
    return { rule, matches: (name) => names.has(name) || !!(pattern == null ? void 0 : pattern.test(name)) };
  }
  function read(compiled, fiber, name) {
    if (name === null) {
      if (compiled.rule.match) return null;
    } else if (!compiled.matches(name)) return null;
    return readRef(compiled.rule.value, { rule: compiled.rule, fiber, name: name ?? "" });
  }
  function fromParents(compiled, fiber) {
    const within = compiled.rule.within ?? DEFAULT_WITHIN;
    let seen = 0;
    for (let node = fiber.return; node && seen < within; node = node.return) {
      const name = labelNameOf(node);
      if (!name) continue;
      seen += 1;
      const value = read(compiled, node, name);
      if (value) return value;
    }
    return null;
  }
  function fromChildren(compiled, fiber) {
    const within = compiled.rule.within ?? DEFAULT_WITHIN;
    const stack = [];
    for (let child = fiber.child; child; child = child.sibling) stack.push({ node: child, depth: 0 });
    stack.reverse();
    let visits = 0;
    while (stack.length && visits++ < MAX_CHILD_VISITS) {
      const { node, depth } = stack.pop();
      const name = labelNameOf(node);
      const here = name ? depth + 1 : depth;
      if (name) {
        const value = read(compiled, node, name);
        if (value) return value;
      }
      if (here >= within) continue;
      const children = [];
      for (let child = node.child; child; child = child.sibling) children.push(child);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], depth: here });
    }
    return null;
  }
  function apply(compiled, fiber) {
    const from = compiled.rule.from ?? "self";
    if (from === "parents") return fromParents(compiled, fiber);
    if (from === "children") return fromChildren(compiled, fiber);
    return read(compiled, fiber, labelNameOf(fiber));
  }
  function compileLabels(rules) {
    if (!(rules == null ? void 0 : rules.length)) return null;
    const byKind = /* @__PURE__ */ new Map();
    for (const rule of rules) {
      const list = byKind.get(rule.for) ?? [];
      list.push(compile$1(rule));
      byKind.set(rule.for, list);
    }
    return (fiber, kind) => {
      for (const compiled of byKind.get(kind) ?? []) {
        const value = apply(compiled, fiber);
        if (value) return value;
      }
      return null;
    };
  }
  function displayNameOf(fiber) {
    return getDisplayName(fiber.type) || getDisplayName(fiber.elementType) || null;
  }
  function compileRule(rule) {
    const names = new Set(rule.match.names ?? []);
    const pattern = rule.match.pattern ? new RegExp(rule.match.pattern) : null;
    return { rule, matches: (name) => names.has(name) || !!(pattern == null ? void 0 : pattern.test(name)) };
  }
  function scalar(value) {
    if (typeof value === "string") return value.trim() ? value : null;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
  }
  function readRef(ref, hit) {
    var _a2;
    for (const one of Array.isArray(ref) ? ref : [ref]) {
      let value = null;
      if (one === "name") value = hit.name;
      else if (one.startsWith("props.")) value = scalar((_a2 = hit.fiber.memoizedProps) == null ? void 0 : _a2[one.slice(6)]);
      else if (one.startsWith("parts.") && hit.rule.nameParts) {
        const { separator, keys } = hit.rule.nameParts;
        const index = keys.indexOf(one.slice(6));
        value = index >= 0 ? scalar(hit.name.split(separator)[index]) : null;
      }
      if (value) return value;
    }
    return null;
  }
  function readData(hit) {
    const out = { componentName: hit.name };
    for (const [key, ref] of Object.entries(hit.rule.data ?? {})) out[key] = readRef(ref, hit);
    return out;
  }
  function readFields(hit) {
    const out = [];
    for (const field of hit.rule.fields ?? []) {
      const value = readRef(field.value, hit);
      if (value) out.push({ label: field.label, value });
    }
    return out;
  }
  function compileComponents(pack) {
    const rules = (pack.components ?? []).map(compileRule);
    const labeler = compileLabels(pack.labels);
    if (rules.length === 0 && !labeler) return null;
    const kinds = /* @__PURE__ */ new Map();
    for (const { rule } of rules) {
      if (rule.kind === "error" || kinds.has(rule.kind)) continue;
      kinds.set(rule.kind, { kind: rule.kind, label: rule.label ?? rule.kind, ...rule.accent && { accent: rule.accent } });
    }
    function nearest(fibers) {
      const hits = rules.map(() => null);
      let open = rules.length;
      for (let distance = 0; distance < fibers.length && open > 0; distance += 1) {
        const name = displayNameOf(fibers[distance]);
        if (!name) continue;
        rules.forEach((compiled, index) => {
          if (hits[index] || !compiled.matches(name)) return;
          hits[index] = { rule: compiled.rule, fiber: fibers[distance], name, distance };
          open -= 1;
        });
      }
      return hits.filter((hit) => !!hit);
    }
    function matchBoundary(fiber) {
      const name = displayNameOf(fiber);
      if (!name) return null;
      const hit = rules.find(({ rule, matches: matches2 }) => rule.kind !== "error" && matches2(name));
      return hit ? hit.rule.kind : null;
    }
    return {
      id: pack.id,
      kinds: [...kinds.values()],
      describe(fibers) {
        const hits = nearest(fibers);
        const contribution = { boundaries: {}, titles: {}, fields: {} };
        for (const kind of kinds.keys()) contribution.boundaries[kind] = null;
        let showError = false;
        for (const hit of hits) {
          const { kind } = hit.rule;
          showError || (showError = !!hit.rule.showError);
          const claimed = kind === "error" ? contribution.errorEnrichment !== void 0 : !!contribution.boundaries[kind];
          if (claimed) continue;
          if (kind === "error") {
            if (hit.rule.data) contribution.errorEnrichment = readData(hit);
          } else {
            contribution.boundaries[kind] = { distance: hit.distance, ...readData(hit) };
          }
          const title = hit.rule.title ? readRef(hit.rule.title, hit) : null;
          if (title && !contribution.titles[kind]) contribution.titles[kind] = title;
          const fields = readFields(hit);
          if (fields.length && !contribution.fields[kind]) contribution.fields[kind] = fields;
        }
        if (hits.length === 0) return { boundaries: contribution.boundaries };
        return { ...contribution, ...showError && { showError } };
      },
      matchBoundary,
      ...labeler && {
        // A component of one of this pack's kinds is labelled by that kind's rules.
        label: (fiber, kind) => labeler(fiber, kind === "component" ? matchBoundary(fiber) ?? kind : kind)
      }
    };
  }
  function compile(body, name, errors) {
    try {
      return new Function("ctx", body);
    } catch (error) {
      const message = `${name} did not compile: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      errors.push(message);
      return () => {
        throw new Error(message);
      };
    }
  }
  function compileScripts(pack) {
    const compileErrors = [];
    const extensions = Object.entries(pack.avalancheExtensions ?? {}).map(([name, scripts]) => {
      const id = `${pack.id}.${name}`;
      const instructions = scripts.instructions ?? pack.instructions;
      const phase = (key) => scripts[key] ? { [key]: compile(scripts[key], `${id} ${key}`, compileErrors) } : {};
      return {
        id,
        name,
        init: scripts.onInit ? compile(scripts.onInit, `${id} onInit`, compileErrors) : null,
        hooks: { id, ...instructions && { instructions }, ...phase("onStart"), ...phase("onStep"), ...phase("onEnd") }
      };
    });
    const hooks = extensions.length ? extensions.map((extension) => extension.hooks) : pack.instructions ? [{ id: pack.id, instructions: pack.instructions }] : [];
    return { extensions, hooks, compileErrors };
  }
  const ID = /^[a-z][a-z0-9-]*$/;
  const TOP_KEYS = /* @__PURE__ */ new Set(["id", "label", "instructions", "components", "labels", "avalancheExtensions"]);
  const LABEL_KEYS = /* @__PURE__ */ new Set(["for", "from", "match", "within", "nameParts", "value", "note"]);
  const LABEL_FROM = /* @__PURE__ */ new Set(["self", "parents", "children"]);
  const MAX_LABEL_WITHIN = 10;
  const RULE_KEYS = /* @__PURE__ */ new Set(["kind", "label", "accent", "match", "nameParts", "title", "fields", "data", "showError"]);
  const SCRIPT_KEYS = /* @__PURE__ */ new Set(["onInit", "onStart", "onStep", "onEnd"]);
  const EXTENSION_KEYS = /* @__PURE__ */ new Set(["instructions", ...SCRIPT_KEYS]);
  const REF = /^(name|props\.[^.\s]+|parts\.[^.\s]+)$/;
  function fail(path, message) {
    throw new TypeError(`chippy pack ${path}: ${message}`);
  }
  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function checkKeys(value, allowed, path) {
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(path, `unknown key "${key}"`);
  }
  function checkString(value, path, optional = false) {
    if (value === void 0 && optional) return;
    if (typeof value !== "string" || !value) fail(path, "must be a non-empty string");
  }
  function checkRef(value, path) {
    const refs = Array.isArray(value) ? value : [value];
    if (refs.length === 0) fail(path, "must name at least one reference");
    for (const ref of refs) {
      if (typeof ref !== "string" || !REF.test(ref)) fail(path, `"${String(ref)}" is not name, props.<key>, or parts.<key>`);
    }
  }
  function checkMatch(match, path) {
    if (!isObject(match)) fail(path, "must be an object");
    checkKeys(match, /* @__PURE__ */ new Set(["names", "pattern"]), path);
    const { names, pattern } = match;
    if (names === void 0 && pattern === void 0) fail(path, "needs names or pattern");
    if (names !== void 0 && (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !name))) {
      fail(`${path}.names`, "must be a list of names");
    }
    if (pattern !== void 0) {
      checkString(pattern, `${path}.pattern`);
      try {
        new RegExp(pattern);
      } catch (error) {
        fail(`${path}.pattern`, error.message);
      }
    }
  }
  function checkNameParts(parts, path) {
    if (parts === void 0) return;
    if (!isObject(parts)) fail(path, "must be an object");
    checkString(parts.separator, `${path}.separator`);
    if (!Array.isArray(parts.keys) || parts.keys.some((key) => typeof key !== "string")) {
      fail(`${path}.keys`, "must be a list of keys");
    }
  }
  function checkLabel(rule, path) {
    if (!isObject(rule)) fail(path, "must be an object");
    checkKeys(rule, LABEL_KEYS, path);
    checkString(rule.for, `${path}.for`);
    if (rule.from !== void 0 && !LABEL_FROM.has(rule.from)) fail(`${path}.from`, "must be self, parents, or children");
    const from = rule.from ?? "self";
    if (rule.match !== void 0 || from !== "self") checkMatch(rule.match, `${path}.match`);
    if (rule.within !== void 0) {
      const within = rule.within;
      if (typeof within !== "number" || !Number.isInteger(within) || within < 1 || within > MAX_LABEL_WITHIN) {
        fail(`${path}.within`, `must be a whole number from 1 to ${MAX_LABEL_WITHIN}`);
      }
    }
    checkNameParts(rule.nameParts, `${path}.nameParts`);
    checkRef(rule.value, `${path}.value`);
    checkString(rule.note, `${path}.note`, true);
  }
  function checkRule(rule, path) {
    if (!isObject(rule)) fail(path, "must be an object");
    checkKeys(rule, RULE_KEYS, path);
    checkString(rule.kind, `${path}.kind`);
    if (rule.kind === "suspense") fail(`${path}.kind`, "suspense is a core kind");
    checkString(rule.label, `${path}.label`, true);
    checkString(rule.accent, `${path}.accent`, true);
    checkMatch(rule.match, `${path}.match`);
    checkNameParts(rule.nameParts, `${path}.nameParts`);
    if (rule.title !== void 0) checkRef(rule.title, `${path}.title`);
    if (rule.fields !== void 0) {
      if (!Array.isArray(rule.fields)) fail(`${path}.fields`, "must be a list");
      rule.fields.forEach((field, index) => {
        if (!isObject(field)) fail(`${path}.fields[${index}]`, "must be an object");
        checkString(field.label, `${path}.fields[${index}].label`);
        checkRef(field.value, `${path}.fields[${index}].value`);
      });
    }
    if (rule.data !== void 0) {
      if (!isObject(rule.data)) fail(`${path}.data`, "must be an object");
      for (const [key, ref] of Object.entries(rule.data)) checkRef(ref, `${path}.data.${key}`);
    }
    if (rule.showError !== void 0 && typeof rule.showError !== "boolean") fail(`${path}.showError`, "must be a boolean");
  }
  function parsePack(input) {
    let value = input;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (error) {
        fail("", `is not valid JSON (${error.message})`);
      }
    }
    if (!isObject(value)) fail("", "must be an object");
    checkKeys(value, TOP_KEYS, "");
    if (typeof value.id !== "string" || !ID.test(value.id)) fail("id", "must match /^[a-z][a-z0-9-]*$/");
    checkString(value.label, "label", true);
    checkString(value.instructions, "instructions", true);
    if (value.components !== void 0) {
      if (!Array.isArray(value.components)) fail("components", "must be a list");
      value.components.forEach((rule, index) => checkRule(rule, `components[${index}]`));
    }
    if (value.labels !== void 0) {
      if (!Array.isArray(value.labels)) fail("labels", "must be a list");
      value.labels.forEach((rule, index) => checkLabel(rule, `labels[${index}]`));
    }
    if (value.avalancheExtensions !== void 0) {
      const extensions = value.avalancheExtensions;
      if (!isObject(extensions)) fail("avalancheExtensions", "must be an object of named extensions");
      for (const [name, extension] of Object.entries(extensions)) {
        const path = `avalancheExtensions.${name}`;
        if (!ID.test(name)) fail(path, "name must match /^[a-z][a-z0-9-]*$/");
        if (!isObject(extension)) fail(path, "must be an object");
        checkKeys(extension, EXTENSION_KEYS, path);
        for (const key of EXTENSION_KEYS) checkString(extension[key], `${path}.${key}`, true);
      }
    }
    return value;
  }
  const packs = /* @__PURE__ */ new Map();
  function registerPack(input) {
    var _a2;
    const pack = parsePack(input);
    const contextProvider = compileComponents(pack) ?? void 0;
    const { extensions, hooks, compileErrors } = compileScripts(pack);
    (_a2 = packs.get(pack.id)) == null ? void 0 : _a2.unregister();
    const initErrors = [];
    for (const { id, init } of extensions) {
      if (!init) continue;
      try {
        init({ id });
      } catch (error) {
        initErrors.push(`${id}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      }
    }
    const unregister = registerPlugin({
      id: pack.id,
      label: pack.label ?? pack.id,
      ...contextProvider && { contextProvider },
      ...hooks.length && { avalancheHooks: hooks }
    });
    enablePlugins([pack.id]);
    const status = {
      id: pack.id,
      label: pack.label ?? pack.id,
      instructions: pack.instructions ?? null,
      kinds: ((contextProvider == null ? void 0 : contextProvider.kinds) ?? []).map((kind) => kind.kind),
      extensions: extensions.map(({ id, name }) => {
        var _a3;
        return {
          name,
          reportKey: id,
          scripts: ["onInit", "onStart", "onStep", "onEnd"].filter((phase) => {
            var _a4;
            return !!((_a4 = pack.avalancheExtensions) == null ? void 0 : _a4[name][phase]);
          }),
          ...((_a3 = pack.avalancheExtensions) == null ? void 0 : _a3[name].instructions) && { instructions: pack.avalancheExtensions[name].instructions }
        };
      }),
      compileErrors,
      initErrors
    };
    packs.set(pack.id, {
      status,
      unregister: () => {
        unregister();
        packs.delete(pack.id);
      }
    });
    return status;
  }
  function registerPacks(inputs) {
    const list = Array.isArray(inputs) ? inputs : inputs == null ? [] : [inputs];
    return list.map((input) => {
      try {
        return { ok: true, pack: registerPack(input) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
  function unregisterPack(id) {
    const entry = packs.get(id);
    if (!entry) return false;
    entry.unregister();
    return true;
  }
  function listPacks() {
    return [...packs.values()].map((entry) => ({ ...entry.status }));
  }
  const PROBE_INTENTS = ["explain", "investigate", "change"];
  const MAX_COMMENT_LENGTH = 2e3;
  const INTENT_SET = new Set(PROBE_INTENTS);
  function normalizeProbeAnnotation(value) {
    const input = value && typeof value === "object" ? value : {};
    const rawIntent = typeof input.intent === "string" ? input.intent.trim().toLowerCase() : "";
    return {
      intent: INTENT_SET.has(rawIntent) ? rawIntent : null,
      comment: typeof input.comment === "string" ? input.comment.slice(0, MAX_COMMENT_LENGTH) : ""
    };
  }
  function updateProbeAnnotation(current, patch) {
    return normalizeProbeAnnotation({
      intent: patch.intent === void 0 ? current.intent : patch.intent,
      comment: patch.comment === void 0 ? current.comment : patch.comment
    });
  }
  function summarizeHookList(raw) {
    var _a2, _b2;
    if (!raw || raw.error) return raw || { error: "No hook data available" };
    const hooks = Array.isArray(raw.hooks) ? raw.hooks : [];
    const counts = {};
    const cleanupEffects = [];
    const valueHints = [];
    const runs = [];
    let runStart = 0;
    hooks.forEach((hook, index) => {
      const tag = (hook == null ? void 0 : hook.tag) || "Unknown";
      counts[tag] = (counts[tag] || 0) + 1;
      if (tag === "Effect" && hook.hasCleanup) cleanupEffects.push(index);
      if (hook && Object.prototype.hasOwnProperty.call(hook, "value") && hook.value !== void 0 && hook.value !== null) {
        valueHints.push({ index, tag, value: hook.value });
      }
    });
    for (let i = 1; i <= hooks.length; i++) {
      const prevTag = ((_a2 = hooks[runStart]) == null ? void 0 : _a2.tag) || "Unknown";
      const tag = ((_b2 = hooks[i]) == null ? void 0 : _b2.tag) || "Unknown";
      if (i === hooks.length || tag !== prevTag) {
        runs.push({ start: runStart, end: i - 1, tag: prevTag, count: i - runStart });
        runStart = i;
      }
    }
    return {
      name: raw.name || null,
      fiberId: raw.fiberId || null,
      hookCount: raw.hookCount ?? hooks.length,
      truncated: !!raw.truncated,
      maxHooks: raw.maxHooks ?? null,
      counts,
      cleanupEffectCount: cleanupEffects.length,
      cleanupEffects,
      runs,
      valueHints
    };
  }
  function formatCounts(counts) {
    return Object.keys(counts || {}).sort().map((k) => k + "=" + counts[k]).join(", ");
  }
  function formatPath(path) {
    return (path || []).map((seg) => seg.name + (seg.loc ? " @ " + seg.loc : "")).join(" > ");
  }
  function renderComplexityText(summary, records) {
    const out = ["complexity:", "  total hook slots: " + summary.hookCount + (summary.truncated ? "+" : "")];
    const counts = formatCounts(summary.counts);
    if (counts) out.push("  primitive counts: " + counts);
    if (summary.cleanupEffectCount) {
      const cleanupIndexes = (summary.cleanupEffects || []).join(", ");
      out.push("  cleanup effects: " + summary.cleanupEffectCount + (cleanupIndexes ? " @ hooks " + cleanupIndexes : ""));
    }
    const familyCounts = /* @__PURE__ */ new Map();
    for (const record of records || []) {
      if ((record == null ? void 0 : record.index) == null) continue;
      const path = record.path || [];
      const key = path.length ? path[0].name + (path[0].loc ? " @ " + path[0].loc : "") : "(component body)";
      familyCounts.set(key, (familyCounts.get(key) || 0) + 1);
    }
    const topFamilies = Array.from(familyCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    if (topFamilies.length) {
      out.push("  top hook families:");
      topFamilies.forEach(([family, count]) => out.push("    " + family + ": " + count));
    }
    const debugLandmarks = (records || []).filter((record) => record == null ? void 0 : record.debugLabel).slice(0, 8).map((record) => {
      const path = formatPath(record.path || []);
      const hook = "hook " + (record.index == null ? "·" : record.index) + " " + record.primitive;
      return "    " + (path ? path + " > " : "") + hook + " — " + record.debugLabel;
    });
    if (debugLandmarks.length) {
      out.push("  debug landmarks:");
      out.push(...debugLandmarks);
    }
    return out;
  }
  function renderTreeText(componentName, source, groups) {
    const out = [];
    const head = (source == null ? void 0 : source.fileName) ? componentName + " @ " + source.fileName + (source.lineNumber ? ":" + source.lineNumber : "") : componentName;
    out.push(head);
    const root = { childrenByKey: /* @__PURE__ */ new Map(), entries: [] };
    const segmentKey = (seg) => seg.name + "\0" + (seg.loc || "");
    for (const group of groups || []) {
      let node = root;
      for (const seg of group.path || []) {
        const key = segmentKey(seg);
        let child = node.childrenByKey.get(key);
        if (!child) {
          child = { segment: seg, locs: /* @__PURE__ */ new Set(), childrenByKey: /* @__PURE__ */ new Map(), entries: [] };
          node.childrenByKey.set(key, child);
          node.entries.push({ kind: "folder", node: child });
        }
        if (seg.loc) child.locs.add(seg.loc);
        node = child;
      }
      if (group.hooks && group.hooks.length) {
        node.entries.push({ kind: "hooks", hooks: group.hooks });
      }
    }
    const renderEntries = (entries, prefix) => {
      entries.forEach((entry, entryIndex) => {
        const isLastEntry = entryIndex === entries.length - 1;
        const connector = isLastEntry ? "└─" : "├─";
        if (entry.kind === "folder") {
          const seg = entry.node.segment;
          out.push(prefix + connector + " " + seg.name + (seg.loc ? " @ " + seg.loc : ""));
          renderEntries(entry.node.entries, prefix + (isLastEntry ? "   " : "│  "));
          return;
        }
        entry.hooks.forEach((hook, hookIndex) => {
          const isLastHook = hookIndex === entry.hooks.length - 1;
          const hookConnector = isLastEntry && isLastHook ? "└─" : "├─";
          const hid = hook.hookId == null ? "·" : hook.hookId;
          const debugLabel = hook.debugLabel ? " — " + hook.debugLabel : "";
          out.push(prefix + hookConnector + " hook " + hid + " " + hook.primitive + debugLabel);
        });
      });
    };
    renderEntries(root.entries, "");
    return out.join("\n");
  }
  function renderCompactComponentText(componentName, source, summary, records, warnings) {
    const out = [];
    const head = (source == null ? void 0 : source.fileName) ? componentName + " @ " + source.fileName + (source.lineNumber ? ":" + source.lineNumber : "") : componentName;
    out.push(head);
    out.push("hooks: " + summary.hookCount + (summary.truncated ? "+" : "") + " (" + formatCounts(summary.counts) + ")");
    if (summary.cleanupEffectCount) out.push("effects with cleanup: " + summary.cleanupEffectCount);
    out.push(...renderComplexityText(summary, records || []));
    const treeGroups = (records || []).filter((r) => r.index !== null || r.primitive === "DebugValue").map((r) => ({
      path: r.path || [],
      hooks: [{ hookId: r.index, primitive: r.primitive, debugLabel: r.debugLabel }]
    }));
    if (treeGroups.length) {
      out.push("structure:");
      const treeText = renderTreeText(componentName, null, treeGroups).split("\n").slice(1);
      out.push(...treeText.map((line) => "  " + line));
    } else {
      out.push("structure: unavailable from replay; using live hook list only");
    }
    if (summary.replayedHookCount != null && summary.replayedHookCount !== summary.hookCount) {
      out.push("fiber-only: 0 hooks replayed; " + summary.hookCount + " committed hook slots read");
    }
    if (warnings && warnings.length) out.push("warnings: " + warnings.join("; "));
    return out.join("\n");
  }
  const MAX_COMPONENT_STRINGS = 12;
  const MIN_LENGTH = 2;
  const MAX_LENGTH = 120;
  const NOISE = /* @__PURE__ */ new Set([
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "circle",
    "code",
    "col",
    "dd",
    "defs",
    "details",
    "dialog",
    "div",
    "dl",
    "dt",
    "em",
    "fieldset",
    "figure",
    "footer",
    "form",
    "g",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "i",
    "iframe",
    "img",
    "input",
    "label",
    "legend",
    "li",
    "line",
    "link",
    "main",
    "mask",
    "meta",
    "nav",
    "ol",
    "option",
    "p",
    "path",
    "pre",
    "polygon",
    "polyline",
    "rect",
    "section",
    "select",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "svg",
    "table",
    "tbody",
    "td",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "use",
    "video",
    "function",
    "object",
    "string",
    "number",
    "boolean",
    "undefined",
    "symbol",
    "bigint",
    "use strict",
    "default",
    "children"
  ]);
  function skipSpace(text, index) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    return index;
  }
  function previousSignificant(text, index) {
    let at2 = index - 1;
    while (at2 >= 0 && /\s/.test(text[at2])) at2 -= 1;
    return at2 >= 0 ? text[at2] : "";
  }
  function quotedEnd(text, start, quote) {
    for (let at2 = start + 1; at2 < text.length; at2 += 1) {
      const char = text[at2];
      if (char === "\\") at2 += 1;
      else if (char === quote) return at2;
      else if (char === "\n" && quote !== "`") return -1;
    }
    return -1;
  }
  function templateChunks(text, start) {
    const chunks = [];
    let chunk = "";
    for (let at2 = start + 1; at2 < text.length; at2 += 1) {
      const char = text[at2];
      if (char === "\\") {
        chunk += text.slice(at2, at2 + 2);
        at2 += 1;
      } else if (char === "`") {
        chunks.push(chunk);
        return { chunks, end: at2 };
      } else if (char === "$" && text[at2 + 1] === "{") {
        chunks.push(chunk);
        chunk = "";
        let depth = 1;
        for (at2 += 2; at2 < text.length && depth > 0; at2 += 1) {
          if (text[at2] === "{") depth += 1;
          else if (text[at2] === "}") depth -= 1;
        }
        at2 -= 1;
      } else {
        chunk += char;
      }
    }
    return { chunks, end: text.length };
  }
  const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|case|void|delete|throw|in|of|new|yield|await)\s*$/;
  function startsRegex(text, index) {
    const before = previousSignificant(text, index);
    return before === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(before) || REGEX_KEYWORD.test(text.slice(Math.max(0, index - 12), index));
  }
  function regexEnd(text, start) {
    let inClass = false;
    for (let at2 = start + 1; at2 < text.length; at2 += 1) {
      const char = text[at2];
      if (char === "\\") at2 += 1;
      else if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return at2;
      else if (char === "\n") return start;
    }
    return start;
  }
  function stringLiterals(text) {
    const out = [];
    for (let at2 = 0; at2 < text.length; at2 += 1) {
      const char = text[at2];
      if (char === "/" && text[at2 + 1] === "/") {
        const end = text.indexOf("\n", at2);
        at2 = end === -1 ? text.length : end;
      } else if (char === "/" && text[at2 + 1] === "*") {
        const end = text.indexOf("*/", at2 + 2);
        at2 = end === -1 ? text.length : end + 1;
      } else if (char === "/" && startsRegex(text, at2)) {
        at2 = regexEnd(text, at2);
      } else if (char === '"' || char === "'") {
        const end = quotedEnd(text, at2, char);
        if (end === -1) continue;
        const before = previousSignificant(text, at2);
        const key = (before === "{" || before === ",") && text[skipSpace(text, end + 1)] === ":";
        out.push({ value: text.slice(at2 + 1, end), key, end });
        at2 = end;
      } else if (char === "`") {
        const { chunks, end } = templateChunks(text, at2);
        for (const chunk of chunks) out.push({ value: chunk, key: false, end });
        at2 = end;
      }
    }
    return out;
  }
  function distinctive(value) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return false;
    if (!/[A-Za-z]/.test(trimmed) || NOISE.has(trimmed)) return false;
    return !/^react\./.test(trimmed);
  }
  function componentStringsOf(text, max = MAX_COMPONENT_STRINGS) {
    const literals = stringLiterals(text);
    const seen = /* @__PURE__ */ new Set();
    const strings = [];
    for (let index = 0; index < literals.length; index += 1) {
      const literal = literals[index];
      let value = null;
      if (literal.key) {
        const next = literals[index + 1];
        const colon = skipSpace(text, literal.end + 1);
        const valueStart = skipSpace(text, colon + 1);
        if (literal.value.includes("-") && next && !next.key && next.end > valueStart && /["']/.test(text[valueStart] ?? "")) {
          if (distinctive(next.value)) value = `${literal.value}="${next.value}"`;
          index += 1;
        }
      } else if (distinctive(literal.value)) {
        value = literal.value.trim();
      }
      if (value === null || seen.has(value)) continue;
      seen.add(value);
      strings.push(value);
    }
    return { strings: strings.slice(0, max), omitted: Math.max(0, strings.length - max) };
  }
  function componentStrings(type, max = MAX_COMPONENT_STRINGS) {
    const fn = componentFunctionOf(type);
    if (!fn) return { strings: [], omitted: 0 };
    try {
      return componentStringsOf(Function.prototype.toString.call(fn), max);
    } catch {
      return { strings: [], omitted: 0 };
    }
  }
  const MAX_WHERE_TO_LOOK = 8;
  const MAX_BOUNDARY_DISTANCE = 400;
  function lead(definition, name, why, confidence) {
    return { file: definition.fileName, line: definition.lineNumber, column: definition.columnNumber, name, why, confidence };
  }
  function sameLocation(a, b) {
    return a.file === b.file && a.line === b.line && a.column === b.column;
  }
  function whereToLookFor(origin) {
    if (!origin) return [];
    const out = [];
    const add = (entry) => {
      if (!out.some((existing) => sameLocation(existing, entry))) out.push(entry);
    };
    const candidates = origin.candidates ?? [];
    const inferred = origin.nameEvidence === "ancestor-reference" && origin.context;
    if (origin.status === "resolved" && origin.definition) {
      add(lead(
        origin.definition,
        origin.name,
        inferred ? `${origin.context.name || "an ancestor"}'s code references ${origin.name}` : "definition",
        inferred ? "inferred" : "exact"
      ));
    }
    for (const candidate of candidates) {
      if (!candidate.definition) continue;
      const sameName = origin.status === "resolved" && candidate.name === origin.name;
      const why = sameName && !inferred ? `one of ${candidates.length} definitions named ${origin.name} with identical code` : sameName ? `${origin.context.name || "an ancestor"}'s code references ${origin.name}` : "identical minified code";
      add(lead(candidate.definition, candidate.name, why, sameName && inferred ? "inferred" : "possible"));
    }
    if (inferred && origin.context.definition) {
      add(lead(origin.context.definition, origin.context.name || null, "nearest ancestor whose code references it", "inferred"));
    }
    return out;
  }
  function limitsOf(origin, grepCount) {
    var _a2, _b2;
    const grep = grepCount > 0 ? "search for the grep strings" : "the component code has no distinctive strings";
    if (!origin) return [`component origin not resolved: file unknown; ${grep}`];
    const limits = [];
    const count = ((_a2 = origin.candidates) == null ? void 0 : _a2.length) ?? 0;
    switch (origin.status) {
      case "resolved":
        if (origin.nameEvidence === "ancestor-reference") {
          limits.push(`name inferred from ${((_b2 = origin.context) == null ? void 0 : _b2.name) || "an ancestor"}'s code; identical code maps to ${count} components`);
        } else if (!origin.definition && count > 1) {
          limits.push(`${count} definitions share this name and code; each is listed as possible`);
        }
        break;
      case "ambiguous":
        limits.push(`identical minified code maps to ${count} components; name and file are one of the possible locations`);
        break;
      case "no-source-map":
        limits.push(`no source map for ${origin.script}: file unknown; ${grep}`);
        break;
      case "unmapped":
        limits.push(`the source map has no mapping for this component: file unknown; ${grep}`);
        break;
      case "not-found":
        limits.push(`component code not found in the page's scripts: file unknown; ${grep}`);
        break;
      case "unsupported":
        limits.push(`component code is not readable: file unknown`);
        break;
    }
    if (origin.truncated) {
      limits.push(`search stopped at ${MAX_OCCURRENCES} occurrences or ${MAX_CANDIDATES} candidates; the real definition may be missing`);
    }
    return limits;
  }
  function nearestTestId(fiber) {
    var _a2, _b2;
    if (typeof Element === "undefined") return null;
    try {
      return ((_b2 = (_a2 = getFiberDomNode(fiber)) == null ? void 0 : _a2.closest("[data-testid]")) == null ? void 0 : _b2.getAttribute("data-testid")) ?? null;
    } catch {
      return null;
    }
  }
  function nearestErrorBoundary(fiber) {
    let distance = 0;
    for (let node = fiber.return ?? null; node && distance < MAX_BOUNDARY_DISTANCE; node = node.return ?? null) {
      distance += 1;
      const boundary = describeErrorBoundary(node);
      if (boundary) return { name: boundary.componentName, distance };
    }
    return null;
  }
  function productionBreadcrumbs(fiber, resolver = pageComponentOrigins()) {
    if (!fiber || !needsComponentOrigin(fiber)) return null;
    const origin = resolver.peek(fiber.type);
    const all = whereToLookFor(origin);
    const { strings, omitted } = componentStrings(fiber.type);
    return {
      whereToLook: all.slice(0, MAX_WHERE_TO_LOOK),
      ...all.length > MAX_WHERE_TO_LOOK ? { whereToLookOmitted: all.length - MAX_WHERE_TO_LOOK } : {},
      grep: strings,
      ...omitted ? { grepOmitted: omitted } : {},
      script: (origin == null ? void 0 : origin.script) && origin.generated ? { url: origin.script, ...origin.generated } : null,
      nearestTestId: nearestTestId(fiber),
      errorBoundary: nearestErrorBoundary(fiber),
      limits: limitsOf(origin, strings.length)
    };
  }
  function applyProductionBreadcrumbs(entry, fiber) {
    if (!entry) return;
    const breadcrumbs = productionBreadcrumbs(fiber);
    if (breadcrumbs) entry.breadcrumbs = breadcrumbs;
  }
  function evalDescribeComponent(fiberIdRaw, nameRaw, deps) {
    const target = deps.resolveFiberTarget(null, fiberIdRaw, nameRaw);
    if (target.error) return { ok: false, error: target.error };
    const { fiber, resolvedBy } = target;
    const fiberId = fiberIdRaw && deps.getRememberedFiber(String(fiberIdRaw)) ? String(fiberIdRaw) : deps.rememberFiber(fiber);
    const liveHooks = deps.evalFiberHooks(fiber);
    const liveHookCount = liveHooks.hookCount;
    const { componentName, records, replayAttempted, replayError, replayErrorDetails, replayStatus } = deps.replayComponentHooks(fiber);
    const source = getFiberSource$2(fiber);
    const replayedHookCount = records.filter((r) => r.index != null).length;
    const hookCount = liveHookCount;
    const captureEngineOk = replayAttempted && records.length > 0;
    const warnings = [];
    if (!replayAttempted)
      warnings.push("fiber-only: component functions and hooks were not executed; custom-hook ancestry is unavailable unless captured metadata exists");
    if (replayError) warnings.push("replay-error: " + replayError);
    const anyAncestry = records.some((r) => r.path && r.path.length > 0);
    if (!anyAncestry && hookCount > 0)
      warnings.push("flat-records: no custom-hook ancestry; reload page with devtools-hook-shim injected before react-dom");
    const tree = records.map((r) => ({
      path: r.path || [],
      hooks: [{ hookId: r.index, primitive: r.primitive, debugLabel: r.debugLabel }]
    }));
    const definition = componentDefinitionOf(fiber.type);
    const minifiedName = minifiedComponentName(fiber.type);
    const breadcrumbs = productionBreadcrumbs(fiber);
    const text = deps.renderTreeText(componentName, source ?? definition, tree);
    return {
      ok: true,
      componentName,
      ...minifiedName ? { minifiedName } : {},
      fiberId,
      resolvedBy,
      source: source ? { fileName: (source == null ? void 0 : source.fileName) || null, lineNumber: (source == null ? void 0 : source.lineNumber) || null } : null,
      ...definition ? { definition } : {},
      ...breadcrumbs ? { breadcrumbs } : {},
      hookCount,
      liveHookCount,
      replayedHookCount,
      replayStatus: replayStatus || "not-run-fiber-only",
      tree,
      text,
      captureEngineOk,
      warnings,
      replayError: replayError || void 0,
      replayErrorDetails: replayErrorDetails || void 0
    };
  }
  const MAX_TOKENS = 5e3;
  const MAX_TOKEN_LENGTH = 80;
  const MAX_DEPTH = 12;
  const SEPARATORS = /[^\w$]+/;
  const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
  const RENAME_TABLE_KEY = "componentNames";
  function nameTokensIn(value, limit = MAX_TOKENS) {
    const found = /* @__PURE__ */ new Set();
    const seen = /* @__PURE__ */ new Set();
    const addWords = (text) => {
      for (const word of text.split(SEPARATORS)) {
        if (found.size >= limit) return;
        if (word.length <= MAX_TOKEN_LENGTH && IDENTIFIER.test(word)) found.add(word);
      }
    };
    const visit = (node, depth) => {
      if (found.size >= limit) return;
      if (typeof node === "string") {
        addWords(node);
        return;
      }
      if (!node || typeof node !== "object" || depth > MAX_DEPTH || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      for (const [key, item] of Object.entries(node)) {
        if (key === RENAME_TABLE_KEY) continue;
        addWords(key);
        visit(item, depth + 1);
      }
    };
    visit(value, 0);
    return found;
  }
  function isRename(value) {
    const rename = value;
    return !!rename && typeof rename.name === "string" && typeof rename.minifiedName === "string";
  }
  function componentNamesIn(value, renames) {
    if (!Array.isArray(renames) || renames.length === 0) return [];
    const tokens = nameTokensIn(value);
    return renames.filter((rename) => isRename(rename) && tokens.has(rename.name));
  }
  const DEFAULT_NETWORK_WINDOW_MS = 250;
  const NETWORK_SORT_KEYS = ["start", "end", "duration"];
  const round$4 = (value) => Math.round(value * 10) / 10;
  function commitAnchors(commitTimings) {
    var _a2;
    const anchors = [];
    for (const [id, timing] of Object.entries(commitTimings ?? {})) {
      const commitStart2 = Number(timing == null ? void 0 : timing.startTime);
      const commitEnd = Number(timing == null ? void 0 : timing.endTime);
      if (!Number.isFinite(commitStart2) || !Number.isFinite(commitEnd)) continue;
      const renderStart = Number((_a2 = timing == null ? void 0 : timing.render) == null ? void 0 : _a2.renderStart);
      const renderStartKnown = Number.isFinite(renderStart) && renderStart <= commitStart2;
      anchors.push({
        commitId: Number(id),
        renderStart: renderStartKnown ? renderStart : commitStart2,
        renderStartKnown,
        commitStart: commitStart2,
        commitEnd
      });
    }
    return anchors.sort((a, b) => a.commitStart - b.commitStart);
  }
  function firstAtOrAfter(anchors, value, key) {
    let lo = 0;
    let hi = anchors.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (anchors[mid][key] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function linkRequest(request, anchors, windowMs) {
    const { startTime, endTime } = request;
    const afterIndex = firstAtOrAfter(anchors, startTime, "commitEnd") - 1;
    const after = afterIndex >= 0 ? anchors[afterIndex] : null;
    const startedAfter = after && startTime - after.commitEnd <= windowMs ? { commitId: after.commitId, gapMs: round$4(startTime - after.commitEnd) } : null;
    const rendering = anchors[firstAtOrAfter(anchors, startTime, "commitStart")];
    const startedDuringRender = rendering && rendering.renderStartKnown && rendering.renderStart <= startTime ? rendering.commitId : null;
    let landedBefore = null;
    for (let i = firstAtOrAfter(anchors, endTime, "commitStart"); i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.renderStart - endTime > windowMs) break;
      if (anchor.renderStart >= endTime) {
        landedBefore = { commitId: anchor.commitId, gapMs: round$4(anchor.renderStart - endTime) };
        break;
      }
    }
    const commitsInFlight = firstAtOrAfter(anchors, endTime, "commitStart") - firstAtOrAfter(anchors, startTime, "commitStart");
    return { startedAfter, startedDuringRender, landedBefore, commitsInFlight: Math.max(0, commitsInFlight) };
  }
  function requestsOf(report) {
    return Array.isArray(report.networkRequests) ? report.networkRequests : [];
  }
  function windowOf(windowMs) {
    const value = Number(windowMs);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NETWORK_WINDOW_MS;
  }
  function linkNetworkRequests(report, windowMs) {
    const anchors = commitAnchors(report.commitTimings);
    const window2 = windowOf(windowMs);
    return requestsOf(report).map((request) => ({ ...request, ...linkRequest(request, anchors, window2) }));
  }
  function networkView(report, options = {}) {
    var _a2;
    const by = String(options.by || "start");
    if (!NETWORK_SORT_KEYS.includes(by)) {
      return { ok: false, error: "unsupported network sort key: " + by, validBy: NETWORK_SORT_KEYS };
    }
    let pattern = null;
    if (typeof options.match === "string" && options.match) {
      try {
        pattern = new RegExp(options.match, "i");
      } catch (error) {
        return { ok: false, error: "invalid match pattern: " + error.message };
      }
    }
    const initiators = Array.isArray(options.initiators) ? options.initiators.map((value) => String(value).trim().toLowerCase()).filter(Boolean) : [];
    const top = Number.isFinite(Number(options.top)) && Number(options.top) > 0 ? Math.floor(Number(options.top)) : 20;
    const windowMs = windowOf(options.window);
    const linked = linkNetworkRequests(report, windowMs).filter((request) => (!pattern || pattern.test(request.url)) && (initiators.length === 0 || initiators.includes(request.initiatorType.toLowerCase())));
    const byInitiator = {};
    let landedBeforeCommit = 0;
    let startedAfterCommit = 0;
    let startedDuringRender = 0;
    let longest = null;
    for (const request of linked) {
      byInitiator[request.initiatorType] = (byInitiator[request.initiatorType] || 0) + 1;
      if (request.landedBefore) landedBeforeCommit += 1;
      if (request.startedAfter) startedAfterCommit += 1;
      if (request.startedDuringRender !== null) startedDuringRender += 1;
      if (!longest || request.duration > longest.duration) longest = request;
    }
    const sorted = linked.slice().sort((a, b) => by === "duration" ? b.duration - a.duration : by === "end" ? a.endTime - b.endTime : a.startTime - b.startTime);
    return {
      ok: true,
      payload: {
        available: Array.isArray(report.networkRequests),
        capture: ((_a2 = report.meta) == null ? void 0 : _a2.network) ?? null,
        windowMs,
        by,
        total: linked.length,
        summary: {
          byInitiator,
          landedBeforeCommit,
          startedAfterCommit,
          startedDuringRender,
          longest: longest ? { id: longest.id, url: longest.url, duration: longest.duration } : null
        },
        rows: sorted.slice(0, top)
      }
    };
  }
  function networkByCommit(report, windowMs) {
    const out = /* @__PURE__ */ new Map();
    const entry = (commitId) => {
      let value = out.get(commitId);
      if (!value) {
        value = { landedBefore: [], startedAfter: [], startedDuringRender: [], inFlight: 0 };
        out.set(commitId, value);
      }
      return value;
    };
    const linked = linkNetworkRequests(report, windowMs);
    for (const request of linked) {
      if (request.landedBefore) entry(request.landedBefore.commitId).landedBefore.push(request);
      if (request.startedAfter) entry(request.startedAfter.commitId).startedAfter.push(request);
      if (request.startedDuringRender !== null) entry(request.startedDuringRender).startedDuringRender.push(request);
    }
    const anchors = commitAnchors(report.commitTimings);
    for (const anchor of anchors) {
      const inFlight = linked.filter((request) => request.startTime <= anchor.commitStart && request.endTime >= anchor.commitStart).length;
      if (inFlight > 0) entry(anchor.commitId).inFlight = inFlight;
    }
    return out;
  }
  const GRID_COLUMNS = 48;
  function grid(frames) {
    const [width, height] = frames[frames.length - 1].change.viewport;
    const cols = GRID_COLUMNS;
    const rows = Math.max(1, Math.round(cols * height / Math.max(1, width)));
    const cw = width / cols;
    const ch = height / rows;
    const last = new Float64Array(cols * rows).fill(Number.NaN);
    for (const frame2 of frames) {
      for (const [l, t, r, b] of frame2.change.rects) {
        const c0 = Math.max(0, Math.round(l / cw));
        const c1 = Math.min(cols, Math.round(r / cw));
        const r0 = Math.max(0, Math.round(t / ch));
        const r1 = Math.min(rows, Math.round(b / ch));
        for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) last[y * cols + x] = frame2.t;
      }
    }
    return { width, height, cols, rows, cw, ch, last };
  }
  function timeAtShare(times, total, share, floor) {
    if (total === 0) return null;
    const sorted = times.slice().sort((a, b) => a - b);
    const needed = Math.ceil(total * share);
    const missing = total - sorted.length;
    if (needed <= missing) return floor;
    return sorted[Math.min(sorted.length - 1, needed - missing - 1)];
  }
  function screenStability(frames) {
    const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
    if (sorted.length === 0) return null;
    const g = grid(sorted);
    const changedTimes = [];
    for (const value of g.last) if (!Number.isNaN(value)) changedTimes.push(value);
    const total = g.last.length;
    const vc = (share) => timeAtShare(changedTimes, total, share, 0) ?? 0;
    const changedVc90 = timeAtShare(changedTimes, changedTimes.length, 0.9, 0);
    const late = changedVc90 === null ? [] : sorted.filter((f) => f.t > changedVc90 && f.change.regions.length).reverse().slice(0, 5).map((f) => ({ label: f.change.regions[0].label, at: f.t, commitId: f.commitId, share: f.change.share }));
    return {
      viewport: [g.width, g.height],
      changedShare: Math.round(changedTimes.length / total * 1e3) / 1e3,
      vc50: vc(0.5),
      vc90: vc(0.9),
      vc100: changedTimes.length ? Math.max(...changedTimes) : 0,
      changedVc90,
      late,
      visibleCommits: sorted.filter((f) => f.change.share >= 0.01).length
    };
  }
  const RAMP = ["#fde9a9", "#fbcf7d", "#f7b35a", "#f0953f", "#e5762e", "#d45726", "#bd3b22", "#9f2420", "#7d121c", "#590616"];
  const UNCHANGED = "#e6e6e6";
  function escapeXml(text) {
    return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  }
  function settleMapSvg(frames, title = "When each part of the screen last changed") {
    var _a2;
    const sorted = frames.filter((f) => f.change.rects.length > 0).sort((a, b) => a.t - b.t);
    if (sorted.length === 0) return null;
    const g = grid(sorted);
    const times = Array.from(g.last).filter((v) => !Number.isNaN(v));
    const min = Math.min(...times);
    const max = Math.max(...times);
    const bucket = (t) => max === min ? RAMP.length - 1 : Math.min(RAMP.length - 1, Math.floor((t - min) / (max - min) * RAMP.length));
    const scale = Math.min(1, 640 / g.width);
    const w = Math.round(g.width * scale);
    const h = Math.round(g.height * scale);
    const cw = g.cw * scale;
    const ch = g.ch * scale;
    const legendH = 34;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + legendH}" width="${w}" height="${h + legendH}" font-family="system-ui, sans-serif" font-size="11" shape-rendering="crispEdges">`,
      `<title>${escapeXml(title)}</title>`,
      `<rect x="0" y="0" width="${w}" height="${h}" fill="${UNCHANGED}"/>`
    ];
    for (let y = 0; y < g.rows; y++) {
      let x = 0;
      while (x < g.cols) {
        const value = g.last[y * g.cols + x];
        if (Number.isNaN(value)) {
          x++;
          continue;
        }
        const color = bucket(value);
        let end = x + 1;
        while (end < g.cols && !Number.isNaN(g.last[y * g.cols + end]) && bucket(g.last[y * g.cols + end]) === color) end++;
        parts.push(`<rect x="${(x * cw).toFixed(1)}" y="${(y * ch).toFixed(1)}" width="${((end - x) * cw).toFixed(1)}" height="${ch.toFixed(1)}" fill="${RAMP[color]}"/>`);
        x = end;
      }
    }
    for (const frame2 of sorted.slice(-3)) {
      const [l, t, r, b] = frame2.change.rects[0];
      const label = (_a2 = frame2.change.regions[0]) == null ? void 0 : _a2.label;
      if (!label) continue;
      const cx = (l + r) / 2 * scale;
      const cy = (t + b) / 2 * scale;
      parts.push(`<text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${escapeXml(`${label} +${frame2.t}`)}</text>`);
    }
    const sw = Math.max(18, Math.floor((w - 120) / RAMP.length));
    parts.push(`<rect x="0" y="${h + 8}" width="14" height="12" fill="${UNCHANGED}"/><text x="18" y="${h + 18}" fill="#444">unchanged</text>`);
    RAMP.forEach((color, i) => parts.push(`<rect x="${90 + i * sw}" y="${h + 8}" width="${sw}" height="12" fill="${color}"/>`));
    parts.push(`<text x="90" y="${h + 31}" fill="#444">+${min} ms</text>`);
    parts.push(`<text x="${90 + RAMP.length * sw}" y="${h + 31}" text-anchor="end" fill="#444">+${max} ms</text>`);
    parts.push("</svg>");
    return parts.join("");
  }
  function inputDetail(event) {
    if (!event || typeof event !== "object") return null;
    const parts = [];
    if (typeof event.key === "string") parts.push(event.key);
    const held = Array.isArray(event.modifiers) ? event.modifiers.filter((m) => typeof m === "string" && m !== event.key) : [];
    if (held.length) parts.push("with " + held.join("+"));
    if (event.trusted === false) parts.push("dispatched");
    return parts.length ? parts.join(" ") : null;
  }
  function inputLabel(i) {
    return i.action + (i.detail ? " " + i.detail : "") + (i.target ? " " + i.target : "");
  }
  const round$3 = (n) => Math.round(n);
  function requestLabel(url) {
    try {
      const parsed = new URL(url, "http://local.invalid");
      const op = parsed.searchParams.get("operation") || parsed.searchParams.get("operationName") || parsed.searchParams.get("opName");
      if (op) return op;
      const segments = parsed.pathname.split("/").filter((s) => s && !/^[0-9a-f]{16,}$/i.test(s) && !/^\d+$/.test(s));
      const tail = segments.slice(-2).join("/") || parsed.pathname;
      return parsed.host === "local.invalid" ? tail : parsed.host + " …/" + tail;
    } catch (_) {
      return url.slice(0, 60);
    }
  }
  function commitStart$1(report, id) {
    var _a2, _b2;
    const start = Number((_b2 = (_a2 = report.commitTimings) == null ? void 0 : _a2[String(id)]) == null ? void 0 : _b2.startTime);
    return Number.isFinite(start) ? start : null;
  }
  const PAINT_NOTE_MS = 50;
  function commitPaint(report, id, start) {
    var _a2, _b2;
    const paint = Number((_b2 = (_a2 = report.commitTimings) == null ? void 0 : _a2[String(id)]) == null ? void 0 : _b2.paintAt);
    return Number.isFinite(paint) && paint >= start ? paint : null;
  }
  function renderedCount(report, id) {
    var _a2, _b2, _c2;
    const fromStats = Number(((_b2 = (_a2 = report.commitStats) == null ? void 0 : _a2[String(id)]) == null ? void 0 : _b2[3]) || 0);
    if (fromStats > 0) return fromStats;
    const list = (_c2 = report.renderedByCommit) == null ? void 0 : _c2[String(id)];
    return Array.isArray(list) ? list.length : 0;
  }
  function screenOf(report, id) {
    var _a2, _b2, _c2;
    const change = (_a2 = report.screenByCommit) == null ? void 0 : _a2[String(id)];
    if (!change || typeof change.share !== "number") return null;
    return { share: change.share, region: ((_c2 = (_b2 = change.regions) == null ? void 0 : _b2[0]) == null ? void 0 : _c2.label) ?? null };
  }
  const percent = (share) => `${Math.round(share * 100)}%`;
  function kindOf(events) {
    const enters = events.some((e) => e.entered);
    const leaves = events.some((e) => e.left);
    return enters && leaves ? "swap" : enters ? "lock" : leaves ? "unlock" : "update";
  }
  function buildTimeline(report, options = {}) {
    var _a2, _b2, _c2;
    const ids = Object.keys(report.commitTimings ?? {}).map(Number).filter((id) => Number.isFinite(id) && commitStart$1(report, id) !== null).sort((a, b) => a - b);
    if (ids.length === 0) return { ok: false, error: "report has no commit timings (report version 6 or later is required)" };
    const startOf = (id) => commitStart$1(report, id);
    const shownOf = (id) => commitPaint(report, id, startOf(id)) ?? startOf(id);
    const interactions = /* @__PURE__ */ new Map();
    for (const list of Object.values(report.interactionsByCommit ?? {})) {
      for (const item of list || []) {
        const t = Number(item.timestamp);
        if (!Number.isFinite(t)) continue;
        const key = String(item.id ?? "") + "@" + t;
        const dom = (_a2 = item.location) == null ? void 0 : _a2.dom;
        const target = dom ? String(dom.nearestTestId || dom.text || dom.tag || "") || null : null;
        if (!interactions.has(key)) interactions.set(key, { t, action: String(item.action || "input"), target, detail: inputDetail(item.event) });
      }
    }
    const inputs = Array.from(interactions.values()).sort((a, b) => a.t - b.t);
    const firstInput = inputs[0];
    const fromCommit = options.fromCommit ?? (firstInput ? ids.find((id) => startOf(id) >= firstInput.t) ?? ids[0] : ids[0]);
    const toCommit = options.toCommit ?? ids[ids.length - 1];
    const windowIds = ids.filter((id) => id >= fromCommit && id <= toCommit);
    if (windowIds.length === 0) return { ok: false, error: `no commits between ${fromCommit} and ${toCommit}` };
    const windowStart = startOf(windowIds[0]);
    const windowEnd = startOf(windowIds[windowIds.length - 1]);
    const originInput = inputs.find((input2) => input2.t <= windowStart && windowStart - input2.t <= 5e3);
    const origin = originInput ? originInput.t : windowStart;
    const rel = (t) => round$3(t - origin);
    const input = inputs.filter((i) => i.t >= origin && i.t <= windowEnd).map((i) => ({ ...i, t: rel(i.t) }));
    let exclude = null;
    try {
      exclude = options.exclude ? new RegExp(options.exclude, "i") : null;
    } catch (_) {
      exclude = null;
    }
    const minRequestMs = options.minRequestMs ?? 50;
    const inWindow = (report.networkRequests ?? []).filter((r) => r.endTime >= origin && r.startTime <= windowEnd && !(exclude && exclude.test(r.url)));
    const toRequest = (r) => ({
      id: r.id,
      label: requestLabel(r.url),
      start: rel(r.startTime),
      end: rel(r.endTime),
      durationMs: round$3(r.duration),
      initiatorType: r.initiatorType,
      cached: !!r.cached
    });
    const drawable = inWindow.filter((r) => r.duration >= minRequestMs);
    const kept = [...drawable].sort((a, b) => b.duration - a.duration).slice(0, options.maxRequests ?? 30).sort((a, b) => a.startTime - b.startTime);
    const network = kept.map(toRequest);
    const perfLane = perfLaneOf(report.perfEntries ?? [], report.ownWork, origin, windowEnd, ids.map((id) => ({ id, start: startOf(id) })), rel, options.maxMarks ?? 40);
    const boundaryKey = (event) => typeof event.boundary === "number" ? "b" + event.boundary : "@" + Number(event.depth);
    const open = /* @__PURE__ */ new Map();
    const suspense = [];
    const boundaryInfo = /* @__PURE__ */ new Map();
    for (const id of ids.filter((commit) => commit <= windowIds[windowIds.length - 1])) {
      for (const event of ((_b2 = report.suspenseByCommit) == null ? void 0 : _b2[String(id)]) ?? []) {
        const depth = Number(event.depth);
        if (!Number.isFinite(depth)) continue;
        const boundary = boundaryKey(event);
        const info = boundaryInfo.get(boundary);
        if (!info) boundaryInfo.set(boundary, { depth, location: event.location ?? null });
        else if (!info.location && event.location) info.location = event.location;
        if (event.entered) open.set(boundary, [...open.get(boundary) || [], id]);
        if (event.left) {
          const entered = (_c2 = open.get(boundary)) == null ? void 0 : _c2.shift();
          if (entered === void 0) continue;
          if (startOf(id) >= windowStart && startOf(entered) <= windowEnd) {
            suspense.push({
              boundary,
              depth,
              label: null,
              start: rel(shownOf(entered)),
              end: rel(shownOf(id)),
              enteredAt: entered,
              leftAt: id
            });
          }
        }
      }
    }
    for (const [boundary, stack] of open) {
      for (const entered of stack) {
        if (startOf(entered) <= windowEnd) {
          const { depth } = boundaryInfo.get(boundary);
          suspense.push({ boundary, depth, label: null, start: rel(shownOf(entered)), end: null, enteredAt: entered, leftAt: null });
        }
      }
    }
    suspense.sort((a, b) => a.start - b.start || a.depth - b.depth);
    const boundaryKeys = Array.from(new Set(suspense.map((s) => s.boundary)));
    const labels = distinguishingLabels(boundaryKeys.map((key) => {
      var _a3;
      return (_a3 = boundaryInfo.get(key)) == null ? void 0 : _a3.location;
    }));
    const labelByKey = new Map(boundaryKeys.map((key, i) => [key, labels[i]]));
    for (const s of suspense) s.label = labelByKey.get(s.boundary) ?? null;
    const boundaryName = (event) => {
      const key = boundaryKey(event);
      return labelByKey.get(key) || "@" + Number(event.depth);
    };
    const frames = windowIds.map((id) => {
      var _a3;
      return { commitId: id, t: rel(shownOf(id)), change: (_a3 = report.screenByCommit) == null ? void 0 : _a3[String(id)] };
    }).filter((f) => !!f.change && Array.isArray(f.change.rects));
    const allCommits = windowIds.map((id) => {
      var _a3, _b3, _c3, _d2, _e2;
      const events = ((_a3 = report.suspenseByCommit) == null ? void 0 : _a3[String(id)]) ?? [];
      const renderStart = Number((_d2 = (_c3 = (_b3 = report.commitTimings) == null ? void 0 : _b3[String(id)]) == null ? void 0 : _c3.render) == null ? void 0 : _d2.renderStart);
      const paint = commitPaint(report, id, startOf(id));
      const sources = (((_e2 = report.sourcesByCommit) == null ? void 0 : _e2[String(id)]) ?? []).slice().sort((a, b) => Number(b.collateral || 0) - Number(a.collateral || 0)).map((s) => String(s.sourceId || "").split("#")[0]).filter(Boolean);
      return {
        commitId: id,
        t: rel(startOf(id)),
        renderStart: Number.isFinite(renderStart) && renderStart <= startOf(id) ? rel(renderStart) : null,
        paintAt: paint === null ? null : rel(paint),
        rendered: renderedCount(report, id),
        kind: kindOf(events),
        suspense: events.map((e) => (e.entered ? "enter " : "leave ") + boundaryName(e)),
        sources: Array.from(new Set(sources)).slice(0, 2),
        screen: screenOf(report, id)
      };
    });
    const updates = allCommits.filter((c) => c.kind === "update");
    const topUpdates = new Set([...updates].filter((c) => c.rendered > 0).sort((a, b) => b.rendered - a.rendered).slice(0, options.maxCommits ?? 25).map((c) => c.commitId));
    const commits = allCommits.filter((c) => c.kind !== "update" || topUpdates.has(c.commitId));
    const sumUpdates = (list) => ({ commits: list.length, rendered: list.reduce((n, c) => n + c.rendered, 0) });
    const allRequests = inWindow.map(toRequest);
    const waits = suspense.map((s) => {
      const until = s.end ?? rel(windowEnd);
      const lastRequests = allRequests.filter((r) => r.end <= until && r.end >= s.start).sort((a, b) => b.end - a.end).slice(0, 3).map((r) => ({ label: r.label, end: r.end, gapMs: until - r.end }));
      return {
        boundary: s.boundary,
        depth: s.depth,
        label: s.label,
        from: s.start,
        until: s.end,
        waitedMs: until - s.start,
        lockedBy: s.enteredAt,
        unlockedBy: s.leftAt,
        lastRequests: s.end === null ? [] : lastRequests,
        updatesDuring: sumUpdates(updates.filter((c) => c.commitId > s.enteredAt && (s.leftAt === null || c.commitId < s.leftAt)))
      };
    }).sort((a, b) => b.waitedMs - a.waitedMs);
    const nextInput = input.find((i) => i.t > 0);
    const ownWaits = suspense.filter((s) => !nextInput || s.start < nextInput.t);
    const stillWaiting = ownWaits.filter((s) => s.end === null).map((s) => s.boundary);
    const unlocks = ownWaits.filter((s) => s.end !== null).map((s) => s.end);
    const settledAt = stillWaiting.length === 0 && unlocks.length ? Math.max(...unlocks) : null;
    const result = {
      ok: true,
      origin: { at: Math.round(origin * 10) / 10, kind: originInput ? "interaction" : "commit" },
      window: { fromCommit: windowIds[0], toCommit: windowIds[windowIds.length - 1], start: rel(windowStart), end: rel(windowEnd) },
      perceived: {
        firstLockAt: suspense.length ? suspense[0].start : null,
        settledAt,
        stillWaiting,
        waits,
        updatesAfterSettled: sumUpdates(settledAt === null ? [] : updates.filter((c) => c.t > settledAt && (!nextInput || c.t < nextInput.t)))
      },
      boundaries: boundaryKeys.map((key) => ({ boundary: key, depth: boundaryInfo.get(key).depth, label: labelByKey.get(key) ?? null, location: boundaryInfo.get(key).location })),
      screen: screenStability(frames),
      ...options.settleMap && { settleMapSvg: settleMapSvg(frames) },
      lanes: { input, network, suspense, commits, perf: perfLane.lane },
      omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length, marks: perfLane.omittedMarks },
      mermaid: "",
      text: ""
    };
    result.mermaid = renderMermaid(result);
    result.text = renderText(result);
    return result;
  }
  const SHIFT_MIN = 1e-3;
  const EVENT_MIN_MS = 50;
  function perfLaneOf(entries, ownWork, origin, windowEnd, commitStarts2, rel, maxMarks) {
    var _a2, _b2, _c2;
    const lane = [];
    let marks = 0;
    let omittedMarks = 0;
    const sorted = entries.filter((e) => e.startTime + (e.duration || 0) >= origin && e.startTime <= windowEnd).sort((a, b) => a.startTime - b.startTime);
    for (const e of sorted) {
      let kind = null;
      let label = e.name;
      let value = null;
      let chippy = false;
      if (e.entryType === "long-animation-frame" || e.entryType === "longtask") {
        kind = "frame";
        value = e.entryType === "longtask" ? round$3(Math.max(0, e.duration - 50)) : e.blockingDuration ?? null;
        const script = (_a2 = e.scripts) == null ? void 0 : _a2[0];
        label = script ? [script.invoker, script.sourceFunctionName, (_b2 = script.sourceURL) == null ? void 0 : _b2.split("/").pop()].filter(Boolean).join(" ") : "";
        chippy = isOwnFrame(e, ownWork);
        if (chippy) label = "Chippy";
      } else if (e.entryType === "measure" && e.duration >= 1) kind = "measure";
      else if (e.entryType === "measure" || e.entryType === "mark") {
        if (marks >= maxMarks) {
          omittedMarks += 1;
          continue;
        }
        marks += 1;
        kind = "mark";
      } else if (e.entryType === "layout-shift" && (e.value ?? 0) >= SHIFT_MIN && !e.hadRecentInput) {
        kind = "shift";
        value = e.value ?? null;
        const source = (_c2 = e.sources) == null ? void 0 : _c2.find((s) => s.component || s.testId);
        label = source ? source.component || source.testId || "" : "";
      } else if (e.entryType === "event" && e.duration >= EVENT_MIN_MS) {
        kind = "event";
        value = e.inputDelay ?? null;
        label = e.name + (e.target ? " " + (e.target.testId || e.target.component || e.target.element || "") : "");
      } else if (e.entryType === "largest-contentful-paint") {
        kind = "lcp";
        label = e.element ? e.element.testId || e.element.component || e.element.element || "" : "";
      }
      if (!kind) continue;
      const end = e.startTime + (e.duration || 0);
      lane.push({
        id: e.id,
        kind,
        label: label.trim(),
        start: rel(e.startTime),
        end: rel(end),
        durationMs: round$3(e.duration || 0),
        value,
        commits: commitStarts2.filter((c) => c.start >= e.startTime && c.start <= end).map((c) => c.id),
        ...chippy && { chippy: true }
      });
    }
    return { lane, omittedMarks };
  }
  const commitSpan = (ids) => ids.length === 0 ? "" : ids.length === 1 ? `c${ids[0]}` : `c${ids[0]}–c${ids[ids.length - 1]}`;
  const GANTT_KEYWORDS = /^(click|call|href|section|title|dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|inclusiveenddates|topaxis|acctitle|accdescr|displaymode|gantt)\b/i;
  function ganttTaskName(raw) {
    const name = raw.replace(/[:#;]/g, " ").replace(/%%/g, "% %").replace(/\s+/g, " ").trim() || "unnamed";
    return GANTT_KEYWORDS.test(name) ? "· " + name : name;
  }
  const safe = ganttTaskName;
  function renderMermaid(result) {
    const { input, network, suspense, commits } = result.lanes;
    const end = result.window.end;
    const slow = new Set([...network].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3).map((r) => r.id));
    const updates = commits.filter((c) => c.kind === "update");
    const heavy = new Set([...updates].sort((a, b) => b.rendered - a.rendered).slice(0, 3).filter((c) => c.rendered > 0).map((c) => c.commitId));
    const bar = (start, stop) => `${start}, ${Math.max(stop, start + 1)}`;
    const lines = [
      "gantt",
      `  title Commits ${result.window.fromCommit}–${result.window.toCommit}, ms from ${result.origin.kind === "interaction" ? "the interaction" : "the first commit"}`,
      "  dateFormat x",
      "  axisFormat %S.%L"
    ];
    if (input.length) {
      lines.push("  section Input");
      input.forEach((i, n) => lines.push(`  ${safe("input " + inputLabel(i))} :milestone, in${n}, ${i.t}, ${i.t}`));
    }
    if (network.length) {
      lines.push("  section Network");
      for (const r of network) lines.push(`  ${safe(r.label)} ${r.durationMs}ms :${slow.has(r.id) ? "crit, " : ""}net${r.id}, ${bar(r.start, r.end)}`);
    }
    const browser = result.lanes.perf.filter((p) => p.kind === "frame" || p.kind === "measure");
    if (browser.length) {
      lines.push("  section Browser (long frames, measures)");
      for (const p of browser) {
        const name = p.kind === "frame" ? `long frame ${p.durationMs}ms${p.commits.length ? " " + commitSpan(p.commits) : ""}` : `${p.label} ${p.durationMs}ms`;
        lines.push(`  ${safe(name)} :${p.kind === "frame" ? "crit, " : ""}perf${p.id}, ${bar(p.start, p.end)}`);
      }
    }
    if (suspense.length) {
      lines.push("  section User waits (fallback shown)");
      suspense.forEach((s, n) => {
        const stop = s.end ?? end;
        const label = s.end === null ? "still waiting" : `${stop - s.start}ms`;
        lines.push(`  ${safe(s.label || "@" + s.depth)} ${label} :${s.end === null ? "active" : "crit"}, sus${n}, ${bar(s.start, stop)}`);
      });
    }
    const screen = commits.filter((c) => c.kind !== "update");
    if (screen.length) {
      lines.push("  section Screen (lock or unlock)");
      for (const c of screen) lines.push(`  c${c.commitId} ${c.kind} ${safe(c.suspense.join(" "))} :milestone, c${c.commitId}, ${c.t}, ${c.t}`);
    }
    const visible = commits.filter((c) => c.screen && c.screen.share >= 0.01);
    if (result.screen) {
      lines.push("  section Screen changed (share of viewport)");
      for (const c of visible) {
        const at2 = c.paintAt ?? c.t;
        lines.push(`  c${c.commitId} ${percent(c.screen.share)}${c.screen.region ? " " + safe(c.screen.region) : ""} :milestone, sc${c.commitId}, ${at2}, ${at2}`);
      }
      lines.push(`  VC90 +${result.screen.vc90} :crit, milestone, vc90, ${result.screen.vc90}, ${result.screen.vc90}`);
    }
    if (updates.length) {
      lines.push("  section Updates (CPU, no Suspense change)");
      for (const c of updates) {
        const what = c.sources.length ? safe(c.sources.join(", ")) : "";
        const span = c.renderStart === null ? `milestone, c${c.commitId}, ${c.t}, ${c.t}` : `c${c.commitId}, ${bar(c.renderStart, c.t)}`;
        const seen = result.screen ? c.screen ? ` ${percent(c.screen.share)} screen` : " 0% screen" : "";
        lines.push(`  c${c.commitId} ${c.rendered} rendered${seen}${what ? " " + what : ""} :${heavy.has(c.commitId) ? "crit, " : ""}${span}`);
      }
    }
    return lines.join("\n");
  }
  function renderText(result) {
    const p = result.perceived;
    const header = [];
    if (p.waits.length === 0) header.push("No Suspense fallback was shown in this window.");
    else {
      header.push(p.settledAt !== null ? `Fallbacks first shown at +${p.firstLockAt}, all cleared at +${p.settledAt}; ${p.updatesAfterSettled.commits} updates (${p.updatesAfterSettled.rendered} rendered) ran after that, before the next input.` : `Fallbacks first shown at +${p.firstLockAt}; still waiting at the end: ${p.stillWaiting.map((key) => {
        var _a2;
        return ((_a2 = result.boundaries.find((b) => b.boundary === key)) == null ? void 0 : _a2.label) || key;
      }).join(", ")}.`);
      for (const w of p.waits.slice(0, 5)) {
        const last = w.lastRequests[0];
        header.push(`  wait ${w.label || "@" + w.depth} ${w.waitedMs}ms (+${w.from} → ${w.until === null ? "end" : "+" + w.until}), ${w.updatesDuring.commits} updates (${w.updatesDuring.rendered} rendered) meanwhile` + (last ? `, last request before unlock: ${last.label} (+${last.end}, ${last.gapMs}ms before)` : ""));
      }
    }
    const sc = result.screen;
    const painted = result.lanes.commits.some((c) => c.paintAt !== null);
    if (sc) {
      header.push(`Visually complete${painted ? " (at paint)" : ""}: VC50 +${sc.vc50}, VC90 +${sc.vc90}, VC100 +${sc.vc100}; ${percent(sc.changedShare)} of the viewport changed` + (sc.changedVc90 !== null ? `, 90% of that by +${sc.changedVc90}` : "") + ".");
      if (sc.late.length) header.push(`  changing after that: ${sc.late.map((l) => `${l.label} +${l.at} (c${l.commitId}, ${percent(l.share)})`).join(", ")}`);
    }
    const delayed = result.lanes.commits.filter((c) => c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS);
    if (delayed.length) {
      const worst = [...delayed].sort((a, b) => b.paintAt - b.t - (a.paintAt - a.t)).slice(0, 5);
      header.push(`Painted late (the commit's task kept running): ${worst.map((c) => `c${c.commitId} +${c.t} → painted +${c.paintAt} (${c.paintAt - c.t}ms)`).join(", ")}.`);
    }
    const frames = result.lanes.perf.filter((p2) => p2.kind === "frame" && !p2.chippy);
    const ownFrames = result.lanes.perf.filter((p2) => p2.kind === "frame" && p2.chippy);
    if (frames.length) {
      const worst = [...frames].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
      header.push(`Long frames (no paint inside): ${frames.length}, ${Math.round(frames.reduce((sum, p2) => sum + (p2.value ?? 0), 0))}ms blocking; longest ${worst.map((p2) => `+${p2.start} ${p2.durationMs}ms${p2.commits.length ? " (" + commitSpan(p2.commits) + ")" : ""}`).join(", ")}.`);
    }
    if (ownFrames.length) {
      header.push(`Chippy's own long frames, left out of the totals: ${ownFrames.length}, ${Math.round(ownFrames.reduce((sum, p2) => sum + (p2.value ?? 0), 0))}ms blocking.`);
    }
    const rows = [];
    for (const i of result.lanes.input) rows.push({ t: i.t, lane: "input", text: inputLabel(i) });
    for (const r of result.lanes.network) rows.push({ t: r.start, lane: "net", text: `${r.label}  → +${r.end} (${r.durationMs}ms${r.cached ? ", cached" : ""})` });
    for (const s of result.lanes.suspense) {
      rows.push({ t: s.start, lane: "wait", text: `fallback ${s.label || "@" + s.depth} ` + (s.end === null ? "still shown at the end" : `until +${s.end} (${s.end - s.start}ms, c${s.enteredAt}→c${s.leftAt})`) });
    }
    for (const c of result.lanes.commits) {
      const lane = c.kind === "update" ? "react" : "SCRN";
      const seen = c.screen ? ` · ${percent(c.screen.share)} screen${c.screen.region ? " " + c.screen.region : ""}` : sc ? " · 0% screen" : "";
      const paint = c.paintAt !== null && c.paintAt - c.t >= PAINT_NOTE_MS ? ` · painted +${c.paintAt}` : "";
      rows.push({ t: c.t, lane, text: `c${c.commitId} ${c.kind === "update" ? "" : c.kind + " "}${c.rendered} rendered${seen}${c.sources.length ? " · " + c.sources.join(", ") : ""}${c.suspense.length ? " · " + c.suspense.join(", ") : ""}${paint}` });
    }
    for (const p2 of result.lanes.perf) {
      const commits = p2.commits.length ? ` · ${commitSpan(p2.commits)}` : "";
      const text = p2.kind === "frame" ? `long frame ${p2.durationMs}ms (${p2.value ?? 0}ms blocking) → +${p2.end}${p2.label ? " · " + p2.label : ""}${commits}` : p2.kind === "measure" ? `measure ${p2.label} → +${p2.end} (${p2.durationMs}ms)` : p2.kind === "mark" ? `mark ${p2.label}` : p2.kind === "shift" ? `layout shift ${p2.value}${p2.label ? " · " + p2.label : ""}` : p2.kind === "event" ? `slow ${p2.label} ${p2.durationMs}ms (input delay ${p2.value ?? 0}ms)` : `LCP${p2.label ? " " + p2.label : ""}`;
      rows.push({ t: p2.start, lane: p2.kind === "frame" ? "frame" : "perf", text });
    }
    const order = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4, frame: 5, perf: 6 };
    rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
    const width = Math.max(...rows.map((r) => String(r.t).length), 1);
    return [...header, "", ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join("\n");
  }
  const DEFAULT_DOM_DIFF_COMMITS = 100;
  const DEFAULT_DOM_DIFF_CHANGES = 50;
  const ORDER_NOTE = "Each commit is one change set: its changes reached the DOM together and have no order. Order is between commits.";
  function searchable(change) {
    const props = (change.props || []).map(([name, before, after]) => `${name} ${before ?? ""} ${after ?? ""}`).join(" ");
    return `${change.op} ${change.node} ${change.at} ${change.html ?? ""} ${props}`;
  }
  function formatProps(props) {
    return (props || []).map(([name, before, after]) => `${name} ${before ?? "∅"} → ${after ?? "∅"}`).join("; ");
  }
  function formatDomChange(change) {
    if (change.op === "~") return `~ ${change.node}  ${formatProps(change.props)}`;
    const size = change.elements && change.elements > 1 ? ` (${change.elements}${change.elements >= MAX_ELEMENT_COUNT ? "+" : ""} el)` : "";
    return `${change.op} ${change.node}${size}  ${change.html ?? ""}`;
  }
  function renderCommit(view) {
    const when = view.t === null ? "" : `  +${view.t}ms`;
    const shown = view.changes.length < view.total ? `${view.changes.length} of ${view.total}` : String(view.total);
    const lines = [`#${view.commitId}${when} · ${shown} change${view.total === 1 ? "" : "s"}${view.truncated ? " (commit truncated)" : ""}`];
    const groups = /* @__PURE__ */ new Map();
    for (const change of view.changes) {
      const list = groups.get(change.at);
      if (list) list.push(change);
      else groups.set(change.at, [change]);
    }
    for (const [at2, changes] of groups) {
      lines.push(`  ${at2}`);
      for (const change of changes) lines.push(`    ${formatDomChange(change)}`);
    }
    return lines;
  }
  function buildDomDiffView(report, options = {}) {
    var _a2, _b2;
    let pattern = null;
    if (options.match) {
      try {
        pattern = new RegExp(options.match, "i");
      } catch (error) {
        return { error: "invalid match regex: " + (error.message || String(error)) };
      }
    }
    const from = Number.isFinite(Number(options.fromCommit)) && options.fromCommit != null ? Number(options.fromCommit) : -Infinity;
    const to = Number.isFinite(Number(options.toCommit)) && options.toCommit != null ? Number(options.toCommit) : Infinity;
    const top = Math.max(1, Math.floor(Number(options.top) || DEFAULT_DOM_DIFF_COMMITS));
    const maxItems = Math.max(1, Math.floor(Number(options.maxItems) || DEFAULT_DOM_DIFF_CHANGES));
    const byCommit = report.domByCommit || {};
    const ids = Object.keys(byCommit).map(Number).filter((id) => Number.isFinite(id) && id >= from && id <= to).sort((a, b) => a - b);
    const matched = [];
    for (const commitId of ids) {
      const diff = byCommit[String(commitId)];
      const changes = pattern ? diff.changes.filter((change) => pattern.test(searchable(change))) : diff.changes;
      if (changes.length) matched.push({ commitId, diff, changes });
    }
    const listed = matched.slice(0, top);
    const startOf = (id) => {
      var _a3, _b3;
      const start = (_b3 = (_a3 = report.commitTimings) == null ? void 0 : _a3[String(id)]) == null ? void 0 : _b3.startTime;
      return typeof start === "number" && Number.isFinite(start) ? start : null;
    };
    const origin = listed.length ? startOf(listed[0].commitId) : null;
    const commits = listed.map(({ commitId, diff, changes }) => {
      const startTime = startOf(commitId);
      return {
        commitId,
        t: startTime === null || origin === null ? null : Math.round((startTime - origin) * 10) / 10,
        startTime,
        total: changes.length,
        changes: changes.slice(0, maxItems),
        ...diff.truncated && { truncated: true }
      };
    });
    const evicted = ((_b2 = (_a2 = report.meta) == null ? void 0 : _a2.domDiff) == null ? void 0 : _b2.evicted) ?? null;
    const lines = [ORDER_NOTE];
    if (evicted) lines.push(`Commits up to #${evicted.throughCommit} may have lost their DOM changes to the capture budget.`);
    if (!commits.length) lines.push(pattern ? "No DOM change matched." : "No DOM changes recorded.");
    for (const view of commits) lines.push(...renderCommit(view));
    if (matched.length > commits.length) lines.push(`… ${matched.length - commits.length} more commits; narrow with fromCommit/toCommit or raise top.`);
    return {
      commits,
      commitsTotal: matched.length,
      ...evicted && { evicted },
      text: lines.join("\n")
    };
  }
  const UPSTREAM_COMMIT_STAT_KEYS = [
    "collateral",
    "sources",
    "restarts",
    "performedWork",
    "effects",
    "memos",
    "callbacks",
    "contextUpdates",
    "unmountedComponents",
    "unmountedSubtrees"
  ];
  function tupleToStats(tuple) {
    if (!Array.isArray(tuple)) return null;
    const out = {};
    for (let i = 0; i < UPSTREAM_COMMIT_STAT_KEYS.length; i++) {
      out[UPSTREAM_COMMIT_STAT_KEYS[i]] = Number(tuple[i] || 0);
    }
    return out;
  }
  function compactLatestAction(action) {
    if (!action || typeof action !== "object") return action ?? null;
    const location = action.location && typeof action.location === "object" ? action.location : {};
    const dom = location.dom && typeof location.dom === "object" ? location.dom : {};
    const targetFiber = location.targetFiber && typeof location.targetFiber === "object" ? location.targetFiber : null;
    const ownerStack = Array.isArray(targetFiber == null ? void 0 : targetFiber.ownerStack) ? targetFiber.ownerStack : [];
    return {
      lastCommitId: Number(action.lastCommitId ?? 0),
      deltaTime: Number(action.deltaTime ?? 0),
      action: typeof action.action === "string" ? action.action : null,
      dom: {
        tag: typeof dom.tag === "string" ? dom.tag : null,
        text: typeof dom.text === "string" ? dom.text : "",
        nearestTestId: typeof dom.nearestTestId === "string" ? dom.nearestTestId : null
      },
      targetFiber: targetFiber ? {
        name: typeof targetFiber.name === "string" ? targetFiber.name : null,
        key: targetFiber.key ?? null,
        ownerStackKind: targetFiber.ownerStackKind === "parents" ? "parents" : "owners",
        ownerNames: ownerStack.map((entry) => entry && typeof entry.name === "string" ? entry.name : null).filter(Boolean).slice(0, 10),
        ownerCount: ownerStack.length
      } : null
    };
  }
  const DEFAULT_PERF_TOP = 20;
  const MAX_LINKED_COMMITS = 10;
  const round$2 = (value) => Math.round(value * 10) / 10;
  function commitStarts(report) {
    return Object.entries(report.commitTimings ?? {}).map(([id, timing]) => ({ id: Number(id), start: Number(timing == null ? void 0 : timing.startTime) })).filter((c) => Number.isFinite(c.id) && Number.isFinite(c.start)).sort((a, b) => a.start - b.start);
  }
  function linkPerfEntries(report, entries = report.perfEntries ?? []) {
    const commits = commitStarts(report);
    return entries.map((entry) => {
      const from = entry.startTime;
      const to = entry.startTime + (entry.duration || 0);
      const during = [];
      let before = null;
      for (const c of commits) {
        if (c.start <= from) before = c;
        if (c.start >= from && c.start <= to) during.push(c.id);
        if (c.start > to) break;
      }
      return {
        ...entry,
        commits: {
          during: during.slice(0, MAX_LINKED_COMMITS),
          duringCount: during.length,
          before: before ? { commitId: before.id, gapMs: round$2(from - before.start) } : null
        }
      };
    });
  }
  function cumulativeLayoutShift(shifts) {
    let best = 0;
    let current = 0;
    let first = null;
    let last = null;
    for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
      if (s.hadRecentInput) continue;
      if (first !== null && last !== null && s.startTime - last < 1e3 && s.startTime - first < 5e3) current += s.value ?? 0;
      else {
        current = s.value ?? 0;
        first = s.startTime;
      }
      last = s.startTime;
      best = Math.max(best, current);
    }
    return Math.round(best * 1e4) / 1e4;
  }
  function perfSummary(report, entries = report.perfEntries ?? []) {
    const of = (type) => entries.filter((e) => e.entryType === type);
    const own = (e) => isOwnFrame(e, report.ownWork);
    const blockingOf = (e) => e.entryType === "longtask" ? Math.max(0, e.duration - 50) : e.blockingDuration ?? 0;
    const allLong = [...of("long-animation-frame"), ...of("long-animation-frame").length ? [] : of("longtask")];
    const chippyLong = allLong.filter(own);
    const frames = of("long-animation-frame").filter((e) => !own(e));
    const tasks = of("longtask").filter((e) => !own(e));
    const events = of("event");
    const measures = of("measure");
    const lcp = of("largest-contentful-paint").sort((a, b) => a.startTime - b.startTime).at(-1);
    const fcp = of("paint").find((e) => e.name === "first-contentful-paint");
    const navigation = of("navigation")[0];
    const worst = frames.reduce((best, e) => !best || (e.blockingDuration ?? 0) > (best.blockingDuration ?? 0) ? e : best, null);
    const worstLinked = worst ? linkPerfEntries(report, [worst])[0] : null;
    const perInteraction = /* @__PURE__ */ new Map();
    for (const e of events) {
      if (!e.interactionId) continue;
      perInteraction.set(e.interactionId, Math.max(perInteraction.get(e.interactionId) ?? 0, e.duration));
    }
    const longest = measures.reduce((best, e) => !best || e.duration > best.duration ? e : best, null);
    const blocking = of("long-animation-frame").length ? frames.reduce((sum, e) => sum + (e.blockingDuration ?? 0), 0) : tasks.reduce((sum, e) => sum + Math.max(0, e.duration - 50), 0);
    return {
      cls: cumulativeLayoutShift(of("layout-shift")),
      layoutShifts: of("layout-shift").length,
      longFrames: frames.length || tasks.length,
      totalBlockingMs: round$2(blocking),
      chippyFrames: { count: chippyLong.length, blockingMs: round$2(chippyLong.reduce((sum, e) => sum + blockingOf(e), 0)) },
      worstFrame: worstLinked ? {
        id: worstLinked.id,
        startTime: worstLinked.startTime,
        duration: worstLinked.duration,
        blockingDuration: worstLinked.blockingDuration ?? 0,
        commits: worstLinked.commits.during
      } : null,
      interactions: perInteraction.size,
      worstInteractionMs: perInteraction.size ? Math.max(...perInteraction.values()) : null,
      lcpMs: lcp ? lcp.startTime : null,
      fcpMs: fcp ? fcp.startTime : null,
      ttfbMs: (navigation == null ? void 0 : navigation.ttfb) ?? null,
      marks: of("mark").length,
      measures: measures.length,
      longestMeasure: longest ? { name: longest.name, startTime: longest.startTime, duration: longest.duration } : null
    };
  }
  const RANK = {
    "layout-shift": (e) => e.value ?? 0,
    "long-animation-frame": (e) => e.blockingDuration ?? 0,
    longtask: (e) => e.duration,
    event: (e) => e.duration,
    measure: (e) => e.duration
  };
  function commitStart(report, id) {
    var _a2, _b2;
    const n = Number(id);
    if (id === void 0 || id === null || id === "" || !Number.isFinite(n)) return null;
    const start = Number((_b2 = (_a2 = report.commitTimings) == null ? void 0 : _a2[String(n)]) == null ? void 0 : _b2.startTime);
    return Number.isFinite(start) ? start : null;
  }
  function perfView(report, options = {}) {
    var _a2, _b2;
    const status = ((_a2 = report.meta) == null ? void 0 : _a2.perf) ?? null;
    if (!Array.isArray(report.perfEntries)) {
      return {
        error: status && !status.enabled ? "performance entry capture is switched off for this detector" : "this report has no perfEntries: it was recorded before report version 9, or by a runtime without performance capture"
      };
    }
    const top = Number(options.top) > 0 ? Math.floor(Number(options.top)) : DEFAULT_PERF_TOP;
    const requested2 = Array.isArray(options.types) ? options.types.map(String) : typeof options.types === "string" && options.types ? options.types.split(",").map((t) => t.trim()).filter(Boolean) : null;
    let match = null;
    if (typeof options.match === "string" && options.match) {
      try {
        match = new RegExp(options.match, "i");
      } catch (error) {
        return { error: `invalid match pattern: ${error.message}` };
      }
    }
    const from = commitStart(report, options.fromCommit);
    const last = commitStart(report, options.toCommit);
    const next = last === null ? null : ((_b2 = commitStarts(report).find((c) => c.start > last)) == null ? void 0 : _b2.start) ?? Infinity;
    const selected = report.perfEntries.filter((e) => (!requested2 || requested2.includes(e.entryType)) && (!match || match.test(e.name)) && (from === null || e.startTime + (e.duration || 0) >= from) && (next === null || e.startTime < next));
    const byType = {};
    for (const type of new Set(selected.map((e) => e.entryType))) {
      const list = selected.filter((e) => e.entryType === type);
      const rank = RANK[type];
      const ordered = rank ? [...list].sort((a, b) => rank(b) - rank(a)) : [...list].sort((a, b) => b.startTime - a.startTime);
      byType[type] = { count: list.length, items: linkPerfEntries(report, ordered.slice(0, top)) };
    }
    return {
      payload: {
        status,
        summary: perfSummary(report, selected),
        entries: byType
      }
    };
  }
  function perfForCommit(report, commitId, maxItems = DEFAULT_PERF_TOP) {
    const near = linkPerfEntries(report).filter((e) => {
      var _a2;
      return e.commits.during.includes(commitId) || ((_a2 = e.commits.before) == null ? void 0 : _a2.commitId) === commitId;
    });
    near.sort((a, b) => b.duration - a.duration || a.startTime - b.startTime);
    return { total: near.length, items: near.slice(0, maxItems) };
  }
  function summarizeRebuiltProps(rendered, maxItems) {
    if (!Array.isArray(rendered)) return null;
    const groups = /* @__PURE__ */ new Map();
    let sameShallow = 0;
    let keysChanged = 0;
    let notCompared = 0;
    for (const entry of rendered) {
      const e = entry;
      if (!e || !Array.isArray(e.propChanges)) continue;
      for (const raw of e.propChanges) {
        const change = raw;
        if (!change || change.kind !== "ref-changed") continue;
        const prop = String(change.name);
        let row;
        if (change.sameShallow === true) {
          sameShallow++;
          row = { sameShallow: true };
        } else if (Array.isArray(change.changedKeys)) {
          keysChanged++;
          row = { changedKeys: change.changedKeys.map((k) => String(k == null ? void 0 : k.key)), changedKeyCount: Number(change.changedKeyCount) || change.changedKeys.length };
        } else if (typeof change.keysNotCompared === "number") {
          notCompared++;
          row = { keysNotCompared: change.keysNotCompared };
        } else {
          continue;
        }
        const key = `${prop}\0${String(change.current)}\0${JSON.stringify(row)}`;
        const group = groups.get(key);
        if (group) group.components++;
        else groups.set(key, { prop, component: e.name ?? null, sourceId: e.sourceId ?? null, components: 1, ...row });
      }
    }
    if (!groups.size) return null;
    const sorted = [...groups.values()].sort((a, b) => b.components - a.components || Number(!!b.sameShallow) - Number(!!a.sameShallow));
    return {
      sameShallow,
      keysChanged,
      notCompared,
      groups: sorted.slice(0, maxItems),
      omittedGroups: Math.max(0, sorted.length - maxItems)
    };
  }
  const SUMMARY_DEFAULT_TOP = 5;
  const SUMMARY_DEFAULT_MAX_ITEMS = 3;
  function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }
  function finite(value) {
    const n = Number(value);
    return value != null && Number.isFinite(n) ? n : null;
  }
  function ms(value) {
    return Math.round(value) || 0;
  }
  function at(map, id) {
    return (map == null ? void 0 : map[id]) ?? (map == null ? void 0 : map[String(id)]);
  }
  function sameContent(a, b) {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  function sourceRows(entries, maxItems) {
    return entries.slice(0, maxItems).map((entry) => {
      const e = entry && typeof entry === "object" ? entry : { sourceId: entry };
      return {
        sourceId: e.sourceId ?? null,
        collateralAtCommit: finite(e.collateral),
        changedHooks: (Array.isArray(e.trashers) ? e.trashers : []).map((t) => ({
          index: (t == null ? void 0 : t.index) ?? null,
          sameContent: sameContent(t == null ? void 0 : t.prevValue, t == null ? void 0 : t.currentValue)
        }))
      };
    });
  }
  function frameOf(frames, commitId, origin) {
    const frame2 = frames.find((f) => f.commits.during.includes(commitId));
    if (!frame2) return null;
    return {
      atMs: origin === null ? null : ms(frame2.startTime - origin),
      durationMs: ms(frame2.duration),
      blockingMs: ms(frame2.blockingDuration ?? 0),
      commits: frame2.commits.during
    };
  }
  function compactTimeline(report) {
    const timeline = buildTimeline(report);
    if ("error" in timeline) return { error: timeline.error };
    const { origin, window: window2, omitted, text } = timeline;
    return { origin, window: window2, omitted, text };
  }
  function nonZero(stats) {
    return stats ? Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== 0)) : null;
  }
  function tenths(value) {
    return value === null ? null : Math.round(value * 10) / 10;
  }
  function buildSummaryView(report, options = {}) {
    const top = positive(options.top, SUMMARY_DEFAULT_TOP);
    const maxItems = positive(options.maxItems, SUMMARY_DEFAULT_MAX_ITEMS);
    const commitStats = report.commitStats ?? {};
    const ids = Object.keys(commitStats).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const totals = Object.fromEntries(UPSTREAM_COMMIT_STAT_KEYS.map((key) => [key, 0]));
    const statsById = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const stats = tupleToStats(at(commitStats, id));
      statsById.set(id, stats);
      if (stats) for (const key of UPSTREAM_COMMIT_STAT_KEYS) totals[key] += stats[key];
    }
    const timeline = compactTimeline(report);
    const origin = "origin" in timeline ? finite(timeline.origin.at) : null;
    const frames = Array.isArray(report.perfEntries) ? linkPerfEntries(report, report.perfEntries.filter((e) => e.entryType === "long-animation-frame" || e.entryType === "longtask")) : [];
    const topCommits = ids.slice().sort((a, b) => {
      var _a2, _b2;
      return (((_a2 = statsById.get(b)) == null ? void 0 : _a2.collateral) ?? 0) - (((_b2 = statsById.get(a)) == null ? void 0 : _b2.collateral) ?? 0) || a - b;
    }).slice(0, top).map((commitId) => {
      var _a2;
      const timing = at(report.commitTimings, commitId);
      const start = finite(timing == null ? void 0 : timing.startTime);
      const end = finite(timing == null ? void 0 : timing.endTime);
      const paint = finite(timing == null ? void 0 : timing.paintAt);
      const entries = at(report.sourcesByCommit, commitId);
      const list = Array.isArray(entries) ? entries : [];
      const actions = at(report.interactionsByCommit, commitId);
      return {
        commitId,
        stat: nonZero(statsById.get(commitId)),
        atMs: start !== null && origin !== null ? ms(start - origin) : null,
        renderMs: tenths(finite((_a2 = timing == null ? void 0 : timing.render) == null ? void 0 : _a2.workMs)),
        ticks: finite(timing == null ? void 0 : timing.ticks),
        paintDelayMs: paint !== null && end !== null && paint >= end ? ms(paint - end) : null,
        sourcesTotal: list.length,
        sources: sourceRows(list, maxItems),
        rebuiltProps: summarizeRebuiltProps(at(report.renderedByCommit, commitId), maxItems),
        latestAction: Array.isArray(actions) && actions.length ? compactLatestAction(actions[actions.length - 1]) : null,
        hooks: hookStepsAt(report.hooks, commitId),
        longFrame: frameOf(frames, commitId, origin)
      };
    });
    return {
      commits: ids.length,
      firstCommitId: ids[0] ?? null,
      lastCommitId: ids.at(-1) ?? null,
      sources: Array.isArray(report.sources) ? report.sources.length : 0,
      totals,
      timeline,
      topCommits,
      hooks: summarizeHookResults(report.hooks),
      perf: Array.isArray(report.perfEntries) ? perfSummary(report) : null,
      meta: report.meta ?? null
    };
  }
  function compactNetwork(network, maxItems) {
    const rows = (items) => items.slice(0, maxItems);
    return {
      landedBefore: rows((network == null ? void 0 : network.landedBefore) ?? []),
      landedBeforeTotal: (network == null ? void 0 : network.landedBefore.length) ?? 0,
      startedAfter: rows((network == null ? void 0 : network.startedAfter) ?? []),
      startedAfterTotal: (network == null ? void 0 : network.startedAfter.length) ?? 0,
      startedDuringRender: rows((network == null ? void 0 : network.startedDuringRender) ?? []),
      startedDuringRenderTotal: (network == null ? void 0 : network.startedDuringRender.length) ?? 0,
      inFlight: (network == null ? void 0 : network.inFlight) ?? 0
    };
  }
  const REPORT_ALL_SOURCES = Number.POSITIVE_INFINITY;
  function getReport(api2) {
    if (!api2 || typeof api2.report !== "function") return null;
    try {
      const r = api2.report(REPORT_ALL_SOURCES);
      if (r && typeof r.toSerializable === "function") {
        return { raw: r, serial: r.toSerializable() };
      }
      return { raw: r, serial: r };
    } catch (e) {
      return { error: (e == null ? void 0 : e.message) || String(e) };
    }
  }
  function readAvalancheStatus(api2, mod) {
    if (!api2 || typeof api2.status !== "function") {
      return {
        ok: false,
        available: !!mod,
        error: "__AVALANCHE__ API not available",
        moduleKeys: mod ? Object.keys(mod) : null
      };
    }
    try {
      const status = api2.status();
      return { ok: true, available: true, status };
    } catch (e) {
      return { ok: false, available: true, error: (e == null ? void 0 : e.message) || String(e) };
    }
  }
  function evalAvalanche(command, api2, mod) {
    let slice;
    const report = () => slice === void 0 ? slice = getReport(api2) : slice;
    const result = runAvalanche(command, api2, mod, report);
    return slice ? withComponentNames(result, slice) : result;
  }
  function withComponentNames(result, slice) {
    if (!result.ok || "error" in slice || WHOLE_CAPTURE_ACTIONS.has(result.action)) return result;
    const meta = slice.serial.meta;
    const componentNames = componentNamesIn(result, meta == null ? void 0 : meta.componentNames);
    return componentNames.length > 0 ? { ...result, componentNames } : result;
  }
  function runAvalanche(command, api2, mod, report) {
    var _a2, _b2, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t;
    const action = String((command == null ? void 0 : command.action) || "status");
    if (!api2) {
      return { ok: false, available: false, action, error: "__AVALANCHE__ not available" };
    }
    try {
      switch (action) {
        case "install": {
          const opts = command && typeof command.options === "object" ? command.options : void 0;
          const res = (_a2 = api2.install) == null ? void 0 : _a2.call(api2, opts);
          return { ok: true, available: true, action, result: res, status: readAvalancheStatus(api2, mod).status };
        }
        case "uninstall":
          (_b2 = api2.uninstall) == null ? void 0 : _b2.call(api2);
          return { ok: true, available: true, action, status: readAvalancheStatus(api2, mod).status };
        case "reset":
        case "clear":
          (_c2 = api2.reset) == null ? void 0 : _c2.call(api2);
          return { ok: true, available: true, action, status: readAvalancheStatus(api2, mod).status };
        case "status":
          return { ok: true, available: true, action, status: readAvalancheStatus(api2, mod).status };
        case "export": {
          const r = report();
          if (!r) return { ok: false, available: true, action, error: "report() unavailable" };
          if ("error" in r) return { ok: false, available: true, action, error: r.error };
          return { ok: true, available: true, action, payload: r.serial };
        }
        case "export-last": {
          const count = Number(command == null ? void 0 : command.count);
          const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
          let res;
          try {
            res = (_d2 = api2.exportLast) == null ? void 0 : _d2.call(api2, n);
          } catch (e) {
            return { ok: false, available: true, action, error: (e == null ? void 0 : e.message) || String(e) };
          }
          if (res && typeof res.toSerializable === "function") {
            res = res.toSerializable();
          }
          return { ok: true, available: true, action, count: n, payload: res };
        }
        case "debug-hook": {
          const sourceId = String((command == null ? void 0 : command.sourceId) || "");
          const hookIndex = Number(command == null ? void 0 : command.hookIndex);
          const windowSize = Number(command == null ? void 0 : command.window);
          if (!sourceId || !Number.isFinite(hookIndex)) {
            return { ok: false, available: true, action, error: "debug-hook requires sourceId and numeric hookIndex" };
          }
          if (typeof api2.debugHook !== "function") {
            return { ok: false, available: true, action, error: "debugHook() unavailable on __AVALANCHE__ API" };
          }
          const payload = api2.debugHook(
            sourceId,
            Math.floor(hookIndex),
            Number.isFinite(windowSize) ? Math.max(0, Math.floor(windowSize)) : void 0
          );
          return { ok: true, available: true, action, payload };
        }
        case "hot-sources": {
          const limit = Number(command == null ? void 0 : command.limit);
          const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const sources = Array.isArray(r.serial.sources) ? r.serial.sources : [];
          const items = sources.slice().sort((a, b) => Number((b == null ? void 0 : b.collateralUpdates) || 0) - Number((a == null ? void 0 : a.collateralUpdates) || 0)).slice(0, n).map((s) => ({
            sourceId: (s == null ? void 0 : s.sourceId) ?? null,
            depth: Number((s == null ? void 0 : s.depth) || 0),
            causedUpdates: Number((s == null ? void 0 : s.causedUpdates) || 0),
            collateralUpdates: Number((s == null ? void 0 : s.collateralUpdates) || 0),
            maxCollateralUpdates: Number((s == null ? void 0 : s.maxCollateralUpdates) || 0),
            maxPenetrationDepth: Number((s == null ? void 0 : s.maxPenetrationDepth) || 0),
            restartWaste: Number((s == null ? void 0 : s.restartWaste) || 0)
          }));
          return { ok: true, available: true, action, total: sources.length, payload: { count: items.length, items } };
        }
        case "commit-peek": {
          const commitId = Number(command == null ? void 0 : command.commitId);
          if (!Number.isFinite(commitId)) {
            return { ok: false, available: true, action, error: "commit-peek requires numeric commitId" };
          }
          const include = Array.isArray(command == null ? void 0 : command.include) && command.include.length ? command.include : ["stats", "sources", "timing", "metrics", "hooks"];
          const allowedInclude = ["stats", "sources", "timing", "metrics", "hooks", "unmounts", "actions", "rendered", "network", "dom", "perf"];
          const invalidInclude = include.filter((key) => !allowedInclude.includes(key));
          if (invalidInclude.length) {
            return {
              ok: false,
              available: true,
              action,
              error: "unsupported commit-peek include value(s): " + invalidInclude.join(","),
              validInclude: allowedInclude
            };
          }
          const maxItems = Number.isFinite(Number(command == null ? void 0 : command.maxItems)) ? Math.max(1, Math.floor(Number(command.maxItems))) : 50;
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const ser = r.serial || {};
          const tuple = ((_e2 = ser.commitStats) == null ? void 0 : _e2[commitId]) || ((_f = ser.commitStats) == null ? void 0 : _f[String(commitId)]) || null;
          const sourceIds = ((_g = ser.sourcesByCommit) == null ? void 0 : _g[commitId]) || ((_h = ser.sourcesByCommit) == null ? void 0 : _h[String(commitId)]) || [];
          const timing = ((_i = ser.commitTimings) == null ? void 0 : _i[commitId]) || ((_j = ser.commitTimings) == null ? void 0 : _j[String(commitId)]) || null;
          const metricsMap = ser.metricsByCommit;
          const metrics = (metricsMap == null ? void 0 : metricsMap[commitId]) || (metricsMap == null ? void 0 : metricsMap[String(commitId)]) || null;
          const actions = ((_k = ser.interactionsByCommit) == null ? void 0 : _k[commitId]) || ((_l = ser.interactionsByCommit) == null ? void 0 : _l[String(commitId)]) || [];
          const rendered = ((_m = ser.renderedByCommit) == null ? void 0 : _m[commitId]) || ((_n = ser.renderedByCommit) == null ? void 0 : _n[String(commitId)]) || [];
          const hookSteps = hookStepsAt(ser.hooks, commitId);
          if (!tuple && !sourceIds.length && !timing && !metrics && !actions.length && !rendered.length && !Object.keys(hookSteps).length) {
            return { ok: true, available: true, action, commitId, found: false };
          }
          const sourcesById = /* @__PURE__ */ new Map();
          const allSources = ser.sources || [];
          for (const s of allSources) {
            if (s && s.sourceId != null) sourcesById.set(s.sourceId, s);
          }
          const out = { commitId, found: true };
          if (include.includes("stats")) out.stats = tupleToStats(tuple);
          if (include.includes("sources")) {
            const entries = Array.isArray(sourceIds) ? sourceIds : [];
            const slice = entries.slice(0, maxItems).map((entry) => {
              const e = entry;
              const sid = typeof e === "object" && e !== null && "sourceId" in e ? e.sourceId : entry;
              const s = sourcesById.get(sid);
              return s ? {
                sourceId: s.sourceId,
                depth: s.depth,
                collateralAtCommit: typeof e === "object" && e !== null && "collateral" in e ? e.collateral : null,
                rankAtCommit: typeof e === "object" && e !== null && "rank" in e ? e.rank : null,
                trashers: typeof e === "object" && e !== null && "trashers" in e ? e.trashers : void 0,
                causedUpdatesTotal: s.causedUpdates,
                collateralUpdatesTotal: s.collateralUpdates
              } : { sourceId: sid, missing: true };
            });
            out.sources = slice;
            out.sourcesTotal = entries.length;
          }
          if (include.includes("timing")) out.timing = timing;
          if (include.includes("metrics")) out.metrics = metrics;
          if (include.includes("hooks") && ser.hooks) out.hooks = hookSteps;
          if (include.includes("actions")) {
            out.actions = actions.slice(0, maxItems);
            out.actionsTotal = actions.length;
          }
          if (include.includes("rendered")) {
            out.rendered = rendered.slice(0, maxItems);
            out.renderedTotal = rendered.length;
            const evicted = (_p = (_o = ser.meta) == null ? void 0 : _o.renderedEvidence) == null ? void 0 : _p.evicted;
            if (!rendered.length && evicted && Number(evicted.throughCommit) >= commitId) out.renderedEvicted = true;
          }
          if (include.includes("dom")) {
            const dom = ((_q = ser.domByCommit) == null ? void 0 : _q[commitId]) || ((_r = ser.domByCommit) == null ? void 0 : _r[String(commitId)]) || null;
            out.dom = dom ? dom.changes.slice(0, maxItems) : [];
            out.domTotal = dom ? dom.changes.length : 0;
            if (dom == null ? void 0 : dom.truncated) out.domTruncated = true;
          }
          if (include.includes("network")) {
            out.network = compactNetwork(networkByCommit(ser, command == null ? void 0 : command.window).get(commitId), maxItems);
          }
          if (include.includes("perf")) {
            const perf = perfForCommit(ser, commitId, maxItems);
            out.perf = perf.items;
            out.perfTotal = perf.total;
          }
          if (include.includes("unmounts")) {
            const raw = r.raw || {};
            const samples = ((_s = raw.unmountsByCommit) == null ? void 0 : _s[commitId]) || ((_t = raw.unmountsByCommit) == null ? void 0 : _t[String(commitId)]) || null;
            out.unmounts = samples ? samples.slice(0, maxItems) : [];
            out.unmountsTotal = Array.isArray(samples) ? samples.length : 0;
          }
          return { ok: true, available: true, action, payload: out };
        }
        case "describe-action": {
          const actionId = Number(command == null ? void 0 : command.actionId);
          if (!Number.isFinite(actionId)) {
            return { ok: false, available: true, action, error: "describe-action requires numeric actionId" };
          }
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const ser = r.serial || {};
          const byCommit = ser.interactionsByCommit || {};
          for (const [commitId, items] of Object.entries(byCommit)) {
            const actions = Array.isArray(items) ? items : [];
            const found = actions.find((item) => Number(item == null ? void 0 : item.id) === actionId);
            if (found) {
              return {
                ok: true,
                available: true,
                action,
                payload: { actionId, commitId: Number(commitId), found: true, action: found }
              };
            }
          }
          return { ok: true, available: true, action, payload: { actionId, found: false } };
        }
        case "commit-list": {
          const top = Number.isFinite(Number(command == null ? void 0 : command.top)) ? Math.max(1, Math.floor(Number(command.top))) : 20;
          const by = String((command == null ? void 0 : command.by) || "collateral");
          const allowedKeys = UPSTREAM_COMMIT_STAT_KEYS.concat(["sources", "ticks", "network"]);
          if (!allowedKeys.includes(by)) {
            return {
              ok: false,
              available: true,
              action,
              error: "unsupported commit-list sort key: " + by,
              validBy: allowedKeys
            };
          }
          const sortKey = by;
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const ser = r.serial || {};
          const stats = ser.commitStats || {};
          const sourcesByCommit = ser.sourcesByCommit || {};
          const ids = Object.keys(stats);
          const network = networkByCommit(ser, command == null ? void 0 : command.window);
          const rows = ids.map((id) => {
            var _a3, _b3;
            const tuple = stats[id];
            const stat = tupleToStats(tuple);
            const srcs = sourcesByCommit[id];
            const sourceCount = Array.isArray(srcs) ? srcs.length : srcs && typeof srcs === "object" ? Object.keys(srcs).length : 0;
            const actions = ((_a3 = ser.interactionsByCommit) == null ? void 0 : _a3[id]) || [];
            const timing = (_b3 = ser.commitTimings) == null ? void 0 : _b3[id];
            const ticks = typeof (timing == null ? void 0 : timing.ticks) === "number" ? timing.ticks : null;
            const net = network.get(Number(id));
            return {
              commitId: Number(id),
              stat,
              sourceCount,
              ticks,
              network: {
                landedBefore: (net == null ? void 0 : net.landedBefore.length) ?? 0,
                startedAfter: (net == null ? void 0 : net.startedAfter.length) ?? 0,
                startedDuringRender: (net == null ? void 0 : net.startedDuringRender.length) ?? 0
              },
              latestAction: actions.length ? compactLatestAction(actions[actions.length - 1]) : null
            };
          });
          const sortValue = (row) => {
            var _a3;
            if (sortKey === "sources") return row.sourceCount || 0;
            if (sortKey === "ticks") return row.ticks ?? -1;
            if (sortKey === "network") return row.network.landedBefore;
            return ((_a3 = row.stat) == null ? void 0 : _a3[sortKey]) || 0;
          };
          rows.sort((a, b) => sortValue(b) - sortValue(a));
          return { ok: true, available: true, action, by: sortKey, total: rows.length, rows: rows.slice(0, top) };
        }
        case "network": {
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const view = networkView(r.serial, {
            top: command == null ? void 0 : command.top,
            by: command == null ? void 0 : command.by,
            match: command == null ? void 0 : command.match,
            initiators: command == null ? void 0 : command.initiators,
            window: command == null ? void 0 : command.window
          });
          if ("error" in view) return { ok: false, available: true, action, error: view.error, ...view.validBy && { validBy: [...view.validBy] } };
          return { ok: true, available: true, action, payload: view.payload };
        }
        case "perf": {
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const view = perfView(r.serial, {
            types: command == null ? void 0 : command.types,
            top: command == null ? void 0 : command.top,
            match: command == null ? void 0 : command.match,
            fromCommit: command == null ? void 0 : command.fromCommit,
            toCommit: command == null ? void 0 : command.toCommit
          });
          if ("error" in view) return { ok: false, available: true, action, error: view.error };
          return { ok: true, available: true, action, payload: view.payload };
        }
        case "timeline": {
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const timeline = buildTimeline(r.serial, {
            fromCommit: command == null ? void 0 : command.fromCommit,
            toCommit: command == null ? void 0 : command.toCommit,
            minRequestMs: command == null ? void 0 : command.minRequestMs,
            maxRequests: command == null ? void 0 : command.top,
            exclude: command == null ? void 0 : command.exclude,
            settleMap: (command == null ? void 0 : command.format) === "full" || (command == null ? void 0 : command.format) === "map"
          });
          if ("error" in timeline) return { ok: false, available: true, action, error: timeline.error };
          const { ok: _ok, lanes, ...rest } = timeline;
          return { ok: true, available: true, action, payload: (command == null ? void 0 : command.format) === "full" ? { ...rest, lanes } : rest };
        }
        case "dom-diff": {
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const view = buildDomDiffView(r.serial, {
            fromCommit: command == null ? void 0 : command.fromCommit,
            toCommit: command == null ? void 0 : command.toCommit,
            match: command == null ? void 0 : command.match,
            top: command == null ? void 0 : command.top,
            maxItems: command == null ? void 0 : command.maxItems
          });
          if ("error" in view) return { ok: false, available: true, action, error: view.error };
          return { ok: true, available: true, action, payload: view };
        }
        case "summary": {
          const r = report();
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          return { ok: true, available: true, action, payload: buildSummaryView(r.serial, { top: command == null ? void 0 : command.top, maxItems: command == null ? void 0 : command.maxItems }) };
        }
        // Removed: start, stop, metrics, help — not present on the current public surface.
        default:
          return { ok: false, available: true, action, error: "Unknown avalanche action: " + action };
      }
    } catch (error) {
      return { ok: false, available: true, action, error: (error == null ? void 0 : error.message) || String(error) };
    }
  }
  const AVALANCHE_NAME_BUDGET_MS = 3e3;
  const AVALANCHE_EXPORT_NAME_BUDGET_MS = 2e4;
  function nameBudgetFor(command) {
    const action = String((command == null ? void 0 : command.action) || "status");
    const timeoutMs = Number(command == null ? void 0 : command.timeoutMs);
    if (!WHOLE_CAPTURE_ACTIONS.has(action) || !Number.isFinite(timeoutMs)) return AVALANCHE_NAME_BUDGET_MS;
    return Math.min(AVALANCHE_EXPORT_NAME_BUDGET_MS, Math.max(AVALANCHE_NAME_BUDGET_MS, timeoutMs / 2));
  }
  const NAME_FREE_ACTIONS = /* @__PURE__ */ new Set(["install", "uninstall", "reset", "clear", "status", "debug-hook", "network"]);
  const SOURCE_ID = /^[^\s#@]+#\d+@-?\d+$/;
  const WHOLE_CAPTURE_ACTIONS = /* @__PURE__ */ new Set(["export", "export-last"]);
  const MAX_SOURCE_IDS = 2e3;
  function sourceIdsIn(value, limit = MAX_SOURCE_IDS) {
    const found = /* @__PURE__ */ new Set();
    const seen = /* @__PURE__ */ new Set();
    const visit = (node, depth) => {
      if (found.size >= limit) return;
      if (typeof node === "string") {
        if (SOURCE_ID.test(node)) found.add(node);
        return;
      }
      if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      for (const [key, item] of Object.entries(node)) {
        if (SOURCE_ID.test(key)) found.add(key);
        visit(item, depth + 1);
      }
    };
    visit(value, 0);
    return Array.from(found);
  }
  async function evalAvalancheWithNames(command, api2, mod, budgetMs = nameBudgetFor(command)) {
    const first = evalAvalanche(command, api2, mod);
    const action = String((command == null ? void 0 : command.action) || "status");
    if (!first.ok || NAME_FREE_ACTIONS.has(action) || typeof (api2 == null ? void 0 : api2.componentTypesFor) !== "function") return first;
    const ids = sourceIdsIn(first);
    const wholeCapture = WHOLE_CAPTURE_ACTIONS.has(action);
    const named = typeof api2.componentTypesNamed === "function" ? api2.componentTypesNamed.bind(api2) : null;
    let types;
    try {
      types = ids.length > 0 ? api2.componentTypesFor(ids) : [];
      if (wholeCapture && typeof api2.unnamedRenderedTypes === "function") types = types.concat(api2.unnamedRenderedTypes());
      if (named) types = types.concat(wholeCapture ? named() : named(nameTokensIn(first)));
    } catch {
      return first;
    }
    if (types.length === 0) return first;
    const stats = await warmComponentTypes(types, budgetMs);
    if (!stats) return first;
    const again = stats.named > 0 ? evalAvalanche(command, api2, mod) : first;
    return { ...again, nameRecovery: stats };
  }
  const GREP_SCOPES = ["props", "state", "debug"];
  const DEFAULT_GREP_SCOPES = ["props", "state"];
  const DEFAULT_GREP_LIMITS = { depth: 4, maxHits: 10, maxNodes: 2e3, maxEntries: 50 };
  function parseGrepScopes(raw) {
    if (raw == null || raw === "") return { scopes: [...DEFAULT_GREP_SCOPES] };
    const parts = (Array.isArray(raw) ? raw : String(raw).split(",")).map((part) => String(part).trim().toLowerCase()).filter(Boolean);
    const scopes = [];
    for (const part of parts) {
      const scope = part === "all" ? null : part === "hooks" ? "state" : part;
      if (scope === null) return { scopes: [...GREP_SCOPES] };
      if (!GREP_SCOPES.includes(scope)) {
        return { scopes: [], error: 'Unknown grep scope "' + part + '". Use props, state, debug, or all.' };
      }
      if (!scopes.includes(scope)) scopes.push(scope);
    }
    return { scopes: scopes.length ? scopes : [...DEFAULT_GREP_SCOPES] };
  }
  function preview(value) {
    if (typeof value === "string") return value.length > 120 ? value.slice(0, 120) + "…" : value;
    if (typeof value === "function") return "[function" + (value.name ? ":" + value.name : "") + "]";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return value.toString() + "n";
    if (Array.isArray(value)) return "[array:" + value.length + "]";
    if (value && typeof value === "object") return "[object]";
    return String(value);
  }
  function matchText(value) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return value.displayName || value.name || null;
    return null;
  }
  function isOpaque(value) {
    const v = value;
    if ("$$typeof" in v) return true;
    if (typeof v.nodeType === "number" && typeof v.nodeName === "string") return true;
    if (v.window === v) return true;
    if ("stateNode" in v && "return" in v && "child" in v) return true;
    return false;
  }
  function joinPath(base, key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? base + "." + key : base + "[" + JSON.stringify(key) + "]";
  }
  function grepValue(root, re, scope, rootPath, limits, hits, skipRootKeys = /* @__PURE__ */ new Set()) {
    const seen = /* @__PURE__ */ new Set();
    let nodes = 0;
    function record(hit) {
      hits.push(hit);
      return hits.length < limits.maxHits;
    }
    function visit(value, path, depth) {
      if (hits.length >= limits.maxHits || nodes >= limits.maxNodes) return false;
      nodes += 1;
      const text = matchText(value);
      if (text !== null) {
        re.lastIndex = 0;
        if (re.test(text)) return record({ scope, path, match: "value", value: preview(value) });
        return true;
      }
      if (!value || typeof value !== "object") return true;
      if (seen.has(value) || isOpaque(value) || depth >= limits.depth) return true;
      seen.add(value);
      const entries = [];
      if (Array.isArray(value)) {
        value.slice(0, limits.maxEntries).forEach((item, i) => entries.push(["[" + i + "]", item]));
      } else if (value instanceof Map) {
        let i = 0;
        for (const [k, v] of value) {
          if (i++ >= limits.maxEntries) break;
          entries.push([typeof k === "string" ? k : "<" + preview(k) + ">", v]);
        }
      } else if (value instanceof Set) {
        let i = 0;
        for (const v of value) {
          if (i >= limits.maxEntries) break;
          entries.push(["[" + i++ + "]", v]);
        }
      } else {
        let keys;
        try {
          keys = Object.keys(value);
        } catch {
          return true;
        }
        for (const k of keys.slice(0, limits.maxEntries)) {
          if (depth === 0 && skipRootKeys.has(k)) continue;
          let child;
          try {
            child = value[k];
          } catch {
            continue;
          }
          entries.push([k, child]);
        }
      }
      for (const [key, child] of entries) {
        const childPath = key.startsWith("[") ? path + key : joinPath(path, key);
        if (!key.startsWith("[")) {
          re.lastIndex = 0;
          if (re.test(key) && !record({ scope, path: childPath, match: "key", value: preview(child) })) return false;
        }
        if (!visit(child, childPath, depth + 1)) return false;
      }
      return true;
    }
    visit(root, rootPath, 0);
  }
  const CLASS_COMPONENT_TAG = 1;
  const HOST_TAGS$1 = /* @__PURE__ */ new Set([5, 6, 26, 27]);
  function hookSlots(fiber) {
    const out = [];
    if (fiber.tag === CLASS_COMPONENT_TAG || HOST_TAGS$1.has(fiber.tag)) return out;
    const seen = /* @__PURE__ */ new Set();
    let node = fiber.memoizedState;
    let index = 0;
    while (node && typeof node === "object" && !seen.has(node) && "next" in node) {
      seen.add(node);
      const tag = classifyHook(node, index).tag;
      const ms2 = node.memoizedState;
      const label = "hook[" + index + ":" + tag + "]";
      if (tag === "Effect") {
        const deps = ms2 == null ? void 0 : ms2.deps;
        if (Array.isArray(deps)) out.push([label + ".deps", deps]);
      } else if (tag === "Ref") {
        out.push([label + ".current", ms2.current]);
      } else if (tag === "Memo") {
        out.push([label, ms2[0]]);
      } else {
        out.push([label, ms2]);
      }
      node = node.next;
      index += 1;
    }
    return out;
  }
  function callsUseDebugValue(fiber) {
    const types = fiber._debugHookTypes;
    return Array.isArray(types) && types.includes("useDebugValue");
  }
  function grepFiber(fiber, re, scopes, limits, replay) {
    const hits = [];
    let replayInfo;
    if (scopes.includes("props")) {
      const props = fiber.memoizedProps;
      if (typeof props === "string") grepValue(props, re, "props", "text", limits, hits);
      else grepValue(props, re, "props", "props", limits, hits);
    }
    if (scopes.includes("state") && hits.length < limits.maxHits) {
      if (fiber.tag === CLASS_COMPONENT_TAG) {
        grepValue(fiber.memoizedState, re, "state", "state", limits, hits);
      } else {
        for (const [label, value] of hookSlots(fiber)) {
          if (hits.length >= limits.maxHits) break;
          grepValue(value, re, "state", label, limits, hits);
        }
      }
    }
    if (scopes.includes("debug") && replay && hits.length < limits.maxHits && callsUseDebugValue(fiber)) {
      let result = null;
      try {
        result = replay(fiber);
      } catch (e) {
        replayInfo = { status: "failed", error: (e == null ? void 0 : e.message) || String(e) };
      }
      if (result) {
        replayInfo = { status: result.replayStatus || "unknown", ...result.replayError ? { error: result.replayError } : {} };
        for (const rec of result.records) {
          if (rec.debugLabel === void 0 || hits.length >= limits.maxHits) continue;
          const hookPath = (rec.path || []).map((frame2) => frame2.name);
          const before = hits.length;
          const label = "debug" + (hookPath.length ? "(" + hookPath.join(">") + ")" : "");
          grepValue(rec.debugLabel, re, "debug", label, limits, hits);
          for (let i = before; i < hits.length; i++) hits[i].hookPath = hookPath;
        }
      }
    }
    return { hits, ...replayInfo ? { replay: replayInfo } : {} };
  }
  function evalElementDom(element, parentLevel, getComputedStyle2) {
    let el = element || null;
    if (!el || el.nodeType !== 1) return { error: "Target element is not available" };
    const level = Number(parentLevel) || 0;
    for (let i = 0; i < level; i++) {
      if (!el.parentElement) return { error: "parentLevel " + level + " exceeds DOM depth (stopped at " + i + ")" };
      el = el.parentElement;
    }
    const tag = el.tagName.toLowerCase();
    const innerText = (el.innerText || "").slice(0, 300);
    const innerHTML = el.innerHTML.slice(0, 500);
    const attrs = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "class") continue;
      attrs[attr.name] = attr.value.slice(0, 120);
    }
    const cs = getComputedStyle2(el);
    const styles = {
      display: cs.display,
      visibility: cs.visibility,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      backgroundColor: cs.backgroundColor,
      cursor: cs.cursor
    };
    const parents = [];
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++) {
      parents.push({
        tag: p.tagName.toLowerCase(),
        testId: p.getAttribute("data-testid") || null,
        id: p.id || null
      });
      p = p.parentElement;
    }
    return { tag, innerText, innerHTML, attrs, styles, parents };
  }
  function evalFiberProps(baseFiber, ownerIndex, getHookSummary2, resolveOwnerFiber2) {
    const targetFiber = ownerIndex == null ? baseFiber : resolveOwnerFiber2(baseFiber, ownerIndex);
    if (!targetFiber) return { error: "Target fiber not available for ownerIndex " + ownerIndex };
    const props = targetFiber.memoizedProps || {};
    const name = readComponentName(targetFiber.type) || "Unknown";
    const hookSummary = getHookSummary2 ? getHookSummary2(targetFiber) : { hookCount: null, hookCountTruncated: false, hookCountMax: null };
    const pod = {};
    const nonPod = [];
    let refCounter = 0;
    const { ownerStackKind, fibers: ownerFibersChain } = collectOwnerFibers(
      targetFiber,
      (candidate, kind) => kind === "owners" || isComponentFiber(candidate)
    );
    for (const [k, v] of Object.entries(props)) {
      if (k === "children") continue;
      if (v === null || v === void 0) {
        pod[k] = v;
        continue;
      }
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        pod[k] = v;
        continue;
      }
      refCounter++;
      const ref = "REF" + refCounter;
      const type = Array.isArray(v) ? "array" : typeof v;
      let terminatesAt = null;
      for (let i = 0; i < ownerFibersChain.length; i++) {
        const ownerProps = ownerFibersChain[i].memoizedProps || {};
        const hasRef = Object.values(ownerProps).some((pv) => pv === v);
        if (!hasRef) {
          const prevType = i > 0 ? ownerFibersChain[i - 1].type : null;
          terminatesAt = i === 0 ? { ownerIndex: -1, name: name + " (probe component)" } : { ownerIndex: i - 1, name: readComponentName(prevType) || "Unknown" };
          break;
        }
        if (i === ownerFibersChain.length - 1) {
          terminatesAt = { ownerIndex: i, name: readComponentName(ownerFibersChain[i].type) || "Unknown", note: "last known owner" };
        }
      }
      if (!terminatesAt) {
        terminatesAt = { ownerIndex: -1, name: name + " (no owner chain or not traced)" };
      }
      nonPod.push({ prop: k, type, ref, terminatesAt });
    }
    const children = props.children;
    let childrenSummary = null;
    if (children !== void 0) {
      if (children === null) childrenSummary = null;
      else if (typeof children === "string") childrenSummary = { type: "string", value: children.slice(0, 60) };
      else if (typeof children === "number" || typeof children === "boolean") childrenSummary = { type: typeof children, value: children };
      else if (Array.isArray(children)) childrenSummary = { type: "array", length: children.length };
      else if (typeof children === "object") childrenSummary = { type: "element" };
      else childrenSummary = { type: typeof children };
    }
    return { name, ownerIndex: ownerIndex ?? null, ownerStackKind, ...hookSummary, pod, nonPod, children: childrenSummary };
  }
  function evalFiberPropValue(baseFiber, propName, ownerIndex, getHookSummary2, resolveOwnerFiber2, safeSerialize2) {
    if (!propName) return { error: "prop name required" };
    const targetFiber = ownerIndex == null ? baseFiber : resolveOwnerFiber2(baseFiber, ownerIndex);
    if (!targetFiber) return { error: "Target fiber not available for ownerIndex " + ownerIndex };
    const props = targetFiber.memoizedProps || {};
    const name = readComponentName(targetFiber.type) || "Unknown";
    const hookSummary = getHookSummary2 ? getHookSummary2(targetFiber) : { hookCount: null, hookCountTruncated: false, hookCountMax: null };
    if (!(propName in props)) return { error: 'Prop "' + propName + '" not found on ' + name + ". Available: " + Object.keys(props).join(", ") };
    const value = props[propName];
    const seen = /* @__PURE__ */ new Set();
    function serializeProp(v) {
      if (v === null || v === void 0) return v;
      if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
      if (typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v === "function") return "[function" + (v.name ? ":" + v.name : "") + "]";
      if (typeof v === "symbol") return "[symbol:" + v.toString() + "]";
      if (Array.isArray(v)) {
        if (v.length === 0) return [];
        return v.slice(0, 5).map((item) => safeSerialize2(item, 0, /* @__PURE__ */ new Set())).concat(v.length > 5 ? ["[…" + (v.length - 5) + " more]"] : []);
      }
      if (typeof v === "object") {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
        const obj = v;
        const keys = Object.keys(obj);
        const result = {};
        for (const k of keys.slice(0, 12)) {
          try {
            result[k] = safeSerialize2(obj[k], 0, /* @__PURE__ */ new Set());
          } catch {
            result[k] = "[error]";
          }
        }
        if (keys.length > 12) result["…"] = "[" + (keys.length - 12) + " more keys]";
        return result;
      }
      return String(v);
    }
    return {
      name,
      ownerIndex: ownerIndex ?? null,
      ...hookSummary,
      prop: propName,
      type: Array.isArray(value) ? "array" : typeof value,
      value: serializeProp(value)
    };
  }
  function filterRegex(pattern, flag) {
    if (!pattern) return null;
    try {
      return new RegExp(String(pattern), "i");
    } catch (e) {
      throw new Error("Invalid --" + flag + " regex: " + ((e == null ? void 0 : e.message) || String(e)));
    }
  }
  function evalFindFibers(filters, helpers, rememberFiber, deps = {}) {
    let nameRe, fileRe, testIdRe, textRe;
    try {
      nameRe = filterRegex(filters == null ? void 0 : filters.name, "name");
      fileRe = filterRegex(filters == null ? void 0 : filters.file, "file");
      testIdRe = filterRegex(filters == null ? void 0 : filters.testid, "testid");
      textRe = filterRegex(filters == null ? void 0 : filters.text, "text");
    } catch (e) {
      return { ok: false, count: 0, items: [], error: e.message };
    }
    const propName = (filters == null ? void 0 : filters.prop) ? String(filters.prop) : null;
    const max = Number.isFinite(Number(filters == null ? void 0 : filters.max)) ? Math.max(1, Math.floor(Number(filters == null ? void 0 : filters.max))) : 50;
    const matches2 = [];
    let grepRe;
    try {
      grepRe = filterRegex(filters == null ? void 0 : filters.grep, "grep");
    } catch (e) {
      return { ok: false, count: 0, items: [], error: e.message };
    }
    const { scopes, error: scopeError } = parseGrepScopes(filters == null ? void 0 : filters.in);
    if (grepRe && scopeError) return { ok: false, count: 0, items: [], error: scopeError };
    const depth = Number(filters == null ? void 0 : filters.depth);
    const limits = {
      ...DEFAULT_GREP_LIMITS,
      ...Number.isFinite(depth) && depth > 0 ? { depth: Math.min(12, Math.floor(depth)) } : {}
    };
    const wantsDebug = scopes.includes("debug");
    const replay = deps.replay || replayComponentHooks;
    const maxReplays = deps.maxReplays ?? 300;
    const grepStats = { scanned: 0, debugCandidates: 0, replayed: 0, replayFailed: 0, replaySkipped: 0 };
    let truncated = false;
    helpers.walkAll((fiber) => {
      var _a2;
      if (matches2.length >= max) {
        truncated = true;
        return;
      }
      const info = helpers.fiberInfo(fiber);
      let possibleNames = null;
      if (nameRe && !((info == null ? void 0 : info.name) && nameRe.test(info.name))) {
        possibleNames = possibleComponentNames(fiber == null ? void 0 : fiber.type).filter((name) => nameRe.test(name));
        if (possibleNames.length === 0) return;
      } else if (!(info == null ? void 0 : info.name) && !needsComponentOrigin(fiber)) {
        return;
      }
      if (fileRe && !fileRe.test(((_a2 = info.source) == null ? void 0 : _a2.fileName) || "")) return;
      if (testIdRe && !testIdRe.test(info.domTestId || "")) return;
      if (textRe && !textRe.test(info.domText || "")) return;
      if (propName) {
        const props = fiber == null ? void 0 : fiber.memoizedProps;
        if (!props || typeof props !== "object" || !(propName in props)) return;
      }
      let hits = null;
      let replayInfo;
      if (grepRe) {
        grepStats.scanned += 1;
        const debugCandidate = callsUseDebugValue(fiber);
        if (debugCandidate) grepStats.debugCandidates += 1;
        const canReplay = wantsDebug && debugCandidate && grepStats.replayed < maxReplays;
        if (wantsDebug && debugCandidate && !canReplay) grepStats.replaySkipped += 1;
        const result = grepFiber(fiber, grepRe, scopes, limits, canReplay ? replay : null);
        if (result.replay) {
          grepStats.replayed += 1;
          if (result.replay.status !== "complete") grepStats.replayFailed += 1;
          replayInfo = result.replay;
        }
        if (!result.hits.length) return;
        hits = result.hits;
      }
      const fiberId = rememberFiber(fiber);
      matches2.push({
        fiberId,
        ...info,
        ...possibleNames ? { match: "possible", possibleNames } : {},
        ...hits ? { hits, hitsTruncated: hits.length >= limits.maxHits } : {},
        ...replayInfo && replayInfo.status !== "complete" ? { replay: replayInfo } : {}
      });
    }, { limit: 2e5 });
    const possible = matches2.filter((item) => item.match === "possible").length;
    const possibleMatches = possible ? { possibleMatches: possible } : {};
    if (!grepRe) return { count: matches2.length, items: matches2, ...possibleMatches };
    return {
      count: matches2.length,
      items: matches2,
      ...possibleMatches,
      truncated,
      grep: {
        pattern: String(filters == null ? void 0 : filters.grep),
        scopes,
        depth: limits.depth,
        ...grepStats,
        ...!wantsDebug && grepStats.debugCandidates ? { note: grepStats.debugCandidates + " scanned fibers call useDebugValue; add debug to --in to search their labels (replays those components)." } : {}
      }
    };
  }
  async function resolveFindFiberSources(items, getFiber2, resolve2) {
    await Promise.all(items.map(async (item) => {
      const fiber = item.fiberId == null ? null : getFiber2(String(item.fiberId));
      if (!fiber) return;
      try {
        const source = await resolve2(fiber);
        if (source) item.source = source;
      } catch {
      }
      applyRecoveredOrigin(item, fiber.type);
      applyProductionBreadcrumbs(item, fiber);
    }));
  }
  const NAME_RECOVERY_BUDGET_MS = 3e3;
  function preNameFilter(filters, fiberInfo) {
    const fileRe = filterRegex(filters == null ? void 0 : filters.file, "file");
    const testIdRe = filterRegex(filters == null ? void 0 : filters.testid, "testid");
    const textRe = filterRegex(filters == null ? void 0 : filters.text, "text");
    const propName = (filters == null ? void 0 : filters.prop) ? String(filters.prop) : null;
    const needsInfo = Boolean(fileRe || testIdRe || textRe);
    return (fiber) => {
      var _a2;
      if (propName) {
        const props = fiber == null ? void 0 : fiber.memoizedProps;
        if (!props || typeof props !== "object" || !(propName in props)) return false;
      }
      if (!needsInfo || !fiberInfo) return true;
      const info = fiberInfo(fiber);
      if (fileRe && !fileRe.test(((_a2 = info == null ? void 0 : info.source) == null ? void 0 : _a2.fileName) || "")) return false;
      if (testIdRe && !testIdRe.test((info == null ? void 0 : info.domTestId) || "")) return false;
      if (textRe && !textRe.test((info == null ? void 0 : info.domText) || "")) return false;
      return true;
    };
  }
  function warmFindFiberNames(filters, helpers, budgetMs = NAME_RECOVERY_BUDGET_MS) {
    if (!(filters == null ? void 0 : filters.name)) return Promise.resolve(null);
    let passes;
    try {
      passes = preNameFilter(filters, helpers.fiberInfo);
    } catch {
      return Promise.resolve(null);
    }
    return warmComponentNames(
      (visit) => helpers.walkAll((fiber) => {
        if (passes(fiber)) visit(fiber);
      }, { limit: 2e5 }),
      budgetMs
    );
  }
  const SCRIPT_RESULT_DEPTH = 16;
  const SCRIPT_RESULT_MAX_NODES = 5e4;
  const MAX_ITEMS = 500;
  function scriptResultJson(value, options = {}) {
    const budget = { left: options.maxNodes ?? SCRIPT_RESULT_MAX_NODES, exhausted: false };
    const seen = /* @__PURE__ */ new WeakSet();
    function walk2(input, depth) {
      if (input == null) return input;
      const t = typeof input;
      if (t === "string" || t === "boolean") return input;
      if (t === "number") return Number.isFinite(input) ? input : String(input);
      if (t === "function") return "[Function " + (input.name || "anonymous") + "]";
      if (t !== "object") return String(input);
      if (depth <= 0) return Array.isArray(input) ? "[Array]" : "[Object]";
      if (budget.left <= 0) {
        budget.exhausted = true;
        return "[Truncated]";
      }
      budget.left--;
      const obj = input;
      if (seen.has(obj)) return "[Circular]";
      seen.add(obj);
      try {
        if (typeof obj.toJSON === "function" && !(obj instanceof Date)) {
          return walk2(obj.toJSON(), depth);
        }
        if (obj instanceof Date) return obj.toISOString();
        if (typeof Node !== "undefined" && obj instanceof Node) return "[" + (obj.nodeName || "Node") + "]";
        if (Array.isArray(obj)) {
          const out2 = obj.slice(0, MAX_ITEMS).map((v) => walk2(v, depth - 1));
          if (obj.length > MAX_ITEMS) out2.push("[+" + (obj.length - MAX_ITEMS) + " more]");
          return out2;
        }
        if (obj instanceof Map) return walk2(Object.fromEntries(Array.from(obj.entries()).slice(0, MAX_ITEMS).map(([k, v]) => [String(k), v])), depth);
        if (obj instanceof Set) return walk2(Array.from(obj), depth);
        const out = {};
        let n = 0;
        for (const k of Object.keys(obj)) {
          if (n++ >= MAX_ITEMS) {
            out._truncated = true;
            break;
          }
          try {
            out[k] = walk2(obj[k], depth - 1);
          } catch (_) {
            out[k] = "[Unserializable]";
          }
        }
        return out;
      } finally {
        seen.delete(obj);
      }
    }
    const result = walk2(value, options.depth ?? SCRIPT_RESULT_DEPTH);
    if (budget.exhausted && result && typeof result === "object" && !Array.isArray(result)) {
      result._truncated = true;
    }
    return result;
  }
  const TAG = {
    hostRoot: 3,
    hostPortal: 4,
    hostComponent: 5,
    hostText: 6,
    suspense: 13,
    offscreen: 22,
    legacyHidden: 23,
    hostHoistable: 26,
    hostSingleton: 27
  };
  const COMPOSITE_TAGS$1 = /* @__PURE__ */ new Set([0, 1, 2, 11, 14, 15]);
  const HOST_TAGS = /* @__PURE__ */ new Set([TAG.hostComponent, TAG.hostHoistable, TAG.hostSingleton]);
  const HIDDEN_TAGS = /* @__PURE__ */ new Set([TAG.offscreen, TAG.legacyHidden]);
  const MAX_CLIMB = 2e3;
  function fiberTag$1(fiber) {
    return typeof (fiber == null ? void 0 : fiber.tag) === "number" ? fiber.tag : -1;
  }
  function isHostFiber(fiber) {
    return HOST_TAGS.has(fiberTag$1(fiber));
  }
  function classifyFiber(fiber) {
    const tag = fiberTag$1(fiber);
    if (tag === TAG.suspense || describeSuspenseBoundary(fiber)) return "suspense";
    if (COMPOSITE_TAGS$1.has(tag) || tag === -1) {
      if (isErrorBoundary(fiber, tag)) return "error";
      if (tag !== -1) return "component";
    }
    if (HOST_TAGS.has(tag)) return "host";
    if (tag === TAG.hostText) return "text";
    if (tag === TAG.hostPortal) return "portal";
    return "other";
  }
  function isErrorBoundary(fiber, tag) {
    const info = describeErrorBoundary(fiber);
    return !!info && (info.detectedBy === "lifecycle" || tag === -1);
  }
  function fiberName$1(fiber) {
    const tag = fiberTag$1(fiber);
    if (HOST_TAGS.has(tag)) return typeof fiber.type === "string" ? fiber.type : null;
    if (tag === TAG.suspense) return readComponentName(fiber.type) || "Suspense";
    return readComponentName(fiber.type) || readComponentName(fiber.elementType);
  }
  function currentOf(fiber) {
    const alternate = fiber.alternate;
    if (!alternate) return fiber;
    let node = fiber;
    let steps = 0;
    while (node && node.return && steps++ < MAX_CLIMB) node = node.return;
    if (node && fiberTag$1(node) === TAG.hostRoot) {
      const root = node.stateNode;
      if (root && root.current) return root.current === node ? fiber : alternate;
    }
    return fiber;
  }
  const rememberedIds = /* @__PURE__ */ new WeakMap();
  const refFibers = /* @__PURE__ */ new WeakMap();
  function createRefRegistry(deps) {
    const refs = /* @__PURE__ */ new WeakMap();
    function rememberedId(fiber) {
      const known = rememberedIds.get(fiber) || (fiber.alternate ? rememberedIds.get(fiber.alternate) : void 0);
      if (known) return known;
      const id = String(deps.rememberFiber(fiber));
      rememberedIds.set(fiber, id);
      if (fiber.alternate) rememberedIds.set(fiber.alternate, id);
      return id;
    }
    function live(ref2) {
      const fiber = refFibers.get(ref2);
      if (!fiber) throw new TypeError("expected a FiberRef from chippy, got " + describeValue(ref2));
      return currentOf(fiber);
    }
    function ref(fiber) {
      const existing = refs.get(fiber) || (fiber.alternate ? refs.get(fiber.alternate) : void 0);
      if (existing) return existing;
      let kind = null;
      const made = {
        get id() {
          return rememberedId(live(made));
        },
        get name() {
          return fiberName$1(live(made));
        },
        get kind() {
          return kind || (kind = classifyFiber(live(made)));
        },
        get label() {
          return labelFiber(live(made), made.kind);
        },
        get tag() {
          return fiberTag$1(live(made));
        },
        get key() {
          const k = live(made).key;
          return k == null ? null : String(k);
        },
        get source() {
          return describeFiberSource(live(made));
        },
        get status() {
          const k = made.kind;
          if (k === "suspense") return live(made).memoizedState == null ? "showing-content" : "showing-fallback";
          return k === "error" ? "unknown" : null;
        },
        get hidden() {
          return isHidden(live(made));
        },
        get raw() {
          deps.ledger.add("ref.raw", "raw", "the script read a raw fiber; results built from it bypass the kit guarantees");
          return live(made);
        },
        resolveSource() {
          return resolveFiberSource(live(made));
        },
        toJSON() {
          const label = made.label;
          return { fiberId: made.id, name: made.name, kind: made.kind, source: made.source, ...label && { label } };
        },
        toString() {
          return `${made.name || made.kind} (${made.id})`;
        }
      };
      refFibers.set(made, fiber);
      refs.set(fiber, made);
      if (fiber.alternate) refs.set(fiber.alternate, made);
      return made;
    }
    return {
      ref,
      refOrNull(fiber) {
        return fiber ? ref(fiber) : null;
      },
      isRef(value) {
        return !!value && typeof value === "object" && refFibers.has(value);
      },
      fiberOf: live
    };
  }
  function isHidden(fiber) {
    let node = fiber.return || null;
    let steps = 0;
    while (node && steps++ < MAX_CLIMB) {
      if (HIDDEN_TAGS.has(fiberTag$1(node))) {
        const current = currentOf(node);
        if (current.memoizedState != null) return true;
      }
      node = node.return || null;
    }
    return false;
  }
  function describeValue(value) {
    if (value === null || typeof value !== "object") return String(value);
    return Array.isArray(value) ? "an array" : "an object with keys " + (Object.keys(value).slice(0, 5).join(", ") || "(none)");
  }
  const SUSPENSE_TAG = 13;
  const OFFSCREEN_TAGS = /* @__PURE__ */ new Set([22, 23]);
  const COMPOSITE_TAGS = /* @__PURE__ */ new Set([0, 1, 2, 11, 14, 15]);
  const REPLACED = /* @__PURE__ */ new Set(["IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "INPUT", "TEXTAREA", "SELECT", "PICTURE", "OBJECT", "EMBED"]);
  const SKIPPED = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);
  const DEFAULT_AUTO_TARGETS = 15;
  const DEFAULT_MIN_SHARE = 0.01;
  const domGeometry = {
    viewport() {
      return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    },
    rect(el) {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
    textRects(node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects(), (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    },
    style(el) {
      return getComputedStyle(el);
    }
  };
  function resolveAreaRoot(root, doc = document) {
    if (root && typeof root === "object") return root;
    if (!root) return doc.documentElement;
    const value = String(root).trim();
    const byTestId = doc.querySelector('[data-testid="' + value.replace(/["\\]/g, "\\$&") + '"]');
    if (byTestId) return byTestId;
    try {
      return doc.querySelector(value);
    } catch (_) {
      return null;
    }
  }
  function rootLabel(root, el) {
    if (typeof root === "string" && root) return root;
    const testId = el.getAttribute("data-testid");
    return testId ? "testid:" + testId : el === el.ownerDocument.documentElement ? "viewport" : el.tagName.toLowerCase();
  }
  function fiberName(fiber) {
    return readComponentName(fiber.type) || readComponentName(fiber.elementType);
  }
  function fiberTag(fiber) {
    return fiber.tag ?? -1;
  }
  function isFallbackEdge(child, parent) {
    if (fiberTag(parent) !== SUSPENSE_TAG || OFFSCREEN_TAGS.has(fiberTag(child))) return false;
    const alternate = parent.alternate;
    return parent.memoizedState != null || !!(alternate && alternate.memoizedState != null);
  }
  function measureComponentArea(options = {}, geometry = domGeometry, doc = typeof document === "undefined" ? void 0 : document) {
    const startedAt = performance.now();
    const rootName = typeof options.root === "string" ? options.root : null;
    if (!doc) return { ok: false, reason: "no-document", root: rootName, at: startedAt };
    const rootEl = resolveAreaRoot(options.root, doc);
    if (!rootEl) return { ok: false, reason: "root-not-found", root: rootName, at: startedAt };
    const viewport = geometry.viewport();
    const isViewport = rootEl === doc.documentElement;
    const rootRect = isViewport ? viewport : geometry.rect(rootEl);
    const clip2 = intersectRect(rootRect, viewport);
    if (!clip2) return { ok: false, reason: "root-offscreen", root: rootName, at: startedAt };
    const cell = cellSizeFor(clip2);
    const placeholder = createAreaGrid(clip2, cell);
    const content = createAreaGrid(clip2, cell);
    const placeholderPattern = options.placeholderNames ? options.placeholderNames instanceof RegExp ? options.placeholderNames : new RegExp(options.placeholderNames) : null;
    const targets = [];
    const componentIndex = /* @__PURE__ */ new Map();
    const testIdIndex = /* @__PURE__ */ new Map();
    function addTarget(kind, name) {
      const index = kind === "component" ? componentIndex : testIdIndex;
      if (index.has(name)) return;
      index.set(name, targets.length);
      targets.push({
        label: kind + ":" + name,
        kind,
        name,
        elements: 0,
        box: createAreaGrid(clip2, cell),
        content: createAreaGrid(clip2, cell),
        placeholder: createAreaGrid(clip2, cell)
      });
    }
    for (const name of options.components || []) if (name) addTarget("component", name);
    for (const id of options.testIds || []) if (id) addTarget("testid", id);
    if (targets.length === 0) {
      for (const id of largestTestIds(rootEl, clip2, geometry, options)) addTarget("testid", id);
    }
    let elements = 0;
    let textRects = 0;
    function membershipFor(el, parentFiber, parent) {
      const fiber = getFiber(el);
      let groups = parent.groups;
      let isPlaceholder = parent.placeholder;
      const add = (index) => {
        if (index === void 0 || groups.includes(index)) return;
        groups = groups === parent.groups ? groups.slice() : groups;
        groups.push(index);
      };
      if (fiber) {
        const parentAlternate = parentFiber ? parentFiber.alternate : null;
        let child = fiber;
        let node = fiber.return || null;
        while (node && node !== parentFiber && node !== parentAlternate) {
          if (!isPlaceholder && isFallbackEdge(child, node)) isPlaceholder = true;
          if (COMPOSITE_TAGS.has(fiberTag(node)) && (componentIndex.size > 0 || placeholderPattern)) {
            const name = fiberName(node);
            if (name) {
              add(componentIndex.get(name));
              if (!isPlaceholder && placeholderPattern && placeholderPattern.test(name)) isPlaceholder = true;
            }
          }
          child = node;
          node = node.return || null;
        }
      }
      const testId = testIdIndex.size > 0 ? el.getAttribute("data-testid") : null;
      if (testId) add(testIdIndex.get(testId));
      return { m: { groups, placeholder: isPlaceholder }, fiber };
    }
    function visit(el, parentFiber, parent, area, isRoot) {
      if (SKIPPED.has(el.tagName.toUpperCase())) return;
      elements++;
      const { m, fiber } = membershipFor(el, parentFiber, parent);
      const style = geometry.style(el);
      if (style.display === "none") return;
      const rect = isRoot && isViewport ? viewport : geometry.rect(el);
      const sized = rectArea(rect) > 0;
      const visible = sized && style.visibility !== "hidden" && style.opacity !== "0";
      const box = visible ? intersectRect(rect, area) : null;
      const tag = el.tagName.toUpperCase();
      if (box) {
        if (m.placeholder && (!parent.placeholder || isRoot)) placeholder.add(box);
        for (const index of m.groups) {
          const target = targets[index];
          if (isRoot || !parent.groups.includes(index)) {
            target.box.add(box);
            target.elements++;
          }
          if (m.placeholder) target.placeholder.add(box);
        }
        if (REPLACED.has(tag)) addContent(box, m);
      }
      if (REPLACED.has(tag)) return;
      let childArea = area;
      if (!isRoot && sized && (clips(style.overflowX) || clips(style.overflowY))) {
        const clipped = intersectRect(area, rect);
        if (!clipped) return;
        childArea = clipped;
      }
      if (style.visibility !== "hidden" && style.opacity !== "0") {
        for (let node = el.firstChild; node; node = node.nextSibling) {
          if (node.nodeType !== 3 || !node.data.trim()) continue;
          for (const r of geometry.textRects(node)) {
            const inside = intersectRect(r, childArea);
            if (inside) {
              textRects++;
              addContent(inside, m);
            }
          }
        }
      }
      if (style.opacity === "0") return;
      for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
        visit(child, fiber || parentFiber, m, childArea, false);
      }
    }
    function addContent(rect, m) {
      if (m.placeholder) return;
      content.add(rect);
      for (const index of m.groups) targets[index].content.add(rect);
    }
    visit(rootEl, null, { groups: [], placeholder: false }, clip2, true);
    const rootArea = rectArea(clip2);
    const share = (n) => rootArea > 0 ? round$1(n / rootArea, 4) : 0;
    return {
      ok: true,
      at: round$1(startedAt, 1),
      root: { label: rootLabel(options.root ?? null, rootEl), rect: roundRect$1(clip2), area: Math.round(rootArea) },
      cellSize: cell,
      placeholder: { area: Math.round(placeholder.area()), share: share(placeholder.area()) },
      content: { area: Math.round(content.area()), share: share(content.area()) },
      targets: targets.map((t) => ({
        label: t.label,
        kind: t.kind,
        name: t.name,
        elements: t.elements,
        area: Math.round(t.box.area()),
        share: share(t.box.area()),
        contentArea: Math.round(t.content.area()),
        contentShare: share(t.content.area()),
        placeholderArea: Math.round(t.placeholder.area())
      })),
      stats: { elements, textRects, ms: round$1(performance.now() - startedAt, 1) }
    };
  }
  function largestTestIds(rootEl, clip2, geometry, options) {
    const limit = options.autoTargets ?? DEFAULT_AUTO_TARGETS;
    if (limit <= 0) return [];
    const minArea = rectArea(clip2) * (options.minShare ?? DEFAULT_MIN_SHARE);
    const best = /* @__PURE__ */ new Map();
    for (const el of Array.from(rootEl.querySelectorAll("[data-testid]"))) {
      const id = el.getAttribute("data-testid");
      if (!id) continue;
      const box = intersectRect(geometry.rect(el), clip2);
      const area = box ? rectArea(box) : 0;
      if (area >= minArea && area > (best.get(id) || 0)) best.set(id, area);
    }
    return Array.from(best.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }
  function clips(overflow) {
    return overflow === "hidden" || overflow === "auto" || overflow === "scroll" || overflow === "clip";
  }
  function round$1(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  }
  function roundRect$1(r) {
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  }
  function createGeometry(deps) {
    const { registry } = deps;
    const geometry = deps.geometry || domGeometry;
    function hostNodes(ref) {
      const root = registry.fiberOf(ref);
      const out = [];
      const stack = [root];
      while (stack.length) {
        const fiber = stack.pop();
        if (fiber !== root && fiber.sibling) stack.push(fiber.sibling);
        const node = fiber.stateNode;
        if ((isHostFiber(fiber) || fiberTag$1(fiber) === TAG.hostText) && node && typeof node.nodeType === "number") {
          out.push(node);
        } else if (fiber.child) {
          stack.push(fiber.child);
        }
      }
      return out;
    }
    function nodeRects(node) {
      const rects2 = node.nodeType === 3 ? geometry.textRects(node) : [geometry.rect(node)];
      return rects2.filter((r) => rectArea(r) > 0);
    }
    function rects(ref) {
      return hostNodes(ref).flatMap(nodeRects).map(roundRect);
    }
    function bounds(target) {
      const refs = (Array.isArray(target) ? target : [target]).filter((r) => !!r);
      const boxes = refs.flatMap((ref) => hostNodes(ref).flatMap(nodeRects));
      return boxes.length ? roundRect(unionBox(boxes)) : null;
    }
    function area(target) {
      const refs = (Array.isArray(target) ? target : [target]).filter((r) => !!r);
      const boxes = [];
      let nodes = 0;
      for (const ref of refs) {
        for (const node of hostNodes(ref)) {
          nodes += 1;
          boxes.push(...nodeRects(node));
        }
      }
      if (boxes.length === 0) return { area: 0, visibleArea: 0, box: null, nodes, cellSize: 1 };
      const box = unionBox(boxes);
      const whole = createAreaGrid(box);
      for (const r of boxes) whole.add(r);
      const viewport = intersectRect(box, geometry.viewport());
      let visibleArea = 0;
      if (viewport) {
        const visible = createAreaGrid(viewport, whole.cell);
        for (const r of boxes) visible.add(r);
        visibleArea = visible.area();
      }
      const total = Math.round(whole.area());
      return {
        area: total,
        visibleArea: Math.min(total, Math.round(visibleArea)),
        box: roundRect(box),
        nodes,
        cellSize: whole.cell
      };
    }
    return { hostNodes, rects, bounds, area };
  }
  function unionBox(boxes) {
    return boxes.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom)
    }));
  }
  function roundRect(r) {
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  }
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, key + "", value);
  function createLedger() {
    const byKey = /* @__PURE__ */ new Map();
    return {
      add(primitive, kind, detail) {
        const key = primitive + "\0" + kind + "\0" + detail;
        const existing = byKey.get(key);
        if (existing) existing.count += 1;
        else byKey.set(key, { primitive, kind, detail, count: 1 });
      },
      entries() {
        return Array.from(byKey.values(), (entry) => ({ ...entry }));
      }
    };
  }
  class GateError extends Error {
    constructor(gate, reason) {
      super(`${reason} Rerun eval-page with --allow ${gate} after stating the target and what the stimulus pollutes.`);
      __publicField(this, "gate");
      this.name = "GateError";
      this.gate = gate;
    }
  }
  const SCRIPT_GATES = ["replay"];
  function parseGates(value) {
    const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    const allowed = [];
    const unknown = [];
    for (const item of raw) {
      const gate = String(item).trim();
      if (!gate) continue;
      if (SCRIPT_GATES.includes(gate)) {
        if (!allowed.includes(gate)) allowed.push(gate);
      } else if (!unknown.includes(gate)) {
        unknown.push(gate);
      }
    }
    return { allowed, unknown };
  }
  const HOOK_COMPONENT_TAGS = /* @__PURE__ */ new Set([0, 11, 14, 15]);
  const DEFAULT_MAX_REPLAYS = 2e3;
  function bareHookName(frameName) {
    return frameName.slice(frameName.lastIndexOf(".") + 1);
  }
  function matchesHook(matcher, name) {
    if (matcher instanceof RegExp) {
      matcher.lastIndex = 0;
      return matcher.test(name);
    }
    return name === matcher;
  }
  function createHooks(deps) {
    const { registry, ledger } = deps;
    const cache = /* @__PURE__ */ new Map();
    function requireReplay(what) {
      if (!deps.allowed.includes("replay")) {
        ledger.add("hooks", "gap", `${what} needs --allow replay`);
        throw new GateError("replay", `${what} runs component render functions through debug replay.`);
      }
    }
    function fiberOnly(ref) {
      const raw = deps.evalFiberHooks(registry.fiberOf(ref));
      if (raw.truncated) ledger.add("hooks", "truncated", `hook list cut at ${raw.maxHooks} hooks`);
      return {
        component: ref,
        status: "fiber-only",
        hooks: raw.hooks.map((hook) => ({
          index: hook.index,
          primitive: hook.tag,
          path: [],
          value: hook.value !== void 0 ? hook.value : hook.current !== void 0 ? hook.current : hook.deps
        })),
        customHooks: [],
        truncated: raw.truncated,
        error: raw.error || null
      };
    }
    function replayed(ref) {
      const cached = cache.get(ref);
      if (cached) return cached;
      const raw = deps.replayComponentHooks(registry.fiberOf(ref));
      if (raw.replayStatus !== "complete") {
        ledger.add("hooks", "confidence", `replay ${raw.replayStatus}${raw.replayError ? ": " + raw.replayError : ""}`);
      }
      const customHooks = [];
      const hooks2 = raw.records.map((record) => {
        const path = (record.path || []).map((frame2) => bareHookName(frame2.name));
        for (const name of path) if (!customHooks.includes(name)) customHooks.push(name);
        return { index: record.index, primitive: record.primitive, path, value: record.value };
      });
      const result = {
        component: ref,
        status: raw.replayStatus,
        hooks: hooks2,
        customHooks,
        truncated: false,
        error: raw.replayError || null
      };
      cache.set(ref, result);
      return result;
    }
    function hooks(ref, options = {}) {
      if (!options.replay) return fiberOnly(ref);
      requireReplay("hooks(ref, { replay: true })");
      return replayed(ref);
    }
    function callers(hook, options = {}) {
      requireReplay(`hooks.callers(${String(hook)})`);
      const maxReplays = Math.max(1, Math.floor(options.maxReplays ?? DEFAULT_MAX_REPLAYS));
      const { maxReplays: _ignored, ...query } = options;
      const candidates = deps.find({ kind: "component", ...query, where: (ref) => HOOK_COMPONENT_TAGS.has(ref.tag) });
      if (candidates.length > maxReplays) {
        ledger.add("hooks.callers", "truncated", `replayed ${maxReplays} of ${candidates.length} candidate components; narrow with name, file, or within`);
      }
      return candidates.slice(0, maxReplays).filter((ref) => replayed(ref).customHooks.some((name) => matchesHook(hook, name)));
    }
    function props(ref) {
      const value = registry.fiberOf(ref).memoizedProps;
      return value && typeof value === "object" ? value : {};
    }
    return { hooks: Object.assign(hooks, { callers }), props };
  }
  const KIND_COLORS = {
    suspense: "#1D7AFC",
    error: "#E2483D",
    component: "#8270DB",
    host: "#22A06B",
    text: "#758195",
    portal: "#758195",
    other: "#758195"
  };
  const MAX_BOXES = 500;
  const INSET_PX = 3;
  const REFRESH_MS = 1e3;
  const sets = /* @__PURE__ */ new Map();
  let host = null;
  let layer = null;
  let frame = 0;
  let timer = null;
  let activeDeps = null;
  function resolve(value, ref, index, fallback) {
    if (value === void 0) return fallback;
    return typeof value === "function" ? value(ref, index) : value;
  }
  function schedule$1() {
    if (frame || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }
  function mount(doc) {
    if (host && host.isConnected) return;
    host = doc.createElement("div");
    host.setAttribute("data-chippy-ui", "true");
    host.setAttribute("data-chippy-overlay", "true");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:strict;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<style>.b{position:fixed;box-sizing:border-box;border:2px solid var(--c);background:color-mix(in srgb,var(--c) 7%,transparent);border-radius:2px}.b.d{border-style:dashed}.l{position:absolute;left:-2px;top:-2px;transform:translateY(-100%);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/16px system-ui,sans-serif;color:#fff;background:var(--c);padding:0 5px;border-radius:2px 2px 0 0}.l.in{transform:none;border-radius:0 0 2px 0}</style><div class="layer"></div>';
    layer = shadow.querySelector(".layer");
    doc.documentElement.appendChild(host);
    const view = doc.defaultView || window;
    view.addEventListener("scroll", schedule$1, { capture: true, passive: true });
    view.addEventListener("resize", schedule$1, { passive: true });
    timer = setInterval(render, REFRESH_MS);
  }
  function unmount() {
    var _a2;
    const view = ((_a2 = host == null ? void 0 : host.ownerDocument) == null ? void 0 : _a2.defaultView) || (typeof window !== "undefined" ? window : null);
    view == null ? void 0 : view.removeEventListener("scroll", schedule$1, { capture: true });
    view == null ? void 0 : view.removeEventListener("resize", schedule$1);
    if (timer) clearInterval(timer);
    timer = null;
    if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = 0;
    host == null ? void 0 : host.remove();
    host = null;
    layer = null;
  }
  function render() {
    if (!layer || !activeDeps) return;
    const doc = layer.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const boxes of sets.values()) {
      for (const box of boxes) {
        const rect = safeBox(activeDeps, box.ref);
        if (!rect) continue;
        const inset = box.depth * INSET_PX;
        const el = doc.createElement("div");
        el.className = box.dashed ? "b d" : "b";
        el.style.setProperty("--c", box.color);
        el.style.left = rect.left + inset + "px";
        el.style.top = rect.top + inset + "px";
        el.style.width = Math.max(0, rect.right - rect.left - 2 * inset) + "px";
        el.style.height = Math.max(0, rect.bottom - rect.top - 2 * inset) + "px";
        if (box.label) {
          const label = doc.createElement("div");
          label.className = rect.top + inset < 16 || box.depth > 0 ? "l in" : "l";
          label.textContent = box.label;
          el.appendChild(label);
        }
        fragment.appendChild(el);
      }
    }
    layer.replaceChildren(fragment);
  }
  function safeBox(deps, ref) {
    try {
      return deps.boxOf(ref);
    } catch {
      return null;
    }
  }
  function safeAncestor(deps, ancestor, of) {
    try {
      return deps.isAncestor(ancestor, of);
    } catch {
      return false;
    }
  }
  function paintOverlay(layers, options, deps) {
    const doc = deps.document || document;
    const id = String(options.id || "default");
    const boxes = [];
    let skipped = 0;
    for (const spec of Array.isArray(layers) ? layers : [layers]) {
      (spec.items || []).forEach((ref, index) => {
        if (!ref || boxes.length >= MAX_BOXES) {
          if (ref) skipped += 1;
          return;
        }
        if (!deps.boxOf(ref)) {
          skipped += 1;
          return;
        }
        boxes.push({
          ref,
          color: resolve(spec.color, ref, index, "kind") === "kind" ? KIND_COLORS[ref.kind] : resolve(spec.color, ref, index, "kind"),
          label: resolve(spec.label, ref, index, ref.label ?? ref.name),
          dashed: resolve(spec.dashed, ref, index, ref.status === "showing-fallback"),
          depth: 0
        });
      });
    }
    const all = [...boxes, ...Array.from(sets.entries()).filter(([key]) => key !== id).flatMap(([, list]) => list)];
    for (const box of boxes) box.depth = all.filter((other) => other.ref !== box.ref && safeAncestor(deps, other.ref, box.ref)).length;
    sets.set(id, boxes);
    activeDeps = deps;
    mount(doc);
    render();
    return { ok: true, id, boxes: boxes.length, skipped };
  }
  function clearOverlay(id) {
    var _a2;
    let cleared = 0;
    if (id === void 0) {
      for (const list of sets.values()) cleared += list.length;
      sets.clear();
    } else {
      cleared = ((_a2 = sets.get(String(id))) == null ? void 0 : _a2.length) || 0;
      sets.delete(String(id));
    }
    if (sets.size === 0) unmount();
    else render();
    return { ok: true, cleared };
  }
  function listOverlay() {
    return Array.from(sets.entries(), ([id, list]) => ({ id, boxes: list.length }));
  }
  const SHOWN_IN_PARENTS = /* @__PURE__ */ new Set(["component", "error", "suspense"]);
  function createRelate(deps) {
    const { registry, ledger } = deps;
    function stopsAt(until, ref) {
      if (!until) return false;
      return typeof until === "function" ? !!until(ref) : until === ref;
    }
    function parents(ref, options = {}) {
      const onlyComponents = options.components !== false;
      const max = Math.max(1, Math.floor(options.max ?? MAX_BOUNDARY_FIBERS));
      const out = [];
      let node = registry.fiberOf(ref).return || null;
      let steps = 0;
      while (node) {
        if (++steps > MAX_BOUNDARY_FIBERS * 5) {
          ledger.add("parents", "truncated", "parent walk stopped at the climb ceiling");
          break;
        }
        const parent = registry.ref(node);
        const stop = stopsAt(options.until, parent);
        if (stop && !options.inclusive) break;
        if (!onlyComponents || SHOWN_IN_PARENTS.has(parent.kind)) {
          out.push(parent);
          if (out.length >= max && !stop) {
            if (options.max === void 0) ledger.add("parents", "truncated", `stopped at max ${max} parents`);
            break;
          }
        }
        if (stop) break;
        node = node.return || null;
      }
      if (options.until && typeof options.until !== "function" && !node) {
        ledger.add("parents", "gap", "the until fiber is not an ancestor; the walk reached the root");
      }
      return out;
    }
    function boundaries(ref, options = {}) {
      const kinds = options.kinds || ["suspense", "error"];
      return parents(ref, { components: true, max: MAX_BOUNDARY_FIBERS * 5 }).filter((parent) => kinds.includes(parent.kind));
    }
    function nearest(ref, kind) {
      return boundaries(ref, { kinds: [kind] })[0] || null;
    }
    function components(ref, query = {}) {
      return deps.find({ kind: "component", ...query, within: ref });
    }
    function distance(from, to) {
      if (from === to) return 0;
      let node = registry.fiberOf(from).return || null;
      let hops = 1;
      while (node && hops < MAX_BOUNDARY_FIBERS * 5) {
        if (registry.ref(node) === to) return hops;
        node = node.return || null;
        hops += 1;
      }
      return null;
    }
    function isAncestor(ancestor, of) {
      return ancestor !== of && distance(of, ancestor) !== null;
    }
    function owners(ref) {
      const chain = getOwnerChainFibers(registry.fiberOf(ref));
      if (chain.ownerStackKind === "parents") ledger.add("owners", "confidence", "no _debugOwner on this build; owners are component parents");
      return chain.fibers.map((fiber) => registry.ref(fiber));
    }
    return { parents, boundaries, nearest, components, distance, isAncestor, owners };
  }
  const SCAN_CEILING = 3e5;
  const DEFAULT_MAX = 5e3;
  function matches(matcher, value, exact) {
    if (matcher === void 0) return true;
    if (value == null) return false;
    if (matcher instanceof RegExp) {
      matcher.lastIndex = 0;
      return matcher.test(value);
    }
    return exact ? value === matcher : value.includes(matcher);
  }
  function kindMatches(filter, kind) {
    for (const f of filter) {
      if (f === "any" || f === kind) return true;
      if (f === "boundary" && (kind === "suspense" || kind === "error")) return true;
      if (f === "component" && kind === "error") return true;
    }
    return false;
  }
  function firstElement(fiber) {
    var _a2;
    const stack = [fiber];
    while (stack.length) {
      const node = stack.pop();
      if (isHostFiber(node) && ((_a2 = node.stateNode) == null ? void 0 : _a2.nodeType) === 1) return node.stateNode;
      if (node.sibling && node !== fiber) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    return null;
  }
  function createSelect(deps) {
    const { registry, ledger } = deps;
    function roots() {
      return deps.getRootFibers().map((root) => registry.ref(currentOf(root)));
    }
    function find(query = {}, options = {}) {
      var _a2;
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind || "component"];
      const max = Math.max(1, Math.floor(query.max ?? DEFAULT_MAX));
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      let scanned = 0;
      let fileOnUrl = false;
      const within = query.within ? registry.fiberOf(query.within) : null;
      const starts = within ? [within] : deps.getRootFibers().map((root) => currentOf(root));
      for (const start of starts) {
        const stack = [start];
        while (stack.length) {
          const fiber = stack.pop();
          if (seen.has(fiber) || fiber.alternate && seen.has(fiber.alternate)) continue;
          seen.add(fiber);
          if (++scanned > SCAN_CEILING) {
            ledger.add("find", "truncated", `scan stopped after ${SCAN_CEILING} fibers`);
            return out;
          }
          const ref = registry.ref(fiber);
          if (fiber !== within && kindMatches(kinds, ref.kind) && !(query.visibleOnly && ref.hidden)) {
            let ok = matches(query.name, ref.name, true);
            if (ok && query.file !== void 0) {
              const file = ((_a2 = ref.source) == null ? void 0 : _a2.fileName) || null;
              if (file && /^https?:/.test(file)) fileOnUrl = true;
              ok = matches(query.file, file, false);
            }
            if (ok && (query.testId !== void 0 || query.text !== void 0)) {
              const el = firstElement(fiber);
              ok = matches(query.testId, el == null ? void 0 : el.getAttribute("data-testid"), true) && matches(query.text, (el == null ? void 0 : el.textContent) ? el.textContent.replace(/\s+/g, " ").trim() : null, false);
            }
            if (ok && query.where) ok = !!query.where(ref);
            if (ok) {
              if (out.length >= max) {
                if (!options.quiet) ledger.add("find", "truncated", `more than ${max} matches; raise max or narrow the query`);
                return out;
              }
              out.push(ref);
            }
          }
          if (fiber.sibling && fiber !== start) stack.push(fiber.sibling);
          if (fiber.child) stack.push(fiber.child);
        }
      }
      if (fileOnUrl) ledger.add("find", "confidence", "file was matched against generated module URLs (React 19 before source resolution)");
      return out;
    }
    function first(query = {}) {
      return find({ ...query, max: 1 }, { quiet: true })[0] || null;
    }
    function fromElement(target) {
      const el = typeof target === "string" ? document.querySelector(target) : target;
      if (!el) return null;
      const fiber = getFiber(el);
      return fiber ? registry.ref(currentOf(fiber)) : null;
    }
    return { roots, find: (query) => find(query), first, fromElement };
  }
  const SCRIPT_KIT_VERSION = 1;
  const session = {};
  const HELP = {
    select: 'roots() | first(query) | find({ name, file, testId, text, kind, within, visibleOnly, where, max }) | fromElement(el|selector) | byId("fiber:N")',
    relate: 'parents(ref, { until, inclusive, components, max }) | boundaries(ref, { kinds }) | nearest(ref, "suspense"|"error") | components(ref, query) | distance(from, to) | isAncestor(a, b) | owners(ref)',
    measure: "hostNodes(ref) | rects(ref) | bounds(ref|refs) | area(ref|refs) -> { area, visibleArea, box, nodes, cellSize }",
    hooks: 'hooks(ref) fiber-only | hooks(ref, { replay: true }) names custom hooks (needs --allow replay) | hooks.callers("useQuery", query) (needs --allow replay) | props(ref)',
    overlay: "overlay.paint({ items, color, label, dashed } | layers[], { id }) | overlay.clear(id?) | overlay.list()",
    run: "checkpoint(value) keeps a partial result for timeouts | session persists between runs | log(...values) | allowed lists the gates of this run",
    ref: "FiberRef: id name kind label tag key source status hidden raw resolveSource(); serializes as { fiberId, name, kind, source, label? }; label is the app name from an enabled plugin or pack; refs compare with ==="
  };
  function createScriptKit(deps) {
    const ledger = deps.ledger || createLedger();
    const registry = createRefRegistry({ rememberFiber: deps.rememberFiber, ledger });
    const select = createSelect({ getRootFibers: deps.getRootFibers, registry, ledger });
    const relate = createRelate({ registry, ledger, find: select.find });
    const geometry = createGeometry({ registry, geometry: deps.geometry });
    const hookReads = createHooks({
      registry,
      ledger,
      allowed: deps.allowed,
      find: select.find,
      evalFiberHooks: deps.evalFiberHooks,
      replayComponentHooks: deps.replayComponentHooks
    });
    let partial = null;
    function byId(id) {
      var _a2;
      const key = /^\d+$/.test(String(id)) ? "fiber:" + id : String(id);
      const fiber = (_a2 = deps.getRememberedFiber) == null ? void 0 : _a2.call(deps, key);
      if (!fiber) {
        ledger.add("byId", "gap", `no remembered fiber ${key} on this page session`);
        return null;
      }
      return registry.ref(currentOf(fiber));
    }
    const overlay = {
      paint(layers, options = {}) {
        return paintOverlay(layers, options, { boxOf: geometry.bounds, isAncestor: relate.isAncestor });
      },
      clear: clearOverlay,
      list: listOverlay
    };
    const chippy = {
      version: SCRIPT_KIT_VERSION,
      allowed: [...deps.allowed],
      ...select,
      byId,
      ...relate,
      ...geometry,
      ...hookReads,
      overlay,
      session,
      isRef: registry.isRef,
      checkpoint(value) {
        partial = { value };
        return value;
      },
      log(...values) {
        deps.log.push(values.length === 1 ? values[0] : values);
      },
      help(topic) {
        return topic ? HELP[topic] || `unknown topic; one of ${Object.keys(HELP).join(", ")}` : HELP;
      }
    };
    return {
      chippy,
      ledger,
      partial: () => partial
    };
  }
  const MAX_GLOBALS = 20;
  function isChippyUi(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!el && typeof el.closest === "function" && !!el.closest("[data-chippy-ui]");
  }
  function countable(record) {
    if (isChippyUi(record.target)) return false;
    if (record.type !== "childList") return true;
    const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changed.length === 0 || changed.some((node) => !(node.nodeType === 1 && node.hasAttribute("data-chippy-ui")) && !isChippyUi(node));
  }
  function watchSideEffects(deps) {
    var _a2;
    const win = deps.win || window;
    const before = /* @__PURE__ */ new Map();
    for (const root of deps.fiberRoots()) before.set(root, root.current);
    const globals = new Set(Object.keys(win));
    let mutations = 0;
    let observer = null;
    if (typeof win.MutationObserver === "function" && ((_a2 = win.document) == null ? void 0 : _a2.documentElement)) {
      observer = new win.MutationObserver((records) => {
        for (const record of records) if (countable(record)) mutations += 1;
      });
      observer.observe(win.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    return function stop() {
      if (observer) {
        for (const record of observer.takeRecords()) if (countable(record)) mutations += 1;
        observer.disconnect();
      }
      let rootsCommitted = 0;
      for (const [root, current] of before) if (root.current !== current) rootsCommitted += 1;
      const globalsAdded = [];
      for (const key of Object.keys(win)) {
        if (!globals.has(key)) {
          globalsAdded.push(key);
          if (globalsAdded.length >= MAX_GLOBALS) break;
        }
      }
      return { domMutations: mutations, rootsCommitted, globalsAdded };
    };
  }
  function fiberRootsOf(hostRoots) {
    const out = [];
    for (const fiber of hostRoots) {
      const root = fiber && fiber.stateNode;
      if (root && typeof root === "object" && "current" in root && !out.includes(root)) out.push(root);
    }
    return out;
  }
  const DEFAULT_SCRIPT_TIMEOUT_MS = 5e3;
  const MAX_SCRIPT_TIMEOUT_MS = 12e4;
  const MIN_SCRIPT_TIMEOUT_MS = 50;
  function clampScriptTimeout(value) {
    const ms2 = Number(value) || DEFAULT_SCRIPT_TIMEOUT_MS;
    return Math.min(MAX_SCRIPT_TIMEOUT_MS, Math.max(MIN_SCRIPT_TIMEOUT_MS, ms2));
  }
  class ScriptTimeout extends Error {
    constructor(ms2) {
      super(`script timeout after ${ms2}ms; the script may still be running in the page`);
      this.name = "ScriptTimeout";
    }
  }
  async function runChippyScript(command, deps) {
    const now = deps.now || Date.now;
    const startedAt = now();
    const source = String(command.source || "");
    const args = command.args && typeof command.args === "object" ? command.args : {};
    const timeoutMs = clampScriptTimeout(command.timeoutMs);
    const gates = parseGates(command.allow);
    const log = [];
    const ledger = createLedger();
    const serialize = (value) => deps.scriptResultJson(value);
    const base = () => ({
      durationMs: now() - startedAt,
      log: serialize(log),
      limits: ledger.entries(),
      allowed: gates.allowed,
      ...gates.unknown.length ? { unknownGates: gates.unknown } : {}
    });
    if (!source.trim()) {
      return { ok: false, error: "empty script source", sideEffects: { domMutations: 0, rootsCommitted: 0, globalsAdded: [] }, ...base() };
    }
    const helpers = deps.buildHelpers(log);
    const kit = createScriptKit({
      rememberFiber: deps.rememberFiber,
      getRememberedFiber: deps.getRememberedFiber,
      getRootFibers: helpers.getRootFibers,
      evalFiberHooks: deps.evalFiberHooks,
      replayComponentHooks: deps.replayComponentHooks,
      allowed: gates.allowed,
      log,
      ledger
    });
    const ctx = { args, helpers, log, chippy: kit.chippy };
    const stopWatching = watchSideEffects({ fiberRoots: () => fiberRootsOf(helpers.getRootFibers()) });
    let timer2 = null;
    try {
      const factory = new Function(
        "ctx",
        "chippy",
        '"use strict"; return (async function chippyScript(ctx, chippy){\n' + source + "\n}).call(globalThis, ctx, chippy);"
      );
      const timeout = new Promise((_, reject) => {
        timer2 = setTimeout(() => reject(new ScriptTimeout(timeoutMs)), timeoutMs);
      });
      const value = await Promise.race([Promise.resolve().then(() => factory(ctx, kit.chippy)), timeout]);
      const result = serialize(value);
      return { ok: true, result, sideEffects: stopWatching(), ...base() };
    } catch (error) {
      const partial = kit.partial();
      const envelope = {
        ok: false,
        error: String((error == null ? void 0 : error.stack) || (error == null ? void 0 : error.message) || error),
        sideEffects: stopWatching(),
        ...base()
      };
      if (error instanceof GateError) {
        envelope.gate = error.gate;
        envelope.error = error.message;
      }
      if (error instanceof ScriptTimeout) envelope.timedOut = true;
      if (partial) envelope.partial = serialize(partial.value);
      return envelope;
    } finally {
      if (timer2) clearTimeout(timer2);
    }
  }
  let state = null;
  const domWatchDeps = {
    measure: (options) => measureComponentArea(options),
    now: () => performance.now(),
    setTimeout: (fn, ms2) => globalThis.setTimeout(fn, ms2),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    frame: (fn) => {
      if (typeof requestAnimationFrame === "function" && !(typeof document !== "undefined" && document.hidden)) requestAnimationFrame(() => fn());
      else fn();
    },
    observe: (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-testid"]
      });
      window.addEventListener("scroll", onChange, true);
      window.addEventListener("resize", onChange);
      return () => {
        observer.disconnect();
        window.removeEventListener("scroll", onChange, true);
        window.removeEventListener("resize", onChange);
      };
    }
  };
  function startAreaWatch(options = {}, deps = domWatchDeps) {
    if (state) finish("restarted");
    const s = {
      options,
      startedAt: deps.now(),
      intervalMs: Math.max(16, options.intervalMs ?? 50),
      samples: [],
      measurements: 0,
      measureMsTotal: 0,
      measureMsMax: 0,
      lastMeasuredAt: -Infinity,
      pending: null,
      poll: null,
      stopTimer: null,
      disconnect: () => {
      },
      active: true,
      stoppedReason: null,
      lastKey: "",
      deps
    };
    state = s;
    s.disconnect = deps.observe(() => schedule(s));
    s.stopTimer = deps.setTimeout(() => {
      if (state === s) finish("duration");
    }, Math.max(100, options.durationMs ?? 3e4));
    if (options.pollMs && options.pollMs > 0) startPoll(s, Math.max(s.intervalMs, options.pollMs));
    recordSample(s);
    return { ok: true, startedAt: round(s.startedAt), intervalMs: s.intervalMs, first: s.samples[0] || null };
  }
  function readAreaWatch() {
    if (!state) return { ok: false, reason: "not-started" };
    return summarize(state);
  }
  function stopAreaWatch() {
    if (!state) return { ok: false, reason: "not-started" };
    if (state.active) {
      recordSample(state);
      finish("stopped");
    }
    return summarize(state);
  }
  function startPoll(s, ms2) {
    const tick = () => {
      if (!s.active) return;
      schedule(s);
      s.poll = s.deps.setTimeout(tick, ms2);
    };
    s.poll = s.deps.setTimeout(tick, ms2);
  }
  function schedule(s) {
    if (!s.active || s.pending) return;
    const wait = Math.max(0, s.lastMeasuredAt + s.intervalMs - s.deps.now());
    s.pending = s.deps.setTimeout(() => {
      s.deps.frame(() => {
        s.pending = null;
        if (s.active) recordSample(s);
      });
    }, wait);
  }
  function recordSample(s) {
    const before = s.deps.now();
    const report = s.deps.measure(s.options);
    const after = s.deps.now();
    const cost = after - before;
    s.lastMeasuredAt = after;
    s.measurements++;
    s.measureMsTotal += cost;
    s.measureMsMax = Math.max(s.measureMsMax, cost);
    if (cost > s.intervalMs / 2) s.intervalMs = Math.min(1e3, s.intervalMs * 2);
    const sample = toSample(report, before - s.startedAt);
    const key = JSON.stringify([sample.root, sample.placeholder, sample.content, sample.targets]);
    if (key === s.lastKey) return;
    s.lastKey = key;
    s.samples.push(sample);
    if (s.samples.length >= Math.max(1, s.options.maxSamples ?? 1e3)) finish("max-samples");
  }
  function toSample(report, t) {
    if (!report.ok) return { t: round(t), root: 0, placeholder: 0, content: 0, targets: {} };
    const targets = {};
    for (const target of report.targets) {
      if (target.area || target.contentArea || target.placeholderArea) {
        targets[target.label] = [target.area, target.contentArea, target.placeholderArea];
      }
    }
    return { t: round(t), root: report.root.area, placeholder: report.placeholder.area, content: report.content.area, targets };
  }
  function finish(reason) {
    const s = state;
    if (!s || !s.active) return;
    s.active = false;
    s.stoppedReason = reason;
    s.disconnect();
    for (const handle of [s.pending, s.poll, s.stopTimer]) if (handle) s.deps.clearTimeout(handle);
    s.pending = null;
  }
  function summarize(s) {
    var _a2;
    const samples = s.samples;
    const last = samples[samples.length - 1] || null;
    const labels = /* @__PURE__ */ new Set();
    for (const sample of samples) for (const label of Object.keys(sample.targets)) labels.add(label);
    for (const name of s.options.components || []) labels.add("component:" + name);
    for (const id of s.options.testIds || []) labels.add("testid:" + id);
    const targets = {};
    for (const label of labels) {
      let firstSeenAt = null;
      let firstContentAt = null;
      let lastChangeAt = null;
      let peakPlaceholder = 0;
      let previous = "";
      for (const sample of samples) {
        const v = sample.targets[label] || [0, 0, 0];
        if (firstSeenAt === null && v[0] > 0) firstSeenAt = sample.t;
        if (firstContentAt === null && v[1] > 0) firstContentAt = sample.t;
        peakPlaceholder = Math.max(peakPlaceholder, v[2]);
        const key = v.join(",");
        if (previous && key !== previous) lastChangeAt = sample.t;
        previous = key;
      }
      const final = last && last.targets[label] || [0, 0, 0];
      targets[label] = { firstSeenAt, firstContentAt, lastChangeAt, finalArea: final[0], finalContent: final[1], peakPlaceholder };
    }
    let placeholderFirstAt = null;
    let placeholderPeak = 0;
    let placeholderClearedAt = null;
    for (const sample of samples) {
      if (sample.placeholder > 0) {
        if (placeholderFirstAt === null) placeholderFirstAt = sample.t;
        placeholderPeak = Math.max(placeholderPeak, sample.placeholder);
        placeholderClearedAt = null;
      } else if (placeholderFirstAt !== null && placeholderClearedAt === null) {
        placeholderClearedAt = sample.t;
      }
    }
    const finalContent = last ? last.content : 0;
    const reached = (fraction) => {
      if (finalContent <= 0) return null;
      const hit = samples.find((sample) => sample.content >= finalContent * fraction);
      return hit ? hit.t : null;
    };
    return {
      ok: true,
      active: s.active,
      stoppedReason: s.stoppedReason,
      startedAt: round(s.startedAt),
      elapsedMs: round(s.deps.now() - s.startedAt),
      measurements: s.measurements,
      measureMs: { avg: s.measurements ? round(s.measureMsTotal / s.measurements) : 0, max: round(s.measureMsMax) },
      intervalMs: s.intervalMs,
      root: { firstFoundAt: ((_a2 = samples.find((sample) => sample.root > 0)) == null ? void 0 : _a2.t) ?? null, finalArea: last ? last.root : 0 },
      placeholder: { firstAt: placeholderFirstAt, peakArea: placeholderPeak, clearedAt: placeholderClearedAt, finalArea: last ? last.placeholder : 0 },
      content: { finalArea: finalContent, reached50At: reached(0.5), reached90At: reached(0.9), reached100At: reached(1) },
      targets,
      samples
    };
  }
  function round(n) {
    return Math.round(n * 10) / 10;
  }
  function safeJson(value, depth = 6, seen = /* @__PURE__ */ new WeakSet()) {
    if (value == null) return value;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return value;
    if (t === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (t === "symbol" || t === "bigint") return String(value);
    if (depth <= 0) return Array.isArray(value) ? "[Array]" : "[Object]";
    if (typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 200).map((v) => safeJson(v, depth - 1, seen));
      const out = {};
      let n = 0;
      for (const k of Object.keys(value)) {
        if (n++ > 200) {
          out._truncated = true;
          break;
        }
        try {
          out[k] = safeJson(value[k], depth - 1, seen);
        } catch (_) {
          out[k] = "[Unserializable]";
        }
      }
      return out;
    }
    return String(value);
  }
  function resolveOwnerFiber(baseFiber, ownerIndex) {
    if (ownerIndex == null) return null;
    const target = Number(ownerIndex);
    if (!Number.isInteger(target) || target < 0) return null;
    const { fibers } = collectOwnerFibers(baseFiber, isComponentFiber, target + 1);
    return fibers[target] || null;
  }
  function getOwnerStackKind(baseFiber) {
    return collectOwnerFibers(baseFiber, isComponentFiber, 1).ownerStackKind;
  }
  function findFiberByName(name, helpers) {
    const re = new RegExp("^" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    let found = null;
    helpers.walkAll((fiber) => {
      if (found) return;
      const info = helpers.fiberInfo(fiber);
      if ((info == null ? void 0 : info.name) && re.test(info.name)) found = fiber;
    }, { limit: 2e5 });
    return found;
  }
  function inspectFiberOwners(fiber, fiberId, helpers) {
    const { ownerStackKind, fibers } = collectOwnerFibers(
      fiber,
      (candidate, kind) => kind === "owners" || isComponentFiber(candidate),
      100
    );
    const owners = fibers.map((owner2, idx) => ({ ownerIndex: idx, ...helpers.fiberInfo(owner2) || {} }));
    return { fiberId: String(fiberId), ownerStackKind, count: owners.length, items: owners };
  }
  function inspectFiberStructure(fiber, fiberId, hookIndex, windowSize, replayComponentHooks2, evalFiberHooks2) {
    const { componentName, records, replayAttempted, replayError, replayErrorDetails, replayStatus } = replayComponentHooks2(fiber);
    const targetIndex = Number(hookIndex);
    const target = records.find((r) => r.index === targetIndex);
    const liveHookCount = evalFiberHooks2(fiber).hookCount;
    const warnings = [];
    if (!replayAttempted) warnings.push("fiber-only fallback: component functions were not executed");
    if (replayError) warnings.push("structure-render error: " + replayError);
    if (!target) {
      return { ok: false, status: "hook-not-found", componentName, fiberId: String(fiberId), requestedHookIndex: targetIndex, hookCount: liveHookCount, liveHookCount, replayedHookCount: 0, replayStatus: "not-run-fiber-only", captureEngineOk: true, warnings };
    }
    const radius = Math.max(0, Number(windowSize) || 3);
    const folderRecs = records.filter((r) => Math.abs(r.index - targetIndex) <= radius);
    const lines = [componentName];
    for (const r of folderRecs) {
      const mark = r.index === targetIndex ? " ← target" : "";
      lines.push("└─ hook " + r.index + " " + r.primitive + mark);
    }
    return {
      ok: true,
      status: "ok",
      componentName,
      fiberId: String(fiberId),
      requestedHookIndex: targetIndex,
      hookCount: liveHookCount,
      liveHookCount,
      replayedHookCount: 0,
      replayStatus: replayStatus || "fiber-only-fallback",
      text: lines.join("\n"),
      target: { hookId: target.index, type: target.primitive, value: target.value, parents: (target.path || []).map((p) => p.name).concat([componentName]), parentsWithLoc: target.path || [], debugLabel: target.debugLabel },
      folder: folderRecs.map((r) => ({ hookId: r.index, type: r.primitive, value: r.value, target: r.index === targetIndex, path: r.path || [], debugLabel: r.debugLabel })),
      captureEngineOk: !!replayAttempted,
      warnings,
      replayError: replayError || void 0,
      replayErrorDetails: replayErrorDetails || void 0
    };
  }
  const MAX_FIBERS_SEARCHED = 500;
  const RESERVED = /* @__PURE__ */ new Set([
    "type",
    "target",
    "currentTarget",
    "nativeEvent",
    "preventDefault",
    "stopPropagation",
    "isDefaultPrevented",
    "isPropagationStopped",
    "persist",
    "isPersistent",
    "defaultPrevented"
  ]);
  const IGNORED_READS = /* @__PURE__ */ new Set(["then", "toJSON", "$$typeof", "constructor", "asymmetricMatch", "nodeType"]);
  function isEventPlaceholder(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.$event === "string" && value.$event.trim() !== "";
  }
  function isElement(value) {
    return !!value && typeof value === "object" && value.nodeType === 1;
  }
  function firstElementOf(fiber) {
    const stack = fiber ? [fiber] : [];
    let searched = 0;
    while (stack.length && searched < MAX_FIBERS_SEARCHED) {
      const node = stack.pop();
      searched += 1;
      if (isElement(node.stateNode)) return node.stateNode;
      if (node !== fiber && node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    return null;
  }
  function describeElement(element) {
    if (!element) return null;
    const tag = element.tagName.toLowerCase();
    const testId = element.getAttribute("data-testid");
    if (testId) return `${tag}[data-testid="${testId}"]`;
    if (element.id) return `${tag}#${element.id}`;
    return tag;
  }
  function nativeEventOf(type, init) {
    const view = typeof window === "undefined" ? null : window;
    if (!view || typeof view.Event !== "function") return null;
    const options = { bubbles: true, cancelable: true, ...init };
    const ctor = /^(?:click|dblclick|contextmenu|mouse|auxclick)/.test(type) ? view.MouseEvent : /^pointer/.test(type) ? view.PointerEvent ?? view.MouseEvent : /^key/.test(type) ? view.KeyboardEvent : /^(?:focus|blur)/.test(type) ? view.FocusEvent : view.Event;
    try {
      return new (ctor ?? view.Event)(type, options);
    } catch {
      return new view.Event(type, options);
    }
  }
  function createSyntheticEvent(placeholder, fiber) {
    const { $event, ...rest } = placeholder;
    const type = $event.trim();
    const fields = {};
    for (const [key, value] of Object.entries(rest)) {
      if (!RESERVED.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))) fields[key] = value;
    }
    const element = firstElementOf(fiber);
    const nativeEvent = nativeEventOf(type, fields);
    const report = {
      synthetic: true,
      type,
      target: describeElement(element),
      calls: [],
      defaultPrevented: false,
      propagationStopped: false,
      missing: []
    };
    let persistent = false;
    const base = {
      bubbles: true,
      cancelable: true,
      eventPhase: 2,
      isTrusted: false,
      timeStamp: typeof performance === "undefined" ? Date.now() : performance.now(),
      ...fields,
      type,
      target: element,
      currentTarget: element,
      nativeEvent,
      preventDefault() {
        report.calls.push("preventDefault");
        report.defaultPrevented = true;
        nativeEvent == null ? void 0 : nativeEvent.preventDefault();
      },
      stopPropagation() {
        report.calls.push("stopPropagation");
        report.propagationStopped = true;
        nativeEvent == null ? void 0 : nativeEvent.stopPropagation();
      },
      isDefaultPrevented: () => report.defaultPrevented,
      isPropagationStopped: () => report.propagationStopped,
      persist() {
        report.calls.push("persist");
        persistent = true;
      },
      isPersistent: () => persistent
    };
    Object.defineProperty(base, "defaultPrevented", { enumerable: true, get: () => report.defaultPrevented });
    const event = new Proxy(base, {
      get(target, key, receiver) {
        if (typeof key === "string" && !(key in target) && !IGNORED_READS.has(key) && !report.missing.includes(key)) {
          report.missing.push(key);
        }
        return Reflect.get(target, key, receiver);
      }
    });
    return { event, report };
  }
  const REACT_TAG_CLASS_COMPONENT = 1;
  function readFiberProp(fiberId, propName, deps) {
    const rememberedFiberId = deps.normalizeRememberedFiberId(fiberId);
    if (!rememberedFiberId) return { ok: false, error: "fiberId is required" };
    const name = String(propName || "").trim();
    if (!name) return { ok: false, error: "propName is required" };
    const fiber = deps.getRememberedFiber(rememberedFiberId);
    if (!fiber) return { ok: false, error: `fiber ${rememberedFiberId} not found`, fiberId: rememberedFiberId };
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") {
      return { ok: false, error: `fiber ${rememberedFiberId} has no props`, fiberId: rememberedFiberId, fiber };
    }
    if (!(name in props)) {
      return { ok: false, error: `prop ${name} not found on fiber ${rememberedFiberId}`, fiberId: rememberedFiberId, fiber, props };
    }
    return { ok: true, fiberId: rememberedFiberId, fiber, props, propName: name, value: props[name] };
  }
  function getFiberDisplayName$1(fiber) {
    const type = fiber == null ? void 0 : fiber.type;
    return type && (type.displayName || type.name) || "Unknown";
  }
  function functionSourcePreview(fn, max = 800) {
    try {
      const source = Function.prototype.toString.call(fn);
      return source.length > max ? source.slice(0, max) + "…" : source;
    } catch (_e2) {
      return null;
    }
  }
  function getFiberSource$1(fiber) {
    return getFiberSource$2(fiber);
  }
  function summarizeFunctionContract(value) {
    if (typeof value !== "function") {
      return { propType: typeof value, isFunction: false, fnLength: null, fnName: null, fnSourcePreview: null };
    }
    return {
      propType: "function",
      isFunction: true,
      fnLength: Number.isFinite(value.length) ? value.length : null,
      fnName: value.name || null,
      fnSourcePreview: functionSourcePreview(value)
    };
  }
  function evalFiberPropContract(fiberId, propName, deps) {
    const read2 = readFiberProp(fiberId, propName, deps);
    if (!read2.ok) {
      const fiberName2 = read2.fiber ? getFiberDisplayName$1(read2.fiber) : null;
      return { ok: false, error: read2.error, fiberId: read2.fiberId, fiberName: fiberName2, propNames: read2.props ? Object.keys(read2.props) : [] };
    }
    const propNames = Object.keys(read2.props);
    const contract = summarizeFunctionContract(read2.value);
    return {
      ok: true,
      fiberId: read2.fiberId,
      fiberName: getFiberDisplayName$1(read2.fiber),
      source: getFiberSource$1(read2.fiber),
      propName: read2.propName,
      propNames,
      ...contract,
      nextStep: contract.isFunction ? "Read the component/owner source to determine the callback argument contract before fiber-invoke." : "This prop is not callable; do not fiber-invoke it."
    };
  }
  function isThenable(value) {
    return !!value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
  }
  function pickThisArg(fiber) {
    if (fiber.tag === REACT_TAG_CLASS_COMPONENT && fiber.stateNode != null) {
      return fiber.stateNode;
    }
    return void 0;
  }
  async function evalFiberInvoke(fiberId, propName, args, deps) {
    const read2 = readFiberProp(fiberId, propName, deps);
    if (!read2.ok) {
      const fiberName2 = read2.fiber ? getFiberDisplayName$1(read2.fiber) : null;
      return { ok: false, error: read2.error, fiberId: read2.fiberId, fiberName: fiberName2 };
    }
    const value = read2.value;
    if (typeof value !== "function") {
      return {
        ok: false,
        error: `prop ${read2.propName} is not a function`,
        fiberId: read2.fiberId,
        fiberName: getFiberDisplayName$1(read2.fiber),
        propName: read2.propName,
        propType: typeof value
      };
    }
    const requestedArgs = Array.isArray(args) ? args : [];
    const placeholders = requestedArgs.filter(isEventPlaceholder).length;
    if (placeholders > 1) {
      return {
        ok: false,
        error: `pass at most one {"$event": type} argument; got ${placeholders}`,
        fiberId: read2.fiberId,
        fiberName: getFiberDisplayName$1(read2.fiber),
        propName: read2.propName
      };
    }
    let eventReport = null;
    const invokeArgs = requestedArgs.map((arg) => {
      if (!isEventPlaceholder(arg)) return arg;
      const built = createSyntheticEvent(arg, read2.fiber);
      eventReport = built.report;
      return built.event;
    });
    const serializedArgs = () => deps.safeSerialize(requestedArgs, 0, /* @__PURE__ */ new Set());
    const fnLength = Number.isFinite(value.length) ? value.length : null;
    const eventFields = () => eventReport ? { event: eventReport } : {};
    const thisArg = pickThisArg(read2.fiber);
    let result;
    try {
      result = value.apply(thisArg, invokeArgs);
    } catch (e) {
      const err = e;
      const hint = !eventReport && fnLength !== null && fnLength > 0 && e instanceof TypeError ? `The callback may expect an event. If its source reads one, pass --args '[{"$event":"click"}]'.` : null;
      return {
        ok: false,
        error: (err == null ? void 0 : err.message) || String(e),
        stack: (err == null ? void 0 : err.stack) || null,
        threw: true,
        fiberId: read2.fiberId,
        fiberName: getFiberDisplayName$1(read2.fiber),
        propName: read2.propName,
        propType: "function",
        args: serializedArgs(),
        ...eventFields(),
        ...hint && { hint }
      };
    }
    const base = {
      ok: true,
      fiberId: read2.fiberId,
      fiberName: getFiberDisplayName$1(read2.fiber),
      propName: read2.propName,
      propType: "function",
      fnLength,
      invoked: true,
      args: serializedArgs()
    };
    if (isThenable(result)) {
      const timeoutMs = Math.max(1, Math.min(3e4, deps.awaitTimeoutMs ?? 2e3));
      try {
        const resolved = await Promise.race([
          Promise.resolve(result),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`async callback did not resolve within ${timeoutMs}ms`)), timeoutMs))
        ]);
        return { ...base, async: true, returnValue: deps.safeSerialize(resolved, 0, /* @__PURE__ */ new Set()), ...eventFields() };
      } catch (e) {
        const err = e;
        return {
          ok: false,
          async: true,
          error: (err == null ? void 0 : err.message) || String(e),
          stack: (err == null ? void 0 : err.stack) || null,
          threw: false,
          rejected: true,
          fiberId: read2.fiberId,
          fiberName: getFiberDisplayName$1(read2.fiber),
          propName: read2.propName,
          propType: "function",
          args: serializedArgs(),
          ...eventFields()
        };
      }
    }
    return { ...base, async: false, returnValue: deps.safeSerialize(result, 0, /* @__PURE__ */ new Set()), ...eventFields() };
  }
  function getFiberDisplayName(fiber) {
    if (!fiber) return "Unknown";
    const fromType = fiber.type;
    const fromElement = fiber.elementType;
    return fromType && (fromType.displayName || fromType.name) || fromElement && (fromElement.displayName || fromElement.name) || "Unknown";
  }
  function getFiberSource(fiber) {
    return getFiberSource$2(fiber);
  }
  function walkOwner(fiber, ownerIndex) {
    let current = fiber;
    let walked = 0;
    while (walked < ownerIndex && current) {
      current = current._debugOwner || null;
      walked++;
    }
    return current;
  }
  function evalFiberScheduleUpdate(fiberId, ownerIndex, deps) {
    const rememberedFiberId = deps.normalizeRememberedFiberId(fiberId);
    if (!rememberedFiberId) {
      return { ok: false, reason: "no-fiberId", error: "fiberId is required" };
    }
    let fiber = deps.getRememberedFiber(rememberedFiberId);
    if (!fiber) {
      return { ok: false, reason: "fiber-not-found", error: `fiber ${rememberedFiberId} not found`, fiberId: rememberedFiberId };
    }
    const idx = Number.isFinite(Number(ownerIndex)) ? Math.max(0, Number(ownerIndex) | 0) : 0;
    const target = walkOwner(fiber, idx);
    if (!target) {
      return {
        ok: false,
        reason: "owner-out-of-range",
        error: `ownerIndex ${idx} overshoots the owner chain for fiber ${rememberedFiberId}`,
        fiberId: rememberedFiberId,
        ownerIndex: idx
      };
    }
    const fiberName2 = getFiberDisplayName(target);
    const source = getFiberSource(target);
    const resolveSchedule = deps.getScheduleUpdate || getScheduleUpdate;
    const scheduleUpdate = resolveSchedule(deps.scope);
    if (!scheduleUpdate) {
      return {
        ok: false,
        reason: "no-scheduleUpdate",
        error: "no renderer.scheduleUpdate (production React build, or the DevTools-hook shim was not installed before react-dom evaluated)",
        fiberId: rememberedFiberId,
        fiberName: fiberName2,
        source,
        ownerIndex: idx
      };
    }
    try {
      scheduleUpdate(target);
    } catch (e) {
      const err = e;
      return {
        ok: false,
        reason: "scheduleUpdate-threw",
        error: (err == null ? void 0 : err.message) || String(e),
        stack: (err == null ? void 0 : err.stack) || null,
        fiberId: rememberedFiberId,
        fiberName: fiberName2,
        source,
        ownerIndex: idx
      };
    }
    return { ok: true, fiberId: rememberedFiberId, fiberName: fiberName2, source, ownerIndex: idx, scheduled: true };
  }
  function fnv1a(value) {
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < value.length; i++) {
      hash ^= BigInt(value.charCodeAt(i));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
  }
  function valueKind(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    if (value instanceof RegExp) return "regexp";
    if (value instanceof Map) return "map";
    if (value instanceof Set) return "set";
    if (typeof value === "object" && value && "$$typeof" in value) return "element";
    return typeof value;
  }
  function previewValue(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (typeof value === "string") return JSON.stringify(value.length > 100 ? value.slice(0, 100) + "…" : value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (typeof value === "function") return `[function:${value.name || "anonymous"}/${value.length}]`;
    if (typeof value === "symbol") return String(value);
    if (Array.isArray(value)) {
      const items = value.slice(0, 6).map((item) => {
        if (item === null || item === void 0 || ["string", "number", "boolean", "bigint"].includes(typeof item)) {
          return previewValue(item);
        }
        return `[${valueKind(item)}]`;
      });
      return `[${items.join(", ")}${value.length > 6 ? ", …" : ""}]`;
    }
    if (value instanceof Map) return `{Map:${value.size}}`;
    if (value instanceof Set) return `{Set:${value.size}}`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (typeof value === "object") {
      const object = value;
      if ("$$typeof" in object) {
        const type = object.type;
        const name = typeof type === "string" ? type : (type == null ? void 0 : type.displayName) || (type == null ? void 0 : type.name) || "element";
        return `<${name}>`;
      }
      let keys = [];
      try {
        keys = Object.keys(object);
      } catch {
        return "{unreadable}";
      }
      const shown = keys.slice(0, 6).map((key) => {
        let item;
        try {
          item = object[key];
        } catch {
          return `${key}:[error]`;
        }
        if (item === null || item === void 0 || ["string", "number", "boolean", "bigint"].includes(typeof item)) {
          return `${key}:${previewValue(item)}`;
        }
        return `${key}:[${valueKind(item)}]`;
      });
      return `{${shown.join(", ")}${keys.length > 6 ? ", …" : ""}}`;
    }
    return String(value);
  }
  function canonicalValue(value, seen, budget, depth = 0) {
    var _a2;
    if (budget.remaining-- <= 0 || depth > 12) {
      budget.truncated = true;
      return "[truncated]";
    }
    if (value === null) return "null";
    const type = typeof value;
    if (type === "undefined") return "undefined";
    if (type === "string") return `string:${value}`;
    if (type === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
    if (type === "boolean" || type === "bigint") return `${type}:${String(value)}`;
    if (type === "symbol") return `symbol:${String(value)}`;
    if (type === "function") {
      const fn = value;
      return `function:${fn.name || "anonymous"}:${fn.length}`;
    }
    const object = value;
    if (typeof object.nodeType === "number" && typeof object.nodeName === "string") {
      const element = object;
      return `dom:${object.nodeType}:${object.nodeName}:${String(element.id || "")}:${String(((_a2 = element.getAttribute) == null ? void 0 : _a2.call(element, "data-testid")) || "")}`;
    }
    if (object.window === object) return "[window]";
    const objectTag = Object.prototype.toString.call(object);
    if (objectTag === "[object Promise]" || objectTag === "[object WeakMap]" || objectTag === "[object WeakSet]") return objectTag;
    const seenId = seen.get(object);
    if (seenId != null) return `[ref:${seenId}]`;
    seen.set(object, seen.size + 1);
    if (Array.isArray(object)) {
      return `array:${object.length}:[${object.map((item) => canonicalValue(item, seen, budget, depth + 1)).join(",")}]`;
    }
    if (object instanceof Date) return `date:${object.toISOString()}`;
    if (object instanceof RegExp) return `regexp:${String(object)}`;
    if (object instanceof Map) {
      const entries = Array.from(object.entries()).map(
        ([key, item]) => `${canonicalValue(key, seen, budget, depth + 1)}=>${canonicalValue(item, seen, budget, depth + 1)}`
      ).sort();
      return `map:${object.size}:{${entries.join(",")}}`;
    }
    if (object instanceof Set) {
      const entries = Array.from(object.values()).map((item) => canonicalValue(item, seen, budget, depth + 1)).sort();
      return `set:${object.size}:{${entries.join(",")}}`;
    }
    if ("$$typeof" in object) {
      const elementType = object.type;
      const name = typeof elementType === "string" ? elementType : (elementType == null ? void 0 : elementType.displayName) || (elementType == null ? void 0 : elementType.name) || "element";
      return `element:${name}:${String(object.key ?? "")}:${canonicalValue(object.props, seen, budget, depth + 1)}`;
    }
    let keys;
    try {
      keys = Object.keys(object).sort();
    } catch {
      budget.truncated = true;
      return "[unreadable-object]";
    }
    const fields = [];
    for (const key of keys) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        break;
      }
      let item;
      try {
        item = object[key];
      } catch {
        item = "[getter-threw]";
      }
      fields.push(`${key}:${canonicalValue(item, seen, budget, depth + 1)}`);
    }
    const ctor = object.constructor && object.constructor !== Object ? object.constructor.name : "object";
    return `${ctor}:{${fields.join(",")}}`;
  }
  function fingerprintFiberProp(value) {
    const budget = { remaining: 1e4, truncated: false };
    const canonical = canonicalValue(value, /* @__PURE__ */ new Map(), budget);
    return {
      kind: valueKind(value),
      hash: fnv1a(canonical),
      preview: previewValue(value),
      truncated: budget.truncated
    };
  }
  function readSource(fiber) {
    return getFiberSourceCandidate(fiber);
  }
  function runtimeName(fiber, fallback) {
    const type = fiber.type;
    if (typeof type === "string") return type;
    const raw = (type == null ? void 0 : type.displayName) || (type == null ? void 0 : type.name);
    return typeof raw === "string" && raw !== "" ? raw : fallback;
  }
  function fiberToken(fiber, name, source) {
    const sourceKey = source ? `${source.fileName}:${source.lineNumber ?? ""}:${source.columnNumber ?? ""}` : "";
    return [String(fiber.tag ?? ""), name, String(fiber.key ?? ""), sourceKey].join("|");
  }
  function captureFiberState(options, deps) {
    var _a2, _b2;
    const maxFibers = Number.isFinite(Number(options == null ? void 0 : options.maxFibers)) ? Math.max(1, Math.floor(Number(options == null ? void 0 : options.maxFibers))) : 1e5;
    const fibers = [];
    let truncated = false;
    const stack = deps.getRootFibers().slice().reverse().map((root) => ({ fiber: root.current || root, parentPath: "root" }));
    const siblingOccurrences = /* @__PURE__ */ new Map();
    const visited = /* @__PURE__ */ new Set();
    while (stack.length) {
      const { fiber, parentPath } = stack.pop();
      if (visited.has(fiber) || fiber.alternate && visited.has(fiber.alternate)) continue;
      visited.add(fiber);
      if (fiber.alternate) visited.add(fiber.alternate);
      const name = deps.getDisplayName(fiber);
      let nextParentPath = parentPath;
      if (name) {
        if (fibers.length >= maxFibers) {
          truncated = true;
          break;
        }
        const source = readSource(fiber);
        const token = fiberToken(fiber, runtimeName(fiber, name), source);
        const occurrenceKey = `${parentPath}\0${token}`;
        const occurrence = siblingOccurrences.get(occurrenceKey) || 0;
        siblingOccurrences.set(occurrenceKey, occurrence + 1);
        const id = `${parentPath}/${fnv1a(token)}:${occurrence}`;
        const props = {};
        const memoizedProps = fiber.memoizedProps;
        if (memoizedProps && typeof memoizedProps === "object") {
          let propNames = [];
          try {
            propNames = Object.keys(memoizedProps).sort();
          } catch {
            propNames = [];
          }
          for (const propName of propNames) {
            let value;
            try {
              value = memoizedProps[propName];
            } catch {
              value = "[getter-threw]";
            }
            props[propName] = fingerprintFiberProp(value);
          }
        }
        fibers.push({
          id,
          token,
          name,
          key: fiber.key == null ? null : String(fiber.key),
          tag: Number.isFinite(Number(fiber.tag)) ? Number(fiber.tag) : null,
          source,
          props
        });
        nextParentPath = id;
      }
      const children = [];
      let child = fiber.child || null;
      while (child) {
        children.push(child);
        child = child.sibling || null;
      }
      for (let i = children.length - 1; i >= 0; i--) stack.push({ fiber: children[i], parentPath: nextParentPath });
    }
    return {
      version: 1,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      page: {
        url: ((_a2 = options == null ? void 0 : options.page) == null ? void 0 : _a2.url) == null ? null : String(options.page.url),
        title: ((_b2 = options == null ? void 0 : options.page) == null ? void 0 : _b2.title) == null ? null : String(options.page.title)
      },
      fiberCount: fibers.length,
      truncated,
      fibers
    };
  }
  function publicFiber(entry) {
    return { id: entry.id, name: entry.name, key: entry.key, source: entry.source };
  }
  function compareFiberStates(before, after, options) {
    if ((before == null ? void 0 : before.version) !== 1 || (after == null ? void 0 : after.version) !== 1 || !Array.isArray(before == null ? void 0 : before.fibers) || !Array.isArray(after == null ? void 0 : after.fibers)) {
      return { ok: false, error: "Two valid fiber state captures are required" };
    }
    const maxChanges = Number.isFinite(Number(options == null ? void 0 : options.maxChanges)) ? Math.max(1, Math.floor(Number(options == null ? void 0 : options.maxChanges))) : 200;
    new Map(before.fibers.map((entry) => [entry.id, entry]));
    const afterById = new Map(after.fibers.map((entry) => [entry.id, entry]));
    const matched = /* @__PURE__ */ new Map();
    const usedAfter = /* @__PURE__ */ new Set();
    for (const entry of before.fibers) {
      const candidate = afterById.get(entry.id);
      if (candidate && candidate.token === entry.token) {
        matched.set(entry, { after: candidate, confidence: "path" });
        usedAfter.add(candidate);
      }
    }
    const unmatchedBeforeByToken = /* @__PURE__ */ new Map();
    const unmatchedAfterByToken = /* @__PURE__ */ new Map();
    for (const entry of before.fibers) {
      if (matched.has(entry)) continue;
      const list = unmatchedBeforeByToken.get(entry.token) || [];
      list.push(entry);
      unmatchedBeforeByToken.set(entry.token, list);
    }
    for (const entry of after.fibers) {
      if (usedAfter.has(entry)) continue;
      const list = unmatchedAfterByToken.get(entry.token) || [];
      list.push(entry);
      unmatchedAfterByToken.set(entry.token, list);
    }
    for (const [token, beforeEntries] of unmatchedBeforeByToken) {
      const afterEntries = unmatchedAfterByToken.get(token);
      if (beforeEntries.length === 1 && (afterEntries == null ? void 0 : afterEntries.length) === 1) {
        matched.set(beforeEntries[0], { after: afterEntries[0], confidence: "unique-token" });
        usedAfter.add(afterEntries[0]);
      }
    }
    const allChanges = [];
    let changedFibers = 0;
    let propChanges2 = 0;
    for (const [beforeEntry, match] of matched) {
      const added = [];
      const removed = [];
      const changed = [];
      const names = /* @__PURE__ */ new Set([...Object.keys(beforeEntry.props), ...Object.keys(match.after.props)]);
      for (const name of Array.from(names).sort()) {
        const left = beforeEntry.props[name];
        const right = match.after.props[name];
        if (!left) added.push({ name, after: right });
        else if (!right) removed.push({ name, before: left });
        else if (left.hash !== right.hash || left.kind !== right.kind || left.truncated !== right.truncated) {
          changed.push({ name, before: left, after: right });
        }
      }
      const count = added.length + removed.length + changed.length;
      if (!count) continue;
      changedFibers++;
      propChanges2 += count;
      allChanges.push({
        kind: "props-changed",
        match: match.confidence,
        fiber: { before: publicFiber(beforeEntry), after: publicFiber(match.after) },
        props: { added, removed, changed }
      });
    }
    const removedFibers = before.fibers.filter((entry) => !matched.has(entry));
    const addedFibers = after.fibers.filter((entry) => !usedAfter.has(entry));
    for (const entry of addedFibers) {
      allChanges.push({ kind: "fiber-added", fiber: publicFiber(entry), propNames: Object.keys(entry.props) });
    }
    for (const entry of removedFibers) {
      allChanges.push({ kind: "fiber-removed", fiber: publicFiber(entry), propNames: Object.keys(entry.props) });
    }
    const rankChange = (change) => {
      var _a2, _b2, _c2, _d2, _e2, _f, _g;
      if (change.kind !== "props-changed") return change.kind === "fiber-added" ? 5 : 4;
      const propRows = [
        ...(((_a2 = change.props) == null ? void 0 : _a2.added) || []).map((row) => row.after),
        ...(((_b2 = change.props) == null ? void 0 : _b2.removed) || []).map((row) => row.before),
        ...(((_c2 = change.props) == null ? void 0 : _c2.changed) || []).flatMap((row) => [row.before, row.after])
      ].filter(Boolean);
      const complete = propRows.some((row) => !row.truncated) ? 100 : 0;
      const primitive = propRows.some((row) => ["string", "number", "boolean", "null", "undefined"].includes(row.kind)) ? 40 : 0;
      const sourced = ((_e2 = (_d2 = change.fiber) == null ? void 0 : _d2.after) == null ? void 0 : _e2.source) || ((_g = (_f = change.fiber) == null ? void 0 : _f.before) == null ? void 0 : _g.source) ? 20 : 0;
      return 10 + complete + primitive + sourced;
    };
    allChanges.sort((left, right) => rankChange(right) - rankChange(left));
    const changes = allChanges.slice(0, maxChanges);
    const captureTruncated = before.truncated || after.truncated;
    const changesTruncated = allChanges.length > changes.length;
    return {
      ok: true,
      before: { ...before.page, capturedAt: before.capturedAt },
      after: { ...after.page, capturedAt: after.capturedAt },
      summary: {
        beforeFibers: before.fibers.length,
        afterFibers: after.fibers.length,
        matchedFibers: matched.size,
        changedFibers,
        addedFibers: addedFibers.length,
        removedFibers: removedFibers.length,
        propChanges: propChanges2,
        returnedChanges: changes.length,
        captureTruncated,
        changesTruncated,
        truncated: captureTruncated || changesTruncated
      },
      changes
    };
  }
  function alreadyVisited(fiber, seen) {
    const alternate = fiber.alternate || null;
    return seen.has(fiber) || !!(alternate && seen.has(alternate));
  }
  function markVisited(fiber, seen) {
    seen.add(fiber);
    const alternate = fiber.alternate || null;
    if (alternate) seen.add(alternate);
  }
  function normalizeSource(fiber) {
    return describeFiberSource(fiber);
  }
  function summarizeDom(element) {
    var _a2, _b2;
    if (!element) return null;
    return {
      tag: ((_a2 = element.tagName) == null ? void 0 : _a2.toLowerCase()) || null,
      testId: ((_b2 = element.getAttribute) == null ? void 0 : _b2.call(element, "data-testid")) || null,
      text: element.textContent ? String(element.textContent).trim().slice(0, 120) : null
    };
  }
  function suspenseDetectedBy(fiber) {
    return fiber.tag === 13 ? "fiber-tag" : "display-name";
  }
  function describeBoundary(fiber, deps) {
    const error = describeErrorBoundary(fiber);
    if (error) {
      return {
        fiberId: String(deps.rememberFiber(fiber)),
        kind: "error",
        componentName: error.componentName,
        detectedBy: error.detectedBy,
        status: "unknown",
        source: normalizeSource(fiber),
        dom: summarizeDom(deps.getFiberDomNode(fiber))
      };
    }
    const suspense = describeSuspenseBoundary(fiber);
    if (!suspense) return null;
    return {
      fiberId: String(deps.rememberFiber(fiber)),
      kind: "suspense",
      componentName: suspense.componentName,
      detectedBy: suspenseDetectedBy(fiber),
      status: fiber.memoizedState == null ? "showing-content" : "showing-fallback",
      source: normalizeSource(fiber),
      dom: summarizeDom(deps.getFiberDomNode(fiber))
    };
  }
  function normalizeLimit(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(5e3, Math.floor(parsed))) : fallback;
  }
  function inspectDeclarativeBoundaryChain(fiber, max, deps) {
    if (!fiber) return { ok: false, error: "No fiber available" };
    const limit = normalizeLimit(max, 100);
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    let current = fiber;
    let distance = 0;
    let omitted = false;
    while (current && distance < MAX_BOUNDARY_FIBERS && !seen.has(current)) {
      seen.add(current);
      const boundary = describeBoundary(current, deps);
      if (boundary) {
        if (items.length < limit) items.push({ ...boundary, distance });
        else omitted = true;
      }
      current = current.return || null;
      distance += 1;
    }
    return {
      ok: true,
      count: items.length,
      scannedFibers: seen.size,
      truncated: omitted || !!current,
      items
    };
  }
  function inspectPageDeclarativeBoundaries(max, deps) {
    const limit = normalizeLimit(max, 1e3);
    const rawRoots = deps.getRootFibers();
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    let count = 0;
    let scannedFibers = 0;
    let rootsWithBoundaries = 0;
    let truncated = false;
    for (const rawRoot of rawRoots) {
      if (count >= limit) {
        truncated = true;
        break;
      }
      const root = (rawRoot == null ? void 0 : rawRoot.current) || rawRoot;
      if (!root || alreadyVisited(root, seen)) continue;
      const rootItems = [];
      const stack = [{ fiber: root, fiberDepth: 0, parentBoundary: null }];
      while (stack.length > 0) {
        if (count >= limit) {
          truncated = true;
          break;
        }
        const frame2 = stack.pop();
        const current = frame2.fiber;
        if (alreadyVisited(current, seen)) continue;
        markVisited(current, seen);
        scannedFibers += 1;
        let nextParentBoundary = frame2.parentBoundary;
        const summary = describeBoundary(current, deps);
        if (summary) {
          const node = {
            ...summary,
            fiberDepth: frame2.fiberDepth,
            distanceFromParent: frame2.parentBoundary ? frame2.fiberDepth - frame2.parentBoundary.fiberDepth : null,
            children: []
          };
          if (frame2.parentBoundary) frame2.parentBoundary.children.push(node);
          else rootItems.push(node);
          nextParentBoundary = node;
          count += 1;
        }
        if (current.sibling) {
          stack.push({
            fiber: current.sibling,
            fiberDepth: frame2.fiberDepth,
            parentBoundary: frame2.parentBoundary
          });
        }
        if (current.child) {
          stack.push({
            fiber: current.child,
            fiberDepth: frame2.fiberDepth + 1,
            parentBoundary: nextParentBoundary
          });
        }
      }
      if (rootItems.length > 0) {
        rootsWithBoundaries += 1;
        items.push(...rootItems);
      }
    }
    return {
      ok: true,
      count,
      scannedFibers,
      rootCount: rawRoots.length,
      rootsWithBoundaries,
      truncated,
      items
    };
  }
  const runtime = globalThis;
  const publishedApi = runtime.__AVALANCHE__;
  {
    const fromConfig = (_a = runtime.__CHIPPY_STARTUP_CONFIG) == null ? void 0 : _a.plugins;
    const fromGlobal = runtime.__CHIPPY_PLUGINS;
    if (Array.isArray(fromConfig) || Array.isArray(fromGlobal)) {
      selectPlugins([...fromConfig ?? [], ...fromGlobal ?? []]);
    }
    const packsFromConfig = (_b = runtime.__CHIPPY_STARTUP_CONFIG) == null ? void 0 : _b.packs;
    const packsFromGlobal = runtime.__CHIPPY_PACKS;
    if (Array.isArray(packsFromConfig) || Array.isArray(packsFromGlobal)) {
      runtime.__CHIPPY_PACK_RESULTS__ = registerPacks([...packsFromConfig ?? [], ...packsFromGlobal ?? []]);
    }
  }
  (function installDevtoolsShim() {
    var _a2;
    if (runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
    const hook = {
      supportsFiber: true,
      renderers: /* @__PURE__ */ new Map(),
      inject(renderer) {
        const id = (this.renderers.size || 0) + 1;
        this.renderers.set(id, renderer);
        return id;
      },
      onScheduleFiberRoot() {
      },
      onCommitFiberRoot() {
      },
      onCommitFiberUnmount() {
      },
      onPostCommitFiberRoot() {
      }
    };
    let shared;
    try {
      if (runtime.top && !runtime.top.__REACT_DEVTOOLS_GLOBAL_HOOK__) runtime.top.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
      shared = (_a2 = runtime.top) == null ? void 0 : _a2.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    } catch (_) {
    }
    runtime.__REACT_DEVTOOLS_GLOBAL_HOOK__ = shared || hook;
  })();
  const startupConfig = runtime.__CHIPPY_STARTUP_CONFIG;
  const __auto = !!((_c = startupConfig == null ? void 0 : startupConfig.avalanche) == null ? void 0 : _c.autoStart);
  let detector = null;
  let installed = false;
  const api = {
    install(options) {
      var _a2, _b2;
      try {
        (_b2 = (_a2 = getCommitMetricsAdapter()) == null ? void 0 : _a2.prepare) == null ? void 0 : _b2.call(_a2);
      } catch (_) {
      }
      if (detector) {
        try {
          detector.uninstall();
        } catch (_) {
        }
      }
      detector = createAvalancheDetector(options);
      console.log("[avalanche] start", { detectionMode: options && options.detectionMode || "default" });
      detector.install();
      installed = true;
      return { ok: true, detectionLevel: options && options.detectionMode || "default" };
    },
    uninstall() {
      console.log("[avalanche] stop");
      if (detector) detector.uninstall();
      installed = false;
      return { ok: true };
    },
    reset() {
      console.log("[avalanche] reset");
      if (detector) detector.reset();
      return { ok: true };
    },
    pause() {
      if (!detector) return { ok: false, error: "not installed" };
      detector.pause();
      return { ok: true };
    },
    resume() {
      if (!detector) return { ok: false, error: "not installed" };
      detector.resume();
      return { ok: true };
    },
    report(topN, sortBy, options) {
      if (!detector) return { ok: false, error: "not installed" };
      return detector.report(topN, sortBy, options);
    },
    exportLast(n) {
      if (!detector) return { ok: false, error: "not installed" };
      const r = detector.report(Number.POSITIVE_INFINITY);
      if (n != null && r.commits && Array.isArray(r.commits)) {
        return { ...r, commits: r.commits.slice(-n) };
      }
      return r;
    },
    componentTypesFor(sourceIds) {
      return detector ? detector.componentTypesFor(sourceIds) : [];
    },
    unnamedRenderedTypes() {
      return detector ? detector.unnamedRenderedTypes() : [];
    },
    componentTypesNamed(names) {
      return detector ? detector.componentTypesNamed(names) : [];
    },
    debugHook(sourceId, hookIndex, windowSize) {
      if (!detector) return { ok: false, error: "not installed" };
      const fn = detector.debugHook;
      if (typeof fn !== "function") return { ok: false, error: "debugHook unavailable" };
      return fn(sourceId, hookIndex, windowSize);
    },
    _debugRawHookEvents(componentName) {
      if (!detector) return { ok: false, error: "not installed" };
      const fn = detector._debugRawHookEvents;
      if (typeof fn !== "function") return { ok: false, error: "_debugRawHookEvents unavailable" };
      return fn(componentName);
    },
    status() {
      var _a2, _b2, _c2, _d2;
      let hasMetricsGlobal = false;
      try {
        hasMetricsGlobal = !!((_a2 = getCommitMetricsAdapter()) == null ? void 0 : _a2.isAvailable());
      } catch (_) {
      }
      let commitCount = 0;
      let networkRequests = 0;
      let perfEntries = 0;
      let renderedEvidence = null;
      let paused = false;
      let pausedAt = null;
      try {
        const counts = detector ? detector.counts() : null;
        if (counts) ({ commits: commitCount, networkRequests, perfEntries, renderedEvidence, capture: { paused, pausedAt } } = counts);
      } catch (_) {
      }
      const integrationMode = detector ? ((_b2 = detector.getIntegrationMode) == null ? void 0 : _b2.call(detector)) ?? "none" : "none";
      const detectionMode = installed && detector ? detector.getDetectionLevel() : null;
      const metricsAdapter = detector ? ((_c2 = detector.getMetricsAdapterId) == null ? void 0 : _c2.call(detector)) ?? null : ((_d2 = getCommitMetricsAdapter()) == null ? void 0 : _d2.id) ?? null;
      const packs2 = listPacks().map(({ id, label, instructions, extensions, compileErrors, initErrors }) => ({ id, label, instructions, extensions, compileErrors, initErrors }));
      let hooks = null;
      try {
        hooks = summarizeHookResults(detector == null ? void 0 : detector.hookResults());
      } catch (_) {
      }
      return { installed, paused, pausedAt, hasMetricsGlobal, commitCount, integrationMode, detectionMode, metricsAdapter, networkRequests, perfEntries, renderedEvidence, packs: packs2, hooks };
    },
    registerCommitMetricsAdapter,
    enablePlugins,
    registerPlugin,
    enableDefaultPlugins,
    listPlugins,
    registerPack,
    unregisterPack,
    listPacks,
    runPrePageHooks,
    DETECTION_LEVEL,
    replay: {
      replayComponentHooks,
      evalFiberHooks,
      fiberOnlyHookRecords,
      classifyHook,
      safeSerialize,
      getDispatcherRef,
      isDispatcherIdle,
      customHookPathFromFrames,
      customHookPathFromStack,
      readContextValueFromFiber,
      readHookValueFromNode,
      PRIMITIVE_HOOK_NAMES,
      replayErrorPayload,
      logReplayError
    },
    layoutLab: {
      getFiberKey,
      getFiber,
      getDisplayName,
      isUserComponent,
      getNearestFiber,
      getNearestComponent,
      getHookSummary,
      getOwnerChain,
      getOwnerFibers,
      getFiberDomNode,
      getReturnComponentChain,
      getReturnComponentFibers,
      describeSource,
      describeFiberSource,
      resolveFiberSource,
      describeFiberTarget,
      describeComponent,
      describeContext,
      registerContextProvider,
      getContextProviders,
      findBoundaryFibers,
      PROBE_INTENTS,
      normalizeProbeAnnotation,
      updateProbeAnnotation
    },
    bridge: {
      summarizeHookList,
      formatCounts,
      renderTreeText,
      renderCompactComponentText,
      evalDescribeComponent,
      readAvalancheStatus,
      evalAvalanche,
      evalAvalancheWithNames,
      evalElementDom,
      evalFiberProps,
      evalFiberPropValue,
      evalFindFibers,
      resolveFindFiberSources,
      warmFindFiberNames,
      readComponentName,
      resolveComponentOrigin,
      applyRecoveredOrigin,
      applyProductionBreadcrumbs,
      safeJson,
      scriptResultJson,
      runChippyScript,
      noteOwnWork,
      clearScriptOverlay: clearOverlay,
      measureComponentArea: (options) => measureComponentArea(options),
      areaWatch: { start: (options) => startAreaWatch(options), read: readAreaWatch, stop: stopAreaWatch },
      resolveOwnerFiber,
      getOwnerStackKind,
      findFiberByName,
      inspectFiberOwners,
      inspectFiberStructure,
      evalFiberInvoke,
      evalFiberPropContract,
      evalFiberScheduleUpdate,
      describeFiberSource,
      resolveFiberSource,
      captureFiberState,
      compareFiberStates,
      inspectDeclarativeBoundaryChain,
      inspectPageDeclarativeBoundaries
    }
  };
  if (__auto) {
    try {
      const requested2 = ((_d = startupConfig == null ? void 0 : startupConfig.avalanche) == null ? void 0 : _d.options) || {};
      const targetApi = publishedApi && typeof publishedApi.install === "function" ? publishedApi : api;
      const alreadyInstalled = !!(targetApi.status && targetApi.status().installed);
      if (!alreadyInstalled) {
        targetApi.install({
          detectionMode: requested2.detectionMode || "sources",
          historySize: ((_e = startupConfig == null ? void 0 : startupConfig.avalanche) == null ? void 0 : _e.max) || 1e3,
          captureFibers: requested2.captureFibers !== false
        });
      }
    } catch (e) {
    }
  }
  const iife = publishedApi ?? api;
  return iife;
})();
//# sourceMappingURL=avalanche.iife.js.map
