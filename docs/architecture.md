# Architecture

Tigrana is local-first and file-native. A user-selected Notebook is the source
of truth. Markdown Notes, Folders, Notebook assets, and stable identities move
with that Notebook; every index is rebuildable.

The architecture favors a small number of deep modules. React renders the
writing experience and holds ephemeral view state. The modules below own the
rules that must remain consistent across UI flows.

## Frontend modules

| Module | Interface | Implementation responsibility |
| --- | --- | --- |
| `noteDocument.ts` | Read, create, revise, and measure a Note document | Frontmatter, body composition, validation, outline, preview, stats, and persistence normalization |
| `useNoteTextStats.ts` | Live Note word and character counts | Debounces edits, discards stale results, and moves whole-Note text measurement to a web worker |
| `useNoteOutline.ts` | Live Note outline | Computes immediately on Note switches, then defers edits and skips work while the outline is hidden |
| `deferredCommit.ts` | Flushable idle work | Keeps whole-document serialization off the input transaction while allowing navigation and shutdown to flush synchronously |
| `pendingNoteContents.ts` | In-flight autosave content | Keeps navigation ahead of disk without publishing save-start updates through React and preserves newer drafts across older save completions |
| `markdown.ts` | Convert readable Markdown and editor HTML | One round-trip policy shared by Note persistence and clipboard fragments |
| `notebookStorage.ts` | `NotebookStorage` | Selects one Native or demo adapter and exposes explicit capability differences |
| `activeNoteLifecycle.ts` | `ActiveNoteLifecycle` | Load generations, edit-lock ownership, accepted-disk baselines, save queues, latest-request persistence, and serialized path changes |
| `notebookPathMutations.ts` | Completed Note/Folder move and rename operations | Repairs ephemeral tabs, selection, active lock paths, and React metadata after Native storage commits |
| `desktop.ts` | Desktop behavior | Menus, windows, preferences, export, print, external links, and Tauri detection |

`App.tsx` composes these interfaces with view state. It should not duplicate
their persistence, concurrency, or conversion rules.

## Notebook storage adapters

The storage adapter is selected once when the frontend starts.

- The Native implementation invokes narrow Tauri commands. It supports durable
  Link indexes, Note history, Recently Deleted, file watching, and atomic
  Notebook path mutation repair.
- The demo implementation persists Notes, Folders, and Notebook metadata in
  browser storage. Its missing capabilities are declared on the interface,
  including Note history, Recently Deleted, file watching, and durable Link
  indexing.

Desktop behavior is intentionally outside the storage interface. Exporting a
file or focusing a window is not Notebook persistence.

## Native notebook storage

Rust is organized by durable concern:

- `notebook_storage.rs`: Note and Folder lifecycle plus path-mutation commit and
  recovery.
- `notebook_metadata.rs`: Notebook metadata representation, path repair, and
  atomic writes.
- `link_index.rs`: stable identities, Markdown link parsing, backlink repair,
  and Link index writes.
- `note_history.rs`, `trash.rs`, and `assets.rs`: Note history, Recently
  Deleted, and Notebook assets.
- `notebook_paths.rs`: trusted Notebook path validation.
- `notebook_write_coordinator.rs`: per-Notebook serialization for durable
  writes that share Note paths, metadata, history, trash state, or the Link
  index.
- `main.rs`: narrow Tauri command adapters and desktop integration.

Tauri commands should translate input and delegate. Durable rules belong in
the modules above, where they can be tested without a webview.

Notebook writes are serialized by canonical Notebook path. Lock contention
and filesystem work both run on Tauri's blocking pool, so a save cannot overlap
a move or lose another Note's Link index update, and waiting never occupies the
webview command executor. Note replacement is atomic, and Native Note reads use
the same lane so they cannot observe a partial save. Different Notebooks keep
independent write lanes.

## Notebook path mutation

A Native Note or Folder rename/move is planned and committed as one mutation:

1. Ensure the target and descendants have stable identities.
2. Rename the physical Note or Folder.
3. Plan every backlink rewrite and the next Link index in memory.
4. Repair Notebook metadata in memory.
5. Atomically replace affected Markdown files, the Link index, and Notebook
   metadata.
6. If a commit write fails, restore original Markdown, the original path, the
   prior Link index, and prior Notebook metadata. An incomplete rollback is
   reported explicitly as requiring recovery.
7. Repair Native edit-lock owner paths, then return the completed path to
   React for ephemeral session repair.

Frontend Notebook metadata writes and Native path mutations share a
per-Notebook queue. The queue retains idempotent metadata updaters rather than
stale whole snapshots, coalesces deferred Note-position updates, and replays
pending intent after a conflict or path repair. Path mutations translate both
optimistic metadata and queued path-scoped updaters to the committed path, so
a later write cannot restore the old path.

Notebook metadata also carries a monotonic `revision`. Native whole-snapshot
writes use compare-and-swap under the Native Notebook write lane. If another
window or a path mutation has advanced the revision, the stale snapshot is not
written; pending semantic updates are replayed over the newer durable metadata
and retried with its revision.

Folder mutations capture all inbound sources before rewriting anything. This
prevents an intermediate parent-path rewrite from temporarily breaking a
descendant edge and hiding a backlink that still needs repair.

## File contract

Tigrana writes only:

- Markdown Note files selected or created by the user.
- Attachment files under `.assets/`.
- Rebuildable or app-specific state under `.tigrana/`.

The hidden `.tigrana` directory never becomes the canonical Note store.

## Editor and Markdown contract

Tiptap is an implementation detail; persisted content is readable Markdown.
The editor receives a Note's content only when switching or explicitly
reloading that Note, never as an echo of each keystroke.

Every supported shape has round-trip fixtures. A new editor shape is accepted
only after `markdown.ts` can round-trip it without making the Note unreadable
outside Tigrana. Clipboard fragment serialization uses the same conversion
policy as whole-Note persistence.

Derived Note values are lazy. Sidebar previews are memoized by Note content,
whole-Note text statistics run off the main thread, and outline extraction is
deferred until typing is idle. Markdown serialization is also deferred, but
navigation, raw-mode entry, export, printing, external-change reconciliation,
and window shutdown flush the pending editor snapshot before continuing.

The hot typing path must remain local to ProseMirror. Native webview
spellchecking handles incremental spelling feedback; cursor and scroll
positions update refs and persist after idle without changing workspace React
state. Image hydration runs when a Note loads or an image is inserted, not in
response to the editor's own serialized Markdown.

Autosave must be invisible to input. Starting a save stages content outside
React rather than replacing the workspace content cache. Save completion and
filesystem-watcher echo updates are transitions, and the Link index is reread
only when Backlinks is visible. Native Note reads and saves, metadata writes,
and Link index reads are async Tauri commands whose blocking filesystem and
history/index work runs on the blocking worker pool instead of the webview
command executor.

## Search plan

The current frontend Fuse.js search supports the demo. Native search can move
to a disposable SQLite FTS5 index under `.tigrana/search.sqlite`:

1. Scan Markdown Notes.
2. Store stable identity, path, title, normalized body, and modified time.
3. Query content through FTS5.
4. Reindex filesystem changes in the background.
5. Rebuild the database whenever its schema or contents are invalid.
