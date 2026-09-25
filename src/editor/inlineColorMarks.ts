import { Mark, type Editor } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { Plugin } from "@tiptap/pm/state";
import { inlineColors, inlineColorStyle, inlineColorValue, normalizeInlineColor, type InlineColorCommand } from "../lib/inlineColors";

export const TextColor = Mark.create({
  name: "textColor",
  inclusive: true,
  keepOnSplit: true,
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPastedHTML(html) {
          const document = new DOMParser().parseFromString(html, "text/html");
          // Browser clipboard HTML can contain computed foreground colors
          // that are unreadable in another theme. Only Tigrana's explicit
          // color marks should carry a foreground across a paste.
          document.body.querySelectorAll<HTMLElement>("[style]").forEach(element => {
            if (!normalizeInlineColor(element.getAttribute("data-text-color"))) {
              element.style.removeProperty("color");
            }
          });
          return document.body.innerHTML;
        },
      },
    })];
  },
  addAttributes() {
    return { color: { default: null, parseHTML: element => inlineColorValue(element, "text"), rendered: false } };
  },
  parseHTML() {
    return [{ tag: "span", consuming: false, getAttrs: element => inlineColorValue(element, "text") ? {} : false }];
  },
  renderHTML({ mark }) {
    const color = normalizeInlineColor(mark.attrs.color);
    return ["span", color ? { "data-text-color": color, style: `color: ${inlineColorStyle(color, "text")}` } : {}, 0];
  },
});

export const ColorHighlight = Highlight.extend({
  inclusive: true,
  keepOnSplit: false,
  // Keep the background outside explicit text colors, including legacy marks
  // whose foreground is supplied by the theme.
  priority: 110,
  addCommands() {
    return {
      ...this.parent?.(),
      setHighlight: attributes => ({ commands }) =>
        this.editor.isEditable && commands.setMark(this.name, attributes),
      toggleHighlight: attributes => ({ commands }) =>
        this.editor.isEditable && commands.toggleMark(this.name, attributes),
    };
  },
  addAttributes() {
    return { color: { default: null, parseHTML: element => inlineColorValue(element, "highlight"), rendered: false } };
  },
  parseHTML() {
    return [
      { tag: "mark" },
      { tag: "span", consuming: false, getAttrs: element => inlineColorValue(element, "highlight") ? {} : false },
    ];
  },
  renderHTML({ mark }) {
    const color = normalizeInlineColor(mark.attrs.color);
    // Colored highlights are spans so theme rules for legacy <mark> do not
    // override them. Inherit text color; a nested textColor mark still wins.
    return color ? ["span", { "data-highlight-color": color, style: `background-color: ${inlineColorStyle(color, "highlight")}; color: inherit` }, 0] : ["mark", {}, 0];
  },
});

export function applyInlineColor(editor: Editor, command: InlineColorCommand) {
  if (!editor.isEditable) return false;
  const [kind, id] = command.split("_");
  const chain = editor.chain().focus();
  if (kind === "textColor" && id === "default") return chain.unsetMark("textColor").run();
  if (kind === "highlightColor" && id === "none") return chain.unsetHighlight().run();
  if (kind === "highlightColor" && id === "default") return chain.setMark("highlight", { color: null }).run();
  const color = inlineColors.find(entry => entry.id === id);
  if (!color) return false;
  return kind === "textColor" ? chain.setMark("textColor", { color: color.text.light }).run() : chain.setHighlight({ color: color.highlight.light }).run();
}
