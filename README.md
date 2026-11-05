![Chippy logo](.agents/skills/chippy/extension/icon-48.png)

# Chippy

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

**A friend who helps you understand what’s happening, find the cause, and fix it.**

<p align="center">
  <a href="assets/chippy-intro.mp4"><img src="assets/chippy-intro.svg" width="900" alt="Animated intro: Chippy connects your coding agent to the running React page through React's DevTools hook, traces a button to its component, owners, and source line, runs experiments on live state, separates a slow click's trigger from the busiest component, and shows the browser scripts, local helper, and agent skill working as one system."></a>
  <br><a href="assets/chippy-intro.mp4">Watch with sound</a>
</p>

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
   and prints the next steps with the exact paths for your machine. To install
   it in a project instead, pass `--dir`, for example
   `npx @atlassian/chippy install --dir .agents/skills/chippy`; the paths below
   then start from that folder.

2. Load the browser extension: open `chrome://extensions`, turn on
   **Developer mode**, choose **Load unpacked**, and select the `extension`
   folder the installer printed (`~/.agents/skills/chippy/extension` by
   default). The folder picker hides dot-folders, so paste the path instead of
   browsing: press **Cmd+Shift+G** on macOS or **Ctrl+L** on Linux, or use the
   address bar on Windows.

3. Open your app, click the Chippy extension icon, and enable Chippy for the
   page's origin.

4. Ask your agent to use Chippy on the page.

The agent runs Chippy through the skill's `chippy.sh` script, which needs bash
(macOS, Linux, or WSL on Windows). You don't start anything yourself: the agent
starts a local helper on `127.0.0.1:7823` when it needs one. A sandboxed agent
asks for permission to reach it; approve the prompt or allow `chippy.sh`. If
your agent runs in a container or a remote machine, see
[MCP setup](.agents/skills/chippy/references/mcp.md) for reaching the helper.

**Optional: connect over MCP.** If your agent supports MCP, it can call Chippy
as tools instead of running a script. Ask it:

> Connect Chippy over MCP using the MCP setup steps in the Chippy skill.

The agent adds the Chippy server to its own MCP configuration and checks the
connection. Some agents need a restart before the new tools appear. To set it
up yourself, see [MCP setup](.agents/skills/chippy/references/mcp.md).

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

See the [package documentation](docs/npm-package.md) for setup.

## How Chippy compares

Other tools read what React already exposes, such as a component name or a
source line, and hand it to a person or an agent. Chippy is a system of three
parts that work together:

- **In the browser,** Chippy walks React's fiber tree, owners, props, and hooks,
  records commits during an interaction or page load, and can replay a
  component's render to see how its hooks produced a value.
- **The local helper** stores that evidence and gives the agent only what it
  needs: compact summaries instead of raw trees, renders ranked by where a
  cascade started, and diffs between snapshots of two states or two pages.
- **The agent acts back on the page** at the React level, not only through
  clicks: it finds fibers by name, text, test ID, file, or prop, forces a single
  component to re-render, calls a component's callbacks directly, and records
  what happens.

| Tool | Built for | What it gives you | Where it stops |
| --- | --- | --- | --- |
| [React Developer Tools](https://react.dev/learn/react-developer-tools) | A person in DevTools | Component tree, props, state, hooks, and the Profiler | You read the panels and decide what to change |
| [react-grab](https://www.react-grab.com/) | A person handing off to an agent | Hover an element and copy its component name, file and line, and HTML for your agent | Your agent takes it from the pasted context |
| [react-scan](https://react-scan.com/) | A person watching the page | Render outlines, a toolbar showing what changed, and alerts on slow frames | Shows what is slow; finding the cause and fixing it is up to you |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | An agent driving a browser | Navigation, clicks, form input, snapshots, and screenshots | Works at the DOM and accessibility level, not inside React |
| **Chippy** | An agent working from runtime evidence | Live React state, render recordings, and snapshot diffs, reduced for the agent, plus React-level actions on the page | Changes the source when you ask, then re-checks the same page |

**Compared with react-grab.** Both start when you point at something on the
page and the tool works out which React component it is. react-grab copies that
context to your agent and its work is done. For Chippy, that is the first step.
A probe resolves the owner chain, hooks, and props, so the agent can follow a
value up the chain to the component that created it, past components that only
pass it along. Two probes resolve to their nearest common parent. The agent then
opens the source line, makes the change, and probes again to confirm it.

**Compared with react-scan.** Both answer "what rendered, and why?" react-scan
shows the answer on the page for a person to read. Chippy returns it as data for
an agent to build on. Render recordings cover both a single interaction and the
initial page load. The helper ranks them by where a render cascade started, not
only by how long each component took, so the agent can tell the component that
caused a slowdown from the ones that rendered along with it. The agent can then
re-render a single component on purpose to test a fix, and record again to
confirm the cascade is gone.

**Compared with React Developer Tools.** Chippy reads the same information
through React's DevTools hook and adds the steps a person would otherwise do by
hand: tracing a value to where it comes from, replaying a render to explain a
hook, comparing two states or pages, and separating the trigger of a slow
interaction from collateral renders.

**Compared with browser automation.** Tools such as agent-browser or Playwright
operate the page as a user would: they click, type, and take screenshots. Chippy
operates it from inside React and explains what React did in response. They work
well together. The agent uses an automation tool to repeat a user flow and
Chippy to inspect, nudge, and record the result, and keeps going until the
change is verified.

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
