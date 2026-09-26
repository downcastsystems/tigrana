import { BookOpen, Trash2, X } from "lucide-react";
import type { RecentNotebook } from "../lib/notebookSession";

export function ManageNotebooksModal({
  activeWorkspace,
  notebooks,
  onClose,
  onForget,
  onSelect,
}: {
  activeWorkspace: string;
  notebooks: RecentNotebook[];
  onClose: () => void;
  onForget: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog manage-notebooks-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <BookOpen size={18} />
          </span>
          <div>
            <h2>Manage Notebooks</h2>
            <p>Remove notebooks from the quick list without touching files on disk.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="manage-notebooks-list">
          {notebooks.map((notebook) => (
            <div className="manage-notebook-row" key={notebook.path}>
              <button className={activeWorkspace === notebook.path ? "is-active" : ""} type="button" onClick={() => onSelect(notebook.path)}>
                <BookOpen size={15} />
                <span>
                  <strong>{notebook.name}</strong>
                  <small>{notebook.path}</small>
                </span>
              </button>
              <button
                className="icon-button"
                type="button"
                title={activeWorkspace === notebook.path ? "The open notebook cannot be removed" : "Remove from list"}
                disabled={activeWorkspace === notebook.path}
                onClick={() => onForget(notebook.path)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!notebooks.length ? <p className="empty-sidebar-note">No recent notebooks</p> : null}
        </div>
      </section>
    </div>
  );
}
