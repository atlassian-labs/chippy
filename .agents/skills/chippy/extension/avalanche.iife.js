this.__AVALANCHE__ = (function() {
  "use strict";
  var _a, _b, _c, _d, _e;
  const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const VALUE_OF = new Int8Array(128).fill(-1);
  for (let index = 0; index < DIGITS.length; index += 1) {
    VALUE_OF[DIGITS.charCodeAt(index)] = index;
  }
  function decodeVlq(field2) {
    const values = [];
    let value = 0;
    let shift = 0;
    for (let index = 0; index < field2.length; index += 1) {
      const code = field2.charCodeAt(index);
      const digit = code < 128 ? VALUE_OF[code] : -1;
      if (digit < 0) return values;
      const more = (digit & 32) !== 0;
      value += (digit & 31) << shift;
      if (more) {
        shift += 5;
        continue;
      }
      const negative = (value & 1) === 1;
      const magnitude = value >>> 1;
      values.push(negative ? magnitude === 0 ? -2147483648 : -magnitude : magnitude);
      value = 0;
      shift = 0;
    }
    return values;
  }
  function decodeMappings(mappings, sourceCount) {
    const lines = [];
    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let nameIndex = 0;
    for (const encodedLine of mappings.split(";")) {
      const segments = [];
      let generatedColumn = 0;
      for (const field2 of encodedLine === "" ? [] : encodedLine.split(",")) {
        const values = decodeVlq(field2);
        if (values.length < 4) {
          if (values.length > 0) {
            generatedColumn += values[0];
            segments.push({ generatedColumn, sourceIndex: null, originalLine: null, originalColumn: null, nameIndex: null });
          }
          continue;
        }
        generatedColumn += values[0];
        sourceIndex += values[1];
        originalLine += values[2];
        originalColumn += values[3];
        const named = values.length >= 5;
        if (named) nameIndex += values[4];
        if (sourceIndex >= 0 && sourceIndex < sourceCount) {
          segments.push({ generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex: named ? nameIndex : null });
        }
      }
      segments.sort((left, right) => left.generatedColumn - right.generatedColumn);
      lines.push(segments);
    }
    return lines;
  }
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
      lines: decodeMappings(raw.mappings, sources.length),
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
      const segments = map.lines[localLine - 1];
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
        for (const segment of map.lines[localLine - 1]) {
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
  const IDENTIFIER = "[A-Za-z_$][\\w$]*";
  const OWN_FUNCTION_NAME = new RegExp(`^(?:async\\s*)?function\\s*\\*?\\s*(${IDENTIFIER})\\s*\\(`);
  const OWN_CLASS_NAME = new RegExp(`^class\\s+(${IDENTIFIER})(?=[\\s{])`);
  const AUTHORED_OWN_NAME = new RegExp(
    `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)(${IDENTIFIER})`
  );
  const CALLEE = `(?:\\(\\s*0\\s*,\\s*${IDENTIFIER}(?:\\.${IDENTIFIER})*\\s*\\)|${IDENTIFIER}(?:\\.${IDENTIFIER})*)`;
  const GENERATED_BINDING = new RegExp(`(${IDENTIFIER})\\s*[=:]\\s*(?:${CALLEE}\\s*\\(\\s*)*$`);
  const AUTHORED_BINDING = new RegExp(
    `(?:^|[^\\w$.])(${IDENTIFIER})\\s*(?::[^=;{}()]*)?=\\s*(?:${CALLEE}\\s*(?:<[^()]*>)?\\s*\\(\\s*)*$`
  );
  const LEADING_IDENTIFIER = new RegExp(`^${IDENTIFIER}`);
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
    for (const [evidence, read] of candidates) {
      const name = read();
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
    const toPosition = (at) => {
      const { line, column } = positionOf(lineStarts, at);
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
    function resolve(type) {
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
        answer = resolve(fn).then((origin) => {
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
    return { resolve, peek, references, settle, stats };
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
  function ownName(value) {
    if (!value || typeof value !== "object" && typeof value !== "function") return null;
    const named = value;
    if (typeof named.displayName === "string" && named.displayName !== "") return named.displayName;
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
    const name = type.name;
    return typeof name === "string" && name !== "" ? name : null;
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
    const matches = /* @__PURE__ */ new Map();
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
      matches.set(tail, { url: url.href, length: tail.length });
    }
    const ranked = [...matches.values()].sort((a, b) => b.length - a.length).map((entry) => entry.url);
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
      const at = Number(lineDigits);
      const column = Number(columnDigits);
      if (!Number.isFinite(at) || !Number.isFinite(column) || at < 1) continue;
      frames.push({
        url,
        line: at,
        column,
        ...name !== void 0 && name !== "" ? { function: name } : {}
      });
    }
    return frames;
  }
  function isVendorPath(path) {
    return path.includes("node_modules") || path.includes("/.vite/deps/") || path.includes("/.yarn/");
  }
  function rawLocation(frame) {
    return { fileName: frame.url, lineNumber: frame.line, columnNumber: frame.column };
  }
  function locationFromOriginal(original) {
    return { fileName: original.source, lineNumber: original.line, columnNumber: original.column };
  }
  function writerLocationOf(frames, originalFor) {
    for (const frame of frames) {
      if (isVendorPath(frame.url)) continue;
      const original = originalFor(frame);
      if (original === null) return rawLocation(frame);
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
    async function locateFrame(frame) {
      const parsed = await mapsFor(frame.url);
      if (!parsed || parsed.maps.length === 0) return null;
      const original = originalPositionFor(parsed.maps, frame.line, frame.column);
      if (!original) return null;
      return {
        fileName: sourcePath(original.source, parsed.sourceBaseUrl),
        lineNumber: original.line,
        columnNumber: original.column
      };
    }
    async function locate(frames) {
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
        const chosen = located === null ? writerLocationOf([frame], () => null) : isVendorPath(located.fileName) ? null : located;
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
    for (const frame of parseStackFrames$1(stack)) {
      if (isVendorPath(frame.url)) continue;
      candidates.push(frame);
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
    return source && `<${source.fileName}:${source.lineNumber}>` || "Anonymous";
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
  const CS_RESTARTS = 2;
  const CS_UNMOUNTED_COMPONENTS = 8;
  const CS_UNMOUNTED_SUBTREES = 9;
  const MAX_DEPTH = 2;
  const MAX_ENTRIES = 8;
  const MAX_STRING = 200;
  function cut(text) {
    return text.length > MAX_STRING ? text.slice(0, MAX_STRING) + `…(${text.length})` : text;
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
    if (value instanceof RegExp) return cut(String(value));
    if (value instanceof Error) return cut(`[${value.name}: ${value.message}]`);
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
        return cut(value);
      case "bigint":
        return `${String(value)}n`;
      case "symbol":
        return cut(String(value));
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
      if (depth >= MAX_DEPTH) return `[Array(${object.length})]`;
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
    if (depth >= MAX_DEPTH) return `[${name}(${keys.length} keys)]`;
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
      ...(report.metricsByCommit || report.atlByCommit) && {
        metricsByCommit: report.metricsByCommit || report.atlByCommit,
        atlByCommit: report.metricsByCommit || report.atlByCommit
      },
      ...report.commitTimings && { commitTimings: report.commitTimings },
      ...report.networkRequests && { networkRequests: report.networkRequests.map((request) => ({ ...request })) },
      ...report.screenByCommit && { screenByCommit: report.screenByCommit },
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
      version: 8,
      // v8: networkRequests + meta.network; v7: meta.timeOrigin, absolute commit and action timestamps
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
        atlByCommit: metricsAvailable,
        ticks: renderTicks.available
      },
      renderTicks,
      network: (detectorConfig == null ? void 0 : detectorConfig.network) ?? { supported: false, enabled: false, windowStart: 0, requests: 0, dropped: 0, ignoredOwn: 0 },
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
      ...state2.screenByCommit && Object.keys(state2.screenByCommit).length > 0 && { screenByCommit: { ...state2.screenByCommit } },
      ...hasMetricsData && { metricsByCommit: state2.metricsByCommit, atlByCommit: state2.metricsByCommit },
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
    const owner = injected;
    if (typeof owner.H !== "undefined") return { owner, key: "H" };
    if ("current" in owner) return { owner, key: "current" };
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
      const { owner } = slot;
      ref = {
        get current() {
          return owner.H;
        },
        set current(value) {
          owner.H = value;
        }
      };
      modernRefs.set(owner, ref);
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
  function parseStackFrames(stack) {
    return stack.split("\n").slice(1).map((line) => {
      const m = line.match(/^\s*at\s+([^\s(]+)\s*\(([^)]+)\)/) || line.match(/^\s*at\s+()(.+)$/);
      if (!m) return null;
      const name = (m[1] || "").trim();
      const locRaw = (m[2] || "").trim();
      const tail = locRaw.match(/:(\d+):(\d+)\)?$/);
      const loc = tail ? `${tail[1]}:${tail[2]}` : locRaw;
      return name ? { name, loc } : null;
    }).filter((f) => !!f);
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
    const wrapper = frames.findIndex((frame) => frame.name === "atlDispatcherHook" || frame.name.endsWith(".atlDispatcherHook"));
    for (const { name } of wrapper >= 0 ? frames.slice(wrapper + 1) : frames) {
      if (!name) continue;
      if (isReactInternalFrameName(name)) continue;
      if (isHookFrameName(name)) continue;
      return name;
    }
    return "Unknown";
  }
  function createDebugRender(options = {}) {
    const maxEventsPerComponent = options.maxEventsPerComponent ?? 600;
    const eventsByComponent = /* @__PURE__ */ new Map();
    const patchedDispatchers = /* @__PURE__ */ new WeakMap();
    let installed2 = false;
    let originalDescriptor = void 0;
    let dispatcherSlot = null;
    let lastSeenDispatcher = null;
    function record(primitive, args) {
      const stack = new Error().stack || "";
      const frames = parseStackFrames(stack);
      const componentName = deriveComponentName(frames);
      const event = {
        primitive,
        stack,
        frames,
        componentName,
        args
      };
      const list = eventsByComponent.get(componentName) || [];
      list.push(event);
      if (list.length > maxEventsPerComponent) {
        list.splice(0, list.length - maxEventsPerComponent);
      }
      eventsByComponent.set(componentName, list);
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
      const { owner, key } = slot;
      patchDispatcher(owner[key]);
      lastSeenDispatcher = owner[key];
      originalDescriptor = Object.getOwnPropertyDescriptor(owner, key) || null;
      let stored = owner[key];
      try {
        Object.defineProperty(owner, key, {
          configurable: true,
          get() {
            return stored;
          },
          set(next) {
            stored = next;
            if (next !== lastSeenDispatcher) {
              lastSeenDispatcher = next;
              patchDispatcher(next);
            }
          }
        });
      } catch (e) {
        dispatcherSlot = null;
        return { ok: false, reason: "cannot define property on ReactCurrentDispatcher" };
      }
      installed2 = true;
      return { ok: true };
    }
    function uninstall() {
      if (!installed2) return;
      if (dispatcherSlot) {
        const { owner, key } = dispatcherSlot;
        try {
          if (originalDescriptor) {
            Object.defineProperty(owner, key, originalDescriptor);
          } else {
            Object.defineProperty(owner, key, {
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
      installed2 = false;
      dispatcherSlot = null;
      originalDescriptor = void 0;
      lastSeenDispatcher = null;
    }
    function reset() {
      eventsByComponent.clear();
    }
    function rawEvents(componentName) {
      return (eventsByComponent.get(componentName) || []).slice();
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
      for (const list of eventsByComponent.values()) totalCapturedEvents += list.length;
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
  function isChippyUi(node) {
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
  function createInteractionCapture(options = {}) {
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
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.some(isChippyUi)) return;
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
      uninstall() {
        if (!installed2 || typeof document === "undefined") return;
        for (const name of eventNames()) document.removeEventListener(name, capture, true);
        installed2 = false;
      },
      reset() {
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
  const round$5 = (value) => Math.round(value * 10) / 10;
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
      if (isChippyAssetUrl(entry.name)) return;
      if (entry.initiatorType === "fetch" && isOwnRequest(entry.name)) {
        ignoredOwn += 1;
        return;
      }
      requests.push({
        id: nextId++,
        url: entry.name.length > MAX_URL_LENGTH ? entry.name.slice(0, MAX_URL_LENGTH) : entry.name,
        initiatorType: entry.initiatorType || "other",
        startTime: round$5(entry.startTime),
        endTime: round$5(endTime),
        duration: round$5(endTime - entry.startTime),
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
      reset() {
        flush();
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
          windowStart: round$5(windowStart),
          requests: requests.length,
          dropped,
          ignoredOwn
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
    function fail2(session, error) {
      session.result.errorCount += 1;
      if (session.result.errors.length < MAX_RECORDED_ERRORS) session.result.errors.push(error);
    }
    function open(hooks, runStart) {
      const session = {
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
      sessions.set(hooks, session);
      if (runStart && hooks.onStart) {
        try {
          session.result.start = toEvidence(hooks.onStart(session.context));
        } catch (error) {
          fail2(session, { phase: "start", message: messageOf(error) });
        }
      }
      return session;
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
        for (const session of current()) {
          const { hooks, context, result } = session;
          context.commits = commits;
          if (!hooks.onStep || result.stepDisabled) continue;
          context.commit = commit;
          try {
            const value = toEvidence(hooks.onStep(context));
            if (value !== void 0) result.steps[commit.id] = value;
          } catch (error) {
            fail2(session, { phase: "step", commitId: commit.id, message: messageOf(error) });
            session.stepFailures += 1;
            if (session.stepFailures >= MAX_STEP_FAILURES) result.stepDisabled = true;
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
        for (const session of live) {
          const { hooks, context, result } = session;
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
  function cellSizeFor(clip) {
    const area = rectArea(clip);
    return Math.max(1, Math.ceil(Math.sqrt(area / MAX_CELLS)));
  }
  function createAreaGrid(clip, cell = cellSizeFor(clip)) {
    const cols = Math.max(0, Math.ceil((clip.right - clip.left) / cell));
    const rows = Math.max(0, Math.ceil((clip.bottom - clip.top) / cell));
    const bits = new Uint8Array(cols * rows);
    let covered = 0;
    function add(rect) {
      const r = intersectRect(rect, clip);
      if (!r) return;
      const c0 = Math.max(0, Math.round((r.left - clip.left) / cell));
      const c1 = Math.min(cols, Math.round((r.right - clip.left) / cell));
      const r0 = Math.max(0, Math.round((r.top - clip.top) / cell));
      const r1 = Math.min(rows, Math.round((r.bottom - clip.top) / cell));
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
      const full = rectArea(clip);
      return Math.min(full, covered * cell * cell);
    }
    return { clip, cell, add, area };
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
  function visiblePropsChanged(prev, next) {
    if (prev === next) return false;
    if (!prev || !next || typeof prev !== "object" || typeof next !== "object") return true;
    const a = prev;
    const b = next;
    for (const key of /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "ref" || key === "key") continue;
      const x = a[key];
      const y = b[key];
      if (Object.is(x, y)) continue;
      if (typeof x === "function" || typeof y === "function") continue;
      if (key === "children") {
        const textual = (v) => typeof v === "string" || typeof v === "number";
        if (textual(x) || textual(y)) return true;
        continue;
      }
      if (key === "style" || key === "dangerouslySetInnerHTML") {
        if (shallowDiffers(x, y)) return true;
        continue;
      }
      return true;
    }
    return false;
  }
  function shallowDiffers(x, y) {
    if (!x || !y || typeof x !== "object" || typeof y !== "object") return !Object.is(x, y);
    const a = x;
    const b = y;
    const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!Object.is(a[key], b[key])) return true;
    return false;
  }
  function findChangedHosts(root, limit = MAX_NODES_PER_COMMIT) {
    const found = [];
    let truncated = false;
    const push = (fiber, removed) => {
      if (found.length >= limit) {
        truncated = true;
        return;
      }
      const node = fiber.stateNode;
      if (isNode(node)) found.push({ node, fiber, removed });
    };
    const collectTop = (start, removed) => {
      const stack2 = [start];
      while (stack2.length) {
        const fiber = stack2.pop();
        if (isHost(fiber.tag)) {
          push(fiber, removed);
          continue;
        }
        for (let child = fiber.child; child; child = child.sibling) stack2.push(child);
      }
    };
    const stack = root.child ? [root.child] : [];
    while (stack.length && !truncated) {
      const fiber = stack.pop();
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.alternate === null) {
        const hiddenMount = fiber.tag === OFFSCREEN && !!fiber.memoizedState;
        if (!hiddenMount) collectTop(fiber, false);
        continue;
      }
      if (((fiber.flags | fiber.subtreeFlags) & MUTATION_MASK) === 0) continue;
      if ((fiber.flags & ChildDeletion) !== 0 && fiber.deletions) {
        for (const deleted of fiber.deletions) collectTop(deleted, true);
      }
      if ((fiber.flags & Placement) !== 0) {
        collectTop(fiber, false);
        continue;
      }
      if (fiber.tag === OFFSCREEN && (fiber.flags & Visibility) !== 0) {
        const hidden = !!fiber.memoizedState;
        for (let child = fiber.child; child; child = child.sibling) collectTop(child, hidden);
        continue;
      }
      if (isHost(fiber.tag) && (fiber.flags & Update) !== 0 && fiber.alternate) {
        const changed = fiber.tag === HOST_TEXT ? fiber.memoizedProps !== fiber.alternate.memoizedProps : visiblePropsChanged(fiber.alternate.memoizedProps, fiber.memoizedProps);
        if (changed) {
          push(fiber, false);
          continue;
        }
      }
      if (fiber.child) stack.push(fiber.child);
    }
    return { found, truncated };
  }
  function regionLabel(node, fiber) {
    var _a2, _b2, _c2;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const testId = (_b2 = (_a2 = element == null ? void 0 : element.closest) == null ? void 0 : _a2.call(element, "[data-testid]")) == null ? void 0 : _b2.getAttribute("data-testid");
    if (testId) return testId;
    for (let f = fiber.return; f; f = f.return) {
      if (isComponentFiber$1(f.tag)) return getComponentName(f);
    }
    return ((_c2 = element == null ? void 0 : element.tagName) == null ? void 0 : _c2.toLowerCase()) || "unknown";
  }
  const round$4 = (n) => Math.round(n);
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
  function createScreenCapture(options = {}, geometry = domScreenGeometry) {
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
          const label = regionLabel(measured, fiber);
          regions.set(label, (regions.get(label) || 0) + area2);
        }
      }
      if (rects.length === 0) return;
      const full = Math.max(1, rectArea(viewport));
      const area = round$4(changed.area());
      const removedArea = round$4(removed.area());
      rects.sort((a, b) => b.area - a.area);
      byCommit[commitId] = {
        viewport: [round$4(viewport.right - viewport.left), round$4(viewport.bottom - viewport.top)],
        area,
        removedArea,
        share: Math.min(1, Math.round((area + removedArea) / full * 1e3) / 1e3),
        rects: rects.slice(0, MAX_RECTS_PER_COMMIT).map(({ rect }) => [round$4(rect.left), round$4(rect.top), round$4(rect.right), round$4(rect.bottom)]),
        regions: [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_REGIONS).map(([label, regionArea]) => ({ label, area: round$4(Math.min(regionArea, full)) })),
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
  function entryFor(owner, via) {
    if (!owner || typeof owner !== "object") return null;
    const fiber = owner;
    if (typeof fiber.tag === "number") {
      const source = getFiberSourceCandidate(fiber);
      const props2 = pickLocationProps(fiber.memoizedProps);
      return {
        via,
        name: getComponentName(fiber),
        ...source && { source: { fileName: source.fileName, lineNumber: source.lineNumber } },
        ...props2 && { props: props2 }
      };
    }
    const info = owner;
    if (typeof info.name !== "string") return null;
    const props = pickLocationProps(info.props);
    return { via, name: info.name, ...props && { props } };
  }
  function nextOwner(owner) {
    if (!owner || typeof owner !== "object") return null;
    const value = owner;
    return typeof value.tag === "number" ? value._debugOwner ?? null : value.owner ?? null;
  }
  function describeSuspenseLocation(boundary, parents = LOCATION_PARENTS, owners = LOCATION_OWNERS) {
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
      const entry = entryFor(f, "parent");
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
      const entry = entryFor(o, "owner");
      if (!entry) continue;
      chain.push(entry);
      remember(o, entry);
      n++;
    }
    const props = fiber.memoizedProps || {};
    const name = typeof props.name === "string" ? props.name : typeof fiber.key === "string" ? fiber.key : void 0;
    const fallback = props.fallback && typeof props.fallback === "object" ? nameOfType(props.fallback.type) : null;
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
    function attachAsyncDispatcher(owner) {
      const previous = Object.getOwnPropertyDescriptor(owner, "A");
      if (previous && previous.configurable === false) return null;
      let stored = previous && "value" in previous ? previous.value : void 0;
      const read = (previous == null ? void 0 : previous.get) ? () => previous.get.call(owner) : () => stored;
      let outer = void 0;
      function set(next) {
        const before = read();
        if (previous == null ? void 0 : previous.set) previous.set.call(owner, next);
        else stored = next;
        if (sliceStart < 0) {
          outer = before;
          openSlice();
        } else if (next === outer) {
          closeSlice();
        }
      }
      try {
        Object.defineProperty(owner, "A", {
          configurable: true,
          enumerable: (previous == null ? void 0 : previous.enumerable) ?? true,
          get: read,
          set
        });
      } catch (_) {
        return null;
      }
      return () => {
        const current = Object.getOwnPropertyDescriptor(owner, "A");
        if ((current == null ? void 0 : current.set) !== set) return;
        const value = read();
        if ((previous == null ? void 0 : previous.get) || (previous == null ? void 0 : previous.set)) Object.defineProperty(owner, "A", previous);
        else Object.defineProperty(owner, "A", { configurable: true, enumerable: (previous == null ? void 0 : previous.enumerable) ?? true, writable: true, value });
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
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
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
      historySize = 1
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
        __publicField(this, "idMap", /* @__PURE__ */ new WeakMap());
        __publicField(this, "typeToId", /* @__PURE__ */ new WeakMap());
        __publicField(this, "instanceCounters", /* @__PURE__ */ new Map());
        __publicField(this, "nextTypeId", 1);
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
      clear() {
        this.instanceCounters.clear();
        this.typeToId = /* @__PURE__ */ new WeakMap();
        this.nextTypeId = 1;
      }
    }
    const sourceIdManager = new StableSourceIdManager();
    const debugRender = createDebugRender();
    const interactionCapture = createInteractionCapture(options);
    const networkCapture = createNetworkCapture(options);
    const screenCapture = createScreenCapture(options);
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
    function isDebugInternalFrame(frame, componentName) {
      var _a2, _b2;
      const name = frame.name || "";
      return !!((_b2 = (_a2 = metricsAdapter ?? resolveMetricsAdapter()) == null ? void 0 : _a2.frameFilters) == null ? void 0 : _b2.includes(name)) || name === "record" || name === componentName || name.includes("react-dom") || name.includes("renderWithHooks") || name.includes("mount") || name.includes("update");
    }
    function parentFramesForEvent(event, componentName) {
      return event.frames.filter((frame) => !isDebugInternalFrame(frame, componentName));
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
      screenByCommit: screenCapture.byCommit,
      renderedByCommit: {}
    };
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
    function summarizePropValue(value) {
      const isArray = Array.isArray(value);
      const type = value === null ? "null" : isArray ? "array" : typeof value;
      const isFunction = typeof value === "function";
      const isNull = value === null;
      const isPrimitive = value == null || type === "string" || type === "number" || type === "boolean" || type === "undefined" || type === "symbol" || type === "bigint";
      const primitiveDisplay = isPrimitive ? String(value) : void 0;
      const summary = {
        type,
        isArray,
        isFunction,
        isNull,
        preview: primitiveDisplay || (isFunction ? "function" : isArray ? `array(${value.length})` : "object")
      };
      if (primitiveDisplay !== void 0) {
        summary.display = primitiveDisplay;
      }
      if (typeof value === "string" || isArray) {
        summary.length = value.length;
      }
      if (isArray) {
        summary.sample = value.slice(0, 3).map((item) => summarizePropValue(item).preview);
      } else if (value && typeof value === "object") {
        const keys = Object.keys(value).slice(0, 5);
        summary.keysTop = keys;
        summary.length = Object.keys(value).length;
        if (keys.length > 0) {
          summary.preview = `object{${keys.join(",")}}`;
        }
      } else if (isFunction) {
        const fn = value;
        summary.preview = fn.name ? `function ${fn.name}` : "function";
      }
      return summary;
    }
    function diffProps(prevProps, currentProps) {
      const changes = [];
      const prev = prevProps && typeof prevProps === "object" ? prevProps : {};
      const current = currentProps && typeof currentProps === "object" ? currentProps : {};
      const keys = /* @__PURE__ */ new Set([...Object.keys(prev), ...Object.keys(current)]);
      keys.forEach((name) => {
        const prevHas = Object.prototype.hasOwnProperty.call(prev, name);
        const currentHas = Object.prototype.hasOwnProperty.call(current, name);
        const prevValue = prev[name];
        const currentValue = current[name];
        if (!prevHas && currentHas) {
          changes.push({ name, kind: "added", prev: summarizePropValue(void 0), current: summarizePropValue(currentValue) });
        } else if (prevHas && !currentHas) {
          changes.push({ name, kind: "removed", prev: summarizePropValue(prevValue), current: summarizePropValue(void 0) });
        } else if (Object.is(prevValue, currentValue)) ;
        else if (prevValue !== null && currentValue !== null && (typeof prevValue === "object" || typeof prevValue === "function" || typeof currentValue === "object" || typeof currentValue === "function")) {
          changes.push({ name, kind: "ref-changed", prev: summarizePropValue(prevValue), current: summarizePropValue(currentValue) });
        } else {
          changes.push({ name, kind: "scalar-changed", prev: summarizePropValue(prevValue), current: summarizePropValue(currentValue) });
        }
      });
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
                      name: getComponentName(df),
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
              let labelFiber = deleted;
              if (!isComponentFiber$1(labelFiber.tag)) {
                const stack = [labelFiber];
                labelFiber = null;
                while (stack.length) {
                  const f = stack.pop();
                  if (isComponentFiber$1(f.tag)) {
                    labelFiber = f;
                    break;
                  }
                  if (f.child) stack.push(f.child);
                  if (f.sibling) stack.push(f.sibling);
                }
              }
              if (labelFiber) {
                const counts = countUnmountedComponentSubtree(deleted);
                const fiberKey = labelFiber.key;
                perCommit.unmountSamples.push({
                  name: getComponentName(labelFiber),
                  key: fiberKey == null ? null : String(fiberKey),
                  depth,
                  count: counts.components,
                  source: summarizeFiberSource(labelFiber),
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
              location: describeSuspenseLocation(fiber),
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
            const existingRenderEvidenceIndex = perCommit.rendered.findIndex(
              (entry) => entry.sourceId === componentSourceId
            );
            const initialRenderEvidence = {
              sourceId: componentSourceId,
              name: getComponentName(fiber),
              depth,
              parentSourceId,
              ownerSourceId,
              isSelfSource: false,
              propChanges: fiber.alternate ? diffProps(fiber.alternate.memoizedProps, fiber.memoizedProps) : [],
              hasPropChanges: false,
              trasherCounts: { effects: 0, callbacks: 0, memos: 0 }
            };
            initialRenderEvidence.hasPropChanges = initialRenderEvidence.propChanges.length > 0;
            if (existingRenderEvidenceIndex >= 0) {
              perCommit.rendered[existingRenderEvidenceIndex] = initialRenderEvidence;
            } else {
              perCommit.rendered.push(initialRenderEvidence);
            }
            if (enableAmplifiers) {
              let hook = fiber.memoizedState;
              let hookIndex = 0;
              while (hook) {
                const ms = hook.memoizedState;
                if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
                  const result = ms[0];
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
            const renderedEntry = perCommit.rendered.find((entry) => entry.sourceId === componentSourceId);
            if (renderedEntry) {
              renderedEntry.ownerSourceId = ownerSourceId;
              renderedEntry.isSelfSource = isRealSource && changedIndices.length > 0;
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
                  const renderedEntry2 = perCommit.rendered.find((entry) => entry.sourceId === amplifierSourceId);
                  if (renderedEntry2) {
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
        state2.renderedByCommit[state2.commits] = perCommit.rendered;
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
    function resetState() {
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
      for (const key of Object.keys(state2.renderedByCommit)) {
        delete state2.renderedByCommit[Number(key)];
      }
      interactionCapture.reset();
      networkCapture.reset();
      screenCapture.reset();
      paintTracker.reset();
      hookRunner.start();
      boundaryIds = /* @__PURE__ */ new WeakMap();
      nextBoundaryId = 1;
      state2.lastMetricsSnapshot = captureMetricsSnapshot();
      state2.lastCommitEndTime = performance.now();
      renderTicks.reset();
      sourceIdManager.clear();
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
        interactionCapture.install();
        networkCapture.install();
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
          if (!fiber) return;
          const counts = countUnmountedComponentSubtree(fiber);
          pendingDevtoolsUnmounts.components += counts.components;
          pendingDevtoolsUnmounts.subtrees += counts.subtrees;
          if (counts.components > 0 && pendingDevtoolsUnmountSamples.length < 30) {
            let labelFiber = fiber;
            if (!isComponentFiber$1(labelFiber.tag)) {
              const stack = [labelFiber];
              labelFiber = null;
              while (stack.length) {
                const f = stack.pop();
                if (isComponentFiber$1(f.tag)) {
                  labelFiber = f;
                  break;
                }
                if (f.child) stack.push(f.child);
                if (f.sibling) stack.push(f.sibling);
              }
            }
            if (labelFiber) {
              const fiberKey = labelFiber.key;
              pendingDevtoolsUnmountSamples.push({
                name: getComponentName(labelFiber),
                key: fiberKey == null ? null : String(fiberKey),
                depth: null,
                count: counts.components,
                source: summarizeFiberSource(labelFiber),
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
        commitSurface.reset();
        pendingDevtoolsUnmounts = { components: 0, subtrees: 0 };
        pendingDevtoolsUnmountSamples = [];
        devtoolsHookPrev = void 0;
        devtoolsUnmountPrev = void 0;
        devtoolsHookCreatedByUs = false;
        integrationMode = "none";
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
        const report = buildReport(state2, thrashMode, topN, sortBy, reportOptions, {
          effectThrashMode,
          captureFibers,
          historySize,
          detectionLevel,
          integrationMode,
          renderTicks: renderTicks.status(),
          network: networkCapture.status()
        });
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
      /** Id of the commit metrics adapter resolved on install, or null. */
      getMetricsAdapterId() {
        return (metricsAdapter == null ? void 0 : metricsAdapter.id) ?? null;
      },
      /** Plugin hook results (runs each set's onEnd), without building a report. */
      hookResults() {
        return hookRunner.collect();
      },
      /** Commit and network request counts, without building a report. */
      counts() {
        networkCapture.flush();
        return { commits: state2.commits, networkRequests: networkCapture.requests.length };
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
    const ms = hookNode.memoizedState;
    const queue = hookNode.queue;
    const base = { index };
    if (queue && typeof queue.dispatch === "function") {
      return { ...base, tag: "State", value: safeSerialize(ms, 0, /* @__PURE__ */ new Set()) };
    }
    if (isEffectNode(ms)) {
      const m = ms;
      return {
        ...base,
        tag: "Effect",
        deps: Array.isArray(m.deps) ? "[array:" + m.deps.length + "]" : m.deps === null ? "null" : String(m.deps),
        hasCleanup: typeof m.destroy === "function"
      };
    }
    if (!queue && ms !== null && typeof ms === "object" && Object.prototype.hasOwnProperty.call(ms, "current")) {
      return { ...base, tag: "Ref", current: safeSerialize(ms.current, 0, /* @__PURE__ */ new Set()) };
    }
    if (!queue && Array.isArray(ms) && ms.length === 2 && (Array.isArray(ms[1]) || ms[1] === null)) {
      const arr = ms;
      const depsTag = arr[1] === null ? "null" : "[array:" + arr[1].length + "]";
      return {
        ...base,
        tag: "Memo",
        value: typeof arr[0] === "function" ? "[function" + (arr[0].name ? ":" + arr[0].name : "") + "]" : safeSerialize(arr[0], 0, /* @__PURE__ */ new Set()),
        deps: depsTag
      };
    }
    if (queue || ms === null || typeof ms !== "object" || isUnclaimedObject()) {
      return { ...base, tag: "Value", value: safeSerialize(ms, 0, /* @__PURE__ */ new Set()) };
    }
    return {
      ...base,
      tag: "Unknown",
      hasQueue: !!queue,
      value: safeSerialize(ms, 0, /* @__PURE__ */ new Set())
    };
  }
  function isEffectNode(ms) {
    if (!ms || typeof ms !== "object") return false;
    const m = ms;
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
      const owner = currentDebugOwner(frames);
      for (let i = records.length - 1; i >= 0; i--) {
        const rec = records[i];
        const tail = rec.path && rec.path.length ? rec.path[rec.path.length - 1].name : componentName;
        if (tail === owner) {
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
  const SUSPENSE_TAG$1 = 13;
  const CLASS_COMPONENT_TAG$1 = 1;
  function fiberTag$1(fiber) {
    return fiber.tag;
  }
  function describeErrorBoundary(fiber) {
    var _a2;
    const componentName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
    const type = fiber.type;
    const hasLifecycle = !!type && (typeof type.getDerivedStateFromError === "function" || typeof ((_a2 = type.prototype) == null ? void 0 : _a2.componentDidCatch) === "function");
    if (hasLifecycle && (fiberTag$1(fiber) === CLASS_COMPONENT_TAG$1 || fiberTag$1(fiber) === void 0)) {
      return { componentName: componentName || "ErrorBoundary", detectedBy: "lifecycle" };
    }
    if (componentName && /ErrorBoundary$/.test(componentName)) {
      return { componentName, detectedBy: "name" };
    }
    return null;
  }
  function describeSuspenseBoundary(fiber) {
    const displayName = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
    const isSuspense = fiberTag$1(fiber) === SUSPENSE_TAG$1 || displayName === "Suspense" || displayName === "SuspenseComponent" || displayName === "SuspenseList";
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
        display.fields[kind] = [...display.fields[kind] || [], ...fields.filter((field2) => field2.value != null && field2.value !== "")];
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
  const DEFAULT_METRICS_SLOT = "__ATL_REACT_METRICS";
  const METRICS_COUNTER_KEYS = [
    "mountWorkCount",
    "updateWorkCount",
    "commitWorkCount",
    "interruptedWorkCount",
    "priorityInterruptedWorkCount",
    "externalStoreRestartCount",
    "renderRootSyncCount",
    "renderRootConcurrentCount",
    "componentWorkCount",
    "componentMountWorkCount",
    "componentUpdateWorkCount",
    "componentRenderWithHooksCount",
    "finishClassComponentCount",
    "domWorkCount",
    "totalTickCount",
    "totalCommitCount",
    "contextUpdateCount",
    "legacyContextUpdateCount"
  ];
  const ACCESSOR_KEYS = [...METRICS_COUNTER_KEYS, "totalRestarts", "totalPerformedWork"];
  function createZeroMetrics() {
    const metrics = {};
    for (const key of METRICS_COUNTER_KEYS) metrics[key] = 0;
    metrics.setStateCount = 0;
    return metrics;
  }
  function isAllZero(value) {
    if (!value || typeof value !== "object") return true;
    const record = value;
    for (const key of ACCESSOR_KEYS) if ((record[key] || 0) !== 0) return false;
    return true;
  }
  function isSlotHostLocked(target, slotName = DEFAULT_METRICS_SLOT) {
    const existing = Object.getOwnPropertyDescriptor(target, slotName);
    return !!existing && (existing.configurable === false || typeof existing.get === "function");
  }
  function protectMetricsSlot(target, metrics, slotName = DEFAULT_METRICS_SLOT) {
    try {
      const existing = Object.getOwnPropertyDescriptor(target, slotName);
      if (existing && existing.configurable === false) return;
      Object.defineProperty(target, slotName, { configurable: true, enumerable: true, writable: true, value: metrics });
    } catch {
      try {
        target[slotName] = metrics;
      } catch {
      }
    }
  }
  function seedMetricsSlot(target, slotName = DEFAULT_METRICS_SLOT) {
    const metrics = createZeroMetrics();
    try {
      target[slotName] = metrics;
    } catch {
    }
    protectMetricsSlot(target, metrics, slotName);
    return metrics;
  }
  function installMetricsAccessor(target, slotName = DEFAULT_METRICS_SLOT) {
    try {
      const existing = Object.getOwnPropertyDescriptor(target, slotName);
      if (existing && existing.configurable === false) return false;
      let live = existing && typeof existing.get === "function" ? target[slotName] : existing == null ? void 0 : existing.value;
      if (!live || typeof live !== "object") {
        live = { onCommitFiberRoot: null };
        for (const key of ACCESSOR_KEYS) live[key] = 0;
      }
      Object.defineProperty(target, slotName, {
        configurable: true,
        enumerable: true,
        get() {
          return live;
        },
        set(next) {
          if (next === void 0 || next === null || isAllZero(next)) return;
          live = next;
        }
      });
      return true;
    } catch {
      return false;
    }
  }
  const ATL_DISPATCHER_FRAME = "atlDispatcherHook";
  const num = (snapshot, key) => snapshot[key] ?? 0;
  const diff = (before, after, key) => num(after, key) - num(before, key);
  function calculateATLDelta(before, after) {
    return {
      // Basic work counters
      mountWorkCount: diff(before, after, "mountWorkCount"),
      updateWorkCount: diff(before, after, "updateWorkCount"),
      commitWorkCount: diff(before, after, "commitWorkCount"),
      performedWorkCount: diff(before, after, "totalPerformedWork"),
      // Interruption/restart counters
      interruptedWorkCount: diff(before, after, "interruptedWorkCount"),
      externalStoreRestartCount: diff(before, after, "externalStoreRestartCount"),
      priorityInterruptedWorkCount: diff(before, after, "priorityInterruptedWorkCount"),
      renderRootSyncCount: diff(before, after, "renderRootSyncCount"),
      renderRootConcurrentCount: diff(before, after, "renderRootConcurrentCount"),
      // Scheduler
      ticksCount: diff(before, after, "totalTickCount"),
      // Component work counters
      componentWorkCount: diff(before, after, "componentWorkCount"),
      componentMountWorkCount: diff(before, after, "componentMountWorkCount"),
      componentUpdateWorkCount: diff(before, after, "componentUpdateWorkCount"),
      componentRenderWithHooksCount: diff(before, after, "componentRenderWithHooksCount"),
      finishClassComponentCount: diff(before, after, "finishClassComponentCount"),
      // DOM work
      domWorkCount: diff(before, after, "domWorkCount"),
      // Context updates
      contextUpdateCount: diff(before, after, "contextUpdateCount"),
      legacyContextUpdateCount: diff(before, after, "legacyContextUpdateCount"),
      // Hook-metric delta (react-dom patch; optional). Omit when neither snapshot
      // carries a numeric setStateCount so we never emit a bogus 0 on unpatched hosts.
      // TODO: Require finite values on both sides or model a counter reset
      // explicitly. Treating a missing/wiped side as zero can emit a negative delta,
      // and typeof NaN === 'number' lets a poisoned counter enter the report.
      ...typeof after.setStateCount === "number" || typeof before.setStateCount === "number" ? { setStateCount: diff(before, after, "setStateCount") } : {}
    };
  }
  function createATLCommitMetricsAdapter(options = {}) {
    const slotName = options.slotName ?? DEFAULT_METRICS_SLOT;
    const target = () => options.target ?? globalThis;
    const slot = () => {
      const value = target()[slotName];
      return value && typeof value === "object" ? value : null;
    };
    let ourHandler;
    return {
      id: "atl",
      frameFilters: [ATL_DISPATCHER_FRAME],
      prePage() {
        installMetricsAccessor(target(), slotName);
      },
      prepare() {
        try {
          if (!isSlotHostLocked(target(), slotName)) seedMetricsSlot(target(), slotName);
        } catch {
        }
      },
      isAvailable: () => !!slot(),
      snapshot() {
        const live = slot();
        return live ? { ...live } : null;
      },
      measure(before, after, committedComponents, commitId) {
        const delta = calculateATLDelta(before, after);
        delta.performedWorkCount = committedComponents;
        const rendered = (delta.componentRenderWithHooksCount ?? 0) + (delta.finishClassComponentCount ?? 0);
        const restarts = Math.max(0, rendered - committedComponents);
        if (committedComponents > rendered && rendered > 0) {
          console.warn(
            `[Avalanche] Commit ${commitId}: committedComponents (${committedComponents}) > atlTotal (${rendered}). This indicates a counting bug. Using 0 restarts.`
          );
        }
        const live = slot();
        if (live) {
          live.totalRestarts = (live.totalRestarts ?? 0) + restarts;
          live.totalPerformedWork = (live.totalPerformedWork ?? 0) + committedComponents;
        }
        return { delta, restarts };
      },
      attach(onCommit) {
        const live = slot();
        if (!live) return false;
        const handler = (_rendererID, root) => onCommit(root);
        live.onCommitFiberRoot = handler;
        ourHandler = handler;
        return true;
      },
      isAttached() {
        const live = slot();
        return !!live && !!ourHandler && live.onCommitFiberRoot === ourHandler;
      },
      reattach() {
        const fresh = seedMetricsSlot(target(), slotName);
        if (ourHandler) fresh.onCommitFiberRoot = ourHandler;
      },
      detach() {
        const live = slot();
        if (live && ourHandler && live.onCommitFiberRoot === ourHandler) live.onCommitFiberRoot = void 0;
        ourHandler = void 0;
      }
    };
  }
  const atlCommitMetricsAdapter = createATLCommitMetricsAdapter();
  const OWNER_MARK_NAMES = /* @__PURE__ */ new Set(["OwnerMark", "OwnershipMark"]);
  function readScalar(props, ...keys) {
    for (const key of keys) {
      const value = props == null ? void 0 : props[key];
      if (typeof value === "string" && value.trim()) return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
    return null;
  }
  function displayNameOf$1(fiber) {
    return getDisplayName(fiber.type) || getDisplayName(fiber.elementType) || null;
  }
  function parseOwnerMarkDisplayName(displayName) {
    if (!displayName) return null;
    const parts = displayName.split("___");
    if (!OWNER_MARK_NAMES.has(parts[0])) return null;
    if (parts.length === 1) return null;
    return {
      markerName: displayName,
      type: parts[1] || null,
      name: parts[2] || null,
      packageName: parts[3] || null,
      teamName: null,
      variant: parts[4] || null,
      source: "display-name"
    };
  }
  function describeOwnership(fiber) {
    const displayName = displayNameOf$1(fiber);
    const encoded = parseOwnerMarkDisplayName(displayName);
    if (encoded) {
      return {
        ...encoded,
        packageName: encoded.packageName || readScalar(fiber.memoizedProps, "packageName", "package"),
        teamName: readScalar(fiber.memoizedProps, "teamName", "team")
      };
    }
    if (!displayName || !OWNER_MARK_NAMES.has(displayName)) return null;
    return {
      markerName: displayName,
      type: readScalar(fiber.memoizedProps, "type", "boundaryType"),
      name: readScalar(fiber.memoizedProps, "name", "id"),
      packageName: readScalar(fiber.memoizedProps, "packageName", "package"),
      teamName: readScalar(fiber.memoizedProps, "teamName", "team"),
      variant: readScalar(fiber.memoizedProps, "variant"),
      source: "props"
    };
  }
  function jiraErrorBoundary(fiber) {
    const componentName = displayNameOf$1(fiber);
    if (componentName !== "JSErrorBoundary") return null;
    return {
      componentName,
      id: readScalar(fiber.memoizedProps, "id"),
      packageName: readScalar(fiber.memoizedProps, "packageName"),
      fallback: readScalar(fiber.memoizedProps, "fallback"),
      teamName: readScalar(fiber.memoizedProps, "teamName")
    };
  }
  function field(label, value) {
    return value ? [{ label, value }] : [];
  }
  function describeJiraContribution(fibers) {
    let ownership = null;
    let ownerDistance = -1;
    let errorBoundary = null;
    let errorComponent = false;
    for (let distance = 0; distance < fibers.length; distance += 1) {
      const entry = fibers[distance];
      if (!ownership) {
        const found = describeOwnership(entry);
        if (found) {
          ownership = found;
          ownerDistance = distance;
        }
      }
      if (!errorBoundary) errorBoundary = jiraErrorBoundary(entry);
      const displayName = displayNameOf$1(entry);
      if (displayName === "ErrorComponent" || (displayName == null ? void 0 : displayName.endsWith("ErrorComponent"))) errorComponent = true;
      if (ownership && errorBoundary && errorComponent) break;
    }
    if (!ownership && !errorBoundary && !errorComponent) return null;
    return {
      boundaries: { owner: ownership ? { ...ownership, distance: ownerDistance } : null },
      errorEnrichment: errorBoundary,
      titles: {
        ...ownership ? { owner: ownership.name || ownership.markerName } : {},
        ...errorBoundary ? {} : errorComponent ? { error: "ErrorComponent" } : {}
      },
      // Keep only the fields that matter operationally: team and id (the
      // Sentry key). package/fallback stay on the boundary payload.
      fields: errorBoundary ? { error: [...field("team", errorBoundary.teamName), ...field("id", errorBoundary.id)] } : {},
      showError: errorComponent,
      // Legacy Jira-shaped fields, preserved for existing consumers.
      extra: { ownership, errorComponent, errorBoundary }
    };
  }
  const jiraContextProvider = {
    id: "jira",
    kinds: [{ kind: "owner", label: "owner", accent: "#0c66e4" }],
    describe: describeJiraContribution,
    matchBoundary: (fiber) => describeOwnership(fiber) ? "owner" : null
  };
  const BUILTIN_PLUGINS = [
    { id: "jira", label: "Jira ownership markers", contextProvider: jiraContextProvider },
    { id: "atl", label: "ATL commit metrics", commitMetricsAdapter: atlCommitMetricsAdapter }
  ];
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
  function registerBuiltinPlugins() {
    const unregister = BUILTIN_PLUGINS.map(registerPlugin);
    return () => {
      for (const fn of unregister.reverse()) fn();
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
    for (const field2 of hit.rule.fields ?? []) {
      const value = readRef(field2.value, hit);
      if (value) out.push({ label: field2.label, value });
    }
    return out;
  }
  function compileComponents(pack) {
    const rules = (pack.components ?? []).map(compileRule);
    if (rules.length === 0) return null;
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
      matchBoundary(fiber) {
        const name = displayNameOf(fiber);
        if (!name) return null;
        const hit = rules.find(({ rule, matches }) => rule.kind !== "error" && matches(name));
        return hit ? hit.rule.kind : null;
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
  const TOP_KEYS = /* @__PURE__ */ new Set(["id", "label", "instructions", "components", "avalancheExtensions"]);
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
  function checkRule(rule, path) {
    if (!isObject(rule)) fail(path, "must be an object");
    checkKeys(rule, RULE_KEYS, path);
    checkString(rule.kind, `${path}.kind`);
    if (rule.kind === "suspense") fail(`${path}.kind`, "suspense is a core kind");
    checkString(rule.label, `${path}.label`, true);
    checkString(rule.accent, `${path}.accent`, true);
    if (!isObject(rule.match)) fail(`${path}.match`, "must be an object");
    checkKeys(rule.match, /* @__PURE__ */ new Set(["names", "pattern"]), `${path}.match`);
    const { names, pattern } = rule.match;
    if (names === void 0 && pattern === void 0) fail(`${path}.match`, "needs names or pattern");
    if (names !== void 0 && (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !name))) {
      fail(`${path}.match.names`, "must be a list of names");
    }
    if (pattern !== void 0) {
      checkString(pattern, `${path}.match.pattern`);
      try {
        new RegExp(pattern);
      } catch (error) {
        fail(`${path}.match.pattern`, error.message);
      }
    }
    if (rule.nameParts !== void 0) {
      const parts = rule.nameParts;
      if (!isObject(parts)) fail(`${path}.nameParts`, "must be an object");
      checkString(parts.separator, `${path}.nameParts.separator`);
      if (!Array.isArray(parts.keys) || parts.keys.some((key) => typeof key !== "string")) {
        fail(`${path}.nameParts.keys`, "must be a list of keys");
      }
    }
    if (rule.title !== void 0) checkRef(rule.title, `${path}.title`);
    if (rule.fields !== void 0) {
      if (!Array.isArray(rule.fields)) fail(`${path}.fields`, "must be a list");
      rule.fields.forEach((field2, index) => {
        if (!isObject(field2)) fail(`${path}.fields[${index}]`, "must be an object");
        checkString(field2.label, `${path}.fields[${index}].label`);
        checkRef(field2.value, `${path}.fields[${index}].value`);
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
    let at = index - 1;
    while (at >= 0 && /\s/.test(text[at])) at -= 1;
    return at >= 0 ? text[at] : "";
  }
  function quotedEnd(text, start, quote) {
    for (let at = start + 1; at < text.length; at += 1) {
      const char = text[at];
      if (char === "\\") at += 1;
      else if (char === quote) return at;
      else if (char === "\n" && quote !== "`") return -1;
    }
    return -1;
  }
  function templateChunks(text, start) {
    const chunks = [];
    let chunk = "";
    for (let at = start + 1; at < text.length; at += 1) {
      const char = text[at];
      if (char === "\\") {
        chunk += text.slice(at, at + 2);
        at += 1;
      } else if (char === "`") {
        chunks.push(chunk);
        return { chunks, end: at };
      } else if (char === "$" && text[at + 1] === "{") {
        chunks.push(chunk);
        chunk = "";
        let depth = 1;
        for (at += 2; at < text.length && depth > 0; at += 1) {
          if (text[at] === "{") depth += 1;
          else if (text[at] === "}") depth -= 1;
        }
        at -= 1;
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
    for (let at = start + 1; at < text.length; at += 1) {
      const char = text[at];
      if (char === "\\") at += 1;
      else if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return at;
      else if (char === "\n") return start;
    }
    return start;
  }
  function stringLiterals(text) {
    const out = [];
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at];
      if (char === "/" && text[at + 1] === "/") {
        const end = text.indexOf("\n", at);
        at = end === -1 ? text.length : end;
      } else if (char === "/" && text[at + 1] === "*") {
        const end = text.indexOf("*/", at + 2);
        at = end === -1 ? text.length : end + 1;
      } else if (char === "/" && startsRegex(text, at)) {
        at = regexEnd(text, at);
      } else if (char === '"' || char === "'") {
        const end = quotedEnd(text, at, char);
        if (end === -1) continue;
        const before = previousSignificant(text, at);
        const key = (before === "{" || before === ",") && text[skipSpace(text, end + 1)] === ":";
        out.push({ value: text.slice(at + 1, end), key, end });
        at = end;
      } else if (char === "`") {
        const { chunks, end } = templateChunks(text, at);
        for (const chunk of chunks) out.push({ value: chunk, key: false, end });
        at = end;
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
  const DEFAULT_NETWORK_WINDOW_MS = 250;
  const NETWORK_SORT_KEYS = ["start", "end", "duration"];
  const round$3 = (value) => Math.round(value * 10) / 10;
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
    const startedAfter = after && startTime - after.commitEnd <= windowMs ? { commitId: after.commitId, gapMs: round$3(startTime - after.commitEnd) } : null;
    const rendering = anchors[firstAtOrAfter(anchors, startTime, "commitStart")];
    const startedDuringRender = rendering && rendering.renderStartKnown && rendering.renderStart <= startTime ? rendering.commitId : null;
    let landedBefore = null;
    for (let i = firstAtOrAfter(anchors, endTime, "commitStart"); i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.renderStart - endTime > windowMs) break;
      if (anchor.renderStart >= endTime) {
        landedBefore = { commitId: anchor.commitId, gapMs: round$3(anchor.renderStart - endTime) };
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
    for (const frame of frames) {
      for (const [l, t, r, b] of frame.change.rects) {
        const c0 = Math.max(0, Math.round(l / cw));
        const c1 = Math.min(cols, Math.round(r / cw));
        const r0 = Math.max(0, Math.round(t / ch));
        const r1 = Math.min(rows, Math.round(b / ch));
        for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) last[y * cols + x] = frame.t;
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
    for (const frame of sorted.slice(-3)) {
      const [l, t, r, b] = frame.change.rects[0];
      const label = (_a2 = frame.change.regions[0]) == null ? void 0 : _a2.label;
      if (!label) continue;
      const cx = (l + r) / 2 * scale;
      const cy = (t + b) / 2 * scale;
      parts.push(`<text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${escapeXml(`${label} +${frame.t}`)}</text>`);
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
  const round$2 = (n) => Math.round(n);
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
  function commitStart(report, id) {
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
    const ids = Object.keys(report.commitTimings ?? {}).map(Number).filter((id) => Number.isFinite(id) && commitStart(report, id) !== null).sort((a, b) => a - b);
    if (ids.length === 0) return { ok: false, error: "report has no commit timings (report version 6 or later is required)" };
    const startOf = (id) => commitStart(report, id);
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
    const rel = (t) => round$2(t - origin);
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
      durationMs: round$2(r.duration),
      initiatorType: r.initiatorType,
      cached: !!r.cached
    });
    const drawable = inWindow.filter((r) => r.duration >= minRequestMs);
    const kept = [...drawable].sort((a, b) => b.duration - a.duration).slice(0, options.maxRequests ?? 30).sort((a, b) => a.startTime - b.startTime);
    const network = kept.map(toRequest);
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
      lanes: { input, network, suspense, commits },
      omitted: { requests: inWindow.length - kept.length, commits: allCommits.length - commits.length },
      mermaid: "",
      text: ""
    };
    result.mermaid = renderMermaid(result);
    result.text = renderText(result);
    return result;
  }
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
        const at = c.paintAt ?? c.t;
        lines.push(`  c${c.commitId} ${percent(c.screen.share)}${c.screen.region ? " " + safe(c.screen.region) : ""} :milestone, sc${c.commitId}, ${at}, ${at}`);
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
    const order = { input: 0, net: 1, wait: 2, SCRN: 3, react: 4 };
    rows.sort((a, b) => a.t - b.t || order[a.lane] - order[b.lane]);
    const width = Math.max(...rows.map((r) => String(r.t).length), 1);
    return [...header, "", ...rows.map((r) => `+${String(r.t).padStart(width)}  ${r.lane.padEnd(5)}  ${r.text}`)].join("\n");
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
    var _a2, _b2, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
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
          const r = getReport(api2);
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
          const r = getReport(api2);
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
          const allowedInclude = ["stats", "sources", "timing", "metrics", "atl", "hooks", "unmounts", "actions", "rendered", "network"];
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
          const r = getReport(api2);
          if (!r || "error" in r) {
            return { ok: false, available: true, action, error: r && "error" in r ? r.error : "report() unavailable" };
          }
          const ser = r.serial || {};
          const tuple = ((_e2 = ser.commitStats) == null ? void 0 : _e2[commitId]) || ((_f = ser.commitStats) == null ? void 0 : _f[String(commitId)]) || null;
          const sourceIds = ((_g = ser.sourcesByCommit) == null ? void 0 : _g[commitId]) || ((_h = ser.sourcesByCommit) == null ? void 0 : _h[String(commitId)]) || [];
          const timing = ((_i = ser.commitTimings) == null ? void 0 : _i[commitId]) || ((_j = ser.commitTimings) == null ? void 0 : _j[String(commitId)]) || null;
          const metricsMap = ser.metricsByCommit || ser.atlByCommit;
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
          if (include.includes("atl")) out.atl = metrics;
          if (include.includes("hooks") && ser.hooks) out.hooks = hookSteps;
          if (include.includes("actions")) {
            out.actions = actions.slice(0, maxItems);
            out.actionsTotal = actions.length;
          }
          if (include.includes("rendered")) {
            out.rendered = rendered.slice(0, maxItems);
            out.renderedTotal = rendered.length;
          }
          if (include.includes("network")) {
            out.network = compactNetwork(networkByCommit(ser, command == null ? void 0 : command.window).get(commitId), maxItems);
          }
          if (include.includes("unmounts")) {
            const raw = r.raw || {};
            const samples = ((_o = raw.unmountsByCommit) == null ? void 0 : _o[commitId]) || ((_p = raw.unmountsByCommit) == null ? void 0 : _p[String(commitId)]) || null;
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
          const r = getReport(api2);
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
          const r = getReport(api2);
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
          const r = getReport(api2);
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
        case "timeline": {
          const r = getReport(api2);
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
        // Removed: start, stop, metrics, help — not present on the current public surface.
        default:
          return { ok: false, available: true, action, error: "Unknown avalanche action: " + action };
      }
    } catch (error) {
      return { ok: false, available: true, action, error: (error == null ? void 0 : error.message) || String(error) };
    }
  }
  const AVALANCHE_NAME_BUDGET_MS = 3e3;
  const NAME_FREE_ACTIONS = /* @__PURE__ */ new Set(["install", "uninstall", "reset", "clear", "status", "debug-hook", "network", "timeline"]);
  const SOURCE_ID = /^[^\s#@]+#\d+@-?\d+$/;
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
  async function evalAvalancheWithNames(command, api2, mod, budgetMs = AVALANCHE_NAME_BUDGET_MS) {
    const first = evalAvalanche(command, api2, mod);
    const action = String((command == null ? void 0 : command.action) || "status");
    if (!first.ok || NAME_FREE_ACTIONS.has(action) || typeof (api2 == null ? void 0 : api2.componentTypesFor) !== "function") return first;
    const ids = sourceIdsIn(first);
    if (ids.length === 0) return first;
    let types;
    try {
      types = api2.componentTypesFor(ids);
    } catch {
      return first;
    }
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
  const HOST_TAGS = /* @__PURE__ */ new Set([5, 6, 26, 27]);
  function hookSlots(fiber) {
    const out = [];
    if (fiber.tag === CLASS_COMPONENT_TAG || HOST_TAGS.has(fiber.tag)) return out;
    const seen = /* @__PURE__ */ new Set();
    let node = fiber.memoizedState;
    let index = 0;
    while (node && typeof node === "object" && !seen.has(node) && "next" in node) {
      seen.add(node);
      const tag = classifyHook(node, index).tag;
      const ms = node.memoizedState;
      const label = "hook[" + index + ":" + tag + "]";
      if (tag === "Effect") {
        const deps = ms == null ? void 0 : ms.deps;
        if (Array.isArray(deps)) out.push([label + ".deps", deps]);
      } else if (tag === "Ref") {
        out.push([label + ".current", ms.current]);
      } else if (tag === "Memo") {
        out.push([label, ms[0]]);
      } else {
        out.push([label, ms]);
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
          const hookPath = (rec.path || []).map((frame) => frame.name);
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
    const matches = [];
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
      if (matches.length >= max) {
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
      matches.push({
        fiberId,
        ...info,
        ...possibleNames ? { match: "possible", possibleNames } : {},
        ...hits ? { hits, hitsTruncated: hits.length >= limits.maxHits } : {},
        ...replayInfo && replayInfo.status !== "complete" ? { replay: replayInfo } : {}
      });
    }, { limit: 2e5 });
    const possible = matches.filter((item) => item.match === "possible").length;
    const possibleMatches = possible ? { possibleMatches: possible } : {};
    if (!grepRe) return { count: matches.length, items: matches, ...possibleMatches };
    return {
      count: matches.length,
      items: matches,
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
  async function resolveFindFiberSources(items, getFiber2, resolve) {
    await Promise.all(items.map(async (item) => {
      const fiber = item.fiberId == null ? null : getFiber2(String(item.fiberId));
      if (!fiber) return;
      try {
        const source = await resolve(fiber);
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
    const clip = intersectRect(rootRect, viewport);
    if (!clip) return { ok: false, reason: "root-offscreen", root: rootName, at: startedAt };
    const cell = cellSizeFor(clip);
    const placeholder = createAreaGrid(clip, cell);
    const content = createAreaGrid(clip, cell);
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
        box: createAreaGrid(clip, cell),
        content: createAreaGrid(clip, cell),
        placeholder: createAreaGrid(clip, cell)
      });
    }
    for (const name of options.components || []) if (name) addTarget("component", name);
    for (const id of options.testIds || []) if (id) addTarget("testid", id);
    if (targets.length === 0) {
      for (const id of largestTestIds(rootEl, clip, geometry, options)) addTarget("testid", id);
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
    visit(rootEl, null, { groups: [], placeholder: false }, clip, true);
    const rootArea = rectArea(clip);
    const share = (n) => rootArea > 0 ? round$1(n / rootArea, 4) : 0;
    return {
      ok: true,
      at: round$1(startedAt, 1),
      root: { label: rootLabel(options.root ?? null, rootEl), rect: roundRect(clip), area: Math.round(rootArea) },
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
  function largestTestIds(rootEl, clip, geometry, options) {
    const limit = options.autoTargets ?? DEFAULT_AUTO_TARGETS;
    if (limit <= 0) return [];
    const minArea = rectArea(clip) * (options.minShare ?? DEFAULT_MIN_SHARE);
    const best = /* @__PURE__ */ new Map();
    for (const el of Array.from(rootEl.querySelectorAll("[data-testid]"))) {
      const id = el.getAttribute("data-testid");
      if (!id) continue;
      const box = intersectRect(geometry.rect(el), clip);
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
  function roundRect(r) {
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  }
  let state = null;
  const domWatchDeps = {
    measure: (options) => measureComponentArea(options),
    now: () => performance.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
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
  function startPoll(s, ms) {
    const tick = () => {
      if (!s.active) return;
      schedule(s);
      s.poll = s.deps.setTimeout(tick, ms);
    };
    s.poll = s.deps.setTimeout(tick, ms);
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
    const owners = fibers.map((owner, idx) => ({ ownerIndex: idx, ...helpers.fiberInfo(owner) || {} }));
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
    const read = readFiberProp(fiberId, propName, deps);
    if (!read.ok) {
      const fiberName2 = read.fiber ? getFiberDisplayName$1(read.fiber) : null;
      return { ok: false, error: read.error, fiberId: read.fiberId, fiberName: fiberName2, propNames: read.props ? Object.keys(read.props) : [] };
    }
    const propNames = Object.keys(read.props);
    const contract = summarizeFunctionContract(read.value);
    return {
      ok: true,
      fiberId: read.fiberId,
      fiberName: getFiberDisplayName$1(read.fiber),
      source: getFiberSource$1(read.fiber),
      propName: read.propName,
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
    const read = readFiberProp(fiberId, propName, deps);
    if (!read.ok) {
      const fiberName2 = read.fiber ? getFiberDisplayName$1(read.fiber) : null;
      return { ok: false, error: read.error, fiberId: read.fiberId, fiberName: fiberName2 };
    }
    const value = read.value;
    if (typeof value !== "function") {
      return {
        ok: false,
        error: `prop ${read.propName} is not a function`,
        fiberId: read.fiberId,
        fiberName: getFiberDisplayName$1(read.fiber),
        propName: read.propName,
        propType: typeof value
      };
    }
    const invokeArgs = Array.isArray(args) ? args : [];
    const thisArg = pickThisArg(read.fiber);
    let result;
    try {
      result = value.apply(thisArg, invokeArgs);
    } catch (e) {
      const err = e;
      return {
        ok: false,
        error: (err == null ? void 0 : err.message) || String(e),
        stack: (err == null ? void 0 : err.stack) || null,
        threw: true,
        fiberId: read.fiberId,
        fiberName: getFiberDisplayName$1(read.fiber),
        propName: read.propName,
        propType: "function",
        args: deps.safeSerialize(invokeArgs, 0, /* @__PURE__ */ new Set())
      };
    }
    const base = {
      ok: true,
      fiberId: read.fiberId,
      fiberName: getFiberDisplayName$1(read.fiber),
      propName: read.propName,
      propType: "function",
      fnLength: Number.isFinite(value.length) ? value.length : null,
      invoked: true,
      args: deps.safeSerialize(invokeArgs, 0, /* @__PURE__ */ new Set())
    };
    if (isThenable(result)) {
      const timeoutMs = Math.max(1, Math.min(3e4, deps.awaitTimeoutMs ?? 2e3));
      try {
        const resolved = await Promise.race([
          Promise.resolve(result),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`async callback did not resolve within ${timeoutMs}ms`)), timeoutMs))
        ]);
        return { ...base, async: true, returnValue: deps.safeSerialize(resolved, 0, /* @__PURE__ */ new Set()) };
      } catch (e) {
        const err = e;
        return {
          ok: false,
          async: true,
          error: (err == null ? void 0 : err.message) || String(e),
          stack: (err == null ? void 0 : err.stack) || null,
          threw: false,
          rejected: true,
          fiberId: read.fiberId,
          fiberName: getFiberDisplayName$1(read.fiber),
          propName: read.propName,
          propType: "function",
          args: deps.safeSerialize(invokeArgs, 0, /* @__PURE__ */ new Set())
        };
      }
    }
    return { ...base, async: false, returnValue: deps.safeSerialize(result, 0, /* @__PURE__ */ new Set()) };
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
    let propChanges = 0;
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
      propChanges += count;
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
        propChanges,
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
        const frame = stack.pop();
        const current = frame.fiber;
        if (alreadyVisited(current, seen)) continue;
        markVisited(current, seen);
        scannedFibers += 1;
        let nextParentBoundary = frame.parentBoundary;
        const summary = describeBoundary(current, deps);
        if (summary) {
          const node = {
            ...summary,
            fiberDepth: frame.fiberDepth,
            distanceFromParent: frame.parentBoundary ? frame.fiberDepth - frame.parentBoundary.fiberDepth : null,
            children: []
          };
          if (frame.parentBoundary) frame.parentBoundary.children.push(node);
          else rootItems.push(node);
          nextParentBoundary = node;
          count += 1;
        }
        if (current.sibling) {
          stack.push({
            fiber: current.sibling,
            fiberDepth: frame.fiberDepth,
            parentBoundary: frame.parentBoundary
          });
        }
        if (current.child) {
          stack.push({
            fiber: current.child,
            fiberDepth: frame.fiberDepth + 1,
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
  registerBuiltinPlugins();
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
      try {
        const counts = detector ? detector.counts() : null;
        if (counts) ({ commits: commitCount, networkRequests } = counts);
      } catch (_) {
      }
      const integrationMode = detector ? ((_b2 = detector.getIntegrationMode) == null ? void 0 : _b2.call(detector)) ?? "none" : "none";
      const metricsAdapter = detector ? ((_c2 = detector.getMetricsAdapterId) == null ? void 0 : _c2.call(detector)) ?? null : ((_d2 = getCommitMetricsAdapter()) == null ? void 0 : _d2.id) ?? null;
      const packs2 = listPacks().map(({ id, label, instructions, extensions, compileErrors, initErrors }) => ({ id, label, instructions, extensions, compileErrors, initErrors }));
      let hooks = null;
      try {
        hooks = summarizeHookResults(detector == null ? void 0 : detector.hookResults());
      } catch (_) {
      }
      return { installed, hasMetricsGlobal, commitCount, integrationMode, metricsAdapter, networkRequests, packs: packs2, hooks };
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
