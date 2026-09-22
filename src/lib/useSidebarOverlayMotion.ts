import { useLayoutEffect, useState } from "react";
import type { PaneVisibility } from "./focusMode";

export const sidebarSlideDuration = 180;
type Side = "left" | "right" | null;

/** Keep a dismissed overlay mounted just long enough to slide back offscreen. */
export function useSidebarOverlayMotion(overlay: Side, docked: PaneVisibility) {
  const [presented, setPresented] = useState<Side>(overlay);
  const side = overlay ?? presented;
  const isDocked = side === "left" ? docked.leftVisible : side === "right" && docked.outlineVisible;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const visibleOverlay = isDocked || (!overlay && reducedMotion) ? null : side;
  const closing = !!visibleOverlay && !overlay;

  useLayoutEffect(() => {
    if (overlay || isDocked || reducedMotion) {
      setPresented(isDocked ? null : overlay);
      return;
    }
    if (!presented) return;
    const timer = setTimeout(() => setPresented(null), sidebarSlideDuration);
    return () => clearTimeout(timer);
  }, [overlay, presented, isDocked, reducedMotion]);

  return { visibleOverlay, closing };
}
