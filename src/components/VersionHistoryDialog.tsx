import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { NoteVersionEntry } from "../lib/notebookStorage";
import { notebookStorage } from "../lib/notebookStorage";
const { listNoteVersions, readNoteVersion } = notebookStorage;

export type VersionHistoryState = {
  path: string;
  title: string;
};

export function VersionHistoryDialog({
  activeNoteEditable,
  note,
  workspace,
  onClose,
  onRestore,
}: {
  activeNoteEditable: boolean;
  note: VersionHistoryState;
  workspace: string | null;
  onClose: () => void;
  onRestore: (path: string, id: string) => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<NoteVersionEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listNoteVersions(workspace, note.path)
      .then((entries) => {
        if (cancelled) return;
        setVersions(entries);
        setSelectedId(entries[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.path, workspace]);

  useEffect(() => {
    if (!workspace || !selectedId) {
      setPreview("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    void readNoteVersion(workspace, note.path, selectedId)
      .then((content) => {
        if (!cancelled) setPreview(content);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.path, selectedId, workspace]);

  const selected = versions.find((entry) => entry.id === selectedId) ?? null;
  const formatDate = (millis: number) => {
    const date = new Date(millis);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const formatReason = (reason: string) => reason.replace(/-/g, " ");

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog version-history-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <History size={18} />
          </span>
          <div>
            <h2>Version History</h2>
            <p>{note.title}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="version-history-body">
          <aside className="version-history-list">
            {loading && !versions.length ? <p className="empty-sidebar-note">Loading…</p> : null}
            {!loading && !versions.length ? <p className="empty-sidebar-note">No saved versions yet.</p> : null}
            {versions.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === selectedId ? "version-row is-selected" : "version-row"}
                onClick={() => setSelectedId(entry.id)}
              >
                <strong>{formatDate(entry.createdAt)}</strong>
                <span>{formatReason(entry.reason)} · {formatBytes(entry.contentLength)}</span>
                {entry.path !== note.path ? <small>{entry.path}</small> : null}
              </button>
            ))}
          </aside>
          <div className="version-preview">
            {error ? <p className="app-error">{error}</p> : null}
            {!selected ? (
              <p className="empty-sidebar-note">Select a version to preview it.</p>
            ) : previewLoading ? (
              <p className="empty-sidebar-note">Loading preview…</p>
            ) : (
              <pre>{preview}</pre>
            )}
          </div>
        </div>
        {!activeNoteEditable ? (
          <p className="note-lock-warning version-history-warning">This note is read-only in this window. You can preview versions, but restore is disabled until editing is available.</p>
        ) : null}
        <div className="dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selected || !activeNoteEditable}
            onClick={() => {
              if (!selected) return;
              if (window.confirm("Restore this version? The current note will be saved as a version first.")) {
                void Promise.resolve(onRestore(note.path, selected.id)).then(onClose);
              }
            }}
          >
            <RotateCcw size={15} />
            Restore
          </button>
        </div>
      </section>
    </div>
  );
}
