// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

const {
  findSlashQueryInState,
  getTaskLineCutDeleteRange,
  serializeEditorSelectionForClipboard,
  setEditorEditableSilently,
  setEditorSpellcheck,
} = await import("./NotesEditor");

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
    },
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
    },
    bulletList: {
      content: "listItem+",
      group: "block",
      toDOM: () => ["ul", 0],
    },
    listItem: {
      content: "paragraph block*",
      toDOM: () => ["li", 0],
    },
  },
});

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function heading(text: string) {
  return schema.nodes.heading.create({ level: 1 }, text ? schema.text(text) : null);
}

function taskItem(text: string) {
  return schema.nodes.taskItem.create({ checked: false }, paragraph(text));
}

function taskDoc(items: string[]) {
  return schema.nodes.doc.create(null, schema.nodes.taskList.create(null, items.map(taskItem)));
}

function bulletItem(text: string, nestedList?: ProseMirrorNode) {
  return schema.nodes.listItem.create(null, nestedList ? [paragraph(text), nestedList] : paragraph(text));
}

function bulletList(items: ProseMirrorNode[]) {
  return schema.nodes.bulletList.create(null, items);
}

function bulletDoc(items: ProseMirrorNode[]) {
  return schema.nodes.doc.create(null, bulletList(items));
}

function textRange(doc: ProseMirrorNode, text: string) {
  let range: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (range || !node.isTextblock || node.textContent !== text) return;
    range = { from: pos + 1, to: pos + 1 + node.content.size };
  });
  const found = range as { from: number; to: number } | null;
  if (!found) throw new Error(`Missing text block: ${text}`);
  return found;
}

function clipboardPayload(doc: ProseMirrorNode, from: number, to: number) {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
  return serializeEditorSelectionForClipboard({ state } as EditorView);
}

describe("list clipboard serialization", () => {
  it("copies a partial word from one bullet without the bullet marker", () => {
    const line = "We create a security profile";
    const doc = bulletDoc([bulletItem(line)]);
    const range = textRange(doc, line);
    const wordFrom = range.from + line.indexOf("security");

    expect(clipboardPayload(doc, wordFrom, wordFrom + "security".length)).toEqual({
      plainText: "security",
      html: "<p>security</p>",
    });
  });

  it("keeps the marker when the entire bullet line is copied", () => {
    const line = "We create a security profile";
    const doc = bulletDoc([bulletItem(line)]);
    const range = textRange(doc, line);

    expect(clipboardPayload(doc, range.from, range.to)).toEqual({
      plainText: `- ${line}`,
      html: `<ul><li><p>${line}</p></li></ul>`,
    });
  });

  it("keeps markers when multiple bullet lines are copied", () => {
    const doc = bulletDoc([bulletItem("First"), bulletItem("Second")]);
    const first = textRange(doc, "First");
    const second = textRange(doc, "Second");

    expect(clipboardPayload(doc, first.from, second.to)?.plainText).toBe("- First\n- Second");
  });

  it("removes unselected ancestor bullets from a copied nested line", () => {
    const doc = bulletDoc([
      bulletItem("Parent", bulletList([
        bulletItem("Child", bulletList([
          bulletItem("Whatever I copied"),
        ])),
      ])),
    ]);
    const range = textRange(doc, "Whatever I copied");

    expect(clipboardPayload(doc, range.from, range.to)).toEqual({
      plainText: "- Whatever I copied",
      html: "<ul><li><p>Whatever I copied</p></li></ul>",
    });
  });

  it("copies a partial word from a nested bullet without any list structure", () => {
    const line = "Nested security detail";
    const doc = bulletDoc([
      bulletItem("Parent", bulletList([bulletItem(line)])),
    ]);
    const range = textRange(doc, line);
    const wordFrom = range.from + line.indexOf("security");

    expect(clipboardPayload(doc, wordFrom, wordFrom + "security".length)).toEqual({
      plainText: "security",
      html: "<p>security</p>",
    });
  });

  it("keeps selected parent and child bullet hierarchy", () => {
    const doc = bulletDoc([
      bulletItem("Parent", bulletList([bulletItem("Child")])),
    ]);
    const parent = textRange(doc, "Parent");
    const child = textRange(doc, "Child");

    expect(clipboardPayload(doc, parent.from, child.to)?.plainText).toBe("- Parent\n  - Child");
  });
});

type TaskItemTestRange = {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
};

function taskItemRange(doc: ReturnType<typeof taskDoc>, targetIndex: number) {
  const ranges: TaskItemTestRange[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return true;

    const firstParagraph = node.firstChild;
    if (!firstParagraph) throw new Error("Expected task item paragraph");
    const textFrom = pos + 2;
    ranges.push({
      from: pos,
      to: pos + node.nodeSize,
      textFrom,
      textTo: textFrom + firstParagraph.content.size,
    });
    return false;
  });

  const range = ranges[targetIndex];
  if (!range) throw new Error(`Missing task item ${targetIndex}`);
  return range;
}

describe("task line cut ranges", () => {
  it("expands a full single task text selection to remove the checkbox line", () => {
    const doc = taskDoc(["Buy milk"]);
    const item = taskItemRange(doc, 0);
    const selection = TextSelection.create(doc, item.textFrom, item.textTo);

    expect(getTaskLineCutDeleteRange(selection)).toEqual({
      from: 0,
      to: doc.firstChild?.nodeSize,
    });
  });

  it("leaves partial task text selections to the default cut behavior", () => {
    const doc = taskDoc(["Buy milk"]);
    const item = taskItemRange(doc, 0);
    const selection = TextSelection.create(doc, item.textFrom + 1, item.textTo);

    expect(getTaskLineCutDeleteRange(selection)).toBeNull();
  });

  it("removes selected task item siblings without deleting the whole list", () => {
    const doc = taskDoc(["Buy milk", "Write note", "Call Sam"]);
    const first = taskItemRange(doc, 0);
    const second = taskItemRange(doc, 1);
    const selection = TextSelection.create(doc, first.textFrom, second.textTo);

    expect(getTaskLineCutDeleteRange(selection)).toEqual({
      from: first.from,
      to: second.to,
    });
  });
});

describe("slash query detection", () => {
  it("finds slash commands in headings", () => {
    const text = "Accounts /emoji";
    const doc = schema.nodes.doc.create(null, heading(text));
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1 + text.length),
    });

    expect(findSlashQueryInState(state)).toEqual({
      query: "emoji",
      range: { from: 10, to: 16 },
    });
  });
});

describe("editor editability", () => {
  it("changes editability without emitting a document update", () => {
    const calls: Array<[boolean, boolean | undefined]> = [];
    const editor = {
      setEditable(editable: boolean, emitUpdate?: boolean) {
        calls.push([editable, emitUpdate]);
      },
    };

    setEditorEditableSilently(editor, true);

    expect(calls).toEqual([[true, false]]);
  });
});

describe("editor spellcheck", () => {
  it("updates the ProseMirror attributes without dropping other editor props", () => {
    const handlePaste = () => false;
    const editor: {
      options: { editorProps?: EditorProps };
      setOptions(options: { editorProps: EditorProps }): void;
    } = {
      options: {
        editorProps: {
          attributes: {
            autocorrect: "off",
            spellcheck: "false",
          },
          handlePaste,
        },
      },
      setOptions(options) {
        editor.options = options;
      },
    };

    setEditorSpellcheck(editor, true);

    expect(editor.options.editorProps).toEqual({
      attributes: {
        autocorrect: "off",
        spellcheck: "true",
      },
      handlePaste,
    });
  });
});
