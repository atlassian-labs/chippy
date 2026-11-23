![Chippy logo](https://raw.githubusercontent.com/atlassian-labs/chippy/main/.agents/skills/chippy/extension/icon-48.png)

# Chippy

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](https://github.com/atlassian-labs/chippy/blob/main/LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/atlassian-labs/chippy/blob/main/CONTRIBUTING.md)

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
builds give the most detail.

**Chippy profiles production builds too.** Point it at your deployed site and
it records which commits ran, which components rendered, and which prop or
state changes caused them, through React's DevTools hook, with no special React
build. When the site serves source maps, Chippy recovers the authored component
names and where each one is defined. Without them, names may be minified, so
keeping `displayName`s in production code helps a lot. Owner chains, hook
replay, and JSX source lines need a development build, and every answer says
what was available. See [Production builds](https://github.com/atlassian-labs/chippy/blob/main/docs/react-compatibility.md#production-builds).

## What you can ask

- **Explore:** "Which components render this list, and what state do they hold?"
- **Debug:** "Where does this label's text come from?" or "Which boundary shows this spinner?"
- **Compare:** "What changed in the tree between these two states, or these two pages?"
- **Investigate:** "Why is this click slow?", "What re-renders on initial load?",
  or "Which component shifted the layout or delayed LCP?"

## What Chippy senses

Chippy reads the page through many senses at once and puts them on one clock,
so the agent can connect what the user saw to the code that caused it:

| Sense | What the agent gets |
| --- | --- |
| React tree | Components, props, state, hooks, owners, Error and Suspense boundaries, and source locations |
| Renders | Every commit during an interaction or the initial load: which components rendered, why, and which one started the cascade |
| Hooks | A replay of a component's render that shows how its hooks produced a value |
| Screen | Suspense fallbacks the user waited for, and how much of a view is still a skeleton |
| DOM | What each commit changed in the DOM, in order: flicker, replaced nodes, content that comes and goes |
| Input | Each click, key press, and input event, with its DOM target and nearest component, linked to the commit it set off |
| Network | Requests from Resource Timing, with their timing and cache use, placed next to the commits around them |
| Browser performance | Layout shifts, long frames, slow interactions (INP), LCP, and your own `performance.mark` and `measure` entries |
| Snapshots | A fingerprint of every component's props in one state, diffed against another state or another page |
| Your app | Anything a [pack](#packs) teaches it: your boundary names, your metrics, your data layer |

## Install

Chippy has three parts:

- The **agent skill** tells your coding agent how to run Chippy.
- The **local helper** is a small server on `127.0.0.1:7823`. The agent starts
  it when it needs it.
- The **page runtime** runs inside the page and reads React.

The skill and the helper are the same in every setup. You choose how the page
runtime gets into the page; see [Connect a page](#connect-a-page).

You need Node.js 22.20 or later, which the skills CLI requires.

1. Install the agent skill with the [skills CLI](https://github.com/vercel-labs/skills):

   ```sh
   npx skills add atlassian-labs/chippy --skill chippy -g
   ```

   Choose your coding agents when it asks, or name them with `-a`, for example
   `-a claude-code`. With `-g`, every project can use the skill, and its files
   live in `~/.agents/skills/chippy`; each agent's skills folder links to that
   copy. Leave out `-g` to install it in the current project's
   `.agents/skills/chippy` instead. Run `npx skills update chippy` to update it.

2. Connect a page with one of the routes in [Connect a page](#connect-a-page).

3. Ask your agent to use Chippy on the page.

The agent runs Chippy through the skill's `chippy.sh` script, which needs bash
(macOS, Linux, or WSL on Windows). You don't start anything yourself: the agent
starts a local helper on `127.0.0.1:7823` when it needs one. A sandboxed agent
asks for permission to reach it; approve the prompt or allow `chippy.sh`. If
your agent runs in a container or on a remote machine, the browser must reach
the helper's port through an SSH tunnel, a published container port, or other
forwarding your environment provides; Chippy does not set that up.
[Local and wide binds](https://github.com/atlassian-labs/chippy/blob/main/docs/trust-boundary.md#local-and-wide-binds)
lists what to set for each setup.

**Optional: connect over MCP.** If your agent supports MCP, it can call Chippy
as tools instead of running a script. Ask it:

> Connect Chippy over MCP using the MCP setup steps in the Chippy skill.

The agent adds the Chippy server to its own MCP configuration and checks the
connection. Some agents need a restart before the new tools appear. To set it
up yourself, see [MCP setup](https://github.com/atlassian-labs/chippy/blob/main/.agents/skills/chippy/references/mcp.md).

## Connect a page

Every route loads the same page runtime and talks to the same helper. The
routes differ in what you set up, whether Chippy stays after a reload, and
whether Chippy can record the initial page load.

| Route | What you set up | After a reload | Records the initial load |
| --- | --- | --- | --- |
| [Browser extension](#browser-extension) | Load the extension once, then enable it for each site | Chippy loads again | Yes |
| [Agent-driven browser](#agent-driven-browser) | Nothing. The agent opens its own Playwright browser | Chippy loads again | Yes, when the agent loads Chippy before the page |
| [Local proxy](#local-proxy) | Nothing. The agent starts the proxy, and you open the proxy address | Chippy loads again | Yes |
| [Storybook addon](#storybook-addon) | Add the addon to your Storybook configuration | Chippy remounts the story and stays | The story's mount |
| [Console import](#console-import) | Paste one line into the page's console | Chippy is removed. Paste the line again | No |
| [Your app's code](#your-apps-code) | Install the npm package and call `connectChippy()` | Call it again | No |

"Records the initial load" means that the agent can reload the page and record
the renders from the first commit. Every route records renders that happen
after Chippy connects.

### Browser extension

Use the extension for day-to-day work in your own Chrome or Chromium browser.

1. Open `chrome://extensions`, turn on **Developer mode**, and choose
   **Load unpacked**. Select the skill's `extension` folder:
   `~/.agents/skills/chippy/extension`, or `.agents/skills/chippy/extension`
   in your project if you installed without `-g`. The folder picker hides
   folders whose names start with a dot, so type the path instead of browsing.
   On macOS, press **Cmd+Shift+G**, paste the path, press **Return**, and
   choose **Select**. On Linux, press **Ctrl+L** and paste the path. On
   Windows, paste it into the address bar. After `npx skills update`, click
   **Reload** on the Chippy card in `chrome://extensions`.
2. Open your app, click the Chippy extension icon, choose **Enable** for the
   page's origin, and then reload the page. Later loads of that origin load
   Chippy automatically.

### Agent-driven browser

The agent opens a Playwright browser, loads Chippy into the page, and drives
the page itself. No extension is needed. Use this route for repeatable flows,
headless checks, and CI. Ask your agent to open the page with Chippy in
Playwright; the skill has the setup steps.

### Local proxy

The helper can sit in front of a dev server on your machine and add Chippy to
the page before the page's own scripts run. No extension is needed, and this
route works in any browser, including one that your agent drives. Ask your
agent to start the Chippy proxy for your page, then open the address that it
gives you on `127.0.0.1:7823`. The proxy forwards only to servers on this
machine, and it adds Chippy only to the page address that the agent gave it.
It removes the page's Content Security Policy headers, so it also works for
pages that block the console import.

### Storybook addon

In Storybook 10.3 or later, add the addon to your Storybook configuration:

```js
export default {
  addons: ['@atlassian/chippy/storybook'],
};
```

The addon adds Chippy panels to Storybook and connects each story to your agent.
When the agent reloads the page, Storybook remounts the current story instead of
reloading the preview. See the
[package documentation](https://github.com/atlassian-labs/chippy/blob/main/docs/npm-package.md#storybook)
for build targets.

### Console import

Use this for a quick look at a page where you cannot install the extension.
Once the agent has started the helper, paste this into the page's console:

```js
import('http://127.0.0.1:7823/__chippy/inject.mjs')
```

A reload removes Chippy, so paste the line again after every reload or
navigation. Sites with a strict Content Security Policy block the import.

### Your app's code

For pages that the extension cannot reach, such as an embedded browser, call
`connectChippy()` from `@atlassian/chippy/browser` in the page. It loads the
same runtime as the console import. See
[Connect a browser page to an agent](https://github.com/atlassian-labs/chippy/blob/main/docs/npm-package.md#connect-a-browser-page-to-an-agent).

## Ask the agent, or point at the page

- **Ask the agent** about the page. It finds components by name, text, test ID,
  source file, or prop, reads their state, clicks through the page, and records
  renders.
- **Point at the page:** click the Chippy button in the page corner and drag a
  probe marker (P1, or P2 to compare two elements) onto an element. Choose
  whether you want it explained, investigated, or changed, and add a note. Then
  ask the agent to read it, or to keep watching for new notes while you click
  around. The extension and the local proxy show the Chippy button. In
  Storybook, open the **Chippy** addon panel and choose **Show probes**; the
  P1/P2 dock appears in the story preview. The plain console import shows no
  probe UI; import `http://127.0.0.1:7823/__chippy/inject.mjs?ui=panel` to add
  the Chippy button and P1/P2 panel.

<p align="center">
  <a href="assets/chippy-call.mp4"><img src="assets/chippy-call.svg" width="900" alt="Animated clip: the asks roll in and Jira keeps them in line, so you call a chippy. Chippy gives your coding agent a hand in the running app: it finds the component and source line for a button to move, reads live props and state to show why a button stays disabled, compares before and after, finds what set off a slow click, connects the page, React, and your code, and turns the page into an experimentation lab."></a>
  <br><a href="assets/chippy-call.mp4">Watch with sound</a>
</p>

## Evidence, then edits

The agent works from what actually rendered instead of guessing from a code
search. Some deep inspections re-run a component's code; if your components have
side effects during render, say so and the agent uses read-only inspection
instead. Chippy changes your source only when you ask it to, and checks the fix
against the same page.

## Packs

A pack teaches Chippy about your application without changing Chippy. It is one
JSON document your team keeps and shares, and it can:

- **Name your components and boundaries.** Rules turn your loading, error, and
  region components into named boundary kinds with their own probe fields.
- **Add your own senses to recordings.** Avalanche extensions are small scripts
  that run when a pack loads and on every recorded commit. They can read your
  app's metrics, watch spinners, or wrap a data client, and their results
  appear in the recording next to Chippy's own evidence.
- **Tell the agent how to read it.** A pack's `instructions` travel with its
  data, so any agent reads your evidence the way your team does.

```json
{
  "id": "my-app",
  "label": "My app",
  "instructions": "`hooks[\"my-app.mutations\"].end.total` counts DOM mutations during the recording.",
  "avalancheExtensions": {
    "mutations": {
      "onInit": "const observer = new MutationObserver((list) => { window.__MY_APP_MUTATIONS += list.length; }); window.__MY_APP_MUTATIONS = 0; observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();",
      "onStart": "ctx.state.from = window.__MY_APP_MUTATIONS;",
      "onEnd": "return { total: window.__MY_APP_MUTATIONS - ctx.state.from };"
    }
  }
}
```

Load a pack by pasting it into **Packs** in the Chippy panel's settings, where
you can keep several and switch each on or off. It loads from the next page
load, early enough to set up globals your app reads while it starts.

**Developing your own pack.** Ask your agent to write one: describe what you
want measured, and it can iterate on the live page with
`__AVALANCHE__.registerPack(pack)`, which loads a new version at once and
replaces the old one. Have `onInit` return a function that undoes what it set
up, such as disconnecting an observer or restoring a wrapped function; Chippy
calls it before the new version loads, so the old one stops cleanly.
`status().packs` reports scripts that failed to compile or initialize. Keep the
pack source in your own repository and paste the finished JSON into the panel.
The [pack reference](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md#packs)
covers every field, the script context, and the loading routes.

## Use Chippy without an agent

The `@atlassian/chippy` npm package also works with no agent, helper, or
extension:

- **Catch re-render regressions in tests.** Record which components rendered
  during an interaction, and why, in a test or a script. Install the recorder in
  your app's entry module before React DOM loads, and it records from the first
  commit.
- **Ship your own build** with extra plugins for your stack.

See the [package documentation](https://github.com/atlassian-labs/chippy/blob/main/docs/npm-package.md) for setup.

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

- [Agent skill](https://github.com/atlassian-labs/chippy/blob/main/.agents/skills/chippy/SKILL.md) and its [references](https://github.com/atlassian-labs/chippy/blob/main/.agents/skills/chippy/references/README.md)
- [React compatibility](https://github.com/atlassian-labs/chippy/blob/main/docs/react-compatibility.md)
- [Plugins and packs](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md) for app-specific knowledge, and [writing a pack](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md#packs)
- [Trust boundary](https://github.com/atlassian-labs/chippy/blob/main/docs/trust-boundary.md): what page data Chippy sees and who can reach the helper
- [Security policy](https://github.com/atlassian-labs/chippy/blob/main/SECURITY.md)
- [Changelog](https://github.com/atlassian-labs/chippy/blob/main/CHANGELOG.md)

To build, test, or change Chippy, see [Contributing](https://github.com/atlassian-labs/chippy/blob/main/CONTRIBUTING.md) and the
[code of conduct](https://github.com/atlassian-labs/chippy/blob/main/CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](https://github.com/atlassian-labs/chippy/blob/main/LICENSE) file.

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-cheers.png)](https://www.atlassian.com)
