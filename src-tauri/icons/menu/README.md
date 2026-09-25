# Sort menu icons

The A–Z and Z–A SVGs come from lucide-react 0.468.0, `ArrowDownAZ` and
`ArrowDownZA`. The Bullet Method SVG uses Lucide's `CircleDot` and matches
src/components/BulletMethodIcon.tsx. Their full license is in LICENSE-lucide.
Keep the two Bullet Method representations synchronized when changing the mark.

The native menu uses 36 × 36 straight RGBA pixels rendered from these SVGs.
macOS displays them at 18 logical pixels and treats them as template images,
so AppKit handles dark mode, disabled states, and selection highlighting.

To regenerate, install @resvg/resvg-js in a temporary directory, then run:

```sh
node scripts/render-menu-icons.mjs /absolute/path/to/node_modules/@resvg/resvg-js
```

The renderer is development tooling only and is not bundled in the app.
