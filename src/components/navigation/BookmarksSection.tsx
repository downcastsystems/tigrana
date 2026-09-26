import { ChevronDown, ChevronRight, FileText, Folder, X } from "lucide-react";
import { useRef, useState } from "react";
import type { BookmarkView } from "../../lib/notebookMetadata";
import type { BookmarkEntry } from "../../types";
import { IconMark } from "../IconBrowser";
import type { DropPlacement } from "../../lib/notebookNavigation";

export function BookmarksSection({
  bookmarks,
  expanded,
  onRemove,
  onReorder,
  onSelect,
  onToggle,
}: {
  bookmarks: BookmarkView[];
  expanded: boolean;
  onRemove: (id: string) => void;
  onReorder: (draggedId: string, targetId: string, placement: DropPlacement) => void;
  onSelect: (bookmark: BookmarkEntry) => void;
  onToggle: () => void;
}) {
  const [draggedBookmarkId, setDraggedBookmarkId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ id: string; placement: DropPlacement } | null>(null);
  const pointerDragRef = useRef<{ dragging: boolean; id: string; startX: number; startY: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const bookmarkDropTargetAtPoint = (clientX: number, clientY: number) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-bookmark-id]");
    const id = row?.dataset.bookmarkId;
    if (!row || !id || id === pointerDragRef.current?.id) return null;
    const bounds = row.getBoundingClientRect();
    return {
      id,
      placement: (clientY > bounds.top + bounds.height / 2 ? "after" : "before") as DropPlacement,
    };
  };

  const beginPointerDrag = (bookmarkId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest(".bookmark-remove")) return;

    pointerDragRef.current = {
      dragging: false,
      id: bookmarkId,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;
      const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (!drag.dragging && distance < 5) return;

      if (!drag.dragging) {
        drag.dragging = true;
        suppressNextClickRef.current = true;
        document.body.classList.add("is-dragging-bookmark");
        setDraggedBookmarkId(drag.id);
      }

      moveEvent.preventDefault();
      setDropIndicator(bookmarkDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY));
    };

    const cleanupPointerDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-dragging-bookmark");
      pointerDragRef.current = null;
      setDraggedBookmarkId(null);
      setDropIndicator(null);
    };

    const handlePointerCancel = () => {
      cleanupPointerDrag();
      suppressNextClickRef.current = false;
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const drag = pointerDragRef.current;
      const target = drag?.dragging ? bookmarkDropTargetAtPoint(upEvent.clientX, upEvent.clientY) : null;
      cleanupPointerDrag();
      if (drag?.dragging && target) onReorder(drag.id, target.id, target.placement);
      setTimeout(() => { suppressNextClickRef.current = false; }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  };

  return (
    <section className="bookmarks-section">
      <button className="section-header-button" type="button" onClick={onToggle}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Bookmarks</span>
      </button>
      {expanded ? (
        <div className="bookmarks-list">
          {bookmarks.map((bookmark) => {
            return (
              <button
                className={[
                  "bookmark-item",
                  bookmark.missing ? "is-missing" : "",
                  draggedBookmarkId === bookmark.id ? "is-dragging" : "",
                  dropIndicator?.id === bookmark.id ? `is-reorder-${dropIndicator.placement}` : "",
                ].filter(Boolean).join(" ")}
                data-bookmark-id={bookmark.id}
                key={bookmark.id}
                type="button"
                aria-disabled={bookmark.missing}
                onPointerDown={(event) => beginPointerDrag(bookmark.id, event)}
                onClick={() => {
                  if (suppressNextClickRef.current) return;
                  if (!bookmark.missing) onSelect(bookmark);
                }}
              >
                <IconMark value={bookmark.icon} fallback={bookmark.kind === "folder" ? Folder : FileText} size={15} />
                <span>{bookmark.title}</span>
                <span
                  className="bookmark-remove"
                  role="button"
                  tabIndex={0}
                  title="Remove bookmark"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(bookmark.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove(bookmark.id);
                    }
                  }}
                >
                  <X size={13} />
                </span>
              </button>
            );
          })}
          {!bookmarks.length ? <p className="empty-bookmarks">No bookmarks</p> : null}
        </div>
      ) : null}
    </section>
  );
}
