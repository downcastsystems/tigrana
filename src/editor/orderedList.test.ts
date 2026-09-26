// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { OrderedListWithGutter } from "./orderedList";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string) {
  const editor = new Editor({ extensions: [StarterKit.configure({ orderedList: false }), OrderedListWithGutter], content });
  editors.push(editor);
  return editor;
}
function widths(editor: Editor) {
  return Array.from(editor.view.dom.querySelectorAll("ol"), list => list.style.getPropertyValue("--ordered-list-marker-width"));
}

describe("Numbered list gutter", () => {
  it.each(["2147483647", "2147483648", "999999999999999999999999999999"])("handles typed marker %s without integer wrapping", number => {
    const editor = create(`<p>${number}.</p>`);
    editor.commands.setTextSelection(number.length + 2);
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", handler => handler(editor.view, from, to, " ", () => editor.state.tr.insertText(" ", from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(" ", from, to));
    if (number === "2147483647") {
      expect(editor.state.doc.firstChild?.type.name).toBe("orderedList");
      expect(editor.view.dom.querySelector("ol")?.start).toBe(2147483647);
    } else {
      expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
      expect(editor.state.doc.textContent).toBe(`${number}. `);
    }
  });

  it("pastes oversized numbered lines as literal text", () => {
    const editor = create("<p></p>");
    const text = "2147483648. First\n2147483649. Second";
    const event = new Event("paste") as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? text : "" } });
    editor.view.pasteText(text, event);
    expect(editor.view.dom.querySelector("ol")).toBeNull();
    expect(editor.state.doc.textContent).toContain("2147483648. First");
    expect(editor.state.doc.textContent).toContain("2147483649. Second");
  });

  it("sizes each list independently, including nested lists and large starting numbers", () => {
    const editor = create('<ol start="999"><li><p>A</p><ol start="123456"><li><p>Nested</p></li></ol></li><li><p>B</p></li></ol><ol><li><p>C</p></li></ol>');
    expect(widths(editor)).toEqual(["4ch", "6ch", "1ch"]);
    expect(editor.getHTML()).not.toContain("--ordered-list-marker-width");
  });

  it("grows on a digit boundary and shrinks again on undo without replacing the list", () => {
    const editor = create('<ol start="999"><li><p>A</p></li></ol>');
    const list = editor.view.dom.querySelector("ol");
    editor.commands.setTextSelection(4);
    expect(editor.commands.splitListItem("listItem")).toBe(true);
    expect(widths(editor)).toEqual(["4ch"]);
    expect(editor.view.dom.querySelector("ol")).toBe(list);
    editor.commands.undo();
    expect(widths(editor)).toEqual(["3ch"]);
  });

  it("updates the gutter and native counter when the start number changes", () => {
    const editor = create('<ol><li><p>A</p></li></ol>');
    editor.commands.setTextSelection(3);
    editor.commands.updateAttributes("orderedList", { start: 12345 });
    expect(widths(editor)).toEqual(["5ch"]);
    expect(editor.view.dom.querySelector("ol")?.start).toBe(12345);
  });
});
