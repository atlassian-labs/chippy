# Hooks inspection

**To inspect hooks** — `probe-hooks <clientId> <probeId>`:
- Returns an array of hook nodes walked from `fiber.memoizedState`.
- Tags: `State`, `Reducer`, `Ref`, `Effect`, `Memo`, `Callback`, `Context?`, `Deferred`, `Unknown`.
- `State` → `value` is the current state value. `Reducer` → `value` is the last rendered state.
- `Ref` → `current` is the ref value.
- `Effect` → `deps` count + `hasCleanup`.
- `Memo` / `Callback` → `value` + `deps` count.
- Walks the full hook list up to a high safety cap (`maxHooks: 500`). If the response stops at that cap, `truncated: true` tells you.
- POD values inlined; objects/arrays/functions safe-serialized.
- If the hook list is malformed or cyclic, Chippy stops deterministically and marks the break in the output.
- Hook index is exact within the returned list.
- No hidden mini-cap for Jira-scale components.
- Hook output is still for inspection, not for counting business data.
- Re-run after code changes if you need fresh positions.
- Use `hookCount`, `truncated`, and `maxHooks` together when judging completeness.
- If `truncated` is false, the full visible hook chain was walked.
- If `truncated` is true on a real component, the component is unusually deep and worth noting explicitly.
- The cap is safety, not guidance.
- Deep Jira fibers are expected to work.
- Large outputs may still be verbose; inspect around known anchors.
- Prefer a nearby `State`/`Ref`/`useDebugValue` landmark when scanning hundreds of hooks.
- Counts can shift between renders.
- The list reflects one render snapshot only.
- This is deterministic from the exact probed fiber.
- If the page rerenders, probe again.
- The returned `hookCount` is the number of entries emitted in this result.
- For capped responses, `hookCount` equals `maxHooks`.
- For cycle breaks, one final synthetic `Unknown` entry may be appended with a note.
- This keeps failures inspectable instead of silent.
- The cap exists only to guard against broken or pathological hook lists.
- Jira with 300 hooks is fine.
- Very large components are noisy, but now observable.
- Use the index numbers as exact anchors.
- Do not infer missing hooks unless `truncated` says they are missing.
- When in doubt, call `probe-hooks` again after the next render settles.

Note: if you hit `truncated: true` at 500 in practice, that is a signal to improve the command surface further, not to guess past the boundary.

**Result shape adds**:
- `hookCount` — number of returned hook entries
- `truncated` — whether Chippy stopped at the safety cap
- `maxHooks` — current safety cap used for this walk
- `hooks[N].note` — optional note on synthetic break entries such as cycle detection

**Reading very deep results**:
- Default reading is **collapsed by repetition**: group consecutive hooks belonging to the same custom-hook family (e.g. `useSweetState [12..16]`) instead of listing each leaf. Expand a family fully when it is the only instance, or when the user explicitly asks for the raw list (`dump`, `expanded`, `every hook`).
- For "where exactly is complexity" asks, produce a concentration view first: hook ranges, top-level custom-hook/subtree label, primitive counts, cleanup counts, and landmarks such as `State`, `Ref`, or `useDebugValue`.
- find a stable hook anchor first (`State` value, `Ref.current`, `useDebugValue`)
- then use surrounding indexes to orient
- do not treat raw length alone as meaningful
- the useful signal is where a known value sits in the deterministic sequence

**Safety rule**:
- the hook walker should prefer explicit truncation over hanging, looping, or pretending the list ended naturally
- deterministic failure beats silent loss

**To locate a specific hook**, first use an existing `useDebugValue`, `State`, or `Ref` landmark and its neighboring indexes. If multiple source call sites still fit, report the ambiguity. Adding a new `useDebugValue` is a source edit and requires user intent plus the normal P-15/P-16 gate before changing the code.

**Hook index is stable within a render** but shifts if hooks are added/removed. Always re-run `probe-hooks` after code changes.
