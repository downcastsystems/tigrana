import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import type { Step } from "@tiptap/pm/transform";

type ShortcutUndo = {
  id: object;
  steps: readonly Step[];
  selection: SelectionBookmark;
  inputFrom: number;
  inputTo: number;
  inputText: string;
  storedMarks: readonly Mark[] | null;
};
const textShortcutUndoKey = new PluginKey<ShortcutUndo | null>("textShortcutUndo");

function inverseSteps(tr: Transaction, first = 0) {
  return tr.steps.slice(first).map((step, index) => step.invert(tr.docs[first + index])).reverse();
}

export function prepareTextShortcutUndo(state: EditorState, inputText: string) {
  const first = state.tr.steps.length;
  const original = {
    selection: state.selection.getBookmark(), inputFrom: state.selection.from,
    inputTo: state.selection.to, storedMarks: state.storedMarks, inputText,
  };
  return (tr: Transaction) => {
    if (tr.steps.length === first) return;
    closeHistory(tr).setMeta(textShortcutUndoKey, { ...original, id: {}, steps: inverseSteps(tr, first) } satisfies ShortcutUndo);
  };
}

export function createTextShortcutUndoPlugin(settingsKey: PluginKey) {
  return new Plugin<ShortcutUndo | null>({
    key: textShortcutUndoKey,
    state: {
      init: () => null,
      apply(tr, previous, state) {
        const undo = tr.getMeta(textShortcutUndoKey) as ShortcutUndo | null | undefined;
        if (undo !== undefined) return undo;
        // Settings are reapplied on note switches/reloads, including cached notes.
        if (tr.getMeta(settingsKey) !== undefined) return null;
        const origin = tr.getMeta("appendedTransaction") as Transaction | undefined;
        if (previous && origin?.getMeta(textShortcutUndoKey)?.id === previous.id) {
          // Include automatic trailing paragraphs and other normalization from
          // the same expansion, without retaining or serializing a whole note.
          return { ...previous, steps: [...inverseSteps(tr), ...previous.steps] };
        }
        if (tr.docChanged || (tr.selectionSet && !tr.selection.eq(state.selection))) return null;
        return previous;
      },
    },
  });
}

export function undoTextShortcut(editor: Editor) {
  if (!editor.isEditable || editor.view.composing) return false;
  const undo = textShortcutUndoKey.getState(editor.state);
  if (!undo) return false;
  const tr = closeHistory(editor.state.tr);
  for (const step of undo.steps) tr.step(step);
  if (undo.inputText) {
    const marks = undo.storedMarks ?? tr.doc.resolve(undo.inputFrom).marks();
    tr.replaceWith(undo.inputFrom, undo.inputTo, editor.schema.text(undo.inputText, marks));
    tr.setSelection(TextSelection.create(tr.doc, undo.inputFrom + undo.inputText.length));
  } else tr.setSelection(undo.selection.resolve(tr.doc));
  tr.setStoredMarks(undo.storedMarks).setMeta(textShortcutUndoKey, null).scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

export function handleTextShortcutBackspace(editor: Editor, event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== "Backspace" || event.isComposing
    || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
  if (!undoTextShortcut(editor)) return false;
  event.preventDefault();
  return true;
}
