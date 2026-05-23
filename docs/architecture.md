# Architecture

Tigrana is local-first and file-native. The source of truth is a user-selected
folder containing Markdown files. The app may cache indexes or UI state, but it
must be able to rebuild those artifacts from the folder.

## Frontend

- Vite
- React
- Tiptap
- Fuse.js for the browser-demo search path

The frontend owns the writing experience, note tree rendering, command palette,
slash menu, and editor interactions.

## Desktop Backend

- Tauri 2
- Rust commands for trusted filesystem access
- Future SQLite FTS5 index under `.tigrana/search.sqlite`

The backend owns file reads and writes, workspace validation, asset writes, native
folder picking, file watching, and packaging.

## File Contract

The app should only write:

- Markdown note files selected or created by the user
- Attachment files under `.assets`
- Disposable app state under `.tigrana`

The hidden `.tigrana` directory must never become the canonical note store.

## Editor Contract

The editor uses Tiptap internally but persists Markdown. Any new block type must
round-trip to readable Markdown before it is accepted into the core product.

Current supported Markdown shapes:

- Paragraphs
- Headings 1-3
- Bullet lists
- Numbered lists
- Task lists
- Blockquotes
- Code blocks
- Horizontal rules
- Links
- Images

## Search Plan

The current frontend search is suitable for the browser demo. The production
desktop path should use SQLite FTS5 from the Tauri backend:

1. Scan the workspace for Markdown files.
2. Store path, title, normalized body, and modified time in SQLite.
3. Use FTS5 for content search.
4. Reindex changed files through a file watcher.
5. Treat the database as disposable and rebuildable.
