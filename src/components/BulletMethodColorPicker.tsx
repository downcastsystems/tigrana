import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { inlineColors } from "../lib/inlineColors";

export function BulletMethodColorPicker({ name, value, colorMode, onChange }: {
  name: string;
  value?: string | null;
  colorMode: "light" | "dark";
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = inlineColors.find(color => color.id === value);
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
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); };
  }, [open]);
  const options = [{ id: null, label: "Theme default", text: undefined }, ...inlineColors.map(color => ({ ...color, text: color.text[colorMode] }))];
  return <>
    <button type="button" className="icon-button bullet-method-color-trigger" ref={trigger}
      aria-label={`Text color for ${name}: ${selected?.label ?? "Theme default"}`} title={`Text color: ${selected?.label ?? "Theme default"}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}>
      <span className="inline-color-swatch" aria-hidden="true" style={{ color: selected?.text[colorMode] }}>A</span>
    </button>
    {open && createPortal(<div className="bullet-method-color-menu" ref={menu} id={id} role="menu" aria-label={`Text color for ${name}`}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return;
        }
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : null;
        const next = delta !== null ? (index + delta + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); items[next].focus(); }
      }}>
      {options.map(color => {
        const checked = color.id === (selected?.id ?? null);
        return <button key={color.id ?? "default"} type="button" role="menuitemradio" aria-checked={checked} tabIndex={checked ? 0 : -1}
          onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}
          onClick={() => { setOpen(false); trigger.current?.focus(); onChange(color.id); }}>
          <span className="inline-color-swatch" aria-hidden="true" style={{ color: color.text }}>A</span>
          <span>{color.label}</span>{checked && <Check size={13} aria-hidden="true" />}
        </button>;
      })}
    </div>, document.body)}
  </>;
}
