import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { Check, ChevronRight } from "lucide-react";

export type WindowsMenuEntry = {
  id: string; text: string; enabled: boolean; checked: boolean | null;
  separator: boolean; shortcut: string | null; children: WindowsMenuEntry[] | null;
};

export function WindowsMenuPanel({ entries, anchor, nested = false, keyboard = false, onChoose, onClose, onSwitch }: {
  entries: WindowsMenuEntry[]; anchor: HTMLElement; nested?: boolean; keyboard?: boolean;
  onChoose: (id: string) => void; onClose: () => void; onSwitch: (direction: number) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<{ entry: WindowsMenuEntry; anchor: HTMLElement; keyboard: boolean } | null>(null);
  useLayoutEffect(() => {
    const element = panel.current!;
    return autoUpdate(anchor, element, () => {
      void computePosition(anchor, element, { strategy: "fixed", placement: nested ? "right-start" : "bottom-start", middleware: [offset(3), flip(), shift({ padding: 8 })] })
        .then(({ x, y }) => Object.assign(element.style, { left: `${x}px`, top: `${y}px`, visibility: "visible" }));
    });
  }, [anchor, nested]);
  useEffect(() => {
    if (keyboard) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [keyboard]);
  const openChild = (entry: WindowsMenuEntry, target: HTMLElement, byKeyboard = false) => {
    setSubmenu(entry.enabled && entry.children ? { entry, anchor: target, keyboard: byKeyboard } : null);
  };
  return createPortal(<>
    <div ref={panel} role="menu" data-windows-menu className="windows-menu-popup chrome-interactive" style={{ visibility: "hidden" }}
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        event.stopPropagation();
        const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setSubmenu(null);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          const entry = entries.find(item => item.id === buttons[index]?.dataset.menuId);
          if (entry?.children) openChild(entry, buttons[index], true); else onSwitch(1);
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {
          event.preventDefault();
          if (nested || event.key === "Escape") onClose(); else onSwitch(-1);
        } else if (event.key === "Tab") { onClose(); }
      }}>
      {entries.map(entry => entry.separator ? <div key={entry.id} role="separator" className="windows-menu-divider" /> :
        <button key={entry.id} data-menu-id={entry.id} role={entry.checked === null ? "menuitem" : "menuitemcheckbox"}
          aria-checked={entry.checked ?? undefined} aria-haspopup={entry.children ? "menu" : undefined}
          aria-expanded={entry.children ? submenu?.entry.id === entry.id : undefined}
          type="button" tabIndex={-1} disabled={!entry.enabled}
          className={submenu?.entry.id === entry.id ? "is-open" : undefined}
          onMouseEnter={event => openChild(entry, event.currentTarget)}
          onClick={event => entry.children ? openChild(entry, event.currentTarget, event.detail === 0) : onChoose(entry.id)}>
          <span className="windows-menu-check">{entry.checked ? <Check size={14} /> : null}</span>
          <span className="windows-menu-label">{entry.text}</span>
          {entry.shortcut ? <span className="windows-menu-shortcut">{entry.shortcut}</span> : null}
          {entry.children ? <ChevronRight size={14} /> : null}
        </button>)}
    </div>
    {submenu?.entry.children ? <WindowsMenuPanel key={submenu.entry.id} entries={submenu.entry.children} anchor={submenu.anchor} nested keyboard={submenu.keyboard}
      onChoose={onChoose} onClose={() => { submenu.anchor.focus(); setSubmenu(null); }} onSwitch={onSwitch} /> : null}
  </>, document.body);
}
