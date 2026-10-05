import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export function handleEditorTitleArrow(view: EditorView, event: KeyboardEvent, focusTitle?: () => void) {
  if (!focusTitle || !view.editable || view.composing || event.isComposing
    || event.key !== "ArrowUp" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  // Only the first textblock can lead into the title, including one nested
  // inside a list, quote, or table. Earlier blocks retain normal navigation.
  for (let depth = 0; depth < $from.depth; depth++) {
    if ($from.index(depth) !== 0) return false;
  }
  // Use browser layout so wrapped lines and code-block newlines stay local.
  if (!view.endOfTextblock("up")) return false;
  event.preventDefault();
  focusTitle();
  return true;
}
