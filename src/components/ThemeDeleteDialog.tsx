import { useEffect, useId, useRef } from "react";

export function ThemeDeleteDialog({ name, busy, error, onDelete, onCancel }: {
  name: string;
  busy: boolean;
  error: string;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="theme-delete-confirmation"
      aria-labelledby={titleId} aria-describedby={descriptionId}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onCancel();
        }
      }}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id={titleId}>Delete “{name}”?</h2>
      <p id={descriptionId}>Remove this theme from the app-wide collection and switch this notebook to Default. Other notebooks keep their saved copies.</p>
      {error && <p role="alert">{error}</p>}
      <div className="theme-actions">
        <button type="button" className="toolbar-button" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="toolbar-button" disabled={busy} onClick={onDelete}>{busy ? "Deleting…" : "Delete saved theme"}</button>
      </div>
    </dialog>
  );
}
