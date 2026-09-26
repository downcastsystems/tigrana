import { Folder, Plus, Search } from "lucide-react";
import type { BookmarkView, FolderNode } from "../../lib/notebookMetadata";
import type { RecentNotebook } from "../../lib/notebookSession";
import type { BookmarkEntry, WorkspaceMetadata } from "../../types";
import { IconMark } from "../IconBrowser";
import { BookmarksSection } from "./BookmarksSection";
import { NotebookFooter } from "./NotebookMenu";
import type { ContextMenuTarget, DragItem, DropPlacement } from "../../lib/notebookNavigation";

// ---------- Section View first pane (root folders only) ----------
export function SectionViewFolderPane({
  bookmarks,
  bookmarksExpanded,
  draggingItem,
  dropTargetFolder,
  folders,
  menuOpen,
  metadata,
  recentNotebooks,
  reorderHover,
  selectedFolder,
  suppressClickRef,
  workspace,
  onContextMenu,
  onCreateFolder,
  onDropOnFolder,
  onDropTargetChange,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onRemoveBookmark,
  onReorderBookmark,
  onSectionPointerDragStart,
  onSelectBookmark,
  onSelectFolder,
  onSelectNotebook,
  onToggleBookmarksExpanded,
  onToggleMenu,
  onToggleSearch,
}: {
  bookmarks: BookmarkView[];
  bookmarksExpanded: boolean;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folders: FolderNode[];
  menuOpen: boolean;
  metadata: WorkspaceMetadata;
  recentNotebooks: RecentNotebook[];
  reorderHover: { path: string; placement: DropPlacement } | null;
  selectedFolder: string;
  suppressClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onCreateFolder: (parentPath?: string) => void;
  onDropOnFolder?: (path: string, item?: Exclude<DragItem, null>) => void;
  onDropTargetChange?: (path: string | null) => void;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onRemoveBookmark: (id: string) => void;
  onReorderBookmark: (draggedId: string, targetId: string, placement: DropPlacement) => void;
  onSectionPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectBookmark: (bookmark: BookmarkEntry) => void;
  onSelectFolder: (path: string) => void;
  onSelectNotebook: (path: string) => void;
  onToggleBookmarksExpanded: () => void;
  onToggleMenu: (event: React.MouseEvent) => void;
  onToggleSearch: () => void;
}) {
  const rootSectionColor = metadata.folderColors[""];
  // Note-into-section and nested-folder-into-section drops still use HTML5 drag (the source notes/folders fire native drag).
  const folderDragItemFromEvent = (event: React.DragEvent): Exclude<DragItem, null> | null => {
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    return draggingItem ?? null;
  };

  return (
    <section
      className="folder-pane section-view-folder-pane"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-folder-path]")) return;
        onContextMenu(event, { kind: "empty", parentPath: "", source: "sections-pane" });
      }}
    >
      <div className="pane-header">
        <strong>Sections</strong>
        <div className="pane-actions">
          <button className="icon-button" type="button" disabled={!workspace} title="Search" onClick={onToggleSearch}>
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" disabled={!workspace} title="New Section" onClick={() => onCreateFolder("")}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <BookmarksSection
        bookmarks={bookmarks}
        expanded={bookmarksExpanded}
        onRemove={onRemoveBookmark}
        onReorder={onReorderBookmark}
        onSelect={onSelectBookmark}
        onToggle={onToggleBookmarksExpanded}
      />
      <div className="folder-tree">
        <div
          className={`folder-row${selectedFolder === "" ? " is-active" : ""}${dropTargetFolder === "" ? " is-drop-target" : ""}`}
          style={rootSectionColor ? { "--section-color": rootSectionColor } as React.CSSProperties : undefined}
          data-has-section-color={rootSectionColor ? "true" : "false"}
          data-folder-path=""
          onClick={() => onSelectFolder("")}
          onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: "", source: "sections-pane" })}
          onDragOver={(event) => {
            const item = folderDragItemFromEvent(event);
            if (!item) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange?.("");
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            onDropTargetChange?.(null);
          }}
          onDrop={(event) => {
            const item = folderDragItemFromEvent(event);
            if (!item) return;
            event.preventDefault();
            onDropTargetChange?.(null);
            onDropOnFolder?.("", item);
          }}
        >
          <span className="section-color-chip" aria-hidden="true" />
          <span className="tree-toggle"><span /></span>
          <button
            className="folder-select"
            type="button"
            onClick={(event) => { event.stopPropagation(); onSelectFolder(""); }}
          >
            <span>
              <IconMark value={metadata.folderIcons[""]} fallback={Folder} size={15} />
            </span>
            <span>Uncategorized</span>
          </button>
        </div>
        {folders.map((folder) => {
          const folderColor = metadata.folderColors[folder.path];
          const customIcon = metadata.folderIcons[folder.path];
          const indicatorPlacement = reorderHover?.path === folder.path ? reorderHover.placement : null;
          const rowClass = [
            "folder-row",
            selectedFolder === folder.path ? "is-active" : "",
            dropTargetFolder === folder.path && !indicatorPlacement ? "is-drop-target" : "",
            indicatorPlacement === "before" ? "is-reorder-before" : "",
            indicatorPlacement === "after" ? "is-reorder-after" : "",
          ].filter(Boolean).join(" ");
          const handleSelectClick = () => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onSelectFolder(folder.path);
          };
          return (
            <div
              key={folder.path}
              className={rowClass}
              style={folderColor ? { "--section-color": folderColor } as React.CSSProperties : undefined}
              data-has-section-color={folderColor ? "true" : "false"}
              data-folder-path={folder.path}
              onClick={handleSelectClick}
              onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path, source: "sections-pane" })}
              onPointerDown={(event) => onSectionPointerDragStart(folder.path, event)}
              // Still accept HTML5 drops from notes / nested folders (those sources use HTML5 drag).
              onDragOver={(event) => {
                const item = folderDragItemFromEvent(event);
                if (!item) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange?.(folder.path);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                onDropTargetChange?.(null);
              }}
              onDrop={(event) => {
                const item = folderDragItemFromEvent(event);
                if (!item) return;
                event.preventDefault();
                onDropTargetChange?.(null);
                onDropOnFolder?.(folder.path, item);
              }}
            >
              <span className="section-color-chip" aria-hidden="true" />
              <span className="tree-toggle"><span /></span>
              <button
                className="folder-select"
                type="button"
                onClick={(event) => { event.stopPropagation(); handleSelectClick(); }}
              >
                <span>
                  <IconMark value={customIcon} fallback={Folder} size={15} />
                </span>
                <span>{folder.name}</span>
              </button>
            </div>
          );
        })}
      </div>
      <NotebookFooter
        menuOpen={menuOpen}
        recentNotebooks={recentNotebooks}
        workspace={workspace}
        onManageNotebooks={onManageNotebooks}
        onNewNotebook={onNewNotebook}
        onOpenWorkspace={onOpenWorkspace}
        onSelectNotebook={onSelectNotebook}
        onToggleMenu={onToggleMenu}
      />
    </section>
  );
}
