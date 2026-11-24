/**
 * Records what the page writes to the console while Avalanche records commits:
 * `console.error`, `warn`, `info`, `log`, and `debug`, uncaught errors, and
 * unhandled promise rejections.
 *
 * Install wraps the five console methods; each wrapper records the call and
 * then calls the method it replaced, so the message still reaches DevTools.
 * DevTools then names Chippy's bundle as the caller unless that bundle is on
 * its ignore list; the recorded `location` names the real caller. Uninstall
 * restores a method only while it is still Chippy's wrapper; a method another
 * script wrapped later keeps that script's wrapper, and Chippy's stops
 * recording.
 *
 * Messages are formatted on arrival, with `%s`-style substitution, because
 * logged objects change later. Errors and warnings keep a stack; other levels
 * skip it to keep the wrapper cheap. Consecutive identical messages collapse
 * into one entry with a `repeat` count. Entries keep the `performance.now()`
 * clock commits use; `console-signals.ts` joins them to commits on read.
 */

import { isChippyAssetUrl } from './own-requests';

export const CONSOLE_LEVELS = ['error', 'warn', 'info', 'log', 'debug'] as const;
export type ConsoleLevel = typeof CONSOLE_LEVELS[number];
export type ConsoleSource = 'console' | 'uncaught' | 'rejection';

export const DEFAULT_MAX_CONSOLE_ENTRIES_PER_LEVEL = 200;
const MAX_MESSAGE = 1500;
const MAX_PREVIEW = 200;
const MAX_STACK_FRAMES = 8;
const STACK_LEVELS: ReadonlySet<ConsoleLevel> = new Set(['error', 'warn']);
// Prefixes of the messages Chippy's own page code logs.
const OWN_PREFIXES = ['[avalanche] ', '[Chippy ', '[chippy'];

export interface ConsoleCaptureOptions {
  /** Record console messages and uncaught errors during capture. Default true. */
  consoleCapture?: boolean;
  /** Entries kept per level; the oldest of that level are dropped first. Default 200. */
  maxConsoleEntries?: number;
}

/** One console message, uncaught error, or unhandled rejection. */
export interface ConsoleEntry {
  /** Sequential id within this capture. */
  id: number;
  /** Uncaught errors and rejections are `error`. */
  level: ConsoleLevel;
  source: ConsoleSource;
  /** performance.now() of the first occurrence. */
  time: number;
  /** Occurrences collapsed into this entry; 1 when the message was not repeated. */
  repeat: number;
  /** performance.now() of the last occurrence, when `repeat` > 1. */
  lastTime?: number;
  /** The formatted message, cut to 1500 characters. */
  message: string;
  /** The logged Error's stack, or the call site's, first eight frames. Null for info, log, and debug. */
  stack: string | null;
  /** `url:line:column` of the first frame outside Chippy, or of the uncaught error. */
  location: string | null;
  /**
   * True when Chippy's own code wrote it: its log prefixes, or a direct caller
   * in Chippy's bundle (a hook replay's render warnings). Detected only for
   * errors and warnings, and only when Chippy loads from its own URL.
   */
  chippy?: true;
}

export interface ConsoleCaptureStatus {
  /** Whether capture is switched on for this detector. */
  enabled: boolean;
  /** Whether the console wrappers and error listeners are in place. */
  installed: boolean;
  /** performance.now() when the capture window opened (install or reset). */
  windowStart: number;
  /** Entries currently kept. */
  entries: number;
  /** Entries kept, by level. */
  byLevel: Partial<Record<ConsoleLevel, number>>;
  /** Entries dropped, by level, because more than `maxConsoleEntries` of that level arrived. */
  dropped: Partial<Record<ConsoleLevel, number>>;
  /** performance.now() when the capture was paused, or null while it records. */
  pausedAt: number | null;
}

type ConsoleMethod = (...args: unknown[]) => void;
type Target = {
  console?: Partial<Record<ConsoleLevel, ConsoleMethod>>;
  addEventListener?: (type: string, listener: (event: any) => void, capture?: boolean) => void;
  removeEventListener?: (type: string, listener: (event: any) => void, capture?: boolean) => void;
};

const round = (value: number): number => Math.round(value * 10) / 10;
const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) + '…' : text);

function errorText(error: { name?: unknown; message?: unknown }): string {
  const name = typeof error.name === 'string' && error.name ? error.name : 'Error';
  return typeof error.message === 'string' && error.message ? `${name}: ${error.message}` : name;
}

function isError(value: unknown): value is Error {
  return value instanceof Error || (!!value && typeof value === 'object' && typeof (value as Error).stack === 'string' && typeof (value as Error).message === 'string');
}

function elementText(node: { tagName?: unknown; id?: unknown; getAttribute?: (name: string) => string | null }): string {
  const tag = String(node.tagName).toLowerCase();
  const id = typeof node.id === 'string' && node.id ? `#${node.id}` : '';
  const testId = node.getAttribute?.('data-testid');
  return `<${tag}${id}${testId ? ` data-testid="${testId}"` : ''}>`;
}

/** A short, bounded preview of a logged value; never walks more than the budget. */
export function previewValue(value: unknown, budget = MAX_PREVIEW): string {
  const seen = new Set<unknown>();
  let out = '';
  const push = (text: string): boolean => {
    out += text;
    return out.length < budget;
  };
  const walk = (v: unknown, depth: number): boolean => {
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return push(String(v));
    if (typeof v === 'string') return push(depth === 0 ? v : JSON.stringify(v));
    if (typeof v === 'symbol') return push(v.toString());
    if (typeof v === 'function') return push(`ƒ ${v.name || 'anonymous'}()`);
    if (isError(v)) return push(errorText(v));
    if (typeof v !== 'object') return push(String(v));
    if ((v as { nodeType?: unknown }).nodeType === 1 && 'tagName' in v) return push(elementText(v as never));
    if (seen.has(v)) return push('[Circular]');
    if (depth >= 2) return push(Array.isArray(v) ? `Array(${v.length})` : '{…}');
    seen.add(v);
    if (Array.isArray(v)) {
      if (!push('[')) return false;
      for (let i = 0; i < v.length; i++) {
        if (i > 0 && !push(', ')) return false;
        if (!walk(v[i], depth + 1)) return false;
      }
      return push(']');
    }
    let keys: string[];
    try { keys = Object.keys(v); } catch { return push('{…}'); }
    if (!push('{')) return false;
    for (let i = 0; i < keys.length; i++) {
      if (i > 0 && !push(', ')) return false;
      let item: unknown;
      try { item = (v as Record<string, unknown>)[keys[i]]; } catch { item = '[getter threw]'; }
      if (!push(`${keys[i]}: `) || !walk(item, depth + 1)) return false;
    }
    return push('}');
  };
  try { walk(value, 0); } catch { out += '[unreadable]'; }
  return cut(out, budget);
}

/** Formats console arguments as DevTools would: `%s %d %i %f %o %O %c` substitution, then the rest space-separated. */
export function formatConsoleArgs(args: readonly unknown[]): string {
  if (!args.length) return '';
  const rest = args.slice(1);
  let out: string;
  if (typeof args[0] === 'string') {
    out = args[0].replace(/%([sdifoOc%])/g, (token, kind: string) => {
      if (kind === '%') return '%';
      if (!rest.length) return token;
      const value = rest.shift();
      if (kind === 'c') return '';
      if (kind === 'd' || kind === 'i') return String(parseInt(String(value), 10));
      if (kind === 'f') return String(Number(value));
      return previewValue(value);
    });
  } else {
    out = previewValue(args[0]);
  }
  for (const value of rest) {
    out += ' ' + previewValue(value);
    if (out.length > MAX_MESSAGE) break;
  }
  return cut(out, MAX_MESSAGE);
}

type Frame = { text: string; location: string | null; chippy: boolean };

function parseFrames(stack: string): Frame[] {
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && (line.startsWith('at ') || line.includes('@')))
    .map((line) => {
      const match = /\(?((?:blob:)?(?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s()]*?):(\d+):(\d+)\)?$/i.exec(line);
      const location = match ? `${match[1]}:${match[2]}:${match[3]}` : null;
      return { text: line, location, chippy: !!match && isChippyAssetUrl(match[1]) };
    });
}

// callSite, recordCall, and the console wrapper.
const CAPTURE_FRAMES = 3;

/**
 * The frames that called the console, below Chippy's wrapper, and whether the
 * direct caller is Chippy's code. A page handler that Chippy dispatched (a
 * `page-click`) is the page's own message, so only the direct caller counts.
 */
function callSite(): { frames: Frame[]; chippy: boolean } {
  const stack = new Error().stack;
  if (typeof stack !== 'string') return { frames: [], chippy: false };
  const frames = parseFrames(stack).slice(CAPTURE_FRAMES);
  return { frames, chippy: !!frames[0]?.chippy };
}

function stackText(frames: Frame[]): string | null {
  return frames.length ? frames.slice(0, MAX_STACK_FRAMES).map((frame) => frame.text).join('\n') : null;
}

export function createConsoleCapture(options: ConsoleCaptureOptions = {}, target: Target = globalThis as Target) {
  const enabled = options.consoleCapture !== false;
  const limit = Math.max(1, Math.floor(Number(options.maxConsoleEntries) || DEFAULT_MAX_CONSOLE_ENTRIES_PER_LEVEL));
  const entries: ConsoleEntry[] = [];
  const kept = new Map<ConsoleLevel, number>();
  const dropped = new Map<ConsoleLevel, number>();
  const originals = new Map<ConsoleLevel, ConsoleMethod>();
  const wrappers = new Map<ConsoleLevel, ConsoleMethod>();
  let nextId = 1;
  let windowStart = performance.now();
  let pausedAt: number | null = null;
  let recording = false;
  let listening = false;
  let busy = false;

  function dropOldest(level: ConsoleLevel): void {
    const index = entries.findIndex((entry) => entry.level === level);
    if (index < 0) return;
    entries.splice(index, 1);
    kept.set(level, (kept.get(level) ?? 1) - 1);
    dropped.set(level, (dropped.get(level) ?? 0) + 1);
  }

  function add(entry: Omit<ConsoleEntry, 'id' | 'repeat'>): void {
    const last = entries[entries.length - 1];
    if (last && last.level === entry.level && last.source === entry.source && last.message === entry.message && last.location === entry.location) {
      last.repeat += 1;
      last.lastTime = entry.time;
      return;
    }
    entries.push({ id: nextId++, repeat: 1, ...entry });
    kept.set(entry.level, (kept.get(entry.level) ?? 0) + 1);
    if ((kept.get(entry.level) ?? 0) > limit) dropOldest(entry.level);
  }

  function accepting(): boolean {
    return recording && pausedAt === null && !busy;
  }

  function recordCall(level: ConsoleLevel, args: unknown[]): void {
    if (!accepting()) return;
    busy = true;
    try {
      const time = round(performance.now());
      const message = formatConsoleArgs(args);
      const own = OWN_PREFIXES.some((prefix) => message.startsWith(prefix));
      let stack: string | null = null;
      let location: string | null = null;
      let chippyCaller = false;
      if (STACK_LEVELS.has(level)) {
        const site = callSite();
        chippyCaller = site.chippy;
        const pageFrames = site.frames.filter((frame) => !frame.chippy);
        location = pageFrames.find((frame) => frame.location)?.location ?? null;
        const logged = args.find(isError);
        stack = logged ? stackText(parseFrames(logged.stack ?? '')) : stackText(pageFrames.length ? pageFrames : site.frames);
      }
      add({ level, source: 'console', time, message, stack, location, ...((own || chippyCaller) && { chippy: true as const }) });
    } catch { /* never let recording break the page's logging */ } finally {
      busy = false;
    }
  }

  function wrapperFor(level: ConsoleLevel, original: ConsoleMethod): ConsoleMethod {
    return function chippyConsoleCapture(this: unknown, ...args: unknown[]) {
      recordCall(level, args);
      return original.apply(this, args);
    };
  }

  function onError(event: any): void {
    // Resource load failures also reach a capturing window listener; only script errors are ErrorEvents on the window.
    if (!accepting() || !event || (event.target && event.target !== target) || !('message' in event || 'error' in event)) return;
    busy = true;
    try {
      const error = event.error;
      const message = cut(isError(error) ? errorText(error) : String(event.message || 'Script error.'), MAX_MESSAGE);
      const location = typeof event.filename === 'string' && event.filename ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : null;
      const stack = isError(error) ? stackText(parseFrames(error.stack ?? '')) : null;
      const chippy = (!!location && isChippyAssetUrl(event.filename)) || (isError(error) && !!parseFrames(error.stack ?? '')[0]?.chippy);
      add({ level: 'error', source: 'uncaught', time: round(performance.now()), message, stack, location, ...(chippy && { chippy: true as const }) });
    } catch { /* ignore */ } finally {
      busy = false;
    }
  }

  function onRejection(event: any): void {
    if (!accepting() || !event) return;
    busy = true;
    try {
      const reason = event.reason;
      const message = cut(`Uncaught (in promise) ${isError(reason) ? errorText(reason) : previewValue(reason)}`, MAX_MESSAGE);
      const frames = isError(reason) ? parseFrames(reason.stack ?? '') : [];
      const location = frames.find((frame) => !frame.chippy && frame.location)?.location ?? null;
      add({ level: 'error', source: 'rejection', time: round(performance.now()), message, stack: stackText(frames), location, ...(!!frames[0]?.chippy && { chippy: true as const }) });
    } catch { /* ignore */ } finally {
      busy = false;
    }
  }

  return {
    entries,

    install(): void {
      if (!enabled) return;
      recording = true;
      const consoleObject = target.console;
      if (consoleObject) {
        for (const level of CONSOLE_LEVELS) {
          const current = consoleObject[level];
          if (typeof current !== 'function' || current === wrappers.get(level)) continue;
          const wrapper = wrapperFor(level, current);
          originals.set(level, current);
          wrappers.set(level, wrapper);
          try { consoleObject[level] = wrapper; } catch { /* frozen console */ }
        }
      }
      if (!listening && typeof target.addEventListener === 'function') {
        target.addEventListener('error', onError, true);
        target.addEventListener('unhandledrejection', onRejection);
        listening = true;
      }
    },

    uninstall(): void {
      recording = false;
      const consoleObject = target.console;
      for (const level of CONSOLE_LEVELS) {
        const wrapper = wrappers.get(level);
        const original = originals.get(level);
        // A later wrapper still calls Chippy's; leave it, and Chippy's records nothing now.
        if (consoleObject && wrapper && original && consoleObject[level] === wrapper) {
          try { consoleObject[level] = original; } catch { /* frozen console */ }
        }
      }
      wrappers.clear();
      originals.clear();
      if (listening && typeof target.removeEventListener === 'function') {
        target.removeEventListener('error', onError, true);
        target.removeEventListener('unhandledrejection', onRejection);
      }
      listening = false;
    },

    pause(): void {
      if (pausedAt === null) pausedAt = performance.now();
    },

    resume(): void {
      pausedAt = null;
    },

    reset(): void {
      pausedAt = null;
      entries.length = 0;
      kept.clear();
      dropped.clear();
      nextId = 1;
      windowStart = performance.now();
    },

    status(): ConsoleCaptureStatus {
      const byLevel: ConsoleCaptureStatus['byLevel'] = {};
      for (const [level, count] of kept) if (count > 0) byLevel[level] = count;
      return {
        enabled,
        installed: recording,
        windowStart: round(windowStart),
        entries: entries.length,
        byLevel,
        dropped: Object.fromEntries(dropped),
        pausedAt: pausedAt === null ? null : round(pausedAt),
      };
    },
  };
}

export type ConsoleCapture = ReturnType<typeof createConsoleCapture>;
