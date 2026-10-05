import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";

import { EM_SPACE } from "./textExtensions";

function listItemAt(position: ResolvedPos) {
  for (let depth = position.depth; depth > 0; depth--) {
    const name = position.node(depth).type.name;
    if (name === "listItem" || name === "taskItem") return { name, depth };
  }
  return null;
}

export function handleEditorTabKeyDown(editor: Editor, event: KeyboardEvent) {
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (editor.isActive("table")) {
    event.preventDefault();
    if (event.shiftKey) {
      editor.commands.goToPreviousCell();
      return true;
    }
    if (editor.commands.goToNextCell()) return true;
    if (editor.can().addRowAfter()) {
      editor.chain().addRowAfter().goToNextCell().run();
    }
    return true;
  }

  const selection = editor.state.selection;
  let { $from, $to } = selection;
  if (!selection.empty) {
    // A drag beginning before a bullet's text can resolve to its parent's
    // closing paragraph or to the child list boundary. Neither selects any
    // parent text, so advance to the first selected textblock.
    if (!$from.parent.isTextblock || $from.parentOffset === $from.parent.content.size) {
      const next = TextSelection.findFrom(editor.state.doc.resolve($from.pos + 1), 1, true);
      if (next && next.from <= $to.pos) $from = next.$from;
    }
    if ($to.parent.isTextblock && $to.parentOffset === 0) {
      const previous = TextSelection.findFrom(editor.state.doc.resolve($to.before()), -1, true);
      if (previous && previous.from >= $from.pos) $to = previous.$from;
    }
  }
  const fromItem = listItemAt($from);
  const toItem = listItemAt($to);
  // isActive requires every part of the selection to be inside list items.
  // Endpoint ancestors also recognize selections touching list boundaries.
  const item = fromItem ?? toItem;
  if (item) {
    event.preventDefault();
    if (!fromItem) return true;
    const itemType = editor.schema.nodes[item.name];
    const range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild?.type === itemType);
    // ProseMirror may widen a mixed-depth selection to an ancestor list.
    // Never indent an unselected parent to accommodate that wider range.
    if (!range || range.depth !== fromItem.depth - 1) return true;
    const chain = editor.chain();
    if ($from.pos !== selection.from || $to.pos !== selection.to) {
      chain.setTextSelection(selection.anchor <= selection.head
        ? { from: $from.pos, to: $to.pos }
        : { from: $to.pos, to: $from.pos });
    }
    if (event.shiftKey) chain.liftListItem(item.name).run();
    else chain.sinkListItem(item.name).run();
    return true;
  }

  event.preventDefault();
  if (editor.isActive("codeBlock")) {
    if (!event.shiftKey) editor.commands.insertContent("  ");
    return true;
  }

  if (event.shiftKey) {
    removeTextblockIndent(editor);
  } else {
    insertTextblockIndent(editor);
  }
  return true;
}

function insertTextblockIndent(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return;
  view.dispatch(state.tr.insertText(EM_SPACE, $from.start()).scrollIntoView());
}

function removeTextblockIndent(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return;
  const start = $from.start();
  if (state.doc.textBetween(start, start + 1) !== EM_SPACE) return;
  view.dispatch(state.tr.delete(start, start + 1).scrollIntoView());
}

