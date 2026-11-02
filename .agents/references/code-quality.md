# Code quality checks

Repository paths in this reference are relative to the repository root.

## Code quality rules

Apply when writing, changing, or reviewing code. A change is not done unless all of these hold:

1. **Test coverage** — every new public surface (command, option, DTO field, shell command, API path) has a corresponding test. A feature is not done if it has no test.
2. **Shell wrapper parity** — every command added to `avalanche-commands.ts` must also be added to `chippy.sh`. Document it in the usage block. Verify with `chippy.sh help | grep <command-name>`.
3. **DTO field parity** — every field on a live type must be serialized into the DTO and verified in a test. Fields silently dropped at the mapping layer (e.g. `id` not passed through `linkRecent`) will break lookup commands.
4. **Strict required types** — DTO and live types must use required fields (`field: T`), never optional (`field?: T`), for any field that a command depends on for lookup or rendering. Optional fields silently accepted by TypeScript will fail at runtime without a compile error. If a field is required by any consumer, it is required in the type.
5. **Docs parity** — every new command, option, include key, output shape, or behavioral change must be documented in `SKILL.md` and the relevant reference. Do not close a task without checking docs.
6. **Host compatibility** — any change to `early-bootstrap.js` or the `__ATL_REACT_METRICS` accessor must be verified against a live Jira or localhost page with ATL, not just unit tests. The WebStore extension runs on real host pages; jsdom tests cannot cover host compatibility.
7. **Wire-level test required** — a shell command is not done until a test invokes the full chain: shell wrapper → HTTP body → command builder → bridge command. Unit tests that call bridge commands with hand-built input objects do not prove that data survives the wire. Silent translators (shell arg parsing, HTTP serialization, `buildAvalancheCommand`) can drop fields without any test failing. Every shell command must have one wire-level test that asserts the bridge receives the expected command object including all new fields.
