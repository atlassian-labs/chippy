![Chippy logo](.agents/skills/chippy/extension/icon-48.png)

# Chippy

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

**A friend who helps you understand what’s happening, find the cause, and fix it.**

Chippy lets your coding agent see the React app running in your browser: which
component drew an element, its props and state, where it lives in source, and
what re-rendered during a slow interaction. Ask the agent, or point at an element
on the page and leave it a note.

Chippy works with standard React and needs no patched packages. Development
builds give the most detail; production builds show less, and every answer says
what was available. See [React compatibility](docs/react-compatibility.md).

## What you can ask

- **Explore:** "Which components render this list, and what state do they hold?"
- **Debug:** "Where does this label's text come from?" or "Which boundary shows this spinner?"
- **Compare:** "What changed in the tree between these two states, or these two pages?"
- **Investigate:** "Why is this click slow?" or "What re-renders on initial load?"

## Install

You need Node.js 22.12 or later and Chrome or another Chromium browser.

1. Install the agent skill:

   ```sh
   npx @atlassian/chippy install
   ```

   This copies the skill to `~/.agents/skills/chippy` (run it again to update)
   and prints the next steps with the exact paths for your machine.

2. Load the browser extension: open `chrome://extensions`, turn on
   **Developer mode**, choose **Load unpacked**, and select the `extension`
   folder the installer printed (`~/.agents/skills/chippy/extension` by
   default). The folder picker hides dot-folders, so paste the path instead of
   browsing: press **Cmd+Shift+G** on macOS or **Ctrl+L** on Linux, or use the
   address bar on Windows.

3. Connect your agent. For Claude Code:

   ```sh
   claude mcp add chippy -- node ~/.agents/skills/chippy/scripts/chippy-mcp.cjs
   ```

   Other MCP hosts take the JSON configuration the installer printed; see
   [MCP setup](.agents/skills/chippy/references/mcp.md). Agents without MCP use
   the skill's `chippy.sh` script, which needs bash (macOS, Linux, or WSL on
   Windows).

4. Open your app, click the Chippy extension icon, and enable Chippy for the
   page's origin.

5. Ask your agent to use Chippy on the page.

You don't start anything yourself: the agent starts a local helper on
`127.0.0.1:7823` when it needs one. A sandboxed agent asks for permission to
reach it; approve the prompt or allow the Chippy MCP server or `chippy.sh`. If
your agent runs in a container or a remote machine, see
[MCP setup](.agents/skills/chippy/references/mcp.md) for reaching the helper.

## Two ways to start

- **From the agent:** ask it about the page. It finds components by name, text,
  test ID, source file, or prop, reads their state, clicks through the page, and
  records renders.
- **From the page:** click the Chippy button in the page corner and drag a probe
  marker (P1, or P2 to compare two elements) onto an element. Choose whether you
  want it explained, investigated, or changed, and add a note. Then ask the agent
  to read it, or to keep watching for new notes while you click around.

No extension? Once the agent has started the helper, paste this into the page's
console:

```js
import('http://127.0.0.1:7823/__chippy/inject.mjs')
```

Repeat it after every reload. Sites with a strict Content Security Policy block
it, and it can't record the initial page load; use the extension for that.

## Evidence, then edits

The agent works from what actually rendered instead of guessing from a code
search. Some deep inspections re-run a component's code; if your components have
side effects during render, say so and the agent uses read-only inspection
instead. Chippy changes your source only when you ask it to, and checks the fix
against the same page.

## Use Chippy from your own code

Install `@atlassian/chippy` in your project when the extension is not the right fit:

- **Catch re-render regressions in tests.** Record which components rendered
  during an interaction, and why, in a test or a script, with no agent, helper, or
  extension.
- **Connect pages the extension cannot reach**, such as an embedded browser or a
  test runner, or connect from your app's startup code so Chippy sees the first
  render.
- **Add Chippy to Storybook** as an addon.
- **Ship your own build** with extra plugins for your stack.

See the [package documentation](packages/chippy/README.md) for setup.

## Learn more

- [Agent skill](.agents/skills/chippy/SKILL.md) and its [references](.agents/skills/chippy/references/README.md)
- [React compatibility](docs/react-compatibility.md)
- [Plugins](docs/plugins.md) for app-specific knowledge
- [Trust boundary](docs/trust-boundary.md): what page data Chippy sees and who can reach the helper
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

To build, test, or change Chippy, see [Contributing](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-cheers.png)](https://www.atlassian.com)
