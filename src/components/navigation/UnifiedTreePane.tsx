import { ChevronDown, ChevronRight, FileText, Folder, Pin, Search } from "lucide-react";
import { useMemo } from "react";
import { orderFolders, orderNotes, type BookmarkView } from "../../lib/notebookMetadata";
import type { RecentNotebook } from "../../lib/notebookSession";
import type { BookmarkEntry, FolderEntry, NoteEntry, WorkspaceMetadata } from "../../types";
import { IconMark } from "../IconBrowser";
import { BookmarksSection } from "./BookmarksSection";
import { NotebookFooter } from "./NotebookMenu";
import { PaneCreateMenu } from "./PaneCreateMenu";
import type { NoteCreationTarget } from "../../lib/notebookNavigation";
import type {
  ContextMenuTarget,
  DropPlacement,
  FolderDropIntent,
  FolderOrderingMode,
} from "../../lib/notebookNavigation";

function UnifiedNode({
  activePath,
  contents,
  depth,
  dropTargetFolder,
  folderDropIntent,
  folderOrderingMode,
  folders,
  hiddenFolderParentPath,
  metadata,
  notes,
  parentPath,
  selectedFolderPath,
  showPins,
  suppressFolderClickRef,
  workspace,
  onContextMenu,
  onFolderPointerDragStart,
  onPin,
  onPointerDragStart,
  onSelectFolder,
  onSelectNote,
  onSetFolderExpanded,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  depth: number;
  dropTargetFolder?: string | null;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode: FolderOrderingMode;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  parentPath: string;
  selectedFolderPath?: string;
  showPins: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const childFolders = useMemo(
    () =>
      hiddenFolderParentPath === parentPath
        ? []
        : folderOrderingMode === "custom"
          ? orderFolders(
              folders.filter((f) => f.parent_path === parentPath && f.path !== "").map((folder) => ({ ...folder, children: [] })),
              parentPath,
              metadata,
            )
          : folders
              .filter((f) => f.parent_path === parentPath && f.path !== "")
              .map((folder) => ({ ...folder, children: [] }))
              .sort((a, b) => a.name.localeCompare(b.name)),
    [folderOrderingMode, folders, hiddenFolderParentPath, metadata, parentPath],
  );
  const childNotes = useMemo(
    () =>
      showPins
        ? orderNotes(notes.filter((n) => n.parent_path === parentPath), parentPath, metadata)
        : notes.filter((n) => n.parent_path === parentPath).slice().sort((a, b) => a.title.localeCompare(b.title)),
    [metadata, notes, parentPath, showPins],
  );

  return (
    <>
      {childFolders.map((folder) => (
        <UnifiedFolderRow
          key={folder.path}
          activePath={activePath}
          contents={contents}
          depth={depth}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folder={folder}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      ))}
      {childNotes.map((note) => {
        const customIcon = metadata.noteIcons[note.path];
        const pinned = Boolean(metadata.pinnedNotes[note.path]);
        return (
          <button
            key={note.path}
            className={`unified-note-row${activePath === note.path ? " is-active" : ""}`}
            style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
            data-note-path={note.path}
            type="button"
            onClick={() => onSelectNote(note.path)}
            onContextMenu={(event) => onContextMenu(event, { kind: "note", path: note.path })}
            onPointerDown={(event) => onPointerDragStart(note.path, event)}
          >
            <span data-no-note-drag>
              <IconMark value={customIcon} fallback={FileText} size={14} />
            </span>
            <span className="unified-note-title">{note.title}</span>
            {showPins && pinned ? <Pin size={12} fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }} /> : null}
          </button>
        );
      })}
    </>
  );
}

function UnifiedFolderRow({
  activePath,
  contents,
  depth,
  dropTargetFolder,
  folderDropIntent,
  folderOrderingMode,
  folder,
  folders,
  hiddenFolderParentPath,
  metadata,
  notes,
  selectedFolderPath,
  showPins,
  suppressFolderClickRef,
  workspace,
  onContextMenu,
  onFolderPointerDragStart,
  onPin,
  onPointerDragStart,
  onSelectFolder,
  onSelectNote,
  onSetFolderExpanded,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  depth: number;
  dropTargetFolder?: string | null;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode: FolderOrderingMode;
  folder: FolderEntry;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  selectedFolderPath?: string;
  showPins: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const open = metadata.expandedFolders[folder.path] ?? true;
  const folderColor = metadata.folderColors[folder.path];
  const customIcon = metadata.folderIcons[folder.path];
  const dropIntent = folderDropIntent?.path === folder.path ? folderDropIntent : null;
  const hasChildren =
    folders.some((f) => f.parent_path === folder.path) ||
    notes.some((n) => n.parent_path === folder.path);

  return (
    <div className="unified-folder-node">
      <div
        className={`unified-folder-row${selectedFolderPath === folder.path ? " is-active" : ""}${(dropTargetFolder === folder.path || dropIntent?.kind === "into") ? " is-drop-target" : ""}${dropIntent?.kind === "before" ? " is-reorder-before" : ""}${dropIntent?.kind === "after" ? " is-reorder-after" : ""}`}
        style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
        data-folder-path={folder.path}
        onClick={() => {
          if (suppressFolderClickRef.current) {
            suppressFolderClickRef.current = false;
            return;
          }
          onSelectFolder?.(folder.path);
        }}
        onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path })}
        onPointerDown={(event) => onFolderPointerDragStart(folder.path, event)}
      >
        <button
          className="tree-toggle"
          type="button"
          data-no-folder-drag
          onClick={(event) => {
            event.stopPropagation();
            onSetFolderExpanded(folder.path, !open);
          }}
        >
          {hasChildren && open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span style={folderColor ? { color: folderColor } : undefined} className="unified-folder-name">
          <IconMark value={customIcon} fallback={Folder} size={14} />
          <span>{folder.name}</span>
        </span>
      </div>
      {open && (
        <UnifiedNode
          activePath={activePath}
          contents={contents}
          depth={depth + 1}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          parentPath={folder.path}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      )}
    </div>
  );
}

export function UnifiedTreePane({
  activePath,
  bookmarks = [],
  bookmarksExpanded = true,
  createNoteTargets,
  createParentPath,
  contents,
  folderDropIntent,
  folderOrderingMode = "custom",
  folders,
  hiddenFolderParentPath,
  menuOpen = false,
  metadata,
  notes,
  recentNotebooks = [],
  rootPath,
  selectedFolderPath,
  showBookmarks = false,
  showNotebookFooter = false,
  showPins = true,
  showSearch = false,
  suppressFolderClickRef,
  title,
  workspace,
  dropTargetFolder,
  onContextMenu,
  onCreateFolder,
  onCreateNote,
  onFolderPointerDragStart,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onPin,
  onPointerDragStart,
  onRemoveBookmark,
  onReorderBookmark,
  onSelectBookmark,
  onSelectNotebook,
  onSelectFolder,
  onSelectNote,
  onSetFolderExpanded,
  onToggleBookmarksExpanded,
  onToggleMenu,
  onToggleSearch,
}: {
  activePath: string | null;
  bookmarks?: BookmarkView[];
  bookmarksExpanded?: boolean;
  createNoteTargets?: NoteCreationTarget[];
  createParentPath?: string;
  contents: Map<string, string>;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode?: FolderOrderingMode;
  dropTargetFolder?: string | null;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  menuOpen?: boolean;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  recentNotebooks?: RecentNotebook[];
  rootPath: string;
  selectedFolderPath?: string;
  showBookmarks?: boolean;
  showNotebookFooter?: boolean;
  showPins?: boolean;
  showSearch?: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  title: string;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onCreateFolder?: (parentPath?: string) => void;
  onCreateNote?: (parentPath?: string, afterPath?: string) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onManageNotebooks?: () => void;
  onNewNotebook?: () => void;
  onOpenWorkspace?: () => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onRemoveBookmark?: (id: string) => void;
  onReorderBookmark?: (draggedId: string, targetId: string, placement: DropPlacement) => void;
  onSelectBookmark?: (bookmark: BookmarkEntry) => void;
  onSelectNotebook?: (path: string) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  onToggleBookmarksExpanded?: () => void;
  onToggleMenu?: (event: React.MouseEvent) => void;
  onToggleSearch?: () => void;
}) {
  const parentForCreate = createParentPath ?? rootPath;
  const noteTargetsForCreate = createNoteTargets ?? [{ parentName: title, parentPath: parentForCreate }];
  const folderTargetsForCreate = noteTargetsForCreate.map(({ parentName, parentPath }) => ({ parentName, parentPath }));

  return (
    <section className="unified-tree-pane">
      <div className="pane-header">
        <strong
          onContextMenu={rootPath
            ? (event) => onContextMenu(event, { kind: "folder", path: rootPath })
            : undefined}
        >
          {title}
        </strong>
        <div className="pane-actions">
          {showSearch && onToggleSearch ? (
            <button className="icon-button" type="button" disabled={!workspace} title="Search" onClick={onToggleSearch}>
              <Search size={16} />
            </button>
          ) : null}
          {onCreateNote ? (
            <PaneCreateMenu
              disabled={!workspace}
              folderTargets={onCreateFolder ? folderTargetsForCreate : []}
              noteTargets={noteTargetsForCreate}
              onCreateFolder={onCreateFolder}
              onCreateNote={onCreateNote}
            />
          ) : null}
        </div>
      </div>
      {showBookmarks && onRemoveBookmark && onReorderBookmark && onSelectBookmark && onToggleBookmarksExpanded ? (
        <BookmarksSection
          bookmarks={bookmarks}
          expanded={bookmarksExpanded}
          onRemove={onRemoveBookmark}
          onReorder={onReorderBookmark}
          onSelect={onSelectBookmark}
          onToggle={onToggleBookmarksExpanded}
        />
      ) : null}
      <div
        className="unified-tree-scroll"
        data-pane-root-path={rootPath}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement | null)?.closest("[data-note-path], [data-folder-path]")) return;
          onContextMenu(event, { kind: "empty", parentPath: rootPath });
        }}
      >
        <UnifiedNode
          activePath={activePath}
          contents={contents}
          depth={0}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          parentPath={rootPath}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      </div>
      {showNotebookFooter && onManageNotebooks && onNewNotebook && onOpenWorkspace && onSelectNotebook && onToggleMenu ? (
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
      ) : null}
    </section>
  );
}
