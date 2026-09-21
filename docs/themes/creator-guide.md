# Make a Tigrana theme

You can build a theme in **Settings → Appearance** without writing CSS. Start from an existing theme, change its colors and fonts, check the preview, then export one file. Advanced CSS is there when you want a different layout, artwork, or panel treatment.

This guide describes the theme system on this branch. Older Tigrana releases may ignore the new typography, control, and original-snapshot fields; use a build containing this guide when exchanging those themes.

## Your first theme

1. Pick the theme closest to your idea. **Create theme** makes a new theme from the current appearance. Default is a starting point and cannot be edited in place. **Edit theme** on another built-in creates an editable copy; editing a saved theme updates that saved theme.
2. Give it a distinct name. In **Visual**, choose the accent, background, text, and fonts. The preview's **Dark / Light** selector also chooses which palette you are editing; fill out both.
3. Choose the author's default navigation and right-sidebar behavior. All three navigation styles are supported. Readers apply these with **Use theme's layout**; switching themes preserves their existing choices. **Keep current** leaves that choice alone even when applying the layout.
4. Under **Advanced surfaces**, choose a background and set panel opacity. Lower opacity reveals the background without fading the text. This works with ordinary panels as well as Plasma. If you enable **Plasma UI by default**, adjust Flow, frostiness, and background blur too. Explicit surface opacity takes precedence over the opacity derived from frostiness.
5. Use **Expand preview** to see more of the workspace. Try each navigation layout, turn Outline on and off, and enable Menu states and Compact title. Check the word count, selected rows, highlights, links, tables, and disabled controls. The desktop layout scales down to fit the preview window. Scroll inside the note to inspect the rest of the sample.
6. Open **Theme check** and review its findings. Choose **Save and use**, complete any save/conflict choice, and check the result in a real notebook.
7. Use **Export theme** to share a `.tigrana-theme` file. Recipients use **Import theme** in Appearance.

If you adjust Appearance after choosing a theme, **Save current settings as new theme** appears beside the theme actions. It opens a new draft with the current accent, navigation, right sidebar and Plasma settings. Name it and save to reuse those choices. The original theme stays intact. Returning your choices to the theme defaults removes the reminder. Light/dark mode is a notebook preference; both palettes are kept in the new theme.

The preview is a styled sample using the application's stylesheets, fonts, and theme compiler. It does not run notebook operations or simulate every window size. Check your theme in the application before publishing it.

## Colors that stay consistent

The accent supplies the selected background for notes, sections, and tabs. **Selected item text** supplies their foreground. Menu selections follow that pair unless you override **Selected menu background / text**. Hover colors have their own pair as well.

When an optional foreground is automatic, Tigrana chooses a readable foreground for the corresponding background. An explicit color stays exactly as you chose it. Use **Automatic** beside an overridden optional color to return to its fallback. Highlight colors control marked text in a note; selecting text with the mouse is a separate state.

**Quick appearance** in Appearance is for notebook-only accent changes. Title-bar styling, including **Colored title bar**, belongs in the theme editor. Older quick title-bar overrides are ignored so the selected theme controls it. Those choices, manual navigation/sidebar changes, and the Plasma override do not edit the shared theme. Choosing a theme again applies its visual defaults and clears the quick appearance overrides. Navigation style and sidebar visibility stay as you set them. When they differ from the theme's defaults, **Use theme's layout** in Appearance applies the author's navigation and right sidebar choices. The preview always starts with the author's intended layout.

## Fonts without tiny labels

In Visual, **Default editor width** and **Default note alignment** apply when someone selects the theme. Typewriter uses Narrow Width and Align center. **Default word count** can show or hide the word count when the theme is selected; Typewriter starts with it shown. Alignment positions the note column, not the text inside paragraphs. **Keep current** leaves that choice alone. Manual changes in View or editor options are saved with the notebook; selecting a theme with explicit defaults reapplies them.

Set the overall interface and editor fonts first. Note content uses available bold and italic faces, or browser-generated weight and slant when a font only includes regular text. Avoid disabling `font-synthesis` on note content; that can make formatting invisible in single-face fonts. Check bold, italic, and combined emphasis in both color modes before sharing a theme.

The **Text sizes** group lets you tune:

| Role | Used for |
| --- | --- |
| Note title | Full title above the note |
| Compact title | Title shown in the editor toolbar |
| Navigation | Pane headings and note/folder rows |
| Tabs | Tab labels |
| Menu labels | Editor options and application popovers |
| Secondary text | Menu descriptions and section captions |
| Word count | Status text at the bottom of the editor |

Leave a size empty to follow the app/editor size. **Use automatic text sizes** clears all role overrides. Most roles accept 11–32 px; the full title accepts up to 96 px. Pixel fonts often need larger menu and status sizes than ordinary fonts. Adventure Quest demonstrates this without enlarging the note body.

You can package WOFF2 fonts. An asset named `assets/body.woff2` becomes `theme-font-body`; enter `theme-font-body, sans-serif` in the font field. Preview and notebook font registrations are isolated, so previewing another theme cannot replace an active theme's font.

## Panels, custom CSS, and artwork

Open **Advanced CSS**. The read-only generated section shows the values from Visual; put your rules in **Custom CSS**. Visual changes never rewrite those rules. A **Custom CSS** hint beside a visual field means a rule may override it.

Start with semantic variables, so the palette and controls remain useful:

```css
:scope {
  --tigrana-panel-gap: 16px;
  --tigrana-workspace-inset: 16px;
  --tigrana-panel-radius: 14px;
  --tigrana-panel-shadow: 0 8px 24px #00000030;
}
.note-tab.is-active {
  background: var(--tigrana-accent);
  color: var(--tigrana-selected-text);
}
.theme-dark .ProseMirror h2 {
  color: var(--tigrana-accent);
}
```

Window-like panels do not require Plasma. The built-in panel gap, inset, radius and shadow variables work in standard mode. Plasma owns its GPU effects; custom CSS still controls supported pane and content styles. Choose landscape images in Advanced surfaces so Plasma can render its rims, refraction, frostiness, and background blur over them. An opaque background image applied directly to the workspace with custom CSS can cover those effects. The ordinary CSS landscape remains available when Plasma is off or unavailable.

Use the editor's **CSS reference and examples** for selectors and variables, or read the [Theme API reference](README.md#theme-api-1). Settings, recovery controls, native menus and dialogs are outside the custom CSS boundary, so arbitrary CSS cannot hide them. Settings keeps the theme's palette but uses consistent Inter typography with a 14px base size for controls and dropdowns. This prevents oversized native menus when a theme compensates for a small pixel font. App zoom still scales Settings. The notebook and live preview retain the theme's fonts and sizes.

Use local PNG, JPEG or WebP artwork and WOFF2 fonts. Reference a packaged image with `url("assets/paper.webp")`. Remote URLs, imports, arbitrary data URLs, scripts, SVG, CSS nesting, `!important`, animations, filters and functional selector pseudo-classes such as `:is(...)` are rejected. Write separate complete selectors instead. Invalid CSS is shown as an error and prevents saving; the preview temporarily uses the visual settings.

## Give your theme its own controls

Under **Visual → Theme-specific controls**, users adjust sliders, colors and switches. Under **Define controls for this theme**, creators define those controls as JSON and choose **Apply control definitions**. **Start with a slider** supplies an example.

```json
[
  { "id": "border-width", "label": "Panel border width", "type": "range", "min": 1, "max": 6, "step": 1, "value": 3 },
  { "id": "rim", "label": "Rim color", "type": "color", "value": "#9bc4ff" },
  { "id": "art", "label": "Show artwork", "type": "toggle", "value": true }
]
```

Each definition exposes `--tigrana-control-ID` inside the theme. Ranges are unitless, colors are hex, and toggles are `1` or `0`. Connect the control to CSS:

```css
.main-pane {
  border-width: calc(var(--tigrana-control-border-width) * 1px);
  border-color: var(--tigrana-control-rim);
}
.main-pane::before {
  opacity: var(--tigrana-control-art);
}
```

These values do nothing until a CSS rule uses them. Keep IDs stable when releasing updates. Use up to 24 controls; IDs begin with a lowercase letter and contain lowercase letters, digits or hyphens, up to 48 characters. Labels have 1–80 characters. Range bounds are within −1000 to 1000 with a positive step and an in-range default. Colors use six-digit hex. Controls cannot run code.

[Starfall](starfall-studio/README.md) demonstrates an artwork toggle. [Adventure Quest](8-bit-adventure/README.md) demonstrates panel border width.

## Keep your edits when an original changes

A newly created/edited derived theme includes a complete **original snapshot**. It travels with your theme, including its assets. **Revert to defaults** restores that snapshot while keeping your copy's name and identity. The shipped original remains available in the picker.

If a matching original with different content is available in the built-in catalog or installed library, the editor offers **Update original, keep my changes**:

- Unchanged fields adopt the new original's values.
- Your changed colors, sizes and other fields remain yours.
- Controls are compared by their stable IDs; an edited value does not freeze every control definition.
- Custom CSS is kept as a whole if you edited it. Tigrana does not guess how to merge CSS text.
- If the result is invalid, such as a slider value outside a new range, the update fails with an error and your draft remains intact.

After a successful update, Revert to defaults refers to the newly accepted original. Updates are explicit, never background replacements. Themes made before snapshots existed cannot recover an unknown historical original; the editor uses the available baseline when first establishing one.

This is separate from a notebook/library conflict: notebooks carry full portable copies. When a saved theme differs from the app-wide copy, the comparison dialog lets you choose which version to use. Merely importing a different theme does not silently overwrite other notebooks.

## Work in a text editor

Export a theme, then unzip it. The package contains `theme.json`, optional `theme.css`, `LICENSE`, and `assets/`. You can also import the [Quiet Paper starter package](example.tigrana-theme) or start with [its source](example/theme.json). Extended themes use `schemaVersion: 2` and `design.apiVersion: 1`; `design.version` is your own `major.minor.patch` release number.

From a checkout of this repository with dependencies installed:

```sh
npm run theme:check -- docs/themes/example
npm run theme:check -- docs/themes/starfall-studio.tigrana-theme
npm run theme:check -- /path/to/exported-theme.json
```

The command uses the app's parser, compiles both color schemes, and verifies package round-tripping. Invalid themes exit with an error. Contrast and readability findings are advisory; they do not prevent a deliberate design from being saved.

To package a source example under `docs/themes/<directory>`:

```sh
node docs/themes/build-example.mjs example
npm run theme:check -- docs/themes/example.tigrana-theme
```

The builder also regenerates the shipped Starfall and Adventure Quest documents when run for their source directories. Use your own ID and name before distributing a new theme. The optional `typography`, `controls`, `baseThemeId`, and `baseThemeSnapshot` fields are preserved by current imports/exports. Snapshots cannot contain another snapshot.

Limits include 100 KB of CSS, 32 assets, approximately 2 MB per asset, 6 MB of base64 asset data per document, and 8 MB for a full saved theme including its original. Compressed and expanded packages also have an 8 MB limit. A package is checked before export, so an oversized snapshot cannot produce an unusable file. Reduce artwork sizes if you hit the limit.

## Check and share

Theme check measures palette contrast in both modes, looking for 4.5:1 for normal text, and flags very small role sizes. It cannot measure the final pixels produced by artwork, translucency, Plasma or custom CSS. Inspect those visually at ordinary zoom. Check keyboard focus, hover, selected labels, disabled controls, all three navigation styles, and both sidebar states.

Set your name, theme version and license in **Sharing details**. Include licenses/attribution for any fonts and artwork you redistribute. Export the package and publish it alongside screenshots and the Tigrana build you tested. There is no automatic marketplace submission or hosted update service.

For packaged fonts, choose a license that explicitly permits redistribution, such as SIL OFL 1.1. A free download or a font installed on your computer is not enough. Include the original copyright and full font license in Sharing details so they travel with exports. Keep font licensing separate from your theme's styling/artwork license. See Tigrana's [bundled font inventory](../../public/licenses/README.md) for examples.

If a theme breaks, open Appearance and choose another theme or **Restore default appearance**. The recovery shortcut is **Cmd+Option+Shift+T** on macOS or **Ctrl+Alt+Shift+T** elsewhere. Invalid notebook snapshots fall back to a safe Default appearance in memory with a notice; their saved content is kept until you choose a replacement. A bad bundled entry is isolated at startup, while the build checks still reject invalid shipped themes.

## Design references

Tigrana adopts named UI color roles and the ability to start from an existing theme, approaches documented by [VS Code](https://code.visualstudio.com/api/extension-guides/color-theme). The expanded surface preview follows the same useful principle as [Zed's theme builder](https://zed.dev/docs/themes#build-your-theme): inspect the whole interface before exporting. These are design references, not compatible package formats. Tigrana keeps its own portable Markdown notebook and scoped CSS contract.
