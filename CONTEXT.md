# Tigrana Context

Domain language for Tigrana, a local-first, file-native desktop notes app whose durable content remains ordinary Markdown files and folders.

## Language

**Notebook**:
A user-selected folder that is the source of truth for notes, folders, attachments, and Tigrana metadata.
_Avoid_: Workspace, vault, project

**Note**:
An ordinary Markdown file inside a notebook.
_Avoid_: Page, document

**Note document**:
The parsed representation of a note's Markdown content, including frontmatter, body text, validation state, outline, preview, and text stats.
_Avoid_: Editor state, ProseMirror document

**Folder**:
A directory inside a notebook that participates in the note hierarchy.
_Avoid_: Section, collection

**Notebook path mutation**:
A note or folder rename or move whose path change must be reflected across durable files, link index entries, metadata, open tabs, active selection, and edit locks.
_Avoid_: File rename, move handler, path patch

**Link index**:
The rebuildable `.tigrana/index.json` cache that maps stable note and folder identities to paths and backlink relationships.
_Avoid_: Search index, graph database

**Notebook metadata**:
The `.tigrana/metadata.json` file that stores app state tied to the notebook, such as ordering, pins, icons, bookmarks, expansion state, and note positions.
_Avoid_: Preferences, settings

**Native notebook storage**:
The Rust-side storage boundary that validates notebook paths, reads and writes durable note files, maintains stable identities and link indexes, manages note history/trash/assets, and exposes narrow Tauri command adapters to React.
_Avoid_: Backend blob, filesystem helpers, Tauri handlers
