import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { bulletMethodIconOptions, bulletMethodIconUrl, type BulletMethodIcon } from "../lib/bulletMethodIcons";

export function BulletMethodIconPicker({ name, value, onChange }: { name: string; value: BulletMethodIcon; onChange: (icon: BulletMethodIcon) => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const button = trigger.current, popup = menu.current;
    if (!open || !button || !popup) return;
    let cancelled = false;
    const cleanup = autoUpdate(button, popup, () => {
      void computePosition(button, popup, { strategy: "fixed", placement: "bottom-end", middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })] }).then(({ x, y }) => {
        if (!cancelled) Object.assign(popup.style, { left: `${x}px`, top: `${y}px` });
      });
    });
    return () => { cancelled = true; cleanup(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="bullet-method-icon-picker" ref={host} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button type="button" className="icon-button" ref={trigger} aria-label={`Icon for ${name}`} title={`Choose icon for ${name}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}>
      <span className="bullet-method-icon-preview" aria-hidden="true" style={{ maskImage: `url("${bulletMethodIconUrl(value)}")`, WebkitMaskImage: `url("${bulletMethodIconUrl(value)}")` }} />
    </button>
    {open && <div className="bullet-method-icon-menu" ref={menu} id={id} role="menu" aria-label={`Circle icons for ${name}`} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 6 : event.key === "ArrowUp" ? -6 : null;
      const next = delta !== null ? (index + delta + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next].focus(); }
    }}>
      {bulletMethodIconOptions.map(icon => <button key={icon.id} type="button" role="menuitemradio" aria-checked={icon.id === value} aria-label={icon.label} title={icon.label}
        tabIndex={icon.id === value ? 0 : -1} onMouseDown={event => {
          // Keep WebKit from blurring and closing the menu before the click.
          if (event.button === 0) event.preventDefault();
        }} onClick={() => { setOpen(false); trigger.current?.focus(); onChange(icon.id); }}>
        <span className="bullet-method-icon-preview" aria-hidden="true" style={{ maskImage: `url("${icon.url}")`, WebkitMaskImage: `url("${icon.url}")` }} />
      </button>)}
    </div>}
  </div>;
}
