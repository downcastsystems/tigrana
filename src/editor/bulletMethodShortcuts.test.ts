// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { defaultBulletMethodStatuses, validateBulletMethodStatuses, readBulletMethodStatuses, writeBulletMethodStatuses, readBulletMethodDisplay, writeBulletMethodDisplay, bulletMethodSettingsKey, bulletMethodDisplayKey } from "../lib/bulletMethod";
import { htmlToMarkdown } from "../lib/markdown";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string, enabled = true) {
  const editor = new Editor({ extensions: [StarterKit, BulletMethodMarkers], content });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled, replaceBullets: true, dimCompleted: true }));
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
it.each([["::", "TODO"], [".:", "IN PROGRESS"]])("converts %s after a space and persists the expanded status", (shortcut, status) => {
  const editor = create(`<p>${shortcut}</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.state.doc.textContent).toBe(`${status}: `);
  expect(htmlToMarkdown(editor.getHTML())).toContain(`- ${status}:`);
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe(`${shortcut} `);
});
it.each(["<p>text ::</p>", "<h2>::</h2>", "<pre><code>::</code></pre>", "<blockquote><p>::</p></blockquote>"])("leaves ordinary or non-paragraph content alone: %s", content => {
  const editor = create(content);
  type(editor, " ");
  expect(editor.state.doc.textContent).not.toContain("TODO");
});
it("requires the space and supports disabled shortcuts", () => {
  const editor = create("<p>:</p>");
  type(editor, ":");
  expect(editor.state.doc.textContent).toBe("::");
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, shortcutsEnabled: false }));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe(":: ");
  const disabled = create("<p>::</p>", false);
  type(disabled, " ");
  expect(disabled.state.doc.textContent).toBe(":: ");
});
it("uses live custom shortcuts and names without rebuilding the editor", () => {
  const editor = create("<p>go:</p>");
  const statuses = defaultBulletMethodStatuses.map(row => row.id === "todo" ? { ...row, prefix: "NEXT", shortcut: "go:" } : row);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("NEXT: ");
});
it("converts inside an empty bullet without nesting another list", () => {
  const editor = create("<ul><li><p>::</p></li></ul>");
  editor.commands.setTextSelection(5);
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("TODO: ");
  expect(editor.view.dom.querySelectorAll("ul")).toHaveLength(1);
});
it("does not replace text following the cursor or convert pasted shortcuts", () => {
  const editor = create("<p>:: following</p>");
  editor.commands.setTextSelection(3);
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("::  following");
  const pasted = create("<p></p>");
  pasted.view.pasteText(":: ", new Event("paste") as ClipboardEvent);
  expect(pasted.state.doc.textContent).toContain("::");
});
it("rejects duplicate shortcuts and allows clearing one", () => {
  expect(validateBulletMethodStatuses(defaultBulletMethodStatuses.map(row => row.id === "done" ? { ...row, shortcut: "::" } : row))).toBe("Each shortcut must be unique.");
  expect(validateBulletMethodStatuses(defaultBulletMethodStatuses.map(row => ({ ...row, shortcut: "" })))).toBeNull();
});

it("persists custom and cleared shortcuts and the global switch", () => {
  try {
    const statuses = defaultBulletMethodStatuses.map(row => ({ ...row, shortcut: row.id === "todo" ? "next:" : "" }));
    writeBulletMethodStatuses(statuses);
    expect(readBulletMethodStatuses()).toEqual(statuses);
    writeBulletMethodDisplay({ enabled: true, shortcutsEnabled: false, replaceBullets: true, dimCompleted: true });
    expect(readBulletMethodDisplay().shortcutsEnabled).toBe(false);
    const editor = create("<p>::</p>");
    editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, readBulletMethodStatuses()));
    type(editor, " ");
    expect(editor.state.doc.textContent).toBe(":: ");
  } finally {
    localStorage.removeItem(bulletMethodSettingsKey);
    localStorage.removeItem(bulletMethodDisplayKey);
  }
});

it.each(["x:", "*:", ">:", "-:", ":::"])("keeps unassigned shortcut %s as ordinary text", shortcut => {
  const editor = create(`<p>${shortcut}</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe(`${shortcut} `);
});
