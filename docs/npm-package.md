# Chippy library

Use Avalanche to capture React commit evidence in your own application or tests.
The standalone detector needs no Chippy extension, agent, local helper, or
Storybook. Browser and Storybook entry points add Chippy's agent integration.

## Install

```sh
npm install --save-dev @atlassian/chippy
```

Node.js 22.12+ is required for the package tooling.

## Standalone Avalanche

Initialize the DevTools hook before React DOM evaluates. Keep application loading
in a separate module so static imports cannot evaluate React DOM first:

```js
// bootstrap.js — application entry
import '@atlassian/chippy/bootstrap';
import { createAvalancheDetector } from '@atlassian/chippy/avalanche';

export const detector = createAvalancheDetector({
  detectionMode: 'sources',
  historySize: 100,
  captureFibers: false,
});
detector.install();
await import('./app.js');
```

After an interaction, read `detector.report()`. Call `detector.reset()` before
measuring another interaction and `detector.uninstall()` to stop capture and
remove its listeners. These operations do not require a UI. The detector import
itself does not install hooks, start capture, or connect to a helper. Call
`report.toSerializable()` before you log, snapshot, or send a report; it drops
fiber references and component functions.

`@atlassian/chippy/bootstrap` intentionally installs a DevTools hook only when one is absent;
it preserves an existing DevTools integration.

`detectionMode` sets how much each commit records, from cheapest to most
detailed: `'stats'` (commit counts and restarts), `'sources'` (which components
rendered and why), `'amplifierMetrics'` (adds hook-churn counts), and
`'amplifiers'` or its alias `'full'` (adds per-hook amplifier detail).
`DETECTION_LEVEL` exports these names. `captureFibers: true` keeps a fiber
reference on each report source, independent of `detectionMode`; leave it
`false` in tests that serialize reports. Capture adds work to every commit, so keep it to development and tests, and
measure the overhead in your app. React internals vary by build and version;
missing source or owner data does not mean capture failed.

Without options, the defaults depend on `NODE_ENV`. Development builds use
`detectionMode: 'full'`, `captureFibers: true`, and `historySize: 10`; production
builds use `'amplifiers'`, `captureFibers: false`, and `historySize: 1`. Pass
options explicitly for predictable capture. Other options: `ignore` (component types to skip),
`effectThrashMode` (`'non-primitive'` by default, or `'all'`),
`interactionCapture` (`'explicit'` by default for clicks, keys, and input;
`'off'`, `'noisy'`, or `'all'`), `interactionEvents` (extra native event names),
`interactionWindowMs` (window for linking an action to a commit, default 1000),
and `metricsAdapter` (defaults to the registered adapter; `null` captures through
the DevTools hook only).

## Connect a browser page to an agent

Use this for pages the extension cannot reach, such as an embedded browser or a
test runner. With the helper running (your agent starts it through the Chippy MCP
server or skill), call:

```js
import { connectChippy } from '@atlassian/chippy/browser';
const connection = await connectChippy('http://127.0.0.1:7823');
```

This imports the helper-served runtime into the current document and waits for
its readiness result. It requires a running helper and a page whose CSP and
network policy allow that module URL. The default helper URL is
`http://127.0.0.1:7823`; only HTTP and HTTPS are accepted. Reconnect after a full
reload or navigation. Import `@atlassian/chippy/bootstrap` before React DOM when you need
commit capture or dispatcher-backed replay. The browser entry does not connect
until `connectChippy()` is called.

## Storybook

In your Storybook 10.3+ configuration:

```js
export default {
  addons: ['@atlassian/chippy/storybook'],
};
```

The addon adds the Chippy panels to Storybook and connects stories to your agent
through the same local helper as the extension. The addon always connects to the
helper at `http://127.0.0.1:7823` and has no option for another port, so keep the
helper on the default port for Storybook. If your Storybook build targets older
browsers, set the build target to `es2022`, for example `build.target` in
`viteFinal`.

## Custom builds with plugins

To teach Chippy about your own stack, write plugins with `@atlassian/chippy/plugin`
and ship them as your own skill and extension. `npx @atlassian/chippy pack` reads `chippy.config.mjs` and
builds a skill and extension that include your plugins, default plugin selection,
extension name and version, and extra skill documentation. It needs `esbuild` in
your project. See
[Plugins](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md#packing-a-custom-build)
for the config format.

## Command line

`npx @atlassian/chippy pack [--config <file>]` builds a custom skill and extension
(see above); the config defaults to `chippy.config.mjs`. `--version` (`-v`) prints
the package version and `--help` (`-h`) prints usage. `install` no longer installs
the skill; it prints the skills CLI command and exits with status 1.

## MCP

The package includes `chippy-mcp`, which connects an agent host to the helper. Add
it to your agent's MCP configuration, run from your project:

```json
{
  "mcpServers": {
    "chippy": {
      "command": "npx",
      "args": ["chippy-mcp"]
    }
  }
}
```

Install the skill too, so the agent knows how to investigate:

```sh
npx skills add atlassian-labs/chippy --skill chippy -g
```

`chippy-mcp` starts the helper bundled with the package, and the skill starts its
own helper; both default to port 7823. Keep the package and the installed skill at
the same Chippy version, or MCP reports an incompatible helper on that port. To
run them separately, set `CHIPPY_HELPER_PORT` for `chippy-mcp`.

See [MCP setup](https://github.com/atlassian-labs/chippy/blob/main/.agents/skills/chippy/references/mcp.md)
for other hosts and ports.

## License

Copyright (c) 2026 Atlassian US., Inc. Apache 2.0 licensed, see [LICENSE](LICENSE). The
package does not include React or React DOM.
