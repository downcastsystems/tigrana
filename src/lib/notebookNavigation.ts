import { getNotebookName } from "./notebookMetadata";
import { decodeTitleFromFilename } from "./notebookNames";
import type { FolderEntry, NoteEntry } from "../types";

export type ContextMenuState =
  | { x: number; y: number; kind: "empty"; parentPath?: string; source?: "sections-pane" }
  | { x: number; y: number; kind: "folder"; path: string; source?: "sections-pane" }
  | { x: number; y: number; kind: "note"; path: string; source?: "sections-pane" };

export type TabContextMenuState = { x: number; y: number; tabId: string };

export type ContextMenuTarget =
  | { kind: "empty"; parentPath?: string; source?: "sections-pane" }
  | { kind: "folder"; path: string; source?: "sections-pane" }
  | { kind: "note"; path: string; source?: "sections-pane" };

export type OpenTarget = { kind: "folder" | "note"; path: string };

export type DragItem =
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string }
  | null;

export type DropPlacement = "before" | "after";

export type FolderOrderingMode = "alphabetical" | "custom";

export type FolderDropIntent =
  | { kind: "before"; path: string }
  | { kind: "after"; path: string }
  | { kind: "into"; path: string };

export type NoteCreationTarget = {
  afterPath?: string;
  parentName: string;
  parentPath: string;
};

export type FolderCreationTarget = Pick<NoteCreationTarget, "parentName" | "parentPath">;

export function displayFolderName(path: string, folders: FolderEntry[], workspace: string) {
  if (!path) return getNotebookName(workspace);
  const match = folders.find((folder) => folder.path === path)?.name;
  if (match) return match;
  const tail = path.split("/").at(-1) || path;
  return decodeTitleFromFilename(tail);
}

export function buildNoteCreationTargets(
  baseParentPath: string,
  currentParentPath: string,
  activeNote: NoteEntry | null,
  folders: FolderEntry[],
  workspace: string,
): NoteCreationTarget[] {
  const baseTarget: NoteCreationTarget = {
    parentName: displayFolderName(baseParentPath, folders, workspace),
    parentPath: baseParentPath,
    ...(activeNote?.parent_path === baseParentPath ? { afterPath: activeNote.path } : {}),
  };
  if (currentParentPath === baseParentPath) return [baseTarget];
  return [
    baseTarget,
    {
      ...(activeNote?.parent_path === currentParentPath ? { afterPath: activeNote.path } : {}),
      parentName: displayFolderName(currentParentPath, folders, workspace),
      parentPath: currentParentPath,
    },
  ];
}

export type DraftNote = {
  parentPath: string;
};
