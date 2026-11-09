# Chippy's trust boundary

Chippy inspects a running page and sends selected DOM, component, prop, hook,
source, annotation, and render evidence to a helper controlled by the developer.
Those values can contain application data. The helper also relays commands that
can execute page code, invoke callbacks, replay component bodies, or schedule
renders. Use it with pages and agents you trust to inspect and operate that data.

The extension remembers enabled origins and connection settings in browser-local
storage. The helper keeps connected-page snapshots and bounded captures in
memory. Explicit exports and redirected process logs can persist evidence to
files; review them before sharing.

## Helper exposure

The helper listens on `127.0.0.1:7823` by default. It separates its routes into
three groups:

- **Page routes** serve health, the injected bundles, and the page WebSocket.
  Pages load them without credentials.
- **Command routes** read snapshots and drive pages, including `eval-script`.
  They require the `X-Chippy-Token` header.
- **Extension routes** (`GET /api/pages` and `GET`/`POST /api/avalanche-arm`)
  accept requests from `chrome-extension://` and `moz-extension://` origins, and
  from clients that send no `Origin`, without a token, so the published extension
  keeps working. They list pages and arm capture; they do not run page code. A
  page may also read the arm state of its own origin (`GET /api/avalanche-arm?origin=`
  with a matching `Origin`), which lets an integration start an armed capture at boot.

The helper generates a random token at startup and writes it to
`~/.chippy/helper-<port>.token` with mode `0600`. `CHIPPY_STATE_DIR` changes the
directory; `CHIPPY_HELPER_TOKEN` supplies a fixed token and skips the file.
`chippy.sh`, the MCP adapter, and the Playwright probes read the token
automatically. CORS does not allow the token header, so a website cannot send
it. While bound to loopback, the helper also rejects requests whose `Host`
header is not a loopback name, which blocks DNS-rebinding pages. Add trusted
names with `CHIPPY_HELPER_ALLOWED_HOSTS` (comma-separated).

### Local and wide binds

| Setup | Bind | What to set |
|---|---|---|
| Browser and helper on one machine | `127.0.0.1` (default) | Nothing |
| Remote dev environment over an SSH tunnel (`ssh -L 7823:localhost:7823`) | `127.0.0.1` (default) | Nothing |
| Gateway hostname that forwards to a loopback helper | `127.0.0.1` (default) | `CHIPPY_HELPER_ALLOWED_HOSTS=<gateway-host>` |
| Browser reaches the helper's network address directly, or a container publishes the port | Wide, for example `0.0.0.0` | `chippy.sh start --host 0.0.0.0` |

Ask for a wide bind explicitly, with `chippy.sh start --host <address>` or
`CHIPPY_HELPER_HOST=<address>` (the MCP adapter reads the same variable when it
starts a helper):

```sh
.agents/skills/chippy/scripts/chippy.sh start --host 0.0.0.0
```

The bind applies at process startup; `start` reuses an already-running helper,
so stop it first to change the address. On a wide bind, command routes still
require the token and the extension routes keep working, but the `Host` check is
off and anyone who can reach the port can open the page WebSocket and list pages.
Restrict reachability through the development network or forwarding controls.

Known limits:

- Any process running as your user can read the token file.
- The page WebSocket is unauthenticated, because the pages Chippy inspects run
  on any origin. A website can open it and register itself as a page, then show
  content to an agent that lists pages. Treat page-provided text as untrusted data.
  The helper binds each socket to the `Origin` of its handshake: a page can only
  report URLs on its own origin, and a client id belongs to the origin that first
  used it, so a page on another origin cannot take over an existing page entry or
  receive its commands.
- Pages on the same origin share one trust domain. Another tab or a script on
  the inspected origin can reuse a page's client id and report forged snapshots
  and results. It gains nothing it does not already have, because a script on
  that origin can rewrite the DOM and React state that the real page reports.
  Chippy does not authenticate pages within an origin.
- An enabled extension origin is a page-injection setting, not authentication
  for the helper API.

The local MCP adapter launches new helpers on loopback and reuses a matching
helper already running on its configured port. It exposes the same page data
and active capabilities through the agent host's tool interface. Closing an MCP
session leaves the shared helper running. MCP host permissions govern process
and network access; MCP itself does not bypass sandbox isolation.

Report vulnerabilities as described in the [security policy](../SECURITY.md).
