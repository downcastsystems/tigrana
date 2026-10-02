import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { WindowsMenuPanel, type WindowsMenuEntry } from "./WindowsMenuPanel";
import { isTauri } from "../lib/desktop";

export function isWindowsDesktop() {
  return isTauri() && /Win/.test(navigator.platform);
}

export function WindowsMenuBar({ onError, onMouseDown, onDoubleClick }: {
  onError: (message: string) => void;
  onMouseDown: MouseEventHandler<HTMLElement>;
  onDoubleClick: MouseEventHandler<HTMLElement>;
}) {
  const [entries, setEntries] = useState<WindowsMenuEntry[]>([]);
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement; keyboard: boolean } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const nav = useRef<HTMLElement>(null);
  const close = () => { generation.current++; setOpen(null); previousFocus.current?.focus(); };
  const show = (id: string, anchor: HTMLElement, keyboard = false) => {
    if (!open && !document.activeElement?.closest("[data-windows-menu]")) previousFocus.current = document.activeElement as HTMLElement;
    const request = ++generation.current;
    setOpen({ id, anchor, keyboard });
    void invoke<WindowsMenuEntry[]>("windows_menu_entries").then(items => {
      if (request === generation.current) setEntries(items);
    }).catch(error => { if (request === generation.current) { close(); onError(String(error)); } });
  };
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !event.target.closest("[data-windows-menu]")) previousFocus.current = event.target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-windows-menu]")) close();
    };
    const blur = () => { generation.current++; setOpen(null); };
    const keys = (event: KeyboardEvent) => {
      if ((event.target as Element).closest?.("[data-windows-menu]")) return;
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation(); setOpen({ ...open, keyboard: true });
      }
    };
    window.addEventListener("keydown", keys, true);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keys, true); document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", blur); };
  }, [open]);
  useEffect(() => () => { generation.current++; }, []);
  const headings = ["Tigrana", "File", "Edit", "Find", "View", "Format", "Insert", "Window"];
  const switchMenu = (direction: number) => {
    const index = (headings.indexOf(open!.id) + direction + headings.length) % headings.length;
    const anchor = nav.current!.querySelectorAll<HTMLButtonElement>("button")[index];
    show(headings[index], anchor, true);
  };
  const current = entries.find(entry => entry.id === open?.id);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    const update = async () => {
      const value = await win.isMaximized();
      if (!disposed) setMaximized(value);
    };
    const unlisten = win.onResized(() => { void update().catch(console.warn); });
    void update().catch(console.warn);
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop()).catch(console.warn);
    };
  }, []);

  const run = (action: Promise<unknown>) => {
    void action.catch((error) => onError(String(error)));
  };

  return (
    <header className="windows-menu-bar" onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
      <nav ref={nav} data-windows-menu role="menubar" className="windows-menus chrome-interactive" aria-label="Application menus">
        {headings.map(menu => <button key={menu} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open?.id === menu}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={event => { if (open && open.id !== menu) show(menu, event.currentTarget); }}
          onClick={event => open?.id === menu ? close() : show(menu, event.currentTarget, event.detail === 0)}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(menu, event.currentTarget, true); }
            if (event.key === "Escape") { event.preventDefault(); close(); }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const index = (headings.indexOf(menu) + (event.key === "ArrowRight" ? 1 : -1) + headings.length) % headings.length;
              const button = nav.current!.querySelectorAll<HTMLButtonElement>("button")[index];
              if (open) show(headings[index], button, true); else button.focus();
            }
          }}>{menu}</button>)}
      </nav>
      {open && current?.children ? <WindowsMenuPanel key={open.id} entries={current.children} anchor={open.anchor} keyboard={open.keyboard}
        onClose={close} onSwitch={switchMenu} onChoose={id => { close(); run(invoke("execute_windows_menu", { id })); }} /> : null}
      <div className="windows-drag-space" />
      <div className="windows-controls chrome-interactive">
        <button type="button" aria-label="Minimize" onClick={() => run(getCurrentWindow().minimize())}><Minus size={14} /></button>
        <button type="button" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => run(getCurrentWindow().toggleMaximize())}>
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button type="button" className="windows-close" aria-label="Close window" onClick={() => run(getCurrentWindow().close())}><X size={16} /></button>
      </div>
    </header>
  );
}
