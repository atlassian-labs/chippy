/* eslint-disable */
// Page WebSocket identity checks for the Chippy helper.
//
// Any page in the browser can open the page WebSocket, because the pages
// Chippy inspects run on arbitrary origins. What a page cannot forge is the
// Origin header its browser sends with the WebSocket handshake. These checks
// bind a socket's claims to that origin:
//   1. The page URL a socket reports must belong to its handshake origin, so a
//      page cannot appear to the agent as another site.
//   2. A client id belongs to the origin that first claimed it. A reload of the
//      same page may reuse its id; a page on another origin may not take it
//      over, even after the original socket closed.
// A socket without an Origin header is a non-browser client on this machine;
// such a client can already read the helper token, so its origin is `null`
// and it is held to the same id binding as any other origin.

const MAX_BOUND_CLIENT_IDS = 2000;

function handshakeOrigin(headers) {
  const origin = headers && headers.origin;
  return typeof origin === 'string' && origin ? origin : null;
}

function urlOrigin(value) {
  try { return new URL(value).origin; } catch { return null; }
}

// Returns null when the page URL is consistent with the socket, otherwise an error.
function checkPageUrl(socketOrigin, pageUrl) {
  if (socketOrigin === null || pageUrl == null || pageUrl === '') return null;
  const claimed = urlOrigin(String(pageUrl));
  if (claimed === socketOrigin) return null;
  return `page URL ${JSON.stringify(String(pageUrl))} does not belong to the WebSocket origin ${socketOrigin}`;
}

function pageUrlsOf(msg) {
  const urls = [];
  if (msg && msg.page && msg.page.url != null) urls.push(msg.page.url);
  if (msg && msg.snapshot && msg.snapshot.page && msg.snapshot.page.url != null) urls.push(msg.snapshot.page.url);
  return urls;
}

function createClientIdBindings({ max = MAX_BOUND_CLIENT_IDS } = {}) {
  const owners = new Map();

  function bind(clientId, origin) {
    owners.delete(clientId);
    owners.set(clientId, origin);
    while (owners.size > max) owners.delete(owners.keys().next().value);
  }

  // Returns null and records the binding when `origin` may use `clientId`.
  function claim(clientId, origin) {
    if (owners.has(clientId) && owners.get(clientId) !== origin) {
      return `client id ${JSON.stringify(clientId)} belongs to another origin`;
    }
    bind(clientId, origin);
    return null;
  }

  return { claim, ownerOf: (clientId) => (owners.has(clientId) ? owners.get(clientId) : undefined) };
}

// Returns null when `msg` may be applied to a socket from `socketOrigin`
// currently registered as `currentClientId`, otherwise an error string.
function checkPageMessage({ bindings, socketOrigin, currentClientId, msg }) {
  for (const url of pageUrlsOf(msg)) {
    const error = checkPageUrl(socketOrigin, url);
    if (error) return error;
  }
  const requested = msg && msg.clientId ? String(msg.clientId) : null;
  if (requested && requested !== currentClientId) return bindings.claim(requested, socketOrigin);
  return null;
}

module.exports = {
  checkPageMessage,
  checkPageUrl,
  createClientIdBindings,
  handshakeOrigin,
};
