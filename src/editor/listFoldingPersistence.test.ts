// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, expect, it, vi } from "vitest";
import { ListFolding, listFoldingKey } from "./listFolding";
import { ListFoldingPersistence } from "./listFoldingPersistence";
import { createDeferredCommit } from "../lib/deferredCommit";
import { foldingContentFingerprint, restorableListFolding } from "../lib/noteListFolding";
import { htmlToMarkdown } from "../lib/markdown";
import type { NoteListFoldingMetadata } from "../types";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.useRealTimers(); vi.restoreAllMocks(); });
const html = '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>';
function setup(content = html) {
  const editor = new Editor({ extensions: [StarterKit, ListFolding], content });
  editors.push(editor); editor.view.dispatch(editor.state.tr);
  const report = vi.fn();
  const persistence = new ListFoldingPersistence(report);
  const serialize = vi.fn(() => htmlToMarkdown(editor.getHTML()));
  const markdown = serialize(); serialize.mockClear();
  persistence.load(editor, "/Notebook", "A.md", markdown, null);
  const deferred = createDeferredCommit<string>(300, value => persistence.serialized(editor, value));
  let previous = listFoldingKey.getState(editor.state);
  editor.on("transaction", ({ transaction }) => {
    const next = listFoldingKey.getState(editor.state);
    if (transaction.docChanged || previous?.decorations !== next?.decorations) persistence.changed(editor, transaction.docChanged, deferred.flush);
    previous = next;
  });
  editor.on("update", () => deferred.schedule(serialize));
  const click = (index = 0) => editor.view.dom.querySelectorAll<HTMLButtonElement>(".list-fold-button")[index].click();
  return { editor, report, persistence, serialize, markdown, deferred, click };
}

it("coalesces fold clicks without serializing Markdown; restores a fresh editor in its initial traversal", () => {
  vi.useFakeTimers();
  const { editor, report, serialize, markdown, click } = setup();
  const before = editor.getJSON();
  for (let i = 0; i < 21; i++) click();
  expect(report).not.toHaveBeenCalled(); expect(serialize).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(report).toHaveBeenCalledOnce(); expect(serialize).not.toHaveBeenCalled();
  const saved = report.mock.calls[0][0] as NoteListFoldingMetadata;
  expect(saved.collapsed).toHaveLength(1);
  expect(report.mock.calls[0].slice(1)).toEqual(["/Notebook", "A.md"]);
  const doc = editor.schema.nodeFromJSON(before);
  const scan = vi.spyOn(doc, "descendants");
  const state = EditorState.create({ doc, plugins: editor.state.plugins,
    ...{ listFolding: { writingStyle: "notes", saved: restorableListFolding(JSON.parse(JSON.stringify(saved)), markdown) } },
  });
  expect(scan).toHaveBeenCalledOnce();
  expect(listFoldingKey.getState(state)?.collapsedCount).toBe(1);
  expect(state.doc.toJSON()).toEqual(before);
  click(); vi.advanceTimersByTime(300);
  expect(report.mock.calls.at(-1)?.[0]).toBeNull();
});

it("does no snapshot scans or extra serialization during typing with 1000 collapsed parents", () => {
  vi.useFakeTimers();
  const { editor, report, persistence, serialize, deferred } = setup('<ul>' + Array.from({ length: 1000 }, (_, i) => `<li><p>Parent ${i}</p><ul><li><p>Child ${i}</p></li></ul></li>`).join("") + '</ul>');
  const collapsed: NoteListFoldingMetadata["collapsed"] = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "listItem" && node.childCount > 1) collapsed.push([pos, node.nodeSize, node.firstChild!.nodeSize]); });
  const saved: NoteListFoldingMetadata = { version: 1, docSize: editor.state.doc.content.size, contentFingerprint: foldingContentFingerprint(serialize()), collapsed };
  editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins,
    ...{ listFolding: { writingStyle: "notes", saved } },
  }));
  persistence.load(editor, "/Notebook", "Long.md", serialize(), saved);
  serialize.mockClear();
  const scan = vi.spyOn(listFoldingKey.getState(editor.state)!.decorations, "find");
  editor.commands.setTextSelection(5);
  for (let i = 0; i < 20; i++) editor.commands.insertContent("x");
  expect(report).not.toHaveBeenCalled(); expect(serialize).not.toHaveBeenCalled();
  // Incremental folding may query a local item, never the entire document.
  expect(scan.mock.calls.every(call => call[1] !== editor.state.doc.content.size)).toBe(true);
  const finalScan = vi.spyOn(listFoldingKey.getState(editor.state)!.decorations, "find");
  vi.advanceTimersByTime(300);
  expect(serialize).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledOnce();
  expect(finalScan).toHaveBeenCalledOnce();
  expect(report.mock.calls[0][0].collapsed).toHaveLength(1000);
  expect(report.mock.calls[0][0].contentFingerprint).toBe(foldingContentFingerprint(serialize.mock.results[0].value));
  deferred.cancel();
});

it("rejects changed content, invalid metadata, and structurally different editor documents", () => {
  vi.useFakeTimers();
  const { editor, report, markdown, click } = setup(); click(); vi.advanceTimersByTime(300);
  const saved = report.mock.calls[0][0] as NoteListFoldingMetadata;
  expect(restorableListFolding(saved, markdown.replace("Parent", "Change"))).toBeNull();
  expect(restorableListFolding({ ...saved, collapsed: [[-1, 10, 5]] }, markdown)).toBeNull();
  expect(restorableListFolding({ ...saved, collapsed: null } as unknown as NoteListFoldingMetadata, markdown)).toBeNull();
  expect(restorableListFolding(saved, markdown.replace(/\n/g, "\r\n") + "\n")).toBe(saved);
  const state = EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins,
    ...{ listFolding: { writingStyle: "notes", saved: { ...saved, collapsed: [[0, 1, 0]] } } },
  });
  expect(listFoldingKey.getState(state)?.collapsedCount).toBe(0);
});

it("flushes at a navigation boundary, cancels stale work, and follows renamed note paths", () => {
  vi.useFakeTimers();
  const { editor, report, persistence, markdown, click } = setup();
  click(); persistence.flush(editor);
  expect(report).toHaveBeenCalledOnce();
  persistence.relocate("/Notebook", "Renamed.md"); click(); persistence.flush(editor);
  expect(report.mock.calls.at(-1)).toEqual([null, "/Notebook", "Renamed.md"]);
  click(); persistence.load(editor, "/Other notebook", "Other.md", markdown, null);
  vi.advanceTimersByTime(300); expect(report).toHaveBeenCalledTimes(2);
});

it("never saves temporary Story visibility as an unfold, and skips snapshot work for unfolded notes", () => {
  vi.useFakeTimers();
  const { editor, persistence, report, serialize, click } = setup();
  editor.commands.setTextSelection(5); editor.commands.insertContent("x"); vi.advanceTimersByTime(300);
  expect(serialize).toHaveBeenCalledOnce(); expect(report).not.toHaveBeenCalled();
  click(); vi.advanceTimersByTime(300); report.mockClear();
  editor.view.dispatch(editor.state.tr.setMeta(listFoldingKey, { writingStyle: "story" }));
  persistence.flush(editor); vi.advanceTimersByTime(300);
  expect(report).not.toHaveBeenCalled();
});

it("cancels a fold timer if the fold is undone before a typing burst", () => {
  vi.useFakeTimers();
  const { editor, report, serialize, click } = setup();
  click(); vi.advanceTimersByTime(200); click();
  editor.commands.setTextSelection(5); editor.commands.insertContent("first");
  vi.advanceTimersByTime(150); editor.commands.insertContent("second");
  vi.advanceTimersByTime(200);
  expect(serialize).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100); expect(serialize).toHaveBeenCalledOnce();
});
