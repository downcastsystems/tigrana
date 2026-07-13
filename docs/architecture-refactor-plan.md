# Architecture Refactor Plan

This plan implements the July 2026 architecture review while preserving Tigrana's core promise: a beautiful writing environment whose durable content remains ordinary Markdown files and folders.

## Design constraints

- Keep Markdown readable outside Tigrana.
- Keep the Notebook folder as the source of truth.
- Prefer a few deep modules over many shallow pass-through modules.
- Make each deep module's interface its primary test surface.
- Keep React focused on view state and rendering.
- Keep Tauri commands as narrow adapters.
- Preserve browser/demo mode, but make its limitations explicit.
- Refactor in behavior-preserving slices that remain releasable.

## Implementation order

The order follows dependency and risk, not recommendation strength. Pure content modules go first so later concurrency and storage changes build on tested behavior.

### 1. Deepen the Note document module

Concentrate frontmatter parsing, validation, body composition, outline, preview, text stats, and normalization in one coherent Note document implementation.

Done when:

- Callers no longer assemble Note document behavior from unrelated helpers.
- Malformed frontmatter and Markdown round trips have interface tests.
- App consumes coherent Note document values for editor load, raw Markdown, outline, preview, properties, and export.

### 2. Unify Markdown round-trip policy

Concentrate readable Markdown rules used by whole-Note persistence, selected-fragment copy, paste, and export.

Done when:

- Whole-Note and clipboard adapters reuse one policy for supported blocks and marks.
- Every supported Markdown shape has round-trip fixtures.
- Adding a block type requires changing one policy implementation.

### 3. Separate Native and demo storage adapters

Select the storage adapter once and keep Native notebook storage behavior separate from the browser/demo implementation. Move menu, export, preferences, and window behavior out of the storage module.

Done when:

- Two adapters satisfy one storage interface.
- Demo limitations are explicit rather than silent no-ops.
- Shared interface tests cover both adapters where their capabilities overlap.
- Callers do not branch on Tauri availability for storage behavior.

### 4. Deepen Notebook path mutation

Concentrate rename and move invariants so durable files, backlinks, the Link index, Notebook metadata, open tabs, active selection, edit locks, and caches cannot drift independently.

Done when:

- Native notebook storage owns every durable consequence and recovery policy.
- React consumes a completed mutation outcome for ephemeral repair.
- Rename and move tests assert the physical tree, Markdown links, stable identities, Link index, Notebook metadata, and session paths together.
- Partial failures never masquerade as a fully failed or fully successful mutation.

### 5. Consolidate the active Note lifecycle

Move Note loading, editing, saving, lock ownership, watcher reconciliation, accepted-disk tracking, and position persistence behind one deep seam.

Done when:

- App retains view state and rendering rather than storage ordering rules.
- Open, create, duplicate, restore, save, and external-change flows share one lifecycle implementation.
- Interface tests cover stale loads, overlapping saves, rename during save, watcher echoes, external changes, and lock denial.

### 6. Streamline and document

Apply the deletion test to remaining helpers, remove pass-through modules, reduce App and NotesEditor orchestration, and update architecture documentation.

Done when:

- Shallow pass-through helpers are deleted or absorbed.
- Domain terms in `CONTEXT.md` match the implemented deep modules.
- `npm run test`, `npm run lint`, `npm run build`, and the native app build pass.
- The app remains calm, responsive, and file-native in light and dark mode.

## Working method

For each phase:

1. Add characterization or interface tests.
2. Move behavior behind the target seam.
3. Migrate callers without changing product behavior.
4. Delete superseded helpers and duplicated policy.
5. Run focused tests, lint, and build before continuing.

## Progress

- [x] Deepen the Note document module
- [x] Unify Markdown round-trip policy
- [ ] Separate Native and demo storage adapters
- [ ] Deepen Notebook path mutation
- [ ] Consolidate the active Note lifecycle
- [ ] Streamline and document
