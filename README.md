# Tigrana

**A calm, local-first notes app built around plain Markdown files.**

Tigrana is a free and open-source desktop notes app for people who want a polished writing experience without giving up ownership of their notes. It takes inspiration from Notion's approachable editor while keeping its scope intentionally focused: write, organize, and find notes.

Your notebook is an ordinary folder. Notes are ordinary Markdown files. The hierarchy you see in Tigrana is the hierarchy on disk, so your writing remains portable, readable, and yours.

> [!NOTE]
> Tigrana is early-stage software. macOS is the primary development platform; Windows builds are configured but have not been tested yet.

## Why Tigrana?

- **Local first** — your notes live on your computer, not behind a cloud account.
- **File native** — Markdown files and folders remain the source of truth.
- **Free and open source** — inspect it, build it, and help improve it.
- **Focused by design** — a notes app, not an all-purpose productivity suite.
- **Portable** — your Markdown stays readable in other editors and tools.
- **Private** — no account is required to use your local notebooks.

## Features

- Rich Markdown editing with headings, lists, tasks, quotes, code blocks, links, tables, dividers, and images
- Notion-style slash commands
- Nested folders backed by the filesystem
- Note pinning, reordering, and drag-and-drop organization
- Fast fuzzy search across titles, paths, and note content
- Automatic saving and local note history
- Clipboard image support with notebook-local assets
- Light and dark themes
- Markdown import and export
- Stable note and folder identities so links survive moves and renames

## Built With

- [Tauri 2](https://tauri.app/) and [Rust](https://www.rust-lang.org/) for the native desktop application and filesystem layer
- [React](https://react.dev/) and [TypeScript](https://www.typescriptlang.org/) for the interface
- [Vite](https://vite.dev/) for frontend tooling
- [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) for the editor
- [remark](https://remark.js.org/) for Markdown processing
- [Fuse.js](https://www.fusejs.io/) for local fuzzy search
- [Vitest](https://vitest.dev/) for testing

## Install from Source

Tigrana does not currently publish signed release binaries, so the app is built from source.

### macOS

Prerequisites:

- [Node.js](https://nodejs.org/) and npm
- [Rust](https://www.rust-lang.org/tools/install)
- Xcode Command Line Tools (`xcode-select --install`)

Clone the repository, install dependencies, then build and install Tigrana:

```bash
git clone https://github.com/downcastsystems/tigrana.git
cd tigrana
npm install
npm run install:app
```

This creates a release build and installs `Tigrana.app` in `/Applications`.

Because the app is not currently signed or notarized, macOS may require you to approve it in **System Settings → Privacy & Security** the first time it opens.

### Windows (experimental and untested)

> [!WARNING]
> Tigrana has not been tested on Windows. The project includes Windows packaging configuration, but installation and runtime behavior may have platform-specific issues. Bug reports and contributions are welcome.

Prerequisites:

- [Node.js](https://nodejs.org/) and npm
- [Rust](https://www.rust-lang.org/tools/install) using the MSVC toolchain
- Microsoft C++ Build Tools and WebView2, as described in the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)

In PowerShell:

```powershell
git clone https://github.com/downcastsystems/tigrana.git
cd tigrana
npm install
npm run tauri -- build
```

When the build completes, run either the generated `.msi` installer from:

```text
src-tauri\target\release\bundle\msi\
```

or the generated NSIS `.exe` installer from:

```text
src-tauri\target\release\bundle\nsis\
```

## Development

Install dependencies and start the native desktop app:

```bash
npm install
npm run tauri -- dev
```

To run only the browser-based development version:

```bash
npm run dev
```

Vite prints the local URL when the development server starts. Browser mode uses local storage in place of the native filesystem APIs.

## Quality Checks

```bash
npm run lint
npm test
npm run build
```

## How Your Notes Are Stored

Tigrana keeps durable content and supporting metadata inside the notebook itself:

```text
My Notebook/
  Inbox.md
  Projects/
    Tigrana.md
  .assets/
    pasted-image.png
  .tigrana/
    metadata.json
    index.json
```

Markdown files and folders are your content. `.assets` contains pasted images and other attachments. `.tigrana` contains app metadata and a rebuildable link index.

## Contributing

Tigrana is young, and contributions are welcome—especially testing and fixes for Windows. If you find a bug or have an idea that fits the project's focused, file-native direction, open an issue or pull request.

Please keep one principle in mind: features should preserve clean, readable Markdown outside Tigrana whenever possible.

## License

Tigrana is free and open-source software released under the [MIT License](LICENSE).
