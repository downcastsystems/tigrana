import { useCallback, useEffect, useRef, useState, type RefObject, type SetStateAction } from "react";
import type { PaneVisibility } from "./focusMode";

type Side = "left" | "right";
type Overlay = Side | null;
type Hover = { side: Side; source: "edge" | "button"; delay: number; progress: number; updatedAt: number; revision: number };
export const sidebarHoverEdgeWidth = 28;
export const sidebarHoverDelay = { edge: 250, button: 1000 } as const;
const edgeDelay = (distance: number) => sidebarHoverDelay.edge
  + (sidebarHoverDelay.button - sidebarHoverDelay.edge) * Math.max(0, Math.min(1, distance / sidebarHoverEdgeWidth));
export const sidebarLeaveDelay = 300;
const blockingModalSelector = '.dialog-backdrop, [aria-modal="true"], dialog[open]';
const hasBlockingModal = () => !!document.querySelector(blockingModalSelector);

/** Hover previews share the responsive overlay, but never change docked preferences. */
export function useSidebarOverlay(frameRef: RefObject<HTMLDivElement>, docked: PaneVisibility) {
  const [overlay, setOverlayState] = useState<Overlay>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverPreview = useRef(false);
  const hoverRevision = useRef(0);
  const pendingHover = useRef<Hover | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelHover = useCallback(() => {
    clearTimeout(openTimer.current);
    openTimer.current = undefined;
    if (pendingHover.current !== null) setHover(null);
    pendingHover.current = null;
  }, []);
  const clearTimers = useCallback(() => {
    cancelHover();
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, [cancelHover]);
  const setOverlay = useCallback((value: SetStateAction<Overlay>) => {
    clearTimers();
    hoverPreview.current = false;
    setOverlayState(value);
  }, [clearTimers]);

  useEffect(() => {
    const paneSelector = overlay === "left" ? "#left-navigation-panes" : "#right-note-sidebar";
    const isDocked = (side: Side) => side === "left" ? docked.leftVisible : docked.outlineVisible;
    const scheduleClose = () => {
      if (!hoverPreview.current || closeTimer.current) return;
      closeTimer.current = setTimeout(() => {
        const pane = frameRef.current?.querySelector(paneSelector);
        // Keep a field being edited, or a sidebar's open menu, available.
        if (pane?.contains(document.activeElement) && document.activeElement?.matches('input, textarea, [contenteditable="true"]')
          || document.querySelector('.context-menu, .app-menu, [role="menu"], [role="dialog"]')) {
          closeTimer.current = undefined;
          return;
        }
        setOverlay(null);
      }, sidebarLeaveDelay);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (hasBlockingModal()) {
        if (pendingHover.current || overlay) setOverlay(null);
        return;
      }
      if (event.pointerType === "touch" || event.buttons) return;
      const target = event.target instanceof Element ? event.target : null;
      const insideFrame = !!target && frameRef.current?.contains(target);
      const insideTitlebar = !!target && !!frameRef.current?.closest(".app-shell")
        ?.querySelector(".app-titlebar")?.contains(target);
      const peekTarget = insideFrame || insideTitlebar ? target?.closest<HTMLElement>('[data-sidebar-peek]') : null;
      let side = peekTarget?.dataset.sidebarPeek as Overlay;
      let source: Hover["source"] = peekTarget?.hasAttribute('data-sidebar-peek-edge') ? "edge" : "button";
      const bounds = insideFrame && !overlay && !docked.leftVisible && (!side || source === "edge")
        ? frameRef.current!.getBoundingClientRect() : null;
      // Only the left edge previews a pane. The right edge belongs to the editor scrollbar;
      // its sidebar previews exclusively from the explicit toggle button.
      if (!side && insideFrame && !overlay && !docked.leftVisible) {
        if (bounds && bounds.width > 0 && event.clientX >= bounds.left && event.clientX <= bounds.left + sidebarHoverEdgeWidth) {
          side = "left";
          source = "edge";
        }
      }
      if (side && !isDocked(side) && !overlay) {
        const delay = source === "edge" ? edgeDelay(event.clientX - (bounds?.left ?? 0)) : sidebarHoverDelay.button;
        const previous = pendingHover.current;
        const sameTarget = previous?.side === side && previous.source === source;
        if (sameTarget && previous.delay === delay) return;
        const now = performance.now();
        // Keep the charge already earned. Moving inward changes its rate, not its
        // progress, so the glow never jumps and pointer jitter cannot restart the wait.
        const progress = sameTarget ? Math.min(1, previous.progress + (now - previous.updatedAt) / previous.delay) : 0;
        clearTimeout(openTimer.current);
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
        const next: Hover = { side, source, delay, progress, updatedAt: now, revision: ++hoverRevision.current };
        pendingHover.current = next;
        setHover(next);
        openTimer.current = setTimeout(() => {
          // A canceled callback must never open a newer hover session.
          if (pendingHover.current !== next) return;
          if (hasBlockingModal()) {
            setOverlay(null);
            return;
          }
          openTimer.current = undefined;
          pendingHover.current = null;
          setHover(null);
          hoverPreview.current = true;
          setOverlayState(side);
        }, Math.ceil((1 - progress) * delay));
        return;
      }
      cancelHover();
      if (!hoverPreview.current) return;
      if ((insideFrame || insideTitlebar) && (target?.closest(paneSelector) || side === overlay)
        || target?.closest('.context-menu, .app-menu, [role="menu"], [role="dialog"]')) {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      } else scheduleClose();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) {
        cancelHover();
        scheduleClose();
      }
    };
    const onPointerDown = cancelHover;
    const onBlur = () => setOverlay(null);
    // A modal can open from a shortcut or async action while the pointer is still.
    // Inspect only new modal elements and dialog attributes, not editor text changes.
    const containsModal = (node: Node) => node instanceof Element && node.isConnected
      && (node.matches(blockingModalSelector) || !!node.querySelector(blockingModalSelector));
    const modalObserver = new MutationObserver(records => {
      if (!pendingHover.current && !overlay) return;
      if (records.some(record => record.type === "attributes"
        ? containsModal(record.target)
        : [...record.addedNodes].some(containsModal))) setOverlay(null);
    });
    modalObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal"] });
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    return () => {
      modalObserver.disconnect();
      clearTimers();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [frameRef, docked.leftVisible, docked.outlineVisible, overlay, cancelHover, clearTimers, setOverlay]);

  return {
    overlay, hoverSide: hover?.side ?? null, hoverDelay: hover?.delay ?? sidebarHoverDelay.edge,
    hoverOffset: -(hover?.progress ?? 0) * (hover?.delay ?? 0), hoverRevision: hover?.revision ?? 0, setOverlay,
  };
}
