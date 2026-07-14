import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorProps } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { findSlashQueryInState, getTaskLineCutDeleteRange, setEditorEditableSilently, setEditorSpellcheck } from "./NotesEditor";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { content: "inline*", group: "block" },
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
