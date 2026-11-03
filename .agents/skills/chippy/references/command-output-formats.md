# `chippy.sh` command output formats

Exact response shapes for the commands expanded below. Start with the complete [command surface](command-surface.md) when selecting a command.

Commands return either plain text lifecycle messages on stderr or JSON on stdout. Successful JSON normally includes `"ok": true`; failures include `"ok": false` and an `error`. Command-specific references own the larger contracts:

- [Avalanche detector](avalanche-detector.md) owns capture, commit, render, unmount, action, hook-debug, and offline-analysis shapes.
- [Stability render](stability-render.md) owns the `fiber-schedule-update` / `stability-nudge` procedure and verdict shapes.
- [Playwright probes](playwright-probes.md) owns `handoff-to-playwright` and browser-session shapes.
- [Snippet README](../snippets/README.md) owns `eval-page` inputs and result envelopes.

---

## `start`

Starts the helper in the background. Prints to **stderr** only; then echoes health JSON to **stdout**.

```
# stderr
Chippy helper started (pid 12345)        ← fresh start
Chippy helper already up at http://…    ← was already running
Failed to start Chippy helper.           ← timeout (exit 1)
```

stdout after stderr line — same shape as `health`:
```json
{ "ok": true, "now": "2026-04-16T08:39:49.493Z" }
```

---

## `stop`

Prints to **stderr** only, no stdout.

```
Chippy helper stopped
Chippy helper is not running
Timed out waiting for Chippy helper to stop    ← exit 1
```

---

## `health`

```json
{ "ok": true, "now": "2026-04-16T08:39:49.493Z" }
```

Fields: `ok` (bool), `now` (ISO 8601 timestamp).

---

## `inject-url`

Prints a lifecycle warning to stderr:

```text
Import integration is document-scoped: a full reload/navigation removes Chippy and requires the user or automation to inject it again.
```

Then prints the classic-script URL to stdout, one line:

```
http://127.0.0.1:7823/__chippy/inject.js
```

---

## `recipes <query...> [--limit N]`

Searches the local one-record-per-line corpus without contacting the helper. Results are plain-text blocks ordered by descending BM25-style score. The default limit is five; `--limit` accepts integers from 1 through 20.

```text
recipe: page-boundary-forest
score: 24.842
question: How do I read the whole page in large Error and Suspense boundary blocks?
answer: Run `chippy.sh page-boundaries <clientId> [max]`; ordinary fibers are filtered out while boundary nesting and root containment are preserved.
done: The boundary-only forest covers every root and reports `truncated: false`.
guard: If truncated, increase `max`; absence of boundaries is a valid complete result when truncation is false.
refs: SKILL.md#route-by-question,references/command-output-formats.md
```

Records are separated by one blank line. `score` is useful only for ordering results from the same query; it is not a confidence value. An empty query, a limit outside 1–20, an empty corpus, or no match exits 1 with a diagnostic on stderr.

---

## `pages [slice]`

`slice` = `minimal` (default) | `standard` | `full`

```json
{
  "ok": true,
  "count": 2,
  "duplicatePageWarnings": null,
  "pages": [ /* array of client objects */ ]
}
```

`duplicatePageWarnings` is `null` when no duplicates, otherwise a map of canonical URL → array of clientIds:
```json
{
  "http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default": ["abc-123", "def-456"]
}
```

**Client object — fields by slice:**

| Field | minimal | standard | full |
|---|---|---|---|
| `summary` | ✓ | ✓ | ✓ |
| `clientId` | ✓ | ✓ | ✓ |
| `pageRef` | ✓ | ✓ | ✓ |
| `visibleName` | ✓ | ✓ | ✓ |
| `isLikelyCurrent` | ✓ | ✓ | ✓ |
| `connectedAt` | ✓ | ✓ | ✓ |
| `lastMessageAt` | ✓ | ✓ | ✓ |
| `lastActivityAt` | ✓ | ✓ | ✓ |
| `lastActivityReason` | ✓ | ✓ | ✓ |
| `activity` | ✓ | ✓ | ✓ |
| `latestSnapshotAt` | ✓ | ✓ | ✓ |
| `snapshotAgeMs` | ✓ | ✓ | ✓ |
| `bridgeVersion` | ✓ | ✓ | ✓ |
| `integration` | ✓ | ✓ | ✓ |
| `activated` | ✓ | ✓ | ✓ |
| `probesActive` | ✓ | ✓ | ✓ |
| `buildMode` | ✓ | ✓ | ✓ |
| `page` | ✓ | ✓ | ✓ |
| `latestSnapshot` | ✓ | ✓ | ✓ |

**`latestSnapshot.markers` fields by slice:**

| Marker field group | minimal | standard | full |
|---|---|---|---|
| `position`, `docked`, `intent`, `comment` | ✓ | ✓ | ✓ |
| `confidence`, `note`, `nearestTestId`, `dom.tag`, `dom.text`, `component.name`, `component.key` | ✓ | ✓ | ✓ |
| full `dom`, `component.props`, `component.source` | — | ✓ | ✓ |
| `component.owners` (up to 10), `component.parents` (up to 20), `componentStack`, `component.hookCount` | — | ✓ | ✓ |
| full `owners` + `parents` (all, unbounded) | — | — | ✓ |

**`nearestTestId`** is present on every marker in all slice modes (`string | null`). It is the nearest ancestor—including the probed element—with `data-testid`; it is `null` when none exists.

**Probe annotation** is present on every marker in all slice modes. `intent` is `"explain" | "investigate" | "change" | null`; `comment` is always a string (up to 2,000 characters). For P1/P2 these are developer-authored request context attached to the visible target. P3 has `intent: null` and `comment: ""` because it is computed rather than directly annotated.

**Marker `"3"` (P3)** is the auto-generated common parent when P1 and P2 are both placed and not docked. It is computed from their fiber return chains, has `position: null` and `docked: false`, and uses the same resolved shape as P1/P2.

`page` sub-object:

```json
{ "url": "http://…", "title": "Example app", "storyId": null }
```

`buildMode`: `"dev" | "production" | "unknown"`

`dev` source evidence is either React <=18 `_debugSource` or React 19 `_debugStack`. For React 19, the first snapshot may carry the served-module URL and generated position; the bridge resolves the module's inline or external Source Map v3 payload in the page realm and republishes the authored `fileName`, `lineNumber`, and `columnNumber` with reason `<original-reason>-source-resolved`. Explicit component descriptions await that resolution. If the module or map is unavailable, the served position remains the fallback.

**`integration`** — identifies who established Chippy on this page:
```json
{
  "kind": "extension | import | storybook",
  "who": "human-readable integration owner",
  "source": "real source file that established the integration",
  "reinjectsOnReload": true,
  "reloadAction": "what happens or what the user must do after reload"
}
```

For `kind: "import"`, `reinjectsOnReload` is always `false`: full reload/navigation removes Chippy and the user or automation must run the import again.

**`summary`** — human-readable one-liner for quick page identification:
```
<title> | <integration.who> | <url> | activity: <reason> @ <lastActivityAt> | snapshot <N>s ago
```
`null` title/url shown as `(no title)` / `(no url)`. `snapshotAgeMs` is `null` when no snapshot exists yet.

**Empty `pages` state:**

```json
{ "ok": true, "count": 0, "hint": "No clients connected. Open a page with the Chippy extension enabled and reload it.", "duplicatePageWarnings": null, "pages": [] }
```

## `recent-pages`

Returns the ten newest activity records from an in-memory, 30-record history. It is diagnostic history, not proof that a page is still connected.

```json
{
  "ok": true,
  "count": 2,
  "pages": [
    {
      "clientId": "abc-123",
      "at": "2026-08-03T09:30:00.000Z",
      "reason": "snapshot",
      "detail": null,
      "integration": { "kind": "extension", "who": "Chippy browser extension" },
      "pageLabel": "Layout Playground",
      "title": "Layout Playground",
      "url": "http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default",
      "storyId": "labs-layoutplayground--default"
    }
  ]
}
```

Empty history:

```json
{ "ok": true, "count": 0, "pages": [] }
```

---

## `page <clientId> [slice]`

`slice` defaults to `standard`.

```json
{
  "ok": true,
  "client": { /* single client object — same shape as pages.pages entries */ }
}
```

Client not found:
```json
{ "ok": false, "error": "Client not found" }
```

---

## `snapshot <clientId> [slice]` / `request-snapshot <clientId>`

`snapshot` reads the helper's latest stored snapshot. `request-snapshot` asks the connected page to emit a fresh snapshot; read it afterward with `snapshot` or `page <clientId> full`.

**`snapshot`:**
```json
{
  "ok": true,
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "latestSnapshotAt": "<iso-or-null>",
  "snapshot": { "page": {}, "markers": {} }
}
```

**`request-snapshot`:**
```json
{ "ok": true, "requested": "<clientId>", "resolvedFrom": null }
```

Client not found (both):
```json
{ "ok": false, "error": "Client not found: <clientId>. Run 'pages' to see connected clients." }
```

---

## `wait <clientId> [timeoutSeconds]`

Performs one cancellable long poll for a user-attached P1/P2 annotation. `timeoutSeconds` defaults to `300` and accepts integers from `1` through `1800`. An annotation that arrived before the call remains queued in helper memory and returns immediately. Events are consumed oldest-first per connected page.

This command does not install, inspect, or modify any agent-host lifecycle hook. Repeated waiting is controlled by the current agent turn and only continues while the user-requested loop remains active.

Annotation result:

```json
{
  "ok": true,
  "status": "annotation",
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "timeoutMs": 300000,
  "event": {
    "eventId": "probe-annotation:1",
    "sequence": 1,
    "at": "2026-09-10T07:00:00.000Z",
    "clientId": "<clientId>",
    "reason": "marker-annotation-change",
    "page": { "url": "http://…", "title": "Example app", "storyId": null },
    "integration": { "kind": "extension", "who": "Chippy browser extension" },
    "changedProbeIds": ["1"],
    "annotations": [
      {
        "probeId": "1",
        "intent": "change",
        "comment": "Move this below the summary.",
        "marker": { "position": {}, "docked": false, "intent": "change", "comment": "Move this below the summary.", "resolved": {} }
      }
    ]
  }
}
```

`marker` uses the standard snapshot slice. `changedProbeIds` identifies annotations whose intent or comment differs from the preceding snapshot. When a developer re-attaches unchanged text, the event contains the currently annotated direct probes because the page snapshot does not identify the clicked probe separately.

Bounded timeout is a successful empty result:

```json
{
  "ok": true,
  "status": "timeout",
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "timeoutMs": 300000,
  "event": null
}
```

The in-memory queue retains at most 50 events per page and does not survive a helper restart. Cancelling the HTTP/tool call removes that waiter without consuming the next event.

---

## `activate` / `deactivate` / `ensure-probes` / `clear-probes` / `hide-status`

All return the **command envelope**:

```json
{
  "ok": true,
  "delivered": 1,
  "targetClientId": "<clientId>",
  "command": { "type": "activate" }
}
```

`delivered` — integer count of clients the command was actually sent to. `0` means the clientId was not found (no error raised, just not delivered).

---

## `context-ui <clientId> <on|off>`

Shows or hides context-provider cards (for example Jira ownership) in the active probe UI for the current connected page, including Storybook marker cards. Enrichment is on by default. The command does not activate Chippy, place probes, mutate the inspected application, or persist across a new page realm.

```json
{
  "ok": true,
  "delivered": 1,
  "targetClientId": "<clientId>",
  "command": { "type": "set-context-ui", "enabled": false }
}
```

---

## `show-status <clientId> <text>`

Same envelope with the `text` field echoed inside `command`:

```json
{
  "ok": true,
  "delivered": 1,
  "targetClientId": "<clientId>",
  "command": { "type": "show-status", "text": "Working…" }
}
```

---

## `command <type> [clientId]`

Generic passthrough. Returns the same command envelope as above with whatever `type` was passed.

---

## `get-computed-style <clientId> <probeId> [parentLevel] [selector]`

Parameters:
- `probeId` — `"1"` or `"2"` (string, matches probe id)
- `parentLevel` — `0` = probe's target element, `1` = its direct DOM parent, `N` = Nth ancestor (default `0`)
- `selector` — optional CSS selector applied via `querySelector` within the resolved node

Success — `result` is a flat object of every CSS property resolved by `getComputedStyle`:

```json
{
  "ok": true,
  "targetClientId": "<clientId>",
  "requestId": "<uuid>",
  "result": {
    "display": "flex",
    "flex-direction": "row",
    "align-items": "center",
    "color": "rgb(23, 43, 77)",
    "font-size": "14px",
    "margin-top": "0px"
  }
}
```

Timeout (page did not respond within 5 s):
```json
{
  "ok": false,
  "error": "Timeout waiting for computed style result",
  "targetClientId": "<clientId>",
  "requestId": "<uuid>"
}
```

Client not found:
```json
{ "ok": false, "error": "Client not found" }
```

---

## `probe-parents <clientId> <probeId> [max]` / `inspect-fiber-parents <clientId> <fiberId> [max]`

Reads the React `fiber.return` parent chain. This is distinct from `_debugOwner` and remains useful on production builds where owner data is absent.

```json
{
  "ok": true,
  "probeId": "1",
  "fiberId": null,
  "component": { "index": -1, "relation": "self", "name": "Link", "propNames": [], "hookCount": 13, "dom": { "tag": "a", "testId": null, "text": "" } },
  "parents": [
    { "index": 0, "relation": "return", "name": "div", "tag": 5, "propNames": [], "hookCount": 0, "source": null, "dom": { "tag": "div", "testId": "issue-card", "text": "MAGMA-1" } }
  ],
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "requestId": "<uuid>"
}
```

`max` defaults to 50 and is capped by the page bridge.

## `probe-boundaries <clientId> <probeId> [max]` / `inspect-fiber-boundaries <clientId> <fiberId> [max]`

Reads every declarative Error/Suspense boundary on the rendered `fiber.return` path, ordered from the inspected target outward. Unlike the compact snapshot cards, this does not stop after the nearest boundary of each kind.

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "probeId": "1",
    "count": 2,
    "scannedFibers": 42,
    "truncated": false,
    "items": [
      {
        "fiberId": "fiber:7",
        "kind": "suspense",
        "componentName": "Suspense",
        "detectedBy": "fiber-tag",
        "status": "showing-fallback",
        "source": null,
        "dom": { "tag": "section", "testId": "issue-loading", "text": "Loading…" },
        "distance": 5
      },
      {
        "fiberId": "fiber:8",
        "kind": "error",
        "componentName": "IssueErrorBoundary",
        "detectedBy": "lifecycle",
        "status": "unknown",
        "source": { "fileName": "…/IssueErrorBoundary.tsx", "lineNumber": 18, "columnNumber": 3 },
        "dom": { "tag": "main", "testId": "issue-view", "text": "MAGMA-1" },
        "distance": 11
      }
    ]
  },
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "requestId": "<uuid>"
}
```

`max` defaults to 100 and caps returned boundaries; the ancestry walk itself has a 400-fiber cycle/pathology ceiling. `truncated: true` means either cap prevented a complete inner→outer chain. `status` is `showing-content` or `showing-fallback` for Suspense based on its current fiber state; generic error boundaries report `unknown` because React has no universal error-state field. `dom` is the first host element rendered below the boundary and may be `null`.

`inspect-fiber-boundaries` has the same result shape with `fiberId` instead of `probeId` at the result root.

## `page-boundaries <clientId> [max]`

Reads all current React roots and removes every non-boundary component while preserving Error/Suspense containment. Top-level `items` are the boundary forest roots; each node recursively contains boundary-only `children`.

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "count": 4,
    "scannedFibers": 1832,
    "rootCount": 2,
    "rootsWithBoundaries": 1,
    "truncated": false,
    "items": [
      {
        "fiberId": "fiber:21",
        "kind": "error",
        "componentName": "AppErrorBoundary",
        "detectedBy": "lifecycle",
        "status": "unknown",
        "source": { "fileName": "…/AppErrorBoundary.tsx", "lineNumber": 9, "columnNumber": 1 },
        "dom": { "tag": "div", "testId": "app-shell", "text": "Projects" },
        "fiberDepth": 3,
        "distanceFromParent": null,
        "children": [
          {
            "fiberId": "fiber:22",
            "kind": "suspense",
            "componentName": "Suspense",
            "detectedBy": "fiber-tag",
            "status": "showing-content",
            "source": null,
            "dom": { "tag": "main", "testId": "project-page", "text": "MAGMA" },
            "fiberDepth": 12,
            "distanceFromParent": 9,
            "children": []
          }
        ]
      }
    ]
  },
  "targetClientId": "<clientId>",
  "resolvedFrom": null,
  "requestId": "<uuid>"
}
```

`max` defaults to 1000 and is capped at 5000. `count` counts every returned node, including nested children. `distanceFromParent` is the number of omitted-or-surviving fiber edges between declarative boundaries; it is `null` for a forest root. `truncated: false` is the completion signal for a whole-page read.

## `probe-props <clientId> <probeId> [ownerIndex]`

Fetches prop values for the probe component or one of its owners. Progressive disclosure: snapshot gives names, this gives values + non-POD traces.

Parameters:
- `probeId` — `"1"` or `"2"`
- `ownerIndex` — omit for the probe component itself; `0` = immediate owner, `1` = grandparent, etc.

Use `probe-owners` for React `_debugOwner` value flow. Then feed the numeric `ownerIndex` back into `probe-props` or `probe-prop-value`. `ownerIndex: 3` means three `_debugOwner` hops from the probe component; it is not the `fiber.return` parent chain. Use `probe-parents` for parent-chain walking.

These responses carry hook-count complexity fields next to the prop data:
- `hookCount` — counted hooks on the target component
- `hookCountTruncated` — whether counting hit the safety ceiling
- `hookCountMax` — safety ceiling used while counting

Use that as a warning label before diving into local state. Big numbers do not mean broken. They mean dense.

Notes:
- probe coordinates are exact for the landing DOM node
- owner traversal is deterministic from that exact node
- names in output are descriptive only, not command inputs

Success:
```json
{
  "ok": true,
  "targetClientId": "<clientId>",
  "requestId": "<uuid>",
  "result": {
    "name": "IssueCard",
    "ownerIndex": null,
    "hookCount": 37,
    "hookCountTruncated": false,
    "hookCountMax": 500,
    "pod": {
      "appearance": "compact",
      "isSelected": false,
      "issueKey": "ABC-123"
    },
    "nonPod": [
      {
        "prop": "issue",
        "type": "object",
        "ref": "REF1",
        "terminatesAt": { "ownerIndex": 2, "name": "IssueList" }
      },
      {
        "prop": "onClick",
        "type": "function",
        "ref": "REF2",
        "terminatesAt": { "ownerIndex": 0, "name": "IssueRow" }
      }
    ],
    "children": { "type": "element" }
  }
}
```

`terminatesAt.ownerIndex` is the index in the owner chain (matching `component.owners[N]` in snapshot) where the reference was last seen. `ownerIndex: -1` means it was created inside the probe component itself (not passed down).

Timeout / client not found: same shape as `get-computed-style`.

---

## `probe-hooks-summary <clientId> <probeId>`

Prepared hook summary for the exact probe fiber. Use this before raw `probe-hooks` when the question is "how many hooks / what kinds / what repeated shape?".

```json
{
  "ok": true,
  "result": {
    "name": "StatusServiceWithoutAriId",
    "fiberId": null,
    "hookCount": 102,
    "truncated": false,
    "maxHooks": 500,
    "counts": { "Ref": 14, "Callback": 40, "State": 19 },
    "cleanupEffectCount": 10,
    "cleanupEffects": [5, 11],
    "runs": [{ "start": 0, "end": 0, "tag": "Ref", "count": 1 }],
    "valueHints": [{ "index": 43, "tag": "State", "value": { "isEnabled": true } }]
  }
}
```

## `inspect-fiber-hooks-summary <clientId> <fiberId>`

Same prepared hook summary as `probe-hooks-summary`, but for a registered `fiber:N` from `find-fibers`.

## `explain-component <clientId> <probeId|fiberId|name> [--text|--json|--complexity]`

Compact ASCII component overview. Default command for "inspect/explain component" because it avoids raw JSON and per-hook dumps. The shell default is `--text`: it prints `result.text` directly as semantic lines instead of embedding a huge escaped string inside JSON. Use `--json` for the full uncensored transport payload. Use `--complexity` for only the bounded `complexity:` section. The text starts with that bounded `complexity:` section before the full structure so totals, top hook families, cleanup effect indexes, and `useDebugValue` landmarks survive output truncation. The command may attempt dispatcher-based debug replay to recover hook ancestry. That replay executes component and hook bodies but does not schedule an application update; read `replayStatus` and `warnings` before trusting ancestry.

Raw `--json` response:
```json
{
  "ok": true,
  "result": {
    "ok": true,
    "componentName": "StatusServiceWithoutAriId",
    "fiberId": "fiber:7",
    "resolvedBy": "probe",
    "hookCount": 102,
    "text": "StatusServiceWithoutAriId @ /path/StatusService.tsx:64\nhooks: 102 (Callback=40, Effect=14, Ref=14, State=19)\neffects with cleanup: 10\nstructure:\n  └─ useOpenIssueTransitionModal\n     └─ useResource\n        ├─ hook 0 Ref\n        └─ hook 1 Memo"
  }
}
```

The command always has committed fiber evidence and may augment it with dispatcher replay. Outputs separate `liveHookCount` from `replayedHookCount`. When replay cannot run, `replayStatus` and `warnings` disclose the degradation, `replayedHookCount` is `0`, and custom-hook ancestry may be partial or unavailable. Replay can execute render-time component and hook code; it does not invoke effects or schedule an application update, but unsafe render-time side effects can still run. Context values are internal replay scaffolding only: they keep provider guards from aborting structural discovery and are not included in the result.

## `probe-hooks <clientId> <probeId>`

Walks the fiber's `memoizedState` linked list and classifies each hook.

Success:
```json
{
  "ok": true,
  "targetClientId": "<clientId>",
  "requestId": "<uuid>",
  "result": {
    "name": "IssueCard",
    "hookCount": 4,
    "truncated": false,
    "maxHooks": 500,
    "hooks": [
      { "index": 0, "tag": "State", "value": false },
      { "index": 1, "tag": "Ref", "current": null },
      { "index": 2, "tag": "Effect", "deps": "[array:2]", "hasCleanup": false },
      { "index": 3, "tag": "Memo", "value": "[object]", "deps": "[array:1]" }
    ]
  }
}
```

Hook tags: `State`, `Reducer`, `Ref`, `Effect`, `Memo`, `Callback`, `Context?`, `Deferred`, `Unknown`.

To locate a specific hook, start with an existing `useDebugValue`, `State`, or `Ref` landmark and its neighboring indexes. If the call site remains ambiguous, report the gap. Adding a diagnostic label is a source edit and requires user intent plus the normal P-15/P-16 gate.

Behavior notes:
- walks the full visible hook chain up to a high safety cap
- `maxHooks` is the safety cap used for this response
- `truncated: true` means the walk stopped at the cap; no silent cutoff
- a malformed cyclic hook list yields a final synthetic entry with `tag: "Unknown"` and a `note`
- hook indexes are exact within the returned snapshot

Values are safely serialized: POD inlined, objects → `[object]`, functions → `[function:name]`, arrays → `[array:N]`, circular → `[circular]`, strings truncated at 120 chars.

Timeout / client not found: same shape as `get-computed-style`.

---

## `find-fibers <clientId> [--name regex] [--file regex] [--prop name] [--testid regex] [--text regex] [--max N]`

Searches the live fiber tree without probe placement. Returns remembered `fiberId` tokens for the current page realm.

```json
{
  "ok": true,
  "result": {
    "count": 3,
    "items": [
      {
        "fiberId": "fiber:1",
        "name": "StatusServiceWithoutAriId",
        "source": { "fileName": "…/StatusService.tsx", "lineNumber": 64 },
        "owner": "StatusServiceForMigrateIssueTransitionEnabled",
        "domTag": null,
        "domTestId": null
      }
    ]
  }
}
```

`fiberId` uses the canonical string form `fiber:<N>`. A bare numeric input is accepted as shorthand and normalized to that string. The registry survives commits within the current page realm, but React may replace the current fiber alternate after any commit; re-run `find-fibers` after state changes, interactions, HMR, navigation, or reload. Navigation/reload replaces the page realm and invalidates the registry entirely.

## `fiber-state-capture <clientId> [label] [maxFibers]`

Captures the current named React fiber tree and fingerprints every prop without returning complete prop values. `maxFibers` defaults to 100000. The helper retains at most 20 captures in memory and evicts the oldest first.

```json
{
  "ok": true,
  "capture": {
    "captureId": "state:a1b2c3d4",
    "label": "gate off",
    "clientId": "<clientId>",
    "page": { "url": "https://example.test/off", "title": "Example" },
    "capturedAt": "2026-08-31T10:00:00.000Z",
    "fiberCount": 4821,
    "truncated": false
  }
}
```

Prop fingerprints contain a structural kind, deterministic hash, short preview, and truncation flag. Objects use sorted keys, arrays preserve order, React elements include element type/key/props, and cycles are stable within one prop. Functions compare by name and arity so ordinary closure recreation is not reported as a change. Capture is read-only and does not invoke components, hooks, effects, or callbacks.

## `fiber-state-list`

Lists capture summaries only; retained fiber/prop payloads are not returned.

```json
{
  "ok": true,
  "count": 2,
  "captures": [{
    "captureId": "state:a1b2c3d4",
    "label": "gate off",
    "clientId": "<clientId>",
    "page": { "url": "https://example.test/off", "title": "Example" },
    "capturedAt": "2026-08-31T10:00:00.000Z",
    "fiberCount": 4821,
    "truncated": false
  }]
}
```

Captures survive page navigation or disconnect but not helper restart.

## `fiber-state-compare <beforeCaptureId> <afterCaptureId> [maxChanges]`

Compares captures from the same or different pages. `maxChanges` defaults to 200 diff records. A connected page is required to execute the bundled comparison, but it need not be either captured page. Fiber matching first uses the exact structural path, then a globally unique token made from fiber tag, component/host name, key, and source location. Repeated unkeyed fibers that move structurally remain added/removed rather than being guessed into a match.

```json
{
  "ok": true,
  "before": { "captureId": "state:a1b2c3d4", "label": "gate off", "clientId": "client-a", "page": { "url": "https://example.test/off", "title": "Example" }, "capturedAt": "...", "fiberCount": 4821, "truncated": false },
  "after": { "captureId": "state:e5f6a7b8", "label": "gate on", "clientId": "client-b", "page": { "url": "https://example.test/on", "title": "Example" }, "capturedAt": "...", "fiberCount": 4830, "truncated": false },
  "diff": {
    "ok": true,
    "before": { "url": "https://example.test/off", "title": "Example", "capturedAt": "..." },
    "after": { "url": "https://example.test/on", "title": "Example", "capturedAt": "..." },
    "summary": {
      "beforeFibers": 4821,
      "afterFibers": 4830,
      "matchedFibers": 4819,
      "changedFibers": 3,
      "addedFibers": 11,
      "removedFibers": 2,
      "propChanges": 5,
      "returnedChanges": 16,
      "captureTruncated": false,
      "changesTruncated": false,
      "truncated": false
    },
    "changes": [
      {
        "kind": "props-changed",
        "match": "path",
        "fiber": { "before": { "name": "FeaturePanel" }, "after": { "name": "FeaturePanel" } },
        "props": {
          "added": [],
          "removed": [],
          "changed": [{ "name": "isEnabled", "before": { "kind": "boolean", "hash": "...", "preview": "false", "truncated": false }, "after": { "kind": "boolean", "hash": "...", "preview": "true", "truncated": false } }]
        }
      },
      { "kind": "fiber-added", "fiber": { "name": "GateContent", "key": null, "source": null }, "propNames": ["children"] }
    ]
  }
}
```

`captureTruncated` means at least one source capture hit `maxFibers`; `changesTruncated` means the result hit `maxChanges`; `truncated` is their combined warning. `propChanges` counts individual added, removed, and changed props even though one `props-changed` record can contain several. Use the component source and prop preview as an index for targeted `find-fibers`, `inspect-fiber-props`, or probe work; hashes prove inequality, not causality.

## `inspect-fiber-hooks <clientId> <fiberId>`

Deep hook list for a fiber found via `find-fibers`. Returns same shape as `probe-hooks`.

## `inspect-fiber-props <clientId> <fiberId>`

Props inspection for a fiber found via `find-fibers`. Returns same shape as `probe-props` (no ownerIndex needed).

## `inspect-fiber-owners <clientId> <fiberId>`

Owner chain for a fiber found via `find-fibers`.

## `inspect-fiber-structure <clientId> <fiberId> <hookIndex> [windowSize]`

Reconstructs custom-hook folder structure for one hook in an arbitrary fiber. Does not require Avalanche or a probe. It may use dispatcher replay, which executes component and hook bodies without scheduling an application update; read `replayStatus` and `warnings`, and treat render-time side effects as the execution boundary.

Returns a nested folder `text`, a `target` block with `parents`/`parentsWithLoc`, and `warnings` when ancestry is unavailable.

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "status": "ok",
    "componentName": "StatusServiceWithoutAriId",
    "fiberId": "fiber:1",
    "requestedHookIndex": 1,
    "hookCount": 11,
    "text": "StatusServiceWithoutAriId\n└─ useCloudId\n   └─ useTenantContext\n      └─ useSweetState\n         └─ hook 1 Memo ← target",
    "target": {
      "hookId": 1,
      "type": "Memo",
      "value": "[function:DEFAULT_SELECTOR]",
      "parents": ["StatusServiceWithoutAriId", "useCloudId", "useTenantContext", "useSweetState"],
      "parentsWithLoc": [{ "name": "useCloudId", "loc": "17226:33" }, "…"]
    },
    "captureEngineOk": true,
    "warnings": []
  }
}
```

`warnings` is non-empty when the dispatcher ref is unavailable (hook shim not loaded before react-dom) or when replay failed mid-component. In that case `parents` may be partial or empty.

## `describe-component <clientId> <fiberIdOrName> [--text|--json]`

Whole-component structural map. Shell default is `--text`: print the full rendered tree as plain text, not as an escaped JSON string. Use `--json` for the full uncensored transport payload. The map contains the **full** custom-hook tree across all hooks in the component — not anchored to one `hookIndex` like `inspect-fiber-structure`. The result contains structure only: primitive kinds + folder ancestry, with no values, props, owners, or replay inputs. Building that structure may use dispatcher replay, which executes component and hook bodies without scheduling an application update. Check `replayStatus` and `warnings`; if replay is unavailable or fails, the result degrades to committed fiber evidence and ancestry may be partial.

Resolution:
- If the second arg starts with `fiber:` — resolved against the fiber registry (returned by `find-fibers`).
- Otherwise — treated as a component name. By Rules of Hooks, all instances of one component share the same hook shape, so the first matching fiber is used.

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "componentName": "ChurnLab",
    "fiberId": "fiber:42",
    "resolvedBy": "name",
    "source": { "fileName": "/abs/path/ChurnLab.jsx", "lineNumber": 12 },
    "hookCount": 7,
    "tree": [
      {
        "path": [],
        "hooks": [
          { "hookId": 0, "primitive": "State" },
          { "hookId": 1, "primitive": "Memo" }
        ]
      },
      {
        "path": [{ "name": "useStore", "loc": "ChurnLab.jsx:18:5" }],
        "hooks": [
          { "hookId": 2, "primitive": "SyncExternalStore" },
          { "hookId": 3, "primitive": "Memo" }
        ]
      },
      {
        "path": [
          { "name": "useStore", "loc": "ChurnLab.jsx:18:5" },
          { "name": "useShallow", "loc": "ChurnLab.jsx:24:3" }
        ],
        "hooks": [
          { "hookId": 4, "primitive": "Memo" }
        ]
      }
    ],
    "text": "ChurnLab @ /abs/path/ChurnLab.jsx:12\n├─ hook 0 State\n└─ hook 1 Memo\n└─ useStore @ ChurnLab.jsx:18:5\n   ├─ hook 2 SyncExternalStore\n   └─ hook 3 Memo\n      └─ useShallow @ ChurnLab.jsx:24:3\n         └─ hook 4 Memo",
    "captureEngineOk": true,
    "warnings": []
  }
}
```

Field semantics:
- `tree[]` — folders in first-seen order. Each folder has `path` (custom-hook ancestry, outer→inner) and `hooks[]` with `{ hookId, primitive, debugLabel? }`. `hookId` is `null` for `Context`, `DebugValue`, `MemoCache` (no `memoizedState` slot). For `DebugValue`, `debugLabel` carries the serialized `useDebugValue` value and should be treated as a named landmark, for example a Sweet State store label.
- `hookCount` — number of indexable primitive hooks (excludes `Context`, `DebugValue`, `MemoCache`).
- `resolvedBy` — `"fiberId"` when the registry hit, `"name"` when name-walk hit.
- `text` — pre-rendered tree for log readability. It prints `debugLabel` inline after the primitive, for example `hook · DebugValue — RSS: JWMFormStore__1xxy1q6`.
- `warnings` — same gates as `inspect-fiber-structure`: empty `parents` is normal when the hook is called directly in the component; `flat-records` warning only appears when no folder ancestry was recovered at all.

Use `describe-component` when the question is "what is this component made of"; use `inspect-fiber-structure` when the question is "what's around hook N in this component"; drill values for one hook with `avalanche-debug-hook`.

## `page-click <clientId> <selector|probeId|fiberId>`

Success:
```json
{
  "ok": true,
  "mode": "selector",
  "target": { "tag": "button", "testId": "save-button", "text": "Save" },
  "selector": ".save-button",
  "probeId": null,
  "fiberId": null,
  "targetClientId": "abc123",
  "resolvedFrom": null,
  "requestId": "..."
}
```

Refusal on ambiguous selector:
```json
{
  "ok": false,
  "error": "selector matched 3 elements; refine the selector to one target",
  "matched": 3,
  "targetClientId": "abc123",
  "resolvedFrom": null,
  "requestId": "..."
}
```

## `fiber-prop-contract <clientId> <fiberId> <propName>`

Success for function prop:
```json
{
  "ok": true,
  "fiberId": "fiber:42",
  "fiberName": "SaveButton",
  "source": { "fileName": "/path/Button.tsx", "lineNumber": 12, "columnNumber": 2 },
  "propName": "onClick",
  "propNames": ["children", "onClick"],
  "propType": "function",
  "isFunction": true,
  "fnLength": 1,
  "fnName": "handleClick",
  "fnSourcePreview": "function handleClick(event) { … }",
  "nextStep": "Read the component/owner source to determine the callback argument contract before fiber-invoke.",
  "targetClientId": "abc123",
  "resolvedFrom": null,
  "requestId": "..."
}
```

## `fiber-invoke <clientId> <fiberId> <propName> [--args JSON]`

Success:
```json
{
  "ok": true,
  "fiberId": "fiber:42",
  "fiberName": "SaveButton",
  "propName": "onClick",
  "propType": "function",
  "fnLength": 1,
  "invoked": true,
  "args": ["draft"],
  "async": false,
  "returnValue": null,
  "targetClientId": "abc123",
  "resolvedFrom": null,
  "requestId": "..."
}
```

For a thenable result, Chippy waits up to two seconds by default and returns `"async": true` with the serialized resolved value. A rejected or timed-out thenable returns `ok: false`, `async: true`, `rejected: true`, `threw: false`, plus `error` and `stack`.

A synchronously thrown callback returns:

```json
{
  "ok": false,
  "threw": true,
  "error": "callback failed",
  "stack": "Error: callback failed ...",
  "fiberId": "fiber:42",
  "fiberName": "SaveButton",
  "propName": "onClick",
  "propType": "function",
  "args": ["draft"]
}
```

For a class component, invocation binds `this` to `fiber.stateNode`. Function components receive no synthetic `this` binding.

Refusal on non-function prop:
```json
{
  "ok": false,
  "error": "prop label is not a function",
  "fiberId": "fiber:42",
  "fiberName": "SaveButton",
  "propName": "label",
  "propType": "string",
  "targetClientId": "abc123",
  "resolvedFrom": null,
  "requestId": "..."
}
```

## `fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]`

Success:

```json
{
  "ok": true,
  "fiberId": "fiber:42",
  "fiberName": "SavePanel",
  "source": { "fileName": "/path/SavePanel.tsx", "lineNumber": 18, "columnNumber": 2 },
  "ownerIndex": 0,
  "scheduled": true
}
```

Failures return `ok: false`, `error`, and one stable `reason`: `no-fiberId`, `fiber-not-found`, `owner-out-of-range`, `no-scheduleUpdate`, or `scheduleUpdate-threw`. `no-scheduleUpdate` means a production React build or a DevTools-hook shim that arrived after React DOM evaluated.

The command schedules one render through the React DevTools renderer. It mutates no hook or prop; the extra commit and any effects it runs are the active stimulus.

## `proxy-state`

No proxy active:
```json
{ "ok": true, "proxy": null }
```

Proxy active:
```json
{
  "ok": true,
  "proxy": {
    "active": true,
    "targetPort": 3000,
    "originalUrl": "http://localhost:3000/issues/ABC-123",
    "injectTarget": { "pathname": "/issues/ABC-123", "search": "" },
    "startedAt": "2026-04-16T08:00:00.000Z"
  }
}
```

`injectTarget` — the path+search the proxy will inject the Chippy bundle into. Derived from `originalUrl`. `null` if no `originalUrl` was given.

---

## `proxy-start <targetPort> [originalUrl]`

Success:
```json
{
  "ok": true,
  "proxy": {
    "active": true,
    "targetPort": 3000,
    "originalUrl": "http://localhost:3000/issues/ABC-123",
    "injectTarget": { "pathname": "/issues/ABC-123", "search": "" },
    "startedAt": "2026-04-16T08:00:00.000Z"
  }
}
```

Bad port:
```json
{ "ok": false, "error": "Invalid target port: abc" }
```

---

## `proxy-stop`

```json
{ "ok": true, "proxy": { "active": false } }
```
