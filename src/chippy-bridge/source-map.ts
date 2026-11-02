/**
 * Small, dependency-free Source Map v3 reader.
 *
 * Chippy only needs the generated-position lookup used by React 19's
 * `_debugStack` source path, so it deliberately omits names and source contents.
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
};

export type SourceMap = {
  sources: readonly string[];
  lines: readonly (readonly Segment[])[];
  offset: { line: number; column: number };
};

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
};

type RawMap = {
  version?: unknown;
  sources?: unknown;
  sourceRoot?: unknown;
  mappings?: unknown;
  sections?: unknown;
};

function decodeVlq(field: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (let index = 0; index < field.length; index += 1) {
    const code = field.charCodeAt(index);
    const digit = code < 128 ? VALUE_OF[code]! : -1;
    if (digit < 0) return values;

    const more = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (more) {
      shift += 5;
      continue;
    }

    const negative = (value & 1) === 1;
    const magnitude = value >>> 1;
    values.push(negative ? (magnitude === 0 ? -0x80000000 : -magnitude) : magnitude);
    value = 0;
    shift = 0;
  }

  return values;
}

function decodeMappings(mappings: string, sourceCount: number): Segment[][] {
  const lines: Segment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;

  for (const encodedLine of mappings.split(';')) {
    const segments: Segment[] = [];
    let generatedColumn = 0;

    for (const field of encodedLine === '' ? [] : encodedLine.split(',')) {
      const values = decodeVlq(field);
      if (values.length < 4) {
        if (values.length > 0) {
          generatedColumn += values[0]!;
          segments.push({ generatedColumn, sourceIndex: null, originalLine: null, originalColumn: null });
        }
        continue;
      }

      generatedColumn += values[0]!;
      sourceIndex += values[1]!;
      originalLine += values[2]!;
      originalColumn += values[3]!;
      if (sourceIndex >= 0 && sourceIndex < sourceCount) {
        segments.push({ generatedColumn, sourceIndex, originalLine, originalColumn });
      }
    }

    segments.sort((left, right) => left.generatedColumn - right.generatedColumn);
    lines.push(segments);
  }

  return lines;
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
  return [{ sources, lines: decodeMappings(raw.mappings, sources.length), offset: { line: 0, column: 0 } }];
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

export function originalPositionFor(
  maps: readonly SourceMap[],
  line: number,
  column: number,
): OriginalPosition | null {
  for (const map of sectionsFor(maps, line, column)) {
    const localLine = line - map.offset.line;
    const localColumn = localLine === 1 ? column - map.offset.column : column;
    const segments = map.lines[localLine - 1];
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
    return { source, line: found.originalLine + 1, column: found.originalColumn + 1 };
  }

  return null;
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
