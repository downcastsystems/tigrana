import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { BulletMethodStatus } from "../lib/bulletMethod";
import { textShortcutError, textShortcutInsertionError, type TextShortcut } from "../lib/textShortcuts";
import { TextShortcutDeleteDialog, TextShortcutEditDialog } from "./TextShortcutDialog";

type ShortcutDialogState = { type: "edit"; shortcut: TextShortcut; isNew: boolean } | { type: "delete"; shortcut: TextShortcut };

export function TextShortcutSettings({ shortcuts, statuses, onChange }: {
  shortcuts: readonly TextShortcut[];
  statuses: readonly BulletMethodStatus[];
  onChange: (shortcuts: readonly TextShortcut[]) => void;
}) {
  const [dialog, setDialog] = useState<ShortcutDialogState | null>(null);
  const errors = shortcuts.map(shortcut => {
    const error = textShortcutError(shortcut, shortcuts, statuses);
    return error && !textShortcutInsertionError(shortcut, shortcuts, statuses)
      ? `Typed expansion disabled. ${error} You can still insert this shortcut using /shortcut.` : error;
  });
  const update = (next: readonly TextShortcut[]) => {
    // Close only after persistence succeeds so a failed save keeps the dialog's edits.
    onChange(next);
    setDialog(null);
  };
  const edit = (shortcut: TextShortcut) => setDialog({ type: "edit", shortcut, isNew: false });
  return <div className="text-shortcut-settings">
    <p>Type a trigger followed by Space or Enter, or type <code>/shortcut</code> and choose a saved shortcut. Triggers are case-sensitive and expand at the start of a line or bullet, or after whitespace.</p>
    <p>Triggers need 3–64 characters, a colon anywhere, and no whitespace. Examples: <code>:sig</code>, <code>n:a</code>, <code>ship:</code>. A leading slash is reserved for slash commands.</p>
    <details className="text-shortcut-guide"><summary>Formatting guide and example</summary>
      <p>Use plain text or multiline Markdown: <code>- </code> for an empty bullet, <code>**bold**</code>, <code>==highlight==</code>, headings, lists, and code fences. For centered text, use the wrapper below, including its blank lines.</p>
      <pre>{'<div style="text-align: center">\n\nAVERY\n\n</div>\n\nDialogue goes here.'}</pre><p>Name it “Avery” and use <code>n:a</code> as the trigger.</p>
    </details>
    <div className="text-shortcut-table-scroll">
      <table className="text-shortcut-table" aria-label="Text shortcuts">
        <thead><tr><th scope="col">Name</th><th scope="col">Trigger</th><th scope="col">Text to insert</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          {shortcuts.map((shortcut, index) => <tr key={shortcut.id}>
            <td><button type="button" className="text-shortcut-name" onClick={() => edit(shortcut)}>{shortcut.name}</button>
              {errors[index] ? <p className="text-shortcut-row-error" role="alert">{errors[index]}</p> : null}</td>
            <td><code>{shortcut.trigger}</code></td>
            <td><span className="text-shortcut-preview">{shortcut.markdown.replace(/\s+/g, " ")}</span></td>
            <td><div className="text-shortcut-row-actions">
              <button type="button" className="icon-button" title="Edit shortcut" aria-label={`Edit ${shortcut.name}`} onClick={() => edit(shortcut)}><Pencil size={16} /></button>
              <button type="button" className="icon-button" title="Delete shortcut" aria-label={`Delete ${shortcut.name}`} onClick={() => setDialog({ type: "delete", shortcut })}><Trash2 size={16} /></button>
            </div></td>
          </tr>)}
          {shortcuts.length === 0 ? <tr><td colSpan={4} className="text-shortcut-empty">No shortcuts yet. Add one to get started.</td></tr> : null}
        </tbody>
      </table>
    </div>
    <div className="text-shortcut-actions">
      <button type="button" className="toolbar-button" onClick={() => setDialog({ type: "edit", isNew: true, shortcut: { id: crypto.randomUUID(), name: "", trigger: "", markdown: "" } })}><Plus size={16} />Add shortcut</button>
    </div>
    <p>Changes save automatically on this device and are shared across notebooks. Triggers are checked against your current Bullet Status settings; conflicts must be resolved before saving.</p>
    {dialog?.type === "edit" ? <TextShortcutEditDialog key={dialog.shortcut.id} shortcut={dialog.shortcut} isNew={dialog.isNew} shortcuts={shortcuts} statuses={statuses}
      onClose={() => setDialog(null)} onApply={shortcut => update(dialog.isNew ? [...shortcuts, shortcut] : shortcuts.map(item => item.id === shortcut.id ? shortcut : item))} /> : null}
    {dialog?.type === "delete" ? <TextShortcutDeleteDialog shortcut={dialog.shortcut} onClose={() => setDialog(null)}
      onDelete={() => update(shortcuts.filter(item => item.id !== dialog.shortcut.id))} /> : null}
  </div>;
}
