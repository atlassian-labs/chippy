/**
 * Records user-side interaction anchors while Avalanche records commits.
 * Capture is intentionally DOM-event based: the detector owns fiber/commit
 * evidence, while this module owns the only signal that a human interaction
 * preceded it. `linkRecent` joins the two later using performance timestamps;
 * it is evidence of temporal proximity, not proof that the event caused every
 * render in the commit.
 */

import { isComponentFiber, type Fiber } from './internals';
import { describeComponent, describeFiberTarget, getOwnerChainFibers } from '../layout-lab/fiber-walk';
import { describeInputEvent } from './input-details';
import type { CommitInteractionAction, InteractionAction, InteractionCaptureLevel } from './reporter';

// Chippy marks its page UI with these attributes.
const CHIPPY_UI_SELECTOR = '[data-chippy-ui], [data-layout-lab-panel]';

function isChippyUi(node: EventTarget): boolean {
  return typeof Element !== 'undefined' && node instanceof Element && node.matches(CHIPPY_UI_SELECTOR);
}

const EXPLICIT_INTERACTION_EVENTS = ['click', 'keydown', 'keyup', 'input', 'change', 'submit'];
const NOISY_INTERACTION_EVENTS = ['wheel', 'scroll', 'pointermove', 'mousemove', 'touchmove'];
const ALL_INTERACTION_EVENTS = [
  ...EXPLICIT_INTERACTION_EVENTS,
  'pointerdown',
  'pointerup',
  'dblclick',
  'focusin',
  'focusout',
  ...NOISY_INTERACTION_EVENTS,
];
const MAX_INTERACTION_ACTIONS = 200;

export interface InteractionCaptureOptions {
  interactionCapture?: InteractionCaptureLevel;
  interactionEvents?: string[];
  interactionWindowMs?: number;
}

export interface InteractionCaptureState {
  actions: InteractionAction[];
  byCommit: Record<number, CommitInteractionAction[]>;
}

/**
 * `noteName` is called with each component name a location stores and the
 * type it names, so the detector can rename it once the authored name is
 * recovered (see recorded-names.ts).
 */
export function createInteractionCapture(
  options: InteractionCaptureOptions = {},
  noteName?: (name: string, type: unknown) => void,
) {
  const {
    interactionCapture = 'explicit',
    interactionEvents = [],
    interactionWindowMs = 1000,
  } = options;

  const state: InteractionCaptureState = {
    actions: [],
    byCommit: {},
  };
  let nextActionId = 1;
  let installed = false;
  let paused = false;

  function eventNames(): string[] {
    const base =
      interactionCapture === 'off' ? [] :
        interactionCapture === 'explicit' ? EXPLICIT_INTERACTION_EVENTS :
          interactionCapture === 'noisy' ? EXPLICIT_INTERACTION_EVENTS.concat(NOISY_INTERACTION_EVENTS) :
            ALL_INTERACTION_EVENTS;
    return Array.from(new Set(base.concat(interactionEvents).map((name) => String(name).trim()).filter(Boolean)));
  }

  function findReactFiberKey(node: Element): string | null {
    return Object.getOwnPropertyNames(node).find((key) => key.startsWith('__reactFiber$')) || null;
  }

  function nearestFiberFromNode(node: EventTarget | null): Fiber | null {
    let current = node instanceof Element ? node : null;
    while (current) {
      const key = findReactFiberKey(current);
      if (key) return (current as unknown as Record<string, Fiber | undefined>)[key] || null;
      current = current.parentElement;
    }
    return null;
  }

  function nearestComponentFiber(node: EventTarget | null): Fiber | null {
    let fiber = nearestFiberFromNode(node);
    while (fiber) {
      if (isComponentFiber(fiber.tag)) return fiber;
      fiber = fiber.return || null;
    }
    return null;
  }

  function nearestTestId(node: EventTarget | null): string | null {
    let current = node instanceof Element ? node : null;
    while (current) {
      const value = current.getAttribute('data-testid');
      if (value) return value;
      current = current.parentElement;
    }
    return null;
  }

  function describeActionLocation(target: EventTarget | null): InteractionAction['location'] {
    const domTarget = target instanceof Element ? target : null;
    const fiber = nearestComponentFiber(target);
    const describedTarget = describeFiberTarget(fiber as any, domTarget);
    const describedComponent = describeComponent(fiber as any);
    if (describedComponent && fiber && noteName) {
      if (describedComponent.name) noteName(describedComponent.name, fiber.type);
      // describeComponent lists the owners in this order.
      const owners = getOwnerChainFibers(fiber as any).fibers;
      describedComponent.owners.forEach((owner, index) => {
        if (owner.name && owners[index]) noteName(owner.name, owners[index].type);
      });
    }
    return {
      dom: {
        tag: describedTarget?.domTag || null,
        text: describedTarget?.domText || '',
        nearestTestId: nearestTestId(target),
      },
      targetFiber: describedComponent ? {
        name: describedComponent.name,
        key: describedComponent.key,
        source: describedComponent.source,
        // describeComponent already falls back to parents and labels the chain.
        ownerStackKind: describedComponent.ownerStackKind,
        ownerStack: describedComponent.owners,
      } : null,
    };
  }

  function capture(event: Event): void {
    if (paused) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    // Clicks on Chippy's own panel (Record, Stop, probes) are not page input.
    if (path.some(isChippyUi)) return;
    const pathTarget = path[0] ?? null;
    const target = pathTarget instanceof Element ? pathTarget : event.target;
    // Keep a bounded queue because a long-lived page can receive noisy events
    // continuously. Older anchors cannot link to a future commit once they
    // fall outside the configured window.
    state.actions.push({
      id: nextActionId++,
      action: event.type,
      timestamp: performance.now(),
      location: describeActionLocation(target),
      event: describeInputEvent(event),
    });
    if (state.actions.length > MAX_INTERACTION_ACTIONS) {
      state.actions.splice(0, state.actions.length - MAX_INTERACTION_ACTIONS);
    }
  }

  return {
    state,

    install(): void {
      if (installed) return;
      const names = eventNames();
      if (names.length === 0 || typeof document === 'undefined') return;
      for (const name of names) document.addEventListener(name, capture, true);
      installed = true;
    },

    /** Ignore page input until resume() or reset(). */
    pause(): void { paused = true; },
    resume(): void { paused = false; },

    uninstall(): void {
      if (!installed || typeof document === 'undefined') return;
      for (const name of eventNames()) document.removeEventListener(name, capture, true);
      installed = false;
    },

    reset(): void {
      paused = false;
      state.actions.length = 0;
      for (const key of Object.keys(state.byCommit)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete state.byCommit[Number(key)];
      }
      nextActionId = 1;
    },

    linkRecent(commitId: number, commitTime: number): void {
      const windowMs = Math.max(0, Number(interactionWindowMs) || 0);
      if (windowMs === 0 || state.actions.length === 0) return;
      // Link only events at or before the commit. A later event may be close in
      // wall-clock time but cannot explain work that already committed.
      const linked = state.actions
        .filter((action) => action.timestamp <= commitTime && commitTime - action.timestamp <= windowMs)
        .map((action) => ({
          id: action.id,
          lastCommitId: Math.max(0, commitId - 1),
          deltaTime: Math.round((commitTime - action.timestamp) * 100) / 100,
          timestamp: action.timestamp,
          action: action.action,
          location: action.location,
          ...(action.event && { event: action.event }),
        }));
      if (linked.length > 0) state.byCommit[commitId] = linked;
      while (state.actions.length > 0 && commitTime - state.actions[0].timestamp > windowMs) {
        state.actions.shift();
      }
    },
  };
}
