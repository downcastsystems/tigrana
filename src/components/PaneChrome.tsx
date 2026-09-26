import { Pin, X } from "lucide-react";

export function PaneResizer({
  label,
  variant = "inner",
  onPointerDown,
}: {
  label: string;
  variant?: "inner" | "left-of-main" | "right-of-main";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-label={label}
      className={`pane-resizer pane-resizer--${variant}`}
      role="separator"
      tabIndex={0}
      onPointerDown={onPointerDown}
    />
  );
}

export function SidebarOverlayActions({ side, onPin, onClose }: { side: "left" | "right"; onPin?: () => void; onClose: () => void }) {
  return <div className={`sidebar-overlay-actions is-${side}`}>
    {onPin && <button className="toolbar-button" aria-label={`Keep ${side} sidebar open`} onClick={onPin}><Pin size={14} />Keep open</button>}
    <button className="icon-button" aria-label={`Close ${side} sidebar preview`} title="Close preview" onClick={onClose}><X size={16} /></button>
  </div>;
}

export function stopChromeMouseDown(event: React.MouseEvent) {
  event.stopPropagation();
}
