import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** Move Settings without rerendering the theme editor on every pointer move. */
export function useSettingsWindowDrag(disabled: boolean) {
  const windowRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    cleanupRef.current?.();
    offsetRef.current = { x: 0, y: 0 };
    element.style.left = "0px";
    element.style.top = "0px";
    const fit = () => {
      cleanupRef.current?.();
      if (disabled) return;
      const rect = element.getBoundingClientRect();
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
      const y = Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8));
      offsetRef.current = {
        x: offsetRef.current.x + x - rect.left,
        y: offsetRef.current.y + y - rect.top,
      };
      element.style.left = `${offsetRef.current.x}px`;
      element.style.top = `${offsetRef.current.y}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(element);
    return () => {
      cleanupRef.current?.();
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [disabled]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const element = windowRef.current;
    if (disabled || !element || event.button !== 0 || event.isPrimary === false) return;
    if ((event.target as Element).closest('button, a, input, select, textarea, [contenteditable="true"], [role="button"]')) return;
    cleanupRef.current?.();
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const start = offsetRef.current;
    const pointerStart = { x: event.clientX, y: event.clientY };
    const origin = element.getBoundingClientRect();
    // Capture keeps the release on the handle even after crossing the backdrop.
    handle.setPointerCapture?.(pointerId);
    element.classList.add("is-dragging");
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const left = Math.max(8, Math.min(origin.left + pointer.clientX - pointerStart.x, window.innerWidth - origin.width - 8));
      const top = Math.max(8, Math.min(origin.top + pointer.clientY - pointerStart.y, window.innerHeight - origin.height - 8));
      offsetRef.current = { x: start.x + left - origin.left, y: start.y + top - origin.top };
      element.style.left = `${offsetRef.current.x}px`;
      element.style.top = `${offsetRef.current.y}px`;
    };
    const finishPointer = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("blur", cleanup);
      handle.removeEventListener("lostpointercapture", finishPointer);
      cleanupRef.current = null;
      element.classList.remove("is-dragging");
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("blur", cleanup);
    handle.addEventListener("lostpointercapture", finishPointer);
  };

  return { windowRef, onPointerDown };
}
