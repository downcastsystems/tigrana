// @vitest-environment jsdom
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { EditorColorControls } from "./InlineColorPicker";
import { ColorHighlight, TextColor } from "./inlineColorMarks";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { FormattingBubbleMenu } = await import("./NotesEditor");
let editor: Editor, root: Root, host: HTMLDivElement, mount: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  editor?.destroy(); host?.remove(); mount?.remove();
  vi.restoreAllMocks(); vi.useRealTimers();
});
async function setup() {
  vi.useFakeTimers();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  host = document.createElement("div"); mount = document.createElement("div");
  document.body.append(host, mount);
  editor = new Editor({ element: host, extensions: [StarterKit, TextColor, ColorHighlight], content: "<p>Selected text</p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 200, bottom: 220, left: 300, right: 310 });
  root = createRoot(mount);
  await act(async () => {
    root.render(<FormattingBubbleMenu editor={editor} />);
    editor.commands.setTextSelection({ from: 1, to: 9 });
    editor.view.focus();
  });
  await act(async () => vi.advanceTimersByTime(100));
}
async function click(button: HTMLButtonElement) {
  expect(button).not.toBeNull();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    button.click();
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}
async function open() {
  await click(document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!);
  expect(document.querySelector('.inline-color-palette')).not.toBeNull();
}
function choice(group: string, label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)]
    .find(button => button.textContent === `A${label}`)!;
}

it("keeps the formatting bar open while the palette owns focus and applies colors to the original range", async () => {
  await setup(); await open();
  expect(document.activeElement).toBe(choice("Text color", "Automatic"));
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(9);
  await click(choice("Text color", "Red"));
  expect(editor.getAttributes("textColor").color).toBe("#a83232");
  expect(editor.state.doc.firstChild!.lastChild!.marks).toHaveLength(0);
  await act(async () => vi.advanceTimersByTime(30));
  await open(); await click(choice("Highlight color", "Green"));
  expect(editor.getAttributes("highlight").color).toBe("#dcecdf");
  expect(editor.getAttributes("textColor").color).toBe("#a83232");
});

it("supports arrow keys and returns focus to the selection on Escape", async () => {
  await setup(); await open();
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(choice("Text color", "Gray"));
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.advanceTimersByTime(30);
  });
  expect(document.querySelector('.inline-color-palette')).toBeNull();
  expect(editor.isFocused).toBe(true);
  expect(editor.state.selection.to).toBe(9);
});

it("dismisses a palette when the note content changes, even if the range stays the same", async () => {
  await setup(); await open();
  await act(async () => editor.commands.setContent("<p>Different note</p>"));
  expect(document.querySelector('.inline-color-palette')).toBeNull();
  expect(editor.getHTML()).not.toContain("data-text-color");
});


it("exposes persistent controls at the caret and resets only future typing", async () => {
  await setup();
  let renders = 0;
  await act(async () => {
    root.render(<Profiler id="colors" onRender={() => renders++}><EditorColorControls editor={editor} /></Profiler>);
    editor.commands.setTextSelection(14);
  });
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Text and highlight colors"]')!);
  await click(choice("Text color", "Red"));
  expect(document.querySelectorAll('.editor-color-controls button')).toHaveLength(1);
  const beforeTyping = renders;
  await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" red")); });
  await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" again")); });
  expect(renders).toBe(beforeTyping);
  expect(document.querySelector('.editor-color-controls button')?.classList.contains("is-active")).toBe(true);
  await open();
  await click(choice("Text color", "Automatic"));
  await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" plain")); });
  expect(document.querySelector('.editor-color-controls button')?.classList.contains("is-active")).toBe(false);
  const nodes = editor.state.doc.firstChild!.content.content;
  expect(nodes.map(node => node.text)).toEqual(["Selected text", " red again", " plain"]);
  expect(nodes.map(node => node.marks.map(mark => mark.type.name))).toEqual([[], ["textColor"], []]);
});

it("clears the highlight indicator on Enter and disables controls for read-only notes", async () => {
  await setup();
  await act(async () => {
    root.render(<EditorColorControls editor={editor} />);
    editor.commands.setTextSelection(14);
  });
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Text and highlight colors"]')!);
  await click(choice("Highlight color", "Green"));
  await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" highlighted")); });
  expect(document.querySelector('.editor-color-controls button')?.classList.contains("is-active")).toBe(true);
  await act(async () => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    editor.view.someProp("handleKeyDown", handler => handler(editor.view, event));
    editor.view.dispatch(editor.state.tr.insertText("Plain"));
  });
  expect(document.querySelector('.editor-color-controls button')?.classList.contains("is-active")).toBe(false);
  expect(editor.state.doc.lastChild!.firstChild!.marks).toEqual([]);
  await act(async () => {
    editor.setEditable(false);
    root.render(<EditorColorControls editor={editor} disabled />);
  });
  expect([...document.querySelectorAll<HTMLButtonElement>('.editor-color-controls button')].every(button => button.disabled)).toBe(true);
});
