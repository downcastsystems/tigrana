import type { DocumentExportFormat } from "../lib/documentExportTargets";
import {
  Bookmark,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutList,
  MoveRight,
  Palette,
  Printer,
  Download,
  PanelRightOpen,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useId, useState } from "react";
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

function DocumentContextSubmenu({ label, onSelect }: {
  label: "Export";
  onSelect: (format: DocumentExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const id = useId();
  const focusFirst = () => panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!panel.current || !trigger.current) return;
      const parent = trigger.current.closest(".context-menu")!.getBoundingClientRect();
      const anchor = trigger.current.getBoundingClientRect();
      const rect = panel.current.getBoundingClientRect();
      const left = parent.right + rect.width > window.innerWidth - 8 ? parent.left - rect.width + 1 : parent.right - 1;
      panel.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
      panel.current.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8))}px`;
    };
    position();
    if (focusOnOpen.current) { focusFirst(); focusOnOpen.current = false; }
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);
  const enter = () => {
    if (open) focusFirst();
    else { focusOnOpen.current = true; setOpen(true); }
  };
  return <div className="context-document-submenu"
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={event => { event.stopPropagation(); enter(); }}
      onKeyDown={event => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); enter(); }
      }}>
      <Download size={14} /><span>{label}</span><ChevronRight className="context-submenu-arrow" size={14} />
    </button>
    {open && <div ref={panel} id={id} className="context-menu context-document-submenu-panel" role="menu" aria-label={label}
      onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "ArrowLeft") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return;
        }
        const items = [...panel.current!.querySelectorAll<HTMLButtonElement>("button")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % items.length
          : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
        if (next !== undefined) { event.preventDefault(); event.stopPropagation(); items[next].focus(); }
      }}>
      <button type="button" role="menuitem" onClick={() => onSelect("pdf")}><FileText size={14} /><span>PDF…</span></button>
      <button type="button" role="menuitem" onClick={() => onSelect("docx")}><FileText size={14} /><span>Word document…</span></button>
      <button type="button" role="menuitem" onClick={() => onSelect("markdown")}><FileText size={14} /><span>Markdown…</span></button>
      <button type="button" role="menuitem" onClick={() => onSelect("html")}><FileText size={14} /><span>HTML…</span></button>
    </div>}
  </div>;
}

export function TabContextMenu({
  onCopyFilePath,
  state,
  onClose,
  onCloseAll,
  onCloseTab,
}: {
  onCopyFilePath?: () => void;
  state: TabContextMenuState;
  onClose: () => void;
  onCloseAll: () => void;
  onCloseTab: () => void;
}) {
  const { menuRef, menuStyle } = useClampedContextMenuPosition(state.x, state.y);

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
      {onCopyFilePath ? <button type="button" onClick={onCopyFilePath}><Copy size={14} /><span>Copy File Path</span></button> : null}
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
  onCopyFilePath,
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
  onPrint,
  onExport,
  onRenameFolder,
  onSetFolderColor,
  onSetFolderIcon,
  onSetNoteIcon,
  onVersionHistory,
  onToggleBookmark,
  onClose,
}: {
  onCopyFilePath: () => void;
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
  onPrint: () => void;
  onExport: (format: DocumentExportFormat) => void;
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
          <button type="button" onClick={onCopyFilePath}><Copy size={14} /><span>Copy File Path</span></button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          <div className="context-menu-separator" role="separator" />
          <DocumentContextSubmenu label="Export" onSelect={onExport} />
          <button type="button" onClick={onPrint}><Printer size={14} /><span>Print…</span></button>
          <div className="context-menu-separator" role="separator" />
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
          <button type="button" onClick={onCopyFilePath}><Copy size={14} /><span>Copy File Path</span></button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          <div className="context-menu-separator" role="separator" />
          <DocumentContextSubmenu label="Export" onSelect={onExport} />
          <div className="context-menu-separator" role="separator" />
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

export function FilePathContextMenu({ x, y, notebookActions, onCopy, onReveal, onClose }: {
  x: number;
  y: number;
  notebookActions?: { onNew: () => void; onOpen: () => void; onManage: () => void };
  onCopy: () => void;
  onReveal?: () => void;
  onClose: () => void;
}) {
  const { menuRef, menuStyle } = useClampedContextMenuPosition(x, y);
  return <div className="context-menu file-path-context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
    {notebookActions ? <>
      <button type="button" onClick={notebookActions.onNew}><Plus size={14} /><span>New Notebook</span></button>
      <button type="button" onClick={notebookActions.onOpen}><FolderOpen size={14} /><span>Open Notebook</span></button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" onClick={notebookActions.onManage}><Settings size={14} /><span>Manage Notebooks</span></button>
      <div className="context-menu-separator" role="separator" />
    </> : null}
    <button type="button" onClick={onCopy}><Copy size={14} /><span>Copy File Path</span></button>
    {onReveal ? <button type="button" onClick={onReveal}><FolderOpen size={14} /><span>Reveal in Finder</span></button> : null}
  </div>;
}
