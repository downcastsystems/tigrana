import { FileText, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type CreateNoteDialogProps = {
  open: boolean;
  parentPath: string;
  error: string | null;
  onClose: () => void;
  onSubmit: (title: string) => void;
};

export function CreateNoteDialog({ open, parentPath, error, onClose, onSubmit }: CreateNoteDialogProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(title.trim() || "Untitled");
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <FileText size={18} />
          </span>
          <div>
            <h2>New note</h2>
            <p>{parentPath ? `Create in ${parentPath}` : "Create at the workspace root"}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <label className="field-label" htmlFor="note-title">
          Title
        </label>
        <input
          className="dialog-input"
          id="note-title"
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          placeholder="Untitled"
        />

        {error ? <p className="dialog-error">{error}</p> : null}

        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
