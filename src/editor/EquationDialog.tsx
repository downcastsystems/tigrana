import { MoreEquationExamples } from "./MoreEquationExamples";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2, Minimize2 } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { mathExamples, moreMathExamples, renderMath, mathSizes, splitMathSize, withMathSize, type MathSize } from "../lib/math";
import { mathEditEvent, type MathRequest } from "./mathNodes";
import "katex/dist/katex.min.css";

type Request = MathRequest & { from: number; to: number; latex: string; allowBlock: boolean };
export function EquationDialog({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      if (!editor.isEditable || disabled) return;
      const detail = (event as CustomEvent<MathRequest>).detail;
      const node = detail.pos === undefined ? null : editor.state.doc.nodeAt(detail.pos);
      if (detail.pos !== undefined && !["blockMath", "inlineMath"].includes(node?.type.name ?? "")) return;
      const from = detail.pos ?? detail.from ?? editor.state.selection.from;
      const allowBlock = editor.state.doc.resolve(from).depth <= 1;
      setRequest({ ...detail, allowBlock, block: allowBlock && detail.block,
        from: detail.pos ?? detail.from ?? editor.state.selection.from,
        to: detail.pos === undefined ? detail.to ?? editor.state.selection.to : detail.pos + node!.nodeSize,
        latex: node?.attrs.latex ?? mathExamples[0].latex,
      });
    };
    const dom = editor.view.dom;
    dom.addEventListener(mathEditEvent, open);
    return () => { dom.removeEventListener(mathEditEvent, open); };
  }, [editor, disabled]);
  useEffect(() => {
    if (!request) return;
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setRequest(null);
    };
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); };
  }, [editor, request]);
  useEffect(() => { if (disabled) setRequest(null); }, [disabled]);
  if (!request || disabled) return null;
  return <EquationForm key={`${request.from}:${request.to}:${request.latex}`} editor={editor} request={request} close={() => setRequest(null)} />;
}

function EquationForm({ editor, request, close }: { editor: Editor; request: Request; close: () => void }) {
  const [maximized, setMaximized] = useState(false);
  const [latex, setLatex] = useState(() => splitMathSize(request.latex).latex);
  const [size, setSize] = useState<MathSize>(() => splitMathSize(request.latex).size);
  const [block, setBlock] = useState(request.block);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => {
    if (!latex.trim()) return { error: "Enter an equation or choose an example.", html: "" };
    if (!block && /[\r\n]/.test(latex)) return { error: "Use a separate line for a multiline equation.", html: "" };
    if (/^\s*\$|\$\$/.test(latex)) return { error: "Enter the formula without the surrounding dollar signs.", html: "" };
    try { return { html: renderMath(withMathSize(latex, size), block), error: "" }; }
    catch (error) { return { html: "", error: String(error).replace(/^ParseError: KaTeX parse error: /, "") }; }
  }, [latex, block, size]);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const dismiss = () => { close(); editor.view.focus(); };
  const save = () => {
    if (preview.error || !editor.isEditable) return;
    editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; }).insertContentAt({ from: request.from, to: request.to }, {
      type: block ? "blockMath" : "inlineMath", attrs: { latex: withMathSize(latex.trim(), size) },
    }).run();
    close();
  };
  const example = [...mathExamples, ...moreMathExamples.flatMap(group => group.examples)].find(item => item.latex === latex);
  return createPortal(<div className="dialog-backdrop equation-backdrop" onMouseDown={event => {
    event.stopPropagation(); if (event.target === event.currentTarget) dismiss();
  }}>
    <div ref={panel} className={`equation-dialog${maximized ? " is-maximized" : ""}`} role="dialog" aria-modal="true" aria-label={request.pos === undefined ? "Insert equation" : "Edit equation"}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); dismiss(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
        if (event.key === "Tab") {
          const items = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select')];
          const index = items.indexOf(document.activeElement as HTMLElement);
          if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1)) {
            event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus();
          }
        }
      }}>
      <div className="equation-dialog-header">
        <h2>{request.pos === undefined ? "Insert equation" : "Edit equation"}</h2>
        <div className="equation-dialog-header-actions">
        <button type="button" className="icon-button equation-dialog-close" aria-label={maximized ? "Restore equation dialog size" : "Maximize equation dialog"} title={maximized ? "Restore size" : "Maximize"} aria-pressed={maximized} onClick={() => setMaximized(value => !value)}>{maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
        <button type="button" className="icon-button equation-dialog-close" aria-label="Close equation dialog" title="Close" onClick={dismiss}><X size={18} /></button>
        </div>
      </div>
      <p>Choose an example, then change the numbers or letters. Equations display math; they do not calculate answers.</p>
      <div className="equation-layout-options">
      <label>Placement<select className="settings-select" value={block ? "block" : "inline"} onChange={event => setBlock(event.target.value === "block")}>
        <option value="block" disabled={!request.allowBlock}>On its own line</option><option value="inline">Within a sentence</option>
      </select></label>
      <label>Size<select className="settings-select" aria-label="Equation size" value={size} onChange={event => setSize(event.target.value as MathSize)}>
        {mathSizes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      </div>
      {!request.allowBlock && <p>Inside lists, quotes, and tables, equations appear within the text.</p>}
      <label>Formula<textarea ref={input} rows={5} spellCheck={false} value={latex} onChange={event => setLatex(event.target.value)} aria-describedby="equation-help" /></label>
      <p id="equation-help">{example?.explanation ?? "Use ^ for powers, _ for subscripts, and braces to group terms. Enter the formula without $ delimiters."}</p>
      <div className="equation-examples" aria-label="Equation examples">{mathExamples.map(item => <button key={item.label} type="button" onClick={() => { setLatex(item.latex); input.current?.focus(); }}>{item.label}</button>)}
        <MoreEquationExamples allowBlock={request.allowBlock} onChoose={item => { setLatex(item.latex); if (item.block) { setBlock(true); setMaximized(true); } input.current?.focus(); }} />
      </div>
      <div className="equation-preview" aria-label="Equation preview" aria-live="polite">
        {preview.error ? <p role="status">{preview.error}</p> : <div dangerouslySetInnerHTML={{ __html: preview.html }} />}
      </div>
      <div className="equation-actions"><button type="button" onClick={dismiss}>Cancel</button><button type="button" disabled={!!preview.error} onClick={save}>{request.pos === undefined ? "Insert equation" : "Save equation"}</button></div>
    </div>
  </div>, document.body);
}
