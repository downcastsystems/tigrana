import type { EditorState } from "@tiptap/pm/state";
import { listFoldingKey } from "./listFolding";

/** A fully selected folded row represents its entire item, including hidden children. */
export function getFoldedListClipboardRange(state: EditorState) {
  const { selection, doc } = state;
  const folds = listFoldingKey.getState(state);
  if (selection.empty || !folds?.enabled || !folds.collapsedCount) return null;
  let { from, to } = selection;
  let includesFold = false;
  for (const decoration of folds.decorations.find(from, to, spec => spec.collapsed === true)) {
    const paragraph = doc.nodeAt(decoration.from)?.firstChild;
    if (!paragraph || selection.from > decoration.from + 2 || selection.to < decoration.from + paragraph.nodeSize) continue;
    from = Math.min(from, decoration.from);
    to = Math.max(to, decoration.to);
    includesFold = true;
  }
  return includesFold ? { from, to } : null;
}

export function getFoldedListCutDeleteRange(state: EditorState) {
  const range = getFoldedListClipboardRange(state);
  if (!range) return null;
  const $from = state.doc.resolve(range.from), $to = state.doc.resolve(range.to);
  // Remove an entirely selected container too, avoiding an empty leftover bullet.
  if ($from.sameParent($to) && ["bulletList", "orderedList", "taskList"].includes($from.parent.type.name)
    && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size) {
    return { from: $from.before(), to: $to.after() };
  }
  return range;
}
