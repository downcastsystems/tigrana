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
