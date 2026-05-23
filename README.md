# Tigrana

A simple, beautiful, file-native desktop notes app.

Tigrana is a Notion-inspired note-taking app with a deliberately small scope:
write notes, organize them in a hierarchy, search them quickly, and keep the data as
ordinary folders and Markdown files.

## Product Principles

- Markdown files are the source of truth.
- Folder structure is the note hierarchy.
- App metadata and indexes are disposable.
- The editor should feel calm, fast, and joyful.
- Features that make Markdown unreadable elsewhere do not belong in the core app.

## Current MVP

- React and Tiptap editor surface
- Tauri project scaffold for macOS and Windows packaging
- Folder-backed note tree
- Create, read, edit, and autosave Markdown notes
- Markdown import/export for headings, lists, tasks, quotes, code, links, dividers, and images
- Slash command menu for common blocks
- Clipboard image paste path that saves assets through Tauri
- Fuzzy search across note title, path, and cached content
- Browser demo fallback using localStorage when the Tauri shell is not available

## Workspace Format

```text
My Notes/
  Inbox.md
  Projects/
    Tigrana.md
  .assets/
    pasted-image.png
  .tigrana/
    settings.json
    search.sqlite
```

Markdown files are the durable data. The `.tigrana` directory is reserved for local
indexes and UI state. The `.assets` directory stores pasted images and other binary
attachments.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:1420/` for the browser demo.

To run the native desktop shell:

```bash
npm run tauri dev
```

The native shell requires Rust and the Tauri prerequisites for your platform.

## Verification

```bash
npm run lint
npm run build
```

## Roadmap

- Replace the browser-only Fuse search with a Tauri-side SQLite FTS5 index.
- Add file watching and background reindexing.
- Add rename, move, and delete operations for notes and folders.
- Add robust Markdown round-trip tests.
- Add native app icons and signed installers.
- Add a small settings surface for attachment strategy and typography.
