/**
 * Keeps `renderedByCommit` within a memory budget.
 *
 * Every commit records one entry per rendered component, so a long capture
 * on a large tree grows without end: about 1.25 MB of heap per full
 * re-render of 7,000 components. The store holds at most `maxEntries`
 * entries. When a new commit goes over, the oldest commits' rendered
 * evidence is dropped, never the newest commit's, and the drop is reported
 * in `status().evicted` so a reader can tell a dropped commit from one that
 * rendered nothing. Commit stats, sources, and timings are kept for every
 * commit.
 */

export const DEFAULT_MAX_RENDERED_ENTRIES = 250_000;

export interface RenderedEvidenceStatus {
  /** Entry budget for the whole capture. */
  maxEntries: number;
  /** Entries currently held. */
  entries: number;
  /** Commits whose rendered evidence is currently held. */
  commits: number;
  /** Rendered evidence dropped to stay within `maxEntries`; null when nothing was dropped. */
  evicted: { commits: number; entries: number; throughCommit: number } | null;
}

export function createRenderedEvidenceStore<T>(byCommit: Record<number, T[]>, maxEntries = DEFAULT_MAX_RENDERED_ENTRIES) {
  const budget = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : DEFAULT_MAX_RENDERED_ENTRIES;
  // Commit ids in the order they were stored; `head` is the oldest still held.
  let order: number[] = [];
  let head = 0;
  let entries = 0;
  let evicted: RenderedEvidenceStatus['evicted'] = null;

  function add(commitId: number, list: T[]): void {
    const previous = byCommit[commitId];
    if (previous) entries -= previous.length;
    else order.push(commitId);
    byCommit[commitId] = list;
    entries += list.length;
    while (entries > budget && order.length - head > 1) {
      const oldest = order[head++];
      const dropped = byCommit[oldest]?.length ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete byCommit[oldest];
      entries -= dropped;
      evicted = {
        commits: (evicted?.commits ?? 0) + 1,
        entries: (evicted?.entries ?? 0) + dropped,
        throughCommit: Math.max(evicted?.throughCommit ?? oldest, oldest),
      };
    }
    // Compact the queue once the dropped prefix dominates it.
    if (head > 1024 && head * 2 > order.length) {
      order = order.slice(head);
      head = 0;
    }
  }

  function reset(): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    for (const key of Object.keys(byCommit)) delete byCommit[Number(key)];
    order = [];
    head = 0;
    entries = 0;
    evicted = null;
  }

  function status(): RenderedEvidenceStatus {
    return { maxEntries: budget, entries, commits: order.length - head, evicted: evicted && { ...evicted } };
  }

  /**
   * True when the commit holds no rendered evidence and is in the dropped
   * range, so any evidence it had was dropped by the budget.
   */
  function inEvictedRange(commitId: number): boolean {
    return !!evicted && commitId <= evicted.throughCommit && byCommit[commitId] === undefined;
  }

  return { add, reset, status, inEvictedRange };
}
