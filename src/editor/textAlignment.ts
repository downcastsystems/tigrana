import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { readTextAlignment, type TextAlignment } from "../lib/textAlignment";

export function canAlignText(editor: Editor) {
  const { selection } = editor.state;
  if (!editor.isEditable || selection instanceof NodeSelection) return false;
  let supported = true;
  let found = false;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (!node.isTextblock) return;
    found = true;
    if (parent?.type.name !== "doc" || !["paragraph", "heading"].includes(node.type.name)) supported = false;
  });
  return supported && found;
}

export function setTextAlignment(editor: Editor, alignment: TextAlignment) {
  if (!canAlignText(editor)) return false;
  return editor.chain().focus().command(({ tr }) => {
    tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: alignment === "left" ? null : alignment });
      }
    });
    return true;
  }).run();
}

export const TextAlignmentExtension = Extension.create({
  name: "textAlignment",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: {
      textAlign: {
        default: null,
        parseHTML: element => readTextAlignment(element.getAttribute("style"))
          ?? readTextAlignment(element.parentElement?.closest("div[style]")?.getAttribute("style") ?? null),
        renderHTML: attributes => attributes.textAlign === "center" || attributes.textAlign === "right"
          ? { style: `text-align: ${attributes.textAlign}` } : {},
      },
    } }];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => setTextAlignment(this.editor, "left"),
      "Mod-Shift-e": () => setTextAlignment(this.editor, "center"),
      "Mod-Shift-r": () => setTextAlignment(this.editor, "right"),
    };
  },
});
