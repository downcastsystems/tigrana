import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  moveFolder as moveFolderOnDisk,
  moveNote as moveNoteOnDisk,
  renameFolder as renameFolderOnDisk,
  renameNote as renameNoteOnDisk,
} from "./notesApi";
import {
  moveFolderInMetadata,
  moveNoteInMetadata,
  replaceFolderPathPrefix,
  replaceOrderedPath,
  replacePathPrefix,
} from "./notebookMetadata";
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

function getTopLevelFolderPath(path: string) {
  if (!path) return "";
  return path.split("/")[0] ?? "";
}
