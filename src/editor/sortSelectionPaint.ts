import type { EditorView } from "@tiptap/pm/view";

/** WebKit can retain an unselected renderer for a list item moved by sorting. */
export function refreshSortedSelectionPaint(view: EditorView) {
  const win = view.dom.ownerDocument.defaultView;
  if (!win || !/AppleWebKit/.test(win.navigator.userAgent) || /Chrome|Chromium|Edg\//.test(win.navigator.userAgent)) return;
  if (view.state.selection.empty) return;

  // Reapplying the DOM range does not repair WebKit's stale selection paint.
  // Rebuild its renderers synchronously, before another frame can be painted.
  // Keep the ProseMirror document, selection, history and DOM nodes intact.
  const scroll: Array<{ element: HTMLElement; top: number; left: number }> = [];
  for (let element: HTMLElement | null = view.dom; element; element = element.parentElement) {
    scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
  }
  const display = view.dom.style.getPropertyValue("display");
  const priority = view.dom.style.getPropertyPriority("display");
  try {
    view.dom.style.setProperty("display", "none", "important");
    void view.dom.offsetHeight;
  } finally {
    if (display) view.dom.style.setProperty("display", display, priority);
    else view.dom.style.removeProperty("display");
    // Restore layout before scroll offsets, including when the editor was
    // near the bottom of a long note and hiding it clamped the scroll range.
    void view.dom.offsetHeight;
    for (const { element, top, left } of scroll) {
      if (element.scrollTop !== top) element.scrollTop = top;
      if (element.scrollLeft !== left) element.scrollLeft = left;
    }
  }
}
