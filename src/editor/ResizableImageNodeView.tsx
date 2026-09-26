import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewWrapper } from "@tiptap/react";
import { useRef } from "react";

export function ResizableImageNodeView({
  node,
  updateAttributes,
  selected,
}: {
  node: ProseMirrorNode;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startXRef.current = event.clientX;
    startWidthRef.current =
      containerRef.current?.getBoundingClientRect().width ?? (node.attrs.width as number | null) ?? 400;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(60, Math.round(startWidthRef.current + delta));
      updateAttributes({ width: newWidth });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const width = node.attrs.width as number | null;

  return (
    <NodeViewWrapper as="span" className="image-resizable-wrapper">
      <span
        ref={containerRef}
        className={`image-resizable${selected ? " is-selected" : ""}`}
        style={width ? { width: `${width}px` } : undefined}
      >
        <img
          src={node.attrs.src as string}
          alt={(node.attrs.alt as string) || ""}
          data-markdown-src={node.attrs.markdownSrc as string | undefined}
        />
        {selected && (
          <span className="image-resize-handle" onMouseDown={handleResizeStart} />
        )}
      </span>
    </NodeViewWrapper>
  );
}
