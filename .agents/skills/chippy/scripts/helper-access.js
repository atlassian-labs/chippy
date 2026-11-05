/* eslint-disable */
// Access control for the Chippy helper.
//
// The helper can run scripts in connected pages, so its command API must not
// be reachable from arbitrary websites or other hosts. Three checks apply:
//   1. The helper binds to loopback by default. A wider bind (for example
//      0.0.0.0 for a remote dev environment or container) is opt-in.
//   2. When bound to loopback, the Host header must name a loopback host. This
//      blocks DNS-rebinding pages that resolve their own name to 127.0.0.1.
//   3. Protected routes require the X-Chippy-Token header. CORS does not allow
//      that header, so a cross-origin page cannot send it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_HEADER = 'x-chippy-token';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Routes that pages load without credentials: health, injected bundles, and
// the page WebSocket.
const PUBLIC_GET_PATHS = new Set([
  '',
  '/health',
  '/inject.js',
  '/inject.mjs',
  '/avalanche.es.js',
  '/avalanche.iife.js',
  '/avalanche.es.js.map',
  '/avalanche.iife.js.map',
  '/devtools-hook-shim.js',
  '/startup-handoff.js',
  '/ws',
]);

// Routes the published browser extension calls from its service worker. The
// extension sends no token, so these stay open to extension origins and
// non-browser clients on every bind. They list pages and read or arm capture;
// they do not run page code.
const EXTENSION_ROUTES = new Set(['GET /api/pages', 'GET /api/avalanche-arm', 'POST /api/avalanche-arm']);

function stateDirectory(env = process.env) {
  return env.CHIPPY_STATE_DIR || path.join(os.homedir(), '.chippy');
}

function resolveTokenFile(port, env = process.env) {
  return path.join(stateDirectory(env), `helper-${port}.token`);
}

function readHelperToken(port, env = process.env) {
  if (env.CHIPPY_HELPER_TOKEN) return env.CHIPPY_HELPER_TOKEN;
  try {
    return fs.readFileSync(resolveTokenFile(port, env), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function createHelperToken(env = process.env) {
  return env.CHIPPY_HELPER_TOKEN || crypto.randomBytes(32).toString('hex');
}

// Call only after the server is listening, so a helper that lost the port
// race cannot replace the running helper's token.
function writeHelperToken(port, token, env = process.env) {
  if (env.CHIPPY_HELPER_TOKEN) return null;
  const file = resolveTokenFile(port, env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function isLoopbackBind(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  const value = String(hostHeader).toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

function allowedHosts(env = process.env) {
  const extra = (env.CHIPPY_HELPER_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK_HOSTS, ...extra]);
}

function isAllowedHost(hostHeader, env = process.env) {
  return allowedHosts(env).has(hostnameOf(hostHeader));
}

// Returns 'public', 'extension', or 'protected'. `route` is the path after the
// Chippy prefix, or null for proxied application paths.
function classifyRoute(method, route) {
  if (route === null) return 'public';
  if (method === 'OPTIONS') return 'public';
  if (method === 'GET' && PUBLIC_GET_PATHS.has(route)) return 'public';
  if (EXTENSION_ROUTES.has(`${method} ${route}`)) return 'extension';
  return 'protected';
}

function isExtensionOrigin(origin) {
  return typeof origin === 'string' && /^(chrome|moz)-extension:\/\//.test(origin);
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}

// A page may ask whether its own origin is armed (the Storybook addon does this
// at preview start). It may not list other origins or look up client ids.
function isSelfArmLookup(method, route, origin, query) {
  if (method !== 'GET' || route !== '/api/avalanche-arm' || !query || typeof origin !== 'string') return false;
  if (query.get('clientId')) return false;
  const asked = query.get('origin');
  return !!asked && originOf(asked) === origin;
}

function tokensMatch(expected, received) {
  if (typeof received !== 'string' || !expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns null when the request may proceed, otherwise { status, error }.
// `query` is the request's URLSearchParams.
function authorizeRequest({ method, route, headers, token, loopback, query = null, env = process.env }) {
  if (loopback && !isAllowedHost(headers.host, env)) {
    return { status: 403, error: 'Host header is not a loopback host; set CHIPPY_HELPER_ALLOWED_HOSTS to allow it' };
  }
  const kind = classifyRoute(method, route);
  if (kind === 'public') return null;
  if (tokensMatch(token, headers[TOKEN_HEADER])) return null;
  if (kind === 'extension') {
    const origin = headers.origin;
    if (origin === undefined || isExtensionOrigin(origin)) return null;
    if (isSelfArmLookup(method, route, origin, query)) return null;
  }
  return { status: 401, error: 'Missing or invalid X-Chippy-Token header' };
}

module.exports = {
  TOKEN_HEADER,
  authorizeRequest,
  classifyRoute,
  createHelperToken,
  isAllowedHost,
  isLoopbackBind,
  readHelperToken,
  resolveTokenFile,
  writeHelperToken,
};
