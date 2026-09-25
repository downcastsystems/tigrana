import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import { defaultBulletMethodStatuses, validateBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";

export default function BulletMethodSettings({ statuses, onChange }: {
  statuses: readonly BulletMethodStatus[];
  onChange: (statuses: readonly BulletMethodStatus[]) => void;
}) {
  const [draft, setDraft] = useState(statuses);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { cleanupDragRef.current?.(); }, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { setDraft(statuses); }, [statuses]);
  const error = validateBulletMethodStatuses(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(statuses);
  function update(id: string, patch: Partial<BulletMethodStatus>) {
    setDraft(current => current.map(status => status.id === id ? { ...status, ...patch } : status));
    setMessage("");
  }
  function move(id: string, target: number) {
    setDraft(current => {
      const from = current.findIndex(status => status.id === id);
      if (from < 0 || target < 0 || target >= current.length || from === target) return current;
      const next = [...current];
      const [status] = next.splice(from, 1);
      next.splice(target, 0, status);
      return next;
    });
    setMessage("");
  }
  // Match sidebar/bookmark reordering: native WebKit can intercept HTML
  // drag/drop and turn it into a copy operation over these editable fields.
  function beginPointerDrag(id: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupDragRef.current?.();
    const { clientX: startX, clientY: startY, pointerId } = event;
    let dragging = false;
    const targetAt = (x: number, y: number) => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-bullet-status-id]");
      if (!row || !listRef.current?.contains(row) || row.dataset.bulletStatusId === id) return null;
      const bounds = row.getBoundingClientRect();
      return { id: row.dataset.bulletStatusId!, after: y > bounds.top + bounds.height / 2 };
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-dragging-bullet-status");
      cleanupDragRef.current = null;
      setDraggedId(null);
      setDropTarget(null);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      dragging = true;
      moveEvent.preventDefault();
      document.body.classList.add("is-dragging-bullet-status");
      setDraggedId(id);
      setDropTarget(targetAt(moveEvent.clientX, moveEvent.clientY));
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const target = dragging ? targetAt(upEvent.clientX, upEvent.clientY) : null;
      cleanup();
      if (!target) return;
      setDraft(current => {
        const from = current.findIndex(status => status.id === id);
        const to = current.findIndex(status => status.id === target.id);
        if (from < 0 || to < 0) return current;
        const next = [...current];
        const [status] = next.splice(from, 1);
        const insertion = to + (target.after ? 1 : 0);
        next.splice(insertion - (from < insertion ? 1 : 0), 0, status);
        return next;
      });
      setMessage("");
    };
    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) cleanup();
    };
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") cleanup(); };
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cleanup);
    window.addEventListener("keydown", onKey);
  }
  function save(next: readonly BulletMethodStatus[], feedback: string) {
    try {
      onChange(next);
      setDraft(next);
      setSaveError(null);
      setMessage(feedback);
    } catch {
      setSaveError("Could not save Bullet Method settings. Your changes are still here; try saving again.");
    }
  }
  return (
    <div className="bullet-method-settings">
      <p>Keep tasks in your everyday notes. Start a bullet with a status and a colon, such as <code>TODO: Review the proposal</code>. Leave general notes unmarked.</p>
      <p>The default statuses describe what needs your attention. CLOSED does not necessarily mean the task is done; it means there is nothing more for you to do.</p>
      <ul className="bullet-method-guide">
        <li><strong>CLOSED:</strong> No further action needed from you; not necessarily &quot;done&quot;.<br />Example: <code>CLOSED: Proposal withdrawn</code></li>
        <li><strong>DONE:</strong> Task is complete.<br />Example: <code>DONE: Send the meeting summary</code></li>
        <li><strong>TODO:</strong> Waiting to be started.<br />Example: <code>TODO: Review the proposal</code></li>
        <li><strong>IN PROGRESS:</strong> Actively working on it.<br />Example: <code>IN PROGRESS: Draft the project plan</code></li>
        <li><strong>No status:</strong> Uncategorized notes.<br />Example: <code>The client prefers a September launch</code></li>
      </ul>
      <p>Select your list, then choose <strong>Edit → Sort Lines → Bullet Method</strong>. The shortcut is <strong>Command+Option+period</strong> on Mac or <strong>Ctrl+Alt+period</strong> on Windows and Linux. Items sort in the order below, keeping their order within each status and their nested notes attached.</p>
      <section className="bullet-method-order-section" aria-labelledby="bullet-method-status-order-heading">
        <h3 id="bullet-method-status-order-heading">Status order</h3>
        <p>Drag a handle or use the arrows to reorder. Edit names or add your own statuses. Names match regardless of capitalization.</p>
        <ol ref={listRef} className="bullet-method-statuses" aria-label="Bullet Method status order">
          {draft.map((status, index) => {
            const name = status.prefix ?? "No status";
            return (
              <li key={status.id} data-bullet-status-id={status.id}
                className={`bullet-method-status${draggedId === status.id ? " is-dragging" : ""}${dropTarget?.id === status.id ? (dropTarget.after ? " is-drop-after" : " is-drop-before") : ""}`}>
                <span className="bullet-method-position" aria-hidden="true">{index + 1}</span>
                <span className="bullet-method-grip" draggable={false} aria-label={`Drag ${name} to reorder`} title="Drag to reorder"
                  onPointerDown={event => beginPointerDrag(status.id, event)}
                  onDragStart={event => event.preventDefault()}><GripVertical size={18} /></span>
                <div className="bullet-method-fields">
                  {status.prefix === null ? <strong className="bullet-method-unmarked">No status</strong> : (
                    <input className="settings-text-input" aria-label={`Status ${index + 1} name`} value={status.prefix}
                      onChange={event => update(status.id, { prefix: event.target.value })} />
                  )}
                </div>
                <div className="bullet-method-row-actions">
                  <button className="icon-button" aria-label={`Move ${name} up`} title="Move up" disabled={index === 0} onClick={() => move(status.id, index - 1)}><ArrowUp size={16} /></button>
                  <button className="icon-button" aria-label={`Move ${name} down`} title="Move down" disabled={index === draft.length - 1} onClick={() => move(status.id, index + 1)}><ArrowDown size={16} /></button>
                  <button className="icon-button" aria-label={`Remove ${name}`} title={status.prefix === null ? "No status is always available" : "Remove status"} disabled={status.prefix === null}
                    onClick={() => { setDraft(current => current.filter(row => row.id !== status.id)); setMessage(""); }}><Trash2 size={16} /></button>
                </div>
              </li>
            );
          })}
        </ol>
        <button className="toolbar-button" onClick={() => {
          let name = "NEW STATUS", suffix = 2;
          while (draft.some(status => status.prefix?.trim().toUpperCase() === name)) name = `NEW STATUS ${suffix++}`;
          const next = [...draft];
          next.splice(next.findIndex(status => status.prefix === null), 0, { id: crypto.randomUUID(), prefix: name, description: "" });
          setDraft(next); setMessage("");
        }}><Plus size={16} /> Add status</button>
        <p className="bullet-method-help">No status includes unmarked notes and unrecognized prefixes. It can move, but cannot be removed. Renaming or removing a status does not change existing notes; their old prefixes become unrecognized.</p>
        {error ? <p role="alert">{error}</p> : null}
        {saveError ? <p role="alert">{saveError}</p> : null}
        <div className="bullet-method-actions">
          <button className="toolbar-button" disabled={!dirty || Boolean(error)} onClick={() => save(draft, "Bullet Method settings saved.")}>Save changes</button>
          <button className="toolbar-button" disabled={!dirty} onClick={() => { setDraft(statuses); setSaveError(null); setMessage(""); }}>Discard changes</button>
          <span role="status">{dirty ? "Unsaved changes" : message}</span>
        </div>
      </section>
      <section className="settings-reset-appearance">
        <h3>Default Bullet Method</h3>
        <p>Restore CLOSED, DONE, TODO, IN PROGRESS, then No status, in that order. Your notes stay unchanged.</p>
        <button className="toolbar-button" onClick={() => save(defaultBulletMethodStatuses, "Bullet Method defaults restored.")}><RotateCcw size={16} /> Restore defaults</button>
      </section>
    </div>
  );
}
