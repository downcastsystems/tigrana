import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { notebookStorage, type FolderSiblingPlacement, type NotebookStorage } from "./notebookStorage";
import {
  moveFolderInMetadata,
  moveNoteInMetadata,
  mergeWorkspaceMetadataChanges,
  replaceFolderPathPrefix,
  replaceOrderedPath,
  replacePathPrefix,
} from "./notebookMetadata";
import type { FolderEntry, NavigationStyle, NoteEntry, WorkspaceMetadata } from "../types";
import { replaceNoteTabPath, replaceNoteTabPathPrefix, type NoteTab } from "./noteTabHistory";

type NoteEditLock = {
  workspace: string;
  path: string;
  windowLabel: string;
};

type UpdateMetadata = (
  updater: (current: WorkspaceMetadata) => WorkspaceMetadata,
  options?: { persist?: boolean },
) => void;

type DurablePathMutationScope = {
  path: string;
  includesDescendants: boolean;
};

type NotebookPathMutationOptions = {
  activePath: string | null;
  activeNoteLockRef: MutableRefObject<NoteEditLock | null>;
  folders: FolderEntry[];
  getMetadata: () => WorkspaceMetadata;
  navigationStyle: NavigationStyle;
  notes: NoteEntry[];
  refreshWorkspace: (workspace: string) => Promise<void>;
  selectedFolder: string;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setOpenTabs: Dispatch<SetStateAction<NoteTab[]>>;
  setSelectedFolder: Dispatch<SetStateAction<string>>;
  adoptMetadata?: (metadata: WorkspaceMetadata) => void;
  updateMetadata: UpdateMetadata;
  workspace: string;
  storage?: Pick<NotebookStorage, "capabilities" | "moveFolder" | "moveNote" | "readWorkspaceMetadata" | "renameFolder" | "renameNote">;
  rebasePendingMetadata?: (
    forward: (current: WorkspaceMetadata) => WorkspaceMetadata,
    reverse: (current: WorkspaceMetadata) => WorkspaceMetadata,
    localMetadata: WorkspaceMetadata,
  ) => void;
  runDurableMutation?: <T>(operation: () => Promise<T>, scope: DurablePathMutationScope) => Promise<T>;
  isWorkspaceActive?: () => boolean;
};

type MoveFolderOptions = {
  selectMovedFolder?: boolean;
  siblingPlacement?: FolderSiblingPlacement;
};

export function createNotebookPathMutations({
  activePath,
  activeNoteLockRef,
  folders,
  getMetadata,
  navigationStyle,
  notes,
  refreshWorkspace,
  selectedFolder,
  setActivePath,
  setOpenTabs,
  setSelectedFolder,
  adoptMetadata,
  updateMetadata,
  workspace,
  storage = notebookStorage,
  rebasePendingMetadata = () => {},
  runDurableMutation = (operation) => operation(),
  isWorkspaceActive = () => true,
}: NotebookPathMutationOptions) {
  const applyAuthoritativeMetadata = adoptMetadata ?? ((next: WorkspaceMetadata) => {
    updateMetadata(() => next, { persist: false });
  });
  const syncMetadataAfterPathMutation = async (
    base: WorkspaceMetadata,
    repair: (current: WorkspaceMetadata) => WorkspaceMetadata,
    reverseRepair: (current: WorkspaceMetadata) => WorkspaceMetadata,
  ) => {
    if (storage.capabilities.atomicPathMutations) {
      let reconciled: WorkspaceMetadata;
      try {
        const persisted = await storage.readWorkspaceMetadata(workspace);
        reconciled = mergeWorkspaceMetadataChanges(repair(base), repair(getMetadata()), persisted);
      } catch {
        reconciled = repair(getMetadata());
      }
      applyAuthoritativeMetadata(reconciled);
      rebasePendingMetadata(repair, reverseRepair, reconciled);
      return;
    }
    updateMetadata(repair);
  };
  const replaceOpenTabPath = (oldPath: string, newPath: string) => {
    setOpenTabs((current) => current.map((tab) => replaceNoteTabPath(tab, oldPath, newPath)));
  };

  const replaceOpenTabPrefix = (oldPrefix: string, newPrefix: string) => {
    setOpenTabs((current) => current.map((tab) => replaceNoteTabPathPrefix(tab, oldPrefix, newPrefix)));
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

    const moved = await runDurableMutation(async () => {
      const metadataBeforeMutation = getMetadata();
      const result = await storage.moveNote(workspace, path, targetParentPath);
      await syncMetadataAfterPathMutation(
        metadataBeforeMutation,
        (current) => moveNoteInMetadata(current, path, result.path, sourceNote.parent_path, result.parent_path),
        (current) => moveNoteInMetadata(current, result.path, path, result.parent_path, sourceNote.parent_path),
      );
      return result;
    }, { path, includesDescendants: false });
    if (!isWorkspaceActive()) return moved;
    repairActiveNotePath(path, moved.path);
    replaceOpenTabPath(path, moved.path);
    setSelectedFolder(moved.parent_path);
    await refreshWorkspace(workspace);
    return moved;
  };

  const renameNote = async (path: string, title: string) => {
    const renamed = await runDurableMutation(async () => {
      const metadataBeforeMutation = getMetadata();
      const result = await storage.renameNote(workspace, path, title);
      await syncMetadataAfterPathMutation(
        metadataBeforeMutation,
        (current) => replaceOrderedPath(current, path, result.path),
        (current) => replaceOrderedPath(current, result.path, path),
      );
      return result;
    }, { path, includesDescendants: false });
    if (!isWorkspaceActive()) return renamed;
    repairActiveNotePath(path, renamed.path);
    replaceOpenTabPath(path, renamed.path);
    await refreshWorkspace(workspace);
    return renamed;
  };

  const moveFolder = async (path: string, targetParentPath: string, options: MoveFolderOptions = {}) => {
    const sourceFolder = folders.find((entry) => entry.path === path);
    if (!sourceFolder || !sourceFolder.path || sourceFolder.parent_path === targetParentPath) return null;

    const moved = await runDurableMutation(async () => {
      const metadataBeforeMutation = getMetadata();
      const result = await storage.moveFolder(workspace, path, targetParentPath, options.siblingPlacement);
      const repair = (current: WorkspaceMetadata) => {
        const relocated = moveFolderInMetadata(current, path, result.path, sourceFolder.parent_path, result.parent_path);
        if (!options.siblingPlacement) return relocated;

        const targetFolder = folders.find((entry) => entry.path === options.siblingPlacement?.targetPath);
        if (!targetFolder) return relocated;

        const siblingPaths = folders
          .filter((folder) => folder.parent_path === targetFolder.parent_path && folder.path !== sourceFolder.path)
          .map((folder) => folder.path)
          .filter((siblingPath) => siblingPath !== result.path)
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
        siblingPaths.splice(targetIndex + (options.siblingPlacement.placement === "after" ? 1 : 0), 0, result.path);
        return {
          ...relocated,
          folderOrder: {
            ...relocated.folderOrder,
            [targetFolder.parent_path]: siblingPaths,
          },
        };
      };
      await syncMetadataAfterPathMutation(
        metadataBeforeMutation,
        repair,
        (current) => moveFolderInMetadata(current, result.path, path, result.parent_path, sourceFolder.parent_path),
      );
      return result;
    }, { path, includesDescendants: true });

    if (!isWorkspaceActive()) return moved;
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
    const renamed = await runDurableMutation(async () => {
      const metadataBeforeMutation = getMetadata();
      const result = await storage.renameFolder(workspace, path, name);
      await syncMetadataAfterPathMutation(
        metadataBeforeMutation,
        (current) => replaceFolderPathPrefix(current, path, result.path),
        (current) => replaceFolderPathPrefix(current, result.path, path),
      );
      return result;
    }, { path, includesDescendants: true });
    if (!isWorkspaceActive()) return renamed;
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
    if (!isWorkspaceActive()) return renamed;
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
