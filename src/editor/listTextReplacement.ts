import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** WebKit can include the preceding bullet boundary in a selection of a line's first word. */
export function handleListTextReplacement(view: EditorView, event: InputEvent) {
  if (!event.cancelable || event.isComposing || view.composing
    || (event.inputType !== "insertText" && event.inputType !== "insertReplacementText")
    || !event.data) return false;

  if (!normalizeListPrefixSelection(view)) return false;
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(event.data).scrollIntoView());
  return true;
}

export function prepareListTextReplacement(view: EditorView, event: KeyboardEvent) {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.isComposing && !view.composing) normalizeListPrefixSelection(view);
  return false;
}

function normalizeListPrefixSelection(view: EditorView) {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  const { $from, $to } = selection;
  // Only trim a boundary between adjacent sibling items. Any selected text in
  // the preceding item, or a range across multiple items, is intentional.
  if ($from.depth < 3 || $to.depth !== $from.depth
    || $from.parent.type.name !== "paragraph" || $to.parent.type.name !== "paragraph"
    || $from.parentOffset !== $from.parent.content.size || $to.parentOffset === 0
    || $from.node(-1).type.name !== "listItem" || $to.node(-1).type.name !== "listItem"
    || $from.node(-2) !== $to.node(-2)
    || $from.index(-2) + 1 !== $to.index(-2)
    || $from.index(-1) !== $from.node(-1).childCount - 1 || $to.index(-1) !== 0) return false;

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $to.start(), selection.to)));
  return true;
}
