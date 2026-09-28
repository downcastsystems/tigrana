import { useMemo } from "react";
import { footnoteEntries } from "../lib/footnotes";

export function FootnotesPane({ body, onInsert, onEdit, onSelect }: {
  body: string; onInsert?: () => void; onEdit?: (label: string) => void; onSelect?: (label: string) => void;
}) {
  const entries = useMemo(() => footnoteEntries(body), [body]);
  return <div className="footnotes-pane">
    <button type="button" className="sidebar-text-button" disabled={!onInsert} onClick={onInsert}>Add footnote</button>
    {!entries.length && <p className="empty-sidebar-note">No footnotes yet. Add one at the cursor, or write <code>[^1]</code> and <code>[^1]: Your footnote.</code> in Markdown.</p>}
    {entries.map(entry => <div className="footnote-sidebar-entry" key={entry.label.toLowerCase()}>
      <div className="footnote-sidebar-heading">
        <span className="footnote-sidebar-label">
          {entry.number === null || String(entry.number) === entry.label ? `Footnote ${entry.label}` : `${entry.number} · ${entry.label}`}
        </span>
        <button type="button" className="sidebar-text-button" disabled={!onEdit} onClick={() => onEdit?.(entry.label)}>{entry.body === null ? "Define" : "Edit"}</button>
      </div>
      <p>{entry.body ?? "Missing footnote definition."}</p>
      {entry.references > 0 && <button type="button" className="sidebar-text-button" disabled={!onSelect}
        aria-label={`Go to reference for footnote ${entry.label}`} onClick={() => onSelect?.(entry.label)}>
        Go to reference{entry.references > 1 ? ` (${entry.references} locations)` : ""}
      </button>}
      {entry.references === 0 && <span className="sidebar-hint">Not referenced in this note</span>}
      {entry.duplicate && <span className="sidebar-hint">Duplicate definitions. Resolve these in Markdown.</span>}
    </div>)}
  </div>;
}
