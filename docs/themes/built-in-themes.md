# Built-in themes

All built-ins are validated schema 2 documents using Theme API 1. `src/themes/classic.json` holds the original palette themes, and individual JSON files hold Vampire and the other newer themes. `src/lib/bundledThemes.ts` is the catalog.

Old notebook preset IDs remain supported. The app overlays their existing font and color preferences on the corresponding document at render time; opening a notebook does not rewrite its appearance metadata. Saved schema 1 themes remain supported and are upgraded to schema 2 when edited and saved. Imported CSS still goes through the same scoped CSS compiler. No Obsidian CSS is injected into the app.

## Theme families and colors

Appearance groups Classic’s Default, Atom, Everforest, Gruvbox, Nord, and Solarized palettes under one theme. Catppuccin groups Frappe, Latte, Macchiato, and Mocha. `src/lib/themeFamilies.ts` defines the grouping; each color keeps its existing durable preset ID. Notebook metadata remembers the most recently selected color in each family. Changing colors clears an accent override but retains typography, effects, and layout adjustments. Choosing a different theme resets quick appearance settings.

Mode remains System, Light, or Dark. Catppuccin preserves its existing pairs: all light variants use Latte; the Latte choice uses Frappe in dark mode.

Theme editing offers line height from 1.2 to 2.2 and letter spacing from -0.03em to 0.12em. Defaults use each theme’s existing line-height metric and normal letter spacing. Both values display two decimal places and are saved in portable `editorLineHeight` and `editorLetterSpacing` fields. Older notebook overrides remain readable. Navigation style lives in General settings.

Twain was previously named Typewriter. Its source directory, package, and app JSON are named `twain`; the `builtin-typewriter` ID is retained for existing notebooks and shared snapshots.

## Adaptations

Minimal is a Tigrana adaptation, not an official port or Obsidian plugin integration. Attribution and its upstream MIT license notice travel inside its exported sharing details.

| Theme | Source inspected | Tigrana choices |
| --- | --- | --- |
| Minimal | [kepano/obsidian-minimal](https://github.com/kepano/obsidian-minimal), 9.1.0 | Neutral white/charcoal surfaces, muted blue-gray accent, system interface and editor fonts (San Francisco on macOS), tighter corners and spacing, restrained heading weight. Accent is adjusted for readable selections. |

Minimal, Saratoga, and Based default to standard UI and support Plasma when enabled. Starfall and Vampire default to Plasma. Selecting another theme restores that theme's defaults and clears quick appearance overrides. Note rows retain rounded corners; section rows stay rectangular.

Typography, colors, and design metrics use the engine's editable values. Custom CSS refers to theme variables instead of repeating fixed colors. Obsidian-specific layouts, helper classes, alternate task syntax, plugins, and animation systems are not included.

## Plasma

Plasma groups four colors: Vampire (blood red), Ooze (moss green), Undertow (deep blue), and Witch's Brew (violet). All share Vampire’s fonts, layout, transparency, and animated glass defaults. All four retain dark palettes and lighting even in Light mode. Color selection is remembered per notebook.

Vampire remains in `src/themes/vampire.json` with its legacy `dracula` ID. The additional portable color documents are in `src/themes/plasma.json`. Vampire was formerly named Alucard.

Dark blood-red Plasma glass with warm charcoal panels in both color schemes.
For now, light mode uses the same palette and glass lighting as dark mode. Deep red selections and highlights use white text. Red rim
lighting and a gentle flow effect accompany readable editor text. Plasma starts enabled with ambient bubbles, 12% frost, 20% flow, and no background blur.
The translucent panels reveal the red background while text stays opaque.
Ambient bubbles use Plasma's native clear-glass rendering, refraction, orbiting
motion, and smooth merging. Three small drops merge into amorphous shapes as
they approach each other and separate again as they drift apart. Nearby bubbles gently stretch toward the normal pointer, with no separate
cursor-following bubble. The pull fades as the pointer moves away. Bubble glass is drawn into
the background before the panel pass, so panes cannot swallow its outline.
Panel lighting remains subdued; bubbles have a faint iridescent rim and no
milky wash. Darker panel fills keep text readable with the lower frost.
Ambient bubbles can be toggled in Edit theme → Advanced surfaces → Plasma glass,
and are hidden when Reduce Motion is enabled.
The word-count badge uses ivory serif lettering and a dark blood-red frame. Its serif stack uses system fonts; no additional font files
are bundled. The rest of the interface uses bundled Inter.
Its internal ID remains `dracula` for notebook compatibility;
reselect Vampire to apply its new defaults to an existing notebook.

## Saratoga

Floating rounded panels on a subtle gradient workspace, raised tabs, soft gray
surfaces and a blue accent. The editor retains its toolbar divider with 24px of
space before the title. Defaults to Dual pane with sections and Plasma off; writing layout and sidebar visibility keep their current values. Uses installed system fonts with
Inter fallback; no proprietary font files are distributed.

Its internal ID remains `builtin-cupertino` for saved-theme compatibility. The
original MIT copyright notice remains in the exported license text.

## Based

A Tigrana adaptation of [Baseline's default layout](https://github.com/aaaaalexis/obsidian-baseline),
with neutral gray selections, soft borderless panels, normal-case navigation labels,
and bundled Inter. White/light-gray and charcoal palettes keep the editor prominent;
hover states are subtler than selections and links remain underlined. Panels have
8px gaps, with 4px between the tab bar and panels. The editor toolbar has no divider below it.
Defaults to Dual pane with sections and Plasma off; writing layout and sidebar visibility keep their current values. Manual width and alignment changes remain available.

Its internal ID remains `builtin-baseline` so existing saved copies can still
update or revert to this original. The original MIT copyright notice remains in
the exported license text.

## Verification

`src/lib/builtInThemes.test.ts` checks every built-in for schema validity, package round trips, light/dark rendering, preview/runtime stylesheet agreement, Plasma defaults, unique identity, and at least 4.5:1 contrast for primary editor/interface text, selected text, and marked text against their palette backgrounds. Transparent panels and arbitrary user CSS still require visual inspection against the actual background.

The initial audit corrected automatic foreground selection for pale accents and slightly darkened Solarized's light interface text. Default's selection tint is carried in its portable CSS so copies and previews keep that behavior.

A read-only audit of the local app-wide collection on 2026-09-18 validated all three saved themes in light and dark modes, including two schema 1 documents. No saved theme files were rewritten.

## Old Basement PC

Original Tigrana theme inspired by DOS file managers and blue-screen text interfaces. Dark mode uses navy panels, white editor text, cyan headings, and yellow selections. Light mode recalls a Windows 95 word processor: white paper, black text, gray toolbars and navigation, navy pane headers, and raised/sunken bevels. Separate framed panes sit over a daylight sky and meadow wallpaper in light mode, and subdued dark blue clouds in dark mode, with Plasma off by default. Editor and panel backgrounds remain solid.

The theme embeds the unmodified Latin regular WOFF2 of [IBM Plex Mono](https://github.com/IBM/plex), obtained from Fontsource 5.3.0, for clean monospace lettering. Its SIL OFL 1.1 notice travels in the package. Bold and italic use the editor's existing font synthesis support. Packaged font tokens resolve to isolated runtime/preview font names; no network requests are required. See [artwork and license details](old-basement-pc/README.md).

## Panel layout customization

Theme API 1 exposes `--tigrana-panel-gap` and `--tigrana-workspace-inset` in both standard and Plasma layouts. Standard mode also supports `--tigrana-panel-radius`, `--tigrana-panel-shadow`, and `--tigrana-workspace-background`. Values can be set in Advanced CSS on `:scope`; the in-app CSS reference includes a complete example. The app still owns the grid variants and resize handles, so creators do not need to reproduce every sidebar visibility combination. Use gaps of at least 6px to retain a usable drag target. Advanced surfaces continues to control opacity independently.

Minimal uses quieter labels, rounded gray active tabs, a soft blue-gray accent, matching note and text selection colors, bold note titles, and a soft shadow along the left sidebar edge facing the editor. Minimal remains an adaptation, not a pixel-for-pixel Obsidian port. Existing notebook snapshots are preserved; reselect the built-in to adopt the revised design.

Browser layout verification covered all 16 combinations of single/dual navigation, left sidebar visibility, outline visibility, and standard/Plasma mode at 1200px workspace width. All retained the requested 18px inset and splitter width without horizontal overflow.


All built-in themes use **Keep current** for editor width, note alignment, and word count. Right-sidebar visibility also uses **Keep current**, except Minimal, which hides it by default. Navigation defaults remain **Dual pane with sections**. Choosing a theme preserves your writing layout.

Custom themes may include `navigationStyle` with `dual-pane`, `single-pane`, or `section-view`, or omit it to keep the current layout. The theme editor exposes this as **Default navigation style**.

Themes may also set `rightSidebarOpen` to `true` or `false`. Omit it for Keep current. The theme editor's Default right sidebar control sets this preference. Manual sidebar changes are saved with the notebook and remain until another theme supplies a sidebar default.

Minimal defaults to a closed right sidebar. All other built-in themes leave its visibility unchanged. Based uses rounded tabs and separate framed panels without an accent border across the title bar or editor.

Default is a read-only starting point. Other built-ins expose Edit theme, which saves a customized copy with a portable `baseThemeId` pointing to the original built-in. Revert to defaults restores that built-in's settings in the draft while retaining the copy's identity and name; Save and use commits the reset. Existing custom themes without a recorded built-in origin are not guessed from their names.

Plasma rims use the effective accent color, including notebook quick-accent overrides.

## Quest

Retro adventure menus: pixel lettering, green and gold panel frames, an original generated woodland map, near-black dark mode, and parchment light mode. It bundles Geist Pixel Square and its SIL OFL 1.1 license, with 15px interface and 17px editor defaults, plus the background image. Defaults to Dual pane with sections and Plasma off; sidebar visibility keeps its current value. Editable source and assets live in `docs/themes/8-bit-adventure/`.

## Twain

Word count starts on when Twain is selected. It can be turned off afterward in View or General settings.

Warm ivory paper and brown ink in light mode; charcoal paper, cream text, and a muted tan accent in dark mode. Thin panel borders, small corner radii, and regular-weight serif titles keep the writing area quiet. Defaults to Dual pane with sections and Plasma off; writing layout and sidebar visibility keep their current values. Manual layout changes remain available and persist with the notebook.

Both the interface and editor use [Solway](https://github.com/mashavp/Solway), a proportional slab serif with a typewriter feel. The unmodified Latin regular WOFF2 from `@fontsource/solway` 5.3.0 is bundled for offline use, with Georgia/serif fallbacks for other glyphs. The full SIL Open Font License 1.1 and attribution travel with the theme. No American Typewriter font files are distributed.

Editable source and the font live in `docs/themes/twain/`. Run `node docs/themes/build-example.mjs twain` to regenerate both the app document and `docs/themes/twain.tigrana-theme`. Validate with `npm run theme:check -- docs/themes/twain`.

## Catppuccin and classic palette refresh

Reviewed against the upstream palettes on 2026-09-21. These are Tigrana
adaptations, with the existing editor, navigation, sidebar controls, and font
choices. No new fonts or upstream application stylesheets are bundled.

[Catppuccin](https://catppuccin.com/palette/) has one light flavor and three dark
flavors. All four entries use Latte in light mode; their chosen accent carries
across modes using that flavor's corresponding official color.

| Theme | Light palette | Dark palette | Default accent |
| --- | --- | --- | --- |
| Catppuccin Latte | Latte | Frappé | Blue |
| Catppuccin Frappé | Latte | Frappé | Green |
| Catppuccin Macchiato | Latte | Macchiato | Peach |
| Catppuccin Mocha | Latte | Mocha | Mauve |

The dark bases retain the upstream progression from Frappé's softer slate to
Macchiato's deeper blue-gray and Mocha's darkest charcoal. The old invented
lavender and pink light palettes are replaced with Latte. Base, Mantle, Crust,
Surface, and text roles follow the [Catppuccin style guide](https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md).
Links use each palette's blue. Selected-item foregrounds use a palette color
where it meets 4.5:1 contrast, otherwise black or white. Marker highlights use
the palette's yellow rather than generic fluorescent yellow.

Classic's Atom, Gruvbox, Nord, Solarized, and Everforest colors follow the
[AnuPpuccin reference previews](https://github.com/AnubisNekhet/AnuPpuccin/tree/main/assets/colorschemes).
Nord uses the `nord-darker` dark variant and `nord-light` light variant. The others
use their named light and dark previews. Editor backgrounds use Base, sidebars
use Mantle, and text uses Text. The accents match the previews: orange for
Gruvbox and Solarized, cyan for Nord, blue for Atom, and coral for Everforest.
Yellow marker highlights and explicit menu/hover foregrounds retain readable contrast.

These are color adaptations on Tigrana's Classic layout, with no AnuPpuccin
stylesheet code or artwork included. Classic typography, spacing, and geometry
remain unchanged. Existing saved copies are preserved; reselect the built-in
color to adopt the updated palette. Everforest uses the new durable ID `everforest`.
