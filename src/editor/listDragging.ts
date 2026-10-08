import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { listDragHitAtY } from "./listDragGeometry";
import { bulletMoveHighlightKey } from "./bulletMoveHighlight";

export type ListDropTarget = { pos: number; listPos?: number };

function listMovePlan(state: EditorState, sourcePos: number, target: ListDropTarget) {
  if (sourcePos < 0 || sourcePos >= state.doc.content.size || target.pos < 0 || target.pos > state.doc.content.size) return null;
  const item = state.doc.nodeAt(sourcePos);
  const $source = state.doc.resolve(sourcePos);
  const list = $source.parent;
  if (item?.type.name !== "listItem" || !["bulletList", "orderedList"].includes(list.type.name)) return null;
  const end = sourcePos + item.nodeSize;
  if (target.pos >= sourcePos && target.pos <= end) return null;
  if (target.listPos !== undefined && target.listPos >= sourcePos && target.listPos < end) return null;
  if (target.listPos !== undefined && (target.listPos < 0 || target.listPos >= state.doc.content.size)) return null;
  const destination = target.listPos === undefined ? null : state.doc.nodeAt(target.listPos);
  if (destination && !["bulletList", "orderedList"].includes(destination.type.name)) return null;
  if (target.listPos !== undefined && !destination) return null;
  const $target = state.doc.resolve(target.pos);
  const moved = destination ? item : list.type.create(list.attrs, item);
  if (destination && $target.parent !== destination) return null;
  if (!$target.parent.canReplaceWith($target.index(), $target.index(), moved.type)) return null;

  // Remove an empty source list rather than leaving a phantom blank bullet.
  const from = list.childCount === 1 ? $source.before() : sourcePos;
  const to = list.childCount === 1 ? from + list.nodeSize : end;
  return { from, to, moved };
}

/** Move the actual item node, including every child, in one undoable edit. */
export function moveListItem(state: EditorState, sourcePos: number, target: ListDropTarget) {
  const plan = listMovePlan(state, sourcePos, target);
  if (!plan) return null;
  const tr = closeHistory(state.tr).delete(plan.from, plan.to);
  const pos = tr.mapping.map(target.pos);
  const $insert = tr.doc.resolve(pos);
  if (!$insert.parent.canReplaceWith($insert.index(), $insert.index(), plan.moved.type)) return null;
  tr.insert(pos, plan.moved);
  tr.setMeta(bulletMoveHighlightKey, pos + (target.listPos !== undefined ? 1 : 2));
  tr.setSelection(Selection.near(tr.doc.resolve(pos + (target.listPos !== undefined ? 2 : 3))));
  return tr;
}

type VisualTarget = { target: ListDropTarget; left: number; top: number; width: number };
type HoverItem = { element: HTMLElement; pos: number };

function appZoom() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("zoom");
  const scale = parseFloat(value) / (value.endsWith("%") ? 100 : 1);
  return scale > 0 ? scale : 1;
}

/** One floating control: no list traversal, decorations, or React updates while typing. */
class ListDragView {
  private handle = document.createElement("button");
  private indicator = document.createElement("div");
  private hovered: HoverItem | null = null;
  private hoveredFoldButton: HTMLElement | null = null;
  private cancelDrag: (() => void) | null = null;
  private surface: HTMLElement;

  constructor(private view: EditorView) {
    this.surface = view.dom.closest<HTMLElement>(".note-surface") ?? view.dom;
    this.handle.type = "button";
    this.handle.className = "list-drag-handle";
    this.handle.setAttribute("aria-label", "Drag bullet and sub-bullets to move");
    this.handle.title = "Drag to move bullet and sub-bullets";
    this.handle.draggable = false;
    this.handle.hidden = true;
    this.indicator.className = "list-drag-indicator";
    this.indicator.hidden = true;
    this.indicator.setAttribute("aria-hidden", "true");
    document.body.append(this.handle, this.indicator);
    document.addEventListener("pointermove", this.hover);
    this.surface.addEventListener("pointerleave", this.leave);
    this.handle.addEventListener("pointerdown", this.start);
    this.handle.addEventListener("pointerleave", this.leave);
    this.handle.addEventListener("mousedown", this.preventDefault);
    this.handle.addEventListener("dragstart", this.preventDefault);
    this.handle.addEventListener("contextmenu", this.preventDefault);
    this.handle.addEventListener("wheel", this.scrollFromHandle, { passive: false });
    document.addEventListener("scroll", this.hide, true);
    window.addEventListener("resize", this.hide);
  }

  private preventDefault = (event: Event) => event.preventDefault();
  private scrollFromHandle = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) return;
    // The fixed grip lives on body, outside the note's native scroll chain.
    // Route its wheel gestures to the same pane as the surrounding gutter.
    const style = getComputedStyle(this.view.dom);
    const line = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 17) * 1.72;
    const unitX = event.deltaMode === 1 ? line : event.deltaMode === 2 ? this.surface.clientWidth : 1;
    const unitY = event.deltaMode === 1 ? line : event.deltaMode === 2 ? this.surface.clientHeight : 1;
    event.preventDefault();
    this.surface.scrollLeft += event.deltaX * unitX;
    this.surface.scrollTop += event.deltaY * unitY;
  };
  private setHovered(item: HoverItem | null) {
    // List items belong to ProseMirror's document DOM: changing their class
    // makes its observer redraw the row. Widget attributes are view-only and
    // ignored by that observer, so the caret keeps this hover state intact.
    const button = item?.element.querySelector<HTMLElement>(":scope > .list-fold-button") ?? null;
    if (this.hoveredFoldButton !== button) {
      this.hoveredFoldButton?.classList.remove("is-list-drag-hovered");
      button?.classList.add("is-list-drag-hovered");
      this.hoveredFoldButton = button;
    }
    this.hovered = item;
  }
  private hide = () => { if (!this.cancelDrag) { this.handle.hidden = true; this.setHovered(null); } };
  private leave = (event: PointerEvent) => {
    if (event.relatedTarget !== this.handle) this.hide();
  };

  private itemAt(element: Element | null): HoverItem | null {
    const li = element?.closest<HTMLElement>("li");
    if (!li || !this.view.dom.contains(li)) return null;
    const pos = this.view.posAtDOM(li, 0) - 1;
    return this.view.state.doc.nodeAt(pos)?.type.name === "listItem" ? { element: li, pos } : null;
  }

  private hover = (event: PointerEvent) => {
    if (this.cancelDrag || event.buttons) return;
    this.followSurface();
    if (!(event.target instanceof Node) || (event.target !== this.handle && !this.surface.contains(event.target))) { this.hide(); return; }
    this.showAt(event.clientX, event.clientY);
  };

  private showAt(x: number, y: number) {
    if (!this.view.editable) { this.hide(); return; }
    const row = listDragHitAtY(this.view.dom, y)?.row;
    const item = row && this.itemAt(row.item);
    const paragraph = item?.element.querySelector<HTMLElement>(":scope > p");
    if (!item || !paragraph || !row) { this.hide(); return; }
    const rect = paragraph.getBoundingClientRect();
    const style = getComputedStyle(paragraph);
    const zoom = appZoom();
    const fontSize = parseFloat(style.fontSize) || 17;
    const lineHeight = (parseFloat(style.lineHeight) || fontSize * 1.72) * zoom;
    // Leave room for both the marker and the existing fold caret. This control
    // is outside layout, so centered text never includes its width.
    const list = item.element.parentElement!;
    const gutter = parseFloat(getComputedStyle(list).paddingLeft) || fontSize * 1.35;
    const left = item.element.getBoundingClientRect().left - (gutter + fontSize * 1.15 + 20) * zoom;
    const contentRect = row.content.getBoundingClientRect();
    if (x < left - 4 * zoom || x > item.element.getBoundingClientRect().right
      || y < contentRect.top - 2 * zoom || y > contentRect.bottom + 2 * zoom) { this.hide(); return; }
    this.handle.style.left = `${left / zoom}px`;
    this.handle.style.top = `${(rect.top + (lineHeight - 22 * zoom) / 2) / zoom}px`;
    this.handle.hidden = false;
    this.setHovered(item);
  }

  private targetAt(x: number, y: number, sourcePos: number): VisualTarget | null {
    const editorRect = this.view.dom.getBoundingClientRect();
    const surfaceRect = this.surface.getBoundingClientRect();
    if (x < surfaceRect.left || x > surfaceRect.right || y < Math.max(surfaceRect.top, editorRect.top) || y > Math.min(surfaceRect.bottom, editorRect.bottom)) return null;
    const hit = listDragHitAtY(this.view.dom, y);
    if (!hit) return null;
    const sourceDOM = this.view.nodeDOM(sourcePos);
    if (sourceDOM instanceof Element && hit.row && sourceDOM !== hit.row.item && sourceDOM.contains(hit.row.item)) return null;
    const item = hit.row && this.itemAt(hit.row.item);
    const source = this.view.state.doc.nodeAt(sourcePos)!;
    // Reject the entire source subtree before considering shallower targets.
    if (item && item.pos > sourcePos && item.pos < sourcePos + source.nodeSize) return null;
    if (item) {
      const node = this.view.state.doc.nodeAt(item.pos)!;
      const itemRect = item.element.getBoundingClientRect();
      // A parent's after-position is below its whole subtree. Choose the
      // closest real boundary so its first line cannot jump past its children.
      const after = Math.abs(y - itemRect.bottom) < Math.abs(y - itemRect.top);
      const neighbor = after ? item.element.nextElementSibling : item.element.previousElementSibling;
      let top = after ? itemRect.bottom : itemRect.top;
      let lineRect = itemRect;
      if (neighbor?.matches('li')) {
        const neighborRect = neighbor.getBoundingClientRect();
        // After one sibling and before the next are the same insertion point.
        // Give both approaches one line centered in their shared gap.
        top = after ? (itemRect.bottom + neighborRect.top) / 2 : (neighborRect.bottom + itemRect.top) / 2;
        if (after) lineRect = neighborRect;
      }
      return { target: { pos: item.pos + (after ? node.nodeSize : 0), listPos: this.view.state.doc.resolve(item.pos).before() },
        left: lineRect.left, top, width: lineRect.width };
    }
    // Drop outside a list at a block boundary, creating a portable new list.
    const block = hit.block;
    const pos = this.view.posAtDOM(block, 0);
    const $pos = this.view.state.doc.resolve(pos);
    const blockPos = $pos.depth ? $pos.before(1) : pos;
    const node = this.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    const rect = block.getBoundingClientRect();
    const after = y >= (rect.top + rect.bottom) / 2;
    return { target: { pos: blockPos + (after ? node.nodeSize : 0) }, left: editorRect.left, top: after ? rect.bottom : rect.top, width: editorRect.width };
  }

  private start = (event: PointerEvent) => {
    if (event.button !== 0 || !this.view.editable || !this.hovered) return;
    event.preventDefault(); event.stopPropagation();
    const sourcePos = this.hovered.pos;
    const sourceElement = this.hovered.element;
    const originalDoc = this.view.state.doc;
    const sourceEnd = sourcePos + originalDoc.nodeAt(sourcePos)!.nodeSize;
    const sourceListPos = originalDoc.resolve(sourcePos).before();
    let dragging = false;
    let point = { x: event.clientX, y: event.clientY };
    let frame = 0;
    const paint = () => {
      const visual = this.targetAt(point.x, point.y, sourcePos);
      const unchangedPosition = visual?.target.listPos === sourceListPos
        && (visual.target.pos === sourcePos || visual.target.pos === sourceEnd);
      const valid = visual && (unchangedPosition || listMovePlan(this.view.state, sourcePos, visual.target));
      this.indicator.hidden = !valid;
      this.handle.classList.toggle("is-invalid-drop", !valid);
      if (visual && valid) {
        const zoom = appZoom();
        Object.assign(this.indicator.style, { left: `${visual.left / zoom}px`, top: `${visual.top / zoom}px`, width: `${visual.width / zoom}px` });
      }
    };
    const scroll = () => {
      if (!dragging) return;
      const rect = this.surface.getBoundingClientRect();
      const delta = point.y < rect.top + 48 ? -12 : point.y > rect.bottom - 48 ? 12 : 0;
      if (delta) { this.surface.scrollTop += delta; paint(); }
      frame = requestAnimationFrame(scroll);
    };
    const finish = (commit: boolean) => {
      const visual = commit && dragging ? this.targetAt(point.x, point.y, sourcePos) : null;
      const tr = visual && this.view.dom.isConnected && this.view.state.doc === originalDoc && this.view.editable ? moveListItem(this.view.state, sourcePos, visual.target) : null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("dragstart", this.preventDefault, true);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(frame);
      if (this.handle.hasPointerCapture?.(event.pointerId)) this.handle.releasePointerCapture(event.pointerId);
      document.body.classList.remove("is-dragging-list-item");
      sourceElement.classList.remove("is-dragging-list-source");
      this.handle.classList.remove("is-invalid-drop");
      this.indicator.hidden = true;
      this.cancelDrag = null;
      this.hide();
      if (tr) {
        this.view.dispatch(tr);
        this.view.dispatch(closeHistory(this.view.state.tr));
        this.view.focus();
      }
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault();
      point = { x: next.clientX, y: next.clientY };
      if (!dragging && Math.hypot(point.x - event.clientX, point.y - event.clientY) < 5) return;
      if (!dragging) {
        dragging = true;
        document.body.classList.add("is-dragging-list-item");
        sourceElement.classList.add("is-dragging-list-source");
        frame = requestAnimationFrame(scroll);
      }
      paint();
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      point = { x: next.clientX, y: next.clientY };
      const clickedOnly = !dragging;
      finish(true);
      if (clickedOnly) this.showAt(next.clientX, next.clientY);
    };
    const cancel = () => finish(false);
    const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); cancel(); } };
    this.cancelDrag = cancel;
    try { this.handle.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("dragstart", this.preventDefault, true);
    window.addEventListener("blur", cancel);
  };

  private followSurface() {
    // React mounts Tiptap into a temporary detached element, then reparents its
    // DOM into EditorContent. Follow that move so the outer gutter stays in our
    // hover surface and auto-scroll targets the actual note pane.
    if (this.surface === this.view.dom || !this.surface.contains(this.view.dom)) {
      const surface = this.view.dom.closest<HTMLElement>(".note-surface") ?? this.view.dom;
      if (surface !== this.surface) {
        this.cancelDrag?.(); this.hide();
        this.surface.removeEventListener("pointerleave", this.leave);
        this.surface = surface;
        this.surface.addEventListener("pointerleave", this.leave);
      }
    }
  }

  update(view: EditorView, previous: EditorState) {
    this.followSurface();
    if (view.state.doc !== previous.doc || !view.editable) { this.cancelDrag?.(); this.hide(); }
  }

  destroy() {
    this.cancelDrag?.();
    this.setHovered(null);
    this.handle.removeEventListener("wheel", this.scrollFromHandle);
    document.removeEventListener("pointermove", this.hover);
    this.surface.removeEventListener("pointerleave", this.leave);
    document.removeEventListener("scroll", this.hide, true);
    window.removeEventListener("resize", this.hide);
    this.handle.remove(); this.indicator.remove();
  }
}

export const ListDragging = Extension.create({
  name: "listDragging",
  addProseMirrorPlugins() { return [new Plugin({ view: view => new ListDragView(view) })]; },
});
