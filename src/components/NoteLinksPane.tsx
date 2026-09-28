import { FileText } from "lucide-react";
import type { LinkIndex, NoteEntry, WorkspaceMetadata } from "../types";
import { IconMark } from "./IconBrowser";

export function noteLinkRows(index: LinkIndex, path: string) {
  const id = index.pathToId[path];
  const incoming = new Map<string, { path: string; title: string; broken: boolean }>();
  const outgoing = new Map<string, { path: string; title: string; broken: boolean }>();
  for (const ref of index.inbound[id] ?? []) {
    const source = index.notesById[ref.sourceId];
    if (source) incoming.set(source.id, { path: source.path, title: source.title, broken: false });
  }
  for (const ref of index.outbound[id] ?? []) {
    if (ref.targetKind === "folder") continue;
    const target = ref.targetId ? index.notesById[ref.targetId] : null;
    if (!target && !/\.md$/i.test(ref.targetPath)) continue;
    outgoing.set(ref.targetId ?? ref.targetPath, { path: target?.path ?? ref.targetPath,
      title: target?.title ?? ref.displayText ?? ref.targetPath, broken: !target || ref.broken });
  }
  return { incoming: [...incoming.values()], outgoing: [...outgoing.values()] };
}

export function NoteLinksPane({ linkIndex, activePath, selectedFolder, notes, metadata, onSelect }: {
  linkIndex: LinkIndex | null; activePath: string | null; selectedFolder: string;
  notes: NoteEntry[]; metadata: WorkspaceMetadata; onSelect: (path: string) => void;
}) {
  if (!linkIndex) return <p className="empty-sidebar-note">Indexing links…</p>;
  const path = activePath ?? selectedFolder;
  if (!path) return <p className="empty-sidebar-note">Select a note to see its links.</p>;
  const rows = noteLinkRows(linkIndex, path);
  return <div className="note-links-pane">
    {(["incoming", "outgoing"] as const).map(direction => <section key={direction} aria-label={`${direction === "incoming" ? "Incoming" : "Outgoing"} links`}>
      <h3>{direction === "incoming" ? "Incoming" : "Outgoing"}</h3>
      {!rows[direction].length && <p className="empty-sidebar-note">{direction === "incoming" ? "No notes link here yet." : "No links to other notes yet."}</p>}
      {rows[direction].map(row => <button className="backlinks-item" type="button" key={row.path} title={row.broken ? `Missing note: ${row.path}` : row.path}
        disabled={row.broken} data-copy-note-path={row.path} onClick={() => onSelect(row.path)}>
        <IconMark value={metadata.noteIcons[row.path]} fallback={FileText} size={14} />
        <span className="backlinks-item-title">{notes.find(note => note.path === row.path)?.title ?? row.title}{row.broken ? " (missing)" : ""}</span>
      </button>)}
    </section>)}
  </div>;
}
