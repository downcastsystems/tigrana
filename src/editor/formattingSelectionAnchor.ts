import type { EditorView } from "@tiptap/pm/view";

/** Anchor to the selected glyphs on the line next to the toolbar. */
export function formattingSelectionAnchor(view: EditorView, from: number, to: number) {
  try {
    const start = view.domAtPos(from, 1);
    const end = view.domAtPos(to, -1);
    const range = view.dom.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length) {
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      // A range can include both a block's box and its text fragments. Use the
      // shortest boxes at each edge so full-width blocks don't center the bar.
      const firstBottom = Math.min(...rects.filter(rect => Math.abs(rect.top - top) < 1).map(rect => rect.bottom));
      const lastTop = Math.max(...rects.filter(rect => Math.abs(rect.bottom - bottom) < 1).map(rect => rect.top));
      const firstLine = rects.filter(rect => rect.top < firstBottom && rect.bottom <= firstBottom + 1);
      const lastLine = rects.filter(rect => rect.bottom > lastTop && rect.top >= lastTop - 1);
      const center = (line: DOMRect[]) => {
        const fragments = line.filter(rect => !line.some(inner => inner.width < rect.width
          && inner.left >= rect.left && inner.right <= rect.right));
        return (Math.min(...fragments.map(rect => rect.left)) + Math.max(...fragments.map(rect => rect.right))) / 2;
      };
      return { top, bottom, left: center(firstLine), belowLeft: center(lastLine) };
    }
  } catch { /* Fall back when a browser cannot measure the DOM range. */ }
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  const left = (start.left + end.left) / 2;
  return { top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom), left, belowLeft: left };
}
