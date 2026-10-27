import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { calculateExpression, calculationMaxLength } from "../lib/automaticCalculation";
import { prepareTextShortcutUndo } from "./textShortcutUndo";

export const AutomaticCalculation = Extension.create({
  name: "automaticCalculation",
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      handleTextInput: (view, from, to, text) => {
        // Ordinary typing does no extraction, parsing, or document traversal.
        if (text !== "=" || from !== to || !this.editor.isEditable || view.composing) return false;
        const { state } = view;
        const { $from, empty } = state.selection;
        if (!empty || from !== $from.pos || $from.parent.type.spec.code
          || (state.storedMarks ?? $from.marks()).some(mark => mark.type.spec.code || mark.type.name === "link")) return false;
        const offset = $from.parentOffset;
        // Calculate at the end of a textblock or hard-break line only.
        if (offset !== $from.parent.content.size && $from.nodeAfter?.type.name !== "hardBreak") return false;
        const start = Math.max(0, offset - calculationMaxLength - 1);
        const before = $from.parent.textBetween(start, offset, "\n", node => node.type.name === "hardBreak" ? "\n" : "\ufffc");
        const lineStart = before.lastIndexOf("\n") + 1;
        if (start > 0 && lineStart === 0) return false;
        const line = before.slice(lineStart);
        let protectedText = false;
        $from.parent.nodesBetween(offset - line.length, offset, node => {
          if (node.marks.some(mark => mark.type.spec.code || mark.type.name === "link")) protectedText = true;
        });
        if (protectedText) return false;
        const result = calculateExpression(line);
        if (result === null) return false;
        // Share the shortcut undo service: immediate Backspace restores the
        // literal typed '=' and preserves the expression, marks, and selection.
        const rememberUndo = prepareTextShortcutUndo(state, text);
        const tr = state.tr.insertText(`= ${result}`, from, to);
        rememberUndo(tr);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    } })];
  },
});
