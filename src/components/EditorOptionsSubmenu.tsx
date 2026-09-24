import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export function EditorOptionsSubmenu({ label, value, disabled, children }: { label: string; value?: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) panel.current.style.top = `${window.innerHeight - 8 - rect.bottom}px`;
    if (focusOnOpen.current) { panel.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); focusOnOpen.current = false; }
  }, [open]);
  return <div className="editor-options-submenu"
    onMouseEnter={() => { if (!disabled) setOpen(true); }}
    onMouseLeave={() => setOpen(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => {
        if (open) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        else { focusOnOpen.current = true; setOpen(true); }
      }}
      onKeyDown={event => {
        if (["ArrowLeft", "ArrowRight", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (open) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
          else { focusOnOpen.current = true; setOpen(true); }
        }
      }}><span><strong>{label}</strong>{value ? <small>{value}</small> : null}</span><ChevronLeft size={15} /></button>
    {open && <div ref={panel} id={id} className="note-view-dropdown editor-options-submenu-panel" role="menu" aria-label={label}
      onMouseDown={event => {
        // macOS WebKit can blur a button without focusing the clicked button.
        // Preserve focus until click runs, or onBlur unmounts the choice first.
        if (event.button === 0 && (event.target as Element).closest("button")) event.preventDefault();
      }}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
        }
        const items = [...panel.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = items.length - 1;
        if (next !== undefined) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
      }}>{children}</div>}
  </div>;
}
