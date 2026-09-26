import { FileText, Folder, Trash2, X } from "lucide-react";
import type { TrashEntry } from "../lib/notebookStorage";

export function RecentlyDeletedDialog({
  entries,
  loading,
  onClose,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  entries: TrashEntry[];
  loading: boolean;
  onClose: () => void;
  onRestore: (id: string) => void | Promise<void>;
  onPurge: (id: string) => void | Promise<void>;
  onPurgeAll: () => void | Promise<void>;
}) {
  const formatDate = (millis: number) => {
    const date = new Date(millis);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog recently-deleted-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <Trash2 size={18} />
          </span>
          <div>
            <h2>Recently Deleted</h2>
            <p>Items are kept here for 30 days, then removed automatically.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="recently-deleted-list">
          {loading && !entries.length ? <p className="empty-sidebar-note">Loading…</p> : null}
          {!loading && !entries.length ? <p className="empty-sidebar-note">Nothing here yet.</p> : null}
          {entries.map((entry) => (
            <div className="recently-deleted-row" key={entry.id}>
              {entry.kind === "folder" ? <Folder size={15} /> : <FileText size={15} />}
              <div className="recently-deleted-info">
                <strong>{entry.displayName}</strong>
                <small>
                  {entry.originalPath || "(root)"} · deleted {formatDate(entry.deletedAt)}
                </small>
              </div>
              <button
                type="button"
                className="recently-deleted-action"
                title="Restore to its original location"
                onClick={() => void onRestore(entry.id)}
              >
                Restore
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete permanently"
                onClick={() => {
                  if (window.confirm(`Permanently delete "${entry.displayName}"?`)) {
                    void onPurge(entry.id);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="danger-button"
            disabled={!entries.length}
            onClick={() => {
              if (window.confirm("Permanently delete all items in Recently Deleted?")) {
                void onPurgeAll();
              }
            }}
          >
            Empty Recently Deleted
          </button>
        </div>
      </section>
    </div>
  );
}
