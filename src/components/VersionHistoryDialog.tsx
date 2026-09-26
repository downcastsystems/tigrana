import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { NoteVersionEntry } from "../lib/notebookStorage";
import { notebookStorage } from "../lib/notebookStorage";
const { listNoteVersions, readNoteVersion } = notebookStorage;
const historyRequestTimeoutMs = 15_000;

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
  const [error, setError] = useState<{ kind: "list" | "preview"; message: string } | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVersions([]);
    setSelectedId(null);
    const timeout = window.setTimeout(() => {
      cancelled = true;
      setLoading(false);
      setError({ kind: "list", message: "Version history is taking longer than expected. The notebook may be busy or waiting for file sync. Try again." });
    }, historyRequestTimeoutMs);
    void listNoteVersions(workspace, note.path)
      .then((entries) => {
        if (cancelled) return;
        setVersions(entries);
        setSelectedId(entries[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) setError({ kind: "list", message: loadError instanceof Error ? loadError.message : String(loadError) });
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [listAttempt, note.path, workspace]);

  useEffect(() => {
    if (!workspace || !selectedId) {
      setPreview("");
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreview("");
    setError(current => current?.kind === "preview" ? null : current);
    const timeout = window.setTimeout(() => {
      cancelled = true;
      setPreviewLoading(false);
      setError({ kind: "preview", message: "This version is taking longer than expected to load. Try again." });
    }, historyRequestTimeoutMs);
    void readNoteVersion(workspace, note.path, selectedId)
      .then((content) => {
        if (!cancelled) setPreview(content);
      })
      .catch((loadError) => {
        if (!cancelled) setError({ kind: "preview", message: loadError instanceof Error ? loadError.message : String(loadError) });
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [note.path, previewAttempt, selectedId, workspace]);

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
            {!loading && !error && !versions.length ? <p className="empty-sidebar-note">No saved versions yet.</p> : null}
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
            {error ? <div role="alert">
              <p className="app-error">{error.message}</p>
              <button type="button" className="secondary-button" onClick={() => {
                if (error.kind === "list") setListAttempt(value => value + 1);
                else setPreviewAttempt(value => value + 1);
              }}>Retry</button>
            </div> : null}
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
            disabled={!selected || !activeNoteEditable || loading || previewLoading || Boolean(error)}
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
