// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableRow } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { TableWithControls, TigranaTableCell, TigranaTableHeader } = await import("./tableControls");

let editor: Editor;
afterEach(() => editor?.destroy());

function setup() {
  editor = new Editor({
    extensions: [StarterKit, TableWithControls.configure({ resizable: false, allowTableNodeSelection: true }), TableRow, TigranaTableCell, TigranaTableHeader],
    content: '<p>Above</p><table><tr><td><p>First</p></td><td><p>Second</p></td></tr><tr><td><p>Third</p></td><td><p>Fourth</p></td></tr></table><p></p>',
  });
  const paragraphs: number[] = [];
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") paragraphs.push(pos + 1);
    if (node.type.name === "tableCell") cells.push(pos);
  });
  return { paragraphs, cells };
}

function select(anchor: number, head: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
}

describe("table range selection normalization", () => {
  it.each([false, true])("preserves the anchor while dragging from below through cells (reverse: %s)", reverse => {
    const { paragraphs } = setup();
    const below = paragraphs.at(-1)!;
    for (const cell of paragraphs.slice(1, -1).reverse()) {
      const anchor = reverse ? below : cell;
      const head = reverse ? cell : below;
      select(anchor, head);
      expect(editor.state.selection.toJSON()).toEqual({ type: "text", anchor, head });
    }
    select(reverse ? below : paragraphs[0], reverse ? paragraphs[0] : below);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "|")).toBe("Above|First|Second|Third|Fourth|");
  });

  it.each([false, true])("preserves ranges from above into a cell boundary (reverse: %s)", reverse => {
    const { paragraphs } = setup();
    const above = paragraphs[0];
    const cell = paragraphs[2];
    const anchor = reverse ? cell : above;
    const head = reverse ? above : cell;
    select(anchor, head);
    expect(editor.state.selection.toJSON()).toEqual({ type: "text", anchor, head });
  });

  it("still normalizes a text range between different cells", () => {
    const { paragraphs } = setup();
    select(paragraphs[1], paragraphs[2]);
    expect(editor.state.selection.from).toBe(paragraphs[1]);
    expect(editor.state.selection.to).toBe(paragraphs[1] + "First".length);
  });

  it("preserves rectangular cell selections", () => {
    const { cells } = setup();
    const selection = CellSelection.create(editor.state.doc, cells[0], cells.at(-1)!);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect(editor.state.selection.toJSON()).toEqual(selection.toJSON());
  });
});
