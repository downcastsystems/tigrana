import { closeHistory } from "@tiptap/pm/history";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Extension, InputRule, Node, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { footnoteAnchor, footnoteKey, validFootnoteLabel } from "../lib/footnotes";

type FootnoteState = {
  decorations: DecorationSet;
  markdownLabels: ReadonlyMap<string, string> | undefined;
  pendingNormalization: boolean;
};
const footnoteNumberingKey = new PluginKey<FootnoteState>("footnoteNumbering");
const finishFootnoteEdit = "finishFootnoteEdit";
const normalizeFootnotes = "normalizeFootnotes";

// Keep editor/clipboard identities stable; only the labels written to Markdown
// follow display order. Renaming the identities would misattach a cut reference
// when it is pasted after the remaining footnotes have been renumbered.
export function getMarkdownFootnoteLabels(editor: Editor | undefined): ReadonlyMap<string, string> | undefined {
  return editor ? footnoteNumberingKey.getState(editor.state)?.markdownLabels : undefined;
}

function markdownFootnoteLabel(editor: Editor | undefined, label: string) {
  return getMarkdownFootnoteLabels(editor)?.get(footnoteKey(label)) ?? label;
}

/** Sidebar commands carry labels from the serialized Markdown. */
export function resolveMarkdownFootnoteLabel(editor: Editor, label: string, labels = getMarkdownFootnoteLabels(editor)) {
  if (labels) for (const [identity, markdownLabel] of labels) {
    if (footnoteKey(markdownLabel) === footnoteKey(label)) return identity;
  }
  return label;
}

function numberedMarkdownLabels(doc: PMNode) {
  const numbers = new Map<string, number>();
  const numericLabels = new Set<string>();
  doc.descendants(node => {
    if (node.type.name !== "footnoteReference" && node.type.name !== "footnoteDefinition") return;
    const key = footnoteKey(node.attrs.label);
    if (/^\d+$/.test(key)) numericLabels.add(key);
    if (node.type.name === "footnoteReference" && !numbers.has(key)) numbers.set(key, numbers.size + 1);
  });
  const labels = new Map<string, string>();
  // Unreferenced definitions remain editable and must not collide with labels
  // assigned to references, including references with missing definitions.
  let unusedNumber = numbers.size;
  for (const key of numericLabels) labels.set(key, String(numbers.get(key) ?? ++unusedNumber));
  return labels;
}

function definitionInsertionPosition(doc: PMNode) {
  let position = doc.content.size;
  doc.forEach((node, pos) => {
    if (node.type.name === "footnoteDefinition") position = pos + node.nodeSize;
  });
  return position;
}

function nextFootnoteLabel(doc: PMNode) {
  const labels = new Set<string>();
  doc.descendants(node => {
    if (["footnoteReference", "footnoteDefinition"].includes(node.type.name)) labels.add(footnoteKey(node.attrs.label));
  });
  let next = 1;
  while (labels.has(String(next))) next++;
  return String(next);
}

/** Insert a reference and immediately edit its definition, or open an existing one. */
export function requestFootnote(editor: Editor, label?: string) {
  if (label) return editFootnote(editor, label);
  if (!editor.isEditable) return false;
  const selection = editor.state.selection;
  if (!selection.$to.parent.isTextblock || selection.$to.parent.type.name === "codeBlock") return false;
  for (let depth = selection.$to.depth; depth > 0; depth--) {
    if (selection.$to.node(depth).type.name === "footnoteDefinition") return false;
  }
  const newLabel = nextFootnoteLabel(editor.state.doc);
  const tr = closeHistory(editor.state.tr);
  tr.insert(selection.to, editor.schema.nodes.footnoteReference.create({ label: newLabel }));
  tr.insert(definitionInsertionPosition(tr.doc), editor.schema.nodes.footnoteDefinition.createAndFill({ label: newLabel })!);
  editor.view.dispatch(tr);
  editFootnote(editor, newLabel);
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

export function editFootnote(editor: Editor, label: string) {
  if (!validFootnoteLabel(label)) return false;
  let definition = findFootnoteDefinition(editor, label);
  if (!definition && editor.isEditable) {
    editor.view.dispatch(closeHistory(editor.state.tr).insert(definitionInsertionPosition(editor.state.doc),
      editor.schema.nodes.footnoteDefinition.createAndFill({ label })!));
    definition = findFootnoteDefinition(editor, label);
  }
  if (!definition) return false;
  const selection = TextSelection.near(editor.state.doc.resolve(definition.pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
  const dom = editor.view.nodeDOM(findFootnoteDefinition(editor, label)?.pos ?? definition.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView?.({ block: "center", inline: "nearest" });
  return true;
}

export const FootnoteReferenceNode = Node.create({
  name: "footnoteReference", priority: 1000, group: "inline", inline: true, atom: true,
  addAttributes() { return { label: { default: "1", parseHTML: element => element.getAttribute("data-label"), rendered: false } }; },
  // DOMParser collects mark rules before node rules at equal priority. Explicit
  // parse priority keeps Link from consuming reference anchors on paste.
  parseHTML() { return [{ tag: 'sup[data-type="footnoteReference"]', priority: 100 }, { tag: 'a[data-type="footnoteReference"]', priority: 100 }]; },
  renderHTML({ node }) {
    return ["a", { href: `#${footnoteAnchor(node.attrs.label)}`, "data-type": "footnoteReference", "data-label": node.attrs.label, "data-markdown-label": markdownFootnoteLabel(this.editor, node.attrs.label), "data-number": node.attrs.label,
      "class": "footnote-reference", "role": "button", "tabindex": "0", "aria-label": `Footnote ${node.attrs.label}` }, ["span", { "class": "sr-only" }, `Footnote ${node.attrs.label}`]];
  },
  renderText({ node }) { return `[^${markdownFootnoteLabel(this.editor, node.attrs.label)}]`; },
  addInputRules() { return [new InputRule({ find: /(?<!\\)\[\^\]$/, handler: ({ state, range }) => {
    if (!this.editor.isEditable) return null;
    for (let depth = state.selection.$from.depth; depth > 0; depth--) {
      if (state.selection.$from.node(depth).type.name === "footnoteDefinition") return null;
    }
    const label = nextFootnoteLabel(state.doc);
    const tr = state.tr;
    tr.replaceWith(range.from, range.to, this.type.create({ label }));
    const position = definitionInsertionPosition(tr.doc);
    tr.insert(position, state.schema.nodes.footnoteDefinition.createAndFill({ label })!);
    tr.setSelection(TextSelection.near(tr.doc.resolve(position + 1))).scrollIntoView();
  } })]; },
});

export const FootnoteDefinitionNode = Node.create({
  name: "footnoteDefinition", group: "block", content: "block+", defining: true, isolating: true,
  addAttributes() { return {
    label: { default: "1", parseHTML: element => element.getAttribute("data-label"), rendered: false },
    markdown: { default: "", parseHTML: element => element.getAttribute("data-markdown") ?? "", rendered: false },
  }; },
  parseHTML() { return [{ tag: 'aside[data-type="footnoteDefinition"]', contentElement: '.footnote-content' }]; },
  renderHTML({ node }) {
    return ["aside", { "data-type": "footnoteDefinition", "data-label": node.attrs.label, "data-markdown-label": markdownFootnoteLabel(this.editor, node.attrs.label),
      id: footnoteAnchor(node.attrs.label), "data-markdown": node.attrs.markdown, class: "footnote-definition" },
    ["button", { type: "button", contenteditable: "false", "data-footnote-backlink": node.attrs.label,
      class: "footnote-backlink", "aria-label": "Go to footnote reference" }, node.attrs.label],
    ["div", { class: "footnote-content" }, 0]];
  },
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement("aside");
      dom.className = "footnote-definition";
      dom.dataset.type = "footnoteDefinition";
      const button = document.createElement("button");
      button.type = "button";
      button.contentEditable = "false";
      button.className = "footnote-backlink";
      const contentDOM = document.createElement("div");
      contentDOM.className = "footnote-content";
      dom.append(button, contentDOM);
      const update = (next: PMNode, nextDecorations: readonly Decoration[]) => {
        if (next.type.name !== "footnoteDefinition") return false;
        const number = nextDecorations.map(decoration =>
          decoration.spec.footnoteNumber as string | undefined
        ).find(Boolean);
        dom.dataset.label = next.attrs.label;
        dom.id = footnoteAnchor(next.attrs.label);
        button.dataset.footnoteBacklink = next.attrs.label;
        button.textContent = number ?? "–";
        button.disabled = !number;
        button.title = number ? `Go to reference for footnote ${number}` : "Not referenced in this note";
        button.setAttribute("aria-label", button.title);
        return true;
      };
      update(node, decorations);
      return { dom, contentDOM, update, ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM.contains(mutation.target) };
    };
  },
});

function numberedReferences(doc: PMNode) {
  const numbers = new Map<string, number>();
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "footnoteReference") return;
    const key = footnoteKey(node.attrs.label);
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-number": String(numbers.get(key)), "aria-label": `Footnote ${numbers.get(key)}` }));
  });
  doc.descendants((node, pos) => {
    if (node.type.name !== "footnoteDefinition") return;
    const number = numbers.get(footnoteKey(node.attrs.label));
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-number": number ? String(number) : "" }, { footnoteNumber: number ? String(number) : undefined }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
function containsReference(node: PMNode | Fragment) {
  let found = false;
  node.descendants(child => { if (["footnoteReference", "footnoteDefinition"].includes(child.type.name)) found = true; });
  return found;
}
function footnoteStructureChanged(tr: Transaction) {
  return tr.steps.some((step, index) => {
    const json = step.toJSON();
    if (!String(json.stepType).startsWith("replace")) return false;
    if (/"footnote(?:Reference|Definition)"/.test(JSON.stringify(json.slice ?? {}))) return true;
    return typeof json.from === "number" && typeof json.to === "number" && json.from < json.to
      && containsReference(tr.docs[index].slice(json.from, json.to).content);
  });
}

function footnoteContentChanged(tr: Transaction) {
  return tr.steps.some((step, index) => {
    const { from, pos } = step.toJSON();
    const position = typeof from === "number" ? from : pos;
    if (typeof position !== "number") return false;
    const $position = tr.docs[index].resolve(position);
    for (let depth = $position.depth; depth > 0; depth--) {
      if ($position.node(depth).type.name === "footnoteDefinition") return true;
    }
    return false;
  });
}

function selectedFootnote(selection: Selection) {
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const node = selection.$from.node(depth);
    if (node.type.name === "footnoteDefinition") return footnoteKey(node.attrs.label);
  }
  return null;
}

/** Reorder after structural edits or after leaving an edited footnote. */
function orderDefinitions(tr: Transaction) {
  const definitions: { node: PMNode; pos: number }[] = [];
  const numbers = new Map<string, number>();
  tr.doc.descendants(node => {
    if (node.type.name === "footnoteDefinition") return false;
    if (node.type.name === "footnoteReference" && !numbers.has(footnoteKey(node.attrs.label)))
      numbers.set(footnoteKey(node.attrs.label), numbers.size);
  });
  tr.doc.forEach((node, pos) => { if (node.type.name === "footnoteDefinition") definitions.push({ node, pos }); });
  const ordered = [...definitions].sort((a, b) => (numbers.get(footnoteKey(a.node.attrs.label)) ?? Infinity)
    - (numbers.get(footnoteKey(b.node.attrs.label)) ?? Infinity));
  if (ordered.every((item, index) => item === definitions[index])) return null;
  const selection = tr.selection;
  const anchor = definitions.find(item => selection.anchor > item.pos && selection.anchor < item.pos + item.node.nodeSize);
  const head = definitions.find(item => selection.head > item.pos && selection.head < item.pos + item.node.nodeSize);
  const positions = new Map<PMNode, number>();
  let insertAt = definitions[0].pos;
  const contiguous = definitions.every((item, index) => !index || definitions[index - 1].pos + definitions[index - 1].node.nodeSize === item.pos);
  if (contiguous) {
    // One replacement keeps reordering linear in the number of definitions,
    // instead of creating thousands of steps and remapping each through them.
    const last = definitions[definitions.length - 1];
    tr.replaceWith(insertAt, last.pos + last.node.nodeSize, ordered.map(item => item.node));
  } else {
    // Preserve intervening prose in unusual imported editor documents.
    for (const item of [...definitions].reverse()) tr.delete(item.pos, item.pos + item.node.nodeSize);
    insertAt = tr.mapping.map(insertAt);
    tr.insert(insertAt, ordered.map(item => item.node));
  }
  for (const item of ordered) {
    positions.set(item.node, insertAt);
    insertAt += item.node.nodeSize;
  }
  if (anchor && head) tr.setSelection(TextSelection.create(tr.doc,
    positions.get(anchor.node)! + selection.anchor - anchor.pos,
    positions.get(head.node)! + selection.head - head.pos));
  return tr;
}

export const FootnoteInteractions = Extension.create({
  name: "footnoteInteractions",
  onTransaction({ editor, transaction, appendedTransactions }) {
    const transactions = [transaction, ...appendedTransactions];
    // Renumbering can change the saved Markdown without changing editor nodes.
    // Tiptap only emits update for document changes, so publish this case through
    // the same deferred persistence path as ordinary edits.
    if (transactions.some(tr => tr.getMeta(normalizeFootnotes)) && !transactions.some(tr => tr.docChanged)) {
      editor.emit("update", { editor, transaction, appendedTransactions });
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin<FootnoteState>({
      key: footnoteNumberingKey,
      state: {
        // Typing only marks numbering as pending. Normalize when the footnote
        // loses focus, then reuse the map during subsequent content edits.
        init: (_, state) => ({ decorations: numberedReferences(state.doc), markdownLabels: undefined, pendingNormalization: false }),
        apply: (tr, current) => {
          if (tr.getMeta(normalizeFootnotes)) return {
            decorations: tr.docChanged ? numberedReferences(tr.doc) : current.decorations,
            markdownLabels: numberedMarkdownLabels(tr.doc), pendingNormalization: false,
          };
          if (!tr.docChanged) return current;
          const changed = footnoteStructureChanged(tr);
          return changed
            ? { decorations: numberedReferences(tr.doc), markdownLabels: numberedMarkdownLabels(tr.doc), pendingNormalization: false }
            : { ...current, decorations: current.decorations.map(tr.mapping, tr.doc),
              pendingNormalization: current.pendingNormalization || !current.markdownLabels && footnoteContentChanged(tr) };
        },
      },
      appendTransaction(transactions, old, state) {
        const finishedEditing = editor.isEditable && footnoteNumberingKey.getState(state)?.pendingNormalization
          && (transactions.some(tr => tr.getMeta(finishFootnoteEdit)) || selectedFootnote(old.selection) !== selectedFootnote(state.selection));
        // Append the reorder so it stays in the edit's undo group even if the
        // user pauses before leaving the footnote.
        const reordered = finishedEditing
          ? (orderDefinitions(state.tr) ?? state.tr).setMeta(normalizeFootnotes, true)
          : transactions.some(footnoteStructureChanged) ? orderDefinitions(state.tr) : null;
        // Mouse clicks and horizontal arrows can create gap selections outside
        // isolating definitions. Keep those selections in editable footnote text.
        if ((reordered ?? state).selection instanceof GapCursor) {
          const { $from } = (reordered ?? state).selection;
          const direction = $from.nodeBefore?.type.name === "footnoteDefinition" ? -1
            : $from.nodeAfter?.type.name === "footnoteDefinition" ? 1 : 0;
          if (direction) {
            const selection = TextSelection.findFrom($from, direction, true);
            if (selection) return (reordered ?? state.tr).setSelection(selection).scrollIntoView();
          }
        }
        return reordered;
      },
      props: {
        decorations(state) { return this.getState(state)?.decorations; },
        handleDOMEvents: {
          blur(view) {
            if (editor.isEditable && footnoteNumberingKey.getState(view.state)?.pendingNormalization) {
              view.dispatch(view.state.tr.setMeta(finishFootnoteEdit, true));
            }
            return false;
          },
          keydown(_view, event) { return handleFootnoteArrow(editor, event); },
          click(_view, event) {
            const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-type="footnoteReference"], [data-footnote-backlink]') : null;
            if (!element || event.button !== 0 || event.ctrlKey) return false;
            event.preventDefault(); event.stopPropagation();
            if (element.dataset.footnoteBacklink) selectFootnote(editor, element.dataset.footnoteBacklink);
            else if (element.dataset.label) editFootnote(editor, element.dataset.label);
            return true;
          },
        },
        handleKeyDown(_view, event) {
          if (handleEmptyFootnoteDelete(editor, event)) return true;
          const target = event.target;
          if (!(target instanceof HTMLElement) || !target.matches('[data-type="footnoteReference"], [data-footnote-backlink]') || !["Enter", " "].includes(event.key)) return false;
          event.preventDefault();
          if (target.dataset.footnoteBacklink) selectFootnote(editor, target.dataset.footnoteBacklink);
          else if (target.dataset.label) editFootnote(editor, target.dataset.label);
          return true;
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

/** Connect the note body and footnotes at their visual line boundaries. */
export function handleFootnoteArrow(editor: Editor, event: KeyboardEvent) {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    || !["ArrowUp", "ArrowDown"].includes(event.key)) return false;
  const { selection, doc } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  let depth = selection.$from.depth;
  while (depth > 0 && selection.$from.node(depth).type.name !== "footnoteDefinition") depth--;
  const direction = event.key === "ArrowDown" ? 1 : -1;
  if (!depth && direction === -1) return false;
  if (!editor.view.endOfTextblock(direction === 1 ? "down" : "up")) return false;
  if (!depth) {
    let first: { node: PMNode; pos: number } | undefined;
    doc.forEach((node, pos) => {
      if (!first && node.type.name === "footnoteDefinition") first = { node, pos };
    });
    if (!first) return false;
    const bodyEnd = TextSelection.findFrom(doc.resolve(first.pos), -1, true);
    if (!bodyEnd || bodyEnd.$from.start() !== selection.$from.start()) return false;
    const next = TextSelection.findFrom(doc.resolve(first.pos + 1), 1, true);
    event.preventDefault();
    editor.view.dispatch(editor.state.tr.setSelection(next && next.to < first.pos + first.node.nodeSize
      ? next : NodeSelection.create(doc, first.pos)).scrollIntoView());
    return true;
  }
  const definition = selection.$from.node(depth);
  const start = selection.$from.before(depth);
  const blocks: number[] = [];
  definition.descendants((node, pos) => {
    if (node.isTextblock) { blocks.push(start + 1 + pos); return false; }
  });
  const currentBlock = selection.$from.before(selection.$from.depth);
  if (currentBlock !== (direction === 1 ? blocks.at(-1) : blocks[0])) return false;

  event.preventDefault();
  let adjacent: { node: PMNode; pos: number } | undefined;
  doc.forEach((node, pos) => {
    if (node.type.name !== "footnoteDefinition") return;
    if ((direction === 1 && pos > start && !adjacent) || (direction === -1 && pos < start)) adjacent = { node, pos };
  });
  if (adjacent) {
    const { node, pos } = adjacent;
    const next = TextSelection.findFrom(doc.resolve(direction === 1 ? pos + 1 : pos + node.nodeSize - 1), direction, true);
    const inside = next && next.from > pos && next.to < pos + node.nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(inside ? next : NodeSelection.create(doc, pos)).scrollIntoView());
  } else if (direction === -1) {
    const bodyEnd = TextSelection.findFrom(doc.resolve(start), -1, true);
    if (bodyEnd) editor.view.dispatch(editor.state.tr.setSelection(bodyEnd).scrollIntoView());
  }
  return true;
}

/** A second delete on an empty definition removes its attachments too. */
export function handleEmptyFootnoteDelete(editor: Editor, event: KeyboardEvent) {
  if (!editor.isEditable || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    || !["Backspace", "Delete"].includes(event.key)) return false;
  const selection = editor.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const definition = selection.$from.node(depth);
    if (definition.type.name !== "footnoteDefinition") continue;
    let hasContent = false;
    definition.descendants(node => {
      // Empty paragraphs, lists and line breaks are safe to remove, but images,
      // equations and other non-text content still make this a real footnote.
      if (node.isText || node.isAtom && !node.isTextblock && node.type.name !== "hardBreak") hasContent = true;
    });
    if (hasContent) return false;
    if (!deleteFootnote(editor, definition.attrs.label)) return false;
    event.preventDefault();
    return true;
  }
  return false;
}

/** Delete the definition and every attachment as one undoable editor change. */
export function deleteFootnote(editor: Editor, label: string) {
  if (!editor.isEditable || !validFootnoteLabel(label)) return false;
  const ranges: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (["footnoteReference", "footnoteDefinition"].includes(node.type.name)
      && footnoteKey(node.attrs.label) === footnoteKey(label)) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
      return false;
    }
  });
  if (!ranges.length) return false;
  const tr = closeHistory(editor.state.tr);
  for (const range of ranges.reverse()) tr.delete(range.from, range.to);
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
