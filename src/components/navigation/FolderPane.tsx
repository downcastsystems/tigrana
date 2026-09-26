import { ChevronDown, ChevronRight, Folder, Plus, Search } from "lucide-react";
import type { BookmarkView, FolderNode } from "../../lib/notebookMetadata";
import type { RecentNotebook } from "../../lib/notebookSession";
import type { BookmarkEntry, WorkspaceMetadata } from "../../types";
import { IconMark } from "../IconBrowser";
import { BookmarksSection } from "./BookmarksSection";
import { NotebookFooter } from "./NotebookMenu";
import type { ContextMenuTarget, DragItem, DropPlacement } from "../../lib/notebookNavigation";

export function FolderPane({
  bookmarks,
  bookmarksExpanded,
  disabled,
  draggingItem,
  dropTargetFolder,
  folders,
  menuOpen,
  metadata,
  recentNotebooks,
  selectedFolder,
  workspace,
  onCreateFolder,
  onContextMenu,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onDropOnFolderFallback,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onRemoveBookmark,
  onReorderBookmark,
  onSelectBookmark,
  onSelectNotebook,
  onSelectFolder,
  onSetFolderExpanded,
  onToggleBookmarksExpanded,
  onToggleSearch,
  onToggleMenu,
}: {
  bookmarks: BookmarkView[];
  bookmarksExpanded: boolean;
  disabled: boolean;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folders: FolderNode[];
  menuOpen: boolean;
  metadata: WorkspaceMetadata;
  recentNotebooks: RecentNotebook[];
  selectedFolder: string;
  workspace: string;
  onCreateFolder: (parentPath?: string) => void;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onDropOnFolderFallback: (path: string, item?: Exclude<DragItem, null>) => void;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onRemoveBookmark: (id: string) => void;
  onReorderBookmark: (draggedId: string, targetId: string, placement: DropPlacement) => void;
  onSelectBookmark: (bookmark: BookmarkEntry) => void;
  onSelectNotebook: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  onToggleBookmarksExpanded: () => void;
  onToggleSearch: () => void;
  onToggleMenu: (event: React.MouseEvent) => void;
}) {
  const getDropItem = (event: React.DragEvent): Exclude<DragItem, null> | undefined => {
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    return draggingItem ?? undefined;
  };

  return (
    <section className="folder-pane">
      <div className="pane-header">
        <strong>Folders</strong>
        <div className="pane-actions">
          <button className="icon-button" type="button" disabled={disabled} title="Search" onClick={onToggleSearch}>
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" disabled={disabled} title="Add" onClick={() => onCreateFolder(selectedFolder)}>
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
      <div
        className="folder-tree"
        onDragOver={(event) => {
          const folderRow = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folder-path]");
          if (!folderRow) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDropTargetChange(folderRow.dataset.folderPath ?? "");
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onDropTargetChange(null);
        }}
        onDrop={(event) => {
          const folderRow = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folder-path]");
          if (!folderRow) return;
          event.preventDefault();
          const path = folderRow.dataset.folderPath ?? "";
          const item = getDropItem(event);
          onDropTargetChange(null);
          onDropOnFolderFallback(path, item);
        }}
      >
        {folders.map((folder) => (
          <FolderRow
            key={folder.path || "root"}
            draggingItem={draggingItem}
            dropTargetFolder={dropTargetFolder}
            folder={folder}
            metadata={metadata}
            selectedFolder={selectedFolder}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDropTargetChange={onDropTargetChange}
            onDropOnFolder={onDropOnFolder}
            onSelectFolder={onSelectFolder}
            onSetFolderExpanded={onSetFolderExpanded}
          />
        ))}
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

function FolderRow({
  depth = 0,
  draggingItem,
  dropTargetFolder,
  folder,
  metadata,
  selectedFolder,
  onContextMenu,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onSelectFolder,
  onSetFolderExpanded,
}: {
  depth?: number;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folder: FolderNode;
  metadata: WorkspaceMetadata;
  selectedFolder: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onSelectFolder: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const isRoot = folder.path === "";
  const open = metadata.expandedFolders[folder.path] ?? true;
  const folderColor = metadata.folderColors[folder.path];
  const customIcon = metadata.folderIcons[folder.path];
  const canDrop =
    Boolean(draggingItem) &&
    (draggingItem?.kind === "note" || (draggingItem?.kind === "folder" && draggingItem.path !== folder.path && !folder.path.startsWith(`${draggingItem.path}/`)));

  const getDraggedItem = (event: React.DragEvent): Exclude<DragItem, null> | null => {
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    return draggingItem;
  };

  const canDropItem = (item: Exclude<DragItem, null> | null) => {
    if (!item) return false;
    return item.kind === "note" || (item.kind === "folder" && item.path !== folder.path && !folder.path.startsWith(`${item.path}/`));
  };

  const isDropEventAllowed = (event: React.DragEvent) => canDrop || hasDropPayload(event) || canDropItem(getDraggedItem(event));

  const hasDropPayload = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes("application/tigrana-note-path") || types.includes("application/tigrana-folder-path") || types.includes("text/plain");
  };

  return (
    <div className="folder-node">
      <div
        className={`${selectedFolder === folder.path ? "folder-row is-active" : "folder-row"} ${dropTargetFolder === folder.path ? "is-drop-target" : ""}`}
        style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
        data-folder-path={folder.path}
        draggable={!isRoot}
        onClick={() => onSelectFolder(folder.path)}
        onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path })}
        onDragStart={(event) => {
          if (isRoot) return;
          event.dataTransfer.setData("application/tigrana-folder-path", folder.path);
          event.dataTransfer.effectAllowed = "move";
          onDragStart({ kind: "folder", path: folder.path });
        }}
        onDragEnd={() => onDragStart(null)}
        onDragOver={(event) => {
          if (isDropEventAllowed(event)) {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange(folder.path);
          }
        }}
        onDragEnter={(event) => {
          if (isDropEventAllowed(event)) {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange(folder.path);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onDropTargetChange(null);
        }}
        onDrop={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onDropTargetChange(null);
          const item = getDraggedItem(event);
          if (item && canDropItem(item)) onDropOnFolder(folder.path, item);
        }}
      >
        <button className="tree-toggle" type="button" onClick={(event) => { event.stopPropagation(); onSetFolderExpanded(folder.path, !open); }}>
          {folder.children.length ? open ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span />}
        </button>
        <button className="folder-select" style={folderColor ? { color: folderColor } : undefined} type="button" onClick={(event) => { event.stopPropagation(); onSelectFolder(folder.path); }}>
          <span>
            <IconMark value={customIcon} fallback={Folder} size={15} />
          </span>
          <span>{folder.name}</span>
        </button>
      </div>
      {open && folder.children.length ? (
        <div className="tree-children">
          {folder.children.map((child) => (
            <FolderRow
              key={child.path}
              depth={depth + 1}
              draggingItem={draggingItem}
              dropTargetFolder={dropTargetFolder}
              folder={child}
              metadata={metadata}
              selectedFolder={selectedFolder}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDropTargetChange={onDropTargetChange}
              onDropOnFolder={onDropOnFolder}
              onSelectFolder={onSelectFolder}
              onSetFolderExpanded={onSetFolderExpanded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
