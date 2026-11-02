export interface BrowserConnection {
  chippy: unknown;
  avalanche: unknown;
  connState: string | null;
  integration: unknown;
  activated: boolean | null;
  probesActive: boolean | null;
}

/** Connect this document through a running Chippy helper. Reconnect after navigation. */
export async function connectChippy(helperUrl = 'http://127.0.0.1:7823'): Promise<BrowserConnection> {
  const base = new URL(helperUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Chippy helper URL must use HTTP or HTTPS');
  const url = new URL('/__chippy/inject.mjs', base).href;
  const runtime = await import(/* @vite-ignore */ url);
  return await runtime.ready;
}
