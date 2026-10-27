// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import * as calculation from "../lib/automaticCalculation";
import { AutomaticCalculation } from "./automaticCalculation";
import { undoTextShortcut } from "./textShortcutUndo";
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { htmlToMarkdown, markdownToHtml } = await import("../lib/markdown");
const { TextShortcuts } = await import("./textShortcuts");

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
function make(content: string) {
  const editor = new Editor({ extensions: [StarterKit, TextShortcuts, AutomaticCalculation], content, parseOptions: { preserveWhitespace: "full" },
    editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
function key(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  return editor.view.someProp("handleKeyDown", handler => handler(editor.view, new KeyboardEvent("keydown", { key, ...options })));
}

it.each(["1 + 2", "$1 + 2", "1 + $2", "$1 + $2"])("inserts a spaced, portable answer for %s and reverses it on Backspace", expression => {
  const editor = make(`<p>${expression} </p>`);
  type(editor, "=");
  const expected = `${expression} = ${expression.includes("$") ? "$3.00" : "3"}`;
  expect(editor.getText()).toBe(expected);
  const markdown = htmlToMarkdown(editor.getHTML());
  expect(markdownToHtml(markdown)).toContain(expected);
  expect(key(editor, "Backspace")).toBe(true);
  expect(editor.getText()).toBe(`${expression} =`);
  expect(editor.state.selection.$from.parentOffset).toBe(expression.length + 2);
  type(editor, " ");
  expect(editor.getText()).toBe(`${expression} = `);
});

it("keeps formatting and handles formulas in lists and after hard breaks", () => {
  const editor = make("<ul><li><p>Prose<br><strong>Total: (1 + 2) * 4 </strong></p></li></ul>");
  type(editor, "=");
  expect(editor.getHTML()).toContain("<strong>Total: (1 + 2) * 4 = 12</strong>");
  expect(key(editor, "Backspace")).toBe(true);
  expect(editor.getHTML()).toContain("<strong>Total: (1 + 2) * 4 =</strong>");
});

it.each(["<p>x + 1 + 2 </p>", "<p>Notes 1 + 2 </p>", "<pre><code>1 + 2 </code></pre>",
  "<p><code>1 + 2 </code></p>", '<p><a href="https://example.com">1 + 2 </a></p>',
  '<p><code>1</code> + 2 </p>', '<p><a href="https://example.com">1</a> + 2 </p>'])("leaves prose and code unchanged: %s", content => {
  const editor = make(content);
  const before = editor.state.selection.$from.parent.textContent;
  type(editor, "=");
  expect(editor.state.selection.$from.parent.textContent).toBe(before + "=");
});

it("calculates without spaces around operators or before equals", () => {
  const editor = make("<p>1+2</p>");
  type(editor, "=");
  expect(editor.getText()).toBe("1+2= 3");
  expect(key(editor, "Backspace")).toBe(true);
  expect(editor.getText()).toBe("1+2=");
});

it("leaves selections, mid-line edits, composition, and read-only content alone", () => {
  const editor = make("<p>1 + 2 extra</p>");
  editor.commands.setTextSelection(6);
  type(editor, "=");
  expect(editor.getText()).toBe("1 + 2= extra");
  editor.commands.setContent("<p>1 + 2 </p>", { parseOptions: { preserveWhitespace: "full" } });
  editor.commands.setTextSelection({ from: 1, to: 7 });
  type(editor, "=");
  expect(editor.getText()).toBe("=");
  for (const composing of [true, false]) {
    editor.commands.setContent("<p>1 + 2 </p>", { parseOptions: { preserveWhitespace: "full" } });
    editor.commands.setTextSelection(7);
    editor.setEditable(composing);
    Object.defineProperty(editor.view, "composing", { configurable: true, value: composing });
    type(editor, "=");
    expect(editor.getText()).toBe("1 + 2 =");
  }
});

it("expires immediate Backspace after typing, navigation, or replacement; supports ordinary Undo/Redo", () => {
  const editor = make("<p>1 + 2 </p>");
  type(editor, "=");
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe("1 + 2 ");
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getText()).toBe("1 + 2 = 3");
  // Undo/Redo expires the automatic-replacement undo.
  expect(undoTextShortcut(editor)).toBe(false);
  for (const change of ["type", "navigate", "replace"]) {
    editor.commands.setContent("<p>1 + 2 </p>", { parseOptions: { preserveWhitespace: "full" } }); editor.commands.setTextSelection(7);
    type(editor, "=");
    if (change === "type") type(editor, "x");
    if (change === "navigate") { editor.commands.setTextSelection(1); editor.commands.setTextSelection(10); }
    if (change === "replace") editor.commands.setContent("<p>Another note</p>");
    expect(undoTextShortcut(editor)).toBe(false);
  }
});

it("does no parsing on ordinary typing and bounds look-behind in long paragraphs", () => {
  const parse = vi.spyOn(calculation, "calculateExpression");
  const editor = make(`<p>${"word ".repeat(10000)}</p>`);
  for (const letter of "ordinary typing") type(editor, letter);
  expect(parse).not.toHaveBeenCalled();
  const read = vi.spyOn(editor.state.selection.$from.parent, "textBetween");
  type(editor, "=");
  expect(read.mock.calls.every(([from, to]) => to - from <= calculation.calculationMaxLength + 1)).toBe(true);
  expect(parse).not.toHaveBeenCalled();
  // A short formula after a hard break still works in the same long paragraph.
  editor.commands.setHardBreak();
  for (const letter of "1 + 2 =") type(editor, letter);
  expect(editor.state.doc.textContent).toMatch(/1 \+ 2 = 3$/);
  expect(parse).toHaveBeenCalledOnce();
});
