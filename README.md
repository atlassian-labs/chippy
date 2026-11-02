![Chippy logo](.agents/skills/chippy/extension/icon-48.png)

# Chippy

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

**A friend who helps you understand what’s happening, find the cause, and fix it.**

Chippy connects a browser page to a coding agent through a local helper. Work
from either side: ask the agent to find and inspect components, drive interactions,
and capture renders, or drag a probe onto an element and attach an intent and
comment to direct the agent from the UI. Both routes expose components, owners,
props, hooks, and source locations. Avalanche captures show which components
rendered and distinguish update sources from collateral.

Chippy works with standard React; no React or React DOM package patch is required.
Development builds provide the richest evidence. Production builds expose less
source and hook detail; each result reports what was actually available.
See [React compatibility](docs/react-compatibility.md) for capture and replay limits.

## What you can ask

- **Explore:** "Which components render this list, and what state do they hold?"
- **Debug:** "Where does this label's text come from?" or "Which boundary shows this spinner?"
- **Compare:** "What changed in the tree between these two states, or these two pages?"
- **Investigate:** "Why is this click slow?" or "What re-renders on initial load?"

## Install

For an MCP-capable agent host, configure the [local Chippy MCP server](.agents/skills/chippy/references/mcp.md)
after installing the skill. It starts or reuses the helper automatically and
exposes typed inspection, profiling, and UI annotation tools. The host must run
it where the browser can reach its helper; MCP does not remove network isolation.

You need Node.js 22.12 or later and a Chromium browser. Install the skill with
the package's installer:

```sh
npx @atlassian/chippy install
```

Until the package is published, build and run the installer
from a clone of this repository:

```sh
yarn chippy:library:build
node packages/chippy/bin/chippy.mjs install
```

This installs the self-contained agent skill at `~/.agents/skills/chippy` and
replaces an earlier Chippy install. Pass `--dir <path>` to install elsewhere; the
installer refuses to replace a directory that is not a Chippy skill unless you
pass `--force`. It then prints the extension link, the MCP configuration with the
resolved path, and whether the helper is running. `./install-chippy-skill.sh`
remains as a copy-only alternative for a checkout.

Install the browser extension: turn on developer mode on your browser's
extensions page, choose **Load unpacked**, and select the `extension` folder of
the installed skill (`~/.agents/skills/chippy/extension` by default) or
`.agents/skills/chippy/extension` in a checkout.

The agent uses the installed [skill](.agents/skills/chippy/SKILL.md) to start the
helper, select the connected page, and read probe evidence. Helper commands are
also available directly:

```sh
~/.agents/skills/chippy/scripts/chippy.sh start
~/.agents/skills/chippy/scripts/chippy.sh health
~/.agents/skills/chippy/scripts/chippy.sh pages
```

Enable Chippy for the page's origin in the extension popup. Then choose your
starting point:

- **From the agent:** ask it to use Chippy on the connected page. It can find
  components by name, text, test ID, source file, or prop, inspect their runtime
  state, drive interactions, and capture renders without a manually placed probe.
- **From the UI:** open the small Chippy button and drag P1 or P2 onto an element.
  Attach an explain, investigate, or change intent and a comment. Ask the agent to
  read the annotation, or to wait for new annotations while you work in the page.

For a page without the extension, import the helper's module in the browser console:

```js
import('http://127.0.0.1:7823/__chippy/inject.mjs')
```

Import again after a full navigation or reload. Initial-load profiling needs an
integration installed before React evaluates, such as the enabled extension.

## Evidence, then edits

A probe ties the visible element to the rendered React fiber. The agent follows
that evidence into the reported source instead of guessing from search results.
Avalanche captures bounded commit windows, while hook replay provides structural
detail when the renderer exposes the necessary internals.

Hook replay executes component and custom-hook bodies. Use fiber-only reads when
those bodies have render-time side effects. Chippy changes application source only
as part of an authorized task; verification returns to the same runtime signal.

## Use Chippy as a library

The [Chippy npm package](packages/chippy/README.md) exposes standalone Avalanche
capture through `@atlassian/chippy/avalanche`, early React integration through
`@atlassian/chippy/bootstrap`, agent connection through `@atlassian/chippy/browser`, and the addon
through `@atlassian/chippy/storybook`. Build and install its tarball from this repository;
it is not yet published to npm. Standalone Avalanche needs no helper or extension.

## Explore and contribute

| Need | Start here |
| --- | --- |
| Use Chippy with an agent | [Agent skill](.agents/skills/chippy/SKILL.md) |
| Find a procedure or command | [Reference chooser](.agents/skills/chippy/references/README.md) |
| Understand runtime support | [React compatibility](docs/react-compatibility.md) |
| Build, test, or change Chippy | [Contributing](CONTRIBUTING.md) |
| See what changed between releases | [Changelog](CHANGELOG.md) |
| Take part in the project | [Code of conduct](CODE_OF_CONDUCT.md) |
| Find the owning module | [Runtime source map](src/README.md) |
| Add app-specific knowledge | [Plugins](docs/plugins.md) |
| Use the project identity | [Brand assets](docs/brand/README.md) |
| Understand page data and helper access | [Trust boundary](docs/trust-boundary.md) |
| Report a vulnerability | [Security policy](SECURITY.md) |
| Prepare distribution artifacts | [Release guide](docs/releasing.md) |

The repository combines the reusable Chippy skill and extension with a Storybook
validation lab. Applications inspected by Chippy are separate from both; local
external-project links are not shipped with the skill.

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-cheers.png)](https://www.atlassian.com)
