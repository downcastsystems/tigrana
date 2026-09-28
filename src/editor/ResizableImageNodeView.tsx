import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef } from "react";

export function ResizableImageNodeView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const cancelResizeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelResizeRef.current?.(), [selected, node.attrs.src, node.attrs.markdownSrc]);

  const selectImage = () => {
    const pos = getPos();
    if (typeof pos !== "number" || editor.isDestroyed) return;
    // Focusing without scrollIntoView keeps tall images where the user clicked.
    editor.commands.setNodeSelection(pos);
    editor.view.focus();
  };

  const handleResizeStart = (event: React.PointerEvent) => {
    if (event.button !== 0 || !editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    cancelResizeRef.current?.();
    selectImage();
    const container = containerRef.current;
    if (!container) return;
    const startX = event.clientX;
    const startWidth = container.getBoundingClientRect().width;
    const maxWidth = container.parentElement?.getBoundingClientRect().width || Infinity;
    const originalWidth = container.style.width;
    let width = startWidth;
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      container.style.width = originalWidth;
      cancelResizeRef.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      width = Math.min(maxWidth, Math.max(60, Math.round(startWidth + e.clientX - startX)));
      container.style.width = `${width}px`;
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      move(e);
      cleanup();
      if (!editor.isDestroyed && editor.isEditable && width !== startWidth) updateAttributes({ width });
    };
    const cancel = () => cleanup();
    cancelResizeRef.current = cancel;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const width = node.attrs.width as number | null;
  return (
    <NodeViewWrapper as="span" className="image-resizable-wrapper" contentEditable={false}>
      <span ref={containerRef} className={`image-resizable${selected ? " is-selected" : ""}`}
        style={width ? { width: `${width}px` } : undefined}>
        <img src={node.attrs.src as string} alt={(node.attrs.alt as string) || ""}
          data-markdown-src={node.attrs.markdownSrc as string | undefined}
          onMouseDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            selectImage();
          }}
        />
        {selected && editor.isEditable && <>
          <span className="image-resize-edge" title="Drag to resize image" onPointerDown={handleResizeStart} />
          <span className="image-resize-handle is-top" title="Drag to resize image" onPointerDown={handleResizeStart} />
          <span className="image-resize-handle" title="Drag to resize image" onPointerDown={handleResizeStart} />
        </>}
      </span>
    </NodeViewWrapper>
  );
}
