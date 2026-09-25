// @vitest-environment jsdom
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CellSelection } from "@tiptap/pm/tables";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { isSortCommand, sortSelectedLines, type SortCommand } from "./sortLines";

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

describe("Bullet Method at the cursor", () => {
  function cursorIn(editor: Editor, text: string, offset = 3) {
    let position = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) position = pos + offset; });
    editor.commands.setTextSelection(position);
    return position;
  }

  it.each(["- ", "1. ", "- [ ] "])("sorts the containing list with %s markers and keeps the cursor in its item", marker => {
    const editor = setup(markdownToHtml(`${marker}TODO: Start\n${marker}DONE: Finished\n${marker}Unmarked`));
    const originalPosition = cursorIn(editor, "TODO: Start");
    const original = editor.getJSON();
    sort(editor, "sort_bullet_method");
    expect(editor.state.doc.firstChild!.content.content.map(node => node.textContent))
      .toEqual(["DONE: Finished", "TODO: Start", "Unmarked"]);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("TODO: Start");
    expect(editor.state.selection.$from.parentOffset).toBe(3);
    expect(sortSelectedLines(editor.state, "sort_bullet_method")).toBeNull();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection.from).toBe(originalPosition);
  });

  it("sorts a nested hierarchy using custom statuses and carries descendants with their parent", () => {
    const editor = setup("<p>Before</p><ul><li><p>TODO: Parent</p><ul><li><p>DONE: Child</p><ul><li><p>Nested detail</p></li></ul></li><li><p>TODO: Child</p></li></ul></li><li><p>CLOSED: Other parent</p></li></ul><p>After</p>");
    cursorIn(editor, "DONE: Child");
    const original = editor.getJSON();
    const tr = sortSelectedLines(editor.state, "sort_bullet_method", [
      { id: "todo", prefix: "TODO", description: "First" },
      { id: "done", prefix: "DONE", description: "Second" },
      { id: "none", prefix: null, description: "Last" },
    ]);
    expect(tr).not.toBeNull();
    editor.view.dispatch(tr!);
    const outer = editor.state.doc.child(1);
    expect(outer.child(0).firstChild!.textContent).toBe("TODO: Parent");
    expect(outer.child(1).textContent).toBe("CLOSED: Other parent");
    const nested = outer.child(0).child(1);
    expect(nested.child(0).textContent).toBe("TODO: Child");
    expect(nested.child(1).textContent).toBe("DONE: ChildNested detail");
    expect(editor.state.selection.$from.parent.textContent).toBe("DONE: Child");
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(["TODO: Parent", "TODO: Deep"])("sorts ancestors and all descendant lists from %s, retaining the cursor and undo", target => {
    const editor = setup("<p>Before</p><ul><li><p>TODO: Parent</p><ul><li><p>TODO: Child</p><ul><li><p>TODO: Deep</p></li><li><p>DONE: Deep</p></li></ul></li><li><p>DONE: Child</p></li></ul></li><li><p>DONE: Parent</p><ul><li><p>TODO: Sibling</p></li><li><p>CLOSED: Sibling</p></li></ul></li></ul><p>After</p><ul><li>TODO: Separate</li><li>DONE: Separate</li></ul>");
    const position = cursorIn(editor, target);
    const original = editor.getJSON();
    const separate = editor.state.doc.child(3);
    sort(editor, "sort_bullet_method");
    const list = editor.state.doc.child(1);
    expect(list.child(0).firstChild!.textContent).toBe("DONE: Parent");
    expect(list.child(0).child(1).firstChild!.textContent).toBe("CLOSED: Sibling");
    const children = list.child(1).child(1);
    expect(children.child(0).textContent).toBe("DONE: Child");
    expect(children.child(1).child(1).firstChild!.textContent).toBe("DONE: Deep");
    expect(editor.state.doc.child(3).eq(separate)).toBe(true);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe(target);
    expect(editor.state.selection.$from.parentOffset).toBe(3);
    expect(sortSelectedLines(editor.state, "sort_bullet_method")).toBeNull();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection.from).toBe(position);
  });

  it("leaves ordinary text, single-item lists, and alphabetical sorts alone without a selection", () => {
    for (const content of ["<p>TODO: Start</p><p>DONE: Finished</p>", "<ul><li><p>TODO: Start</p></li></ul>"]) {
      const editor = setup(content);
      cursorIn(editor, "TODO: Start");
      expect(sortSelectedLines(editor.state, "sort_bullet_method")).toBeNull();
    }
    const editor = setup("<ul><li><p>z</p></li><li><p>a</p></li></ul>");
    cursorIn(editor, "z", 0);
    expect(sortSelectedLines(editor.state, "sort_az")).toBeNull();
  });
});

describe("Sort Lines", () => {
  it.each(["paragraphs", "bullets", "soft breaks", "code"])("keeps all sorted %s highlighted with full or partial edge selections", shape => {
    const lines = ["IN PROGRESS: Work", "DONE: Sent", "TODO: Review the long proposal with everyone"];
    const content = shape === "bullets" ? `<ul>${lines.map(line => `<li><p>${line}</p></li>`).join("")}</ul>`
      : shape === "soft breaks" ? `<p>${lines.join("<br>")}</p>`
      : shape === "code" ? `<pre><code>${lines.join("\n")}</code></pre>`
      : lines.map(line => `<p>${line}</p>`).join("");
    for (const partial of [false, true]) {
      const editor = setup(content);
      let start = -1, end = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText) { if (start < 0) start = pos; end = pos + node.nodeSize; }
      });
      editor.commands.setTextSelection({ from: start, to: end - (partial ? lines[2].length - 4 : 0) });
      sort(editor, "sort_bullet_method");
      const selected: string[] = [];
      editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node, pos) => {
        if (node.isText) {
          expect(pos).toBeGreaterThanOrEqual(editor.state.selection.from);
          expect(pos + node.nodeSize).toBeLessThanOrEqual(editor.state.selection.to);
          selected.push(node.text!);
        }
      });
      expect(selected.join("\n")).toBe([lines[1], lines[2], lines[0]].join("\n"));
    }
  });
  it.each([false, true])("keeps every sorted line selected when edge lines are only partly selected (reverse: %s)", reverse => {
    const editor = setup("<p>Before</p><p>IN PROGRESS: Working on the proposal</p><p>DONE: Sent</p><p>TODO: Review</p><p>After</p>");
    const positions: Record<string, number> = {};
    editor.state.doc.descendants((node, pos) => { if (node.isText) positions[node.text!] = pos; });
    const start = positions["IN PROGRESS: Working on the proposal"];
    const end = positions["TODO: Review"] + 4;
    editor.commands.setTextSelection(reverse ? { from: end, to: start } : { from: start, to: end });
    sort(editor, "sort_bullet_method");
    expect(texts(editor)).toEqual(["Before", "DONE: Sent", "TODO: Review", "IN PROGRESS: Working on the proposal", "After"]);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to, "\n")).toBe("DONE: Sent\nTODO: Review\nIN PROGRESS: Working on the proposal");
    expect(editor.state.selection.anchor > editor.state.selection.head).toBe(reverse);
  });
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


describe("Bullet Method", () => {
  it("recognizes the menu command and stably sorts statuses, preserving content and undo", () => {
    expect(isSortCommand("sort_bullet_method")).toBe(true);
    const editor = setup("<ul><li>General notes</li><li>TODO: zebra</li><li>IN PROGRESS: working</li><li><strong>done:</strong> shipped</li><li>CLOSED: delegated</li><li>TODO: alpha</li><li>We are DONE: with this</li><li>DONE without a colon</li></ul>");
    const before = editor.state.doc;
    sort(editor, "sort_bullet_method");
    expect(editor.state.doc.firstChild!.content.content.map((item) => item.textContent)).toEqual([
      "CLOSED: delegated", "done: shipped", "TODO: zebra", "TODO: alpha", "IN PROGRESS: working",
      "General notes", "We are DONE: with this", "DONE without a colon",
    ]);
    expect(editor.getHTML()).toContain("<strong>done:</strong>");
    expect(sortSelectedLines(editor.state, "sort_bullet_method")).toBeNull();
    editor.commands.undo();
    expect(editor.state.doc.eq(before)).toBe(true);
  });
  it("moves nested notes and continuation paragraphs intact with their parent", () => {
    const editor = setup("<ul><li><p>TODO: parent</p><p>DONE: explanation</p><ul><li>TODO: child</li><li>CLOSED: child</li></ul></li><li><p>CLOSED: other</p></li></ul>");
    const parent = editor.state.doc.firstChild!.firstChild!;
    sort(editor, "sort_bullet_method");
    const moved = editor.state.doc.firstChild!.lastChild!;
    expect(moved.child(0).eq(parent.child(0))).toBe(true);
    expect(moved.child(1).eq(parent.child(1))).toBe(true);
    expect(moved.child(2).content.content.map(item => item.textContent)).toEqual(["CLOSED: child", "TODO: child"]);
    expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe("CLOSED: other");
  });
  it("sorts only the selected nested items", () => {
    const editor = setup("<ul><li><p>TODO: parent</p><ul><li>TODO: child</li><li>CLOSED: child</li></ul></li><li>CLOSED: other</li></ul>");
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text!.endsWith(": child")) positions.push(pos);
    });
    editor.commands.setTextSelection({ from: positions[0], to: positions[1] + "CLOSED: child".length });
    sort(editor, "sort_bullet_method");
    const list = editor.state.doc.firstChild!;
    expect(list.firstChild!.firstChild!.textContent).toBe("TODO: parent");
    expect(list.firstChild!.lastChild!.firstChild!.textContent).toBe("CLOSED: child");
    expect(list.lastChild!.textContent).toBe("CLOSED: other");
  });
  it("keeps date headings fixed and sorts groups separately", () => {
    const editor = setup("<h2>September 25</h2><p>TODO: today</p><p>DONE: today</p><h2>September 24</h2><p>TODO: yesterday</p><p>CLOSED: yesterday</p>");
    sort(editor, "sort_bullet_method");
    expect(texts(editor)).toEqual(["September 25", "DONE: today", "TODO: today", "September 24", "CLOSED: yesterday", "TODO: yesterday"]);
  });
  it("sorts soft lines with formatting and requires a selection", () => {
    const editor = setup("<p>Notes<br>TODO: work<br><strong>CLOSED: handed off</strong></p>");
    sort(editor, "sort_bullet_method");
    expect(editor.getHTML()).toBe("<p><strong>CLOSED: handed off</strong><br>TODO: work<br>Notes</p>");
    editor.commands.setTextSelection(1);
    expect(sortSelectedLines(editor.state, "sort_bullet_method")).toBeNull();
  });
});


it("sorts by saved custom order with unknown statuses in the movable No status group", () => {
  const editor = setup("<ul><li>TODO: next</li><li>WAITING: review</li><li>CLOSED: old prefix</li><li>General notes</li><li>waiting: another</li></ul>");
  const statuses = [defaultBulletMethodStatuses[4], { id: "waiting", prefix: "WAITING", description: "" }, defaultBulletMethodStatuses[2]];
  const transaction = sortSelectedLines(editor.state, "sort_bullet_method", statuses);
  expect(transaction).not.toBeNull();
  editor.view.dispatch(transaction!);
  expect(editor.state.doc.firstChild!.content.content.map(node => node.textContent)).toEqual([
    "CLOSED: old prefix", "General notes", "WAITING: review", "waiting: another", "TODO: next",
  ]);
});
