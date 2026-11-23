/**
 * Synthetic events for `fiber-invoke`.
 *
 * Event handlers such as `onClick` expect React's synthetic event: they call
 * `preventDefault()` or `stopPropagation()`, or read `currentTarget`. JSON
 * arguments cannot carry one, so an argument written as `{"$event": "click"}`
 * is replaced with an event-like object whose target is the fiber's first DOM
 * element. Extra JSON fields (`{"$event": "keydown", "key": "Enter"}`) become
 * event fields.
 *
 * The event is never dispatched: no other handler sees it, it does not bubble,
 * and the browser performs no default action. The report says which methods
 * the handler called and which fields it read that the event does not have.
 */

export type EventPlaceholder = { $event: string; [field: string]: unknown };

export type SyntheticEventReport = {
  synthetic: true;
  type: string;
  /** The element used as `target` and `currentTarget`, or null when the fiber renders none. */
  target: string | null;
  /** Event methods the handler called, in order. */
  calls: string[];
  defaultPrevented: boolean;
  propagationStopped: boolean;
  /** Fields the handler read that this event does not provide. */
  missing: string[];
};

type FiberLike = { stateNode?: unknown; child?: unknown; sibling?: unknown; [key: string]: unknown };

const MAX_FIBERS_SEARCHED = 500;
const RESERVED = new Set([
  'type', 'target', 'currentTarget', 'nativeEvent', 'preventDefault', 'stopPropagation',
  'isDefaultPrevented', 'isPropagationStopped', 'persist', 'isPersistent', 'defaultPrevented',
]);
// Read by promise checks, serializers, and React internals rather than by the handler.
const IGNORED_READS = new Set(['then', 'toJSON', '$$typeof', 'constructor', 'asymmetricMatch', 'nodeType']);

export function isEventPlaceholder(value: unknown): value is EventPlaceholder {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { $event?: unknown }).$event === 'string'
    && (value as { $event: string }).$event.trim() !== '';
}

function isElement(value: unknown): value is Element {
  return !!value && typeof value === 'object' && (value as { nodeType?: unknown }).nodeType === 1;
}

/** The fiber's own element, or the first element rendered below it. */
export function firstElementOf(fiber: FiberLike | null | undefined): Element | null {
  const stack: unknown[] = fiber ? [fiber] : [];
  let searched = 0;
  while (stack.length && searched < MAX_FIBERS_SEARCHED) {
    const node = stack.pop() as FiberLike;
    searched += 1;
    if (isElement(node.stateNode)) return node.stateNode;
    if (node !== fiber && node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  return null;
}

export function describeElement(element: Element | null): string | null {
  if (!element) return null;
  const tag = element.tagName.toLowerCase();
  const testId = element.getAttribute('data-testid');
  if (testId) return `${tag}[data-testid="${testId}"]`;
  if (element.id) return `${tag}#${element.id}`;
  return tag;
}

function nativeEventOf(type: string, init: Record<string, unknown>): Event | null {
  const view = typeof window === 'undefined' ? null : window;
  if (!view || typeof view.Event !== 'function') return null;
  const options = { bubbles: true, cancelable: true, ...init };
  const ctor = /^(?:click|dblclick|contextmenu|mouse|auxclick)/.test(type) ? view.MouseEvent
    : /^pointer/.test(type) ? view.PointerEvent ?? view.MouseEvent
      : /^key/.test(type) ? view.KeyboardEvent
        : /^(?:focus|blur)/.test(type) ? view.FocusEvent
          : view.Event;
  try {
    return new (ctor ?? view.Event)(type, options);
  } catch {
    return new view.Event(type, options);
  }
}

/**
 * Build the event for one placeholder. `report` is filled in while the
 * handler runs; read it after the call returns.
 */
export function createSyntheticEvent(placeholder: EventPlaceholder, fiber: FiberLike | null | undefined): { event: unknown; report: SyntheticEventReport } {
  const { $event, ...rest } = placeholder;
  const type = $event.trim();
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!RESERVED.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) fields[key] = value;
  }
  const element = firstElementOf(fiber);
  const nativeEvent = nativeEventOf(type, fields);
  const report: SyntheticEventReport = {
    synthetic: true,
    type,
    target: describeElement(element),
    calls: [],
    defaultPrevented: false,
    propagationStopped: false,
    missing: [],
  };
  let persistent = false;
  const base: Record<string, unknown> = {
    bubbles: true,
    cancelable: true,
    eventPhase: 2,
    isTrusted: false,
    timeStamp: typeof performance === 'undefined' ? Date.now() : performance.now(),
    ...fields,
    type,
    target: element,
    currentTarget: element,
    nativeEvent,
    preventDefault() {
      report.calls.push('preventDefault');
      report.defaultPrevented = true;
      nativeEvent?.preventDefault();
    },
    stopPropagation() {
      report.calls.push('stopPropagation');
      report.propagationStopped = true;
      nativeEvent?.stopPropagation();
    },
    isDefaultPrevented: () => report.defaultPrevented,
    isPropagationStopped: () => report.propagationStopped,
    persist() {
      report.calls.push('persist');
      persistent = true;
    },
    isPersistent: () => persistent,
  };
  Object.defineProperty(base, 'defaultPrevented', { enumerable: true, get: () => report.defaultPrevented });
  const event = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !(key in target) && !IGNORED_READS.has(key) && !report.missing.includes(key)) {
        report.missing.push(key);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return { event, report };
}
