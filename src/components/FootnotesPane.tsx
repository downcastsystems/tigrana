import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { footnoteEntries, footnotePreview } from "../lib/footnotes";

export function FootnotesPane({ body, onInsert, onEdit, onSelect, onDelete }: {
  body: string; onInsert?: () => void; onEdit?: (label: string) => void; onSelect?: (label: string) => void; onDelete?: (label: string) => void;
}) {
  const entries = useMemo(() => footnoteEntries(body).map(entry => ({ ...entry, preview: entry.body ? footnotePreview(entry.body) : "" })), [body]);
  return <div className="footnotes-pane">
    <button type="button" className="sidebar-text-button" disabled={!onInsert} onClick={onInsert}>Add footnote</button>
    {!entries.length && <p className="empty-sidebar-note">No footnotes yet. Add one at the cursor, or write <code>[^1]</code> and <code>[^1]: Your footnote.</code> in Markdown.</p>}
    {entries.map(entry => <div className="footnote-sidebar-entry" key={entry.label.toLowerCase()}>
      <button type="button" className="footnote-sidebar-number" disabled={!onSelect || !entry.references}
        title={entry.references ? `Go to reference for footnote ${entry.number}` : "Not referenced in this note"}
        aria-label={`Go to reference for footnote ${entry.number ?? entry.label}`}
        onClick={() => onSelect?.(entry.label)}>{entry.number ?? "–"}</button>
      <button type="button" className="footnote-sidebar-text" disabled={!onEdit}
        title={`Edit footnote ${entry.number ?? entry.label} in the note`}
        onClick={() => onEdit?.(entry.label)}><span className="footnote-sidebar-preview">{entry.preview || "Write footnote…"}</span></button>
      <button type="button" className="icon-button footnote-sidebar-delete" disabled={!onDelete}
        title={`Delete footnote ${entry.number ?? entry.label} and all its references`}
        aria-label={`Delete footnote ${entry.number ?? entry.label} and all its references`}
        onClick={() => onDelete?.(entry.label)}><Trash2 size={13} /></button>
      {entry.references === 0 && <span className="sidebar-hint">Not referenced in this note</span>}
      {entry.duplicate && <span className="sidebar-hint">Duplicate definitions. Resolve these in Markdown.</span>}
    </div>)}
  </div>;
}
