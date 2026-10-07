// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { undoDepth } from "@tiptap/pm/history";
import { afterEach, expect, it, vi } from "vitest";
import { ListFolding, listFoldingKey } from "./listFolding";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { htmlToMarkdown } from "../lib/markdown";
import { sortSelectedLines } from "./sortLines";
import { resetEditorHistory } from "./notesEditorBehavior";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
function make(content: string) {
  const editor = new Editor({ extensions: [StarterKit, BulletMethodMarkers, ListFolding], content,
    editorProps: { handleScrollToSelection: () => true } });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 0 });
  editors.push(editor);
  // Let StarterKit add its trailing paragraph before measuring view-only work.
  editor.view.dispatch(editor.state.tr);
  return editor;
}
const nested = '<ul><li><p>IN PROGRESS: Parent</p><ul><li><p>Child</p><ul><li><p>Grandchild</p></li></ul></li></ul></li><li><p>Leaf</p></li></ul>';
const caret = (editor: Editor, index = 0) => editor.view.dom.querySelectorAll<HTMLButtonElement>(".list-fold-button")[index];
const folded = (editor: Editor) => [...editor.view.dom.querySelectorAll('li[data-list-collapsed="true"]')].map(li => {
  const paragraph = li.querySelector("p")!.cloneNode(true) as HTMLElement;
  paragraph.querySelectorAll(".list-fold-summary-button").forEach(button => button.remove());
  return paragraph.textContent;
});

it("folds each nested level independently, with no document, Markdown, update, or undo changes", () => {
  const editor = make(nested);
  const before = editor.getJSON(), markdown = htmlToMarkdown(editor.getHTML()), historyDepth = undoDepth(editor.state);
  const onUpdate = vi.fn(); editor.on("update", onUpdate);
  expect(editor.view.dom.querySelectorAll(".list-fold-button")).toHaveLength(2);
  caret(editor, 1).click(); caret(editor).click();
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent", "Child"]);
  expect(caret(editor).getAttribute("aria-expanded")).toBe("false");
  caret(editor).click();
  expect(folded(editor)).toEqual(["Child"]);
  expect(editor.getJSON()).toEqual(before);
  expect(htmlToMarkdown(editor.getHTML())).toBe(markdown);
  expect(editor.getHTML()).not.toContain("list-fold");
  expect(onUpdate).not.toHaveBeenCalled();
  expect(undoDepth(editor.state)).toBe(historyDepth);
});

it("works for ordinary and numbered parents with Bullet Statuses disabled, and hides controls in Story", () => {
  const editor = make('<ol><li><p>Numbered</p><ul><li><p>Child</p></li></ul></li></ol>');
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: false }));
  caret(editor).click(); expect(folded(editor)).toEqual(["Numbered"]);
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { writingStyle: "story" }));
  expect(caret(editor)).toBeUndefined(); expect(folded(editor)).toEqual([]);
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { writingStyle: "notes" }));
  expect(caret(editor).getAttribute("aria-expanded")).toBe("true");
});

it("shows all children when disabled, retains unchanged folds, and ignores DONE and writing-style updates", () => {
  const editor = make(nested);
  caret(editor).click();
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: false }));
  expect(caret(editor)).toBeUndefined(); expect(folded(editor)).toEqual([]);
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { writingStyle: "notes" }));
  expect(caret(editor)).toBeUndefined();
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: true }));
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent"]);
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: false }));
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, replaceBullets: true, autoSortOnClick: false }));
  editor.view.dom.querySelector<HTMLButtonElement>(".bullet-method-marker-button")!.click();
  expect(editor.state.doc.textContent).toContain("DONE: Parent");
  expect(caret(editor)).toBeUndefined();
  const walk = vi.spyOn(editor.state.doc, "nodesBetween");
  editor.commands.insertContent("x");
  expect(listFoldingKey.getState(editor.state)?.initialized).toBe(false);
  // The folding plugin doesn't inspect changes while disabled.
  expect(walk).not.toHaveBeenCalled();
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: true }));
  expect(caret(editor)).toBeDefined(); expect(folded(editor)).toEqual([]);
});

it("restores saved folds after enabling a freshly loaded disabled note without hiding its cursor", () => {
  const editor = make(nested);
  const item = editor.state.doc.firstChild!.firstChild!;
  const saved = { version: 1 as const, contentFingerprint: "preview", docSize: editor.state.doc.content.size,
    collapsed: [[1, item.nodeSize, item.firstChild!.nodeSize] as [number, number, number]] };
  resetEditorHistory(editor, { listFolding: { writingStyle: "notes", foldingEnabled: false, saved } });
  expect(caret(editor)).toBeUndefined();
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: true }));
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent"]);
  resetEditorHistory(editor, { listFolding: { writingStyle: "notes", foldingEnabled: false, saved } });
  let childPos = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent === "Child") childPos = pos + 1; });
  editor.commands.setTextSelection(childPos);
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { foldingEnabled: true }));
  expect(folded(editor)).toEqual([]);
  expect(editor.state.selection.$from.parent.textContent).toBe("Child");
});

it("expands only the clicked ellipsis's parent without changing content, selection, or undo history", () => {
  const editor = make('<ul><li><p>First</p><ul><li><p>One</p></li></ul></li><li><p>Second</p><ul><li><p>Two</p></li></ul></li></ul>');
  const before = editor.getJSON(), markdown = htmlToMarkdown(editor.getHTML()), historyDepth = undoDepth(editor.state);
  const onUpdate = vi.fn(); editor.on("update", onUpdate);
  caret(editor).click(); caret(editor, 1).click();
  const selection = editor.state.selection;
  const summaries = editor.view.dom.querySelectorAll<HTMLButtonElement>(".list-fold-summary-button");
  expect(summaries).toHaveLength(2);
  expect(summaries[0].textContent).toBe("...");
  expect(summaries[0].getAttribute("aria-label")).toBe("Expand sub-bullets");
  summaries[1].click();
  expect(folded(editor)).toEqual(["First"]);
  expect(editor.view.dom.querySelectorAll(".list-fold-summary-button")).toHaveLength(1);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(editor.getJSON()).toEqual(before);
  expect(htmlToMarkdown(editor.getHTML())).toBe(markdown);
  expect(editor.getHTML()).not.toContain("...");
  expect(onUpdate).not.toHaveBeenCalled();
  expect(undoDepth(editor.state)).toBe(historyDepth);
});

it("keeps one ellipsis at the end after preceding edits, parent edits, splits, and undo", () => {
  const editor = make('<p>Before</p><ul><li><p>Parent <a href="https://example.com">link</a></p><ul><li><p>Child</p></li></ul></li></ul>');
  caret(editor).click();
  const summary = () => editor.view.dom.querySelector<HTMLButtonElement>(".list-fold-summary-button")!;
  expect(summary().closest("a")).toBeNull();
  editor.commands.setTextSelection(2); editor.commands.insertContent("New ");
  let parentEnd = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent.startsWith("Parent")) parentEnd = pos + node.nodeSize - 1; });
  editor.commands.setTextSelection(parentEnd); editor.commands.insertContent(" edited");
  expect(editor.view.dom.querySelectorAll(".list-fold-summary-button")).toHaveLength(1);
  expect(summary().previousSibling?.textContent).toContain(" edited");
  editor.commands.setTextSelection(parentEnd - 2); editor.commands.splitBlock();
  expect(editor.view.dom.querySelectorAll(".list-fold-summary-button")).toHaveLength(1);
  expect(summary().parentElement).toBe(editor.view.dom.querySelector("li > p"));
  editor.commands.undo();
  expect(editor.view.dom.querySelectorAll(".list-fold-summary-button")).toHaveLength(1);
  summary().click();
  expect(folded(editor)).toEqual([]);
  expect(editor.view.dom.querySelectorAll(".list-fold-summary-button")).toHaveLength(0);
});

it.each([true, false])("collapses the clicked DONE parent after sorting (auto-sort %s), and allows reopening", autoSortOnClick => {
  const editor = make('<ul><li><p>TODO: Sibling</p></li><li><p>IN PROGRESS: Parent</p><ul><li><p>TODO: Child</p></li></ul></li></ul>');
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, replaceBullets: true, dimCompleted: true, autoSortOnClick }));
  editor.view.dom.querySelectorAll<HTMLButtonElement>(".bullet-method-marker-button")[1].click();
  expect(folded(editor)).toEqual(["DONE: Parent"]);
  expect(editor.state.selection.$from.parent.textContent).toBe("DONE: Parent");
  caret(editor).click(); expect(folded(editor)).toEqual([]);
  editor.commands.undo(); expect(editor.state.doc.textContent).toContain("IN PROGRESS: Parent");
});

it("recognizes DONE by stable status identity when its prefix is renamed", () => {
  const editor = make(nested);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses.map(status => status.id === "done" ? { ...status, prefix: "FINISHED" } : status))
    .setMeta("bulletMethodDisplay", { enabled: true, replaceBullets: true, dimCompleted: true }));
  editor.view.dom.querySelector<HTMLButtonElement>(".bullet-method-marker-button")!.click();
  expect(folded(editor)).toEqual(["FINISHED: Parent"]);
});

it("moves a selection out of hidden children and expands ancestors on keyboard/search navigation", () => {
  const editor = make(nested);
  let grandchildPos = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent === "Grandchild") grandchildPos = pos + 1; });
  editor.commands.setTextSelection(grandchildPos);
  caret(editor).click();
  expect(editor.state.selection.$from.parent.textContent).toBe("IN PROGRESS: Parent");
  caret(editor).click(); caret(editor, 1).click(); caret(editor).click();
  editor.commands.setTextSelection(grandchildPos);
  expect(folded(editor)).toEqual([]);
});

it("preserves folds through edits before and inside a parent, and through sorting", () => {
  const editor = make('<p>Before</p>' + nested);
  caret(editor).click();
  editor.commands.setTextSelection(2); editor.commands.insertContent("New ");
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent"]);
  let parentPos = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent.includes("Parent")) parentPos = pos + node.nodeSize - 1; });
  editor.commands.setTextSelection(parentPos); editor.commands.insertContent(" edited");
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent edited"]);
  editor.commands.setTextSelection({ from: parentPos - 2, to: editor.state.doc.content.size - 1 });
  editor.view.dispatch(sortSelectedLines(editor.state, "sort_za")!);
  expect(folded(editor)).toEqual(["IN PROGRESS: Parent edited"]);
});

it("removes obsolete carets when children are lifted, and resets on a new document", () => {
  const editor = make(nested);
  caret(editor).click();
  editor.commands.setContent(nested);
  expect(folded(editor)).toEqual([]);
  let childPos = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent === "Child") childPos = pos + 1; });
  editor.commands.setTextSelection(childPos); editor.commands.liftListItem("listItem");
  expect(editor.view.dom.querySelectorAll(".list-fold-button")).toHaveLength(1);
});

it("bounds decoration work to the edited item and ancestors in a long note", () => {
  const editor = make('<ul>' + Array.from({ length: 1000 }, (_, i) => `<li><p>Parent ${i}</p><ul><li><p>Child ${i}</p></li></ul></li>`).join("") + '</ul>');
  const before = listFoldingKey.getState(editor.state);
  editor.commands.setTextSelection(8);
  expect(listFoldingKey.getState(editor.state)?.decorations).toBe(before?.decorations);
  const unrelated = editor.state.doc.firstChild!.child(500);
  const read = vi.spyOn(unrelated, "child");
  editor.commands.insertContent("x");
  expect(read).not.toHaveBeenCalled();
  expect(editor.view.dom.querySelectorAll(".list-fold-button")).toHaveLength(1000);
});
