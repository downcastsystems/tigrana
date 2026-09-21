# Tigrana theme API reference

**New here? Start with the [Theme creator guide](creator-guide.md)** for the visual workflow, theme controls, original snapshots, validation, and sharing.

For a complete illustrated example, see [Starfall](starfall-studio/README.md),
including an importable package, original character art, and commented CSS for
light, dark, and Plasma appearances.

The default appearance is unchanged. Settings → Appearance → Create theme opens the
visual builder. Advanced CSS adds component styling without changing note content
or navigation behavior. Sharing details are optional until publishing a theme.

## Portable packages

Export theme produces a `.tigrana-theme` ZIP containing:

- `theme.json`: complete light/dark palettes, fonts, Plasma settings, and design metadata
- `theme.css`: optional component styling
- `LICENSE`: optional license text
- `assets/`: optional PNG, JPEG, WebP and WOFF2 files

Import theme accepts this package, a ZIP containing one source folder, or legacy
JSON. To work in an external editor, unzip the export, edit `theme.css`, compress
the source files, and import again. The example folder beside this document is a
complete starting point. Do not include source-control folders or executable files.

The installed library deliberately retains one normalized `<id>.json` snapshot
per theme. This preserves the existing atomic compare-and-swap protocol. The
snapshot embeds CSS and base64 assets; notebook metadata embeds the same complete
snapshot. No external file, font installation, account or download is required to
restore it. ZIP is the interchange/source format, not an additional mutable source
of truth. Import collisions create a copy instead of overwriting a different ID.
Editing and saving a theme updates its existing app-wide version and this notebook,
retaining author credit. Use Make a copy to save a separate theme. Reconciliation
recommends replacing the app-wide version with the notebook version; it still
requires an explicit choice. Concurrent edits retain compare-and-swap protection.
Choosing Keep both versions unchanged stores fingerprints of both theme copies
in the notebook's appearance metadata. The same difference stays acknowledged
across Settings, notebook opens and app restarts. A content change to either copy
allows the prompt again on the next comparison. Keeping a notebook-only theme is
remembered similarly, until that theme changes or an app-wide copy appears.
There are no background theme updates. Gallery discovery, review and hosting are
future work; they should install this same package format.

## Theme API 1

Extended documents use `schemaVersion: 2`, with `design.apiVersion: 1`. Version 1
JSON remains supported. An unsupported API is rejected before applying anything.
`design.version` is the creator's major.minor.patch version, independent of the
schema/API version. Author, license and version are transported with the theme.

Production styles use ordered CSS layers: `tigrana-base`, `tigrana-plasma`, and
`tigrana-api`. Validated creator CSS follows them, so normal declarations can
restyle supported components without `!important`. The visual builder owns the
palette and numeric defaults. Creator CSS wins where it explicitly overrides them.
Editing visual controls does not rewrite or delete creator CSS.

Every custom selector is parsed and confined to a notebook region. `:scope`
addresses a region's root. Roots are the app title bar and notebook frame. The
same roots are present in the isolated preview. Each root has `.theme-light` or
`.theme-dark`, and `.theme-standard` or `.theme-plasma`.

```css
:scope {
  --tigrana-radius: 3px;
  --tigrana-spacing: 0.9;
  --tigrana-line-height: 1.7;
}
.theme-dark .ProseMirror h2 { color: #90d6c4; }
.theme-light .ProseMirror h2 { color: #235b50; }
.note-tab { border-radius: 3px; }
```

Supported variables:

| Variable | Meaning |
| --- | --- |
| `--tigrana-background` | Note background |
| `--tigrana-surface` | Navigation pane background |
| `--tigrana-text` | Interface text |
| `--tigrana-editor-text` | Note title and editor text |
| `--tigrana-selected-text` | Text on selected rows, tabs, and text selections |
| `--tigrana-highlight-text` | Highlighted words in notes |
| `--tigrana-highlight-background` | Highlight background, yellow by default |
| `--tigrana-muted` | Secondary text |
| `--tigrana-accent` | Selection and accent color |
| `--tigrana-border` | Borders |
| `--tigrana-radius` | Component corner radius |
| `--tigrana-spacing` | Unitless spacing multiplier |
| `--tigrana-line-height` | Editor line height |

Stable component hooks for API 1:

| Area | Selectors |
| --- | --- |
| Window chrome | `.app-titlebar`, `.note-tabs`, `.note-tab`, `.note-tab.is-active`, `.tab-close` |
| Navigation | `.folder-pane`, `.notes-pane`, `.unified-tree-pane`, `.folder-row`, `.note-card`, `.unified-note-row`, `.unified-folder-row`, `.pane-header` |
| Workspace | `.app-frame`, `.main-pane`, `.right-sidebar`, `.note-surface` |
| Word count badge | `.note-status-bar`, `.note-status-bar span` |
| Controls inside regions | `.toolbar-button`, `.icon-button`, `button`, `input`, `select` |
| Editor | `.note-title-input`, `.ProseMirror`, headings, paragraphs, links, lists, blockquotes, pre/code, tables, images, marks, horizontal rules |
| Tasks | `[data-type="taskList"]`, `[data-type="taskItem"]`, `[data-checked="true"]` |

Other implementation selectors may change. These hooks style existing elements;
they do not create commands, rearrange the underlying notebook data, or change
Markdown serialization. Native operating-system menus/window controls are not CSS.

The creator CSS boundary excludes Settings, recovery UI, and application dialogs
and popovers rendered outside notebook regions. Those retain the visual palette
but do not accept arbitrary component CSS. Opening Settings preserves applied
creator CSS on the notebook. The recovery keyboard shortcut remains available. The isolated draft preview continues to work while Settings is open.

## Assets and supported CSS

Use `url("assets/paper.png")` for packaged images. Adding `assets/body.woff2`
registers `theme-font-body`; use `font-family: theme-font-body, sans-serif`.
Font families are internally namespaced so a preview cannot redefine app fonts.
URLs are rewritten from validated assets, never fetched from a server.

API 1 supports ordinary rules, descendant/child selectors, the documented state
classes, basic state pseudo-classes, before/after/marker/selection/placeholder, and
`@media`. CSS functions are explicitly allowed for colors, gradients, arithmetic,
layout and basic transforms. Use complete selectors instead of CSS nesting.

Rejected: remote URLs, imports, scripts, SVG, arbitrary data URLs, `@font-face`
(use packaged fonts), other at-rules, sibling combinators, functional selector
pseudo-classes, `!important`, animations/transitions, filters, and custom cursors.
Custom properties must begin with `--tigrana-`. These restrictions are enforced
by a CSS parser, including URLs nested inside custom properties. They are an
intentional first API boundary, not a claim that arbitrary CSS is sandboxed by
selector prefixing alone. Layout can still be made unusable inside its region.

Limits: 100 KB CSS, 12,000 parsed CSS nodes, 32 assets, approximately 2 MB per
asset, 6 MB total base64 asset data, 8 MB compressed/expanded package. Unknown
files, duplicate names and unsafe paths fail import. Invalid drafts cannot be
saved. Their preview falls back to visual settings with an error.

## Plasma and recovery

Builder themes support both rendering modes. A creator can disable Supports
Plasma in Sharing details; selecting that theme turns Plasma off and disables
its toggle. Plasma's fixed GPU renderer remains app-owned; CSS can style the
panes and content but does not replace its shader or surface registration.

Restore default appearance in Settings resets the notebook's theme and Plasma.
`Cmd+Option+Shift+T` on macOS or `Ctrl+Alt+Shift+T` elsewhere performs the same
recovery even when a theme has hidden the notebook controls. Shared theme files
are retained. Recovery is persisted with the normal notebook metadata update.

## Preview and verification

The preview lives in a ShadowRoot with the production app, Plasma and theme-API
stylesheets. It contains representative editor DOM and real styled controls,
rather than using a separate approximate theme stylesheet. It is a sample, not
a second live notebook: file operations, editor transactions and dialogs are
verified separately. Theme CSS is compiled for a distinct preview region.

Before sharing, check both color schemes, both supported rendering modes, active
and inactive tabs, selected navigation, focused and disabled controls, long labels,
headings, paragraphs, emphasis, links, highlights, lists/tasks, quotes, code,
tables and narrow windows. CSS cannot alter the Markdown stored on disk.

The optional light/dark palette fields `editorText`, `selectedText`, and
`highlightText` separate note text, selected item text, and marked word text.
Older themes retain their existing JSON shape. Missing values follow the main
text color, automatic accent contrast, and black highlight text respectively.
The optional `highlightBackground` field sets the background of marked words and
defaults to the existing yellow, `#ffff00`, when absent. Both highlight colors can
be configured independently for light and dark mode.
Explicit text formatting stored in a note and Advanced CSS overrides are preserved.

## Advanced surfaces

Settings → Appearance → Edit theme → Visual includes Advanced surfaces. Choose a
window background color or a local PNG/JPEG/WebP image and set navigation, editor,
outline, and title-bar opacity independently. Images are packaged with the theme.
Only backgrounds become transparent, not text or controls. Standard themes start
opaque; older themes without surface settings retain their previous appearance.
Explicit surface opacity overrides Plasma's frost-derived panel opacity; frost
and blur continue to control its glass effects. Advanced CSS can override visual
surface styles, as it can other visual settings.

Optional `surfaces` stores `background` as #RRGGBB, optional `image` as a packaged
asset path, and `navigation`, `editor`, `outline`, and `titlebar` as 0–100 values.
These settings are shared across light and dark palettes. When configured,
`--tigrana-editor-opacity` exposes the editor percentage for custom background
tints, as demonstrated by Starfall. Settings and dialogs
are outside these surface rules.

## Visual settings and custom CSS

Advanced CSS shows a read-only Generated from Visual settings section for both
color schemes, fonts, and surfaces. It uses the runtime's values and updates with
the Visual controls. Custom CSS remains separate and is never rewritten. Use
variables such as `var(--tigrana-accent)` to follow the Visual controls; fixed
values can override them for matching elements.

Visual color and font fields show a Custom CSS hint when matching declarations
may override them. Hover over the hint for the selectors involved. These are
conservative authoring hints, not a complete browser cascade analysis; conditional
rules, inheritance, and custom variable chains still need previewing. Advanced
surfaces also reminds authors that custom panel rules can override its controls.

## Removing saved themes

Select a saved theme in Settings → Appearance, choose Delete theme, and confirm.
This removes the app-wide copy and switches the current notebook to Default.
Other notebooks retain their portable snapshots and may offer to register them
again when opened. Native deletion keeps a recovery JSON in the app theme
folder's `.trash` directory; importing that file recovers the theme. Stale deletion
requests are rejected if another window changed the saved copy.

## Plasma defaults and notebook overrides

The theme editor's **Advanced surfaces → Plasma UI by default** checkbox and
Flow, frostiness, and background blur sliders determine the theme's glass effects.
Selecting a theme reapplies these settings. Themes without Plasma settings use
standard rendering. Unsupported themes disable the checkbox; authors can enable
**Supports Plasma** in Sharing details to experiment. Appearance no longer offers
a separate Plasma override. Existing notebook Plasma preferences remain readable
until a theme is selected again.

Quick Appearance offers notebook-only accent color, editor font family, and editor
font size overrides. They persist with the notebook, do not modify the shared
theme, and reset when a theme is selected. **Save current settings as new theme**
bakes the overrides into a portable copy. Font choices include bundled Inter,
IBM Plex Mono, Solway, and VT323, plus system font, serif, and monospace fallbacks.
Packaged fonts carry their data and license notices into saved/exported themes.
**Use theme defaults → Use theme default fonts & colors** resets these overrides.

## Authoring extensions

Optional `editorWidthMode` accepts `comfortable`, `narrow`, or `full`. Optional `noteAlignment` accepts `left` or `center` and positions the note column. Selecting the theme applies these defaults; omit either to keep the current setting. Later manual choices persist in notebook appearance metadata. Both defaults are editable in Visual and reflected in the live preview.

Optional palette roles: `menuSelectedBackground`, `menuSelectedText`, `hoverBackground`, `hoverText`. Backgrounds follow the accent by default; foregrounds follow selected text, or automatic contrast when an explicit background is supplied. Their CSS variables are `--tigrana-menu-selected-background`, `--tigrana-menu-selected-text`, `--tigrana-hover-background`, and `--tigrana-hover-text`.

Optional `typography` maps `title`, `compactTitle`, `navigation`, `tab`, `menu`, `secondary`, and `status` to pixel sizes. Runtime variables use `--tigrana-font-` with kebab-case role names. Missing roles follow interface/editor sizes.

Optional `controls` exposes bounded range, color and toggle definitions as `--tigrana-control-ID` variables. Optional `baseThemeSnapshot` retains one validated original matching `baseThemeId`. See the [creator guide](creator-guide.md) for definitions and update rules. Entire saved documents including originals must fit within 8 MB; package manifests may use that same limit while individual asset files retain their existing limits.

Optional `wordCountVisible` applies a word-count default when the theme is selected. Use `true` to show it, `false` to hide it, or omit it to keep the current choice. Manual changes persist with the notebook. The Visual editor exposes this as **Default word count**.
