# Theme foundation

Scope: preserve the default appearance and Plasma; add supported styling tokens,
scoped optional CSS, portable packages, creator metadata, a representative
component preview, and a recovery path. Gallery hosting and personal snippets are
follow-up work.

Acceptance checks:
- Legacy JSON themes remain readable; extended themes survive native and demo
  persistence, export/import, notebook reload, and shared-copy reconciliation.
- CSS is parsed, validated, and scoped; no remote resources, executable content,
  unsupported at-rules, or selectors that can reach recovery UI.
- Theme assets are bounded local raster images/fonts, transported with the theme.
- Creator controls preview without changing the notebook; attributed themes become
  personal copies when edited.
- Stable tokens and hooks cover chrome, navigation, editor blocks, and controls.
- Preview includes tabs, headings, lists/tasks, tables, code, links, and controls.
- Recovery remains reachable regardless of theme styling.
- Verify representative light/dark × standard/Plasma states, major interaction
  surfaces, import/export and malformed input, editor performance, lint, frontend
  build, Rust tests, and native build. Record actual coverage and limitations.

Implementation complete. Public API and package authoring instructions are in
`docs/themes/README.md`; actual verification coverage and remaining platform QA
are recorded in `docs/themes/verification.md`. Installed themes remain atomic JSON
snapshots; ZIP packages are the sharing format. This preserves existing notebook
and library reconciliation rather than introducing a second mutable file source.
