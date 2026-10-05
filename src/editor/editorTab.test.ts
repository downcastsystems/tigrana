// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { afterEach, expect, it } from "vitest";
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { handleEditorTabKeyDown } = await import("./editorTab");

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function make(content: string) {
  const editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })], content,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  return editor;
}
function tab(editor: Editor, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
  expect(handleEditorTabKeyDown(editor, event)).toBe(true);
  expect(event.defaultPrevented).toBe(true);
}

it.each(["bulletList", "orderedList", "taskList"])("indents and outdents %s in either direction with either end boundary", type => {
  const list = type === "orderedList" ? "ol" : "ul";
  const attrs = type === "taskList" ? ' data-type="taskList"' : "";
  const item = type === "taskList" ? ' data-type="taskItem" data-checked="false"' : "";
  for (const reverse of [false, true]) for (const trailingParagraph of [false, true]) {
    const editor = make(`<${list}${attrs}><li${item}><p>Parent</p></li><li${item}><p>Second</p></li><li${item}><p>Third</p></li></${list}><p>After</p>`);
    const node = editor.state.doc.firstChild!;
    const from = 3 + node.firstChild!.nodeSize;
    const to = trailingParagraph ? node.nodeSize + 1 : node.nodeSize - 3;
    editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    tab(editor);
    expect(editor.state.doc.textContent).toBe("ParentSecondThirdAfter");
    const nested = editor.state.doc.firstChild!.firstChild!.lastChild!;
    expect(nested.type.name).toBe(type);
    expect(nested.childCount).toBe(2);
    editor.view.dispatch(closeHistory(editor.state.tr));
    tab(editor, true);
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    expect(editor.state.doc.textContent).toBe("ParentSecondThirdAfter");
    editor.commands.undo();
    expect(editor.state.doc.firstChild!.firstChild!.lastChild!.type.name).toBe(type);
  }
});

it("does not insert literal spacing when selecting the first bullet or mixing lists with paragraph text", () => {
  for (const fromParagraph of [false, true]) {
    const editor = make('<p>Before</p><ul><li><p>First</p></li><li><p>Second</p></li></ul><p>After</p>');
    const start = editor.state.doc.firstChild!.nodeSize;
    const end = start + editor.state.doc.child(1).nodeSize;
    editor.commands.setTextSelection({ from: fromParagraph ? 2 : start + 3, to: fromParagraph ? end - 3 : end + 3 });
    const before = editor.getJSON();
    tab(editor);
    expect(editor.getJSON()).toEqual(before);
  }
});

it.each([false, true])("handles selections spanning nested bullet levels without text indents, reverse: %s", reverse => {
  const editor = make('<ul><li><p>Parent</p></li><li><p>Second</p><ul><li><p>Child</p></li></ul></li><li><p>Third</p></li></ul>');
  const from = 3 + editor.state.doc.firstChild!.firstChild!.nodeSize;
  const to = editor.state.doc.firstChild!.nodeSize - 3;
  editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
  tab(editor);
  expect(editor.state.doc.textContent).toBe("ParentSecondChildThird");
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.type.name).toBe("bulletList");
});

it.each(["text", "paragraph-end"])("does not indent an unselected parent when a nested selection starts at %s", boundary => {
  for (const reverse of [false, true]) {
    const editor = make('<ul><li><p>Previous</p></li><li><p>TODO: Talk about MyTime</p><ul><li><p>Webhooks</p></li><li><p>Polling</p></li><li><p>QUESTION: Scope?</p></li></ul></li></ul>');
    let parentPos = 0, firstPos = 0, lastPos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "paragraph") return;
      if (node.textContent.startsWith("TODO:")) parentPos = pos;
      if (node.textContent === "Webhooks") firstPos = pos;
      if (node.textContent.startsWith("QUESTION:")) lastPos = pos;
    });
    const parentParagraph = editor.state.doc.nodeAt(parentPos)!;
    const from = boundary === "text" ? firstPos + 1 : parentPos + parentParagraph.nodeSize - 1;
    const to = lastPos + editor.state.doc.nodeAt(lastPos)!.nodeSize - 1;
    editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
    const before = editor.getJSON();
    tab(editor);
    // The first child has no preceding sibling to nest beneath. Tab must not
    // silently promote the operation to the unselected TODO ancestor.
    expect(editor.getJSON()).toEqual(before);
  }
});


it.each([false, true])("does not widen a selection from a child to its parent's sibling, reverse: %s", reverse => {
  const editor = make('<ul><li><p>Previous</p></li><li><p>TODO</p><ul><li><p>Child</p></li></ul></li><li><p>Sibling</p></li></ul>');
  let from = 0, to = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    if (node.textContent === "Child") from = pos + 1;
    if (node.textContent === "Sibling") to = pos + node.nodeSize - 1;
  });
  editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
  const before = editor.getJSON();
  tab(editor);
  expect(editor.getJSON()).toEqual(before);
});

it.each([false, true])("indents selected child bullets after an unselected preceding child, reverse: %s", reverse => {
  const editor = make('<ul><li><p>TODO</p><ul><li><p>Previous</p></li><li><p>Webhooks</p></li><li><p>Polling</p></li></ul></li></ul>');
  let from = 0, to = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    if (node.textContent === "Previous") from = pos + node.nodeSize - 1;
    if (node.textContent === "Polling") to = pos + node.nodeSize - 1;
  });
  editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
  tab(editor);
  const parent = editor.state.doc.firstChild!.firstChild!;
  expect(parent.firstChild!.textContent).toBe("TODO");
  const previous = parent.lastChild!.firstChild!;
  expect(previous.firstChild!.textContent).toBe("Previous");
  expect(previous.lastChild!.type.name).toBe("bulletList");
  expect(previous.lastChild!.textContent).toBe("WebhooksPolling");
});
