# Built-in themes

All built-ins are validated schema 2 documents using Theme API 1. `src/themes/classic.json` holds the original palette themes, and individual JSON files hold Minimal, Cupertino, Baseline, and Starfall. `src/lib/bundledThemes.ts` is the catalog.

Old notebook preset IDs remain supported. The app overlays their existing font and color preferences on the corresponding document at render time; opening a notebook does not rewrite its appearance metadata. Saved schema 1 themes remain supported and are upgraded to schema 2 when edited and saved. Imported CSS still goes through the same scoped CSS compiler. No Obsidian CSS is injected into the app.

## Adaptations

These are Tigrana adaptations, not official ports or Obsidian plugin integrations. Upstream names identify the inspiration. Attribution and upstream MIT license notices travel inside each exported theme's sharing details.

| Theme | Source inspected | Tigrana choices |
| --- | --- | --- |
| Minimal | [kepano/obsidian-minimal](https://github.com/kepano/obsidian-minimal), 9.1.0 | Neutral white/charcoal surfaces, muted blue-gray accent, system font stack, tighter corners and spacing, restrained heading weight. Accent is adjusted for readable selections. |
| Cupertino | [aaaaalexis/obsidian-cupertino](https://github.com/aaaaalexis/obsidian-cupertino), 3.2.12 | macOS-inspired gray surfaces, blue accent, system typography, softer controls and heavier headings. Uses installed system fonts, with Inter fallback; no proprietary font files are distributed. |
| Baseline | [aaaaalexis/obsidian-baseline](https://github.com/aaaaalexis/obsidian-baseline), 3.2.12 | Bundled Inter, neutral surfaces, purple accent, modest corner radius, structured code/table borders, comfortable line spacing. |

The three new themes default to standard UI and support Plasma when enabled. Starfall defaults to Plasma. Selecting another theme restores that theme's defaults and clears quick appearance overrides. Note rows retain rounded corners; section rows stay rectangular.

Typography, colors, and design metrics use the engine's editable values. Custom CSS refers to theme variables instead of repeating fixed colors. Obsidian-specific layouts, helper classes, alternate task syntax, plugins, and animation systems are not included.

## Verification

`src/lib/builtInThemes.test.ts` checks every built-in for schema validity, package round trips, light/dark rendering, preview/runtime stylesheet agreement, Plasma defaults, unique identity, and at least 4.5:1 contrast for primary editor/interface text, selected text, and marked text against their palette backgrounds. Transparent panels and arbitrary user CSS still require visual inspection against the actual background.

The initial audit corrected automatic foreground selection for pale accents and slightly darkened Solarized's light interface text. Default's selection tint is carried in its portable CSS so copies and previews keep that behavior.

A read-only audit of the local app-wide collection on 2026-09-18 validated all three saved themes in light and dark modes, including two schema 1 documents. No saved theme files were rewritten.

## Old Basement PC

Original Tigrana theme inspired by DOS file managers and blue-screen text interfaces. Dark mode uses blue panels, cyan editor text, and yellow selections. Light mode uses gray file-manager surfaces with a blue title bar. Square corners and double-rule dividers keep the terminal character. Plasma defaults off but remains available.

The theme embeds the Latin WOFF2 of [VT323 by Peter Hull](https://github.com/phoikoi/VT323), obtained from Fontsource 5.2.5. Its SIL OFL 1.1 notice travels in the package. Packaged font tokens in the Visual font fields resolve to isolated runtime/preview font names; no network requests are required. The preview registers these fonts outside its shadow tree for WebKit compatibility.

## Panel layout customization

Theme API 1 exposes `--tigrana-panel-gap` and `--tigrana-workspace-inset` in both standard and Plasma layouts. Standard mode also supports `--tigrana-panel-radius`, `--tigrana-panel-shadow`, and `--tigrana-workspace-background`. Values can be set in Advanced CSS on `:scope`; the in-app CSS reference includes a complete example. The app still owns the grid variants and resize handles, so creators do not need to reproduce every sidebar visibility combination. Use gaps of at least 6px to retain a usable drag target. Advanced surfaces continues to control opacity independently.

Cupertino 1.1.0 uses an inset gradient workspace, floating rounded panels, native-style raised tabs, distinct toolbars, and softened note blocks. Baseline 1.1.0 uses framed panels, uppercase navigation labels, and an accent rule above the editor. Minimal 1.1.0 stays flat, with quieter labels, underline tabs, and lighter title typography. These remain adaptations, not pixel-for-pixel Obsidian ports. Existing notebook snapshots are preserved; reselect the built-in to adopt the revised design.

Browser layout verification covered all 16 combinations of single/dual navigation, left sidebar visibility, outline visibility, and standard/Plasma mode at 1200px workspace width. All retained the requested 18px inset and splitter width without horizontal overflow.


Themes may include `navigationStyle` with `dual-pane`, `single-pane`, or `section-view`. Omit it to keep the notebook's current layout. Selecting a theme applies its preference; subsequent manual changes persist until another theme with a navigation preference is chosen. Minimal, Baseline, and Old Basement PC default to Single pane. All other built-in themes default to Dual pane with sections. The theme editor exposes this as **Default navigation style**.

Themes may also set `rightSidebarOpen` to `true` or `false`. Omit it for Keep current. The theme editor's Default right sidebar control sets this preference. Manual sidebar changes are saved with the notebook and remain until another theme supplies a sidebar default.

Minimal, Baseline, and Typewriter default to a closed right sidebar. All other built-in themes, including Default, open it by default. Baseline uses rounded tabs and separate framed panels without an accent border across the title bar or editor.

Default is a read-only starting point. Other built-ins expose Edit theme, which saves a customized copy with a portable `baseThemeId` pointing to the original built-in. Revert to defaults restores that built-in's settings in the draft while retaining the copy's identity and name; Save and use commits the reset. Existing custom themes without a recorded built-in origin are not guessed from their names.

Plasma rims use the effective accent color, including notebook quick-accent overrides.

## Adventure Quest

Retro adventure menus: pixel lettering, green and gold panel frames, an original generated woodland map, near-black dark mode, and parchment light mode. It bundles VT323 and its font license, plus the background image. Defaults to Dual pane with sections, right sidebar open, Plasma off. Editable source and assets live in `docs/themes/8-bit-adventure/`.

## Typewriter

Word count starts on when Typewriter is selected. It can be turned off afterward in View or General settings.

Warm ivory paper and brown ink in light mode; charcoal paper, cream text, and a muted tan accent in dark mode. Thin panel borders, small corner radii, and regular-weight serif titles keep the writing area quiet. Defaults to Dual pane with sections, right sidebar closed, Narrow Width, Align center, and Plasma off. Manual layout changes remain available and persist with the notebook.

Both the interface and editor use [Solway](https://github.com/mashavp/Solway), a proportional slab serif with a typewriter feel. The unmodified Latin regular WOFF2 from `@fontsource/solway` 5.3.0 is bundled for offline use, with Georgia/serif fallbacks for other glyphs. The full SIL Open Font License 1.1 and attribution travel with the theme. No American Typewriter font files are distributed.

Editable source and the font live in `docs/themes/typewriter/`. Run `node docs/themes/build-example.mjs typewriter` to regenerate both the app document and `docs/themes/typewriter.tigrana-theme`. Validate with `npm run theme:check -- docs/themes/typewriter`.
