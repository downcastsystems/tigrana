// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

const {
  BoundedNoteStateCache,
  cacheCurrentNoteEditorState,
  collapseBoundarySelectionAt,
  findSlashQueryInState,
  getTaskLineCutDeleteRange,
  getEditorDocumentLoadAction,
  handleNestedListBoundaryDelete,
  handleOutermostListItemBackspace,
  handleSameLevelListItemBackspace,
  isFormattingSelection,
  resetEditorHistory,
  restoreCachedNoteEditorState,
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

function taskItem(text: string, nestedList?: ProseMirrorNode) {
  return schema.nodes.taskItem.create(
    { checked: false },
    nestedList ? [paragraph(text), nestedList] : paragraph(text),
  );
}

function taskDoc(items: string[]) {
  return schema.nodes.doc.create(null, schema.nodes.taskList.create(null, items.map((text) => taskItem(text))));
}

function taskList(items: ProseMirrorNode[]) {
  return schema.nodes.taskList.create(null, items);
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

function applyBoundaryKey(doc: ProseMirrorNode, position: number, key: "Backspace" | "Delete") {
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, position) });
  const event = new KeyboardEvent("keydown", { key });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: ReturnType<typeof state["tr"]["setSelection"]>) {
      state = state.apply(transaction);
    },
  } as EditorView;

  return {
    handled: handleNestedListBoundaryDelete(view, event),
    state,
  };
}

function applyOutermostListBackspace(doc: ProseMirrorNode, position: number) {
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, position) });
  const event = new KeyboardEvent("keydown", { key: "Backspace" });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: ReturnType<typeof state["tr"]["setSelection"]>) {
      state = state.apply(transaction);
    },
  } as EditorView;

  return {
    handled: handleOutermostListItemBackspace(view, event),
    state,
  };
}

function applySameLevelListBackspace(
  doc: ProseMirrorNode,
  position: number,
  eventInit: KeyboardEventInit = {},
) {
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, position) });
  const event = new KeyboardEvent("keydown", { key: "Backspace", ...eventInit });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: ReturnType<typeof state["tr"]["setSelection"]>) {
      state = state.apply(transaction);
    },
  } as EditorView;

  return {
    handled: handleSameLevelListItemBackspace(view, event),
    state,
  };
}

describe("nested list boundary deletion", () => {
  const createScenario = () => bulletDoc([
    bulletItem("Worried", bulletList([
      bulletItem("That we may have a perfect storm", bulletList([bulletItem("")])),
      bulletItem("Another concern"),
    ])),
    bulletItem("Following top-level bullet"),
  ]);

  it("joins a child bullet into its parent on forward Delete", () => {
    const doc = createScenario();
    const parent = textRange(doc, "Worried");
    const result = applyBoundaryKey(doc, parent.to, "Delete");

    expect(result.handled).toBe(true);
    expect(result.state.selection).toBeInstanceOf(TextSelection);
    expect(result.state.doc.toJSON()).toEqual(bulletDoc([
      bulletItem("WorriedThat we may have a perfect storm", bulletList([
        bulletItem(""),
        bulletItem("Another concern"),
      ])),
      bulletItem("Following top-level bullet"),
    ]).toJSON());
  });

  it("joins a child bullet into its parent on Backspace", () => {
    const doc = createScenario();
    const child = textRange(doc, "That we may have a perfect storm");
    const result = applyBoundaryKey(doc, child.from, "Backspace");

    expect(result.handled).toBe(true);
    expect(result.state.selection).toBeInstanceOf(TextSelection);
    expect(result.state.doc.textContent).toContain("WorriedThat we may have a perfect storm");
    expect(result.state.doc.textContent).toContain("Another concern");
    const joined = textRange(result.state.doc, "WorriedThat we may have a perfect storm");
    expect(result.state.selection.from).toBe(joined.from + "Worried".length);
  });

  it("does not join the child into its parent while removing a trailing empty paragraph", () => {
    const childWithTrailingParagraph = schema.nodes.listItem.create(null, [
      paragraph("That blah blah blah"),
      paragraph(""),
    ]);
    const doc = bulletDoc([
      bulletItem("Worried", bulletList([childWithTrailingParagraph])),
    ]);
    let emptyParagraphStart = -1;
    doc.descendants((node, position) => {
      if (node.type.name === "paragraph" && node.content.size === 0) emptyParagraphStart = position + 1;
    });

    const result = applyBoundaryKey(doc, emptyParagraphStart, "Backspace");

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });
});

describe("same-level list item Backspace", () => {
  it("joins the current item text into its previous sibling", () => {
    const doc = bulletDoc([
      bulletItem("a"),
      bulletItem("b"),
      bulletItem("c"),
    ]);
    const b = textRange(doc, "b");

    const result = applySameLevelListBackspace(doc, b.from);

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual(bulletDoc([
      bulletItem("ab"),
      bulletItem("c"),
    ]).toJSON());
    expect(result.state.selection.from).toBe(textRange(result.state.doc, "ab").from + 1);
  });

  it("preserves and combines nested content from both items", () => {
    const doc = bulletDoc([
      bulletItem("a", bulletList([
        bulletItem("a child"),
      ])),
      bulletItem("b", bulletList([
        bulletItem("b child"),
      ])),
      bulletItem("c"),
    ]);
    const b = textRange(doc, "b");

    const result = applySameLevelListBackspace(doc, b.from);

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual(bulletDoc([
      bulletItem("ab", bulletList([
        bulletItem("a child"),
        bulletItem("b child"),
      ])),
      bulletItem("c"),
    ]).toJSON());
  });

  it("does not handle the first item, modified Backspace, or a cursor inside text", () => {
    const doc = bulletDoc([
      bulletItem("a"),
      bulletItem("b"),
    ]);
    const a = textRange(doc, "a");
    const b = textRange(doc, "b");

    expect(applySameLevelListBackspace(doc, a.from).handled).toBe(false);
    expect(applySameLevelListBackspace(doc, b.from, { altKey: true }).handled).toBe(false);
    expect(applySameLevelListBackspace(doc, b.from + 1).handled).toBe(false);
  });
});

describe("outermost list item Backspace", () => {
  it("removes the first top-level bullet and promotes its nested bullets", () => {
    const doc = schema.nodes.doc.create(null, [
      heading("Notes"),
      bulletList([
        bulletItem("Mike", bulletList([
          bulletItem("sheets v2 - using pgboss with individual scheduled jobs"),
        ])),
      ]),
    ]);
    const mike = textRange(doc, "Mike");

    const result = applyOutermostListBackspace(doc, mike.from);

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual(schema.nodes.doc.create(null, [
      heading("Notes"),
      paragraph("Mike"),
      bulletList([
        bulletItem("sheets v2 - using pgboss with individual scheduled jobs"),
      ]),
    ]).toJSON());
    expect(result.state.selection.from).toBe(textRange(result.state.doc, "Mike").from);
  });

  it("does not override normal Backspace for a later sibling", () => {
    const doc = bulletDoc([
      bulletItem("First"),
      bulletItem("Second"),
    ]);
    const second = textRange(doc, "Second");

    const result = applyOutermostListBackspace(doc, second.from);

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });

  it("does not override a native join with a preceding adjacent list", () => {
    const doc = schema.nodes.doc.create(null, [
      bulletList([bulletItem("First")]),
      bulletList([bulletItem("Second")]),
    ]);
    const second = textRange(doc, "Second");

    const result = applyOutermostListBackspace(doc, second.from);

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });

  it("leaves an unnested top-level bullet to native Backspace", () => {
    const doc = schema.nodes.doc.create(null, [
      heading("Notes"),
      bulletList([bulletItem("Mike")]),
    ]);
    const mike = textRange(doc, "Mike");

    const result = applyOutermostListBackspace(doc, mike.from);

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });

  it("leaves nested items to the nested-list boundary handler", () => {
    const doc = bulletDoc([
      bulletItem("Parent", bulletList([
        bulletItem("Child"),
      ])),
    ]);
    const child = textRange(doc, "Child");

    const result = applyOutermostListBackspace(doc, child.from);

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });

  it("uses the same fallback for a non-empty top-level task with nested tasks", () => {
    const doc = schema.nodes.doc.create(null, [
      heading("Notes"),
      taskList([
        taskItem("Mike", taskList([
          taskItem("Follow up"),
        ])),
      ]),
    ]);
    const mike = textRange(doc, "Mike");

    const result = applyOutermostListBackspace(doc, mike.from);

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual(schema.nodes.doc.create(null, [
      heading("Notes"),
      paragraph("Mike"),
      taskList([
        taskItem("Follow up"),
      ]),
    ]).toJSON());
  });

  it("does not lift while the cursor is inside the item text", () => {
    const doc = bulletDoc([bulletItem("Mike")]);
    const mike = textRange(doc, "Mike");

    const result = applyOutermostListBackspace(doc, mike.from + 1);

    expect(result.handled).toBe(false);
    expect(result.state.doc.eq(doc)).toBe(true);
  });
});

describe("editor history across Note loads", () => {
  it("does not allow Undo to restore the previously loaded Note", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Note A</p>",
    });

    try {
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.insertContent(" changed");
      editor.commands.setContent("<p>Note B</p>", false);

      resetEditorHistory(editor);

      expect(editor.getText()).toBe("Note B");
      expect(editor.can().undo()).toBe(false);
      expect(editor.commands.undo()).toBe(false);
      expect(editor.getText()).toBe("Note B");

      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.insertContent(" changed");

      expect(editor.can().undo()).toBe(true);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getText()).toBe("Note B");
    } finally {
      editor.destroy();
    }
  });

  it("restores independent Undo histories when switching between Notes", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Note A</p>",
    });
    const cache = new BoundedNoteStateCache(30);

    try {
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.insertContent(" changed");
      cacheCurrentNoteEditorState(cache, "Note A.md", editor);

      editor.commands.setContent("<p>Note B</p>", false);
      resetEditorHistory(editor);
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.insertContent(" changed");
      cacheCurrentNoteEditorState(cache, "Note B.md", editor);

      expect(restoreCachedNoteEditorState(cache, "Note A.md", "Note A changed", editor)).toBe(true);
      expect(editor.getText()).toBe("Note A changed");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getText()).toBe("Note A");
      cacheCurrentNoteEditorState(cache, "Note A.md", editor);

      expect(restoreCachedNoteEditorState(cache, "Note B.md", "Note B changed", editor)).toBe(true);
      expect(editor.getText()).toBe("Note B changed");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getText()).toBe("Note B");
    } finally {
      editor.destroy();
    }
  });

  it("rejects stale cached state and evicts the least recently used Note", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Original</p>",
    });
    const cache = new BoundedNoteStateCache(2);

    try {
      cacheCurrentNoteEditorState(cache, "A.md", editor);
      editor.commands.setContent("<p>Note B</p>", false);
      cacheCurrentNoteEditorState(cache, "B.md", editor);
      expect(cache.get("A.md")).toBeDefined();
      editor.commands.setContent("<p>Note C</p>", false);
      cacheCurrentNoteEditorState(cache, "C.md", editor);

      expect(cache.get("B.md")).toBeUndefined();
      expect(restoreCachedNoteEditorState(cache, "A.md", "Externally changed", editor)).toBe(false);
      expect(cache.get("A.md")).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });
});

describe("editor document load decisions", () => {
  it("preserves the editor when the same Note gets a new path", () => {
    expect(getEditorDocumentLoadAction({
      currentHistoryKey: "workspace\u0000note-id",
      currentPath: "Old title.md",
      nextHistoryKey: "workspace\u0000note-id",
      nextPath: "New title.md",
      requestedReload: false,
    })).toBe("preserve");
  });

  it("loads when switching identities or explicitly reloading", () => {
    expect(getEditorDocumentLoadAction({
      currentHistoryKey: "workspace\u0000note-a",
      currentPath: "Note A.md",
      nextHistoryKey: "workspace\u0000note-b",
      nextPath: "Note B.md",
      requestedReload: false,
    })).toBe("load");
    expect(getEditorDocumentLoadAction({
      currentHistoryKey: "workspace\u0000note-a",
      currentPath: "Note A.md",
      nextHistoryKey: "workspace\u0000note-a",
      nextPath: "Note A.md",
      requestedReload: true,
    })).toBe("load");
  });

  it("does nothing when neither the Note nor path changed", () => {
    expect(getEditorDocumentLoadAction({
      currentHistoryKey: "workspace\u0000note-a",
      currentPath: "Note A.md",
      nextHistoryKey: "workspace\u0000note-a",
      nextPath: "Note A.md",
      requestedReload: false,
    })).toBe("unchanged");
  });
});

describe("formatting selection eligibility", () => {
  it("accepts a non-empty text selection", () => {
    const doc = bulletDoc([bulletItem("Worried")]);
    const range = textRange(doc, "Worried");
    expect(isFormattingSelection(TextSelection.create(doc, range.from, range.to))).toBe(true);
  });

  it("rejects structural node selections", () => {
    const doc = bulletDoc([bulletItem("Worried", bulletList([bulletItem("That")]))]);
    const nestedListPosition = textRange(doc, "Worried").to + 1;
    expect(isFormattingSelection(NodeSelection.create(doc, nestedListPosition))).toBe(false);
  });

  it("rejects a text selection that contains only a block boundary", () => {
    const doc = bulletDoc([bulletItem("First"), bulletItem("Second")]);
    const first = textRange(doc, "First");
    const second = textRange(doc, "Second");
    const boundarySelection = TextSelection.create(doc, first.to, second.from);

    expect(boundarySelection.empty).toBe(false);
    expect(isFormattingSelection(boundarySelection)).toBe(false);
  });
});

describe("double-click boundary selection", () => {
  function selectionView(doc: ProseMirrorNode, selection: TextSelection) {
    let state = EditorState.create({ doc, selection });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: ReturnType<typeof state["tr"]["setSelection"]>) {
        state = state.apply(transaction);
      },
    } as EditorView;
    return { view, getState: () => state };
  }

  it("collapses a zero-text boundary selection to the clicked position", () => {
    const doc = bulletDoc([bulletItem("First"), bulletItem("Second")]);
    const first = textRange(doc, "First");
    const second = textRange(doc, "Second");
    const subject = selectionView(doc, TextSelection.create(doc, first.to, second.from));

    expect(collapseBoundarySelectionAt(subject.view, first.to)).toBe(true);
    expect(subject.getState().selection.empty).toBe(true);
    expect(subject.getState().selection.from).toBe(first.to);
  });

  it("preserves a normal double-click word selection", () => {
    const doc = bulletDoc([bulletItem("First word")]);
    const line = textRange(doc, "First word");
    const subject = selectionView(doc, TextSelection.create(doc, line.from, line.from + "First".length));

    expect(collapseBoundarySelectionAt(subject.view, line.from + "First".length)).toBe(false);
    expect(subject.getState().selection.from).toBe(line.from);
    expect(subject.getState().selection.to).toBe(line.from + "First".length);
  });
});

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
