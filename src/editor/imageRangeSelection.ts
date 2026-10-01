import { NodeSelection, Plugin, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

function imageRangeDecorations({ doc, selection }: EditorState) {
  if (selection.empty || selection instanceof NodeSelection) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const { $from, $to } of selection.ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === "image" && pos >= $from.pos && pos + node.nodeSize <= $to.pos) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "image-range-selected" }));
      }
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** Range selection gets an outline; node selection owns the resize controls. */
export function imageRangeSelectionPlugin() {
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => imageRangeDecorations(state),
      apply: (transaction, decorations, _, state) => transaction.docChanged || transaction.selectionSet
        ? imageRangeDecorations(state) : decorations,
    },
    props: { decorations(state) { return this.getState(state); } },
  });
}
