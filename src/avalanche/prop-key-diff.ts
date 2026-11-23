/**
 * Shallow key diff for an object or array prop whose identity changed.
 *
 * `ref-changed` alone cannot tell a new object with the same values (a wasted
 * render) from a real state change. This compares the two values one level
 * deep, key by key with `Object.is`, and reports which keys differ:
 *
 *   { sameShallow: true, changedKeys: [], changedKeyCount: 0 }      only the identity changed
 *   { changedKeys: [{ key: 'theme', kind: 'scalar-changed', prev: '"light"', current: '"dark"' }], changedKeyCount: 1 }
 *
 * Only plain objects and arrays are compared, never React elements, class
 * instances, Maps, or Sets. Values with more than `MAX_COMPARED_KEYS` keys
 * are not compared and report `keysNotCompared` instead, so one huge object
 * cannot slow down a commit. Children that receive the same object pair in
 * one commit share one result.
 */

import type { PropValueSummarizer } from './prop-summary';

export type PropKeyChangeKind = 'scalar-changed' | 'ref-changed' | 'added' | 'removed';

/**
 * One key whose value differs. `scalar-changed` has `prev` and `current`,
 * `added` has `current`, `removed` has `prev`, and `ref-changed` (a nested
 * object or function with a new identity) has neither.
 */
export interface PropKeyChange {
  key: string;
  kind: PropKeyChangeKind;
  prev?: string;
  current?: string;
}

/** The fields a key diff adds to a `ref-changed` prop change. */
export interface PropKeyDiff {
  /** Present, and true, when every key holds the same value: only the identity changed. */
  sameShallow?: true;
  /** The first `MAX_LISTED_KEYS` keys that differ, in key order; empty when `sameShallow`. */
  changedKeys?: PropKeyChange[];
  /** How many keys differ in total. */
  changedKeyCount?: number;
  /** Present, and true, when `changedKeys` lists fewer keys than `changedKeyCount`. */
  changedKeysTruncated?: true;
  /** Set instead of the fields above when a value has too many keys to compare: its key count. */
  keysNotCompared?: number;
}

export const MAX_LISTED_KEYS = 8;
export const MAX_COMPARED_KEYS = 1000;

export type PropKeyDiffer = (prev: unknown, current: unknown) => PropKeyDiff | null;

const hasOwn = Object.prototype.hasOwnProperty;

/** A plain object from any realm: its prototype is null or a root prototype. */
function isPlainObject(value: object): boolean {
  if ('$$typeof' in value) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function sameKeyOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isScalar(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

export function createPropKeyDiffer(summarize: PropValueSummarizer): PropKeyDiffer {
  // Keyed by the current value; one entry remembers the previous value it was
  // compared with. Garbage collected with the props.
  const byCurrent = new WeakMap<object, { prev: object; diff: PropKeyDiff }>();

  function change(key: string, prevValue: unknown, currentValue: unknown, missing: 'prev' | 'current' | null): PropKeyChange {
    if (missing === 'prev') return { key, kind: 'added', current: summarize(currentValue) };
    if (missing === 'current') return { key, kind: 'removed', prev: summarize(prevValue) };
    if (isScalar(prevValue) && isScalar(currentValue)) {
      return { key, kind: 'scalar-changed', prev: summarize(prevValue), current: summarize(currentValue) };
    }
    return { key, kind: 'ref-changed' };
  }

  function finish(changed: PropKeyChange[], count: number): PropKeyDiff {
    if (count === 0) return { sameShallow: true, changedKeys: changed, changedKeyCount: 0 };
    return count > changed.length
      ? { changedKeys: changed, changedKeyCount: count, changedKeysTruncated: true }
      : { changedKeys: changed, changedKeyCount: count };
  }

  function diffArrays(prev: unknown[], current: unknown[]): PropKeyDiff {
    const length = Math.max(prev.length, current.length);
    if (length > MAX_COMPARED_KEYS) return { keysNotCompared: length };
    const changed: PropKeyChange[] = [];
    let count = 0;
    for (let i = 0; i < length; i++) {
      const inPrev = i < prev.length;
      const inCurrent = i < current.length;
      if (inPrev && inCurrent && Object.is(prev[i], current[i])) continue;
      count++;
      if (changed.length < MAX_LISTED_KEYS) {
        changed.push(change(String(i), prev[i], current[i], inPrev ? (inCurrent ? null : 'current') : 'prev'));
      }
    }
    return finish(changed, count);
  }

  function diffObjects(prev: Record<string, unknown>, current: Record<string, unknown>): PropKeyDiff {
    // `Object.keys` is served from V8's enum cache (the prop summary has just
    // read the same keys) and is several times faster than `for...in` on
    // objects with many keys.
    const prevKeys = Object.keys(prev);
    const currentKeys = Object.keys(current);
    const keys = Math.max(prevKeys.length, currentKeys.length);
    if (keys > MAX_COMPARED_KEYS) return { keysNotCompared: keys };
    const changed: PropKeyChange[] = [];
    let count = 0;
    if (sameKeyOrder(prevKeys, currentKeys)) {
      // The usual rebuild (`{ ...state, x }`) keeps the key order: compare
      // values by position, without a keyed lookup per key.
      const prevValues = Object.values(prev);
      const currentValues = Object.values(current);
      for (let i = 0; i < prevValues.length; i++) {
        if (Object.is(prevValues[i], currentValues[i])) continue;
        count++;
        if (changed.length < MAX_LISTED_KEYS) changed.push(change(prevKeys[i], prevValues[i], currentValues[i], null));
      }
      return finish(changed, count);
    }
    let removed = 0;
    for (let i = 0; i < prevKeys.length; i++) {
      const key = prevKeys[i];
      const inCurrent = hasOwn.call(current, key);
      if (inCurrent && Object.is(prev[key], current[key])) continue;
      count++;
      if (!inCurrent) removed++;
      if (changed.length < MAX_LISTED_KEYS) changed.push(change(key, prev[key], current[key], inCurrent ? null : 'current'));
    }
    // Every current key is also a previous key unless the current object has
    // more keys than the previous keys it kept.
    if (currentKeys.length > prevKeys.length - removed) {
      for (let i = 0; i < currentKeys.length; i++) {
        const key = currentKeys[i];
        if (hasOwn.call(prev, key)) continue;
        count++;
        if (changed.length < MAX_LISTED_KEYS) changed.push(change(key, undefined, current[key], 'prev'));
      }
    }
    return finish(changed, count);
  }

  return (prev, current) => {
    if (!prev || !current || typeof prev !== 'object' || typeof current !== 'object' || prev === current) return null;
    const prevIsArray = Array.isArray(prev);
    if (prevIsArray !== Array.isArray(current)) return null;
    if (!prevIsArray && (!isPlainObject(prev) || !isPlainObject(current))) return null;

    const cached = byCurrent.get(current);
    if (cached && cached.prev === prev) return cached.diff;
    let diff: PropKeyDiff;
    try {
      diff = prevIsArray
        ? diffArrays(prev as unknown[], current as unknown[])
        : diffObjects(prev as Record<string, unknown>, current as Record<string, unknown>);
    } catch {
      // A getter or proxy trap threw; the prop change stays without a key diff.
      return null;
    }
    byCurrent.set(current, { prev, diff });
    return diff;
  };
}
