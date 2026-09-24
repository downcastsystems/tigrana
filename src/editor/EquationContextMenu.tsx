import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Scissors, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { mathContextEvent, type MathContextRequest } from "./mathNodes";
import { mathMarkdown } from "../lib/math";
import { writeRichClipboard } from "../lib/richClipboard";

type Target = MathContextRequest & { doc: ProseMirrorNode; node: ProseMirrorNode };
export function EquationContextMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const current = useRef(target);
  current.current = target;
  useEffect(() => {
    const open = (event: Event) => {
      const request = (event as CustomEvent<MathContextRequest>).detail;
      const doc = editor.state.doc;
      const node = doc.nodeAt(request.pos);
      if (!node || !["inlineMath", "blockMath"].includes(node.type.name)) return;
      setError(""); setBusy(false); setTarget({ ...request, doc, node });
    };
    const dom = editor.view.dom;
    dom.addEventListener(mathContextEvent, open);
    return () => { dom.removeEventListener(mathContextEvent, open); current.current = null; };
  }, [editor]);
  useEffect(() => {
    if (!target) return;
    const close = () => { current.current = null; setTarget(null); };
    const changed = ({ transaction }: { transaction: Transaction }) => { if (transaction.docChanged) close(); };
    const outside = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) close(); };
    editor.on("transaction", changed);
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("resize", close);
    return () => { editor.off("transaction", changed); window.removeEventListener("mousedown", outside, true); window.removeEventListener("resize", close); };
  }, [editor, target]);
  useLayoutEffect(() => {
    if (!target || !menu.current) return;
    const panel = menu.current;
    panel.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - panel.offsetHeight - 8))}px`;
    panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [target]);
  if (!target) return null;
  const valid = () => !editor.isDestroyed && current.current === target && editor.state.doc === target.doc;
  const close = () => { current.current = null; setTarget(null); if (!editor.isDestroyed) editor.view.focus(); };
  const remove = () => {
    if (!valid() || !editor.isEditable || disabled) return;
    editor.view.dispatch(closeHistory(editor.state.tr).deleteRange(target.pos, target.pos + target.node.nodeSize).scrollIntoView());
    close();
  };
  const copy = async (cut: boolean) => {
    if (!valid() || busy || (cut && (disabled || !editor.isEditable))) return;
    setBusy(true); setError("");
    try {
      const container = document.createElement("div");
      container.append(DOMSerializer.fromSchema(editor.schema).serializeNode(target.node));
      await writeRichClipboard(container.innerHTML, mathMarkdown(target.node.attrs.latex, target.node.type.name === "blockMath"));
      if (!valid()) return;
      if (cut) remove(); else close();
    } catch {
      if (valid()) setError("Could not copy the equation. Please try again.");
    } finally { if (valid()) setBusy(false); }
  };
  return createPortal(<div ref={menu} className="context-menu equation-context-menu" role="menu" aria-label="Equation"
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); return; }
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
    <button type="button" role="menuitem" disabled={disabled || busy} onClick={() => void copy(true)}><Scissors size={15} />Cut</button>
    <button type="button" role="menuitem" disabled={busy} onClick={() => void copy(false)}><Copy size={15} />Copy</button>
    <button type="button" role="menuitem" disabled={disabled || busy} onClick={remove}><Trash2 size={15} />Delete</button>
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
