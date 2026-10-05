// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEditorTitleArrow } from "./editorTitleNavigation";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function setup(content = "<p>First line</p><p>Second line</p>") {
  const editor = new Editor({ extensions: [StarterKit], content });
  editors.push(editor);
  const boundary = vi.spyOn(editor.view, "endOfTextblock").mockReturnValue(true);
  const title = document.createElement("textarea");
  document.body.append(title);
  const focusTitle = vi.fn(() => title.focus());
  return { editor, boundary, title, focusTitle };
}
function up(options: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true, ...options });
}

describe("Up Arrow into the note title", () => {
  it.each(["<p>First line</p>", "<p></p>", "<h1>Heading</h1>", "<ul><li><p>Item</p></li></ul>", "<blockquote><p>Quote</p></blockquote>"])("focuses the title from the first line of %s", content => {
    const { editor, title, focusTitle } = setup(content);
    const event = up();
    expect(handleEditorTitleArrow(editor.view, event, focusTitle)).toBe(true);
    expect(document.activeElement).toBe(title);
    expect(event.defaultPrevented).toBe(true);
    title.remove();
  });

  it("keeps wrapped lines and later blocks in the body", () => {
    const { editor, boundary, title, focusTitle } = setup();
    editor.commands.setTextSelection(6);
    boundary.mockReturnValue(false);
    expect(handleEditorTitleArrow(editor.view, up(), focusTitle)).toBe(false);
    boundary.mockReturnValue(true);
    editor.commands.setTextSelection(13);
    expect(handleEditorTitleArrow(editor.view, up(), focusTitle)).toBe(false);
    expect(focusTitle).not.toHaveBeenCalled();
    title.remove();
  });

  it("preserves selections, modifiers, composition, and read-only behavior", () => {
    const { editor, title, focusTitle } = setup();
    for (const options of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { key: "ArrowDown" }]) {
      expect(handleEditorTitleArrow(editor.view, up(options), focusTitle)).toBe(false);
    }
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(handleEditorTitleArrow(editor.view, up(), focusTitle)).toBe(false);
    editor.commands.setTextSelection(1);
    editor.setEditable(false);
    expect(handleEditorTitleArrow(editor.view, up(), focusTitle)).toBe(false);
    expect(focusTitle).not.toHaveBeenCalled();
    title.remove();
  });
});
