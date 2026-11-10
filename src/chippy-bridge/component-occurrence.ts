/**
 * Name one occurrence of a component function's text in a generated script.
 *
 * Given the offset where a function's text starts in a script, map that
 * position through the script's source map and read the authored name from
 * the map's `names` table or from `sourcesContent`. The resolver in
 * `component-origin.ts` decides which occurrences to name and how to combine
 * them when the same text occurs more than once.
 */

import { mappingAt, type GeneratedMapping } from './source-map';
import { sourcePath, type ModuleMaps } from './module-maps';
import type { ScriptRef } from './component-origin';

export type ComponentDefinition = {
  fileName: string;
  lineNumber: number;
  columnNumber: number | null;
};

/**
 * How the name was recovered:
 * - `map-name`: the source map's `names` entry for the function's own identifier.
 * - `source-text`: the function's own name in the authored source.
 * - `binding-map-name`: the `names` entry for the variable or property that holds it.
 * - `binding-source-text`: that binding in the authored source.
 */
export type NameEvidence = 'map-name' | 'source-text' | 'binding-map-name' | 'binding-source-text';

/** Where a function's text was found. */
export type Occurrence = {
  script: ScriptRef;
  module: ModuleMaps;
  offset: number;
};

export type OccurrenceOrigin = {
  status: 'resolved' | 'no-source-map' | 'unmapped';
  name: string | null;
  nameEvidence: NameEvidence | null;
  definition: ComponentDefinition | null;
  /** Script URL, or the inline script key. */
  script: string;
  /** Generated 1-based position of the function in `script`. */
  generated: { line: number; column: number };
};

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const OWN_FUNCTION_NAME = new RegExp(`^(?:async\\s*)?function\\s*\\*?\\s*(${IDENTIFIER})\\s*\\(`);
const OWN_CLASS_NAME = new RegExp(`^class\\s+(${IDENTIFIER})(?=[\\s{])`);
const AUTHORED_OWN_NAME = new RegExp(
  `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)(${IDENTIFIER})`,
);
// `name = ` or `name: ` followed by any wrapping calls, e.g. `x=(0,r.memo)(`.
const CALLEE = `(?:\\(\\s*0\\s*,\\s*${IDENTIFIER}(?:\\.${IDENTIFIER})*\\s*\\)|${IDENTIFIER}(?:\\.${IDENTIFIER})*)`;
const GENERATED_BINDING = new RegExp(`(${IDENTIFIER})\\s*[=:]\\s*(?:${CALLEE}\\s*\\(\\s*)*$`);
const AUTHORED_BINDING = new RegExp(
  `(?:^|[^\\w$.])(${IDENTIFIER})\\s*(?::[^=;{}()]*)?=\\s*(?:${CALLEE}\\s*(?:<[^()]*>)?\\s*\\(\\s*)*$`,
);
const LEADING_IDENTIFIER = new RegExp(`^${IDENTIFIER}`);
const GENERATED_LOOKBACK = 160;
const AUTHORED_LOOKBACK = 240;

/** Offsets where each line starts, for repeated offset-to-position lookups. */
export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** 1-based line and 0-based column of `offset`, using precomputed line starts. */
function positionOf(lineStarts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low]! };
}

function offsetOf(text: string, line: number, column: number): number | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return null;
    offset = next + 1;
  }
  return offset + column;
}

/** Authored own name, then authored binding, around a mapped definition. */
function authoredNames(mapping: GeneratedMapping): { own: string | null; binding: string | null } {
  const content = mapping.sourceContent;
  if (content === null) return { own: null, binding: null };
  const offset = offsetOf(content, mapping.line, mapping.column - 1);
  if (offset === null) return { own: null, binding: null };
  const own = AUTHORED_OWN_NAME.exec(content.slice(offset, offset + 300))?.[1] ?? null;
  const before = content.slice(Math.max(0, offset - AUTHORED_LOOKBACK), offset);
  const binding = AUTHORED_BINDING.exec(before)?.[1] ?? null;
  return { own, binding };
}

function mappedNameAt(maps: ModuleMaps['maps'], lineStarts: readonly number[], offset: number): string | null {
  const { line, column } = positionOf(lineStarts, offset);
  const mapping = mappingAt(maps, line, column + 1);
  if (!mapping || !mapping.exact) return null;
  if (mapping.name) return mapping.name;
  if (mapping.sourceContent === null) return null;
  const authoredOffset = offsetOf(mapping.sourceContent, mapping.line, mapping.column - 1);
  if (authoredOffset === null) return null;
  return LEADING_IDENTIFIER.exec(mapping.sourceContent.slice(authoredOffset, authoredOffset + 200))?.[0] ?? null;
}

/** Map one occurrence of `text` to its authored definition and name. */
export function nameOccurrence(
  text: string,
  occurrence: Occurrence,
  lineStarts: readonly number[],
): OccurrenceOrigin {
  const { script, module, offset } = occurrence;
  const generated = positionOf(lineStarts, offset);
  const found: OccurrenceOrigin = {
    status: 'resolved', name: null, nameEvidence: null, definition: null,
    script: script.text === null ? script.url : script.key,
    generated: { line: generated.line, column: generated.column + 1 },
  };
  if (module.maps.length === 0) return { ...found, status: 'no-source-map' };

  const mapping = mappingAt(module.maps, generated.line, generated.column + 1);
  if (!mapping) return { ...found, status: 'unmapped' };
  const definition: ComponentDefinition = {
    fileName: sourcePath(mapping.source, module.sourceBaseUrl),
    lineNumber: mapping.line,
    columnNumber: mapping.column,
  };

  const ownMatch = OWN_FUNCTION_NAME.exec(text) ?? OWN_CLASS_NAME.exec(text);
  const ownOffset = ownMatch ? offset + ownMatch[0].lastIndexOf(ownMatch[1]!) : null;
  const lookback = module.code.slice(Math.max(0, offset - GENERATED_LOOKBACK), offset);
  const bindingMatch = GENERATED_BINDING.exec(lookback);
  const bindingOffset = bindingMatch
    ? offset - lookback.length + bindingMatch.index + bindingMatch[0].indexOf(bindingMatch[1]!)
    : null;
  const authored = authoredNames(mapping);

  const candidates: Array<[NameEvidence, () => string | null]> = [
    ['map-name', () => (ownOffset === null ? null : mappedNameAt(module.maps, lineStarts, ownOffset))],
    ['source-text', () => authored.own],
    ['binding-map-name', () => (bindingOffset === null ? null : mappedNameAt(module.maps, lineStarts, bindingOffset))],
    ['binding-source-text', () => authored.binding],
  ];
  for (const [evidence, read] of candidates) {
    const name = read();
    if (name) return { ...found, name, nameEvidence: evidence, definition };
  }
  return { ...found, definition };
}
