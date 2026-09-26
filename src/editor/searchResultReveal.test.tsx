// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findDocumentSearchPassage, searchResultRevealKey, type SearchRevealRequest } from "./searchResultReveal";
import { useRawSearchResultReveal } from "./useRawSearchResultReveal";
import { useRef } from "react";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
Object.defineProperty(window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
const { NotesEditor } = await import("./NotesEditor");

let root: Root;
let container: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const scrollTo = vi.fn();
const onChange = vi.fn();
const request = (id = 1, query = "Page 777"): SearchRevealRequest => ({ id, query, workspace: "/Notebook", notePath: "Large.md" });
const editor = () => (container.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;
const highlighted = () => container.querySelector(".search-result-reveal");
async function flushFrames() {
  for (let i = 0; i < 5; i++) await act(async () => {
    const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(i * 16));
  });
}
async function render(reveal: SearchRevealRequest | null, path = "Large.md", content = "## Page 77\n\nBefore\n\n## Page **777**\n\nAfter") {
  await act(async () => root.render(<StrictMode><section className="note-surface"><NotesEditor
    content={content} editable findRequest={0} focusAtEndRequest={0} focusRequest={1}
    historyKey={path} notePath={path} onChange={onChange} onLoadError={error => { throw error; }}
    onPendingChange={() => undefined} onPositionChange={() => undefined}
    restorePosition={null} spellcheckEnabled workspace="/Notebook" searchRevealRequest={reveal} />
  </section></StrictMode>));
}
beforeEach(() => {
  frames = new Map(); frameId = 0; scrollTo.mockClear(); onChange.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("opening a notebook search match", () => {
  it("jumps across inline marks, sets a caret, and does not change or save the document", async () => {
    await render(request());
    const doc = editor().state.doc;
    await flushFrames();
    expect(container.querySelectorAll(".search-result-reveal").length).toBeGreaterThan(0);
    expect([...container.querySelectorAll(".search-result-reveal")].map(node => node.textContent).join("")).toBe("Page 777");
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
    expect(editor().state.selection.empty).toBe(true);
    expect(editor().state.doc).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => container.querySelector(".note-surface")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(highlighted()).toBeNull();
  });

  it("cancels a queued jump on interaction and on a rapid note switch", async () => {
    await render(request());
    await act(async () => container.querySelector(".note-surface")!.dispatchEvent(new Event("wheel", { bubbles: true })));
    await flushFrames();
    expect(highlighted()).toBeNull(); expect(scrollTo).not.toHaveBeenCalled();
    await render(request(2));
    await render(request(2), "Other.md", "## Page 777");
    await flushFrames();
    expect(highlighted()).toBeNull(); expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not revive a cached highlight and allows searching the same note again", async () => {
    await render(request()); await flushFrames(); expect(highlighted()).not.toBeNull();
    await render(null, "Other.md", "Other"); await flushFrames();
    await render(null); await flushFrames(); expect(highlighted()).toBeNull();
    await render(request(2)); await flushFrames(); expect(highlighted()).not.toBeNull();
    await act(async () => editor().view.dispatch(editor().state.tr.insertText("x")));
    expect(searchResultRevealKey.getState(editor().state)?.find()).toEqual([]);
  });

  it("keeps numeric prefix direction and exact-match preference", async () => {
    await render(null, "Large.md", "## Page 777\n\n## Page 77");
    const doc = editor().state.doc;
    const exact = findDocumentSearchPassage(doc, "Page 77")!;
    expect(doc.textBetween(exact.from, exact.to)).toBe("Page 77");
    expect(exact.from).toBeGreaterThan(10);
    expect(findDocumentSearchPassage(doc, "Page 7777")).toBeNull();
    const prefix = findDocumentSearchPassage(doc, "Page 7")!;
    expect(doc.textBetween(prefix.from, prefix.to)).toBe("Page 7");
  });

  it("finds a deep large-note heading and a misspelled word", async () => {
    await render(null, "Large.md", Array.from({ length: 1000 }, (_, i) => `## Page ${i + 1}\n\nNotebook evidence.`).join("\n\n"));
    const doc = editor().state.doc;
    const match = findDocumentSearchPassage(doc, "Page 777")!;
    expect(doc.textBetween(match.from, match.to)).toBe("Page 777");
    expect(match.from).toBeGreaterThan(doc.content.size * 0.7);
    expect(findDocumentSearchPassage(doc, "notebok")).not.toBeNull();
  });

  it("leaves the position alone when there is no body match", async () => {
    await render(request(1, '"Only in the title"')); await flushFrames();
    expect(highlighted()).toBeNull(); expect(scrollTo).not.toHaveBeenCalled();
  });

  it("highlights raw Markdown without allowing the next key to replace the match", async () => {
    function Raw() {
      const ref = useRef<HTMLTextAreaElement>(null);
      const reveal = useRef(request()).current;
      useRawSearchResultReveal(ref, true, reveal, "/Notebook", "Large.md");
      return <textarea ref={ref} defaultValue={"## Page 77\n\n## Page 777\n"} />;
    }
    await act(async () => root.render(<Raw />)); await flushFrames();
    const input = container.querySelector("textarea")!;
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe("Page 777");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true })));
    expect(input.selectionStart).toBe(input.selectionEnd);
  });
});
