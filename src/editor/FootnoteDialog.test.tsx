// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { FootnoteDialog } from "./FootnoteDialog";
import { FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions, requestFootnote } from "./footnotes";
import { htmlToMarkdown } from "../lib/markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let editor: Editor, root: Root, mount: HTMLDivElement, host: HTMLDivElement;
async function setup(onMouseDown?: React.MouseEventHandler, onKeyDown?: React.KeyboardEventHandler) {
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  host = document.createElement("div"); mount = document.createElement("div"); document.body.append(host, mount);
  editor = new Editor({ element: host, extensions: [StarterKit, FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions], content: "<p>Before after</p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 10 });
  root = createRoot(mount);
  await act(async () => root.render(<div onMouseDown={onMouseDown} onKeyDown={onKeyDown}><FootnoteDialog editor={editor} disabled={false} /></div>));
  editor.commands.setTextSelection(7);
}
afterEach(async () => {
  await act(async () => root?.unmount()); editor?.destroy(); host?.remove(); mount?.remove(); vi.restoreAllMocks();
});
async function write(body: string) {
  await act(async () => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Footnote text"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, body);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => document.querySelector('form[role="dialog"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
it("inserts at the original cursor and edits a clicked reference with undo", async () => {
  await setup();
  await act(async () => requestFootnote(editor));
  await write("A **formatted** footnote.\n\nSecond paragraph.");
  await submit();
  expect(htmlToMarkdown(editor.getHTML())).toContain("Before[^1] after");
  expect(htmlToMarkdown(editor.getHTML())).toContain("[^1]: A **formatted** footnote.\n\n    Second paragraph.");
  await act(async () => (host.querySelector('.footnote-reference') as HTMLElement).click());
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe("A **formatted** footnote.\n\nSecond paragraph.");
  await write("Updated text."); await submit();
  expect(htmlToMarkdown(editor.getHTML())).toContain("[^1]: Updated text.");
  await act(async () => { editor.commands.undo(); });
  expect(htmlToMarkdown(editor.getHTML())).toContain("[^1]: A **formatted** footnote.");
});
it("dismisses on note replacement and does not open for read-only notes", async () => {
  await setup();
  await act(async () => requestFootnote(editor));
  await act(async () => { editor.commands.setContent("<p>Another note</p>"); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  editor.setEditable(false);
  await act(async () => requestFootnote(editor));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps portal text clicks and keystrokes inside the dialog", async () => {
  const parentMouseDown = vi.fn((event: React.MouseEvent) => {
    event.preventDefault();
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.view.focus();
  });
  const parentKeyDown = vi.fn();
  await setup(parentMouseDown, parentKeyDown);
  await act(async () => requestFootnote(editor));
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Footnote text"]')!;
  const originalSelection = editor.state.selection.toJSON();
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  await act(async () => { input.dispatchEvent(down); });
  expect(parentMouseDown).not.toHaveBeenCalled();
  expect(down.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(editor.state.selection.toJSON()).toEqual(originalSelection);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
  expect(parentKeyDown).not.toHaveBeenCalled();
  await write("Keep editing here");
  await submit();
  expect(htmlToMarkdown(editor.getHTML())).toContain("Before[^1] after");
});
