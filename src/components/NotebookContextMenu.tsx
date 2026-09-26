import {
  Bookmark,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutList,
  MoveRight,
  Palette,
  PanelRightOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ContextMenuState, TabContextMenuState } from "../lib/notebookNavigation";

function useClampedContextMenuPosition(x: number, y: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuStyle = useMemo<CSSProperties>(() => ({ left: x, top: y }), [x, y]);

  const updateMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const padding = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
    const left = Math.min(Math.max(x, padding), maxLeft);
    const top = Math.min(Math.max(y, padding), maxTop);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [x, y]);

  useLayoutEffect(() => {
    updateMenuPosition();
  });

  useEffect(() => {
    window.addEventListener("resize", updateMenuPosition);
    return () => window.removeEventListener("resize", updateMenuPosition);
  }, [updateMenuPosition]);

  return { menuRef, menuStyle };
}

export function TabContextMenu({
  state,
  onClose,
  onCloseAll,
  onCloseTab,
}: {
  state: TabContextMenuState;
  onClose: () => void;
  onCloseAll: () => void;
  onCloseTab: () => void;
}) {
  const { menuRef, menuStyle } = useClampedContextMenuPosition(state.x, state.y);

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
      <button type="button" onClick={onCloseTab}>
        <X size={14} />
        <span>Close Tab</span>
      </button>
      <button type="button" onClick={onCloseAll}>
        <Trash2 size={14} />
        <span>Close All Tabs</span>
      </button>
    </div>
  );
}

export function ContextMenu({
  activeCreateNoteParentName,
  createFolderParentName,
  createNoteParentName,
  folderColorSubject,
  isBookmarked,
  showCreateSection,
  state,
  onCreateFolder,
  onCreateNote,
  onCreateNoteInActiveFolder,
  onCreateSection,
  onDelete,
  onDuplicate,
  onMoveTo,
  onOpenInNewTab,
  onOpenInNewWindow,
  onReveal,
  onRenameFolder,
  onSetFolderColor,
  onSetFolderIcon,
  onSetNoteIcon,
  onVersionHistory,
  onToggleBookmark,
  onClose,
}: {
  activeCreateNoteParentName?: string;
  createFolderParentName: string;
  createNoteParentName: string;
  folderColorSubject: "folder" | "section";
  isBookmarked: boolean;
  showCreateSection: boolean;
  state: ContextMenuState;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onCreateNoteInActiveFolder?: () => void;
  onCreateSection: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveTo: () => void;
  onOpenInNewTab: () => void;
  onOpenInNewWindow: () => void;
  onReveal: () => void;
  onRenameFolder: () => void;
  onSetFolderColor: () => void;
  onSetFolderIcon: () => void;
  onSetNoteIcon: () => void;
  onVersionHistory: () => void;
  onToggleBookmark: () => void;
  onClose: () => void;
}) {
  const { menuRef, menuStyle } = useClampedContextMenuPosition(state.x, state.y);
  const showCreateFolder = !showCreateSection || (state.kind === "folder" && state.path !== "");

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
      {state.kind !== "note" ? (
        <>
          <button type="button" onClick={onCreateNote}>
            <FileText size={14} />
            <span>New Note in {createNoteParentName}</span>
          </button>
          {activeCreateNoteParentName && onCreateNoteInActiveFolder ? (
            <button type="button" onClick={onCreateNoteInActiveFolder}>
              <FileText size={14} />
              <span>New Note in {activeCreateNoteParentName}</span>
            </button>
          ) : null}
          {state.kind === "empty" ? (
            <div className="context-menu-separator" role="separator" />
          ) : null}
          {showCreateFolder ? (
            <button type="button" onClick={onCreateFolder}>
              <Folder size={14} />
              <span>New Folder in {createFolderParentName}</span>
            </button>
          ) : null}
        </>
      ) : null}
      {showCreateSection ? (
        <button type="button" onClick={onCreateSection}>
          <LayoutList size={14} />
          <span>New Section</span>
        </button>
      ) : null}
      {state.kind === "folder" ? (
        <>
          <button type="button" onClick={onOpenInNewWindow}>
            <PanelRightOpen size={14} />
            <span>Open in New Window</span>
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          {state.path ? (
            <>
              <button type="button" onClick={onToggleBookmark}>
                <Bookmark size={14} />
                <span>{isBookmarked ? "Remove Bookmark" : "Add Bookmark"}</span>
              </button>
              <button type="button" onClick={onMoveTo}>
                <MoveRight size={14} />
                <span>Move to…</span>
              </button>
              <button type="button" onClick={onRenameFolder}>
                <Pencil size={14} />
                <span>Rename Folder</span>
              </button>
            </>
          ) : null}
          <button type="button" onClick={onSetFolderIcon}>
            <FileText size={14} />
            <span>Change {folderColorSubject === "section" ? "Section" : "Folder"} Icon</span>
          </button>
          <button type="button" onClick={onSetFolderColor}>
            <Palette size={14} />
            <span>Change {folderColorSubject === "section" ? "Section" : "Folder"} Color</span>
          </button>
        </>
      ) : null}
      {state.kind === "note" ? (
        <>
          <button type="button" onClick={onOpenInNewTab}>
            <Plus size={14} />
            <span>Open in New Tab</span>
          </button>
          <button type="button" onClick={onOpenInNewWindow}>
            <PanelRightOpen size={14} />
            <span>Open in New Window</span>
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          <button type="button" onClick={onToggleBookmark}>
            <Bookmark size={14} />
            <span>{isBookmarked ? "Remove Bookmark" : "Add Bookmark"}</span>
          </button>
          <button type="button" onClick={onMoveTo}>
            <MoveRight size={14} />
            <span>Move to…</span>
          </button>
          <button type="button" onClick={onDuplicate}>
            <Copy size={14} />
            <span>Duplicate</span>
          </button>
          <button type="button" onClick={onSetNoteIcon}>
            <FileText size={14} />
            <span>Change Note Icon</span>
          </button>
          <button type="button" onClick={onVersionHistory}>
            <History size={14} />
            <span>Version History</span>
          </button>
        </>
      ) : null}
      {state.kind !== "empty" && state.path ? (
        <button className="danger-item" type="button" onClick={onDelete}>
          <Trash2 size={14} />
          <span>{state.kind === "note"
            ? "Delete Note"
            : folderColorSubject === "section" ? "Delete Section" : "Delete Folder"}</span>
        </button>
      ) : null}
    </div>
  );
}
