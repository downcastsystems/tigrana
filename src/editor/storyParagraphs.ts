import { Extension, type Editor } from "@tiptap/core";
import type { ParagraphIndent, WritingStyle } from "../lib/writingStyle";

export const StoryParagraphs = Extension.create({
  name: "storyParagraphs",
  addGlobalAttributes() {
    return [{
      types: ["paragraph"],
      attributes: {
        storyIndent: {
          default: null,
          keepOnSplit: false,
          parseHTML: element => {
            const value = element.getAttribute("data-story-indent");
            return value === "indent" || value === "none" ? value : null;
          },
          renderHTML: attributes => attributes.storyIndent === "indent" || attributes.storyIndent === "none"
            ? { "data-story-indent": attributes.storyIndent } : {},
        },
      },
    }];
  },
});

export function setParagraphIndent(editor: Editor, value: ParagraphIndent | null): boolean {
  const { $from, $to } = editor.state.selection;
  if (!editor.isEditable || $from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== "paragraph") return false;
  return editor.chain().focus().updateAttributes("paragraph", { storyIndent: value }).run();
}

export function handleStoryParagraphKey(editor: Editor, event: KeyboardEvent, style: WritingStyle): boolean {
  if (!editor.isEditable || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
  const { $from, $to, empty } = editor.state.selection;
  if ($from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== "paragraph") return false;
  const indent = $from.parent.attrs.storyIndent;
  if (event.key === "Enter" && !event.shiftKey && (style === "story" || indent)) {
    // Even when splitting in the middle, the new paragraph returns to Automatic.
    const handled = editor.chain().splitBlock().updateAttributes("paragraph", { storyIndent: null }).run();
    if (handled) event.preventDefault();
    return handled;
  }
  if (style !== "story" || !empty || $from.parentOffset !== 0) return false;
  if (event.key !== "Backspace" || event.shiftKey) return false;
  const previous = $from.index(0) > 0 ? $from.node(0).child($from.index(0) - 1) : null;
  const indented = indent === "indent" || (indent !== "none" && previous?.type.name === "paragraph");
  if (!indented) return false;
  event.preventDefault();
  return setParagraphIndent(editor, "none");
}
