# Theme system hardening

## Scope and acceptance

- Shared selected/hover colors and typography roles cover menus, navigation, tabs, compact titles, status text, and editor content. Existing theme files retain their appearance through defaults.
- Invalid built-in themes are isolated; an independent Default fallback and visible diagnostics keep startup usable. Strict build validation still rejects invalid shipped themes.
- Derived themes retain a validated original snapshot. Updating the original preserves only explicit modifications; resetting clears them. Portable snapshots continue to work without the original installed.
- Declarative theme controls expose bounded color, range, and toggle variables without executable code. Both native persistence and portable packages preserve them.
- Preview exercises all navigation layouts, outline visibility, compact title, selected/hovered menus, word count, and note elements. Advisory contrast/type checks never silently recolor a theme.
- A repository creator guide and starter package explain visual editing, CSS limits, controls, updates, validation, sharing, and recovery.

## Verification

Focused schema/runtime/recovery/rebase/editor tests; full frontend tests, lint, production build, Rust theme tests and native build; browser visual inspection of representative themes and preview states. Review diffs for validation parity, compatibility, accidental scope expansion, and failure paths before publication.

## Milestones

1. Theme roles and resilient loading.
2. Derivation, controls, authoring preview/checker.
3. Creator guide, validation, review, publication.

## Completion — September 20, 2026

All three milestones implemented. Creator documentation lives in `docs/themes/creator-guide.md`, linked from the repository README and API reference. The Quiet Paper starter package and `npm run theme:check` cover the external-editor workflow.

Verification: 403 frontend tests across 49 files; ESLint; TypeScript/frontend production build; two native theme persistence/normalization tests; macOS Tauri app bundle. Expected existing warnings: Vite's large chunk and the non-failing Tiptap task-list TextSelection diagnostic. No Windows native build was run.

Browser checks: Adventure Quest dark/light, single/dual-with-sections preview, expanded preview, outline/menu/compact-title controls; actual Old Basement PC selected menu colors and status/title sizes; Starfall Plasma preview and artwork toggle; Default-derived preview. Measured Adventure Quest menu foreground matches selected notes, compact title 20 px and status 18 px. Fixed the live editor's unqualified packaged-font name, which previously made it differ from the preview. A stale Vite optimization cache encountered during testing was cleared; the CLI validator now has a separate cache.

Review repairs included legacy original-ID/snapshot consistency, control deletions during updates, bounded snapshot/package sizes, automatic color inheritance on blur, duplicated CSS in the license section, and preserving pending control definitions. Creator-guide relative links and valid/invalid CLI inputs checked. Contrast warnings remain advisory for custom CSS, artwork and transparent surfaces. Publication uses the existing `proper-theme-support` branch and PR #1.
