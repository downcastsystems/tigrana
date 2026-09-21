import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import { ChevronDown } from "lucide-react";
import type { ThemeDefaultsScope } from "../lib/themeDefaults";

const options: { scope: ThemeDefaultsScope; label: string }[] = [
  { scope: "all", label: "Use all theme defaults" },
  { scope: "appearance", label: "Use theme default fonts & colors" },
  { scope: "layout", label: "Use theme default layout options" },
];

export function ThemeDefaultsMenu({ disabled, onSelect }: { disabled: boolean; onSelect: (scope: ThemeDefaultsScope) => void }) {
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
              maxHeight: `${Math.max(0, availableHeight)}px`,
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
    <button type="button" className="toolbar-button" ref={trigger} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}>Use theme defaults<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="theme-defaults-menu" ref={menu} id={menuId} role="menu" aria-label="Use theme defaults" onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next].focus(); }
    }}>
      {options.map(({ scope, label }) => <button key={scope} type="button" role="menuitem" onMouseDown={event => {
        // WebKit may blur to the document instead of focusing a clicked button.
        // Keep the menu mounted until its click handler can apply the defaults.
        if (event.button === 0) event.preventDefault();
      }} onClick={() => {
        setOpen(false); trigger.current?.focus(); onSelect(scope);
      }}>{label}</button>)}
    </div>}
  </div>;
}
