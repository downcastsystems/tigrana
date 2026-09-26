import { Extension, InputRule, PasteRule } from "@tiptap/core";
import { emojiShortcodeToText } from "../lib/emoji";

export const EM_SPACE = " ";

export const ListItemSeparator = Extension.create({
  name: "listItemSeparator",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          separatorAfter: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-separator-after") === "true",
            renderHTML: (attributes) =>
              attributes.separatorAfter ? { "data-separator-after": "true" } : {},
          },
        },
      },
    ];
  },
});

export const EmSpaceIndent = Extension.create({
  name: "emSpaceIndent",
  addKeyboardShortcuts() {
    const passThroughContext = () => {
      const { editor } = this;
      return (
        editor.isActive("listItem") ||
        editor.isActive("taskItem") ||
        editor.isActive("table") ||
        editor.isActive("codeBlock")
      );
    };

    return {
      Tab: () => {
        if (passThroughContext()) return false;
        return this.editor.commands.insertContent(EM_SPACE);
      },
      "Shift-Tab": () => {
        if (passThroughContext()) return false;
        const { state } = this.editor;
        const { from, empty } = state.selection;
        if (!empty || from === 0) return false;
        if (state.doc.textBetween(from - 1, from) !== EM_SPACE) return false;
        return this.editor.chain().deleteRange({ from: from - 1, to: from }).run();
      },
    };
  },
});

export const EmojiText = Extension.create({
  name: "emojiText",

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z0-9_+-]+):$/,
        handler: ({ state, range, match }) => {
          const emoji = emojiShortcodeToText(match[1] ?? "");
          if (!emoji) return null;
          state.tr.insertText(emoji, range.from, range.to);
          return undefined;
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: /:([a-zA-Z0-9_+-]+):/g,
        handler: ({ state, range, match }) => {
          const emoji = emojiShortcodeToText(match[1] ?? "");
          if (!emoji) return null;
          state.tr.insertText(emoji, range.from, range.to);
          return undefined;
        },
      }),
    ];
  },
});
