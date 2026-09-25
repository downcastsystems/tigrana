import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import { bulletMethodDimPercent, defaultBulletMethodDisplay, type BulletMethodDisplay, statusDims, statusIcon, defaultBulletMethodStatuses, validateBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";

import { BulletMethodIconPicker } from "./BulletMethodIconPicker";

export default function BulletMethodSettings({ statuses, onChange, display = defaultBulletMethodDisplay, onDisplayChange, colorMode = "light" }: {
  colorMode?: "light" | "dark";
  display?: BulletMethodDisplay;
  onDisplayChange?: (display: BulletMethodDisplay) => void;
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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastSaved = useRef(JSON.stringify(statuses));
  useEffect(() => {
    lastSaved.current = JSON.stringify(statuses);
    setDraft(current => JSON.stringify(current.map(status => ({ ...status, prefix: status.prefix?.trim() ?? null }))) === JSON.stringify(statuses) ? current : statuses);
  }, [statuses]);
  const error = validateBulletMethodStatuses(draft);
  const dimNames = draft.filter(statusDims).map(status => status.prefix?.trim() || "No status");
  const dimLabel = dimNames.length ? `Dim ${dimNames.join(", ")}` : "Dim selected statuses (none selected)";
  useEffect(() => {
    if (error) return;
    const normalized = draft.map(status => ({ ...status, prefix: status.prefix?.trim() ?? null }));
    const signature = JSON.stringify(normalized);
    if (signature === lastSaved.current) return;
    try {
      onChangeRef.current(normalized);
      lastSaved.current = signature;
      setSaveError(null);
      setMessage("");
    } catch {
      setSaveError("Could not save Bullet Method settings. Your changes are still here; try again.");
    }
  }, [draft, error]);
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
  function save(next: readonly BulletMethodStatus[], feedback: string, restoreDimming = false) {
    try {
      if (restoreDimming) onDisplayChange?.({
        ...display,
        lightPercent: bulletMethodDimPercent(defaultBulletMethodDisplay, "light"),
        darkPercent: bulletMethodDimPercent(defaultBulletMethodDisplay, "dark"),
      });
      onChange(next);
      lastSaved.current = JSON.stringify(next);
      setDraft(next);
      setSaveError(null);
      setMessage(feedback);
    } catch {
      setSaveError("Could not save Bullet Method settings. Your changes are still here; try saving again.");
    }
  }
  return (
    <div className="bullet-method-settings">
      <div className="bullet-method-enable">
        <label><input type="checkbox" aria-label="Turn on the Bullet Method" checked={Boolean(display.enabled)} onChange={event => {
          try { onDisplayChange?.({ ...display, enabled: event.target.checked }); setSaveError(null); }
          catch { setSaveError("Could not save Bullet Method settings. Please try again."); }
        }} /><span>Turn on the Bullet Method<small>Supercharge your workflow</small></span></label>
      </div>
      {display.enabled && <>
      <div className="bullet-method-display-options">
        <label><input type="checkbox" checked={display.replaceBullets} onChange={event => {
          try { onDisplayChange?.({ ...display, replaceBullets: event.target.checked }); setSaveError(null); }
          catch { setSaveError("Could not save display settings. Please try again."); }
        }} /> Replace bullets with status icons</label>
        <label><input type="checkbox" checked={display.dimCompleted} onChange={event => {
          try { onDisplayChange?.({ ...display, dimCompleted: event.target.checked }); setSaveError(null); }
          catch { setSaveError("Could not save display settings. Please try again."); }
        }} /> {dimLabel}</label>
        {display.dimCompleted && <div className="bullet-method-dim-slider">
          <span>Dimming ({colorMode} mode)</span>
          <input type="range" min={40} max={90} step={1} aria-label={`Dimming percentage for ${colorMode} mode`}
            value={bulletMethodDimPercent(display, colorMode)} onChange={event => {
              try { onDisplayChange?.({ ...display, [colorMode === "light" ? "lightPercent" : "darkPercent"]: Number(event.target.value) }); setSaveError(null); }
              catch { setSaveError("Could not save display settings. Please try again."); }
            }} />
          <output>{bulletMethodDimPercent(display, colorMode)}%</output>
          <span className="bullet-method-dim-reset-slot">
          {bulletMethodDimPercent(display, colorMode) !== bulletMethodDimPercent(defaultBulletMethodDisplay, colorMode) && <button
            type="button" className="icon-button" aria-label={`Reset ${colorMode} dimming to default`}
            title={`Reset to ${bulletMethodDimPercent(defaultBulletMethodDisplay, colorMode)}%`} onClick={() => {
              try { onDisplayChange?.({ ...display, [colorMode === "light" ? "lightPercent" : "darkPercent"]: bulletMethodDimPercent(defaultBulletMethodDisplay, colorMode) }); setSaveError(null); }
              catch { setSaveError("Could not save display settings. Please try again."); }
            }}><RotateCcw size={16} /></button>}
          </span>
        </div>}
      </div>
      </>}
      <section className="bullet-method-status-section" aria-labelledby="bullet-method-statuses-heading">
      <h3 id="bullet-method-statuses-heading">Statuses</h3>
      <details className="bullet-method-meanings">
        <summary>What the default statuses mean</summary>
      <ul className="bullet-method-guide">
        <li><strong>CLOSED:</strong> No further action needed from you; not necessarily &quot;done&quot;.<br />Example: <code>CLOSED: Proposal withdrawn</code></li>
        <li><strong>DONE:</strong> Task is complete.<br />Example: <code>DONE: Send the meeting summary</code></li>
        <li><strong>TODO:</strong> Waiting to be started.<br />Example: <code>TODO: Review the proposal</code></li>
        <li><strong>IN PROGRESS:</strong> Actively working on it.<br />Example: <code>IN PROGRESS: Draft the project plan</code></li>
        <li><strong>No status:</strong> Uncategorized notes.<br />Example: <code>The client prefers a September launch</code></li>
      </ul>
      </details>
      {display.enabled && <p>Select a list and choose <strong>Edit → Sort Lines → Bullet Method</strong> to sort by the status order below. Shortcut: <strong>⌘⌥.</strong> on Mac, <strong>Ctrl+Alt+.</strong> on Windows/Linux.</p>}
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
                <label className="bullet-method-dim-choice">
                  <input type="checkbox" aria-label={`Dim ${name}`} checked={statusDims(status)}
                    onChange={event => update(status.id, { dim: event.target.checked })} /> Dim
                </label>
                <div className="bullet-method-status-icon-slot">
                  {status.prefix !== null && <BulletMethodIconPicker name={name} value={statusIcon(status) ?? "circle"} onChange={icon => update(status.id, { icon })} />}
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
          next.splice(next.findIndex(status => status.prefix === null), 0, { id: crypto.randomUUID(), prefix: name, description: "", icon: "circle" });
          setDraft(next); setMessage("");
        }}><Plus size={16} /> Add status</button>
        <p className="bullet-method-help">No status includes unmarked notes and unrecognized prefixes. It can move, but cannot be removed. Renaming or removing a status does not change existing notes; their old prefixes become unrecognized.</p>
        {error ? <p role="alert">{error}</p> : null}
        {saveError ? <p role="alert">{saveError}</p> : null}
        {saveError && <button className="toolbar-button" disabled={Boolean(error)} onClick={() => save(draft, "Settings saved.")}>Retry</button>}
        {message && <span role="status">{message}</span>}
      </section>
      </section>
      <section className="settings-reset-appearance">
        <h3>Default Bullet Method</h3>
        <p>Restore the default statuses, icons, and order, plus dimming to 65% in light mode and 70% in dark mode. Your notes stay unchanged.</p>
        <button className="toolbar-button" onClick={() => save(defaultBulletMethodStatuses, "Bullet Method defaults restored.", true)}><RotateCcw size={16} /> Restore defaults</button>
      </section>
    </div>
  );
}
