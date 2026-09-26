// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { handleListTextReplacement, prepareListTextReplacement } from "./listTextReplacement";

function fixture() {
  const editor = new Editor({
    extensions: [StarterKit],
    content: "<ul><li><p>Previous</p></li><li><p>IN PROGRESS: remaining text</p></li><li><p>Next</p></li></ul>",
    editorProps: { handleDOMEvents: { beforeinput: handleListTextReplacement, keydown: prepareListTextReplacement } },
  });
  const positions: Record<string, number> = {};
  editor.state.doc.descendants((node, pos) => { if (node.isText) positions[node.text!] = pos; });
  return { editor, previousEnd: positions.Previous + 8, start: positions["IN PROGRESS: remaining text"] };
}
function input(editor: Editor, inputType = "insertText", isComposing = false) {
  const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data: "DONE", isComposing });
  editor.view.dom.dispatchEvent(event);
  return event;
}

describe("typing over a list prefix", () => {
  it.each([false, true])("keeps the bullet when the native selection includes only the preceding boundary (backward=%s)", (backward) => {
    const { editor, previousEnd, start } = fixture();
    try {
      editor.commands.setTextSelection(backward ? { from: start + 11, to: previousEnd } : { from: previousEnd, to: start + 11 });
      expect(input(editor).defaultPrevented).toBe(true);
      expect(editor.getHTML()).toContain("<li><p>Previous</p></li><li><p>DONE: remaining text</p></li><li><p>Next</p></li>");
      expect(editor.state.selection.from).toBe(start + 4);
      editor.commands.undo();
      expect(editor.getHTML()).toContain("<li><p>IN PROGRESS: remaining text</p></li>");
    } finally { editor.destroy(); }
  });

  it("repairs the selection before WebKit's keypress replacement path", () => {
    const { editor, previousEnd, start } = fixture();
    try {
      editor.commands.setTextSelection({ from: previousEnd, to: start + 11 });
      const event = new KeyboardEvent("keydown", { key: "D", bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.state.selection.from).toBe(start);
      expect(editor.state.selection.to).toBe(start + 11);
      editor.view.dispatch(editor.state.tr.insertText("DONE"));
      expect(editor.getHTML()).toContain("<li><p>Previous</p></li><li><p>DONE: remaining text</p></li>");
    } finally { editor.destroy(); }
  });

  it.each(["Backspace", "Enter", "ArrowLeft", "Escape"])("does not normalize selection for %s", (key) => {
    const { editor, previousEnd, start } = fixture();
    try {
      editor.commands.setTextSelection({ from: previousEnd, to: start + 11 });
      prepareListTextReplacement(editor.view, new KeyboardEvent("keydown", { key }));
      expect(editor.state.selection.from).toBe(previousEnd);
    } finally { editor.destroy(); }
  });

  it.each(["previous text", "normal word", "caret", "delete", "composition"])("leaves %s editing to the normal editor behavior", (scenario) => {
    const { editor, previousEnd, start } = fixture();
    try {
      const from = scenario === "previous text" ? previousEnd - 3 : scenario === "normal word" || scenario === "caret" ? start : previousEnd;
      editor.commands.setTextSelection({ from, to: scenario === "caret" ? from : start + 11 });
      const before = editor.state;
      expect(input(editor, scenario === "delete" ? "deleteContentBackward" : "insertText", scenario === "composition").defaultPrevented).toBe(false);
      expect(editor.state).toBe(before);
    } finally { editor.destroy(); }
  });
});
