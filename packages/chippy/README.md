# Chippy library

Use Avalanche to capture React commit evidence in your own application or tests.
The standalone detector needs no Chippy extension, agent, local helper, or
Storybook. Browser and Storybook entry points add Chippy's agent integration.

## Install from this repository

From the repository root, build and pack the library:

```sh
yarn chippy:library:build
cd packages/chippy
npm pack
```

Install the resulting `atlassian-chippy-0.1.0.tgz` in your application. This package is not
yet published to npm. Node.js 22.12+ is required for the package tooling.

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
itself does not install hooks, start capture, or connect to a helper.

`@atlassian/chippy/avalanche` exports `createAvalancheDetector`, `DETECTION_LEVEL`, and the
TypeScript types `DetectorOptions`, `Report`, `ReportOptions`, and `SortBy`.
`@atlassian/chippy/bootstrap` intentionally installs a DevTools hook only when one is absent;
it preserves an existing DevTools integration.

Capture modes are `stats`, `sources`, `amplifiers`, and `full`. Higher-detail modes
retain more evidence and perform more work. Keep capture bounded, use this for
development diagnostics, and measure overhead in your application. React internals
vary by build and version; missing source, owner, replay, or scheduling data is
not proof that capture failed. ATL metrics are optional evidence supplied by the
host application. Chippy does not ship or install a React patch.

## Connect a browser page to an agent

Start the local helper through the installed Chippy agent skill, then:

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

The preset supplies the Chippy manager panels and preview integration. Use an
ES2022 build target for its top-level await. Agent commands need the local helper
on port 7823. Storybook, React, and React DOM remain application dependencies;
standalone Avalanche does not require Storybook.

## Custom builds with plugins

`@atlassian/chippy/plugin` exports the plugin types, `definePlugin`, and the fiber
helpers plugins use. `npx @atlassian/chippy pack` reads `chippy.config.mjs` and
builds a skill and extension that include your plugins, default plugin selection,
extension name and version, and extra skill documentation. It needs `esbuild` in
your project. See
[Plugins](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md#packing-a-custom-build)
for the config format.

## MCP

The package also installs `chippy-mcp`, a local stdio MCP executable. Configure
your agent host to run it; it starts or reuses the Chippy helper on loopback port
7823. Set `CHIPPY_HELPER_PORT` in that process's environment to select another
port, and configure your browser integration to match. The helper persists across
MCP disconnects to preserve browser evidence and other sessions. The executable
includes its runtime dependencies; no separate skill or helper installation is
needed for this package path. Agent investigation guidance still lives in the
Chippy skill. The host needs process/network access to the browser environment.

## License

MIT. The package contains its own license and does not include React or React DOM.
