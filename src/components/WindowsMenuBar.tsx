import { useEffect, useState, type MouseEventHandler } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { isTauri } from "../lib/desktop";

export function isWindowsDesktop() {
  return isTauri() && /Win/.test(navigator.platform);
}

export function WindowsMenuBar({ onError, onMouseDown, onDoubleClick }: {
  onError: (message: string) => void;
  onMouseDown: MouseEventHandler<HTMLElement>;
  onDoubleClick: MouseEventHandler<HTMLElement>;
}) {
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
      <nav className="windows-menus chrome-interactive" aria-label="Application menus">
        {["Tigrana", "File", "Edit", "View", "Format", "Window"].map((menu) => (
          <button key={menu} type="button" aria-haspopup="menu" onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // devicePixelRatio includes both monitor scaling and webview zoom.
            const zoom = window.devicePixelRatio;
            run(invoke("popup_windows_menu", { menu, x: rect.left * zoom, y: rect.bottom * zoom }));
          }}>{menu}</button>
        ))}
      </nav>
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
