/**
 * Small, dependency-free Source Map v3 reader.
 *
 * Chippy needs generated-to-original position lookups for React 19's
 * `_debugStack` source path, and the `names` table and `sourcesContent` to
 * recover component names from production bundles.
 */

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUE_OF = new Int8Array(128).fill(-1);
for (let index = 0; index < DIGITS.length; index += 1) {
  VALUE_OF[DIGITS.charCodeAt(index)] = index;
}

type Segment = {
  generatedColumn: number;
  sourceIndex: number | null;
  originalLine: number | null;
  originalColumn: number | null;
  nameIndex: number | null;
};

export type SourceMap = {
  sources: readonly string[];
  names: readonly string[];
  /** Authored text per source, or null when the map omits it. */
  sourcesContent: readonly (string | null)[];
  /** Generated lines, decoded lazily. */
  lines: MappingLines;
  offset: { line: number; column: number };
};

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
};

/** The segment covering a generated position, with its original name. */
export type GeneratedMapping = OriginalPosition & {
  /** The `names` entry of the segment, or null when it has none. */
  name: string | null;
  /** True when the segment starts exactly at the requested column. */
  exact: boolean;
  /** Authored text of `source`, or null when the map omits it. */
  sourceContent: string | null;
};

type RawMap = {
  version?: unknown;
  sources?: unknown;
  names?: unknown;
  sourcesContent?: unknown;
  sourceRoot?: unknown;
  mappings?: unknown;
  sections?: unknown;
};

/** Running VLQ state carried from one generated line to the next. */
type DecodeState = { sourceIndex: number; originalLine: number; originalColumn: number; nameIndex: number };

/**
 * Walk one generated line of `mappings` from `state`, advancing it in place.
 * With `out`, also collect the line's segments; without it, allocate nothing.
 */
function walkLine(
  mappings: string,
  start: number,
  end: number,
  state: DecodeState,
  sourceCount: number,
  out: Segment[] | null,
): void {
  let generatedColumn = 0;
  let index = start;
  while (index < end) {
    // One field: up to five VLQ values, ended by ',' or the line end.
    let count = 0;
    let v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0;
    let value = 0;
    let shift = 0;
    let broken = false;
    for (; index < end; index += 1) {
      const code = mappings.charCodeAt(index);
      if (code === 44) break; // ','
      const digit = code < 128 ? VALUE_OF[code]! : -1;
      if (digit < 0 || broken) { broken = true; continue; }
      value += (digit & 31) << shift;
      if ((digit & 32) !== 0) { shift += 5; continue; }
      const magnitude = value >>> 1;
      const decoded = (value & 1) === 1 ? (magnitude === 0 ? -0x80000000 : -magnitude) : magnitude;
      if (count === 0) v0 = decoded;
      else if (count === 1) v1 = decoded;
      else if (count === 2) v2 = decoded;
      else if (count === 3) v3 = decoded;
      else if (count === 4) v4 = decoded;
      count += 1;
      value = 0;
      shift = 0;
    }
    index += 1; // skip ','

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
        nameIndex: named ? state.nameIndex : null,
      });
    }
  }
  out?.sort((left, right) => left.generatedColumn - right.generatedColumn);
}

/**
 * Generated lines, decoded on first read. A production map can be tens of
 * megabytes, and a lookup needs one line: earlier lines are walked only to
 * carry the running VLQ state, without allocating their segments.
 */
export class MappingLines {
  readonly #mappings: string;
  readonly #sourceCount: number;
  #starts: number[] | null = null;
  /** State at the start of each line up to `#knownLines`, four ints per line. */
  #states = new Int32Array(4);
  #knownLines = 1;
  readonly #decoded = new Map<number, readonly Segment[]>();

  constructor(mappings: string, sourceCount: number) {
    this.#mappings = mappings;
    this.#sourceCount = sourceCount;
  }

  #lineStarts(): number[] {
    if (this.#starts) return this.#starts;
    const starts = [0];
    for (let at = this.#mappings.indexOf(';'); at !== -1; at = this.#mappings.indexOf(';', at + 1)) {
      starts.push(at + 1);
    }
    this.#starts = starts;
    return starts;
  }

  get length(): number {
    return this.#lineStarts().length;
  }

  #lineEnd(starts: number[], line: number): number {
    return line + 1 < starts.length ? starts[line + 1]! - 1 : this.#mappings.length;
  }

  #stateAt(line: number): DecodeState {
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
        sourceIndex: states[previous * 4]!,
        originalLine: states[previous * 4 + 1]!,
        originalColumn: states[previous * 4 + 2]!,
        nameIndex: states[previous * 4 + 3]!,
      };
      walkLine(this.#mappings, starts[previous]!, this.#lineEnd(starts, previous), state, this.#sourceCount, null);
      const next = this.#knownLines * 4;
      states[next] = state.sourceIndex;
      states[next + 1] = state.originalLine;
      states[next + 2] = state.originalColumn;
      states[next + 3] = state.nameIndex;
      this.#knownLines += 1;
    }
    return {
      sourceIndex: states[line * 4]!,
      originalLine: states[line * 4 + 1]!,
      originalColumn: states[line * 4 + 2]!,
      nameIndex: states[line * 4 + 3]!,
    };
  }

  /** Segments of the 0-based generated `line`, sorted by column; undefined past the end. */
  at(line: number): readonly Segment[] | undefined {
    const cached = this.#decoded.get(line);
    if (cached) return cached;
    const starts = this.#lineStarts();
    if (line < 0 || line >= starts.length) return undefined;
    const segments: Segment[] = [];
    walkLine(this.#mappings, starts[line]!, this.#lineEnd(starts, line), this.#stateAt(line), this.#sourceCount, segments);
    this.#decoded.set(line, segments);
    return segments;
  }
}

function resolveSources(raw: RawMap): string[] | null {
  if (!Array.isArray(raw.sources)) return null;
  const root = typeof raw.sourceRoot === 'string' ? raw.sourceRoot : '';

  return raw.sources.map((source) => {
    if (typeof source !== 'string') return '';
    if (root === '' || source === '' || /^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
    if (root.endsWith('/') && source.startsWith('/')) return `${root}${source.slice(1)}`;
    if (root.endsWith('/') || source.startsWith('/')) return `${root}${source}`;
    return `${root}/${source}`;
  });
}

export function parseSourceMap(text: string): SourceMap[] {
  let raw: RawMap;
  try {
    raw = JSON.parse(text) as RawMap;
  } catch {
    return [];
  }

  if (raw === null || typeof raw !== 'object') return [];
  if (raw.version !== 3) return [];

  if (Array.isArray(raw.sections)) {
    return raw.sections.flatMap((section) => {
      if (section === null || typeof section !== 'object') return [];
      const { offset, map } = section as { offset?: unknown; map?: unknown };
      if (offset === null || typeof offset !== 'object' || map === null || typeof map !== 'object') return [];
      const { line, column } = offset as { line?: unknown; column?: unknown };
      if (typeof line !== 'number' || typeof column !== 'number') return [];
      return parseSourceMap(JSON.stringify(map)).map((parsed) => ({ ...parsed, offset: { line, column } }));
    });
  }

  const sources = resolveSources(raw);
  if (sources === null || typeof raw.mappings !== 'string') return [];
  const names = Array.isArray(raw.names) ? raw.names.map((name) => (typeof name === 'string' ? name : '')) : [];
  const contents = Array.isArray(raw.sourcesContent) ? raw.sourcesContent : [];
  const sourcesContent = sources.map((_, index) => (typeof contents[index] === 'string' ? contents[index] as string : null));
  return [{
    sources,
    names,
    sourcesContent,
    lines: new MappingLines(raw.mappings, sources.length),
    offset: { line: 0, column: 0 },
  }];
}

function sectionsFor(maps: readonly SourceMap[], line: number, column: number): readonly SourceMap[] {
  if (
    maps.length === 0 ||
    (maps.length === 1 && maps[0]?.offset.line === 0 && maps[0]?.offset.column === 0)
  ) return maps;
  const zeroBasedLine = line - 1;
  const candidates = maps.filter(
    (map) =>
      map.offset.line < zeroBasedLine ||
      (map.offset.line === zeroBasedLine && map.offset.column < column),
  );
  return candidates.length === 0 ? [] : [candidates[candidates.length - 1]!];
}

function segmentAt(segments: readonly Segment[], column: number): Segment | undefined {
  let low = 0;
  let high = segments.length - 1;
  let found: Segment | undefined;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle]!;
    if (segment.generatedColumn <= column) {
      found = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/**
 * The mapping covering a generated position. `line` and `column` are 1-based;
 * the returned original position is 1-based too.
 */
export function mappingAt(
  maps: readonly SourceMap[],
  line: number,
  column: number,
): GeneratedMapping | null {
  for (const map of sectionsFor(maps, line, column)) {
    const localLine = line - map.offset.line;
    const localColumn = localLine === 1 ? column - map.offset.column : column;
    const segments = map.lines.at(localLine - 1);
    if (segments === undefined || segments.length === 0) continue;

    const found = segmentAt(segments, localColumn - 1);
    if (found === undefined) continue;
    if (
      found.sourceIndex === null ||
      found.originalLine === null ||
      found.originalColumn === null
    ) return null;
    const source = map.sources[found.sourceIndex];
    if (source === undefined || source === '') continue;
    return {
      source,
      line: found.originalLine + 1,
      column: found.originalColumn + 1,
      name: found.nameIndex === null ? null : map.names[found.nameIndex] || null,
      exact: found.generatedColumn === localColumn - 1,
      sourceContent: map.sourcesContent[found.sourceIndex] ?? null,
    };
  }

  return null;
}

export function originalPositionFor(
  maps: readonly SourceMap[],
  line: number,
  column: number,
): OriginalPosition | null {
  const found = mappingAt(maps, line, column);
  return found === null ? null : { source: found.source, line: found.line, column: found.column };
}

export function sourceMappingUrlOf(code: string): string | null {
  const found = [...code.matchAll(/^[/*]{2,}[#@]\s*sourceMappingURL=(\S+)\s*(?:\*\/)?$/gm)];
  return found.at(-1)?.[1] ?? null;
}

export function inlineSourceMapOf(url: string): string | null {
  const match = /^data:application\/json[^,]*,(.*)$/s.exec(url);
  if (match === null) return null;
  const payload = match[1]!;

  if (!/;base64/i.test(url)) {
    try {
      return decodeURIComponent(payload);
    } catch {
      return null;
    }
  }

  try {
    const decode = (globalThis as { atob?: (input: string) => string }).atob;
    if (decode) {
      const binary = decode(payload);
      const Decoder = (globalThis as {
        TextDecoder?: new () => { decode(bytes: Uint8Array): string };
      }).TextDecoder;
      return Decoder
        ? new Decoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
        : binary;
    }
    const buffer = (globalThis as {
      Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
    }).Buffer;
    return buffer?.from(payload, 'base64').toString('utf8') ?? null;
  } catch {
    return null;
  }
}

/** One mapped segment inside a generated range. */
export type RangeMapping = OriginalPosition & {
  name: string | null;
  sourceContent: string | null;
};

/**
 * Every mapped segment whose generated position lies in `[start, end)`.
 * Positions are 1-based lines and 1-based columns, as in `mappingAt`.
 */
export function mappingsInRange(
  maps: readonly SourceMap[],
  start: { line: number; column: number },
  end: { line: number; column: number },
): RangeMapping[] {
  const out: RangeMapping[] = [];
  const before = (line: number, column: number, other: { line: number; column: number }) =>
    line < other.line || (line === other.line && column < other.column);
  for (const map of maps) {
    for (let localLine = 1; localLine <= map.lines.length; localLine += 1) {
      const line = localLine + map.offset.line;
      if (line < start.line) continue;
      if (line > end.line) break;
      for (const segment of map.lines.at(localLine - 1)!) {
        const column = segment.generatedColumn + 1 + (localLine === 1 ? map.offset.column : 0);
        if (before(line, column, start)) continue;
        if (!before(line, column, end)) break;
        if (segment.sourceIndex === null || segment.originalLine === null || segment.originalColumn === null) continue;
        const source = map.sources[segment.sourceIndex];
        if (source === undefined || source === '') continue;
        out.push({
          source,
          line: segment.originalLine + 1,
          column: segment.originalColumn + 1,
          name: segment.nameIndex === null ? null : map.names[segment.nameIndex] || null,
          sourceContent: map.sourcesContent[segment.sourceIndex] ?? null,
        });
      }
    }
  }
  return out;
}
