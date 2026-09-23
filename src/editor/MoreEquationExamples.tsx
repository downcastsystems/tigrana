import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { EditorOptionsSubmenu } from "../components/EditorOptionsSubmenu";
import { moreMathExamples, type MathExample } from "../lib/math";

export function MoreEquationExamples({ allowBlock, onChoose }: { allowBlock: boolean; onChoose: (example: MathExample) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("mousedown", dismiss, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("mousedown", dismiss, true); window.removeEventListener("resize", close); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const panel = menu.current;
    panel.style.left = `${Math.max(8, Math.min(Math.max(256, rect.right - panel.offsetWidth), window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8))}px`;
    panel.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>More examples <ChevronDown size={13} /></button>
    {open && createPortal(<div ref={menu} className="note-view-dropdown equation-examples-menu" role="menu" aria-label="More equation examples"
      onMouseDown={event => event.stopPropagation()}
      onKeyDownCapture={event => {
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>(':scope > .editor-options-submenu > button')];
        const index = items.indexOf(event.target as HTMLButtonElement);
        if (index >= 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault(); event.stopPropagation(); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>(':scope > .editor-options-submenu > button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (index >= 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}>
      {moreMathExamples.map(group => <EditorOptionsSubmenu key={group.label} label={group.label}>
        {group.examples.map(example => <button key={example.label} type="button" role="menuitem" disabled={example.block && !allowBlock}
          title={example.block && !allowBlock ? "This example needs an equation on its own line." : example.explanation}
          onClick={() => { setOpen(false); onChoose(example); }}><span><strong>{example.label}</strong></span></button>)}
      </EditorOptionsSubmenu>)}
    </div>, document.body)}
  </>;
}
