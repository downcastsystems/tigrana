import { FileText, Pin } from "lucide-react";
import { useMemo } from "react";
import { readNotePreview } from "../../lib/noteDocument";
import type { NoteEntry, WorkspaceMetadata } from "../../types";
import { IconMark } from "../IconBrowser";
import { PaneCreateMenu } from "./PaneCreateMenu";
import type { NoteCreationTarget } from "../../lib/notebookNavigation";
import type { ContextMenuTarget } from "../../lib/notebookNavigation";

export type NoteDragPreview = {
  path: string;
  title: string;
  x: number;
  y: number;
  overTarget: boolean;
};

// ---------- End Unified Tree ----------
export function NotesPane({
  activePath,
  contents,
  createNoteTargets,
  draggingPath,
  folderTitle,
  metadata,
  notes,
  onCreateFolder,
  onCreateNote,
  onContextMenu,
  onPin,
  onPointerDragStart,
  onSelect,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  createNoteTargets: NoteCreationTarget[];
  draggingPath: string | null;
  folderTitle: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  onCreateFolder: (parentPath?: string) => void;
  onCreateNote: (parentPath?: string, afterPath?: string) => void;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (path: string) => void;
}) {
  const pinned = notes.filter((note) => metadata.pinnedNotes[note.path]);
  const regular = notes.filter((note) => !metadata.pinnedNotes[note.path]);

  return (
    <section className="notes-pane" onContextMenu={(event) => onContextMenu(event, { kind: "empty" })}>
      <div className="pane-header">
        <strong>{folderTitle}</strong>
        <div className="pane-actions">
          <PaneCreateMenu
            folderTargets={createNoteTargets.map(({ parentName, parentPath }) => ({ parentName, parentPath }))}
            noteTargets={createNoteTargets}
            onCreateFolder={onCreateFolder}
            onCreateNote={onCreateNote}
          />
        </div>
      </div>
      <div className="notes-list">
        {pinned.length ? <span className="list-label">Pinned</span> : null}
        {pinned.map((note) => (
          <NoteCard
            active={activePath === note.path}
            dragging={draggingPath === note.path}
            key={note.path}
            metadata={metadata}
            note={note}
            pinned
            content={contents.get(note.path) ?? ""}
            onContextMenu={onContextMenu}
            onPin={onPin}
            onPointerDragStart={onPointerDragStart}
            onSelect={onSelect}
          />
        ))}
        {regular.length && pinned.length ? <span className="list-label">Notes</span> : null}
        {regular.map((note) => (
          <NoteCard
            active={activePath === note.path}
            dragging={draggingPath === note.path}
            key={note.path}
            metadata={metadata}
            note={note}
            pinned={false}
            content={contents.get(note.path) ?? ""}
            onContextMenu={onContextMenu}
            onPin={onPin}
            onPointerDragStart={onPointerDragStart}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export function NoteCard({
  active,
  content,
  dragging,
  metadata,
  note,
  pinned,
  onContextMenu,
  onPin,
  onPointerDragStart,
  onSelect,
}: {
  active: boolean;
  content: string;
  dragging: boolean;
  metadata: WorkspaceMetadata;
  note: NoteEntry;
  pinned: boolean;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (path: string) => void;
}) {
  const customIcon = metadata.noteIcons[note.path];
  const preview = useMemo(() => readNotePreview(content), [content]);
  return (
    <button
      className={`note-card ${active ? "is-active" : ""} ${dragging ? "is-dragging" : ""}`}
      data-note-path={note.path}
      draggable={false}
      type="button"
      onClick={() => onSelect(note.path)}
      onContextMenu={(event) => onContextMenu(event, { kind: "note", path: note.path })}
      onPointerDown={(event) => onPointerDragStart(note.path, event)}
    >
      <span className="note-card-main">
        <span className="note-card-icon" data-no-note-drag>
          <IconMark value={customIcon} fallback={FileText} size={16} />
        </span>
        <span className="note-card-text">
          <strong>{note.title}</strong>
          <small>{preview || "No preview"}</small>
        </span>
      </span>
      <span className="pin-button" data-no-note-drag role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onPin(note.path); }}>
        <Pin size={14} fill={pinned ? "currentColor" : "none"} />
      </span>
    </button>
  );
}

export function NoteDragPreviewLayer({ preview }: { preview: NoteDragPreview }) {
  return (
    <div
      className={`note-drag-preview ${preview.overTarget ? "is-over-target" : ""}`}
      style={{ transform: `translate3d(${preview.x + 14}px, ${preview.y + 12}px, 0)` }}
    >
      <FileText size={16} />
      <span>
        <strong>{preview.title}</strong>
        <small>{preview.overTarget ? "Drop to move here" : preview.path}</small>
      </span>
    </div>
  );
}
