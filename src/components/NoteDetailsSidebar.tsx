import { WritingProgressPane } from "./WritingProgressPane";
import { FootnotesPane } from "./FootnotesPane";
import { NoteLinksPane } from "./NoteLinksPane";
import { buildDemoLinkIndex } from "../lib/demoLinkIndex";
import type { DraftNote } from "../lib/notebookNavigation";
import { Braces, Check, Copy, FileText, LayoutDashboard, LayoutList, Link2, Asterisk, ChevronRight } from "lucide-react";
import { notebookFilePath } from "../lib/filePaths";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createNoteDocument, updateNoteDocumentFrontmatterField, type FrontmatterField } from "../lib/noteDocument";
import { getNotebookName } from "../lib/notebookMetadata";
import type { FolderEntry, LinkIndex, NoteEntry, WorkspaceMetadata } from "../types";

export type RightSidebarMode = "overview" | "outline" | "frontmatter" | "properties" | "links" | "footnotes";

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
  notes,
  metadata,
  onFrontmatterChange,
  onModeChange,
  onSelectOutline,
  onSelectBacklink,
  body = "",
  demoContents,
  onGoalChange,
  onInsertFootnote,
  onEditFootnote,
  onSelectFootnote,
  onDeleteFootnote,
}: {
  body?: string;
  demoContents?: Map<string, string>;
  onGoalChange?: (noteId: string | null, goal: number | null) => void;
  onInsertFootnote?: () => void;
  onEditFootnote?: (label: string) => void;
  onSelectFootnote?: (label: string) => void;
  onDeleteFootnote?: (label: string) => void;
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
  const effectiveIndex = useMemo(() => linkIndex ?? (demoContents ? buildDemoLinkIndex(demoContents, notes) : null), [demoContents, linkIndex, notes]);
  const footnotesPane = <FootnotesPane body={body} onInsert={onInsertFootnote} onEdit={onEditFootnote} onSelect={onSelectFootnote} onDelete={onDeleteFootnote} />;
  const linksPane = <NoteLinksPane linkIndex={effectiveIndex} activePath={activePath} selectedFolder={selectedFolder}
    notes={notes} metadata={metadata} onSelect={onSelectBacklink} />;
  const outlineScrollKey = noteIdentity ? JSON.stringify([workspace, noteIdentity]) : null;
  const sidebarRef = useRef<HTMLElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const overviewScrollKey = noteIdentity ? JSON.stringify([workspace, noteIdentity, "overview"]) : null;
  useLayoutEffect(() => {
    if (overviewRef.current) overviewRef.current.scrollTop = overviewScrollKey ? outlineScrollPositions.get(overviewScrollKey) ?? 0 : 0;
  }, [mode, outline, overviewScrollKey, outlineScrollPositions]);
  const title =
    mode === "overview" ? "Overview" : mode === "outline"
      ? "Outline"
      : mode === "frontmatter"
      ? "Frontmatter"
      : mode === "links"
      ? "Links"
      : mode === "footnotes" ? "Footnotes"
      : "Properties";
  function scrollToTop() {
    const pane = sidebarRef.current?.querySelector<HTMLElement>(
      ":scope > .note-overview, :scope > .outline-list, :scope > .frontmatter-pane, :scope > .sidebar-scroll-pane, :scope > .properties-list",
    );
    if (pane) pane.scrollTop = 0;
    const scrollKey = mode === "overview" ? overviewScrollKey : mode === "outline" ? outlineScrollKey : null;
    if (scrollKey) outlineScrollPositions.set(scrollKey, 0);
  }
  return (
    <aside id={id} className="right-sidebar" ref={sidebarRef}>
      {overlayActions}
      <div className="pane-header right-sidebar-header">
        <div className="sidebar-tabs" role="group" aria-label="Note information">
          <button className={`icon-button ${mode === "overview" ? "is-active" : ""}`} type="button" title="Overview" aria-pressed={mode === "overview"} onClick={() => onModeChange("overview")}>
            <LayoutDashboard size={16} />
          </button>
          <button className={`icon-button ${mode === "outline" ? "is-active" : ""}`} type="button" title="Outline" aria-pressed={mode === "outline"} onClick={() => onModeChange("outline")}>
            <LayoutList size={16} />
          </button>
          <button className={`icon-button ${mode === "links" ? "is-active" : ""}`} type="button" title="Links" aria-pressed={mode === "links"} onClick={() => onModeChange("links")}>
            <Link2 size={16} />
          </button>
          <button className={`icon-button ${mode === "footnotes" ? "is-active" : ""}`} type="button" title="Footnotes" aria-pressed={mode === "footnotes"} onClick={() => onModeChange("footnotes")}>
            <Asterisk size={16} viewBox="4 4 16 16" strokeWidth={1.5} />
          </button>
          <button className={`icon-button ${mode === "frontmatter" ? "is-active" : ""}`} type="button" title="Frontmatter" aria-pressed={mode === "frontmatter"} onClick={() => onModeChange("frontmatter")}>
            <Braces size={16} />
          </button>
          <button className={`icon-button ${mode === "properties" ? "is-active" : ""}`} type="button" title="Properties" aria-pressed={mode === "properties"} onClick={() => onModeChange("properties")}>
            <FileText size={16} />
          </button>
        </div>
        <strong><button type="button" className="sidebar-title-button" title={`Scroll ${title} to the top`} onClick={scrollToTop}>{title}</button></strong>
      </div>
      {mode === "overview" ? (
        <div className="note-overview" ref={overviewRef} onScroll={event => {
          if (overviewScrollKey) outlineScrollPositions.set(overviewScrollKey, event.currentTarget.scrollTop);
        }}>
          <OverviewSection title="Goals" defaultExpanded={false}><WritingProgressPane metadata={metadata} noteId={noteIdentity} onGoalChange={onGoalChange} /></OverviewSection>
          <OverviewSection title="Outline"><NoteOutlineList key={overviewScrollKey} outline={outline} scrollKey={null}
            positions={outlineScrollPositions} onSelect={onSelectOutline} /></OverviewSection>
          <OverviewSection title="Links">{linksPane}</OverviewSection>
          <OverviewSection title="Footnotes">{footnotesPane}</OverviewSection>
          <div className="overview-note-dates"><NoteDateRows activeNote={activeNote} /></div>
        </div>
      ) : mode === "outline" ? (
        <NoteOutlineList key={outlineScrollKey} outline={outline} scrollKey={outlineScrollKey}
          positions={outlineScrollPositions} onSelect={onSelectOutline} />
      ) : mode === "frontmatter" ? (
        <FrontmatterPane
          activeNote={activeNote}
          frontmatter={frontmatter}
          frontmatterError={frontmatterError}
          onChange={onFrontmatterChange}
        />
      ) : mode === "links" ? (
        <div className="sidebar-scroll-pane">{linksPane}</div>
      ) : mode === "footnotes" ? (
        <div className="sidebar-scroll-pane">{footnotesPane}</div>
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

function OverviewSection({ title, children, defaultExpanded = true }: { title: string; children: ReactNode; defaultExpanded?: boolean }) {
  const preferenceKey = `tigrana-overview-${title.toLowerCase()}-expanded`;
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      return saved === "true" ? true : saved === "false" ? false : defaultExpanded;
    } catch {
      return defaultExpanded;
    }
  });
  return <details className="overview-section" open={expanded} onToggle={event => {
    const open = event.currentTarget.open;
    if (open === expanded) return;
    setExpanded(open);
    try { localStorage.setItem(preferenceKey, String(open)); } catch { /* Keep the current choice if storage is unavailable. */ }
  }}>
    <summary><ChevronRight size={14} aria-hidden="true" />{title}</summary>
    {children}
  </details>;
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
      <NoteDateRows activeNote={activeNote} />
    </div>
  );
}

function NoteDateRows({ activeNote }: { activeNote: NoteEntry | null }) {
  const createdAt = activeNote
    ? activeNote.created_at != null ? new Date(activeNote.created_at * 1000).toLocaleString() : "Not available"
    : "Not saved yet";
  const updatedAt = activeNote
    ? activeNote.updated_at != null ? new Date(activeNote.updated_at * 1000).toLocaleString() : "Not available"
    : "Not saved yet";

  return <>
    <PropertyRow label="Created" value={createdAt} />
    <PropertyRow label="Updated" value={updatedAt} />
  </>;
}

function PropertyRow({ code, label, value, copyPath }: { code?: boolean; label: string; value: string; copyPath?: string }) {
  return (
    <div className="property-row" data-notebook-path={copyPath}>
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}
