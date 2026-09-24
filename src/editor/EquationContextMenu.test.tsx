// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { EquationContextMenu } from "./EquationContextMenu";
import { InlineMath, BlockMath } from "./mathNodes";
import { markdownToHtml, htmlToMarkdown } from "../lib/markdown";
import { writeRichClipboard } from "../lib/richClipboard";
vi.mock("../lib/richClipboard", () => ({ writeRichClipboard: vi.fn().mockResolvedValue(undefined) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let editor: Editor, root: Root, host: HTMLDivElement, mount: HTMLDivElement;
async function setup(markdown = "Before $x^2$ after\n\n$$\n\\frac{1}{2}\n$$", readOnly = false) {
  vi.mocked(writeRichClipboard).mockResolvedValue(undefined);
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  host = document.createElement("div"); mount = document.createElement("div"); document.body.append(host, mount);
  editor = new Editor({ element: host, extensions: [StarterKit, InlineMath, BlockMath], content: markdownToHtml(markdown), editable: !readOnly });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 10 });
  root = createRoot(mount);
  await act(async () => root.render(<EquationContextMenu editor={editor} disabled={readOnly} />));
}
afterEach(async () => { await act(async () => root?.unmount()); editor?.destroy(); host?.remove(); mount?.remove(); vi.clearAllMocks(); vi.restoreAllMocks(); });
async function open(index = 0) {
  await act(async () => host.querySelectorAll('.note-equation')[index].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
it("copies the right-clicked equation with Markdown and rich HTML, leaving it intact", async () => {
  await setup(); await open(1); const before = editor.getJSON(); await click("Copy");
  const [html, text] = vi.mocked(writeRichClipboard).mock.calls[0];
  expect(text).toBe("$$\n\\frac{1}{2}\n$$"); expect(html).toContain('data-type="blockMath"');
  const pasted = new Editor({ extensions: [StarterKit, InlineMath, BlockMath], content: html });
  expect(pasted.state.doc.firstChild!.attrs.latex).toBe("\\frac{1}{2}"); pasted.destroy();
  expect(editor.getJSON()).toEqual(before);
});
it("deletes only the inline equation and can undo it", async () => {
  await setup(); await open(); const before = editor.getJSON(); await click("Delete");
  expect(htmlToMarkdown(editor.getHTML())).toContain("Before  after");
  expect(editor.view.dom.querySelectorAll('.note-equation')).toHaveLength(1);
  editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
});
it("cuts the final block equation into an editable empty document", async () => {
  await setup("$$\nx^2\n$$"); await open(); await click("Cut");
  expect(writeRichClipboard).toHaveBeenCalledOnce(); expect(editor.isEmpty).toBe(true);
  editor.commands.undo(); expect(editor.view.dom.querySelector('.note-equation')).not.toBeNull();
});
it("does not delete when clipboard writing fails", async () => {
  await setup(); await open(); const before = editor.getJSON(); vi.mocked(writeRichClipboard).mockRejectedValue(new Error("denied"));
  await click("Cut"); expect(editor.getJSON()).toEqual(before);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not copy");
});
it("does not apply a delayed cut to a different note", async () => {
  await setup(); let finish!: () => void;
  vi.mocked(writeRichClipboard).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await open(); await click("Cut");
  await act(async () => editor.commands.setContent("<p>Another note</p>"));
  await act(async () => finish()); expect(editor.getText()).toBe("Another note");
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
it("allows copying but disables destructive actions in read-only notes", async () => {
  await setup("$x^2$", true); await open();
  expect(button("Cut").disabled).toBe(true); expect(button("Delete").disabled).toBe(true);
  expect(button("Copy").disabled).toBe(false); await click("Copy"); expect(writeRichClipboard).toHaveBeenCalledOnce();
});
