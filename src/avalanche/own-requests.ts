/**
 * Requests Chippy itself makes in the page realm, such as served modules and
 * source maps it fetches to resolve component sources. The browser records
 * them as ordinary `fetch` resource entries; network capture excludes them so
 * a report shows only the page's own traffic.
 */

const MAX_OWN_REQUESTS = 2000;
const ownUrls = new Set<string>();

function absolute(url: string): string {
  try {
    return new URL(url, (globalThis as { location?: { href?: string } }).location?.href).href;
  } catch {
    return url;
  }
}

/** Remember a URL that Chippy is about to fetch from the page realm. */
export function markOwnRequest(url: string): void {
  if (ownUrls.size >= MAX_OWN_REQUESTS) ownUrls.delete(ownUrls.values().next().value as string);
  ownUrls.add(absolute(url));
}

/** Whether a `fetch` resource entry is one Chippy made. */
export function isOwnRequest(url: string): boolean {
  return ownUrls.has(url) || ownUrls.has(absolute(url));
}

/** Chippy assets: helper-served bundles and extension files. */
export function isChippyAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith('/__chippy/') || parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:';
  } catch {
    return false;
  }
}

/** Test seam: forget every remembered URL. */
export function clearOwnRequestsForTest(): void {
  ownUrls.clear();
}
