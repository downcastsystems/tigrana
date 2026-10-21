import { createTextShortcutUndoPlugin, prepareTextShortcutUndo, undoTextShortcut } from "./textShortcutUndo";
import { Extension, InputRule, type Editor, type Range, type ChainedCommands } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser, Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, type EditorState } from "@tiptap/pm/state";
import { markdownToHtml } from "../lib/markdown";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { emptyTextShortcuts, textShortcutError, textShortcutInsertionError, type TextShortcut } from "../lib/textShortcuts";
import { bulletMethodMarkersKey } from "./bulletMethodMarkers";

export const textShortcutsKey = new PluginKey<readonly TextShortcut[]>("textShortcuts");

export function availableTextShortcuts(state: EditorState, mode: "typed" | "menu" = "typed") {
  const shortcuts = textShortcutsKey.getState(state) ?? emptyTextShortcuts;
  const statuses = bulletMethodMarkersKey.getState(state)?.statuses ?? defaultBulletMethodStatuses;
  const validate = mode === "menu" ? textShortcutInsertionError : textShortcutError;
  return shortcuts.filter(shortcut => !validate(shortcut, shortcuts, statuses));
}

function insertShortcut(chain: ChainedCommands, state: EditorState, range: Range, shortcut: TextShortcut, inputText = "") {
  const rememberUndo = prepareTextShortcutUndo(state, inputText);
  const run = () => chain.command(({ tr }) => { rememberUndo(tr); return true; }).run();
  const container = document.createElement("div");
  container.innerHTML = markdownToHtml(shortcut.markdown);
  const doc = ProseMirrorDOMParser.fromSchema(state.schema).parse(container);
  const list = doc.childCount === 1 ? doc.firstChild : null;
  const $from = state.doc.resolve(range.from);
  const $to = state.doc.resolve(range.to);
  if (list && ["bulletList", "orderedList", "taskList"].includes(list.type.name)
    && $from.sameParent($to) && $from.parent.type.name === "paragraph"
    && range.from === $from.start() && range.to === $from.end()
    && $from.depth >= 3 && $from.index(-1) === 0
    && $from.node(-2).type === list.type && $from.node(-1).type === list.firstChild?.type) {
    const item = $from.node(-1);
    const itemFrom = $from.before(-1);
    // Replace the placeholder item with siblings at its current list depth.
    // Inserting a whole list into its empty paragraph would nest it beneath
    // an extra blank bullet. Keep existing child blocks on the first item.
    const children = item.content.cut($from.parent.nodeSize);
    const first = list.firstChild!;
    const items = Fragment.from(first.copy(first.content.append(children))).append(list.content.cut(first.nodeSize));
    chain.command(({ tr }) => {
      tr.replaceWith(itemFrom, itemFrom + item.nodeSize, items);
      tr.setSelection(Selection.near(tr.doc.resolve(itemFrom + items.size - 1), -1)).scrollIntoView();
      tr.setStoredMarks(null);
      return true;
    });
    return run();
  }
  const paragraph = doc.childCount === 1 && doc.firstChild?.type.name === "paragraph"
    && Object.entries(doc.firstChild.attrs).every(([key, value]) => value === doc.firstChild!.type.spec.attrs?.[key]?.default);
  // Inline text expands in place. Structured templates use the editor's normal
  // slice fitting, replacing the empty trigger paragraph when appropriate.
  const content = paragraph ? doc.firstChild!.content : doc.content;
  chain.deleteRange(range).insertContent(content);
  return run();
}

export function insertTextShortcut(editor: Editor, range: Range, shortcut: TextShortcut) {
  if (!editor.isEditable || editor.isActive("codeBlock") || editor.isActive("code")) return false;
  return insertShortcut(editor.chain().focus(), editor.state, range, shortcut);
}

function matchTypedShortcut(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph" || $from.marks().some(mark => mark.type.spec.code)) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 65), $from.parentOffset, "", node => node.type.name === "hardBreak" ? "\n" : "\0");
  const match = /(?:^|\s)(\S{1,64})$/.exec(before);
  const shortcut = match && availableTextShortcuts(state).find(item => item.trigger === match[1]);
  return shortcut ? { shortcut, range: { from: $from.pos - shortcut.trigger.length, to: $from.pos } } : null;
}

function hasTriggerBoundary(state: EditorState, from: number) {
  const $from = state.doc.resolve(from);
  return $from.parentOffset === 0 || /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, "",
    node => node.type.name === "hardBreak" ? "\n" : "\0"));
}

export function handleTextShortcutEnter(editor: Editor, event: KeyboardEvent) {
  if (event.key !== "Enter" || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || editor.view.composing) return false;
  const match = matchTypedShortcut(editor.state);
  if (!match || !insertTextShortcut(editor, match.range, match.shortcut)) return false;
  event.preventDefault();
  return true;
}

export const TextShortcuts = Extension.create({
  name: "textShortcuts",
  addInputRules() {
    return [new InputRule({
      find: text => {
        if (!text.endsWith(" ")) return null;
        // Match only the trigger: Tiptap's text representation of a preceding
        // line break or other inline atom can have a different document length.
        const shortcut = availableTextShortcuts(this.editor.state).filter(item => text.endsWith(`${item.trigger} `))
          .sort((a, b) => b.trigger.length - a.trigger.length)[0];
        if (!shortcut) return null;
        return { index: text.length - shortcut.trigger.length - 1, text: `${shortcut.trigger} `, replaceWith: shortcut.trigger };
      },
      undoable: false,
      handler: ({ state, range, match, chain }) => {
        if (!state.selection.empty || state.selection.$from.parent.type.name !== "paragraph") return null;
        const shortcut = availableTextShortcuts(state).find(item => item.trigger === match[1]);
        if (!shortcut) return null;
        const from = range.from + match[0].length - match[1].length - 1;
        // A batched input can include text before the trigger that isn't in
        // the document yet. Leave that batch literal rather than resolve it.
        if (from > state.selection.from || !hasTriggerBoundary(state, from)) return null;
        const inputText = match[0].slice(state.selection.from - range.from);
        insertShortcut(chain(), state, { from, to: range.to }, shortcut, inputText);
      },
    })];
  },
  addKeyboardShortcuts() {
    return { Backspace: () => undoTextShortcut(this.editor), Enter: () => {
      if (this.editor.view.composing) return false;
      const match = matchTypedShortcut(this.editor.state);
      return match ? insertTextShortcut(this.editor, match.range, match.shortcut) : false;
    } };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ key: textShortcutsKey, state: {
      init: () => emptyTextShortcuts,
      apply: (tr, previous) => tr.getMeta(textShortcutsKey) ?? previous,
    } }), createTextShortcutUndoPlugin(textShortcutsKey)];
  },
});
