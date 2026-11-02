# Chippy identity

Chippy's mark is one folded blue frame with an open inspection window. The
cut reveals a layer underneath, reflecting how Chippy exposes the structure
behind visible UI. Use the mark with the name “Chippy”
where there is room; the standalone mark identifies compact launchers and browser
icons.

The canonical vector is [logo.svg](../../.agents/skills/chippy/extension/logo.svg).
Its blue (#1868DB), light blue (#85B8FF), neutral surfaces, spacing, and typography
follow the [Atlassian design foundations](https://atlassian.design/foundations).
This is Chippy's own mark, rather than an Atlassian corporate or product logo.

## Assets and UI

- Popup: vector mark and project name on a light surface.
- Page panel: inline vector mark, neutral dark surface, readable muted text, and
  semantic probe/connection colors.
- Storybook headers: the same mark and host-aware surface/text tokens.
- Extension and toolbar: generated PNGs at 16, 32, 48, and 128 pixels.

Use `'Atlassian Sans'` when the host already provides it, followed by system UI
fonts. The extension does not download or bundle proprietary brand fonts.
The upper face briefly reveals itself when the mark appears, then stays still.
Reduced-motion preferences disable the animation; toolbar PNGs are static.
Keep the mark's geometry and proportions; supply accessible names on the control
that contains it, rather than repeating them on decorative icons.

## Regenerate

Edit the canonical SVG, then run:

```sh
node scripts/sync-chippy-brand.mjs
```

The script synchronizes inline page/Storybook copies and renders toolbar PNGs
with Playwright Chromium. Run `yarn test src/chippy-brand.test.ts` to verify copies
and declared icon dimensions. Generated extension assets enter the normal
[extension release](../releasing.md) process.
