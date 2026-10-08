/** Find the closest vertically laid-out child without reading every row in a long note. */
function nearestChild(children: HTMLCollection | Element[], y: number): Element | null {
  let low = 0, high = children.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (children[middle].getBoundingClientRect().bottom < y) low = middle + 1;
    else high = middle;
  }
  const next = children[low], previous = children[low - 1];
  if (!next) return previous ?? null;
  if (!previous) return next;
  const nextRect = next.getBoundingClientRect(), previousRect = previous.getBoundingClientRect();
  return Math.max(0, nextRect.top - y) <= Math.max(0, y - previousRect.bottom) ? next : previous;
}

export type ListDragRow = { item: HTMLElement; content: Element; block: Element };
export type VerticalDragHit = { block: Element; row?: ListDragRow };

/** Resolve text and gutter to the same visible row, regardless of pointer X. */
export function listDragHitAtY(editor: HTMLElement, y: number): VerticalDragHit | null {
  const block = nearestChild(editor.children, y);
  if (!block || block.getBoundingClientRect().height === 0) return null;
  let content = block;
  let item: HTMLElement | undefined;
  for (;;) {
    if (content.matches('li')) {
      item = content as HTMLElement;
      // View-only buttons occupy the gutter; they aren't document rows.
      const ownBlocks = [...content.children].filter(child => !child.matches('button, .ProseMirror-widget') && child.getBoundingClientRect().height > 0);
      const child = nearestChild(ownBlocks, y);
      if (!child) break;
      content = child;
    } else if (content.matches('ul, ol, blockquote')) {
      const child = nearestChild(content.children, y);
      if (!child || child.getBoundingClientRect().height === 0) break;
      content = child;
    } else break;
  }
  return { block, row: item ? { item, content, block } : undefined };
}
