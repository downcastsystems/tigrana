// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { formattingSelectionAnchor } from "./formattingSelectionAnchor";
afterEach(() => { vi.restoreAllMocks(); });
function anchor(rectangles: Array<[number, number, number, number]>) {
  const dom = document.createElement("div");
  const text = document.createTextNode("Selected words"); dom.append(text);
  const range = document.createRange();
  Object.defineProperty(range, "getClientRects", { value: () => rectangles.map(([left, top, width, height]) => ({ left, right: left + width, top, bottom: top + height, width, height })) });
  vi.spyOn(document, "createRange").mockReturnValue(range);
  const view = { dom, domAtPos: (pos: number) => ({ node: text, offset: pos }), coordsAtPos: () => ({ left: 600, right: 600, top: 100, bottom: 120 }) } as unknown as EditorView;
  return formattingSelectionAnchor(view, 0, text.length);
}
it("uses the selected glyphs instead of a full-width inline box", () => {
  expect(anchor([[100, 100, 800, 20], [150, 100, 90, 20]])).toMatchObject({ left: 195 });
});
it("anchors a wrapped selection to the adjacent first or last selected line", () => {
  expect(anchor([[500, 100, 100, 20], [100, 120, 220, 20], [100, 140, 80, 20]])).toEqual({ top: 100, bottom: 160, left: 550, belowLeft: 140 });
});
