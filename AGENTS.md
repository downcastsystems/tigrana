# AGENTS.md

Guidance for AI agents working on this project.

## Project Summary

Tigrana is a local-first, file-native desktop notes app inspired by Notion, but intentionally limited to note-taking. The core promise is:

- Notes are ordinary Markdown files.
- Folders on disk are the note hierarchy.
- App metadata is stored inside the notebook folder and moves with it.
- The app should feel simple, beautiful, and calm.

Do not add features that make Markdown unreadable outside the app unless explicitly requested.

## Stack

- Frontend: Vite, React, TypeScript
- Editor: Tiptap / ProseMirror
- Desktop shell: Tauri 2
- Backend: Rust Tauri commands in `src-tauri/src/main.rs`
- Search: currently frontend Fuse.js; planned native SQLite FTS5

## Important Paths

- `src/App.tsx`: main app state, layout, workspace/note/folder flows
- `src/editor/NotesEditor.tsx`: Tiptap editor, paste handling, slash command wiring
- `src/editor/slashCommands.ts`: slash command definitions
- `src/lib/notebookStorage.ts`: Native/demo Notebook storage interface and implementations
- `src/lib/activeNoteLifecycle.ts`: active Note loads, locks, save queues, and watcher reconciliation
- `src/lib/notebookPathMutations.ts`: ephemeral session repair after durable path mutations
- `src/lib/noteDocument.ts`: Note document parsing, validation, outline, preview, and stats
- `src/lib/markdown.ts`: Markdown-to-HTML and HTML-to-Markdown conversion
- `src/lib/desktop.ts`: window, menu, preferences, export, and print behavior
- `src/styles/app.css`: global app styling, light/dark themes
- `src-tauri/src/main.rs`: native filesystem commands
- `src-tauri/capabilities/default.json`: Tauri permissions
- `docs/architecture.md`: architecture notes

## Notebook File Contract

Notebook folders should look like:

```text
Notebook/
  Note.md
  Folder/
    Another Note.md
    .tigrana/
      folder.json
  .assets/
    pasted-image.png
  .tigrana/
    metadata.json
    index.json
```

Durable content:

- Markdown notes: `*.md`
- Folders: hierarchy
- Attachments: `.assets/`
- App metadata: `.tigrana/metadata.json`
- Link index cache: `.tigrana/index.json`
- Per-folder identity: `<folder>/.tigrana/folder.json` (non-root folders only)

Hidden app folders are excluded from note/folder scans:

- `.tigrana`
- `.assets`

## Stable identity and link index

Every note and folder has a UUID that travels with it so links survive moves
and renames.

- **Notes** carry `id: <uuid>` in YAML frontmatter at the top of the file.
  Minted on workspace open if missing.
- **Folders** carry a sidecar `<folder>/.tigrana/folder.json` with `{ id }`.
- `.tigrana/index.json` is the authoritative link cache: `notesById`,
  `foldersById`, `pathToId`, `outbound`, `inbound`. It is rebuildable from
  the frontmatter/sidecar ids and the markdown contents.

`move_note`, `rename_note`, `move_folder`, and `rename_folder` rewrite every
inbound link occurrence to the moved target (or its descendants, for folder
moves) and update the path snapshots in the index. Source notes are picked
up via `inbound[targetId]`, so the rewrite cost is O(backlinks), not
O(workspace).

Link hrefs on disk stay path-based (`[Title](Folder/Note.md)`) so notes
remain readable outside the app — the id is only used at runtime to identify
which target a link points at.

## Metadata

Workspace metadata is stored in `.tigrana/metadata.json` via Tauri commands:

- `read_workspace_metadata`
- `write_workspace_metadata`

The TypeScript shape is `WorkspaceMetadata` in `src/types.ts`:

```ts
{
  folderOrder: Record<string, string[]>;
  noteOrder: Record<string, string[]>;
  pinnedNotes: Record<string, boolean>;
  folderIcons: Record<string, string>;
  folderColors: Record<string, string>;
  noteIcons: Record<string, string>;
}
```

Lucide icon values use the portable token format `lucide:IconName`, for example `lucide:FileText`. Older plain-text or emoji icon values should still render as fallback custom marks.

Browser/demo mode falls back to localStorage, but native app behavior should use the notebook JSON file.

## Note Creation Model

New notes should behave like Notion:

- Clicking New Note opens a blank note screen immediately.
- The title is typed into the note title field, not a prompt/modal.
- The filename is derived from the title only when saved.
- Invalid filename characters are rejected:
  - `\ : * ? " < > |`
  - Note that there is a special handling for '/' so that it can be used in titles.
- Duplicate note titles in the same folder are rejected.

Do not reintroduce `window.prompt()` for note creation.

## Folder/Sidebar Model

The app uses:

- left folder pane
- left notes pane for the selected folder
- center editor
- optional right outline pane

Expected behaviors:

- Folders can contain subfolders.
- Notes are shown for the selected folder.
- Notes can be pinned to the top of that folder.
- Notes can be drag-reordered within a folder.
- Notes can be dragged into folders.
- Folders can be dragged to reorder or move.
- Folder icons/colors and note icons are stored in notebook metadata.
- Left panes can be toggled.
- Right outline pane can be toggled.
- Right-click context menus should be app-specific, not browser defaults.

## Editor Rules

The editor uses Tiptap internally but persists Markdown.

Critical rule: avoid feeding the editor its own serialized Markdown back into `setContent` on every keystroke. That causes cursor jumps, broken list behavior, and odd slash-command behavior. Only reload editor content when switching notes.

Slash commands should use Tiptap commands, not Markdown text insertion. For example, headings should call `setHeading`, not insert `#`.

Clipboard image paste should save assets through the Tauri backend and insert Markdown-compatible image references.

## Markdown Support

Current conversion support in `src/lib/markdown.ts`:

- paragraphs
- headings 1-3
- bullet lists
- numbered lists
- task lists
- blockquotes
- code blocks
- dividers
- links
- images

If you add a block type, make sure it round-trips cleanly to readable Markdown.

## Commands

Install:

```bash
npm install
```

Frontend dev:

```bash
npm run dev
```

Native Tauri dev:

```bash
npm run tauri -- dev
```

Build frontend:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

Build macOS app bundle:

```bash
npm run tauri -- build --bundles app
```

The `.app` bundle is produced at:

```text
src-tauri/target/release/bundle/macos/Tigrana.app
```

## Verification Expectations

For meaningful changes, run:

```bash
npm run lint
npm run build
```

For Tauri/Rust or filesystem-command changes, also run:

```bash
npm run tauri -- build --bundles app
```

Known warning: Vite may warn that the bundle is over 500 kB. That is acceptable for now.

## Tauri Notes

Rust/Tauri are installed via Homebrew in the current development environment.

Open-folder dialogs require the permission in:

```text
src-tauri/capabilities/default.json
```

Do not remove `dialog:allow-open`; doing so breaks folder picking.

The placeholder app icon is:

```text
src-tauri/icons/icon.png
```

It must remain a valid PNG or Tauri dev mode can panic at startup.

## Design Direction

The UI should stay quiet and note-focused:

- restrained visual style
- dense but readable panes
- no marketing/landing page
- no decorative bloat
- no UI cards inside cards
- light and dark mode both supported

The app is meant to be simpler than Obsidian and less cloud/productivity-suite-like than Notion.

## Future Work

Good next steps:

- Move search to native SQLite FTS5.
- Add file watching and background reindexing.
- Expand Markdown round-trip fixtures when adding editor shapes.
- Add real app icons and signing.
- Improve context menus and confirmation flows for destructive actions.

## User Artifact Preference

Use a dark-mode theme by default for generated artifacts, including HTML reports, dashboards, diagrams, presentations, and documents. Use another theme only when the user explicitly requests it.
