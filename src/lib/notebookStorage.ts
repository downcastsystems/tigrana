import { invoke } from "@tauri-apps/api/core";
import type { FolderEntry, LinkIndex, NoteEntry, WorkspaceMetadata } from "../types";
import {
  decodeFolderEntry,
  decodeNoteEntry,
  decodeTitleFromFilename,
  encodeTitleForFilename,
  validateNoteTitle,
} from "./notebookNames";
import { isTauri } from "./desktop";

export const SAMPLE_WORKSPACE = "/demo/Tigrana";

const DEMO_STORAGE_KEY = "tigrana-demo-v5";
const WELCOME_NOTE_PATH = "Welcome.md";
const WELCOME_NOTE_CONTENT =
  "tih-GRAH-nuh or tee-GRAH-nah\n\n" +
  "**Tigrana** is named after an ancient archaeological site where a seal bearing early script was found - a reminder that humans have always needed simple ways to preserve thought.\n\n" +
  "It may or may not also stand for that Time I Got Reincarnated As a Notes App.\n\n" +
  "Use the + icon to add a note.\n";

type DemoStore = {
  notes: Record<string, string>;
  folders: string[];
};

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;
type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type NoteEditLockOwner = {
  windowLabel: string;
  pid: number;
  acquiredAt: number;
  workspace: string;
  path: string;
};

export type NoteEditLockResult = {
  acquired: boolean;
  owner?: NoteEditLockOwner | null;
};

export type TrashEntry = {
  id: string;
  kind: "note" | "folder";
  originalPath: string;
  displayName: string;
  trashName: string;
  deletedAt: number;
};

export type NoteVersionEntry = {
  id: string;
  noteId?: string | null;
  path: string;
  title: string;
  fileName: string;
  createdAt: number;
  reason: string;
  contentLength: number;
  contentHash: string;
};

export type NotebookStorageCapabilities = {
  atomicPathMutations: boolean;
  durableLinkIndex: boolean;
  noteHistory: boolean;
  recentlyDeleted: boolean;
  workspaceWatching: boolean;
};

export type FolderSiblingPlacement = {
  targetPath: string;
  placement: "before" | "after";
};

export type NotebookStorage = {
  readonly capabilities: NotebookStorageCapabilities;
  ensureWorkspace(workspace: string): Promise<void>;
  readLinkIndex(workspace: string): Promise<LinkIndex | null>;
  rebuildLinkIndex(workspace: string): Promise<LinkIndex | null>;
  watchWorkspace(workspace: string): Promise<void>;
  listNotes(workspace: string): Promise<NoteEntry[]>;
  listFolders(workspace: string): Promise<FolderEntry[]>;
  readNote(workspace: string, path: string): Promise<string>;
  acquireNoteEditLock(workspace: string, path: string, windowLabel: string): Promise<NoteEditLockResult>;
  releaseNoteEditLock(workspace: string, path: string, windowLabel: string): Promise<void>;
  saveNote(workspace: string, path: string, content: string): Promise<string>;
  createNote(workspace: string, parentPath: string, title: string): Promise<NoteEntry>;
  duplicateNote(workspace: string, path: string): Promise<NoteEntry>;
  createFolder(workspace: string, parentPath: string, name: string): Promise<FolderEntry>;
  renameFolder(workspace: string, path: string, name: string): Promise<FolderEntry>;
  renameNote(workspace: string, path: string, title: string): Promise<NoteEntry>;
  moveNote(workspace: string, path: string, targetParentPath: string): Promise<NoteEntry>;
  moveFolder(
    workspace: string,
    path: string,
    targetParentPath: string,
    siblingPlacement?: FolderSiblingPlacement,
  ): Promise<FolderEntry>;
  deleteNote(workspace: string, path: string): Promise<void>;
  deleteFolder(workspace: string, path: string): Promise<void>;
  trashNote(workspace: string, path: string): Promise<TrashEntry | null>;
  trashFolder(workspace: string, path: string): Promise<TrashEntry | null>;
  listTrash(workspace: string): Promise<TrashEntry[]>;
  restoreTrash(workspace: string, id: string): Promise<string | null>;
  purgeTrash(workspace: string, id: string): Promise<void>;
  purgeTrashAll(workspace: string): Promise<void>;
  cleanupTrash(workspace: string): Promise<number>;
  listNoteVersions(workspace: string, path: string): Promise<NoteVersionEntry[]>;
  readNoteVersion(workspace: string, path: string, id: string): Promise<string>;
  restoreNoteVersion(workspace: string, path: string, id: string): Promise<string>;
  saveAsset(workspace: string, file: File): Promise<string>;
  saveClipboardImageAsset(workspace: string): Promise<string>;
  readAssetDataUrl(workspace: string, path: string): Promise<string>;
  revealPath(workspace: string, path: string, kind: "folder" | "note"): Promise<void>;
  readWorkspaceMetadata(workspace: string): Promise<WorkspaceMetadata>;
  writeWorkspaceMetadata(workspace: string, metadata: WorkspaceMetadata): Promise<void>;
  ensureWelcomeNote(workspace: string, metadata: WorkspaceMetadata): Promise<{ metadata: WorkspaceMetadata; created: boolean }>;
};

const initialDemo: DemoStore = {
  notes: {
    [WELCOME_NOTE_PATH]: WELCOME_NOTE_CONTENT,
    "Ideas/Design Principles.md": "# Design Principles\n\nSimple, beautiful, file-native.\n\n> Your notes are just files.\n",
    "Projects/Tigrana.md": "# Tigrana\n\n- [ ] Wire durable desktop file access\n- [x] Build the core writing surface\n- [ ] Add SQLite FTS indexing in the Tauri backend\n",
  },
  folders: ["Ideas", "Projects"],
};

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
  welcomeNoteAdded: false,
});

export function createNativeNotebookStorage(invokeCommand: InvokeCommand = invoke as InvokeCommand): NotebookStorage {
  const storage: Omit<NotebookStorage, "ensureWelcomeNote"> = {
    capabilities: {
      atomicPathMutations: true,
      durableLinkIndex: true,
      noteHistory: true,
      recentlyDeleted: true,
      workspaceWatching: true,
    },

    async ensureWorkspace(workspace) {
      await invokeCommand<void>("ensure_workspace", { workspace });
      try {
        await invokeCommand<void>("ensure_workspace_identity", { payload: { workspace } });
      } catch (error) {
        console.warn("ensure_workspace_identity failed", error);
      }
    },

    async readLinkIndex(workspace) {
      try {
        return await invokeCommand<LinkIndex>("read_link_index", { workspace });
      } catch (error) {
        console.warn("read_link_index failed", error);
        return null;
      }
    },

    async rebuildLinkIndex(workspace) {
      try {
        return await invokeCommand<LinkIndex>("rebuild_link_index", { workspace });
      } catch (error) {
        console.warn("rebuild_link_index failed", error);
        return null;
      }
    },

    async watchWorkspace(workspace) {
      await invokeCommand<void>("watch_workspace", { workspace });
    },

    async listNotes(workspace) {
      return (await invokeCommand<NoteEntry[]>("list_notes", { workspace })).map(decodeNoteEntry);
    },

    async listFolders(workspace) {
      return (await invokeCommand<FolderEntry[]>("list_folders", { workspace })).map(decodeFolderEntry);
    },

    readNote(workspace, path) {
      return invokeCommand<string>("read_note", { workspace, path });
    },

    acquireNoteEditLock(workspace, path, windowLabel) {
      return invokeCommand<NoteEditLockResult>("acquire_note_edit_lock", {
        payload: { workspace, path, window_label: windowLabel },
      });
    },

    async releaseNoteEditLock(workspace, path, windowLabel) {
      await invokeCommand<void>("release_note_edit_lock", {
        payload: { workspace, path, window_label: windowLabel },
      });
    },

    saveNote(workspace, path, content) {
      return invokeCommand<string>("save_note", { payload: { workspace, path, content } });
    },

    async createNote(workspace, parentPath, title) {
      validateNoteTitle(title);
      const entry = await invokeCommand<NoteEntry>("create_note", {
        payload: { workspace, parent_path: parentPath, title: encodeTitleForFilename(title.trim()) },
      });
      return decodeNoteEntry(entry);
    },

    async duplicateNote(workspace, path) {
      return decodeNoteEntry(await invokeCommand<NoteEntry>("duplicate_note", { payload: { workspace, path } }));
    },

    async createFolder(workspace, parentPath, name) {
      validateNoteTitle(name);
      const entry = await invokeCommand<FolderEntry>("create_folder", {
        payload: { workspace, parent_path: parentPath, name: encodeTitleForFilename(name.trim()) },
      });
      return decodeFolderEntry(entry);
    },

    async renameFolder(workspace, path, name) {
      validateNoteTitle(name);
      const entry = await invokeCommand<FolderEntry>("rename_folder", {
        payload: { workspace, path, name: encodeTitleForFilename(name.trim()) },
      });
      return decodeFolderEntry(entry);
    },

    async renameNote(workspace, path, title) {
      validateNoteTitle(title);
      const entry = await invokeCommand<NoteEntry>("rename_note", {
        payload: { workspace, path, title: encodeTitleForFilename(title.trim()) },
      });
      return decodeNoteEntry(entry);
    },

    async moveNote(workspace, path, targetParentPath) {
      const entry = await invokeCommand<NoteEntry>("move_note", {
        payload: { workspace, path, target_parent_path: targetParentPath },
      });
      return decodeNoteEntry(entry);
    },

    async moveFolder(workspace, path, targetParentPath, siblingPlacement) {
      validateFolderMove(path, targetParentPath);
      const entry = await invokeCommand<FolderEntry>("move_folder", {
        payload: {
          workspace,
          path,
          target_parent_path: targetParentPath,
          ...(siblingPlacement ? {
            sibling_target_path: siblingPlacement.targetPath,
            sibling_placement: siblingPlacement.placement,
          } : {}),
        },
      });
      return decodeFolderEntry(entry);
    },

    async deleteNote(workspace, path) {
      await invokeCommand<void>("delete_note", { payload: { workspace, path } });
    },

    async deleteFolder(workspace, path) {
      await invokeCommand<void>("delete_folder", { payload: { workspace, path } });
    },

    trashNote(workspace, path) {
      return invokeCommand<TrashEntry>("trash_note", { payload: { workspace, path } });
    },

    trashFolder(workspace, path) {
      return invokeCommand<TrashEntry>("trash_folder", { payload: { workspace, path } });
    },

    listTrash(workspace) {
      return invokeCommand<TrashEntry[]>("list_trash", { workspace });
    },

    restoreTrash(workspace, id) {
      return invokeCommand<string>("restore_trash", { payload: { workspace, id } });
    },

    async purgeTrash(workspace, id) {
      await invokeCommand<void>("purge_trash", { payload: { workspace, id } });
    },

    async purgeTrashAll(workspace) {
      await invokeCommand<void>("purge_trash_all", { workspace });
    },

    cleanupTrash(workspace) {
      return invokeCommand<number>("cleanup_trash", { workspace });
    },

    listNoteVersions(workspace, path) {
      return invokeCommand<NoteVersionEntry[]>("list_note_versions", { payload: { workspace, path } });
    },

    readNoteVersion(workspace, path, id) {
      return invokeCommand<string>("read_note_version", { payload: { workspace, path, id } });
    },

    restoreNoteVersion(workspace, path, id) {
      return invokeCommand<string>("restore_note_version", { payload: { workspace, path, id } });
    },

    async saveAsset(workspace, file) {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const fallbackExtension = file.type.split("/").at(1)?.replace("jpeg", "jpg") || "png";
      return invokeCommand<string>("save_asset", {
        payload: {
          workspace,
          file_name: file.name || `pasted-image.${fallbackExtension}`,
          mime_type: file.type,
          bytes,
        },
      });
    },

    saveClipboardImageAsset(workspace) {
      return invokeCommand<string>("save_clipboard_image_asset", { workspace });
    },

    readAssetDataUrl(workspace, path) {
      return invokeCommand<string>("read_asset_data_url", { workspace, path });
    },

    async revealPath(workspace, path, kind) {
      await invokeCommand<void>("reveal_path", { payload: { workspace, path, kind } });
    },

    readWorkspaceMetadata(workspace) {
      return invokeCommand<WorkspaceMetadata>("read_workspace_metadata", { workspace });
    },

    async writeWorkspaceMetadata(workspace, metadata) {
      await invokeCommand<void>("write_workspace_metadata", { workspace, metadata });
    },
  };

  return addSharedNotebookBehavior(storage);
}

export function createDemoNotebookStorage(persistence: KeyValueStorage): NotebookStorage {
  const readStore = () => {
    const raw = persistence.getItem(DEMO_STORAGE_KEY);
    if (!raw) {
      const store = cloneInitialDemo();
      persistence.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
      return store;
    }
    const parsed = JSON.parse(raw) as Partial<DemoStore>;
    const store = { notes: parsed.notes ?? {}, folders: parsed.folders ?? [] };
    if (!parsed.notes || !parsed.folders) persistence.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
    return store;
  };
  const writeStore = (store: DemoStore) => persistence.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
  const metadataKey = (workspace: string) => `tigrana-meta:${workspace}`;

  const storage: Omit<NotebookStorage, "ensureWelcomeNote"> = {
    capabilities: {
      atomicPathMutations: false,
      durableLinkIndex: false,
      noteHistory: false,
      recentlyDeleted: false,
      workspaceWatching: false,
    },

    async ensureWorkspace() {},
    async readLinkIndex() { return null; },
    async rebuildLinkIndex() { return null; },
    async watchWorkspace() {},

    async listNotes() {
      return Object.keys(readStore().notes).map((path) => {
        const parts = path.split("/");
        const fileStem = parts.at(-1)?.replace(/\.md$/, "") ?? "Untitled";
        return {
          path,
          title: decodeTitleFromFilename(fileStem),
          parent_path: parts.slice(0, -1).join("/"),
          updated_at: Date.now() / 1000,
        };
      });
    },

    async listFolders(workspace) {
      const store = readStore();
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
        const rawName = path ? path.split("/").at(-1) ?? "Untitled" : workspace.split("/").at(-1) || "Notebook";
        return { path, name: decodeTitleFromFilename(rawName), parent_path: path.split("/").slice(0, -1).join("/") };
      });
    },

    async readNote(_workspace, path) {
      return readStore().notes[path] ?? "";
    },

    async acquireNoteEditLock() { return { acquired: true }; },
    async releaseNoteEditLock() {},

    async saveNote(_workspace, path, content) {
      const store = readStore();
      store.notes[path] = content;
      writeStore(store);
      return content;
    },

    async createNote(_workspace, parentPath, title) {
      validateNoteTitle(title);
      const store = readStore();
      const encodedTitle = encodeTitleForFilename(title.trim());
      const fileName = `${encodedTitle || "Untitled"}.md`;
      const path = parentPath ? `${parentPath}/${fileName}` : fileName;
      if (store.notes[path]) throw new Error("A note with that title already exists in this folder.");
      store.notes[path] = "";
      writeStore(store);
      return { path, title: title.trim() || "Untitled", parent_path: parentPath, updated_at: Date.now() / 1000 };
    },

    async duplicateNote(_workspace, path) {
      const store = readStore();
      const content = store.notes[path];
      if (content === undefined) throw new Error("The note could not be found.");
      const parts = path.split("/");
      const parentPath = parts.slice(0, -1).join("/");
      const sourceStem = parts.at(-1)?.replace(/\.md$/, "") || "Untitled";
      const nextPath = uniqueDemoNotePath(store, parentPath, `Copy of ${sourceStem}`);
      store.notes[nextPath] = content;
      writeStore(store);
      return {
        path: nextPath,
        title: decodeTitleFromFilename(nextPath.split("/").at(-1)?.replace(/\.md$/, "") ?? "Untitled"),
        parent_path: parentPath,
        updated_at: Date.now() / 1000,
      };
    },

    async createFolder(_workspace, parentPath, name) {
      validateNoteTitle(name);
      const store = readStore();
      const encodedName = encodeTitleForFilename(name.trim());
      const path = parentPath ? `${parentPath}/${encodedName}` : encodedName;
      if (store.folders.includes(path)) throw new Error("A folder with that name already exists here.");
      store.folders.push(path);
      writeStore(store);
      return { path, name: name.trim(), parent_path: parentPath };
    },

    async renameFolder(_workspace, path, name) {
      validateNoteTitle(name);
      const store = readStore();
      const parentPath = path.split("/").slice(0, -1).join("/");
      const encodedName = encodeTitleForFilename(name.trim());
      const nextPath = parentPath ? `${parentPath}/${encodedName}` : encodedName;
      if (path !== nextPath && store.folders.includes(nextPath)) throw new Error("A folder with that name already exists here.");
      store.folders = store.folders.map((folder) => replacePathPrefix(folder, path, nextPath));
      store.notes = Object.fromEntries(
        Object.entries(store.notes).map(([notePath, content]) => [replacePathPrefix(notePath, path, nextPath), content]),
      );
      writeStore(store);
      return { path: nextPath, name: name.trim(), parent_path: parentPath };
    },

    async renameNote(_workspace, path, title) {
      validateNoteTitle(title);
      const store = readStore();
      const parentPath = path.split("/").slice(0, -1).join("/");
      const encodedTitle = encodeTitleForFilename(title.trim());
      const nextPath = parentPath ? `${parentPath}/${encodedTitle}.md` : `${encodedTitle}.md`;
      if (path !== nextPath && store.notes[nextPath]) throw new Error("A note with that title already exists in this folder.");
      store.notes[nextPath] = store.notes[path] ?? "";
      if (path !== nextPath) delete store.notes[path];
      writeStore(store);
      return { path: nextPath, title: title.trim(), parent_path: parentPath, updated_at: Date.now() / 1000 };
    },

    async moveNote(_workspace, path, targetParentPath) {
      const store = readStore();
      const fileName = path.split("/").at(-1) ?? path;
      const fileStem = fileName.replace(/\.md$/, "");
      const requestedPath = targetParentPath ? `${targetParentPath}/${fileName}` : fileName;
      const nextPath = path === requestedPath || !store.notes[requestedPath]
        ? requestedPath
        : uniqueDemoNotePath(store, targetParentPath, fileStem);
      store.notes[nextPath] = store.notes[path] ?? "";
      if (path !== nextPath) delete store.notes[path];
      writeStore(store);
      return {
        path: nextPath,
        title: decodeTitleFromFilename(fileStem),
        parent_path: targetParentPath,
        updated_at: Date.now() / 1000,
      };
    },

    async moveFolder(_workspace, path, targetParentPath) {
      validateFolderMove(path, targetParentPath);
      const store = readStore();
      const name = path.split("/").at(-1) ?? path;
      const nextPath = targetParentPath ? `${targetParentPath}/${name}` : name;
      if (path !== nextPath && store.folders.includes(nextPath)) {
        throw new Error("A folder with that name already exists in the target folder.");
      }
      store.folders = store.folders.map((folder) => replacePathPrefix(folder, path, nextPath));
      store.notes = Object.fromEntries(
        Object.entries(store.notes).map(([notePath, content]) => [replacePathPrefix(notePath, path, nextPath), content]),
      );
      writeStore(store);
      return { path: nextPath, name: decodeTitleFromFilename(name), parent_path: targetParentPath };
    },

    async deleteNote(_workspace, path) {
      const store = readStore();
      delete store.notes[path];
      writeStore(store);
    },

    async deleteFolder(_workspace, path) {
      const store = readStore();
      store.folders = store.folders.filter((folder) => folder !== path && !folder.startsWith(`${path}/`));
      Object.keys(store.notes).forEach((notePath) => {
        if (notePath.startsWith(`${path}/`)) delete store.notes[notePath];
      });
      writeStore(store);
    },

    async trashNote(workspace, path) {
      await storage.deleteNote(workspace, path);
      return null;
    },

    async trashFolder(workspace, path) {
      await storage.deleteFolder(workspace, path);
      return null;
    },

    async listTrash() { return []; },
    async restoreTrash() { return null; },
    async purgeTrash() {},
    async purgeTrashAll() {},
    async cleanupTrash() { return 0; },
    async listNoteVersions() { return []; },
    async readNoteVersion() { return ""; },
    async restoreNoteVersion() { return ""; },

    async saveAsset(_workspace, file) {
      return URL.createObjectURL(file);
    },

    async saveClipboardImageAsset() {
      throw new Error("Clipboard image paste is only available in the desktop app.");
    },

    async readAssetDataUrl(_workspace, path) { return path; },

    async revealPath(workspace, path, kind) {
      console.info("Reveal in file manager is available in the desktop app.", { workspace, path, kind });
    },

    async readWorkspaceMetadata(workspace) {
      const raw = persistence.getItem(metadataKey(workspace));
      return raw ? normalizeWorkspaceMetadata(JSON.parse(raw) as Partial<WorkspaceMetadata>) : defaultWorkspaceMetadata();
    },

    async writeWorkspaceMetadata(workspace, metadata) {
      persistence.setItem(metadataKey(workspace), JSON.stringify(metadata));
    },
  };

  return addSharedNotebookBehavior(storage);
}

function addSharedNotebookBehavior(storage: Omit<NotebookStorage, "ensureWelcomeNote">): NotebookStorage {
  return {
    ...storage,
    async ensureWelcomeNote(workspace, metadata) {
      if (metadata.welcomeNoteAdded) return { metadata, created: false };
      const hasWelcomeNote = (await storage.listNotes(workspace)).some((note) => note.path === WELCOME_NOTE_PATH);
      if (!hasWelcomeNote) await storage.saveNote(workspace, WELCOME_NOTE_PATH, WELCOME_NOTE_CONTENT);
      const nextMetadata = { ...metadata, welcomeNoteAdded: true };
      await storage.writeWorkspaceMetadata(workspace, nextMetadata);
      return { metadata: nextMetadata, created: !hasWelcomeNote };
    },
  };
}

function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function cloneInitialDemo(): DemoStore {
  return { notes: { ...initialDemo.notes }, folders: [...initialDemo.folders] };
}

function uniqueDemoNotePath(store: DemoStore, parentPath: string, encodedStem: string): string {
  for (let suffix = 0; ; suffix += 1) {
    const stem = suffix === 0 ? encodedStem : `${encodedStem} ${suffix}`;
    const candidate = parentPath ? `${parentPath}/${stem}.md` : `${stem}.md`;
    if (!store.notes[candidate]) return candidate;
  }
}

function validateFolderMove(path: string, targetParentPath: string) {
  if (!path) throw new Error("The notebook root cannot be moved.");
  if (targetParentPath === path || targetParentPath.startsWith(`${path}/`)) {
    throw new Error("A folder cannot be moved inside itself.");
  }
}

function normalizeWorkspaceMetadata(metadata: Partial<WorkspaceMetadata>): WorkspaceMetadata {
  return { ...defaultWorkspaceMetadata(), ...metadata };
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}

const browserPersistence = typeof localStorage === "undefined" ? createMemoryStorage() : localStorage;

export const notebookStorage: NotebookStorage = isTauri()
  ? createNativeNotebookStorage()
  : createDemoNotebookStorage(browserPersistence);
