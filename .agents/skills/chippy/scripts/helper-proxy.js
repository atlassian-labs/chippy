/* eslint-disable */
// Pure helpers for the helper's proxy mode: where to forward requests, and how
// to put Chippy into the proxied HTML document.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopbackHostname(hostname) {
  const name = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTNAMES.has(name) || /^127(?:\.\d{1,3}){3}$/.test(name) || name.endsWith('.localhost');
}

// The proxy forwards only to this machine. Dev servers bind `localhost`,
// `127.0.0.1`, or `::1` depending on the tool and platform (Vite on macOS binds
// `::1`), so the original page URL decides the loopback name when it names one.
// `localhost` is the default because it resolves to both address families.
function resolveProxyTarget(targetPort, originalUrl) {
  const port = Number(targetPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid target port: ${targetPort}`);
  let hostname = 'localhost';
  if (originalUrl) {
    let parsed;
    try { parsed = new URL(String(originalUrl)); } catch { throw new Error(`Invalid originalUrl: ${originalUrl}`); }
    const named = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!isLoopbackHostname(named)) {
      throw new Error(`Proxy targets must be on this machine; originalUrl host ${parsed.hostname} is not a loopback name`);
    }
    hostname = named;
  }
  const hostHeader = `${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`;
  return { hostname, port, hostHeader };
}

// Options for http.request. `autoSelectFamily` tries every address `localhost`
// resolves to, so a server listening on only one family is still reached.
function upstreamRequestOptions(target, req, headers) {
  return {
    host: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers,
    autoSelectFamily: true,
  };
}

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;
const HTML_OPEN = /<html(?:\s[^>]*)?>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

// Classic scripts at the start of <head> run before the document's module
// scripts, so the DevTools hook exists when react-dom evaluates.
function insertAtHeadStart(html, markup) {
  for (const pattern of [HEAD_OPEN, HTML_OPEN, DOCTYPE]) {
    const match = pattern.exec(html);
    if (match) {
      const at = match.index + match[0].length;
      return `${html.slice(0, at)}\n${markup}\n${html.slice(at)}`;
    }
  }
  return `${markup}\n${html}`;
}

function insertAtBodyEnd(html, markup) {
  const lower = html.toLowerCase();
  for (const tag of ['</body>', '</html>']) {
    const i = lower.lastIndexOf(tag);
    if (i >= 0) return `${html.slice(0, i)}${markup}\n${html.slice(i)}`;
  }
  return `${html}\n${markup}`;
}

// `earlyScripts` are helper-relative script paths that must run before page
// code; `bridgeBundle` is inline markup that connects the page to the helper.
function injectProxyDocument(html, { earlyScripts = [], bridgeBundle = '' } = {}) {
  const early = earlyScripts
    .map((src) => `<script data-chippy-proxy-early="true" src="${src}"></script>`)
    .join('\n');
  const withEarly = early ? insertAtHeadStart(html, early) : html;
  return bridgeBundle ? insertAtBodyEnd(withEarly, bridgeBundle) : withEarly;
}

module.exports = {
  injectProxyDocument,
  isLoopbackHostname,
  resolveProxyTarget,
  upstreamRequestOptions,
};
