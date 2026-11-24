# Packs

A pack is one JSON document that teaches Chippy about an application: how it
names its boundaries, which extra signals to record with Avalanche, and how an
agent should read the results. The product team owns and shares its packs;
Chippy ships none. The full field reference is
[Plugins: Packs](https://github.com/atlassian-labs/chippy/blob/main/docs/plugins.md#packs).

## Read a loaded pack

1. `avalanche-status <clientId>` or `status().packs` lists each pack with its
   `instructions`, `kinds`, and `extensions[].reportKey`.
2. Read the pack's `instructions` before its data. Each extension's results
   repeat them in `report.hooks["<pack id>.<extension name>"].instructions`.
3. Extension results: `start` and `end` are in `avalanche-status` under
   `hooks`; one commit's `onStep` result is in `avalanche-commit-peek`'s `hooks`
   slice.
4. `compileErrors`, `initErrors`, and `hooks[<key>].errors` mean the pack is
   broken. Report them as pack defects, not as page behavior.

## Shape

| Field | Purpose |
| --- | --- |
| `id`, `label` | Required id matching `/^[a-z][a-z0-9-]*$/`, as must extension names, and an optional display label. A pack with the id of a loaded pack replaces it. |
| `instructions` | Markdown for agents on how to read everything the pack adds. |
| `components` | Rules that turn matched components into named boundary kinds with probe fields. |
| `labels` | Where the application names its Suspense, error, and custom boundaries. |
| `avalancheExtensions` | Named extensions: `{ "<name>": { instructions?, onInit?, onStart?, onStep?, onEnd? } }`. |

Each script is a function body string compiled with `new Function('ctx', body)`:

| Script | Runs | `ctx` | Return value |
| --- | --- | --- | --- |
| `onInit` | Once, when the pack registers | `{ id }`, the report key | Optionally a cleanup function |
| `onStart` | When a recording starts | `state` (per recording), `commits` | `hooks[key].start` |
| `onStep` | After each captured commit | adds `commit: { id, components, startTime, endTime, root }` | `hooks[key].steps[commitId]` |
| `onEnd` | When the report is collected | as `onStart` | `hooks[key].end` |

## Write a pack

Write a pack only when the user asks for one, and keep its source in the user's
repository, not in the Chippy skill.

1. **Start from the question.** Name the signal the user needs (a spinner
   interval, a data-client request, an app metric) and the commit or recording
   it belongs to. Put the reading rules in `instructions`.
2. **Set up in `onInit`, measure in the recording scripts.** `onInit` creates
   globals, observers, or wrappers; `onStart`, `onStep`, and `onEnd` read them
   and return small JSON-safe summaries. Keep `onStep` cheap: it runs after
   every commit, and 20 failures disable it for the rest of the recording.
3. **Return a cleanup from `onInit`.** It runs when `unregisterPack(id)` removes
   the pack and before a same-id replacement's `onInit`. Disconnect observers,
   clear timers, and restore every function the pack wrapped; otherwise each
   new version stacks on the old one until the page reloads. A throwing cleanup
   appears in the replacement's `initErrors` as `"<key> cleanup: <error>"`.
4. **Keep `onInit` idempotent.** The bundle can evaluate twice on one page, and
   a global the host already owns must be left alone.
5. **Iterate on the live page.** Load each version with an `eval-page <clientId> -`
   script that calls `__AVALANCHE__.registerPack(pack)` and returns the status.
   Check `compileErrors` and `initErrors`, then `avalanche-clear`, reproduce,
   and read the extension's results. A pack loaded mid-recording steps from the
   next commit without `onStart`, so clear before a full run.
6. **Hand it over.** The user pastes the finished JSON into **Packs** in the
   Chippy panel's settings. It loads from the next page load, early enough for
   `onInit` to create globals the page reads while it starts.

A pack runs page script on every origin where it is active, and a page with a
Content Security Policy that forbids `unsafe-eval` reports every script in
`compileErrors`.
