// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CellSelection } from "@tiptap/pm/tables";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { sortSelectedLines, type SortCommand } from "./sortLines";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { markdownToHtml, htmlToMarkdown } = await import("../lib/markdown");

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function setup(content: string) {
  const editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader], content });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
  return editor;
}
function sort(editor: Editor, command: SortCommand = "sort_az") {
  const tr = sortSelectedLines(editor.state, command);
  if (tr) editor.view.dispatch(tr);
}
function texts(editor: Editor) { return editor.state.doc.content.content.map((node) => node.textContent); }

describe("Sort Lines", () => {
  it.each([
    ["sort_az", ["a", "B", "c"]],
    ["sort_za", ["c", "B", "a"]],
    ["sort_az_case", ["B", "a", "c"]],
    ["sort_za_case", ["c", "a", "B"]],
  ] as const)("orders paragraphs with %s", (command, expected) => {
    const editor = setup("<p>c</p><p>a</p><p>B</p>");
    sort(editor, command);
    expect(texts(editor)).toEqual(expected);
    editor.commands.undo();
    expect(texts(editor)).toEqual(["c", "a", "B"]);
  });
  it("sorts ordinary Markdown lines and persists readable Markdown", () => {
    const editor = setup(markdownToHtml("csdfasdf\nbddafasd\nadsfasdf"));
    sort(editor);
    const markdown = htmlToMarkdown(editor.getHTML());
    expect(markdown.indexOf("adsfasdf")).toBeLessThan(markdown.indexOf("bddafasd"));
    expect(markdown.indexOf("bddafasd")).toBeLessThan(markdown.indexOf("csdfasdf"));
  });
  it("only sorts the selected sublist", () => {
    const editor = setup("<ul><li><p>z</p><ul><li>y</li><li>x</li></ul></li><li>a</li></ul>");
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.isText && ["y", "x"].includes(node.text!)) positions.push(pos); });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, positions[0], positions[1] + 1)));
    sort(editor);
    expect(editor.state.doc.firstChild!.child(0).textContent).toBe("zxy");
    expect(editor.state.doc.firstChild!.child(1).textContent).toBe("a");
  });
  it("keeps equal keys stable and preserves formatting", () => {
    const editor = setup("<p>b</p><p><strong>A</strong></p><p>a</p>");
    sort(editor);
    expect(editor.getHTML()).toBe("<p><strong>A</strong></p><p>a</p><p>b</p>");
  });
  it("sorts whole touched paragraphs but excludes the end boundary", () => {
    const editor = setup("<p>z</p><p>c</p><p>b</p><p>a</p>");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 10)));
    sort(editor);
    expect(texts(editor)).toEqual(["z", "b", "c", "a"]);
  });
  it("sorts hard-break lines with their marks", () => {
    const editor = setup("<p>c<br><strong>a</strong><br>b</p>");
    sort(editor);
    expect(editor.getHTML()).toBe("<p><strong>a</strong><br>b<br>c</p>");
  });
  it("sorts code lines", () => {
    const editor = setup("<pre><code>z\na\nb</code></pre>");
    sort(editor);
    expect(editor.state.doc.firstChild!.textContent).toBe("a\nb\nz");
  });
  it.each(["ul", "ol"])("sorts %s siblings and each nested list independently", (tag) => {
    const editor = setup(`<${tag}><li><p>z</p><ul><li>y</li><li>x</li></ul></li><li><p>a</p><ul><li>d</li><li>c</li></ul></li></${tag}>`);
    sort(editor);
    const list = editor.state.doc.firstChild!;
    expect(list.child(0).firstChild!.textContent).toBe("a");
    expect(list.child(0).lastChild!.textContent).toBe("cd");
    expect(list.child(1).firstChild!.textContent).toBe("z");
    expect(list.child(1).lastChild!.textContent).toBe("xy");
  });
  it("preserves checkbox state", () => {
    const editor = setup('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>z</p></li><li data-type="taskItem" data-checked="false"><p>a</p></li></ul>');
    sort(editor);
    const list = editor.state.doc.firstChild!;
    expect(list.child(0).textContent).toBe("a");
    expect(list.child(0).attrs.checked).toBe(false);
    expect(list.child(1).attrs.checked).toBe(true);
  });
  it("sorts table rows by the first column and preserves headers", () => {
    const editor = setup("<table><tr><th>Name</th><th>Value</th></tr><tr><td>z</td><td>1</td></tr><tr><td>a</td><td>2</td></tr></table>");
    sort(editor);
    const table = editor.state.doc.firstChild!;
    expect(table.child(0).textContent).toBe("NameValue");
    expect(table.child(1).textContent).toBe("a2");
    expect(table.child(2).textContent).toBe("z1");
  });
  it("sorts a rectangular cell selection and keeps it selected for another sort", () => {
    const editor = setup("<table><tr><th>Name</th><th>Value</th></tr><tr><td>aaa</td><td>zzz</td></tr><tr><td>bbb</td><td>xxx</td></tr></table>");
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (["tableCell", "tableHeader"].includes(node.type.name)) cells.push(pos);
    });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[5])));
    sort(editor, "sort_za");
    expect(editor.state.doc.firstChild!.child(1).textContent).toBe("bbbxxx");
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    sort(editor, "sort_az");
    expect(editor.state.doc.firstChild!.child(1).textContent).toBe("aaazzz");
  });
  it.each(["markdown", "html"])("sorts selected rows from a reverse column selection in %s", (format) => {
    const content = format === "markdown"
      ? markdownToHtml("| Name | Value |\n| --- | --- |\n| z | keep |\n| bbb | short |\n| a | much longer |\n| x | stay |")
      : "<table><tr><th>Name</th><th>Value</th></tr><tr><td>z</td><td>keep</td></tr><tr><td>bbb</td><td>short</td></tr><tr><td>a</td><td>much longer</td></tr><tr><td>x</td><td>stay</td></tr></table>";
    const editor = setup(content);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (["tableCell", "tableHeader"].includes(node.type.name)) cells.push(pos);
    });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[7], cells[5])));
    const before = editor.state.doc;
    sort(editor);
    const table = editor.state.doc.firstChild!;
    expect(Array.from({ length: table.childCount }, (_, index) => table.child(index).textContent))
      .toEqual(["NameValue", "zkeep", "amuch longer", "bbbshort", "xstay"]);
    const selection = editor.state.selection as CellSelection;
    expect(selection).toBeInstanceOf(CellSelection);
    expect(selection.$anchorCell.nodeAfter!.textContent).toBe("short");
    expect(selection.$headCell.nodeAfter!.textContent).toBe("much longer");
    sort(editor, "sort_za");
    expect(editor.state.doc.eq(before)).toBe(true);
    editor.commands.undo();
    expect(editor.state.doc.firstChild!.child(2).textContent).toBe("amuch longer");
    editor.commands.undo();
    expect(editor.state.doc.eq(before)).toBe(true);
  });
  it("leaves merged tables unchanged", () => {
    const editor = setup('<table><tr><td rowspan="2">z</td><td>b</td></tr><tr><td>a</td></tr></table>');
    expect(sortSelectedLines(editor.state, "sort_az")).toBeNull();
  });
  it("does nothing with a caret or already sorted content", () => {
    const editor = setup("<p>a</p><p>b</p>");
    expect(sortSelectedLines(editor.state, "sort_az")).toBeNull();
    editor.commands.setTextSelection(1);
    expect(sortSelectedLines(editor.state, "sort_za")).toBeNull();
  });
});
