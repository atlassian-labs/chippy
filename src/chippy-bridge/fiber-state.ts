/**
 * Compact, read-only React fiber state capture and structural comparison.
 *
 * Captures retain hashes and short previews rather than complete prop values.
 * This makes them suitable for helper-side retention while comparison results
 * stay small enough to use as an investigation index.
 */

import { getFiberSourceCandidate } from './fiber-source';

type Fiber = {
  tag?: number;
  key?: unknown;
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;
  current?: Fiber | null;
  _debugSource?: SourceLike | null;
  _debugStack?: unknown;
};

type SourceLike = {
  fileName?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
};

export type FiberStateProp = {
  kind: string;
  hash: string;
  preview: string;
  truncated: boolean;
};

export type FiberStateEntry = {
  id: string;
  token: string;
  name: string;
  key: string | null;
  tag: number | null;
  source: { fileName: string; lineNumber: number | null; columnNumber: number | null } | null;
  props: Record<string, FiberStateProp>;
};

export type FiberStateCapture = {
  version: 1;
  capturedAt: string;
  page: { url: string | null; title: string | null };
  fiberCount: number;
  truncated: boolean;
  fibers: FiberStateEntry[];
};

export type CaptureFiberStateDeps = {
  getRootFibers: () => Fiber[];
  getDisplayName: (fiber: Fiber) => string | null;
};

export type FiberStateDiff = {
  ok: true;
  before: FiberStateCapture['page'] & { capturedAt: string };
  after: FiberStateCapture['page'] & { capturedAt: string };
  summary: {
    beforeFibers: number;
    afterFibers: number;
    matchedFibers: number;
    changedFibers: number;
    addedFibers: number;
    removedFibers: number;
    propChanges: number;
    returnedChanges: number;
    captureTruncated: boolean;
    changesTruncated: boolean;
    truncated: boolean;
  };
  changes: Array<Record<string, unknown>>;
};

type FingerprintBudget = { remaining: number; truncated: boolean };

function fnv1a(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function valueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof RegExp) return 'regexp';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  if (typeof value === 'object' && value && '$$typeof' in value) return 'element';
  return typeof value;
}

function previewValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value.length > 100 ? value.slice(0, 100) + '…' : value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[function:${value.name || 'anonymous'}/${value.length}]`;
  if (typeof value === 'symbol') return String(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 6).map((item) => {
      if (item === null || item === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof item)) {
        return previewValue(item);
      }
      return `[${valueKind(item)}]`;
    });
    return `[${items.join(', ')}${value.length > 6 ? ', …' : ''}]`;
  }
  if (value instanceof Map) return `{Map:${value.size}}`;
  if (value instanceof Set) return `{Set:${value.size}}`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('$$typeof' in object) {
      const type = object.type as { displayName?: string; name?: string } | string | undefined;
      const name = typeof type === 'string' ? type : type?.displayName || type?.name || 'element';
      return `<${name}>`;
    }
    let keys: string[] = [];
    try { keys = Object.keys(object); } catch { return '{unreadable}'; }
    const shown = keys.slice(0, 6).map((key) => {
      let item: unknown;
      try { item = object[key]; } catch { return `${key}:[error]`; }
      if (item === null || item === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof item)) {
        return `${key}:${previewValue(item)}`;
      }
      return `${key}:[${valueKind(item)}]`;
    });
    return `{${shown.join(', ')}${keys.length > 6 ? ', …' : ''}}`;
  }
  return String(value);
}

function canonicalValue(value: unknown, seen: Map<object, number>, budget: FingerprintBudget, depth = 0): string {
  if (budget.remaining-- <= 0 || depth > 12) {
    budget.truncated = true;
    return '[truncated]';
  }
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'undefined') return 'undefined';
  if (type === 'string') return `string:${value as string}`;
  if (type === 'number') return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  if (type === 'boolean' || type === 'bigint') return `${type}:${String(value)}`;
  if (type === 'symbol') return `symbol:${String(value)}`;
  if (type === 'function') {
    const fn = value as Function;
    return `function:${fn.name || 'anonymous'}:${fn.length}`;
  }

  const object = value as Record<string, unknown>;
  if (typeof object.nodeType === 'number' && typeof object.nodeName === 'string') {
    const element = object as Record<string, any>;
    return `dom:${object.nodeType}:${object.nodeName}:${String(element.id || '')}:${String(element.getAttribute?.('data-testid') || '')}`;
  }
  if ((object as any).window === object) return '[window]';
  const objectTag = Object.prototype.toString.call(object);
  if (objectTag === '[object Promise]' || objectTag === '[object WeakMap]' || objectTag === '[object WeakSet]') return objectTag;
  const seenId = seen.get(object);
  if (seenId != null) return `[ref:${seenId}]`;
  seen.set(object, seen.size + 1);

  if (Array.isArray(object)) {
    return `array:${object.length}:[${object.map((item) => canonicalValue(item, seen, budget, depth + 1)).join(',')}]`;
  }
  if (object instanceof Date) return `date:${object.toISOString()}`;
  if (object instanceof RegExp) return `regexp:${String(object)}`;
  if (object instanceof Map) {
    const entries = Array.from(object.entries()).map(([key, item]) =>
      `${canonicalValue(key, seen, budget, depth + 1)}=>${canonicalValue(item, seen, budget, depth + 1)}`,
    ).sort();
    return `map:${object.size}:{${entries.join(',')}}`;
  }
  if (object instanceof Set) {
    const entries = Array.from(object.values()).map((item) => canonicalValue(item, seen, budget, depth + 1)).sort();
    return `set:${object.size}:{${entries.join(',')}}`;
  }
  if ('$$typeof' in object) {
    const elementType = object.type as { displayName?: string; name?: string } | string | undefined;
    const name = typeof elementType === 'string' ? elementType : elementType?.displayName || elementType?.name || 'element';
    return `element:${name}:${String(object.key ?? '')}:${canonicalValue(object.props, seen, budget, depth + 1)}`;
  }

  let keys: string[];
  try { keys = Object.keys(object).sort(); } catch {
    budget.truncated = true;
    return '[unreadable-object]';
  }
  const fields: string[] = [];
  for (const key of keys) {
    if (budget.remaining <= 0) { budget.truncated = true; break; }
    let item: unknown;
    try { item = object[key]; } catch { item = '[getter-threw]'; }
    fields.push(`${key}:${canonicalValue(item, seen, budget, depth + 1)}`);
  }
  const ctor = object.constructor && object.constructor !== Object ? object.constructor.name : 'object';
  return `${ctor}:{${fields.join(',')}}`;
}

export function fingerprintFiberProp(value: unknown): FiberStateProp {
  const budget: FingerprintBudget = { remaining: 10_000, truncated: false };
  const canonical = canonicalValue(value, new Map(), budget);
  return {
    kind: valueKind(value),
    hash: fnv1a(canonical),
    preview: previewValue(value),
    truncated: budget.truncated,
  };
}

function readSource(fiber: Fiber): FiberStateEntry['source'] {
  // Capture identity must not change merely because an async map lookup warmed
  // between two captures. The generated React 19 call site is stable for this
  // structural token; presentation paths may use the mapped location.
  return getFiberSourceCandidate(fiber);
}

function fiberToken(fiber: Fiber, name: string, source: FiberStateEntry['source']): string {
  const sourceKey = source ? `${source.fileName}:${source.lineNumber ?? ''}:${source.columnNumber ?? ''}` : '';
  return [String(fiber.tag ?? ''), name, String(fiber.key ?? ''), sourceKey].join('|');
}

export function captureFiberState(
  options: { page?: { url?: unknown; title?: unknown }; maxFibers?: unknown } | null | undefined,
  deps: CaptureFiberStateDeps,
): FiberStateCapture {
  const maxFibers = Number.isFinite(Number(options?.maxFibers))
    ? Math.max(1, Math.floor(Number(options?.maxFibers)))
    : 100_000;
  const fibers: FiberStateEntry[] = [];
  let truncated = false;

  type Pending = { fiber: Fiber; parentPath: string };
  const stack: Pending[] = deps.getRootFibers().slice().reverse().map((root) => ({ fiber: root.current || root, parentPath: 'root' }));
  const siblingOccurrences = new Map<string, number>();
  const visited = new Set<Fiber>();

  while (stack.length) {
    const { fiber, parentPath } = stack.pop()!;
    if (visited.has(fiber) || (fiber.alternate && visited.has(fiber.alternate))) continue;
    visited.add(fiber);
    if (fiber.alternate) visited.add(fiber.alternate);
    const name = deps.getDisplayName(fiber);
    let nextParentPath = parentPath;
    if (name) {
      if (fibers.length >= maxFibers) { truncated = true; break; }
      const source = readSource(fiber);
      const token = fiberToken(fiber, name, source);
      const occurrenceKey = `${parentPath}\u0000${token}`;
      const occurrence = siblingOccurrences.get(occurrenceKey) || 0;
      siblingOccurrences.set(occurrenceKey, occurrence + 1);
      const id = `${parentPath}/${fnv1a(token)}:${occurrence}`;
      const props: Record<string, FiberStateProp> = {};
      const memoizedProps = fiber.memoizedProps;
      if (memoizedProps && typeof memoizedProps === 'object') {
        let propNames: string[] = [];
        try { propNames = Object.keys(memoizedProps).sort(); } catch { propNames = []; }
        for (const propName of propNames) {
          let value: unknown;
          try { value = memoizedProps[propName]; } catch { value = '[getter-threw]'; }
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
        props,
      });
      nextParentPath = id;
    }

    const children: Fiber[] = [];
    let child = fiber.child || null;
    while (child) { children.push(child); child = child.sibling || null; }
    for (let i = children.length - 1; i >= 0; i--) stack.push({ fiber: children[i], parentPath: nextParentPath });
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    page: {
      url: options?.page?.url == null ? null : String(options.page.url),
      title: options?.page?.title == null ? null : String(options.page.title),
    },
    fiberCount: fibers.length,
    truncated,
    fibers,
  };
}

function publicFiber(entry: FiberStateEntry): Record<string, unknown> {
  return { id: entry.id, name: entry.name, key: entry.key, source: entry.source };
}

export function compareFiberStates(
  before: FiberStateCapture,
  after: FiberStateCapture,
  options?: { maxChanges?: unknown },
): FiberStateDiff | { ok: false; error: string } {
  if (before?.version !== 1 || after?.version !== 1 || !Array.isArray(before?.fibers) || !Array.isArray(after?.fibers)) {
    return { ok: false, error: 'Two valid fiber state captures are required' };
  }
  const maxChanges = Number.isFinite(Number(options?.maxChanges))
    ? Math.max(1, Math.floor(Number(options?.maxChanges)))
    : 200;
  const beforeById = new Map(before.fibers.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.fibers.map((entry) => [entry.id, entry]));
  const matched = new Map<FiberStateEntry, { after: FiberStateEntry; confidence: 'path' | 'unique-token' }>();
  const usedAfter = new Set<FiberStateEntry>();

  for (const entry of before.fibers) {
    const candidate = afterById.get(entry.id);
    if (candidate && candidate.token === entry.token) {
      matched.set(entry, { after: candidate, confidence: 'path' });
      usedAfter.add(candidate);
    }
  }

  const unmatchedBeforeByToken = new Map<string, FiberStateEntry[]>();
  const unmatchedAfterByToken = new Map<string, FiberStateEntry[]>();
  for (const entry of before.fibers) {
    if (matched.has(entry)) continue;
    const list = unmatchedBeforeByToken.get(entry.token) || [];
    list.push(entry); unmatchedBeforeByToken.set(entry.token, list);
  }
  for (const entry of after.fibers) {
    if (usedAfter.has(entry)) continue;
    const list = unmatchedAfterByToken.get(entry.token) || [];
    list.push(entry); unmatchedAfterByToken.set(entry.token, list);
  }
  for (const [token, beforeEntries] of unmatchedBeforeByToken) {
    const afterEntries = unmatchedAfterByToken.get(token);
    if (beforeEntries.length === 1 && afterEntries?.length === 1) {
      matched.set(beforeEntries[0], { after: afterEntries[0], confidence: 'unique-token' });
      usedAfter.add(afterEntries[0]);
    }
  }

  const allChanges: Array<Record<string, unknown>> = [];
  let changedFibers = 0;
  let propChanges = 0;
  for (const [beforeEntry, match] of matched) {
    const added: Array<Record<string, unknown>> = [];
    const removed: Array<Record<string, unknown>> = [];
    const changed: Array<Record<string, unknown>> = [];
    const names = new Set([...Object.keys(beforeEntry.props), ...Object.keys(match.after.props)]);
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
      kind: 'props-changed',
      match: match.confidence,
      fiber: { before: publicFiber(beforeEntry), after: publicFiber(match.after) },
      props: { added, removed, changed },
    });
  }

  const removedFibers = before.fibers.filter((entry) => !matched.has(entry));
  const addedFibers = after.fibers.filter((entry) => !usedAfter.has(entry));
  for (const entry of addedFibers) {
    allChanges.push({ kind: 'fiber-added', fiber: publicFiber(entry), propNames: Object.keys(entry.props) });
  }
  for (const entry of removedFibers) {
    allChanges.push({ kind: 'fiber-removed', fiber: publicFiber(entry), propNames: Object.keys(entry.props) });
  }

  const rankChange = (change: Record<string, any>): number => {
    if (change.kind !== 'props-changed') return change.kind === 'fiber-added' ? 5 : 4;
    const propRows = [
      ...(change.props?.added || []).map((row: any) => row.after),
      ...(change.props?.removed || []).map((row: any) => row.before),
      ...(change.props?.changed || []).flatMap((row: any) => [row.before, row.after]),
    ].filter(Boolean);
    const complete = propRows.some((row: FiberStateProp) => !row.truncated) ? 100 : 0;
    const primitive = propRows.some((row: FiberStateProp) => ['string', 'number', 'boolean', 'null', 'undefined'].includes(row.kind)) ? 40 : 0;
    const sourced = change.fiber?.after?.source || change.fiber?.before?.source ? 20 : 0;
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
      truncated: captureTruncated || changesTruncated,
    },
    changes,
  };
}
