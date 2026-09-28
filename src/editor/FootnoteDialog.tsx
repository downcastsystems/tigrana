import { Asterisk, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { parseFootnotes } from "../lib/footnotes";
import { findFootnoteDefinition, footnoteEditEvent, saveFootnote } from "./footnotes";

type Request = { label: string; body: string; insertAt?: number };
export function FootnoteDialog({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      if (disabled || !editor.isEditable) return;
      const label = (event as CustomEvent<{ label?: string }>).detail.label;
      if (label) {
        const definition = findFootnoteDefinition(editor, label);
        setRequest({ label, body: definition ? parseFootnotes(definition.node.attrs.markdown).definitions[0]?.body ?? "" : "" });
      } else {
        const selection = editor.state.selection;
        if (!selection.$to.parent.isTextblock || selection.$to.parent.type.name === "codeBlock") return;
        const labels = new Set<string>();
        editor.state.doc.descendants(node => { if (["footnoteReference", "footnoteDefinition"].includes(node.type.name)) labels.add(node.attrs.label); });
        let next = 1;
        while (labels.has(String(next))) next++;
        setRequest({ label: String(next), body: "", insertAt: selection.to });
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener(footnoteEditEvent, open);
    return () => dom.removeEventListener(footnoteEditEvent, open);
  }, [disabled, editor]);
  useEffect(() => {
    if (!request) return;
    const changed = ({ transaction }: { transaction: Transaction }) => { if (transaction.docChanged) setRequest(null); };
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); };
  }, [editor, request]);
  useEffect(() => { if (disabled) setRequest(null); }, [disabled]);
  return request && !disabled ? <FootnoteForm key={`${request.label}:${request.insertAt}`} editor={editor} request={request} close={() => setRequest(null)} /> : null;
}

function FootnoteForm({ editor, request, close }: { editor: Editor; request: Request; close: () => void }) {
  const [body, setBody] = useState(request.body);
  const dismiss = () => { close(); editor.view.focus(); };
  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) dismiss(); }}>
    <form className="dialog footnote-dialog" role="dialog" aria-modal="true" aria-labelledby="footnote-dialog-title"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); dismiss(); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)'));
          const first = controls[0]; const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onSubmit={event => {
        event.preventDefault();
        if (saveFootnote(editor, request.label, body, request.insertAt)) close();
      }}>
      <div className="dialog-header">
        <span className="dialog-icon"><Asterisk size={18} /></span>
        <div>
          <h2 id="footnote-dialog-title">{request.insertAt === undefined ? "Edit footnote" : "Insert footnote"}</h2>
          <p>Reference <code>{`[^${request.label}]`}</code></p>
        </div>
        <button className="icon-button" type="button" aria-label="Close footnote dialog" title="Close" onClick={dismiss}><X size={17} /></button>
      </div>
      <label className="field-label" htmlFor="footnote-text">Footnote text</label>
      <textarea className="dialog-input" id="footnote-text" aria-label="Footnote text" aria-describedby="footnote-text-hint" autoFocus required rows={7} value={body} onChange={event => setBody(event.target.value)} />
      <p className="footnote-dialog-hint" id="footnote-text-hint">You can use Markdown formatting.</p>
      <div className="dialog-actions"><button className="toolbar-button" type="button" onClick={dismiss}>Cancel</button><button className="primary-button" type="submit" disabled={!body.trim()}>Save footnote</button></div>
    </form>
  </div>, document.body);
}
