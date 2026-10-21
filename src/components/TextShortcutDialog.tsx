import { useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { BulletMethodStatus } from "../lib/bulletMethod";
import { textShortcutError, type TextShortcut } from "../lib/textShortcuts";

function ShortcutDialog({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("[data-shortcut-autofocus]")?.focus();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="text-shortcut-dialog" aria-labelledby={titleId}
    onMouseDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <header>
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-button" aria-label="Close shortcut dialog" onClick={onClose}><X size={18} /></button>
    </header>
    {children}
  </dialog>;
}

export function TextShortcutEditDialog({ shortcut, isNew, shortcuts, statuses, onApply, onClose }: {
  shortcut: TextShortcut;
  isNew: boolean;
  shortcuts: readonly TextShortcut[];
  statuses: readonly BulletMethodStatus[];
  onApply: (shortcut: TextShortcut) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(shortcut);
  const [saveError, setSaveError] = useState("");
  const errorId = useId();
  const triggerHelpId = useId();
  const candidates = [...shortcuts.filter(item => item.id !== draft.id), draft];
  const error = !isNew && !shortcuts.some(item => item.id === draft.id)
    ? "This shortcut no longer exists. Close this dialog to continue."
    : textShortcutError(draft, candidates, statuses);
  const changed = isNew || JSON.stringify(draft) !== JSON.stringify(shortcut);
  const edit = (fields: Partial<TextShortcut>) => setDraft(current => ({ ...current, ...fields }));
  return <ShortcutDialog title={isNew ? "Add shortcut" : "Edit shortcut"} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (error || !changed) return;
      try { onApply({ ...draft, name: draft.name.trim() }); }
      catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Could not save shortcut."); }
    }} aria-describedby={error ? errorId : undefined}>
      <label>Name<input data-shortcut-autofocus value={draft.name} onChange={event => edit({ name: event.target.value })} /></label>
      <label>Trigger<input value={draft.trigger} spellCheck={false} aria-describedby={triggerHelpId} onChange={event => edit({ trigger: event.target.value })} /></label>
      <p id={triggerHelpId} className="text-shortcut-dialog-help">Use 3–64 characters with a colon anywhere and no whitespace, such as :sig, n:a, or ship:. A leading slash is reserved for slash commands.</p>
      <label>Text to insert (Markdown)<textarea rows={10} value={draft.markdown} spellCheck={false} onChange={event => edit({ markdown: event.target.value })} /></label>
      <p className="text-shortcut-dialog-help">Use plain text or multiline Markdown, including lists, highlights, and alignment wrappers.</p>
      {error ? <p id={errorId} role="alert">{error}</p> : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      <footer>
        <button type="button" className="toolbar-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="toolbar-button primary-button" disabled={Boolean(error) || !changed}>{isNew ? "Add shortcut" : "Save changes"}</button>
      </footer>
    </form>
  </ShortcutDialog>;
}

export function TextShortcutDeleteDialog({ shortcut, onDelete, onClose }: {
  shortcut: TextShortcut;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  return <ShortcutDialog title={`Delete “${shortcut.name}”?`} onClose={onClose}>
    <p>Remove this shortcut? This change saves automatically.</p>
    {error ? <p role="alert">{error}</p> : null}
    <footer>
      <button type="button" className="toolbar-button" onClick={onClose} data-shortcut-autofocus>Cancel</button>
      <button type="button" className="toolbar-button danger-item" onClick={() => {
        try { onDelete(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete shortcut."); }
      }}>Delete shortcut</button>
    </footer>
  </ShortcutDialog>;
}
