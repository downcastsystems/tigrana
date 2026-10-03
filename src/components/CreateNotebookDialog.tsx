import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createNotebookDirectory, hasRepeatedNotebookName, notebookDestination, notebookNameError } from "../lib/notebookCreation";

export function CreateNotebookDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (path: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const nameError = notebookNameError(name);
  const destination = parent ? notebookDestination(parent, name) : "";

  useEffect(() => {
    activeRef.current = true;
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector("input")?.focus();
    return () => { activeRef.current = false; previous?.focus(); };
  }, []);

  async function chooseParent() {
    if (busyRef.current || nameError) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose where to store your notebook" });
      if (activeRef.current && typeof selected === "string") setParent(selected);
    } catch (cause) {
      if (activeRef.current) setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  async function create() {
    if (busyRef.current || !parent || nameError) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const path = await createNotebookDirectory(parent, name);
      if (activeRef.current) await onCreated(path);
    } catch (cause) {
      if (activeRef.current) setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  return <div className="dialog-backdrop create-notebook-backdrop">
    <form ref={formRef} className="dialog create-notebook-dialog" role="dialog" aria-modal="true" aria-labelledby="create-notebook-title"
      onSubmit={event => { event.preventDefault(); if (parent) void create(); else void chooseParent(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) onClose(); }
        if (event.key === "Tab") {
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id="create-notebook-title">{parent ? "Ready to create your notebook?" : "Create new notebook"}</h2>
      <p>{parent ? "Review the full folder path below. You can change the name or location before creating." : "Give your notebook a name, then choose where to store it."}</p>
      <label className="field-label" htmlFor="new-notebook-name">Notebook name</label>
      <input id="new-notebook-name" className="dialog-input" value={name} disabled={busy} placeholder="My Notes"
        aria-invalid={Boolean(name.trim() && nameError)} aria-describedby={name.trim() && nameError ? "new-notebook-name-error" : undefined}
        onChange={event => { setName(event.target.value); setError(null); }} />
      {name.trim() && nameError ? <p id="new-notebook-name-error" className="dialog-error">{nameError}</p> : null}
      {parent ? <>
        <div className="create-notebook-destination"><strong>New notebook folder</strong>
          <div className="create-notebook-location"><span className="create-notebook-path">{destination}</span>
            <button className="toolbar-button" type="button" disabled={busy || Boolean(nameError)} onClick={() => void chooseParent()}><FolderOpen size={15} aria-hidden="true" />Change location</button>
          </div>
        </div>
        {hasRepeatedNotebookName(parent, name) ? <p className="create-notebook-warning" role="status">The selected folder has the same name as your notebook. This will create a folder inside it with the same name. Change the location or notebook name if that is not what you want.</p> : null}
      </> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <div className={`dialog-actions${parent ? " create-notebook-confirmation-actions" : ""}`}>
        <button className="toolbar-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary-button" type="submit" disabled={busy || Boolean(nameError)}>{busy ? (parent ? "Working…" : "Choosing…") : parent ? "Create" : "Choose location"}</button>
      </div>
    </form>
  </div>;
}
