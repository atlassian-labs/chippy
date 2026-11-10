/**
 * Grep-able strings from a component's own code.
 *
 * Minifiers rename identifiers but keep string literals: class names, test
 * ids, visible text, and translation keys survive into the production bundle
 * unchanged. Searching the authored repository for them points at the
 * component even when the page serves no source map.
 */

import { componentFunctionOf } from './component-origin';

/** Strings returned per component. */
export const MAX_COMPONENT_STRINGS = 12;
const MIN_LENGTH = 2;
const MAX_LENGTH = 120;

/** Literals React and the JS runtime emit for every component; not distinctive. */
const NOISE = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'circle',
  'code', 'col', 'dd', 'defs', 'details', 'dialog', 'div', 'dl', 'dt', 'em', 'fieldset', 'figure', 'footer',
  'form', 'g', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'label', 'legend', 'li', 'line', 'link', 'main', 'mask', 'meta', 'nav', 'ol', 'option', 'p',
  'path', 'pre', 'polygon', 'polyline', 'rect', 'section', 'select', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
  'use', 'video', 'function', 'object', 'string', 'number', 'boolean', 'undefined', 'symbol', 'bigint',
  'use strict', 'default', 'children',
]);

type Literal = { value: string; key: boolean; end: number };

function skipSpace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

function previousSignificant(text: string, index: number): string {
  let at = index - 1;
  while (at >= 0 && /\s/.test(text[at]!)) at -= 1;
  return at >= 0 ? text[at]! : '';
}

/** End of a quoted string starting at `start`, or -1 when it is unterminated. */
function quotedEnd(text: string, start: number, quote: string): number {
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === '\\') at += 1;
    else if (char === quote) return at;
    else if (char === '\n' && quote !== '`') return -1;
  }
  return -1;
}

/** Static chunks of a template literal, and where it ends. */
function templateChunks(text: string, start: number): { chunks: string[]; end: number } {
  const chunks: string[] = [];
  let chunk = '';
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === '\\') {
      chunk += text.slice(at, at + 2);
      at += 1;
    } else if (char === '`') {
      chunks.push(chunk);
      return { chunks, end: at };
    } else if (char === '$' && text[at + 1] === '{') {
      chunks.push(chunk);
      chunk = '';
      let depth = 1;
      for (at += 2; at < text.length && depth > 0; at += 1) {
        if (text[at] === '{') depth += 1;
        else if (text[at] === '}') depth -= 1;
      }
      at -= 1;
    } else {
      chunk += char;
    }
  }
  return { chunks, end: text.length };
}

const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|case|void|delete|throw|in|of|new|yield|await)\s*$/;

/** True when a `/` at `index` starts a regular expression rather than a division. */
function startsRegex(text: string, index: number): boolean {
  const before = previousSignificant(text, index);
  return before === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(before) || REGEX_KEYWORD.test(text.slice(Math.max(0, index - 12), index));
}

/** End of a regular expression literal starting at `start`. */
function regexEnd(text: string, start: number): number {
  let inClass = false;
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === '\\') at += 1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return at;
    else if (char === '\n') return start;
  }
  return start;
}

/** String literals in source order, with whether each is an object key. */
export function stringLiterals(text: string): Literal[] {
  const out: Literal[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === '/' && text[at + 1] === '/') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
    } else if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 1;
    } else if (char === '/' && startsRegex(text, at)) {
      at = regexEnd(text, at);
    } else if (char === '"' || char === "'") {
      const end = quotedEnd(text, at, char);
      if (end === -1) continue;
      const before = previousSignificant(text, at);
      const key = (before === '{' || before === ',') && text[skipSpace(text, end + 1)] === ':';
      out.push({ value: text.slice(at + 1, end), key, end });
      at = end;
    } else if (char === '`') {
      const { chunks, end } = templateChunks(text, at);
      for (const chunk of chunks) out.push({ value: chunk, key: false, end });
      at = end;
    }
  }
  return out;
}

function distinctive(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return false;
  if (!/[A-Za-z]/.test(trimmed) || NOISE.has(trimmed)) return false;
  return !/^react\./.test(trimmed);
}

/**
 * Distinctive strings from function text, in source order. A dashed attribute
 * with a literal value, such as `data-testid`, is kept as `name="value"`, the
 * way JSX writes it.
 */
export function componentStringsOf(text: string, max = MAX_COMPONENT_STRINGS): { strings: string[]; omitted: number } {
  const literals = stringLiterals(text);
  const seen = new Set<string>();
  const strings: string[] = [];
  for (let index = 0; index < literals.length; index += 1) {
    const literal = literals[index]!;
    let value: string | null = null;
    if (literal.key) {
      const next = literals[index + 1];
      const colon = skipSpace(text, literal.end + 1);
      const valueStart = skipSpace(text, colon + 1);
      if (literal.value.includes('-') && next && !next.key && next.end > valueStart && /["']/.test(text[valueStart] ?? '')) {
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

/** Distinctive strings from a component type's own code, unwrapping memo and forwardRef. */
export function componentStrings(type: unknown, max = MAX_COMPONENT_STRINGS): { strings: string[]; omitted: number } {
  const fn = componentFunctionOf(type);
  if (!fn) return { strings: [], omitted: 0 };
  try {
    return componentStringsOf(Function.prototype.toString.call(fn), max);
  } catch {
    return { strings: [], omitted: 0 };
  }
}
