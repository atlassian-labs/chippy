/**
 * What a page script changed while it ran: DOM mutations outside Chippy's own
 * UI, React roots that committed, and globals added to `window`.
 *
 * Commits are detected without patching the DevTools hook: each FiberRoot's
 * `current` HostRoot is swapped on every commit, so a root whose `current`
 * differs after the run committed at least once. Concurrent work the page
 * scheduled on its own counts too; the report says what changed, not who
 * caused it.
 */

export interface SideEffectReport {
  /** DOM mutation records outside `[data-chippy-ui]`. */
  domMutations: number;
  /** React roots that committed during the run. */
  rootsCommitted: number;
  /** New own enumerable `window` properties, up to 20 names. */
  globalsAdded: string[];
}

interface RootLike { current?: unknown }

const MAX_GLOBALS = 20;

function isChippyUi(node: Node | null): boolean {
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  return !!el && typeof el.closest === 'function' && !!el.closest('[data-chippy-ui]');
}

function countable(record: MutationRecord): boolean {
  if (isChippyUi(record.target)) return false;
  if (record.type !== 'childList') return true;
  const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  // A removed Chippy node has no parent to climb, so check the node itself too.
  return changed.length === 0 || changed.some((node) => !(node.nodeType === 1 && (node as Element).hasAttribute('data-chippy-ui')) && !isChippyUi(node));
}

export function watchSideEffects(deps: { fiberRoots: () => RootLike[]; win?: Window & typeof globalThis }) {
  const win = deps.win || window;
  const before = new Map<RootLike, unknown>();
  for (const root of deps.fiberRoots()) before.set(root, root.current);
  const globals = new Set(Object.keys(win));
  let mutations = 0;
  let observer: MutationObserver | null = null;
  if (typeof win.MutationObserver === 'function' && win.document?.documentElement) {
    observer = new win.MutationObserver((records) => {
      for (const record of records) if (countable(record)) mutations += 1;
    });
    observer.observe(win.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  return function stop(): SideEffectReport {
    if (observer) {
      for (const record of observer.takeRecords()) if (countable(record)) mutations += 1;
      observer.disconnect();
    }
    let rootsCommitted = 0;
    for (const [root, current] of before) if (root.current !== current) rootsCommitted += 1;
    const globalsAdded: string[] = [];
    for (const key of Object.keys(win)) {
      if (!globals.has(key)) {
        globalsAdded.push(key);
        if (globalsAdded.length >= MAX_GLOBALS) break;
      }
    }
    return { domMutations: mutations, rootsCommitted, globalsAdded };
  };
}

/** FiberRoots (the objects whose `current` swaps on commit) for the given live HostRoot fibers. */
export function fiberRootsOf(hostRoots: Array<{ stateNode?: unknown }>): RootLike[] {
  const out: RootLike[] = [];
  for (const fiber of hostRoots) {
    const root = fiber && (fiber.stateNode as RootLike | null);
    if (root && typeof root === 'object' && 'current' in root && !out.includes(root)) out.push(root);
  }
  return out;
}
