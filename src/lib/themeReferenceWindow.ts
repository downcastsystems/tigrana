import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "./desktop";

let browserReference: Window | null = null;
let opening: Promise<void> | null = null;

/** A standalone help page: never mounts a notebook or the theme editor. */
export function openThemeReferenceWindow(): Promise<void> {
  const mode = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const query = `?view=theme-css-reference&mode=${mode}`;
  if (!isTauri()) {
    if (browserReference && !browserReference.closed) {
      browserReference.focus();
      return Promise.resolve();
    }
    browserReference = window.open(`${window.location.pathname}${query}`, "tigrana-css-reference", "popup,width=720,height=880,resizable=yes,scrollbars=yes");
    if (!browserReference) return Promise.reject(new Error("Allow pop-up windows to open the CSS reference."));
    return Promise.resolve();
  }
  if (opening) return opening;
  opening = (async () => {
    const existing = await WebviewWindow.getByLabel("tigrana-css-reference");
    if (existing) {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return;
    }
    const reference = new WebviewWindow("tigrana-css-reference", {
      url: `/${query}`,
      title: "CSS reference — Tigrana",
      width: 720,
      height: 880,
      minWidth: 420,
      minHeight: 360,
      resizable: true,
      decorations: true,
    });
    await new Promise<void>((resolve, reject) => {
      void reference.once("tauri://created", () => resolve());
      void reference.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
  })().finally(() => { opening = null; });
  return opening;
}
