import type { BookmarkEntry, FolderEntry, NoteEntry, WorkspaceMetadata } from "../types";

export type FolderNode = FolderEntry & {
  children: FolderNode[];
};

export type BookmarkView = BookmarkEntry & {
  title: string;
  icon?: string;
  missing: boolean;
};

export function mergeWorkspaceMetadataChanges(
  base: WorkspaceMetadata,
  local: WorkspaceMetadata,
  durable: WorkspaceMetadata,
): WorkspaceMetadata {
  return {
    ...(mergeJsonChanges(base, local, durable) as WorkspaceMetadata),
    revision: durable.revision,
  };
}

function mergeJsonChanges(base: unknown, local: unknown, durable: unknown): unknown {
  if (JSON.stringify(local) === JSON.stringify(base)) return durable;
  if (!isJsonObject(base) || !isJsonObject(local) || !isJsonObject(durable)) return local;

  const result: Record<string, unknown> = { ...durable };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (!(key in local)) {
      delete result[key];
      continue;
    }
    result[key] = mergeJsonChanges(base[key], local[key], durable[key]);
  }
  return result;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getNotebookName(workspace: string) {
  return workspace.split("/").filter(Boolean).at(-1) || "Notebook";
}

export function buildFolderTree(folders: FolderEntry[], workspace: string, metadata: WorkspaceMetadata): FolderNode[] {
  const notebookName = getNotebookName(workspace);
  const entries = folders.length
    ? folders
    : [{ path: "", name: notebookName, parent_path: "" }];
  const map = new Map<string, FolderNode>();
  entries.forEach((folder) => map.set(folder.path, { ...folder, children: [] }));
  if (!map.has("")) {
    map.set("", { path: "", name: notebookName, parent_path: "", children: [] });
  }
  map.forEach((node) => {
    if (node.path === "") return;
    map.get(node.parent_path)?.children.push(node);
  });
  const sortChildren = (node: FolderNode) => {
    node.children = orderFolders(node.children, node.path, metadata);
    node.children.forEach(sortChildren);
  };
  const root = map.get("")!;
  sortChildren(root);
  return [root];
}

export function buildBookmarkViews(
  bookmarks: BookmarkEntry[],
  folders: FolderEntry[],
  notes: NoteEntry[],
  metadata: WorkspaceMetadata,
  workspace: string,
): BookmarkView[] {
  const notebookName = getNotebookName(workspace);
  return bookmarks.map((bookmark) => {
    if (bookmark.kind === "folder") {
      const folder = folders.find((entry) => entry.path === bookmark.path);
      return {
        ...bookmark,
        title: folder ? folder.name : `${bookmark.path || notebookName} (missing)`,
        icon: metadata.folderIcons[bookmark.path],
        missing: !folder,
      };
    }
    const note = notes.find((entry) => entry.path === bookmark.path);
    return {
      ...bookmark,
      title: note?.title ?? `${bookmark.path} (missing)`,
      icon: metadata.noteIcons[bookmark.path],
      missing: !note,
    };
  });
}

export function orderFolders<T extends FolderEntry>(folders: T[], parentPath: string, metadata: WorkspaceMetadata): T[] {
  const order = metadata.folderOrder[parentPath] ?? [];
  return [...folders].sort((a, b) => {
    const aIndex = order.indexOf(a.path);
    const bIndex = order.indexOf(b.path);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.name.localeCompare(b.name);
  });
}

export function orderNotes(notes: NoteEntry[], folderPath: string, metadata: WorkspaceMetadata) {
  const order = metadata.noteOrder[folderPath] ?? [];
  return [...notes].sort((a, b) => {
    const pinDelta = Number(Boolean(metadata.pinnedNotes[b.path])) - Number(Boolean(metadata.pinnedNotes[a.path]));
    if (pinDelta) return pinDelta;
    const aIndex = order.indexOf(a.path);
    const bIndex = order.indexOf(b.path);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.title.localeCompare(b.title);
  });
}

export function addToOrder(metadata: WorkspaceMetadata, folder: string, notePath: string): WorkspaceMetadata {
  return {
    ...metadata,
    noteOrder: {
      ...metadata.noteOrder,
      [folder]: [...(metadata.noteOrder[folder] ?? []).filter((path) => path !== notePath), notePath],
    },
  };
}

export function addFolderToOrder(metadata: WorkspaceMetadata, parent: string, folderPath: string): WorkspaceMetadata {
  return {
    ...metadata,
    folderOrder: {
      ...metadata.folderOrder,
      [parent]: [...(metadata.folderOrder[parent] ?? []).filter((path) => path !== folderPath), folderPath],
    },
  };
}

export function replaceOrderedPath(metadata: WorkspaceMetadata, oldPath: string, newPath: string): WorkspaceMetadata {
  const noteOrder = Object.fromEntries(
    Object.entries(metadata.noteOrder).map(([folder, paths]) => [folder, paths.map((path) => (path === oldPath ? newPath : path))]),
  );
  const pinnedNotes = { ...metadata.pinnedNotes };
  if (Object.prototype.hasOwnProperty.call(pinnedNotes, oldPath)) {
    delete pinnedNotes[oldPath];
    pinnedNotes[newPath] = metadata.pinnedNotes[oldPath];
  }
  const noteIcons = { ...metadata.noteIcons };
  if (Object.prototype.hasOwnProperty.call(noteIcons, oldPath)) {
    noteIcons[newPath] = noteIcons[oldPath];
    delete noteIcons[oldPath];
  }
  const notePositions = { ...metadata.notePositions };
  if (Object.prototype.hasOwnProperty.call(notePositions, oldPath)) {
    notePositions[newPath] = { ...notePositions[oldPath], path: newPath };
    delete notePositions[oldPath];
  }
  const bookmarks = metadata.bookmarks.map((bookmark) =>
    bookmark.kind === "note" && bookmark.path === oldPath ? { ...bookmark, path: newPath } : bookmark,
  );
  return { ...metadata, noteOrder, pinnedNotes, noteIcons, notePositions, bookmarks };
}

export function removeNoteFromMetadata(metadata: WorkspaceMetadata, notePath: string): WorkspaceMetadata {
  return {
    ...metadata,
    noteOrder: Object.fromEntries(
      Object.entries(metadata.noteOrder).map(([folder, paths]) => [folder, paths.filter((path) => path !== notePath)]),
    ),
    pinnedNotes: Object.fromEntries(Object.entries(metadata.pinnedNotes).filter(([path]) => path !== notePath)),
    noteIcons: Object.fromEntries(Object.entries(metadata.noteIcons).filter(([path]) => path !== notePath)),
    notePositions: Object.fromEntries(Object.entries(metadata.notePositions).filter(([path]) => path !== notePath)),
    bookmarks: metadata.bookmarks.filter((bookmark) => bookmark.kind !== "note" || bookmark.path !== notePath),
  };
}

export function moveNoteInMetadata(metadata: WorkspaceMetadata, oldPath: string, newPath: string, oldFolder: string, newFolder: string): WorkspaceMetadata {
  const afterPathReplace = replaceOrderedPath(metadata, oldPath, newPath);
  const oldOrder = (afterPathReplace.noteOrder[oldFolder] ?? []).filter((path) => path !== newPath);
  const newOrder = [...(afterPathReplace.noteOrder[newFolder] ?? []).filter((path) => path !== newPath), newPath];
  return {
    ...afterPathReplace,
    noteOrder: {
      ...afterPathReplace.noteOrder,
      [oldFolder]: oldOrder,
      [newFolder]: newOrder,
    },
  };
}

export function moveFolderInMetadata(metadata: WorkspaceMetadata, oldPath: string, newPath: string, oldParent: string, newParent: string): WorkspaceMetadata {
  const replaced = replaceFolderPathPrefix(metadata, oldPath, newPath);
  const oldOrder = (replaced.folderOrder[oldParent] ?? []).filter((path) => path !== newPath);
  const newOrder = [...(replaced.folderOrder[newParent] ?? []).filter((path) => path !== newPath), newPath];
  return {
    ...replaced,
    folderOrder: {
      ...replaced.folderOrder,
      [oldParent]: oldOrder,
      [newParent]: newOrder,
    },
  };
}

export function replaceFolderPathPrefix(metadata: WorkspaceMetadata, oldPrefix: string, newPrefix: string): WorkspaceMetadata {
  const folderOrder = Object.fromEntries(
    Object.entries(metadata.folderOrder).map(([folder, paths]) => [
      replacePathPrefix(folder, oldPrefix, newPrefix),
      paths.map((path) => replacePathPrefix(path, oldPrefix, newPrefix)),
    ]),
  );
  const noteOrder = Object.fromEntries(
    Object.entries(metadata.noteOrder).map(([folder, paths]) => [
      replacePathPrefix(folder, oldPrefix, newPrefix),
      paths.map((path) => replacePathPrefix(path, oldPrefix, newPrefix)),
    ]),
  );
  const pinnedNotes = Object.fromEntries(Object.entries(metadata.pinnedNotes).map(([path, pinned]) => [replacePathPrefix(path, oldPrefix, newPrefix), pinned]));
  const folderIcons = Object.fromEntries(Object.entries(metadata.folderIcons).map(([path, icon]) => [replacePathPrefix(path, oldPrefix, newPrefix), icon]));
  const folderColors = Object.fromEntries(Object.entries(metadata.folderColors).map(([path, color]) => [replacePathPrefix(path, oldPrefix, newPrefix), color]));
  const expandedFolders = Object.fromEntries(Object.entries(metadata.expandedFolders).map(([path, expanded]) => [replacePathPrefix(path, oldPrefix, newPrefix), expanded]));
  const noteIcons = Object.fromEntries(Object.entries(metadata.noteIcons).map(([path, icon]) => [replacePathPrefix(path, oldPrefix, newPrefix), icon]));
  const notePositions = Object.fromEntries(
    Object.entries(metadata.notePositions).map(([path, position]) => {
      const nextPath = replacePathPrefix(path, oldPrefix, newPrefix);
      return [nextPath, { ...position, path: nextPath }];
    }),
  );
  const bookmarks = metadata.bookmarks.map((bookmark) => ({
    ...bookmark,
    path: replacePathPrefix(bookmark.path, oldPrefix, newPrefix),
  }));
  return { ...metadata, folderOrder, noteOrder, pinnedNotes, folderIcons, folderColors, expandedFolders, noteIcons, notePositions, bookmarks };
}

export function removeFolderFromMetadata(metadata: WorkspaceMetadata, folderPath: string): WorkspaceMetadata {
  const isInFolder = (path: string) => path === folderPath || path.startsWith(`${folderPath}/`);
  return {
    ...metadata,
    folderOrder: Object.fromEntries(
      Object.entries(metadata.folderOrder)
        .filter(([folder]) => !isInFolder(folder))
        .map(([folder, paths]) => [folder, paths.filter((path) => !isInFolder(path))]),
    ),
    noteOrder: Object.fromEntries(Object.entries(metadata.noteOrder).filter(([folder]) => !isInFolder(folder))),
    pinnedNotes: Object.fromEntries(Object.entries(metadata.pinnedNotes).filter(([path]) => !isInFolder(path))),
    folderIcons: Object.fromEntries(Object.entries(metadata.folderIcons).filter(([path]) => !isInFolder(path))),
    folderColors: Object.fromEntries(Object.entries(metadata.folderColors).filter(([path]) => !isInFolder(path))),
    expandedFolders: Object.fromEntries(Object.entries(metadata.expandedFolders).filter(([path]) => !isInFolder(path))),
    noteIcons: Object.fromEntries(Object.entries(metadata.noteIcons).filter(([path]) => !isInFolder(path))),
    notePositions: Object.fromEntries(Object.entries(metadata.notePositions).filter(([path]) => !isInFolder(path))),
    bookmarks: metadata.bookmarks.filter((bookmark) => !isInFolder(bookmark.path)),
  };
}

export function setMetadataValue(metadata: WorkspaceMetadata, key: "folderIcons" | "folderColors" | "noteIcons", path: string, value: string): WorkspaceMetadata {
  const values: Record<string, string> = { ...metadata[key] };
  if (value) {
    values[path] = value;
  } else {
    delete values[path];
  }
  return { ...metadata, [key]: values };
}

export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}
