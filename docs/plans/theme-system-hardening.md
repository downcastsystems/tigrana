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
