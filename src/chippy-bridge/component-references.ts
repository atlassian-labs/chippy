/**
 * Authored identifiers a component's code references.
 *
 * Reads the names behind one occurrence of a component function's text: the
 * source map's `names` entries for segments inside the function, and the
 * identifiers in the authored span those segments map to. Used to tell which
 * component an ancestor renders when identical minified text maps to several
 * authored components.
 */

import { mappingsInRange } from './source-map';
import { offsetOf, positionOf, type Occurrence } from './component-occurrence';

const IDENTIFIERS = /[A-Za-z_$][\w$]*/g;
const LAST_TOKEN = /^[A-Za-z_$][\w$]*/;
/** Authored span read per occurrence; larger bodies keep only map names. */
const MAX_AUTHORED_SPAN = 200_000;

/** Authored identifiers referenced by the function whose text starts at the occurrence. */
export function referencedNames(
  text: string,
  occurrence: Occurrence,
  lineStarts: readonly number[],
): Set<string> {
  const names = new Set<string>();
  const { module, offset } = occurrence;
  if (module.maps.length === 0) return names;
  const toPosition = (at: number) => {
    const { line, column } = positionOf(lineStarts, at);
    return { line, column: column + 1 };
  };
  const mappings = mappingsInRange(module.maps, toPosition(offset), toPosition(offset + text.length));
  for (const mapping of mappings) {
    if (mapping.name) names.add(mapping.name);
  }

  // Identifiers in the authored span, for maps without `names` entries.
  const first = mappings[0];
  if (!first?.sourceContent) return names;
  let low = first;
  let high = first;
  for (const mapping of mappings) {
    if (mapping.source !== first.source) continue;
    if (mapping.line < low.line || (mapping.line === low.line && mapping.column < low.column)) low = mapping;
    if (mapping.line > high.line || (mapping.line === high.line && mapping.column > high.column)) high = mapping;
  }
  const start = offsetOf(first.sourceContent, low.line, low.column - 1);
  const end = offsetOf(first.sourceContent, high.line, high.column - 1);
  if (start === null || end === null || end - start > MAX_AUTHORED_SPAN) return names;
  // `end` is where the last mapped token starts; include that token only.
  const last = LAST_TOKEN.exec(first.sourceContent.slice(end, end + 200))?.[0] ?? '';
  const span = first.sourceContent.slice(start, end) + last;
  for (const match of span.matchAll(IDENTIFIERS)) names.add(match[0]);
  return names;
}
