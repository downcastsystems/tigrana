import type { DraftNote } from "../lib/notebookNavigation";
import { Braces, Check, Copy, FileText, LayoutList, Link2 } from "lucide-react";
import { notebookFilePath } from "../lib/filePaths";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createNoteDocument, updateNoteDocumentFrontmatterField, type FrontmatterField } from "../lib/noteDocument";
import { getNotebookName } from "../lib/notebookMetadata";
import type { FolderEntry, LinkIndex, NoteEntry, WorkspaceMetadata } from "../types";
import { IconMark } from "./IconBrowser";

export type RightSidebarMode = "outline" | "frontmatter" | "properties" | "backlinks";

export function RightSidebar({
  id,
  overlayActions,
  activeNote,
  frontmatter,
  frontmatterError,
  mode,
  outline,
  noteIdentity,
  outlineScrollPositions,
  pendingNote,
  workspace,
  linkIndex,
  activePath,
  selectedFolder,
  folders,
  notes,
  metadata,
  onFrontmatterChange,
  onModeChange,
  onSelectOutline,
  onSelectBacklink,
}: {
  id?: string;
  overlayActions?: ReactNode;
  activeNote: NoteEntry | null;
  frontmatter: string;
  frontmatterError: string | null;
  mode: RightSidebarMode;
  outline: Array<{ id: string; text: string; level: number }>;
  noteIdentity: string | null;
  outlineScrollPositions: Map<string, number>;
  pendingNote: DraftNote | null;
  workspace: string;
  linkIndex: LinkIndex | null;
  activePath: string | null;
  selectedFolder: string;
  folders: FolderEntry[];
  notes: NoteEntry[];
  metadata: WorkspaceMetadata;
  onFrontmatterChange: (frontmatter: string) => void;
  onModeChange: (mode: RightSidebarMode) => void;
  onSelectOutline: (id: string) => void;
  onSelectBacklink: (path: string) => void;
}) {
  const outlineScrollKey = noteIdentity ? JSON.stringify([workspace, noteIdentity]) : null;
  const title =
    mode === "outline"
      ? "Outline"
      : mode === "frontmatter"
      ? "Frontmatter"
      : mode === "backlinks"
      ? "Backlinks"
      : "Properties";
  return (
    <aside id={id} className="right-sidebar">
      {overlayActions}
      <div className="pane-header">
        <strong>{title}</strong>
        <div className="sidebar-tabs">
          <button className={`icon-button ${mode === "outline" ? "is-active" : ""}`} type="button" title="Outline" onClick={() => onModeChange("outline")}>
            <LayoutList size={16} />
          </button>
          <button className={`icon-button ${mode === "backlinks" ? "is-active" : ""}`} type="button" title="Backlinks" onClick={() => onModeChange("backlinks")}>
            <Link2 size={16} />
          </button>
          <button className={`icon-button ${mode === "frontmatter" ? "is-active" : ""}`} type="button" title="Frontmatter" onClick={() => onModeChange("frontmatter")}>
            <Braces size={16} />
          </button>
          <button className={`icon-button ${mode === "properties" ? "is-active" : ""}`} type="button" title="Properties" onClick={() => onModeChange("properties")}>
            <FileText size={16} />
          </button>
        </div>
      </div>
      {mode === "outline" ? (
        <NoteOutlineList key={outlineScrollKey} outline={outline} scrollKey={outlineScrollKey}
          positions={outlineScrollPositions} onSelect={onSelectOutline} />
      ) : mode === "frontmatter" ? (
        <FrontmatterPane
          activeNote={activeNote}
          frontmatter={frontmatter}
          frontmatterError={frontmatterError}
          onChange={onFrontmatterChange}
        />
      ) : mode === "backlinks" ? (
        <BacklinksPane
          linkIndex={linkIndex}
          activePath={activePath}
          selectedFolder={selectedFolder}
          folders={folders}
          notes={notes}
          metadata={metadata}
          onSelectBacklink={onSelectBacklink}
        />
      ) : (
        <PropertiesPane activeNote={activeNote} pendingNote={pendingNote} workspace={workspace} />
      )}
    </aside>
  );
}

function NoteOutlineList({ outline, scrollKey, positions, onSelect }: {
  outline: Array<{ id: string; text: string; level: number }>;
  scrollKey: string | null;
  positions: Map<string, number>;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // useNoteOutline replaces the previous Note's headings in a layout effect.
    // Retry when those headings arrive, after a short/empty list clamped scrollTop.
    if (listRef.current) listRef.current.scrollTop = scrollKey ? positions.get(scrollKey) ?? 0 : 0;
  }, [outline, positions, scrollKey]);
  return <div className="outline-list" ref={listRef} onScroll={(event) => {
    // Save actual scroll events, not effect cleanup: StrictMode cleanup can
    // run while the incoming outline still contains the previous Note's rows.
    if (scrollKey) positions.set(scrollKey, event.currentTarget.scrollTop);
  }}>
    {outline.map((item) => (
      <button className={`outline-item level-${item.level}`} key={item.id} type="button" onClick={() => onSelect(item.id)}>
        {item.text}
      </button>
    ))}
    {!outline.length ? <p className="empty-sidebar-note">No headings yet</p> : null}
  </div>;
}

function BacklinksPane({
  linkIndex,
  activePath,
  selectedFolder,
  folders,
  notes,
  metadata,
  onSelectBacklink,
}: {
  linkIndex: LinkIndex | null;
  activePath: string | null;
  selectedFolder: string;
  folders: FolderEntry[];
  notes: NoteEntry[];
  metadata: WorkspaceMetadata;
  onSelectBacklink: (path: string) => void;
}) {
  if (!linkIndex) {
    return <p className="empty-sidebar-note">Indexing links…</p>;
  }
  // Prefer the open note; fall back to the selected folder (single-pane / section view).
  const targetPath = activePath ?? (selectedFolder || null);
  if (!targetPath) {
    return <p className="empty-sidebar-note">Select a note or folder to see what links to it.</p>;
  }
  const targetIsFolder = !activePath;
  const targetName = targetIsFolder
    ? folders.find((f) => f.path === targetPath)?.name ?? targetPath
    : notes.find((n) => n.path === targetPath)?.title ?? targetPath;
  const id = linkIndex.pathToId[targetPath];
  if (!id) {
    return (
      <p className="empty-sidebar-note">
        No incoming links to <strong>{targetName}</strong> yet.
      </p>
    );
  }
  const inbound = linkIndex.inbound[id] ?? [];
  const seen = new Set<string>();
  const rows = inbound.flatMap((ref) => {
    if (seen.has(ref.sourceId)) return [];
    seen.add(ref.sourceId);
    const source = linkIndex.notesById[ref.sourceId];
    if (!source) return [];
    const title = notes.find((n) => n.path === source.path)?.title ?? source.title;
    const icon = metadata.noteIcons[source.path];
    return [{ sourceId: ref.sourceId, path: source.path, title, icon }];
  });
  if (!rows.length) {
    return (
      <p className="empty-sidebar-note">
        No incoming links to <strong>{targetName}</strong> yet.
      </p>
    );
  }
  return (
    <div className="backlinks-list">
      {rows.map((row) => (
        <button
          className="backlinks-item"
          data-copy-note-path={row.path}
          key={row.sourceId}
          type="button"
          title={row.path}
          onClick={() => onSelectBacklink(row.path)}
        >
          <IconMark value={row.icon} fallback={FileText} size={14} />
          <span className="backlinks-item-title">{row.title}</span>
        </button>
      ))}
    </div>
  );
}

function FrontmatterPane({
  activeNote,
  frontmatter,
  frontmatterError,
  onChange,
}: {
  activeNote: NoteEntry | null;
  frontmatter: string;
  frontmatterError: string | null;
  onChange: (frontmatter: string) => void;
}) {
  const document = useMemo(
    () => createNoteDocument({ title: activeNote?.title ?? "", frontmatter, body: "" }),
    [activeNote?.title, frontmatter],
  );
  const fields = document.frontmatterFields.filter((field) => field.value.trim() !== "");
  const hasFrontmatter = frontmatter.trim().length > 0;
  const [showRaw, setShowRaw] = useState(hasFrontmatter);
  const rawRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (hasFrontmatter) setShowRaw(true);
  }, [hasFrontmatter]);

  function updateField(field: FrontmatterField, value: string) {
    onChange(updateNoteDocumentFrontmatterField(document, field, value).frontmatter);
  }

  if (!activeNote && !frontmatter) {
    return <p className="empty-sidebar-note">No saved note open.</p>;
  }

  return (
    <div className="frontmatter-pane">
      {frontmatterError ? <p className="app-error">{frontmatterError}</p> : null}
      {fields.length ? (
        <div className="frontmatter-fields">
          {fields.map((field) => (
            <label className="frontmatter-field" key={`${field.key}-${field.lineIndex}`}>
              <span>{field.key}</span>
              <input
                type="text"
                value={field.value}
                disabled={!field.editable}
                title={field.editable ? field.key : "Nested values can be edited in raw YAML below"}
                onChange={(event) => updateField(field, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="empty-sidebar-note">No frontmatter fields yet.</p>
      )}
      {showRaw ? (
        <label className="frontmatter-raw">
          <span>Raw YAML</span>
          <textarea
            ref={rawRef}
            value={frontmatter}
            onChange={(event) => onChange(event.target.value)}
            placeholder="field: value"
            spellCheck={false}
          />
        </label>
      ) : (
        <button
          type="button"
          className="frontmatter-add"
          onClick={() => {
            setShowRaw(true);
            requestAnimationFrame(() => rawRef.current?.focus());
          }}
        >
          Add frontmatter
        </button>
      )}
    </div>
  );
}

export function PropertiesPane({ activeNote, pendingNote, workspace }: { activeNote: NoteEntry | null; pendingNote: DraftNote | null; workspace: string }) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const notebookName = getNotebookName(workspace);
  const filePath = activeNote ? notebookFilePath(workspace, activeNote.path) : pendingNote ? "Unsaved note" : "No note open";
  useEffect(() => {
    setCopyError(null);
    setCopiedPath(null);
  }, [filePath]);
  useEffect(() => {
    if (!copiedPath) return;
    const timer = window.setTimeout(() => setCopiedPath(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedPath]);
  const folderPath = activeNote ? activeNote.parent_path || notebookName : pendingNote ? pendingNote.parentPath || notebookName : "None";
  const createdAt = activeNote
    ? activeNote.created_at != null ? new Date(activeNote.created_at * 1000).toLocaleString() : "Not available"
    : "Not saved yet";
  const updatedAt = activeNote
    ? activeNote.updated_at != null ? new Date(activeNote.updated_at * 1000).toLocaleString() : "Not available"
    : "Not saved yet";

  return (
    <div className="properties-list">
      <div className="property-row" data-copy-note-path={activeNote?.path}>
        <span>File path</span>
        <div className="property-path-value">
          <code>{filePath}</code>
          {activeNote && workspace ? <button className="icon-button" type="button" title={copiedPath === filePath ? "Copied" : "Copy File Path"} aria-label="Copy File Path" onClick={async () => {
            try {
              await navigator.clipboard.writeText(filePath);
              setCopiedPath(filePath);
              setCopyError(null);
            } catch {
              setCopyError("Could not copy the file path.");
            }
          }}>{copiedPath === filePath ? <Check size={14} /> : <Copy size={14} />}</button> : null}
        </div>
        {copyError ? <p role="alert">{copyError}</p> : null}
      </div>
      <PropertyRow label="Folder" value={folderPath} code copyPath={activeNote ? notebookFilePath(workspace, activeNote.parent_path) : undefined} />
      <PropertyRow label="Notebook" value={workspace || "No notebook open"} code copyPath={workspace || undefined} />
      <PropertyRow label="Created" value={createdAt} />
      <PropertyRow label="Updated" value={updatedAt} />
    </div>
  );
}

function PropertyRow({ code, label, value, copyPath }: { code?: boolean; label: string; value: string; copyPath?: string }) {
  return (
    <div className="property-row" data-notebook-path={copyPath}>
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}
