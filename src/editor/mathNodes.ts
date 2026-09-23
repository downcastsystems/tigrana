import { Node, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { renderMath, mathMarkdown, mathSizes, splitMathSize, withMathSize } from "../lib/math";

export const mathContextEvent = "tigrana-equation-context";
export type MathContextRequest = { pos: number; x: number; y: number };
export const mathEditEvent = "tigrana-edit-equation";
export type MathRequest = { block: boolean; pos?: number; from?: number; to?: number };
export function requestEquation(editor: Editor, request: MathRequest = { block: true }) {
  if (!editor.isEditable) return;
  editor.view.dom.dispatchEvent(new CustomEvent(mathEditEvent, { detail: request }));
}

function mathNode(block: boolean) {
  const name = block ? "blockMath" : "inlineMath";
  return Node.create({
    name, group: block ? "block" : "inline", inline: !block, atom: true,
    addAttributes() {
      return { latex: { default: "", parseHTML: element => element.getAttribute("data-latex"), rendered: false } };
    },
    parseHTML() { return [{ tag: `[data-type="${name}"]` }]; },
    renderHTML({ node }) {
      return [block ? "div" : "span", { "data-type": name, "data-latex": node.attrs.latex }, node.attrs.latex];
    },
    renderText({ node }) { return mathMarkdown(node.attrs.latex, block); },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement(block ? "div" : "span");
        dom.className = `note-equation ${block ? "is-block" : "is-inline"}`;
        dom.dataset.type = name;
        dom.tabIndex = 0;
        dom.setAttribute("role", "button");
        dom.title = "Edit equation";
        const frame = document.createElement(block ? "div" : "span");
        frame.className = "equation-render-frame";
        const content = document.createElement(block ? "div" : "span");
        frame.append(content); dom.append(frame);
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "equation-resize-handle";
        handle.title = "Drag to resize equation";
        handle.setAttribute("aria-label", "Resize equation");
        handle.setAttribute("role", "slider");
        handle.setAttribute("aria-valuemin", "0");
        handle.setAttribute("aria-valuemax", String(mathSizes.length - 1));
        if (block) dom.append(handle);
        const render = (latex: string) => {
          dom.dataset.latex = latex;
          dom.setAttribute("aria-label", `Equation: ${latex}. Activate to edit.`);
          const sizeIndex = mathSizes.findIndex(size => size.value === splitMathSize(latex).size);
          handle.setAttribute("aria-valuenow", String(sizeIndex));
          handle.setAttribute("aria-valuetext", mathSizes[sizeIndex].label);
          try { content.innerHTML = renderMath(latex, block); }
          catch { content.textContent = latex; dom.classList.add("is-invalid"); }
        };
        render(node.attrs.latex);
        let suppressClick = false;
        let clickReset: ReturnType<typeof setTimeout> | undefined;
        let cancelResize: (() => void) | undefined;
        const commitSize = (latex: string) => {
          const pos = getPos();
          if (!editor.isEditable || typeof pos !== "number" || latex === node.attrs.latex) return;
          const current = editor.state.doc.nodeAt(pos);
          if (current?.type.name !== name || current.attrs.latex !== node.attrs.latex) return;
          editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, latex }));
          editor.view.dispatch(closeHistory(editor.state.tr));
        };
        handle.addEventListener("pointerdown", event => {
          if (!editor.isEditable || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          cancelResize?.();
          suppressClick = true;
          clearTimeout(clickReset);
          const original = node.attrs.latex as string;
          const originalDoc = editor.state.doc;
          const formula = splitMathSize(original);
          const initial = mathSizes.findIndex(size => size.value === formula.size);
          let current = initial;
          const finish = (save: boolean) => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            document.removeEventListener("pointercancel", cancel);
            document.removeEventListener("keydown", escape, true);
            editor.off("transaction", changed);
            cancelResize = undefined;
            if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
            clickReset = setTimeout(() => { suppressClick = false; }, 0);
            dom.classList.remove("is-resizing");
            render(node.attrs.latex);
            if (save && current !== initial && editor.state.doc === originalDoc) commitSize(withMathSize(formula.latex, mathSizes[current].value));
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            const index = Math.max(0, Math.min(mathSizes.length - 1, initial + Math.round(((next.clientX - event.clientX) + (next.clientY - event.clientY)) / 48)));
            if (index !== current) { current = index; render(withMathSize(formula.latex, mathSizes[current].value)); }
          };
          const up = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(true); };
          const cancel = () => finish(false);
          const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); cancel(); } };
          const changed = () => { if (editor.state.doc !== originalDoc || !editor.isEditable) cancel(); };
          cancelResize = cancel;
          // Capture real pointer drags even when the pointer leaves the handle.
          try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
          dom.classList.add("is-resizing");
          document.addEventListener("pointermove", move);
          document.addEventListener("pointerup", up);
          document.addEventListener("pointercancel", cancel);
          document.addEventListener("keydown", escape, true);
          editor.on("transaction", changed);
        });
        handle.addEventListener("keydown", event => {
          event.stopPropagation();
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const formula = splitMathSize(node.attrs.latex);
          const current = mathSizes.findIndex(size => size.value === formula.size);
          const next = event.key === "Home" ? 0 : event.key === "End" ? mathSizes.length - 1 : Math.max(0, Math.min(mathSizes.length - 1, current + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1)));
          commitSize(withMathSize(formula.latex, mathSizes[next].value));
        });

        dom.addEventListener("mousedown", event => {
          const mouse = event as MouseEvent;
          if (event.target === handle || mouse.button !== 0 || mouse.ctrlKey) return;
          // The rendered symbols form one atom, not an editable text range.
          event.preventDefault();
          const pos = getPos();
          if (typeof pos === "number") {
            editor.commands.setNodeSelection(pos);
            editor.view.focus();
          }
        });
        const edit = (event: Event) => {
          if (suppressClick || event.target === handle || !editor.isEditable || (event instanceof MouseEvent && (event.button !== 0 || event.ctrlKey))) return;
          event.preventDefault(); event.stopPropagation();
          const pos = getPos();
          if (typeof pos === "number") {
            editor.commands.setNodeSelection(pos);
            requestEquation(editor, { block, pos });
          }
        };
        dom.addEventListener("contextmenu", event => {
          event.preventDefault(); event.stopPropagation();
          const pos = getPos();
          if (typeof pos !== "number") return;
          editor.commands.setNodeSelection(pos);
          editor.view.dom.dispatchEvent(new CustomEvent<MathContextRequest>(mathContextEvent, {
            detail: { pos, x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY },
          }));
        });
        dom.addEventListener("click", edit);
        dom.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") edit(event); });
        return {
          dom,
          destroy: () => { cancelResize?.(); clearTimeout(clickReset); },
          stopEvent: event => event.target === handle || event.type === "click" || event.type === "contextmenu" || (event.type === "keydown" && ["Enter", " "].includes((event as KeyboardEvent).key)),
          ignoreMutation: () => true,
          update(next) {
            if (next.type.name !== name) return false;
            if (next.attrs.latex !== node.attrs.latex) { dom.classList.remove("is-invalid"); render(next.attrs.latex); }
            node = next;
            return true;
          },
        };
      };
    },
  });
}
export const InlineMath = mathNode(false);
export const BlockMath = mathNode(true);
