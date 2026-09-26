import { OrderedList } from "@tiptap/extension-list";
import { InputRule } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { isSupportedOrderedListNumber } from "../lib/orderedListNumbers";

/** Size only the editor view; the persisted list stays ordinary Markdown. */
export const OrderedListWithGutter = OrderedList.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(rule => new InputRule({
      find: rule.find,
      handler: props => isSupportedOrderedListNumber(props.match[1]) ? rule.handler(props) : null,
    }));
  },
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map(plugin => new Plugin({
      ...plugin.spec,
      props: {
        ...plugin.props,
        handlePaste(view, event, slice) {
          const text = event.clipboardData?.getData("text/plain") ?? "";
          if (Array.from(text.matchAll(/^\s*(\d+)[.)]\s/gm)).some(match => !isSupportedOrderedListNumber(match[1]))) {
            // Let ProseMirror paste the literal text instead of Tiptap's list conversion.
            return false;
          }
          return plugin.props.handlePaste?.call(plugin, view, event, slice) ?? false;
        },
      },
    }));
  },
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("ol");
      for (const [name, value] of Object.entries(HTMLAttributes)) {
        if (value !== null && value !== undefined) dom.setAttribute(name, String(value));
      }
      const updateGutter = (list: ProseMirrorNode) => {
        const start = Number.isFinite(list.attrs.start) ? list.attrs.start as number : 1;
        const last = start + list.childCount - 1;
        const digits = Math.max(String(start).length, String(last).length);
        if (dom.start !== start) dom.start = start;
        const type = list.attrs.type as string | null;
        if (dom.getAttribute("type") !== type) {
          if (type) dom.setAttribute("type", type);
          else dom.removeAttribute("type");
        }
        const width = `${digits}ch`;
        if (dom.style.getPropertyValue("--ordered-list-marker-width") !== width) {
          dom.style.setProperty("--ordered-list-marker-width", width);
        }
      };
      updateGutter(node);
      return {
        dom,
        contentDOM: dom,
        update(nextNode) {
          if (nextNode.type !== node.type) return false;
          updateGutter(nextNode);
          return true;
        },
        ignoreMutation: mutation => mutation.type === "attributes" && mutation.target === dom,
      };
    };
  },
});
