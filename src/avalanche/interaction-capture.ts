/**
 * Records user-side interaction anchors while Avalanche records commits.
 * Capture is intentionally DOM-event based: the detector owns fiber/commit
 * evidence, while this module owns the only signal that a human interaction
 * preceded it. `linkRecent` joins the two later using performance timestamps;
 * it is evidence of temporal proximity, not proof that the event caused every
 * render in the commit.
 */

import { isComponentFiber, type Fiber } from './internals';
import { describeComponent, describeFiberTarget } from '../layout-lab/fiber-walk';
import type { CommitInteractionAction, InteractionAction, InteractionCaptureLevel } from './reporter';

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

export function createInteractionCapture(options: InteractionCaptureOptions = {}) {
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
        ownerStackKind: describedComponent.owners.length > 0 ? 'owners' : 'parents',
        ownerStack: describedComponent.owners.length > 0 ? describedComponent.owners : describedComponent.parents,
      } : null,
    };
  }

  function capture(event: Event): void {
    const pathTarget = typeof event.composedPath === 'function' ? event.composedPath()[0] : null;
    const target = pathTarget instanceof Element ? pathTarget : event.target;
    // Keep a bounded queue because a long-lived page can receive noisy events
    // continuously. Older anchors cannot link to a future commit once they
    // fall outside the configured window.
    state.actions.push({
      id: nextActionId++,
      action: event.type,
      timestamp: performance.now(),
      location: describeActionLocation(target),
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

    uninstall(): void {
      if (!installed || typeof document === 'undefined') return;
      for (const name of eventNames()) document.removeEventListener(name, capture, true);
      installed = false;
    },

    reset(): void {
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
          action: action.action,
          location: action.location,
        }));
      if (linked.length > 0) state.byCommit[commitId] = linked;
      while (state.actions.length > 0 && commitTime - state.actions[0].timestamp > windowMs) {
        state.actions.shift();
      }
    },
  };
}
