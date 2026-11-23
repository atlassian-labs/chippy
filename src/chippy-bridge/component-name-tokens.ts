/**
 * Component names mentioned in a command result.
 *
 * Avalanche results name components in source ids (`Item#1@3`), DOM anchors
 * (`App › TodoList › Item`), labels, and plain `name` fields. These helpers
 * collect the identifier-like words of a result, so a caller can recover
 * names for just the components it mentions and list the renames that apply
 * to it.
 */

import type { ComponentRename } from '../avalanche/rendered-names';

const MAX_TOKENS = 5000;
const MAX_TOKEN_LENGTH = 80;
const MAX_DEPTH = 12;
const SEPARATORS = /[^\w$]+/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// A report's own rename table lists every recovered name; it is not a mention.
const RENAME_TABLE_KEY = 'componentNames';

/**
 * Identifier-like words in the strings and keys of `value`, leaving out any
 * nested `componentNames` table.
 */
export function nameTokensIn(value: unknown, limit = MAX_TOKENS): Set<string> {
  const found = new Set<string>();
  const seen = new Set<object>();
  const addWords = (text: string) => {
    for (const word of text.split(SEPARATORS)) {
      if (found.size >= limit) return;
      if (word.length <= MAX_TOKEN_LENGTH && IDENTIFIER.test(word)) found.add(word);
    }
  };
  const visit = (node: unknown, depth: number): void => {
    if (found.size >= limit) return;
    if (typeof node === 'string') {
      addWords(node);
      return;
    }
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || seen.has(node)) return;
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

function isRename(value: unknown): value is ComponentRename {
  const rename = value as ComponentRename | null;
  return !!rename && typeof rename.name === 'string' && typeof rename.minifiedName === 'string';
}

/**
 * The renames whose authored name appears in `value`. `renames` is a report's
 * `meta.componentNames`, possibly from a saved file.
 */
export function componentNamesIn(value: unknown, renames: unknown): ComponentRename[] {
  if (!Array.isArray(renames) || renames.length === 0) return [];
  const tokens = nameTokensIn(value);
  return renames.filter((rename): rename is ComponentRename => isRename(rename) && tokens.has(rename.name));
}
