import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { save } from "@tauri-apps/plugin-dialog";

export type AppPreferences = {
  lastWorkspace?: string | null;
  spellcheckEnabled?: boolean;
};

export type AppMenuState = {
  hasWorkspace: boolean;
  hasOpenNote: boolean;
  activeNoteEditable: boolean;
  hasUnsavedChanges: boolean;
  rawMarkdownVisible: boolean;
  leftVisible: boolean;
  outlineVisible: boolean;
  wordCountVisible: boolean;
  spellcheckEnabled: boolean;
  editorWidthMode: "comfortable" | "narrow" | "full";
  noteAlignment: "left" | "center";
  recentNotes: Array<{ path: string; title: string }>;
};

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openExternal(url: string) {
  if (isTauri()) {
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function updateAppMenuState(label: string, state: AppMenuState) {
  if (!isTauri()) return;
  await invoke("update_app_menu_state", { label, state });
}

export async function exportTextFile(defaultFileName: string, contents: string, filters: Array<{ name: string; extensions: string[] }>) {
  if (isTauri()) {
    const path = await save({
      title: "Export note",
      defaultPath: defaultFileName,
      filters,
    });
    if (!path) return;
    await invoke("write_export_text_file", { payload: { path, contents } });
    return;
  }

  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function printCurrentWebview() {
  if (isTauri()) {
    await invoke("print_current_webview");
    return;
  }
  window.print();
}

export async function setCurrentWebviewZoom(scaleFactor: number) {
  if (isTauri()) {
    await getCurrentWebview().setZoom(scaleFactor);
    return;
  }
  document.documentElement.style.setProperty("zoom", String(scaleFactor));
}

export async function readAppPreferences(): Promise<AppPreferences> {
  if (!isTauri()) return {};
  return invoke("read_app_preferences");
}

export async function writeAppPreferences(preferences: AppPreferences) {
  if (!isTauri()) return;
  await invoke("write_app_preferences", { preferences });
}

export async function registerNotebookWindow(label: string, workspace: string) {
  if (!isTauri()) return;
  await invoke("register_notebook_window", { label, workspace });
}

export async function unregisterNotebookWindow(label: string) {
  if (!isTauri()) return;
  await invoke("unregister_notebook_window", { label });
}

export async function focusNotebookWindow(workspace: string) {
  if (!isTauri()) return false;
  return invoke<boolean>("focus_notebook_window", { workspace });
}
