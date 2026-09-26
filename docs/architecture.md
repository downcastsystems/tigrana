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
| `draftSaveRevisions.ts` | Active Note draft/save revisions | Requests a follow-up save when a completed write is older than the current draft while avoiding duplicate requests and stale Note generations |
| `markdown.ts` | Convert readable Markdown and editor HTML | One round-trip policy shared by Note persistence and clipboard fragments |
| `notebookStorage.ts` | `NotebookStorage` | Selects one Native or demo adapter and exposes explicit capability differences |
| `notebookSnapshot.ts` | Latest-request Notebook refresh | Rejects stale and inactive refresh results before React state is replaced |
| `notebookMetadataSession.ts` | Workspace-scoped metadata ownership | Prevents delayed work or pre-load settings changes from reading or writing another Notebook's metadata |
| `responsivePanes.ts` / `useResponsivePanes.ts` | Editor-first pane visibility | Reserves 520 CSS pixels for the editor, hides the right then left panes, and restores chosen visibility without changing Notebook metadata; narrow-window toggles open temporary overlays |
| `useSidebarOverlay.ts` | Collapsed sidebar previews | Hovering within 28 px of the left edge charges at a rate ranging from 1 second at the inner boundary to 250 ms at the edge. Movement preserves accumulated progress and changes only the remaining charge rate. Either sidebar toggle uses a fixed 1 second delay. Hovering builds an accent-colored edge glow, then opens a temporary overlay without reflow; the right edge never triggers a preview so the scrollbar stays usable. The glow cancels on hover exit and stays faint and static with reduced motion. Modal dialogs cancel pending or open previews and block new hover previews until dismissed. Leaving dismisses the overlay after 300 ms with a 180 ms slide in/out, respecting reduced motion, while Keep open explicitly docks it when space permits |
| `notebookAppearance.ts` | Authoritative appearance adoption | Resolves legacy/partial values and updates metadata plus every mirrored appearance value through one seam |
| `activeNoteLifecycle.ts` | `ActiveNoteLifecycle` | Load/navigation generations, serialized edit-lock transitions, accepted-disk baselines, save queues, latest-request persistence, and serialized path changes |
| `notebookPathMutations.ts` | Completed Note/Folder move and rename operations | Repairs ephemeral tabs, selection, active lock paths, and React metadata after Native storage commits |
| `desktop.ts` | Desktop behavior | Menus, windows, preferences, export, print, external links, and Tauri detection |

`App.tsx` composes these interfaces with view state. It should not duplicate
their persistence, concurrency, or conversion rules.

### UI ownership and change locations

`App.tsx` owns Notebook orchestration: active selection, save/navigation ordering,
metadata adoption, and durable mutation callbacks. Views receive data and callbacks;
they do not import `App.tsx` or create another save queue. Keeping that ordering in
one place avoids splitting a Note move, title save, and editor flush across hooks
whose effects can race.

| Change | Owning files |
| --- | --- |
| Folder navigation layouts | `components/navigation/FolderPane.tsx`, `SectionViewFolderPane.tsx`, `UnifiedTreePane.tsx` |
| Note previews, bookmarks, and creation menus | `components/navigation/NotesPane.tsx`, `BookmarksSection.tsx`, `PaneCreateMenu.tsx` |
| Navigation targets and shared drag/menu types | `lib/notebookNavigation.ts` |
| Tab rendering and overflow | `components/NoteTabs.tsx` |
| Editor heading, empty state, and error fallback | `components/NoteSurface.tsx` |
| Outline, Backlinks, frontmatter, and properties | `components/NoteDetailsSidebar.tsx` |
| Context menus, moves, Folder properties, and icons | `components/NotebookContextMenu.tsx`, `MoveDialog.tsx`, `NotebookPropertyDialog.tsx`, `IconBrowser.tsx` |
| Recently Deleted and Note history dialogs | `components/RecentlyDeletedDialog.tsx`, `VersionHistoryDialog.tsx` |
| Emoji, link, image, and dictation dialogs | `components/insertion/` |
| Recent Notebooks, launch targets, and saved tabs | `lib/notebookSession.ts` |
| Stored desktop window placement | `lib/windowGeometry.ts` |

Local interaction state stays inside the view that owns it, including menu focus,
tab overflow, picker searches, and dictation. Durable actions still return to the
existing Notebook orchestration. Component tests import their owning view directly;
App integration tests cover navigation and mutation ordering with those views
composed together.

Sidebar shortcuts follow their left-to-right positions on a US keyboard:
Command+/ toggles the left sidebar, and Command+\ toggles the right sidebar.
Control+/ and Control+\ perform the same actions. Native menu accelerators,
button tooltips, and frontend key handling must use this mapping together.
The macOS Control+/ event monitor also targets the left sidebar; it consumes
that key before WebKit's native text-editing behavior can handle it.

### Editor ownership

`editor/editorContract.ts` is the shared type contract for commands, editor props,
pending changes, and persistence capture. App and editor code use the same command
union. Importing these types does not load the editor implementation.

`NotesEditor.tsx` owns the stable editor instance, deferred serialization, Note
switches, history, and command routing. Its extensions keep their implementation
details in feature modules:

- `tableControls.ts` owns table node views, row/column menus, resizing, and cell attributes.
- `codeBlock.tsx` owns syntax highlighting and code-block controls.
- `editorImages.tsx` owns image node views, clipboard assets, and preview hydration.
- `searchHighlight.ts` owns match discovery, decorations, and match scrolling.
- `textExtensions.ts` owns emoji input rules, manual spacing, and list separators.

These modules do not import `NotesEditor.tsx`. Extension configuration remains in
the editor's existing memoized initialization. Moving a feature into a module must
not add transaction subscriptions, React updates, or Markdown conversions. Use
the real-editor performance tests to verify that short and long Notes retain the
same deferred work counts, editor identity, Undo history, and stale-update rejection.

## Notebook storage adapters

The storage adapter is selected once when the frontend starts.

- The Native implementation invokes narrow Tauri commands. It supports durable
  Link indexes, Note history, Recently Deleted, file watching, and atomic
  Notebook path mutation repair. A refresh returns Folders, Notes, Note
  contents, and the Link index as one coordinated snapshot rather than joining
  separately timed reads in React. Link-index maintenance is best-effort for a
  refresh, so a read-only Notebook remains readable with a temporarily absent
  index.
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

Notebook writes and consistency-sensitive reads are serialized by canonical
Notebook path. Lock contention and filesystem work both run on Tauri's
blocking pool, so a save cannot overlap a move or lose another Note's Link
index update, and waiting never occupies the webview command executor. Note
replacement is atomic, and Native Note, snapshot, history, and Recently Deleted
reads use the same lane so they cannot observe partial writes. Different
Notebooks keep independent write lanes.

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

User-requested moves and Folder renames pass through `withSavedEditor` before
starting the Native mutation. The editor captures pending transactions and
unobserved accessibility DOM replacements, then input is held read-only until
saving, path repair, and refresh finish. Save failures abort the operation and
leave the draft open for retry. Saving a pending title can rename the source;
the move resolves the resulting active path instead of using the old filename.
The internal title-save rename bypasses this outer guard to avoid waiting on
its own persistence request. `src/App.move.test.tsx` exercises these flows with
the real editor and isolated storage.

Frontend Notebook metadata writes and Native path mutations share a
per-Notebook queue. The queue retains idempotent metadata updaters rather than
stale whole snapshots, coalesces deferred Note-position updates, and replays
pending intent after a conflict or path repair. Path mutations translate both
optimistic metadata and queued path-scoped updaters to the committed path, so
a later write cannot restore the old path.

Authoritative metadata remains scoped to the Notebook that produced it. A
delayed mutation may update that Notebook's queued state after the user
switches away, but it cannot replace the active Notebook's appearance,
selection, tabs, or metadata. Settings mutations are accepted only after the
active Notebook's metadata has loaded.

Creation timestamps are stored portably as `created_at` in each Note's YAML
frontmatter beside its stable `id`, so they travel with individual Markdown
files across Notebooks. Existing Notes are backfilled from the oldest
recoverable legacy metadata, filesystem, Note-history, prior-open, or bookmark
timestamp when first encountered. The legacy `noteCreatedAt` Notebook-metadata
map is read only as a migration fallback.

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

Underline uses inline HTML, `<u>text</u>`, because Markdown has no standard
underline delimiter. The formatting bar orders Bold, Italic, Underline, then
Strikethrough. Cmd+U on macOS or Ctrl+U on Windows toggles underline. Bare `<u>`
pairs round-trip in paragraphs, headings, lists and tables; code examples remain
literal. Markdown readers that disable HTML may not display underlining.

Text colors and colored highlights use portable inline spans, for example
`<span style="color: #a83232">text</span>` and
`<span style="background-color: #dcecdf">text</span>`. The formatting bar and
Edit menu share nine named choices from `src/lib/inlineColors.json`. The saved
hex values identify those choices; editor-only CSS variables supply readable
light/dark shades without rewriting the Note on a theme change. Other accepted
literal colors keep their exact value. Theme default text color and No highlight
remove their respective marks and span wrappers. The persistent toolbar has one color icon opening the combined text and highlight
palette. Theme default text color and No highlight independently reset each color. With a selection, actions format that range; at the cursor, they
set or clear formatting for subsequent typing without changing earlier text.
Text color continues through Enter; highlights end on Enter and soft line breaks.
Other marks retain their existing behavior. Legacy `==text==` highlights
continue to use the theme's default highlight colors and keyboard shortcut.
Only balanced spans containing approved literal color declarations are decoded
from Markdown; arbitrary HTML attributes and CSS stay escaped. Runtime color
attributes and variables are removed from saved Markdown and rich HTML tables.

Derived Note values are lazy. Sidebar previews are memoized by Note content,
whole-Note text statistics run off the main thread, and outline extraction is
deferred until typing is idle. Markdown serialization is also deferred, but
navigation, raw-mode entry, export, printing, external-change reconciliation,
and window shutdown flush the pending editor snapshot before continuing.

The move/rename capture reads the visible DOM using ProseMirror's node-view
parse rules, preserving task attributes and excluding table/code controls.
This internal parser adapter is covered by rich-content fixtures in
`NotesEditor.performance.test.tsx`; it must be rechecked when ProseMirror is
upgraded. It runs only at the explicit move/rename boundary, not on autosave.

The hot typing path must remain local to ProseMirror. Native webview
spellchecking handles incremental spelling feedback; cursor and scroll
positions update refs and persist after idle without changing workspace React
state. Image hydration runs when a Note loads or an image is inserted, not in
response to the editor's own serialized Markdown.

`src/editor/NotesEditor.performance.test.tsx` protects this path through the
public Note editor interface. A burst of editor transactions must cause no
parent render or whole-Note Markdown conversion until the deferred commit,
then exactly one of each. The editor instance must survive that Markdown echo,
and its Undo history must remain intact. The same bounded-work rule applies to
long Notes. Note switches and explicit external reloads cancel stale pending
updates without recreating the editor; explicit reloads reset stale Undo
history.

Autosave must be invisible to input. Starting a save stages content outside
React rather than replacing the workspace content cache. Save completion and
filesystem-watcher echo updates are transitions, and the Link index is reread
only when Backlinks is visible. Native Note reads and saves, metadata writes,
and Link index reads are async Tauri commands whose blocking filesystem and
history/index work runs on the blocking worker pool instead of the webview
command executor.

### Selection sorting

The floating formatting bar includes a Bullet Method sort button beside the list controls. It uses the same selection sort and saved status order as the native menu, and supports a single undo.

Edit > Sort Lines sorts the whole lines or sibling list items touched by the
rich-editor selection. A-Z and Z-A compare lowercase keys; the Case Sensitive
variants compare the original strings in Unicode order. Equal keys retain their
order. Nested lists stay with their parent item and selected sublists sort
independently. Inline formatting and task checkbox state travel with the content.

Bullet Method sorts by a leading, case-insensitive status followed by a colon:
CLOSED, DONE, TODO, IN PROGRESS, then unmarked text. Items within each status
retain their order. Selected sibling tasks carry continuation paragraphs unchanged and sort their nested lists recursively; headings separate groups. Use Edit > Sort Lines > Bullet
Method or Command+Option+period on macOS, Ctrl+Alt+period elsewhere. Like the
other sort commands, it sorts selected rich-editor text. With a collapsed cursor, Bullet Method instead sorts the outermost containing bullet, numbered, or task list and all its descendant lists, preserving item contents and the cursor’s position within its moved item. Outside a list it does nothing.

Ordinary bullet lists display Lucide status markers: circle-slash for CLOSED, circle-check for DONE,
circle for TODO, and circle-dot for IN PROGRESS. These ProseMirror decorations
follow the built-in status identities when renamed; custom and unrecognized
statuses retain ordinary bullets. Markers never enter saved HTML or Markdown.
Typing rechecks changed items and their ancestors rather than rescanning the Note.
Numbered lists and task checkboxes keep their existing markers. Marker buttons
cycle TODO → IN PROGRESS → DONE → CLOSED → TODO, replacing only the prefix
as one undoable edit. Removed statuses are skipped; custom statuses with icons
follow CLOSED in settings order. Circle icon choices are stored with each status
and can be changed in Settings > Bullet Method.

Settings > Bullet Method explains the workflow and lets users reorder statuses
(including No status) and add/remove prefixes. A fixed guide explains the default
statuses with examples; status meanings are not editable. Drag handles
use pointer events and hit testing, like bookmark/sidebar reordering, rather than
HTML drag/drop that native WebKit can intercept as a copy operation. Drop targets
show before/after placement; cancellation, window blur, and unmount clean up the
gesture without changing the order. Changes are
applied with Save changes; Restore defaults immediately restores the original
configuration. No status is permanent and catches unknown prefixes. Names must
be nonempty, unique ignoring case, and contain no colons or line breaks.
Renaming/removing a prefix never rewrites notes. Configuration is app-local in
`tigrana.bulletMethod.v1` localStorage and storage events synchronize open windows.
Invalid stored configuration falls back to defaults. The editor receives the
saved configuration without recreating its instance or reloading note content.

Tables sort selected body rows by the first column, keeping header rows fixed.
Tables containing merged cells are left unchanged. Sorting is disabled in raw
Markdown mode and for read-only Notes. The transformation in
`src/editor/sortLines.ts` runs only on command and creates one undoable edit,
without a Markdown serialization/reload cycle.

## Search plan

The current frontend Fuse.js search supports the demo. Native search can move
to a disposable SQLite FTS5 index under `.tigrana/search.sqlite`:

1. Scan Markdown Notes.
2. Store stable identity, path, title, normalized body, and modified time.
3. Query content through FTS5.
4. Reindex filesystem changes in the background.
5. Rebuild the database whenever its schema or contents are invalid.

### Portable themes

Settings separates Themes from General preferences. Themes includes theme selection
and experimental graphics settings. A theme is a versioned JSON
document with a stable ID, name, complete light and dark palettes, interface and
editor fonts and sizes, and a colored-title-bar preference. The builder previews
changes locally; Save and use validates the document, saves it to the shared
library, and queues the notebook metadata update through the existing revisioned
metadata persistence. Navigation and color-scheme selection remain separate preferences. Fonts use CSS family names and fall back to
fonts installed on the destination computer; font files are not embedded.

The notebook stores the full selected document at
`appearance.customTheme` inside `.tigrana/metadata.json`. Existing appearance
fields remain readable, and Create theme can capture their current appearance.
The shared library stores one `<theme-id>.json` file per theme in Tauri's
`app_data_dir()/themes`. On macOS this is normally
`~/Library/Application Support/systems.downcast.tigrana/themes`.
Browser demo mode uses a separate localStorage library.

`src/lib/themes.ts` validates imported files and compares normalized documents.
`src-tauri/src/themes.rs` validates native writes, constrains filenames to safe
IDs, locks the shared library, checks the expected previous document, and
replaces each file atomically. Invalid library entries are reported without
hiding valid themes. Unknown schema versions are rejected.

On notebook load, `ThemeReconciliation` compares the embedded snapshot with the
shared document of the same ID. A difference offers either replacement direction
or keeping the notebook copy for now. No timestamp wins automatically. A missing
shared theme can be added to the library. Keeping a notebook copy defers the
choice until the next open; it does not silently overwrite either copy. Shared
changes do not alter other open notebooks. Concurrent edits are rejected by the
library's compare-and-swap check.

Export shares a standalone JSON document. Import opens a validated draft for
preview before saving, retaining its ID unless a different shared theme already
uses that ID; that collision imports as a new copy. Files placed directly in the
library should use their document ID as the filename. Built-in themes are bundled
and remain available without library files.

Themes also carry optional `plasma` settings: `enabled`, `frost` from 0–100,
and `backgroundBlur` from 0–40. The builder previews and saves these together.
Older schema-version-1 files without this field retain the notebook's existing
Plasma preferences. LocalStorage preferences provide migration defaults for
notebooks without saved settings. The notebook snapshot is authoritative when
Plasma settings are present. Experimental appearance controls update the notebook
copy; editing and saving the theme updates the shared library. Differences are
reconciled after closing Settings or reopening the notebook.

### Theme API and packages

Extended themes use schema version 2 with a versioned `design` block. The
normalized library/notebook snapshot includes author metadata, metrics, CSS and
bounded embedded assets. A `.tigrana-theme` ZIP is an interchange format; storage
continues using the existing atomic JSON snapshots and CAS conflict resolution.
See [theme authoring](themes/README.md) for the public API, package contract,
recovery shortcut and deliberate CSS restrictions.

`themeCss.ts` parses all styles with CSSTree before application, rejects unsupported
nodes/resources, and scopes selectors to title-bar/notebook-frame regions. Styles
are layered beneath creator CSS. Settings suspends live creator styles. The
workbench uses a separate ShadowRoot and the production stylesheets; it does not
instantiate or mutate the user's editor. `ThemeStyles` only recompiles when the
theme or color scheme changes. Editor transaction behavior is unchanged.


Folder colors are stored per Notebook in
`folderColorsByNavigationStyle[style][folderPath]`, independently for
`single-pane`, `dual-pane`, and `section-view`. A missing Sections map reads
legacy `folderColors`; the other styles start without custom colors. An
explicit empty map preserves a reset without reviving legacy colors. Folder
moves and renames repair paths in every style, and deletion removes them.
Folder icons remain shared in `folderIcons`.

### Equations

Inline and block equation atoms retain LaTeX source in a `latex` attribute.
Markdown uses `$...$` and standalone `$$` fences; parsing protects formulas from
inline formatting and leaves code/currency literal. KaTeX renders only the
changed equation node, with trusted HTML disabled and expansion limits.
Ordinary typing does not rerender existing equations or publish dialog state.
The equation dialog previews examples and inserts/updates a single transaction;
Note replacement dismisses it to avoid applying stale ranges. HTML export emits
MathML without remote dependencies. See [the equation guide](equations.md).

### Notes and Story writing styles

Each document defaults to Notes. The editor options menu can set
`tigrana_writing_style: story` or `notes` in its YAML frontmatter. This travels
with the Markdown file and uses the existing active-note save queue. Width,
font, and line height remain independent appearance settings.

Settings → General → New Note Writing Style chooses Last used writing style
(the default), Notes, or Story. Opening a valid note or changing its writing
style remembers that style. The preference and last-used style belong to the notebook and are stored in
`.tigrana/metadata.json`, using the existing revision-checked metadata updates. New-note
creation resolves the preference before asynchronous work and passes the style
as initial Markdown content, so the placeholder has its style on its first
storage write. Existing notes and duplicates keep their own saved style.

Story uses first-line indentation for consecutive top-level prose paragraphs
and no extra paragraph margins. Opening paragraphs and paragraphs after a
heading, divider, or other block start flush left. Lists, quotes, code, and
tables keep their own rules. Enter creates a paragraph; Shift+Enter creates a
hard line break. An empty paragraph does not automatically create a scene break.
Use a divider for an explicit scene break.

Writing Style, Editor Width, and Editor Alignment are grouped at the bottom of
the editor options menu, with the current choice beneath each label. Manual
indentation works the same in both styles: each Tab adds indentation, and each
Shift+Tab removes one level, without a fixed limit. Backspace first removes an
active first-line indent, then performs its normal action on the next press. Overrides belong to one paragraph;
Enter resets the new paragraph to Automatic, including splits in the middle.

An explicit override is a ProseMirror paragraph attribute, serialized immediately
before the paragraph as `<!-- tigrana:paragraph indent -->` or
`<!-- tigrana:paragraph none -->`. Automatic paragraphs have no marker. These
HTML comments keep the prose readable in other Markdown tools, which may ignore
the layout. They avoid fragile paragraph-number metadata. Overrides remain stored
when switching to Notes but only affect Story layout. HTML export and printing
use the same Story rules. Plain Markdown export preserves the portable source.

Story handling stays local to the editor transaction; typing uses the existing
deferred serialization path. Regression coverage lives in
`storyParagraphs.test.ts`, `writingStyle.test.ts`, and the NotesEditor performance
tests, which exercise both styles for short and long typing bursts.

Bullet Method display preferences are stored separately in
`tigrana.bulletMethod.display.v1` and synchronized across windows. Both replacing
bullets and subtly dimming DONE/CLOSED paragraphs default on and can be toggled
independently. Dimming defaults to inherited text color at 65% alpha in light mode and 70% in dark mode, not element opacity,
so explicit text colors take precedence and nested tasks dim with a completed parent without accumulating extra dimming.
The COMPLETE prefix also dims its item and descendants.
The appearance decorations do not enter the saved Markdown.

The Bullet Method dimming slider adjusts the current rendering mode independently,
persisting whole percentages from 40 to 90. Status meanings live in a disclosure
that starts collapsed.

Bullet Method is opt-in. Its master switch defaults off, including for older saved
settings without an enabled flag. While off, the native sort menu entry and toolbar
button are omitted, sort commands are ignored, and all status decorations are
removed. The display controls and sort instructions appear only while enabled;
individual display choices remain saved when disabling the master switch.

Each status row has a Dim checkbox. Missing saved dim choices default to true
for DONE/CLOSED identities and false otherwise. Choices travel with a status
when renamed or reordered. Valid edits save automatically; invalid names remain
local until corrected. The dimming label lists the checked statuses live. Dim selected statuses
is the global dimming switch. Selecting No status dims unmatched/unmarked bullets.
COMPLETE uses the DONE choice unless configured as its own status.
