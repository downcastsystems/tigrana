import { invoke } from "@tauri-apps/api/core";
import type { FolderEntry, LinkIndex, NoteEntry, WorkspaceMetadata } from "../types";

const SAMPLE_WORKSPACE = "/demo/Tigrana";
const storageKey = "tigrana-demo-v5";

type DemoStore = {
  notes: Record<string, string>;
  folders: string[];
};

const initialDemo: DemoStore = {
  notes: {
    "Welcome.md": "# Welcome\n\nThis is a local-first notes app prototype.\n\nUse `/` to open the command menu.\n\n- Notes are Markdown files\n- Folders are hierarchy\n- Search is instant\n",
    "Ideas/Design Principles.md": "# Design Principles\n\nSimple, beautiful, file-native.\n\n> Your notes are just files.\n",
    "Projects/Tigrana.md": "# Tigrana\n\n- [ ] Wire durable desktop file access\n- [x] Build the core writing surface\n- [ ] Add SQLite FTS indexing in the Tauri backend\n",
  },
  folders: ["Ideas", "Projects"],
};

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function readDemoStore(): DemoStore {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    localStorage.setItem(storageKey, JSON.stringify(initialDemo));
    return initialDemo;
  }
  const parsed = JSON.parse(raw) as Partial<DemoStore>;
  const store = {
    notes: parsed.notes ?? {},
    folders: parsed.folders ?? [],
  };
  if (!parsed.notes || !parsed.folders) {
    writeDemoStore(store);
  }
  return store;
}

function writeDemoStore(store: DemoStore) {
  localStorage.setItem(storageKey, JSON.stringify(store));
}

export async function ensureWorkspace(workspace: string) {
  if (!isTauri()) return;
  await invoke("ensure_workspace", { workspace });
  // Mint stable ids and build the link index. Safe to call on every open.
  try {
    await invoke("ensure_workspace_identity", { payload: { workspace } });
  } catch (error) {
    console.warn("ensure_workspace_identity failed", error);
  }
}

export async function readLinkIndex(workspace: string): Promise<LinkIndex | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LinkIndex>("read_link_index", { workspace });
  } catch (error) {
    console.warn("read_link_index failed", error);
    return null;
  }
}

export async function rebuildLinkIndex(workspace: string): Promise<LinkIndex | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LinkIndex>("rebuild_link_index", { workspace });
  } catch (error) {
    console.warn("rebuild_link_index failed", error);
    return null;
  }
}

export async function watchWorkspace(workspace: string) {
  if (!isTauri()) return;
  await invoke("watch_workspace", { workspace });
}

export async function listNotes(workspace: string): Promise<NoteEntry[]> {
  if (isTauri()) {
    const entries = await invoke<NoteEntry[]>("list_notes", { workspace });
    return entries.map(decodeNoteEntry);
  }
  const store = readDemoStore();
  return Object.keys(store.notes).map((path) => {
    const parts = path.split("/");
    const fileStem = parts.at(-1)?.replace(/\.md$/, "") ?? "Untitled";
    return {
      path,
      title: decodeTitleFromFilename(fileStem),
      parent_path: parts.slice(0, -1).join("/"),
      updated_at: Date.now() / 1000,
    };
  });
}

export async function listFolders(workspace: string): Promise<FolderEntry[]> {
  if (isTauri()) {
    const entries = await invoke<FolderEntry[]>("list_folders", { workspace });
    return entries.map(decodeFolderEntry);
  }
  const store = readDemoStore();
  const folderSet = new Set<string>(["", ...store.folders]);
  Object.keys(store.notes).forEach((path) => {
    const parts = path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folderSet.add(current);
    }
  });
  return Array.from(folderSet).map((path) => {
    const rawName = path
      ? path.split("/").at(-1) ?? "Untitled"
      : workspace.split("/").at(-1) || "Notebook";
    return {
      path,
      name: decodeTitleFromFilename(rawName),
      parent_path: path.split("/").slice(0, -1).join("/"),
    };
  });
}

export async function readNote(workspace: string, path: string) {
  if (isTauri()) return invoke<string>("read_note", { workspace, path });
  return readDemoStore().notes[path] ?? "";
}

// Returns the actual on-disk content after the save. Rust normalizes line
// endings and adds an id frontmatter when missing, so the returned string can
// differ from `content` — callers that need to recognize their own writes
// later (e.g. file-watcher echoes) should use the returned value.
export async function saveNote(workspace: string, path: string, content: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("save_note", { payload: { workspace, path, content } });
  }
  const store = readDemoStore();
  store.notes[path] = content;
  writeDemoStore(store);
  return content;
}

export async function createNote(workspace: string, parentPath: string, title: string): Promise<NoteEntry> {
  validateNoteTitle(title);
  const encodedTitle = encodeTitleForFilename(title.trim());
  if (isTauri()) {
    const entry = await invoke<NoteEntry>("create_note", {
      payload: { workspace, parent_path: parentPath, title: encodedTitle },
    });
    return decodeNoteEntry(entry);
  }
  const store = readDemoStore();
  const fileName = `${encodedTitle || "Untitled"}.md`;
  const path = parentPath ? `${parentPath}/${fileName}` : fileName;
  if (store.notes[path]) {
    throw new Error("A note with that title already exists in this folder.");
  }
  store.notes[path] = "";
  writeDemoStore(store);
  return {
    path,
    title: title.trim() || "Untitled",
    parent_path: parentPath,
    updated_at: Date.now() / 1000,
  };
}

export async function createFolder(workspace: string, parentPath: string, name: string): Promise<FolderEntry> {
  validateNoteTitle(name);
  const encodedName = encodeTitleForFilename(name.trim());
  if (isTauri()) {
    const entry = await invoke<FolderEntry>("create_folder", {
      payload: { workspace, parent_path: parentPath, name: encodedName },
    });
    return decodeFolderEntry(entry);
  }
  const store = readDemoStore();
  const path = parentPath ? `${parentPath}/${encodedName}` : encodedName;
  if (store.folders.includes(path)) throw new Error("A folder with that name already exists here.");
  store.folders.push(path);
  writeDemoStore(store);
  return {
    path,
    name: name.trim(),
    parent_path: parentPath,
  };
}

export async function renameFolder(workspace: string, path: string, name: string): Promise<FolderEntry> {
  validateNoteTitle(name);
  const encodedName = encodeTitleForFilename(name.trim());
  if (isTauri()) {
    const entry = await invoke<FolderEntry>("rename_folder", {
      payload: { workspace, path, name: encodedName },
    });
    return decodeFolderEntry(entry);
  }

  const store = readDemoStore();
  const parentPath = path.split("/").slice(0, -1).join("/");
  const nextPath = parentPath ? `${parentPath}/${encodedName}` : encodedName;
  if (path !== nextPath && store.folders.includes(nextPath)) {
    throw new Error("A folder with that name already exists here.");
  }

  store.folders = store.folders.map((folder) => replacePathPrefix(folder, path, nextPath));
  const notes = Object.entries(store.notes);
  store.notes = Object.fromEntries(notes.map(([notePath, content]) => [replacePathPrefix(notePath, path, nextPath), content]));
  writeDemoStore(store);

  return {
    path: nextPath,
    name: name.trim(),
    parent_path: parentPath,
  };
}

export async function renameNote(workspace: string, path: string, title: string): Promise<NoteEntry> {
  validateNoteTitle(title);
  const encodedTitle = encodeTitleForFilename(title.trim());
  if (isTauri()) {
    const entry = await invoke<NoteEntry>("rename_note", {
      payload: { workspace, path, title: encodedTitle },
    });
    return decodeNoteEntry(entry);
  }

  const store = readDemoStore();
  const parts = path.split("/");
  const parentPath = parts.slice(0, -1).join("/");
  const nextPath = parentPath ? `${parentPath}/${encodedTitle}.md` : `${encodedTitle}.md`;

  if (path !== nextPath && store.notes[nextPath]) {
    throw new Error("A note with that title already exists in this folder.");
  }

  store.notes[nextPath] = store.notes[path] ?? "";
  if (path !== nextPath) delete store.notes[path];
  writeDemoStore(store);

  return {
    path: nextPath,
    title: title.trim(),
    parent_path: parentPath,
    updated_at: Date.now() / 1000,
  };
}

export async function moveNote(workspace: string, path: string, targetParentPath: string): Promise<NoteEntry> {
  if (isTauri()) {
    const entry = await invoke<NoteEntry>("move_note", {
      payload: { workspace, path, target_parent_path: targetParentPath },
    });
    return decodeNoteEntry(entry);
  }

  const store = readDemoStore();
  const fileName = path.split("/").at(-1) ?? path;
  const nextPath = targetParentPath ? `${targetParentPath}/${fileName}` : fileName;
  if (path !== nextPath && store.notes[nextPath]) {
    throw new Error("A note with that title already exists in the target folder.");
  }

  store.notes[nextPath] = store.notes[path] ?? "";
  if (path !== nextPath) delete store.notes[path];
  writeDemoStore(store);

  return {
    path: nextPath,
    title: decodeTitleFromFilename(fileName.replace(/\.md$/, "")),
    parent_path: targetParentPath,
    updated_at: Date.now() / 1000,
  };
}

export async function moveFolder(workspace: string, path: string, targetParentPath: string): Promise<FolderEntry> {
  if (!path) throw new Error("The notebook root cannot be moved.");
  if (targetParentPath === path || targetParentPath.startsWith(`${path}/`)) {
    throw new Error("A folder cannot be moved inside itself.");
  }

  if (isTauri()) {
    const entry = await invoke<FolderEntry>("move_folder", {
      payload: { workspace, path, target_parent_path: targetParentPath },
    });
    return decodeFolderEntry(entry);
  }

  const store = readDemoStore();
  const name = path.split("/").at(-1) ?? path;
  const nextPath = targetParentPath ? `${targetParentPath}/${name}` : name;
  if (path !== nextPath && store.folders.includes(nextPath)) {
    throw new Error("A folder with that name already exists in the target folder.");
  }

  store.folders = store.folders.map((folder) => replacePathPrefix(folder, path, nextPath));
  store.notes = Object.fromEntries(Object.entries(store.notes).map(([notePath, content]) => [replacePathPrefix(notePath, path, nextPath), content]));
  writeDemoStore(store);

  return {
    path: nextPath,
    name: decodeTitleFromFilename(name),
    parent_path: targetParentPath,
  };
}

export async function deleteNote(workspace: string, path: string) {
  if (isTauri()) {
    await invoke("delete_note", { payload: { workspace, path } });
    return;
  }
  const store = readDemoStore();
  delete store.notes[path];
  writeDemoStore(store);
}

export async function deleteFolder(workspace: string, path: string) {
  if (isTauri()) {
    await invoke("delete_folder", { payload: { workspace, path } });
    return;
  }
  const store = readDemoStore();
  store.folders = store.folders.filter((folder) => folder !== path && !folder.startsWith(`${path}/`));
  Object.keys(store.notes).forEach((notePath) => {
    if (notePath.startsWith(`${path}/`)) delete store.notes[notePath];
  });
  writeDemoStore(store);
}

export type TrashEntry = {
  id: string;
  kind: "note" | "folder";
  originalPath: string;
  displayName: string;
  trashName: string;
  deletedAt: number;
};

export async function trashNote(workspace: string, path: string): Promise<TrashEntry | null> {
  if (isTauri()) {
    return invoke<TrashEntry>("trash_note", { payload: { workspace, path } });
  }
  await deleteNote(workspace, path);
  return null;
}

export async function trashFolder(workspace: string, path: string): Promise<TrashEntry | null> {
  if (isTauri()) {
    return invoke<TrashEntry>("trash_folder", { payload: { workspace, path } });
  }
  await deleteFolder(workspace, path);
  return null;
}

export async function listTrash(workspace: string): Promise<TrashEntry[]> {
  if (isTauri()) {
    return invoke<TrashEntry[]>("list_trash", { workspace });
  }
  return [];
}

export async function restoreTrash(workspace: string, id: string): Promise<string | null> {
  if (isTauri()) {
    return invoke<string>("restore_trash", { payload: { workspace, id } });
  }
  return null;
}

export async function purgeTrash(workspace: string, id: string): Promise<void> {
  if (isTauri()) {
    await invoke("purge_trash", { payload: { workspace, id } });
  }
}

export async function purgeTrashAll(workspace: string): Promise<void> {
  if (isTauri()) {
    await invoke("purge_trash_all", { workspace });
  }
}

export async function cleanupTrash(workspace: string): Promise<number> {
  if (isTauri()) {
    return invoke<number>("cleanup_trash", { workspace });
  }
  return 0;
}

export async function saveAsset(workspace: string, file: File) {
  if (isTauri()) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const fallbackExtension = file.type.split("/").at(1)?.replace("jpeg", "jpg") || "png";
    return invoke<string>("save_asset", {
      payload: {
        workspace,
        file_name: file.name || `pasted-image.${fallbackExtension}`,
        mime_type: file.type,
        bytes,
      },
    });
  }
  return URL.createObjectURL(file);
}

export async function saveClipboardImageAsset(workspace: string) {
  if (isTauri()) return invoke<string>("save_clipboard_image_asset", { workspace });
  throw new Error("Clipboard image paste is only available in the desktop app.");
}

export async function readAssetDataUrl(workspace: string, path: string) {
  if (isTauri()) return invoke<string>("read_asset_data_url", { workspace, path });
  return path;
}

export async function revealPath(workspace: string, path: string, kind: "folder" | "note") {
  if (isTauri()) {
    await invoke("reveal_path", { payload: { workspace, path, kind } });
    return;
  }
  console.info("Reveal in file manager is available in the desktop app.", { workspace, path, kind });
}

export async function openExternal(url: string) {
  if (isTauri()) {
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const FILENAME_SLASH = "／"; // FULLWIDTH SOLIDUS
const FILENAME_LEADING_DOT = "．"; // FULLWIDTH FULL STOP
const FILENAME_HASH = "＃"; // FULLWIDTH NUMBER SIGN
const FILENAME_PERCENT = "％"; // FULLWIDTH PERCENT SIGN

export function encodeTitleForFilename(title: string): string {
  return title
    .replace(/\//g, FILENAME_SLASH)
    .replace(/#/g, FILENAME_HASH)
    .replace(/%/g, FILENAME_PERCENT)
    .replace(/^\.+/, (dots) => FILENAME_LEADING_DOT.repeat(dots.length));
}

export function decodeTitleFromFilename(name: string): string {
  return name.replace(/／/g, "/").replace(/．/g, ".").replace(/＃/g, "#").replace(/％/g, "%");
}

function decodeNoteEntry(entry: NoteEntry): NoteEntry {
  return { ...entry, title: decodeTitleFromFilename(entry.title) };
}

function decodeFolderEntry(entry: FolderEntry): FolderEntry {
  return { ...entry, name: decodeTitleFromFilename(entry.name) };
}

export function validateNoteTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Add a title before saving this note.");
  if (/[\\:*?"<>|]/.test(trimmed)) {
    throw new Error('Note titles cannot contain \\ : * ? " < > |');
  }
  if (Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code >= 0 && code <= 31;
  })) {
    throw new Error("Note titles cannot contain line breaks or control characters.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("That title is reserved by the filesystem.");
  }
}

export const defaultWorkspaceMetadata = (): WorkspaceMetadata => ({
  folderOrder: {},
  noteOrder: {},
  pinnedNotes: {},
  folderIcons: {},
  folderColors: {},
  noteIcons: {},
  notePositions: {},
  bookmarks: [],
  bookmarksExpanded: true,
  expandedFolders: {},
});

const demoMetadataKey = (workspace: string) => `tigrana-meta:${workspace}`;

export async function readWorkspaceMetadata(workspace: string): Promise<WorkspaceMetadata> {
  if (isTauri()) {
    return invoke("read_workspace_metadata", { workspace });
  }

  const raw = localStorage.getItem(demoMetadataKey(workspace));
  if (!raw) {
    return defaultWorkspaceMetadata();
  }
  return normalizeWorkspaceMetadata(JSON.parse(raw) as Partial<WorkspaceMetadata>);
}

export async function writeWorkspaceMetadata(workspace: string, metadata: WorkspaceMetadata) {
  if (isTauri()) {
    await invoke("write_workspace_metadata", { workspace, metadata });
    return;
  }

  localStorage.setItem(demoMetadataKey(workspace), JSON.stringify(metadata));
}

function normalizeWorkspaceMetadata(metadata: Partial<WorkspaceMetadata>): WorkspaceMetadata {
  return {
    ...defaultWorkspaceMetadata(),
    ...metadata,
  };
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}

export { SAMPLE_WORKSPACE };
