# Atlassian skills registry release

Repository paths in this reference are relative to the repository root.

## Publishing Chippy to the Atlassian skills registry

Source of truth lives in this workspace at `.agents/skills/chippy/`. The published copy lives in the Atlassian skills registry (separate repo) at `skills/skills/front-end/chippy/skill/`. Sync is manual.

### Published structure

```
skills/skills/front-end/chippy/
└── skill/
    ├── README.md         ← maintainer and adopter orientation
    ├── SKILL.md          ← frontmatter + full skill body
    ├── browser-scripts/
    ├── extension/
    ├── references/
    ├── scripts/
    └── snippets/
```

Category `front-end` already has a team and CODEOWNERS entry — no changes needed there.

### Sync steps

1. **Copy SKILL.md body** — source is `.agents/skills/chippy/SKILL.md`. The published copy has **extra frontmatter** that must be preserved / updated:

   ```yaml
   ---
   name: chippy
   description: |
     Load when the user wants to use Chippy, mentions Chippy, probes, or a connected page;
     or when the user points at something rendered in their browser and wants to find,
     explain, or change the source behind it — locating a visible value in the codebase,
     tracing why a component renders, inspecting props/hooks/owners on a live page, or
     editing source from what is shown on screen. The agent may also propose Chippy when
     a request would otherwise require guessing which file or component drives a visible
     element on a running React page.
   labels:
     - front-end
   metadata:
     maintainer: akorzunov
     version: X.Y.Z      # bump semver on every change
   ---
   ```

   Then append the body (everything after the source SKILL.md frontmatter). Detect both closing frontmatter fences instead of relying on line counts:

   ```bash
   SRC=.agents/skills/chippy
   DST=<path-to>/skills/skills/front-end/chippy/skill
   {
     awk '$0 == "---" { fences++ } { print } fences == 2 { exit }' "$DST/SKILL.md"
     awk '$0 == "---" { fences++; if (fences == 2) { body = 1 }; next } body' "$SRC/SKILL.md"
   } > /tmp/chippy-skill.md && mv /tmp/chippy-skill.md "$DST/SKILL.md"
   ```

2. **Bump `metadata.version`** in the published SKILL.md frontmatter (semver patch at minimum). The registry rejects PRs where files changed but version was not bumped.

3. **Sync supporting files** — copy changed files from source to skill:

   ```bash
   SRC=.agents/skills/chippy
   DST=<path-to>/skills/skills/front-end/chippy/skill

   cp $SRC/README.md         $DST/README.md
   cp $SRC/references/*      $DST/references/
   cp $SRC/snippets/*        $DST/snippets/
   cp $SRC/scripts/*         $DST/scripts/
   cp $SRC/browser-scripts/* $DST/browser-scripts/
   cp $SRC/extension/*       $DST/extension/
   # Note: .gaps and .provenance are internal metadata — do NOT copy to the skills registry
   ```

4. **Validate locally** (from the `skills/` directory of the registry repo):

   ```bash
   cd <path-to>/skills
   make install-deps   # once
   make validate
   ```

5. **Raise a PR** against the skills registry with the updated files.

### Registry rules (from `skills/CONTRIBUTING.md`)

- `name` must match directory name (`chippy`)
- `labels` must be from `labels.yaml` — `front-end` is valid
- `metadata.maintainer` is a staff ID
- `metadata.version` must be bumped on every change (single semver increment)
- New labels require editing `labels.yaml` + PR
