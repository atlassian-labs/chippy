# Page scripts

A page script is a short, throwaway program you write for one question that no
command answers, and run in the page with `eval-page`. It receives the `chippy`
toolkit: the same fiber selection, relations, geometry, hook reads, and overlay
that the commands use, composed however the question needs.

Use a command when one answers the question. Write a script when the answer
needs a combination the commands do not offer, for example "what area goes
blank if this component suspends instead of rendering its loading state".

## Run a script

Pass `-` instead of a snippet name and send the script on stdin:

```bash
./scripts/chippy.sh eval-page <clientId> - --component Feed <<'JS'
const target = chippy.first({ name: ctx.args.component });
if (!target) return { found: false };
const boundary = chippy.nearest(target, 'suspense');
return {
  target,
  before: chippy.area(target).area,
  after: chippy.area(boundary).area,
  ladder: chippy.parents(target, { until: boundary, inclusive: true }).map((ref) => ref.name),
};
JS
```

The body runs as an `async` function, so it can `await` and `return`. Every
`--key value` pair lands in `ctx.args`. Two options belong to the runner and
never reach `ctx.args`:

| Option | Effect |
|---|---|
| `--allow replay` | Opens the replay gate for this run. Repeat the flag or join gates with commas. |
| `--script-timeout <ms>` | Waits up to this long for the script (default 5,000, maximum 120,000). |

A packaged snippet name or a file path works as before; a script file can use
the same `chippy` toolkit.

## Rules

- Return `FiberRef`s, not raw fibers. A returned ref serializes as `{ fiberId, name, kind, source }`, plus `label` when a plugin or pack names it, and `fiberId` works with every `fiber-*` and `inspect-fiber-*` command.
- Prefer `ref.label` to a name you derive yourself. A boundary's fiber name is often generic (`Suspense`) or minified; `label` is the application's own name for it. When `label` is null and you derive a name from the page's conventions, say so in your report: the rule belongs in that application's pack `labels`, not in the script.
- Read `limits` before you trust `result`. An empty array means every primitive finished its work with full confidence. Each entry names the primitive, a kind (`truncated`, `confidence`, `raw`, or `gap`), and a detail.
- Do not read `ref.raw` unless the toolkit has no primitive for the question. Reading it adds a `raw` limit; say in your report that the answer reads React internals directly.
- Run the [debug replay preflight](active-stimulus.md#debug-replay-preflight) before `--allow replay`. Replay executes component and hook bodies. Without the gate, a replay call fails the run with `gate: "replay"`.
- Read `sideEffects`. A read-only script reports `domMutations: 0`, `rootsCommitted: 0`, and no `globalsAdded`. Anything else means the script, or something it called, changed the page during the run.
- Clear what you paint. Boxes stay on the page until `chippy.overlay.clear()`; they live in a Chippy-owned layer and do not count as DOM mutations.
- For long walks, call `chippy.checkpoint(value)` as you go. A timeout only stops the wait, not the script; the envelope then carries the last checkpoint as `partial`.
- Keep the script in the conversation. Promote it to a snippet or a command only when the same question returns.

## The `chippy` toolkit

`chippy.help()` lists the topics; `chippy.help('select')` shows one.

```ts
type Matcher = string | RegExp;
type Kind = 'component' | 'error' | 'suspense' | 'host' | 'text' | 'portal' | 'other';
type Rect = { left: number; top: number; right: number; bottom: number };

interface FiberRef {
  id: string;                 // "fiber:N", stable for the page session
  name: string | null;
  kind: Kind;                 // 'error' for a class with getDerivedStateFromError or componentDidCatch, whatever its name;
                              // find({ kind: 'component' }) still matches it
  label: string | null;       // the app's own name for this fiber, from an enabled plugin or pack; null when none names it
  tag: number;
  key: string | null;
  source: { fileName: string | null; lineNumber: number | null; columnNumber: number | null } | null;
  status: 'showing-content' | 'showing-fallback' | 'unknown' | null; // Suspense state; 'unknown' for error boundaries
  hidden: boolean;            // inside a hidden Offscreen, e.g. content behind a shown fallback
  raw: object;                // the live fiber; reading it is recorded as a limit
  resolveSource(): Promise<FiberRef['source']>;
}
// Within a run, the same fiber always gives the same ref, so === works. A ref kept
// in chippy.session still works in a later run; compare refs from different runs by id.

interface FindQuery {
  name?: Matcher;             // a string matches exactly
  file?: Matcher;             // a string matches a substring
  testId?: Matcher;           // data-testid of the first DOM element
  text?: Matcher;             // text of the first DOM element
  kind?: Kind | 'boundary' | 'any' | Array<Kind | 'boundary' | 'any'>; // default 'component'
  within?: FiberRef;          // descendants only
  visibleOnly?: boolean;      // skip hidden subtrees
  where?: (ref: FiberRef) => boolean;
  max?: number;               // default 5000; exceeding it is recorded as truncated
}

interface Area {
  area: number;               // square CSS pixels, overlaps counted once
  visibleArea: number;        // the part inside the viewport, never more than area
  box: Rect | null;           // viewport coordinates
  nodes: number;              // outermost DOM nodes measured
  cellSize: number;           // areas are exact to about one cell
}

interface HooksResult {
  component: FiberRef;
  status: 'fiber-only' | string; // replay status when replayed; anything but 'complete' adds a limit
  hooks: Array<{ index: number | null; primitive: string; path: string[]; value: unknown }>;
  customHooks: string[];      // empty without replay
  truncated: boolean;
  error: string | null;
}

interface OverlayLayer {
  items: Array<FiberRef | null>;
  color?: string | ((ref: FiberRef, i: number) => string);        // default: one hue per kind
  label?: string | ((ref: FiberRef, i: number) => string | null); // default: ref.label, then the fiber name
  dashed?: boolean | ((ref: FiberRef, i: number) => boolean);     // default: Suspense showing fallback
}

declare const chippy: {
  version: number;
  allowed: string[];          // gates open for this run

  // select
  roots(): FiberRef[];
  find(query?: FindQuery): FiberRef[];
  first(query?: FindQuery): FiberRef | null;
  fromElement(target: Element | string): FiberRef | null; // an element or a CSS selector
  byId(id: string | number): FiberRef | null;             // "fiber:N" from any command

  // relate (the fiber itself is always excluded)
  parents(ref: FiberRef, options?: { until?: FiberRef | ((ref: FiberRef) => boolean); inclusive?: boolean; components?: boolean; max?: number }): FiberRef[];
  // nearest first; max: 1 is the closest parent. Only the built-in ceiling, not your max, is recorded as truncated.
  boundaries(ref: FiberRef, options?: { kinds?: Array<'suspense' | 'error'> }): FiberRef[]; // nearest first
  nearest(ref: FiberRef, kind: 'suspense' | 'error'): FiberRef | null;
  components(ref: FiberRef, query?: Omit<FindQuery, 'within'>): FiberRef[];
  distance(from: FiberRef, ancestor: FiberRef): number | null;
  isAncestor(ancestor: FiberRef, of: FiberRef): boolean;
  owners(ref: FiberRef): FiberRef[]; // _debugOwner; component parents on production builds (recorded)

  // measure
  hostNodes(ref: FiberRef): Node[];  // outermost DOM nodes, document order, portals included
  rects(ref: FiberRef): Rect[];
  bounds(target: FiberRef | FiberRef[]): Rect | null;
  area(target: FiberRef | FiberRef[]): Area;

  // hooks and props
  hooks: ((ref: FiberRef, options?: { replay?: boolean }) => HooksResult) & {
    callers(hook: Matcher, query?: FindQuery & { maxReplays?: number }): FiberRef[]; // needs --allow replay
  };
  props(ref: FiberRef): Record<string, unknown>; // live props; do not mutate

  // overlay
  overlay: {
    paint(layers: OverlayLayer | OverlayLayer[], options?: { id?: string }): { ok: true; id: string; boxes: number; skipped: number };
    clear(id?: string): { ok: true; cleared: number }; // no id clears every set
    list(): Array<{ id: string; boxes: number }>;
  };

  // run
  session: Record<string, unknown>; // persists between runs on this page
  isRef(value: unknown): boolean;
  checkpoint<T>(value: T): T;
  log(...values: unknown[]): void;
  help(topic?: string): unknown;
};
```

`ctx.helpers` still offers the raw-fiber helpers that packaged snippets use; see
the [snippet contract](../snippets/README.md#authoring-contract). Prefer
`chippy` in new scripts, because its answers report their own limits.

## Result envelope

```json
{
  "ok": true,
  "durationMs": 12,
  "result": { "target": { "fiberId": "fiber:41", "name": "Feed", "kind": "component", "source": null } },
  "log": [],
  "limits": [],
  "sideEffects": { "domMutations": 0, "rootsCommitted": 0, "globalsAdded": [] },
  "allowed": []
}
```

A failed run has `ok: false` and `error`, plus `gate` when a gate was missing,
`timedOut: true` after a timeout, and `partial` when the script called
`checkpoint`. `unknownGates` lists `--allow` values the runner does not know.
`chippy.sh` prints a failed envelope whole and exits 1.
