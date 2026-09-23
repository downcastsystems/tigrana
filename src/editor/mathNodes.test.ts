// @vitest-environment jsdom
import * as math from "../lib/math";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineMath, BlockMath } from "./mathNodes";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { mathExamples, moreMathExamples, renderMath } from "../lib/math";
import { buildNoteExportHtml } from "../lib/exportNote";

const editors: Editor[] = [];
function editorFor(markdown: string) {
  const editor = new Editor({ extensions: [StarterKit, InlineMath, BlockMath], content: markdownToHtml(markdown) });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
describe("equations", () => {
  it.each(math.mathSizes)("preserves $label sizing in inline and block Markdown", ({ value }) => {
    const latex = math.withMathSize(String.raw`\frac{a}{b}`, value);
    expect(math.splitMathSize(latex)).toEqual({ latex: String.raw`\frac{a}{b}`, size: value });
    for (const markdown of [`Before $${latex}$ after`, `$$\n${latex}\n$$`]) {
      expect(htmlToMarkdown(editorFor(markdown).getHTML()).trim()).toBe(markdown);
    }
  });
  it("keeps manually sized terms intact and recognizes escaped braces", () => {
    const partial = String.raw`{\small x} + {y}`;
    expect(math.splitMathSize(partial)).toEqual({ latex: partial, size: "normal" });
    const latex = String.raw`\left\{\frac{x}{y}\right\}`;
    expect(math.splitMathSize(math.withMathSize(latex, "small"))).toEqual({ latex, size: "small" });
  });
  it.each(mathExamples)("round-trips $label as inline and block math", ({ latex }) => {
    for (const markdown of [`Before $${latex}$ after`, `$$\n${latex}\n$$`]) {
      const editor = editorFor(markdown);
      const saved = htmlToMarkdown(editor.getHTML()).trim();
      expect(saved).toBe(markdown);
      expect(editorFor(saved).getJSON()).toEqual(editor.getJSON());
      expect(editor.view.dom.querySelector(".katex")).not.toBeNull();
    }
  });
  it.each(moreMathExamples.flatMap(group => group.examples))("renders and round-trips the $label example", ({ latex }) => {
    expect(() => renderMath(latex, true)).not.toThrow();
    const markdown = `$$\n${latex}\n$$`;
    expect(htmlToMarkdown(editorFor(markdown).getHTML()).trim()).toBe(markdown);
  });
  it("protects math from emphasis, HTML, and link processing", () => {
    const latex = String.raw`x_1 * x_2 < y \text{[a](b)} + \text{"quoted"}`;
    const editor = editorFor(`$${latex}$`);
    expect(editor.state.doc.firstChild!.firstChild!.attrs.latex).toBe(latex);
    expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(`$${latex}$`);
  });
  it.each(["Costs $5 and $10", String.raw`Escaped \$x\$`, "`$x^2$`", "```tex\n$$\nx^2\n$$\n```", "$$\nunclosed", "A $ with no pair"])("leaves literal text and code alone: %s", markdown => {
    const editor = editorFor(markdown);
    expect(editor.view.dom.querySelector(".note-equation")).toBeNull();
    expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(markdown === "$$\nunclosed" ? "$$\n\nunclosed" : markdown);
  });
  it("accepts single-line display delimiters and multiline formulas", () => {
    expect(htmlToMarkdown(editorFor("$$x^2$$").getHTML()).trim()).toBe("$$\nx^2\n$$");
    const multiline = "$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$";
    expect(htmlToMarkdown(editorFor(multiline).getHTML()).trim()).toBe(multiline);
  });
  it("keeps invalid imported formulas editable and does not execute trusted HTML commands", () => {
    const editor = editorFor("$\\notACommand{x}$");
    expect(editor.view.dom.querySelector(".note-equation")?.textContent).toBe("\\notACommand{x}");
    expect(htmlToMarkdown(editor.getHTML()).trim()).toBe("$\\notACommand{x}$");
    expect(renderMath(String.raw`\href{javascript:alert(1)}{click}`, false)).not.toContain('href="javascript:');
  });
  it("does not rerender equations during ordinary typing in a long note", () => {
    const render = vi.spyOn(math, "renderMath");
    const editor = editorFor(Array.from({ length: 200 }, () => "$x^2$").join("\n\n") + "\n\nType here");
    const count = render.mock.calls.length;
    expect(count).toBe(200);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    for (const letter of " more words") editor.view.dispatch(editor.state.tr.insertText(letter));
    expect(render.mock.calls.length).toBe(count);
    render.mockRestore();
  });
  it("does not interpret dollar signs in link destinations", () => {
    const editor = editorFor("[Link](https://example.com/$foo$)");
    expect(editor.view.dom.querySelector(".note-equation")).toBeNull();
    expect(editor.getHTML()).toContain('href="https://example.com/$foo$"');
  });
  it("selects the whole equation on pointer down instead of individual rendered symbols", () => {
    const editor = editorFor("Before\n\n$$\n\\frac{1}{2} + x^2\n$$\n\nAfter");
    const equation = editor.view.dom.querySelector<HTMLElement>(".note-equation")!;
    const symbol = equation.querySelector(".mord")!;
    const event = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    symbol.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.selection.to - editor.state.selection.from).toBe(1);
    expect(editor.state.doc.nodeAt(editor.state.selection.from)?.type.name).toBe("blockMath");
    expect(equation.classList.contains("ProseMirror-selectednode")).toBe(true);
    editor.commands.setTextSelection(1);
    expect(equation.classList.contains("ProseMirror-selectednode")).toBe(false);
  });
  it("includes rendered equations in standalone exports", async () => {
    const html = await buildNoteExportHtml("Math", "$x^2$\n\n$$\n\\frac{1}{2}\n$$");
    expect(html).toContain("<math");
    expect(html).toContain("<mfrac>");
  });
});

function resizePointer(target: EventTarget, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
it("previews a dragged block size and saves it as one undoable Markdown change", () => {
  const editor = editorFor("$$\nx^2\n$$");
  const handle = editor.view.dom.querySelector<HTMLButtonElement>('.equation-resize-handle')!;
  const opened = vi.fn(); editor.view.dom.addEventListener('tigrana-edit-equation', opened);
  resizePointer(handle, 'pointerdown', 100);
  resizePointer(document, 'pointermove', 196);
  expect(editor.state.doc.firstChild!.attrs.latex).toBe('x^2');
  expect(handle.getAttribute('aria-valuetext')).toBe('Extra large');
  resizePointer(document, 'pointerup', 196);
  expect(editor.state.doc.firstChild!.attrs.latex).toBe(math.withMathSize('x^2', 'Large'));
  editor.view.dom.querySelector<HTMLElement>('.note-equation')!.click();
  expect(opened).not.toHaveBeenCalled();
  const markdown = htmlToMarkdown(editor.getHTML());
  expect(editorFor(markdown).state.doc.firstChild!.attrs.latex).toBe(math.withMathSize('x^2', 'Large'));
  editor.commands.undo();
  expect(editor.state.doc.firstChild!.attrs.latex).toBe('x^2');
});
it("cancels resizing on Escape and note replacement, and prevents read-only changes", () => {
  const editor = editorFor("$$\nx\n$$");
  const handle = editor.view.dom.querySelector<HTMLButtonElement>('.equation-resize-handle')!;
  resizePointer(handle, 'pointerdown', 100); resizePointer(document, 'pointermove', 4);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  resizePointer(document, 'pointerup', 4);
  expect(editor.state.doc.firstChild!.attrs.latex).toBe('x');
  resizePointer(handle, 'pointerdown', 100); resizePointer(document, 'pointermove', 196);
  editor.commands.setContent('<p>Other note</p>');
  resizePointer(document, 'pointerup', 196);
  expect(editor.getText()).toBe('Other note');
  const readonly = editorFor("$$\nx\n$$"); readonly.setEditable(false);
  const grip = readonly.view.dom.querySelector<HTMLButtonElement>('.equation-resize-handle')!;
  resizePointer(grip, 'pointerdown', 100); resizePointer(document, 'pointermove', 196); resizePointer(document, 'pointerup', 196);
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(readonly.state.doc.firstChild!.attrs.latex).toBe('x');
});
