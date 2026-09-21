# Theme foundation verification

Verified September 18, 2026.

## Automated checks

- Full frontend suite: 335 tests across 44 files. Includes the 15 editor
  performance regressions, notebook navigation/persistence, shared-theme
  reconciliation, draft cancellation, attributed-theme copying, and preview state.
- Theme foundation tests cover legacy/extended JSON and ZIP round trips,
  source-folder ZIPs, scoped selectors, local assets, unsupported CSS and remote
  resources, incompatible versions, malformed metrics, unsafe archive paths,
  unexpected files, and expansion limits.
- Rust suite: 24 tests, including native theme normalization, version 2 persistence
  and compare-and-swap behavior.
- ESLint, frontend production build, and macOS Tauri app bundle pass. The existing
  Vite large-chunk warning remains.

## Browser visual and interaction checks

Checked in the local browser demo, without modifying a native notebook:

| Surface | Coverage |
| --- | --- |
| Preview | Light/dark with standard/Plasma; mode-specific CSS; active/inactive tabs; note title; headings; links; lists/tasks; quote/code/table and sample controls present |
| Isolation | Draft CSS changes preview without changing the notebook; Settings stays outside creator CSS |
| Applied theme | Saved custom CSS changes the live note title and tabs; notebook panes retain Plasma rendering |
| Navigation/editor | Rich editor, raw Markdown, outline, properties, empty frontmatter panel, editor options, note context menu |
| Search | Search overlay, filters, recent-note result and preview remain readable |
| Recovery | Applied `:scope { display: none; }`, confirmed both notebook regions hidden, then Cmd+Option+Shift+T restored default appearance and removed creator CSS |
| Default | Restored dark standard appearance renders normally |

The component preview uses production styles in a ShadowRoot and representative
editor DOM. It is not a second Tiptap editor. Its controls do not perform notebook
operations. The automated editor suite verifies editing behavior separately.

## Limits of this pass

This is representative coverage, not a claim that every visual state has been
manually inspected. Native macOS packaging was verified, but native window chrome,
Windows rendering, all navigation/width combinations, every dialog, populated
frontmatter, drag states, and image/font asset rendering need release QA on their
target platforms. Asset transport/validation is covered by unit tests. Browser
checks are recorded above; no pixel-baseline regression suite was introduced.

Gallery hosting and personal CSS snippets remain outside this foundation phase.

## Font emphasis — September 20, 2026

- Reproduced Typewriter's invisible bold and italic in the browser demo. Cmd+B and Cmd+I created the correct marks, but inherited `font-synthesis: none` prevented its regular-only font from displaying them.
- Enabled weight/style synthesis for note content. Verified visible bold, italic, combined emphasis, strike, code and highlighting with production CSS and packaged fonts across all 16 built-in themes in both modes.
- Checked Typewriter's keyboard commands, saved Markdown and theme editor preview. UI font synthesis remains unchanged.
- Markdown/editor tests: 71 passed. Built-in theme tests: 21 passed. Lint and production build passed, with the existing bundle-size warning. This rendering check used the browser; native Windows rendering was not tested.

## Authoring hardening — September 20, 2026

- 403 frontend tests across 49 files pass, plus lint, TypeScript/production build, native theme tests (2), and the macOS app bundle.
- New regressions cover original snapshots, three-way updates, removed controls, invalid updates, legacy copies, export limits, typography/interaction roles, startup fallback, preview layouts, and automatic color inheritance.
- Browser inspection covered Adventure Quest light/dark and menu/compact-title states, actual Old Basement PC menus/status, Starfall Plasma/artwork control, and Default-derived preview. The live editor now resolves packaged fonts exactly as the preview does.
- `npm run theme:check` validated the source starter, starter export, Starfall and Adventure Quest packages; an invalid schema exited with failure. The starter's secondary text was adjusted to clear the contrast check.
- Windows native execution was not tested. Palette checks do not measure contrast after custom CSS, image compositing or Plasma effects. The usual Vite large-chunk warning and non-failing Tiptap task-list diagnostic remain.
