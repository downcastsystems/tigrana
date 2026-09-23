// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { EquationDialog } from "./EquationDialog";
import { InlineMath, BlockMath, requestEquation } from "./mathNodes";
import { htmlToMarkdown } from "../lib/markdown";
import { mathExamples, moreMathExamples } from "../lib/math";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let editor: Editor, root: Root, mount: HTMLDivElement, host: HTMLDivElement;
async function setup() {
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  host = document.createElement("div"); mount = document.createElement("div"); document.body.append(host, mount);
  editor = new Editor({ element: host, extensions: [StarterKit, InlineMath, BlockMath], content: "<p>Before after</p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 10 });
  root = createRoot(mount);
  await act(async () => root.render(<EquationDialog editor={editor} disabled={false} />));
  editor.commands.setTextSelection(8);
}
afterEach(async () => {
  await act(async () => root?.unmount()); editor?.destroy(); host?.remove(); mount?.remove(); vi.restoreAllMocks();
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
it("previews examples, inserts inline math at the original cursor, and edits with undo", async () => {
  await setup();
  await act(async () => requestEquation(editor, { block: false }));
  expect(document.querySelector('.equation-preview .katex')).not.toBeNull();
  await click("Powers"); await click("Insert equation");
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe("Before $x^2 + y^2 = z^2$after");
  await act(async () => (host.querySelector('.note-equation') as HTMLElement).click());
  expect(document.querySelector('[aria-label="Edit equation"]')).not.toBeNull();
  await click("Square root"); await click("Save equation");
  expect(editor.state.doc.firstChild!.child(1).attrs.latex).toBe(mathExamples[3].latex);
  await act(async () => { editor.commands.undo(); });
  expect(editor.state.doc.firstChild!.child(1).attrs.latex).toBe(mathExamples[2].latex);
});
it("cancels without changing content and dismisses on note replacement", async () => {
  await setup(); const original = editor.getJSON();
  await act(async () => requestEquation(editor));
  await click("Cancel"); expect(editor.getJSON()).toEqual(original);
  await act(async () => requestEquation(editor));
  await act(async () => editor.commands.setContent("<p>Another note</p>"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("does not open in read-only notes", async () => {
  await setup(); editor.setEditable(false);
  await act(async () => requestEquation(editor));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("saves a size, restores it when editing, and removes it on Normal", async () => {
  await setup();
  await act(async () => requestEquation(editor, { block: false }));
  await click("Powers");
  const resize = async (size: string) => {
    await act(async () => {
      const select = document.querySelector<HTMLSelectElement>('[aria-label="Equation size"]')!;
      select.value = size; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  await resize("tiny");
  expect(document.querySelector('.equation-preview .size1')).not.toBeNull();
  await click("Insert equation");
  expect(htmlToMarkdown(editor.getHTML())).toContain("$" + String.raw`{\tiny x^2 + y^2 = z^2 }` + "$");
  await act(async () => (host.querySelector('.note-equation') as HTMLElement).click());
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Equation size"]')!.value).toBe("tiny");
  expect(document.querySelector('textarea')!.value).toBe(mathExamples[2].latex);
  await resize("normal"); await click("Save equation");
  expect(editor.state.doc.firstChild!.child(1).attrs.latex).toBe(mathExamples[2].latex);
});

it("uses inline equations inside lists so nested Markdown round-trips", async () => {
  await setup();
  editor.commands.setContent("<ul><li><p>Item</p></li></ul>");
  editor.commands.setTextSelection(7);
  await act(async () => requestEquation(editor));
  expect((document.querySelector('select') as HTMLSelectElement).value).toBe("inline");
  await click("Powers"); await click("Insert equation");
  expect(htmlToMarkdown(editor.getHTML()).trim()).toContain("- Item$x^2 + y^2 = z^2$");
});

it("maximizes and restores without losing edits, and loads the advanced heat equation", async () => {
  await setup(); const before = editor.getJSON();
  await act(async () => requestEquation(editor, { block: false }));
  await click("Powers");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Maximize equation dialog"]')!.click());
  expect(document.querySelector('.equation-dialog.is-maximized')).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Restore equation dialog size"]')!.click());
  expect(document.querySelector('.equation-dialog.is-maximized')).toBeNull();
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(mathExamples[2].latex);
  await click("More examples"); await click("Advanced"); await click("Heat equation on a rod");
  expect(document.querySelector('.equation-dialog.is-maximized')).not.toBeNull();
  expect((document.querySelector('select') as HTMLSelectElement).value).toBe("block");
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(moreMathExamples.at(-1)!.examples[0].latex);
  expect(document.querySelector('.equation-preview .katex')).not.toBeNull();
  expect(document.querySelector('[aria-label="More equation examples"]')).toBeNull();
  await click("Cancel"); expect(editor.getJSON()).toEqual(before);
});

it("loads an Algebra example on the first click with macOS button focus behavior", async () => {
  await setup();
  await act(async () => requestEquation(editor));
  await click("More examples"); await click("Algebra and geometry");
  const option = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Algebra and geometry"] button')]
    .find(button => button.textContent === "Pythagorean theorem")!;
  await act(async () => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    if (!down.defaultPrevented) (document.activeElement as HTMLElement).blur();
  });
  await act(async () => { if (option.isConnected) option.click(); });
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
    moreMathExamples[0].examples.find(example => example.label === "Pythagorean theorem")!.latex,
  );
  expect(document.querySelector('[aria-label="More equation examples"]')).toBeNull();
});
