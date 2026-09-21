import { useLayoutEffect, useRef, useState } from "react";
import { resolveResponsivePanes, type PaneLayout } from "./responsivePanes";

type Options = Omit<PaneLayout, "width" | "gap"> & { theme: unknown; mode: "light" | "dark"; notebook: string | null; plasma: boolean };

export function useResponsivePanes({ theme, mode, notebook, plasma, ...layout }: Options) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ width: Infinity, gap: 6 });
  const [overlay, setOverlay] = useState<"left" | "right" | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = (contentWidth?: number) => {
      const style = getComputedStyle(frame);
      const number = (value: string) => Number.parseFloat(value) || 0;
      const width = contentWidth ?? frame.clientWidth - number(style.paddingLeft) - number(style.paddingRight);
      // A hidden window has no useful measurement yet; keep its last layout.
      if (width <= 0) return;
      const gap = Number.parseFloat(style.getPropertyValue("--tigrana-panel-gap"));
      const next = { width, gap: Number.isFinite(gap) ? gap : plasma ? 20 : 6 };
      setMetrics(current => current.width === next.width && current.gap === next.gap ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      const entry = entries.find(entry => entry.target === frame);
      if (entry) measure(entry.contentRect.width);
    });
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, [theme, mode, plasma]);

  useLayoutEffect(() => { setOverlay(null); }, [metrics.width, theme, mode, notebook, plasma, layout.navigationStyle]);
  const docked = resolveResponsivePanes({ ...layout, ...metrics });
  const canDockLeft = resolveResponsivePanes({ ...layout, ...metrics, leftVisible: true }).leftVisible;
  const canDockRight = resolveResponsivePanes({ ...layout, ...metrics, outlineVisible: true }).outlineVisible;
  return {
    frameRef, docked, canDockLeft, canDockRight, overlay, setOverlay,
    leftVisible: docked.leftVisible || overlay === "left",
    outlineVisible: docked.outlineVisible || overlay === "right",
  };
}
