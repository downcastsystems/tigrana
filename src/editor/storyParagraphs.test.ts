// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { StoryParagraphs, handleStoryParagraphKey, setParagraphIndent } from "./storyParagraphs";
import type { WritingStyle } from "../lib/writingStyle";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string, style: WritingStyle = "story") {
  const editor: Editor = new Editor({ extensions: [StarterKit, StoryParagraphs], content,
    editorProps: { handleDOMEvents: { keydown: (_view, event) => handleStoryParagraphKey(editor, event, style) } },
  });
  editors.push(editor);
  return editor;
}
function key(editor: Editor, value: string, shiftKey = false) {
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));
}

describe("Story paragraph editing", () => {
  it.each(["indent", "none"])("Enter resets a %s exception, even in the middle of a paragraph", indent => {
    const editor = create(`<p data-story-indent="${indent}">Opening words</p>`);
    editor.commands.setTextSelection(8);
    key(editor, "Enter");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).attrs.storyIndent).toBe(indent);
    expect(editor.state.doc.child(1).attrs.storyIndent).toBeNull();
    expect(editor.state.doc.textContent).toBe("Opening words");
    editor.commands.undo();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.attrs.storyIndent).toBe(indent);
  });

  it("Enter after the opening paragraph creates an automatic successor", () => {
    const editor = create("<p>Opening</p>");
    editor.commands.setTextSelection(8);
    key(editor, "Enter");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).attrs.storyIndent).toBeNull();
  });

  it("Backspace removes the visual indent, then joins on the next press", () => {
    const editor = create("<p>Opening</p><p>Next</p>");
    editor.commands.setTextSelection(10);
    key(editor, "Backspace");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).attrs.storyIndent).toBe("none");
    key(editor, "Backspace");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("OpeningNext");
  });

  it.each([false, true])("leaves Tab to the shared indentation handler, shift: %s", shiftKey => {
    const editor = create("<p>Opening</p>");
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
    expect(handleStoryParagraphKey(editor, event, "story")).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.state.doc.firstChild?.attrs.storyIndent).toBeNull();
  });

  it("Shift+Enter stays inside the paragraph", () => {
    const editor = create('<p data-story-indent="indent">Opening</p>');
    editor.commands.setTextSelection(4);
    key(editor, "Enter", true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.attrs.storyIndent).toBe("indent");
    expect(editor.getHTML()).toContain("<br>");
  });

  it("does not apply paragraph overrides to lists, quotes, or headings", () => {
    for (const html of ["<ul><li><p>Item</p></li></ul>", "<blockquote><p>Quote</p></blockquote>", "<h2>Heading</h2>"]) {
      const editor = create(html);
      expect(setParagraphIndent(editor, "indent")).toBe(false);
      expect(handleStoryParagraphKey(editor, new KeyboardEvent("keydown", { key: "Tab" }), "story")).toBe(false);
    }
  });

  it("does not remove an automatic opening indent after a structural break", () => {
    const editor = create("<h2>Chapter</h2><p>Opening</p><hr><p>Scene</p>");
    editor.commands.setTextSelection(10);
    expect(handleStoryParagraphKey(editor, new KeyboardEvent("keydown", { key: "Backspace" }), "story")).toBe(false);
    editor.commands.setTextSelection(20);
    expect(handleStoryParagraphKey(editor, new KeyboardEvent("keydown", { key: "Backspace" }), "story")).toBe(false);
  });

  it("Notes Backspace and read-only Story editing keep their existing behavior", () => {
    const editor = create("<p>Opening</p><p>Next</p>", "notes");
    editor.commands.setTextSelection(10);
    key(editor, "Backspace");
    expect(editor.state.doc.childCount).toBe(1);
    editor.setEditable(false);
    expect(setParagraphIndent(editor, "indent")).toBe(false);
    expect(handleStoryParagraphKey(editor, new KeyboardEvent("keydown", { key: "Tab" }), "story")).toBe(false);
  });
});
