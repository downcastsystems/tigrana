import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import { ChevronDown } from "lucide-react";
import { NotebookWallpaperDialog } from "./NotebookWallpaperDialog";
import type { NotebookWallpaper } from "../types";

export function WallpaperMenu({ label, wallpapers, theme, active, onDelete, onComputer, onSelect }: {
  theme: import("../lib/themes").ThemeDocument;
  active?: NotebookWallpaper;
  onDelete: (wallpaper: NotebookWallpaper) => Promise<void>;
  label: string;
  wallpapers: NotebookWallpaper[];
  onComputer: () => void;
  onSelect: (wallpaper: NotebookWallpaper) => void;
}) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const options = [
    { label: 'From my computer…', select: onComputer },
    { label: 'From this notebook…', select: () => setGalleryOpen(true) },
  ];
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    const button = trigger.current;
    const popup = menu.current;
    if (!open || !button || !popup) return;
    let cancelled = false;
    const cleanup = autoUpdate(button, popup, () => {
      void computePosition(button, popup, {
        placement: "bottom-start",
        middleware: [
          offset(6),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({ padding: 8, apply({ availableWidth, availableHeight }) {
            if (cancelled) return;
            Object.assign(popup.style, {
              maxWidth: `${Math.max(0, availableWidth)}px`,
              maxHeight: `${Math.max(0, Math.min(300, availableHeight))}px`,
            });
          } }),
        ],
      }).then(({ x, y }) => {
        if (!cancelled) Object.assign(popup.style, { left: `${x}px`, top: `${y}px` });
      });
    });
    return () => { cancelled = true; cleanup(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="theme-defaults-control" ref={host} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button type="button" className="toolbar-button" ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}>{label}<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="theme-defaults-menu" ref={menu} id={menuId} role="menu" aria-label="Choose background image" onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next].focus(); }
    }}>
      {options.map(({ label, select }, index) => <button key={index} type="button" role="menuitem" onMouseDown={event => {
        // WebKit may blur to the document instead of focusing a clicked button.
        // Keep the menu mounted until its click handler can choose the image.
        if (event.button === 0) event.preventDefault();
      }} onClick={() => {
        setOpen(false); trigger.current?.focus(); select();
      }}>{label}</button>)}
    </div>}
    {galleryOpen && <NotebookWallpaperDialog theme={theme} active={active} onDelete={onDelete} wallpapers={wallpapers} onSelect={onSelect}
      onClose={() => { setGalleryOpen(false); trigger.current?.focus(); }} />}
  </div>;
}
