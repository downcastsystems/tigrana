import { closeHistory } from "@tiptap/pm/history";
import { Extension, InputRule, Node, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { footnoteAnchor, footnoteKey, footnoteMarkdown, validFootnoteLabel } from "../lib/footnotes";

export const footnoteEditEvent = "tigrana-edit-footnote";
export function requestFootnote(editor: Editor, label?: string) {
  if (editor.isEditable) editor.view.dom.dispatchEvent(new CustomEvent(footnoteEditEvent, { detail: { label } }));
}

export const FootnoteReferenceNode = Node.create({
  name: "footnoteReference", priority: 1000, group: "inline", inline: true, atom: true,
  addAttributes() { return { label: { default: "1", parseHTML: element => element.getAttribute("data-label"), rendered: false } }; },
  parseHTML() { return [{ tag: 'sup[data-type="footnoteReference"]' }, { tag: 'a[data-type="footnoteReference"]' }]; },
  renderHTML({ node }) {
    return ["a", { href: `#${footnoteAnchor(node.attrs.label)}`, "data-type": "footnoteReference", "data-label": node.attrs.label, "data-number": node.attrs.label,
      "class": "footnote-reference", "role": "button", "tabindex": "0", "aria-label": `Footnote ${node.attrs.label}` }, ["span", { "class": "sr-only" }, `Footnote ${node.attrs.label}`]];
  },
  renderText({ node }) { return `[^${node.attrs.label}]`; },
  addInputRules() { return [new InputRule({ find: /(?<!\\)\[\^([^\]\s<>]+)\]$/, handler: ({ state, range, match }) => {
    if (!validFootnoteLabel(match[1])) return null;
    state.tr.replaceWith(range.from, range.to, this.type.create({ label: match[1] }));
  } })]; },
});

export const FootnoteDefinitionNode = Node.create({
  name: "footnoteDefinition", group: "block", atom: true,
  addAttributes() { return {
    label: { default: "1", parseHTML: element => element.getAttribute("data-label"), rendered: false },
    markdown: { default: "", parseHTML: element => element.getAttribute("data-markdown"), rendered: false },
  }; },
  parseHTML() { return [{ tag: 'aside[data-type="footnoteDefinition"]' }]; },
  renderHTML({ node }) {
    return ["aside", { "data-type": "footnoteDefinition", "data-label": node.attrs.label, "data-markdown": node.attrs.markdown,
      id: footnoteAnchor(node.attrs.label), "class": "footnote-definition", role: "button", tabindex: "0", "aria-label": `Edit footnote ${node.attrs.label}` },
    ["strong", {}, `Footnote ${node.attrs.label}`], ["span", {}, node.attrs.markdown.replace(/^\[\^[^\]]+\]:\s*/, "")]];
  },
});

function numberedReferences(doc: PMNode) {
  const numbers = new Map<string, number>();
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "footnoteReference") return;
    const key = footnoteKey(node.attrs.label);
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-number": String(numbers.get(key)) }));
  });
  return DecorationSet.create(doc, decorations);
}
function containsReference(node: PMNode | Fragment) {
  let found = false;
  node.descendants(child => { if (child.type.name === "footnoteReference") found = true; });
  return found;
}
export const FootnoteInteractions = Extension.create({
  name: "footnoteInteractions",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin<DecorationSet>({
      key: new PluginKey("footnoteNumbering"),
      state: {
        init: (_, state) => numberedReferences(state.doc),
        apply: (tr, current) => {
          if (!tr.docChanged) return current;
          const changed = tr.steps.some((step, index) => {
            const json = step.toJSON();
            if (!String(json.stepType).startsWith("replace")) return false;
            if (JSON.stringify(json.slice ?? {}).includes('"footnoteReference"')) return true;
            return typeof json.from === "number" && typeof json.to === "number" && json.from < json.to
              && containsReference(tr.docs[index].slice(json.from, json.to).content);
          });
          return changed ? numberedReferences(tr.doc) : current.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleDOMEvents: {
          click(_view, event) {
            const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-type="footnoteReference"], [data-type="footnoteDefinition"]') : null;
            if (!element || event.button !== 0 || event.ctrlKey) return false;
            event.preventDefault(); event.stopPropagation(); requestFootnote(editor, element.dataset.label); return true;
          },
        },
        handleKeyDown(_view, event) {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !target.matches('[data-type="footnoteReference"], [data-type="footnoteDefinition"]') || !["Enter", " "].includes(event.key)) return false;
          event.preventDefault(); requestFootnote(editor, target.dataset.label); return true;
        },
      },
    })];
  },
});

export function findFootnoteDefinition(editor: Editor, label: string) {
  let result: { pos: number; node: PMNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!result && node.type.name === "footnoteDefinition" && footnoteKey(node.attrs.label) === footnoteKey(label)) result = { pos, node };
  });
  return result as { pos: number; node: PMNode } | null;
}

export function saveFootnote(editor: Editor, label: string, body: string, position?: number) {
  if (!editor.isEditable || !validFootnoteLabel(label) || !body.trim()) return false;
  const existing = findFootnoteDefinition(editor, label);
  const tr = closeHistory(editor.state.tr);
  const markdown = footnoteMarkdown(label, body);
  if (existing) tr.setNodeMarkup(existing.pos, undefined, { ...existing.node.attrs, markdown });
  else tr.insert(tr.doc.content.size, editor.schema.nodes.footnoteDefinition.create({ label, markdown }));
  if (position !== undefined) {
    const pos = Math.min(position, tr.doc.content.size);
    tr.insert(pos, editor.schema.nodes.footnoteReference.create({ label }));
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}

/** Reveal the attachment in the prose, cycling when the same label is reused. */
export function selectFootnote(editor: Editor, label: string) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnoteReference" && footnoteKey(node.attrs.label) === footnoteKey(label)) positions.push(pos);
  });
  if (!positions.length) return false;
  const current = editor.state.selection instanceof NodeSelection ? positions.indexOf(editor.state.selection.from) : -1;
  const pos = positions[(current + 1) % positions.length];
  editor.commands.setNodeSelection(pos);
  editor.view.focus();
  editor.commands.scrollIntoView();
  const marker = editor.view.nodeDOM(pos);
  if (marker instanceof HTMLElement) marker.scrollIntoView?.({ block: "center", inline: "nearest" });
  return true;
}
