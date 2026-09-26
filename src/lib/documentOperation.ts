import { useRef, useState } from "react";

export type DocumentProgress = { title: string; detail: string; completed?: number; total?: number; status: "running" | "done" | "error"; cancellable: boolean };
export type DocumentControl = {
  signal: AbortSignal;
  progress: (detail: string, completed?: number, total?: number) => Promise<void>;
  commit: (detail: string) => Promise<void>;
};
export function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}
export function useDocumentOperation() {
  const [state, setState] = useState<DocumentProgress | null>(null);
  const active = useRef<{ controller: AbortController; committing: boolean } | null>(null);
  async function run(title: string, action: (control: DocumentControl) => Promise<string | void>) {
    if (active.current) return;
    const operation = { controller: new AbortController(), committing: false };
    active.current = operation;
    const signal = operation.controller.signal;
    const progress: DocumentControl["progress"] = async (detail, completed, total) => {
      cancelled(signal);
      setState({ title, detail, completed, total, status: "running", cancellable: !operation.committing });
      await new Promise(resolve => setTimeout(resolve, 0));
      cancelled(signal);
    };
    try {
      await progress("Preparing…");
      const message = await action({ signal, progress, commit: async detail => {
        cancelled(signal);
        operation.committing = true;
        await progress(detail);
      } });
      cancelled(signal);
      setState(message ? { title, detail: message, status: "done", cancellable: false } : null);
    } catch (error) {
      setState(signal.aborted ? null : { title, detail: error instanceof Error ? error.message : String(error), status: "error", cancellable: false });
    } finally { active.current = null; }
  }
  return { state, run, close: () => { if (!active.current) setState(null); }, cancel: () => {
    if (active.current && !active.current.committing) active.current.controller.abort();
  } };
}

export function runDocumentWorker<T>(worker: Worker, message: unknown, control: DocumentControl): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.terminate(); control.signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    if (control.signal.aborted) { abort(); return; }
    control.signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (event.data.progress) { void control.progress(event.data.progress).catch(() => {}); return; }
      cleanup();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result as T);
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "Document conversion failed.")); };
    try { worker.postMessage(message); } catch (error) { cleanup(); reject(error); }
  });
}
