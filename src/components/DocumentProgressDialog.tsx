import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import type { DocumentProgress } from "../lib/documentOperation";

export function DocumentProgressDialog({ state, onCancel, onClose }: { state: DocumentProgress; onCancel: () => void; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const inert = shell?.inert;
    if (shell) shell.inert = true;
    button.current?.focus();
    return () => { if (shell) shell.inert = inert ?? false; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="dialog-backdrop document-progress-backdrop" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.stopPropagation(); if (state.cancellable) onCancel(); else if (state.status !== "running") onClose(); }
    if (event.key === "Tab") { event.preventDefault(); button.current?.focus(); }
  }}>
    <div className="dialog document-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="document-progress-title" aria-describedby="document-progress-detail">
      <h2 id="document-progress-title">{state.title}</h2>
      <p id="document-progress-detail" role={state.status === "error" ? "alert" : "status"}>{state.detail}</p>
      {state.status === "running" && <progress aria-label="Document progress" max={state.total ?? 1} value={state.total ? state.completed ?? 0 : undefined} />}
      <div className="dialog-actions"><button ref={button} type="button" disabled={state.status === "running" && !state.cancellable} onClick={state.status === "running" ? onCancel : onClose}>{state.status === "running" ? "Cancel" : "Close"}</button></div>
    </div>
  </div>, document.body);
}
