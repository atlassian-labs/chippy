# Local environment

Repository paths in this reference are relative to the repository root.

## Local URLs

- Local Storybook manager: `http://127.0.0.1:6007/`
- Local direct story: `http://127.0.0.1:6007/iframe.html?id=labs-layoutplayground--default&viewMode=story`
- Chippy helper: `http://127.0.0.1:7823/`

## Linked-project handling

- Optional `links/*` symlinks provide source access to external applications and are covered by `.gitignore`.
- Do not include linked projects in repository-wide scans. Inspect an external target only when the task requires its source and runtime evidence identifies the relevant location.
- Creating or updating `links/` entries is a workspace concern, not part of the portable Chippy skill.
