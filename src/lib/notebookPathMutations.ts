import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  moveFolder as moveFolderOnDisk,
  moveNote as moveNoteOnDisk,
  renameFolder as renameFolderOnDisk,
  renameNote as renameNoteOnDisk,
} from "./notesApi";
import type { FolderEntry, NavigationStyle, NoteEntry, WorkspaceMetadata } from "../types";

type NoteTab = {
  id: string;
  path: string | null;
};

type NoteEditLock = {
  workspace: string;
  path: string;
  windowLabel: string;
};

type UpdateMetadata = (updater: (current: WorkspaceMetadata) => WorkspaceMetadata) => void;

type NotebookPathMutationOptions = {
  activePath: string | null;
  activeNoteLockRef: MutableRefObject<NoteEditLock | null>;
  folders: FolderEntry[];
  navigationStyle: NavigationStyle;
  notes: NoteEntry[];
  refreshWorkspace: (workspace: string) => Promise<void>;
  selectedFolder: string;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setOpenTabs: Dispatch<SetStateAction<NoteTab[]>>;
  setSelectedFolder: Dispatch<SetStateAction<string>>;
  updateMetadata: UpdateMetadata;
  workspace: string;
};

type MoveFolderOptions = {
  selectMovedFolder?: boolean;
  siblingPlacement?: {
    targetPath: string;
    placement: "before" | "after";
  };
};

export function createNotebookPathMutations({
  activePath,
  activeNoteLockRef,
  folders,
  navigationStyle,
  notes,
  refreshWorkspace,
  selectedFolder,
  setActivePath,
  setOpenTabs,
  setSelectedFolder,
  updateMetadata,
  workspace,
}: NotebookPathMutationOptions) {
  const replaceOpenTabPath = (oldPath: string, newPath: string) => {
    setOpenTabs((current) => current.map((tab) => (tab.path === oldPath ? { ...tab, path: newPath } : tab)));
  };

  const replaceOpenTabPrefix = (oldPrefix: string, newPrefix: string) => {
    setOpenTabs((current) =>
      current.map((tab) => (tab.path ? { ...tab, path: replacePathPrefix(tab.path, oldPrefix, newPrefix) } : tab)),
    );
  };

  const repairActiveNotePath = (oldPath: string, newPath: string) => {
    if (activePath !== oldPath) return;
    setActivePath(newPath);
    if (activeNoteLockRef.current?.path === oldPath) {
      activeNoteLockRef.current = { ...activeNoteLockRef.current, path: newPath };
    }
  };

  const repairActiveNotePrefix = (oldPrefix: string, newPrefix: string) => {
    if (!activePath?.startsWith(`${oldPrefix}/`)) return;
    const nextActivePath = replacePathPrefix(activePath, oldPrefix, newPrefix);
    setActivePath(nextActivePath);
    if (activeNoteLockRef.current?.path === activePath) {
      activeNoteLockRef.current = { ...activeNoteLockRef.current, path: nextActivePath };
    }
  };

  const moveNote = async (path: string, targetParentPath: string) => {
    const sourceNote = notes.find((entry) => entry.path === path);
    if (!sourceNote || sourceNote.parent_path === targetParentPath) return null;

    const moved = await moveNoteOnDisk(workspace, path, targetParentPath);
    updateMetadata((current) => moveNoteInMetadata(current, path, moved.path, sourceNote.parent_path, moved.parent_path));
    repairActiveNotePath(path, moved.path);
    replaceOpenTabPath(path, moved.path);
    setSelectedFolder(moved.parent_path);
    await refreshWorkspace(workspace);
    return moved;
  };

  const renameNote = async (path: string, title: string) => {
    const renamed = await renameNoteOnDisk(workspace, path, title);
    updateMetadata((current) => replaceOrderedPath(current, path, renamed.path));
    repairActiveNotePath(path, renamed.path);
    replaceOpenTabPath(path, renamed.path);
    await refreshWorkspace(workspace);
    return renamed;
  };

  const moveFolder = async (path: string, targetParentPath: string, options: MoveFolderOptions = {}) => {
    const sourceFolder = folders.find((entry) => entry.path === path);
    if (!sourceFolder || !sourceFolder.path || sourceFolder.parent_path === targetParentPath) return null;

    const moved = await moveFolderOnDisk(workspace, path, targetParentPath);
    updateMetadata((current) => {
      const relocated = moveFolderInMetadata(current, path, moved.path, sourceFolder.parent_path, moved.parent_path);
      if (!options.siblingPlacement) return relocated;

      const targetFolder = folders.find((entry) => entry.path === options.siblingPlacement?.targetPath);
      if (!targetFolder) return relocated;

      const siblingPaths = folders
        .filter((folder) => folder.parent_path === targetFolder.parent_path && folder.path !== sourceFolder.path)
        .map((folder) => folder.path)
        .filter((siblingPath) => siblingPath !== moved.path)
        .sort((a, b) => {
          const order = relocated.folderOrder[targetFolder.parent_path] ?? [];
          const aIndex = order.indexOf(a);
          const bIndex = order.indexOf(b);
          if (aIndex !== -1 || bIndex !== -1) {
            return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
          }
          const aName = folders.find((folder) => folder.path === a)?.name ?? a;
          const bName = folders.find((folder) => folder.path === b)?.name ?? b;
          return aName.localeCompare(bName);
        });
      const targetIndex = Math.max(0, siblingPaths.indexOf(targetFolder.path));
      siblingPaths.splice(targetIndex + (options.siblingPlacement.placement === "after" ? 1 : 0), 0, moved.path);
      return {
        ...relocated,
        folderOrder: {
          ...relocated.folderOrder,
          [targetFolder.parent_path]: siblingPaths,
        },
      };
    });

    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) {
      setSelectedFolder(replacePathPrefix(selectedFolder, path, moved.path));
    } else if (options.selectMovedFolder) {
      setSelectedFolder(moved.path);
    }
    repairActiveNotePrefix(path, moved.path);
    replaceOpenTabPrefix(path, moved.path);
    await refreshWorkspace(workspace);
    return moved;
  };

  const renameFolder = async (path: string, name: string) => {
    const renamed = await renameFolderOnDisk(workspace, path, name);
    updateMetadata((current) => replaceFolderPathPrefix(current, path, renamed.path));
    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) {
      setSelectedFolder(replacePathPrefix(selectedFolder, path, renamed.path));
    }
    repairActiveNotePrefix(path, renamed.path);
    replaceOpenTabPrefix(path, renamed.path);
    await refreshWorkspace(workspace);
    return renamed;
  };

  const renameActiveNote = async (path: string, title: string) => {
    const renamed = await renameNote(path, title);
    setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(renamed.parent_path) : renamed.parent_path);
    return renamed;
  };

  return {
    moveFolder,
    moveNote,
    renameActiveNote,
    renameFolder,
    renameNote,
  };
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
  if (pinnedNotes[oldPath]) {
    delete pinnedNotes[oldPath];
    pinnedNotes[newPath] = true;
  }
  const noteIcons = { ...metadata.noteIcons };
  if (noteIcons[oldPath]) {
    noteIcons[newPath] = noteIcons[oldPath];
    delete noteIcons[oldPath];
  }
  const notePositions = { ...metadata.notePositions };
  if (notePositions[oldPath]) {
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

export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}

function getTopLevelFolderPath(path: string) {
  if (!path) return "";
  return path.split("/")[0] ?? "";
}
