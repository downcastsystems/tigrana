import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type HighlightState = { decorations: DecorationSet; revision: number };
export const bulletMoveHighlightKey = new PluginKey<HighlightState>("bulletMoveHighlight");

/** View-only feedback. Each click replaces the previous highlight and its expiry. */
export function createBulletMoveHighlightPlugin() {
  return new Plugin<HighlightState>({
    key: bulletMoveHighlightKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, revision: 0 }),
      apply(tr, previous) {
        const position = tr.getMeta(bulletMoveHighlightKey) as number | null | undefined;
        if (position !== undefined) {
          const revision = previous.revision + 1;
          const node = position === null ? null : tr.doc.nodeAt(position);
          return {
            revision,
            decorations: node?.type.name === "paragraph" && position !== null
              ? DecorationSet.create(tr.doc, [Decoration.node(position, position + node.nodeSize, {
                class: `bullet-method-moved bullet-method-moved-${revision % 2}`,
              })]) : DecorationSet.empty,
          };
        }
        // Editing, undo, and note replacement must never leave a glow on unrelated text.
        return tr.docChanged ? { decorations: DecorationSet.empty, revision: previous.revision + 1 } : previous;
      },
    },
    props: { decorations: state => bulletMoveHighlightKey.getState(state)?.decorations },
    view: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update(view, previousState) {
          const current = bulletMoveHighlightKey.getState(view.state)!;
          if (current === bulletMoveHighlightKey.getState(previousState)) return;
          clearTimeout(timer);
          if (!current.decorations.find().length) return;
          timer = setTimeout(() => {
            view.dispatch(view.state.tr.setMeta(bulletMoveHighlightKey, null).setMeta("addToHistory", false));
          }, 900);
        },
        destroy() { clearTimeout(timer); },
      };
    },
  });
}
