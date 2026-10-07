// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { ListFolding } from "./listFolding";
import { getFoldedListClipboardRange, getFoldedListCutDeleteRange } from "./foldedListClipboard";
import { serializeEditorSelectionForClipboard } from "./notesEditorBehavior";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function make(content: string) {
  const editor = new Editor({ extensions: [StarterKit, ListFolding], content, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); editor.view.dispatch(editor.state.tr);
  return editor;
}
function selectRow(editor: Editor, name: string, reverse = false) {
  let from = 0, to = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent === name) { from = pos + 1; to = pos + node.nodeSize - 1; } });
  editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
  return { from, to };
}
const subtree = '<li><p>Parent <strong>bold</strong></p><ul><li><p>Child</p><ol><li><p>Grandchild</p></li></ol></li></ul></li>';
it.each(["ul", "ol"])("copies the full collapsed %s subtree as readable Markdown and rich HTML", tag => {
  const editor = make(`<${tag}>${subtree}<li><p>Sibling</p></li></${tag}>`);
  editor.view.dom.querySelector<HTMLButtonElement>(".list-fold-button")!.click();
  selectRow(editor, "Parent bold", true);
  const payload = serializeEditorSelectionForClipboard(editor.view)!;
  expect(payload.plainText).toContain("Parent **bold**");
  expect(payload.plainText).toContain("Child"); expect(payload.plainText).toContain("Grandchild");
  expect(payload.plainText).not.toContain("Sibling"); expect(payload.html).not.toContain("list-fold");
  const pasted = make(payload.html);
  expect(pasted.state.doc.firstChild!.type.name).toBe(tag === "ul" ? "bulletList" : "orderedList");
  expect(pasted.state.doc.firstChild!.firstChild!.child(1).firstChild!.child(1).textContent).toBe("Grandchild");
  expect(pasted.view.dom.querySelector('[data-list-collapsed="true"]')).toBeNull();
});

it("keeps partial selections as text, while a full-line cut removes its children and can be undone", () => {
  const editor = make(`<ul>${subtree}<li><p>Sibling</p></li></ul>`);
  editor.view.dom.querySelector<HTMLButtonElement>(".list-fold-button")!.click();
  const row = selectRow(editor, "Parent bold");
  editor.commands.setTextSelection({ from: row.from + 1, to: row.to });
  expect(getFoldedListClipboardRange(editor.state)).toBeNull();
  expect(serializeEditorSelectionForClipboard(editor.view)?.plainText).toBe("arent **bold**");
  selectRow(editor, "Parent bold");
  const range = getFoldedListCutDeleteRange(editor.state)!;
  editor.view.dispatch(editor.state.tr.deleteRange(range.from, range.to).setMeta("uiEvent", "cut"));
  expect(editor.state.doc.firstChild!.childCount).toBe(1);
  expect(editor.state.doc.textContent).toBe("Sibling");
  editor.commands.undo();
  expect(editor.state.doc.textContent).toBe("Parent boldChildGrandchildSibling");
});

it("cuts a sole folded item without leaving an empty bullet", () => {
  const editor = make(`<ul>${subtree}</ul>`);
  editor.view.dom.querySelector<HTMLButtonElement>(".list-fold-button")!.click();
  selectRow(editor, "Parent bold");
  const range = getFoldedListCutDeleteRange(editor.state)!;
  expect(range.from).toBe(0); expect(range.to).toBe(editor.state.doc.firstChild!.nodeSize);
  editor.view.dispatch(editor.state.tr.deleteRange(range.from, range.to));
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe("");
});

it("includes multiple folded rows and preserves surrounding partial selections", () => {
  const editor = make('<p>Before</p><ul><li><p>One</p><ul><li><p>First child</p></li></ul></li><li><p>Two</p><ul><li><p>Second child</p></li></ul></li><li><p>After</p></li></ul>');
  [...editor.view.dom.querySelectorAll<HTMLButtonElement>(".list-fold-button")].forEach(button => button.click());
  const row = selectRow(editor, "Two");
  editor.commands.setTextSelection({ from: 3, to: row.to });
  const payload = serializeEditorSelectionForClipboard(editor.view)!;
  expect(payload.plainText).toContain("fore"); expect(payload.plainText).toContain("First child");
  expect(payload.plainText).toContain("Second child"); expect(payload.plainText).not.toContain("After");
});
